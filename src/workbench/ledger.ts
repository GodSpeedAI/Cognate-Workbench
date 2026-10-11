import type {
  AcceptanceCriterion,
  AcceptanceKind,
  EvidenceEntry,
  EvidenceKind,
  WorkerReturn,
  DoneLevel,
} from "./types.ts";

// ---- Ledger Row & Row Lists -----------------------------------------------------------------------

export interface LedgerRow {
  readonly criterionId: string;
  readonly kind: AcceptanceKind;
  readonly description: string;
  readonly required: boolean;
  readonly state: "closed" | "failed" | "open";
  readonly entryIds: readonly string[];
}

/**
 * One row per criterion in order.
 * - closed: >=1 entry with status "pass" and NO entry for it with status "fail" that comes later
 * - failed: any fail with no later pass (a later fail reopens)
 * - open: only pending entries or no entries at all
 */
export function ledgerRows(
  acceptance: readonly AcceptanceCriterion[],
  entries: readonly EvidenceEntry[]
): LedgerRow[] {
  return acceptance.map((criterion) => {
    const criterionEntries = entries.filter((e) => e.criterionId === criterion.id);
    const entryIds = criterionEntries.map((e) => e.id);

    let state: "closed" | "failed" | "open" = "open";

    if (criterionEntries.length > 0) {
      // Find last pass and last fail indices
      let lastPassIdx = -1;
      let lastFailIdx = -1;

      for (let i = 0; i < criterionEntries.length; i++) {
        if (criterionEntries[i]!.status === "pass") {
          lastPassIdx = i;
        } else if (criterionEntries[i]!.status === "fail") {
          lastFailIdx = i;
        }
      }

      // State logic: later fail reopens (changes from closed to failed)
      if (lastPassIdx >= 0 && lastFailIdx >= 0) {
        // Both pass and fail exist; compare positions
        state = lastFailIdx > lastPassIdx ? "failed" : "closed";
      } else if (lastPassIdx >= 0) {
        // Only pass, no fail
        state = "closed";
      } else if (lastFailIdx >= 0) {
        // Only fail, no pass
        state = "failed";
      } else {
        // No pass or fail, only pending
        state = "open";
      }
    }

    return {
      criterionId: criterion.id,
      kind: criterion.kind,
      description: criterion.description,
      required: criterion.required,
      state,
      entryIds,
    };
  });
}

/**
 * Required rows that are not closed.
 */
export function openRequired(rows: readonly LedgerRow[]): LedgerRow[] {
  return rows.filter((r) => r.required && r.state !== "closed");
}

// ---- Ledger Grouping ------------------------------------------------------------------------------

export interface LedgerGroup {
  readonly group: "Domain" | "Implementation" | "Tests" | "Runtime" | "Quality" | "Review";
  readonly marks: readonly { readonly entryId: string; readonly mark: "✓" | "✗" | "○"; readonly text: string }[];
}

/**
 * Groups entries by kind: domain->Domain, implementation->Implementation,
 * test|independent-check|integrity->Tests, journey|runtime->Runtime,
 * audit|quality->Quality, human->Review.
 * pass ✓, fail ✗, pending ○.
 * Omit empty groups, fixed group order as listed.
 */
export function groupLedger(entries: readonly EvidenceEntry[]): LedgerGroup[] {
  type GroupKey = "Domain" | "Implementation" | "Tests" | "Runtime" | "Quality" | "Review";

  const kindToGroup: Record<EvidenceKind, GroupKey> = {
    domain: "Domain",
    implementation: "Implementation",
    test: "Tests",
    "independent-check": "Tests",
    integrity: "Tests",
    journey: "Runtime",
    runtime: "Runtime",
    audit: "Quality",
    quality: "Quality",
    human: "Review",
  };

  const groups: Record<GroupKey, { readonly entryId: string; readonly mark: "✓" | "✗" | "○"; readonly text: string }[]> = {
    Domain: [],
    Implementation: [],
    Tests: [],
    Runtime: [],
    Quality: [],
    Review: [],
  };

  for (const entry of entries) {
    const groupKey = kindToGroup[entry.kind];
    const mark: "✓" | "✗" | "○" =
      entry.status === "pass" ? "✓" : entry.status === "fail" ? "✗" : "○";

    groups[groupKey].push({
      entryId: entry.id,
      mark,
      text: entry.summary,
    });
  }

  const groupOrder: GroupKey[] = ["Domain", "Implementation", "Tests", "Runtime", "Quality", "Review"];
  const result: LedgerGroup[] = [];

  for (const groupKey of groupOrder) {
    if (groups[groupKey].length > 0) {
      result.push({
        group: groupKey,
        marks: groups[groupKey],
      });
    }
  }

  return result;
}

