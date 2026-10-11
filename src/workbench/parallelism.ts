import type { InvariantKind } from "./types.ts";

/** A work unit with dependencies and resource ownership. */
export interface WorkUnit {
  readonly id: string;
  readonly ownedFiles: readonly string[];
  readonly reads: readonly string[];
  readonly tokens: readonly string[];
  readonly rules: readonly string[];
  readonly dependsOn: readonly string[];
}

/** Verdict on whether two work units can execute in parallel. */
export type Verdict = "parallel-safe" | "shared-dependency";

/** Assessment of a pair of work units. */
export interface PairAssessment {
  readonly a: string;
  readonly b: string;
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
}

/** Plan for parallel execution with grouping and metrics. */
export interface ParallelPlan {
  readonly pairs: readonly PairAssessment[];
  readonly groups: readonly (readonly string[])[];
  readonly architectOwned: readonly string[];
  readonly sequential: readonly string[];
  readonly recommendation: string;
  readonly mergeSurface: number;
}

/**
 * Assess whether two work units can execute in parallel.
 * Returns "shared-dependency" if they conflict on files, reads/writes, tokens, rules, or dependencies.
 * Returns "parallel-safe" otherwise.
 */
export function assessPair(a: WorkUnit, b: WorkUnit): PairAssessment {
  const reasons: string[] = [];
  const aOwnedSet = new Set(a.ownedFiles);
  const bOwnedSet = new Set(b.ownedFiles);

  // Check ownedFiles intersection
  for (const file of a.ownedFiles) {
    if (bOwnedSet.has(file)) {
      reasons.push(`file overlap: ${file}`);
    }
  }

  // Check a owns and b reads
  const bReadsSet = new Set(b.reads);
  for (const file of a.ownedFiles) {
    if (bReadsSet.has(file)) {
      reasons.push(`write/read overlap: ${file}`);
    }
  }

  // Check b owns and a reads
  const aReadsSet = new Set(a.reads);
  for (const file of b.ownedFiles) {
    if (aReadsSet.has(file)) {
      reasons.push(`write/read overlap: ${file}`);
    }
  }

  // Check tokens intersection
  const aTokensSet = new Set(a.tokens);
  const bTokensSet = new Set(b.tokens);
  for (const token of a.tokens) {
    if (bTokensSet.has(token)) {
      reasons.push(`shared design tokens: ${token}`);
    }
  }

  // Check rules intersection
  const aRulesSet = new Set(a.rules);
  const bRulesSet = new Set(b.rules);
  for (const rule of a.rules) {
    if (bRulesSet.has(rule)) {
      reasons.push(`shared business rule: ${rule}`);
    }
  }

  // Check dependencies
  const aDependsSet = new Set(a.dependsOn);
  const bDependsSet = new Set(b.dependsOn);

  if (aDependsSet.has(b.id)) {
    reasons.push(`dependency order: ${b.id} -> ${a.id}`);
  }
  if (bDependsSet.has(a.id)) {
    reasons.push(`dependency order: ${a.id} -> ${b.id}`);
  }

  const verdict: Verdict = reasons.length > 0 ? "shared-dependency" : "parallel-safe";
  return { a: a.id, b: b.id, verdict, reasons };
}

/**
 * Plan parallel execution of work units, respecting dependencies and concurrency limits.
 * Groups units greedily into batches where all pairs are parallel-safe.
 * Respects maxConcurrency and dependency ordering.
 */
export function planParallelism(
  units: readonly WorkUnit[],
  opts?: { readonly maxConcurrency?: number }
): ParallelPlan {
  const maxConcurrency = opts?.maxConcurrency ?? Number.MAX_SAFE_INTEGER;

  // Generate all pairs
  const pairs: PairAssessment[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      pairs.push(assessPair(units[i]!, units[j]!));
    }
  }

  // Build conflict graph
  const unitIds = units.map((u) => u.id);
  const unitIndex = new Map(unitIds.map((id, i) => [id, i]));
  const conflicts = new Map<string, Set<string>>();
  for (const unit of units) {
    conflicts.set(unit.id, new Set());
  }

  for (const pair of pairs) {
    if (pair.verdict === "shared-dependency") {
      conflicts.get(pair.a)!.add(pair.b);
      conflicts.get(pair.b)!.add(pair.a);
    }
  }

  // Greedy grouping respecting dependencies and conflicts
  const groups: (readonly string[])[] = [];
  const placed = new Set<string>();
  const unitsByIndex = units.map((u) => u.id);

  for (const unit of units) {
    if (placed.has(unit.id)) continue;

    // Check if unmet dependencies exist
    const unmetDeps = unit.dependsOn.filter((depId) => !placed.has(depId));
    if (unmetDeps.length > 0) {
      // This unit must go in a later group
      continue;
    }

    // Start a new group with this unit
    const group: string[] = [unit.id];
    placed.add(unit.id);

    // Greedily add compatible units
    for (const otherUnit of units) {
      if (placed.has(otherUnit.id)) continue;
      if (group.length >= maxConcurrency) break;

      // Check if this unit has unmet dependencies
      const unmet = otherUnit.dependsOn.filter((depId) => !placed.has(depId));
      if (unmet.length > 0) continue;

      // Check if compatible with all in group
      let compatible = true;
      for (const existing of group) {
        if (conflicts.get(existing)!.has(otherUnit.id)) {
          compatible = false;
          break;
        }
      }

      if (compatible) {
        group.push(otherUnit.id);
        placed.add(otherUnit.id);
      }
    }

    groups.push(group);
  }

  // Collect unplaced units for a final group
  const unplaced: string[] = [];
  for (const unit of units) {
    if (!placed.has(unit.id)) {
      unplaced.push(unit.id);
    }
  }

  // Add remaining units in dependency order
  while (unplaced.length > 0) {
    const group: string[] = [];
    let addedAny = false;

    for (let i = unplaced.length - 1; i >= 0; i--) {
      const unitId = unplaced[i]!;
      const unit = units[unitIndex.get(unitId)!]!;

      // Check if dependencies are met
      const unmetDeps = unit.dependsOn.filter((depId) => !placed.has(depId));
      if (unmetDeps.length > 0) continue;

      // Check compatibility with group
      let compatible = true;
      for (const existing of group) {
        if (conflicts.get(existing)!.has(unitId)) {
          compatible = false;
          break;
        }
      }

      if (compatible && group.length < maxConcurrency) {
        group.push(unitId);
        placed.add(unitId);
        unplaced.splice(i, 1);
        addedAny = true;
      }
    }

    if (group.length > 0) {
      groups.push(group);
    }

    if (!addedAny && unplaced.length > 0) {
      // Circular dependency or impossible constraint; just add the next one
      const unitId = unplaced.shift()!;
      groups.push([unitId]);
      placed.add(unitId);
    }
  }

  // Collect shared resources
  const architectOwnedSet = new Set<string>();
  for (const pair of pairs) {
    if (pair.verdict === "shared-dependency") {
      for (const reason of pair.reasons) {
        if (reason.includes("file overlap:")) {
          const file = reason.replace("file overlap: ", "");
          architectOwnedSet.add(`file:${file}`);
        } else if (reason.includes("write/read overlap:")) {
          const file = reason.replace("write/read overlap: ", "");
          architectOwnedSet.add(`file:${file}`);
        } else if (reason.includes("shared design tokens:")) {
          const token = reason.replace("shared design tokens: ", "");
          architectOwnedSet.add(`token:${token}`);
        } else if (reason.includes("shared business rule:")) {
          const rule = reason.replace("shared business rule: ", "");
          architectOwnedSet.add(`rule:${rule}`);
        }
      }
    }
  }

  const architectOwned = Array.from(architectOwnedSet).sort();

  // Sequential: units with conflicts
  const sequentialSet = new Set<string>();
  for (const [id, conflictSet] of conflicts) {
    if (conflictSet.size > 0) {
      sequentialSet.add(id);
    }
  }
  const sequential = Array.from(sequentialSet).sort();

  const mergeSurface = pairs.filter((p) => p.verdict === "shared-dependency").length;
  const recommendation =
    mergeSurface === 0
      ? "Parallel-safe"
      : "Shared dependency — keep sequential / architect-owned";

  return {
    pairs,
    groups: groups.map((g) => Object.freeze(g)),
    architectOwned,
    sequential,
    recommendation,
    mergeSurface,
  };
}