// ---- Readiness Gates (V-008 + V-009) ---------------------------------------------------------------

export interface Readiness {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

/**
 * V-008 + V-009 Review readiness gate.
 * Blockers (stable wording):
 * - if workerReturn missing: "worker return contract missing"
 * - changed empty: "changed files not reported"
 * - tested empty: "tests not reported"
 * - evidence empty: "evidence not attached"
 * - remaining not declared: "remaining work not declared" (if not an array)
 * - workerReturn.readyForReview false: "worker did not declare ready for review"
 * - each open required non-"human" criterion: "criterion <id> (<kind>) not closed"
 * - V-009: if required independent-check is open while all required tests are closed:
 *   "independent check required but tests alone passed"
 * - each evidence id referenced in workerReturn.evidence must exist: "evidence <id> not found in ledger"
 *
 * Human criterion is NOT a blocker for readiness (it's the review itself).
 * ready iff blockers empty.
 */
export function reviewReadiness(input: {
  readonly acceptance: readonly AcceptanceCriterion[];
  readonly entries: readonly EvidenceEntry[];
  readonly workerReturn?: WorkerReturn;
}): Readiness {
  const blockers: string[] = [];
  const { acceptance, entries, workerReturn } = input;

  // Check worker return contract
  if (!workerReturn) {
    blockers.push("worker return contract missing");
    return { ready: false, blockers };
  }

  // Check changed, tested, evidence
  if (workerReturn.changed.length === 0) {
    blockers.push("changed files not reported");
  }
  if (workerReturn.tested.length === 0) {
    blockers.push("tests not reported");
  }
  if (workerReturn.evidence.length === 0) {
    blockers.push("evidence not attached");
  }

  // Check remaining is declared (array)
  if (!Array.isArray(workerReturn.remaining)) {
    blockers.push("remaining work not declared");
  }

  // Check readyForReview
  if (!workerReturn.readyForReview) {
    blockers.push("worker did not declare ready for review");
  }

  // Check evidence exists in ledger
  const entryIds = new Set(entries.map((e) => e.id));
  for (const eId of workerReturn.evidence) {
    if (!entryIds.has(eId)) {
      blockers.push(`evidence ${eId} not found in ledger`);
    }
  }

  // Build ledger rows
  const rows = ledgerRows(acceptance, entries);

  // Check open required criteria (excluding human)
  const openReqNonHuman = rows.filter((r) => r.required && r.state !== "closed" && r.kind !== "human");
  for (const row of openReqNonHuman) {
    blockers.push(`criterion ${row.criterionId} (${row.kind}) not closed`);
  }

  // V-009: if required independent-check is open AND all required tests are closed
  const reqIndependentChecks = rows.filter(
    (r) => r.required && r.kind === "independent-check"
  );
  const reqTests = rows.filter((r) => r.required && r.kind === "test");
  const allReqTestsClosed = reqTests.length > 0 && reqTests.every((r) => r.state === "closed");
  const anyReqIndependentCheckOpen = reqIndependentChecks.some((r) => r.state !== "closed");

  if (anyReqIndependentCheckOpen && allReqTestsClosed) {
    blockers.push("independent check required but tests alone passed");
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

/**
 * Ready for ACCEPTED: all required criteria closed (human criterion closed by humanApproved===true OR a passing human entry).
 */
export function acceptanceReady(input: {
  readonly acceptance: readonly AcceptanceCriterion[];
  readonly entries: readonly EvidenceEntry[];
  readonly humanApproved: boolean;
}): Readiness {
  const blockers: string[] = [];
  const { acceptance, entries, humanApproved } = input;

  const rows = ledgerRows(acceptance, entries);

  for (const row of rows) {
    if (!row.required) continue;

    if (row.kind === "human") {
      // Human criterion closed by humanApproved or a passing human entry
      const hasPassingHumanEntry = row.entryIds.some((id) => {
        const entry = entries.find((e) => e.id === id);
        return entry && entry.status === "pass";
      });

      if (!humanApproved && !hasPassingHumanEntry) {
        blockers.push(`criterion ${row.criterionId} (human) not closed`);
      }
    } else {
      // Non-human: must be closed
      if (row.state !== "closed") {
        blockers.push(`criterion ${row.criterionId} (${row.kind}) not closed`);
      }
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

// ---- Done Taxonomy (§24) -----------------------------------------------------------------------

/**
 * Highest satisfied level in order: not-started < finished < produced < tested < ready-for-review < accepted < operationalized
 * Each level requires the previous.
 * Contiguity matters: if accepted=true but ready-for-review readiness is not satisfied, cap at "tested".
 */
export function doneLevel(input: {
  readonly finished: boolean;
  readonly produced: boolean;
  readonly readiness: Readiness | undefined;
  readonly testedClosed: boolean;
  readonly accepted: boolean;
  readonly operationalized: boolean;
}): DoneLevel {
  const { finished, produced, readiness, testedClosed, accepted, operationalized } = input;

  // Build levels in order
  const levels: DoneLevel[] = [
    "not-started",
    "finished",
    "produced",
    "tested",
    "ready-for-review",
    "accepted",
    "operationalized",
  ];

  // Check contiguous satisfaction
  let maxLevel: DoneLevel = "not-started";

  // finished
  if (finished) {
    maxLevel = "finished";
  } else {
    return maxLevel;
  }

  // produced
  if (produced) {
    maxLevel = "produced";
  } else {
    return maxLevel;
  }

  // tested (requires testedClosed)
  if (testedClosed) {
    maxLevel = "tested";
  } else {
    return maxLevel;
  }

  // ready-for-review (requires readiness to be satisfied)
  if (readiness && readiness.ready) {
    maxLevel = "ready-for-review";
  } else {
    return maxLevel;
  }

  // accepted (requires accepted===true)
  if (accepted) {
    maxLevel = "accepted";
  } else {
    return maxLevel;
  }

  // operationalized
  if (operationalized) {
    maxLevel = "operationalized";
  } else {
    return maxLevel;
  }

  return maxLevel;
}

// ---- Artifact Verification -----------------------------------------------------------------------

export type ArtifactVerification = "verified" | "unverified";

/**
 * "verified" only if evidenceIds non-empty and every id exists with status "pass".
 * An artifact without acceptance evidence is "unverified".
 */
export function artifactVerification(evidenceIds: readonly string[], entries: readonly EvidenceEntry[]): ArtifactVerification {
  if (evidenceIds.length === 0) {
    return "unverified";
  }

  const entryMap = new Map(entries.map((e) => [e.id, e]));

  for (const id of evidenceIds) {
    const entry = entryMap.get(id);
    if (!entry || entry.status !== "pass") {
      return "unverified";
    }
  }

  return "verified";
}

// ---- Evidence Closure -----------------------------------------------------------------------

/**
 * Distinct kinds with at least one pass entry, in first-seen order.
 */
export function evidenceClosureForTask(entries: readonly EvidenceEntry[]): readonly EvidenceKind[] {
  const kinds: EvidenceKind[] = [];
  const seen = new Set<EvidenceKind>();

  for (const entry of entries) {
    if (entry.status === "pass" && !seen.has(entry.kind)) {
      kinds.push(entry.kind);
      seen.add(entry.kind);
    }
  }

  return kinds;
}
