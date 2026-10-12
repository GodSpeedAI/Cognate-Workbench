// Focus and attention for the workbench. Adapted from the operator's gs-term (src/focus/attention.ts, src/focus/focus.ts); re-implemented for workbench references, not vendored.

export type FocusKind = "task" | "workflow-node" | "evidence" | "capability" | "automation" | "file" | "session";

export interface FocusRef {
  readonly kind: FocusKind;
  readonly id: string;
  readonly workspaceId: string;
  readonly label: string;
}

export const ATTENTION_PRECEDENCE = ["explicit-selection", "keyboard-focus", "active-run", "pinned-focus", "workspace-fallback"] as const;
export type AttentionLevel = (typeof ATTENTION_PRECEDENCE)[number];

export interface HumanAttention {
  readonly workspaceId: string;
  readonly selection?: FocusRef;
  readonly keyboardFocus?: FocusRef;
  readonly activeRun?: FocusRef;
  readonly pinned: readonly FocusRef[];
}

export interface ResolvedAttention {
  readonly referent?: FocusRef;
  readonly level: AttentionLevel;
  readonly alternatives: readonly FocusRef[];
}

/**
 * Create a key for deduplication: `${workspaceId}:${kind}:${id}`
 */
export function refKey(r: FocusRef): string {
  return `${r.workspaceId}:${r.kind}:${r.id}`;
}

/**
 * Resolve the human's current attention by fixed precedence.
 * Returns the highest-precedence referent or "workspace-fallback" if none.
 * References from a different workspace are ignored (focus never leaks across workspaces).
 * Alternatives are the distinct (by refKey) candidates from all levels that exist, in precedence order, excluding the chosen referent.
 */
export function resolveAttention(a: HumanAttention): ResolvedAttention {
  const candidates: { level: AttentionLevel; ref?: FocusRef }[] = [
    { level: "explicit-selection", ref: a.selection },
    { level: "keyboard-focus", ref: a.keyboardFocus },
    { level: "active-run", ref: a.activeRun },
  ];

  // Collect all referent candidates (filter by workspace)
  const allCandidates: FocusRef[] = [];
  for (const c of candidates) {
    if (c.ref && c.ref.workspaceId === a.workspaceId) {
      allCandidates.push(c.ref);
    }
  }

  // Check pinned (already filtered by the fact they're in the array, but ensure workspace matches)
  for (const pinned of a.pinned) {
    if (pinned.workspaceId === a.workspaceId) {
      allCandidates.push(pinned);
    }
  }

  // Find first referent in precedence order
  for (const candidate of candidates) {
    if (candidate.ref && candidate.ref.workspaceId === a.workspaceId) {
      // Collect alternatives: all other distinct candidates from all levels
      const seen = new Set<string>();
      seen.add(refKey(candidate.ref));
      const alternatives: FocusRef[] = [];

      for (const c of candidates) {
        if (c.ref && c.ref.workspaceId === a.workspaceId) {
          const key = refKey(c.ref);
          if (!seen.has(key)) {
            alternatives.push(c.ref);
            seen.add(key);
          }
        }
      }

      for (const pinned of a.pinned) {
        if (pinned.workspaceId === a.workspaceId) {
          const key = refKey(pinned);
          if (!seen.has(key)) {
            alternatives.push(pinned);
            seen.add(key);
          }
        }
      }

      return {
        referent: candidate.ref,
        level: candidate.level,
        alternatives: alternatives as readonly FocusRef[],
      };
    }
  }

  // Check first pinned if no selection/keyboard/active
  if (a.pinned.length > 0) {
    const firstPinned = a.pinned.find((p) => p.workspaceId === a.workspaceId);
    if (firstPinned) {
      const seen = new Set<string>();
      seen.add(refKey(firstPinned));
      const alternatives: FocusRef[] = [];

      for (const candidate of candidates) {
        if (candidate.ref && candidate.ref.workspaceId === a.workspaceId) {
          const key = refKey(candidate.ref);
          if (!seen.has(key)) {
            alternatives.push(candidate.ref);
            seen.add(key);
          }
        }
      }

      for (const pinned of a.pinned) {
        if (pinned.workspaceId === a.workspaceId) {
          const key = refKey(pinned);
          if (!seen.has(key)) {
            alternatives.push(pinned);
            seen.add(key);
          }
        }
      }

      return {
        referent: firstPinned,
        level: "pinned-focus",
        alternatives: alternatives as readonly FocusRef[],
      };
    }
  }

  return {
    level: "workspace-fallback",
    alternatives: [] as readonly FocusRef[],
  };
}

export interface AttentionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly referent?: FocusRef;
  readonly alternatives: readonly FocusRef[];
  readonly level: AttentionLevel;
  readonly capturedAt: string;
}

/**
 * Capture and freeze the attention state. The snapshot is immutable (Object.freeze applied to it and its arrays).
 * Mutating the input attention after capture does not change the snapshot.
 */
export function captureSnapshot(id: string, a: HumanAttention, capturedAt: string): AttentionSnapshot {
  const resolved = resolveAttention(a);
  const snapshot: AttentionSnapshot = {
    id,
    workspaceId: a.workspaceId,
    referent: resolved.referent,
    alternatives: resolved.alternatives,
    level: resolved.level,
    capturedAt,
  };
  Object.freeze(snapshot.alternatives);
  Object.freeze(snapshot);
  return snapshot;
}

export const REFERENCE_WORDS: readonly string[] = ["this", "that", "here", "it", "these", "those", "the above", "this task", "this node", "this file", "this evidence"];

export interface ReferentResolution {
  readonly referenced: boolean;
  readonly referent?: FocusRef;
  readonly ambiguous: boolean;
  readonly alternatives: readonly FocusRef[];
}

/**
 * Resolve a contextual reference (e.g., "what is this?") against the frozen snapshot.
 * `referenced` is true when the lower-cased query contains a reference word as a WHOLE WORD.
 * `ambiguous` is true when referenced && referent exists && alternatives.length > 0 && level is not "explicit-selection".
 */
export function resolveReferent(query: string, snapshot: AttentionSnapshot): ReferentResolution {
  const lowered = query.toLowerCase();

  // Check for whole-word reference
  let referenced = false;
  for (const word of REFERENCE_WORDS) {
    const wordLower = word.toLowerCase();
    // Use word boundaries to match whole words only
    const pattern = new RegExp(`\\b${wordLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (pattern.test(lowered)) {
      referenced = true;
      break;
    }
  }

  if (!referenced) {
    return {
      referenced: false,
      referent: undefined,
      ambiguous: false,
      alternatives: [] as readonly FocusRef[],
    };
  }

  const ambiguous = snapshot.referent !== undefined && snapshot.alternatives.length > 0 && snapshot.level !== "explicit-selection";

  return {
    referenced: true,
    referent: snapshot.referent,
    ambiguous,
    alternatives: snapshot.alternatives,
  };
}

/**
 * Format the referent line for the agent.
 * Returns undefined if no referent.
 * Otherwise returns: `[focus: <kind> "<label>" (<id>), from <level words>]`
 * If alternatives exist, appends `; also in view: <kind> "<label>", ...` (max 3).
 */
export function referentLine(snapshot: AttentionSnapshot): string | undefined {
  if (!snapshot.referent) return undefined;

  const levelWords = snapshot.level
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => (w === "run" || w === "selection" ? w : w))
    .join(" ");

  const levelLabel =
    snapshot.level === "explicit-selection"
      ? "explicit selection"
      : snapshot.level === "keyboard-focus"
        ? "keyboard focus"
        : snapshot.level === "active-run"
          ? "active run"
          : snapshot.level === "pinned-focus"
            ? "pinned focus"
            : "workspace fallback";

  let line = `[focus: ${snapshot.referent.kind} "${snapshot.referent.label}" (${snapshot.referent.id}), from ${levelLabel}]`;

  if (snapshot.alternatives.length > 0) {
    const altCount = Math.min(3, snapshot.alternatives.length);
    const alts = snapshot.alternatives
      .slice(0, altCount)
      .map((r) => `${r.kind} "${r.label}"`)
      .join(", ");
    line += `; also in view: ${alts}`;
    if (snapshot.alternatives.length > 3) {
      line += `, ...`;
    }
  }

  return line;
}

/**
 * If snapshot has a referent AND resolveReferent says the message is referenced,
 * append the referent line to the message. Otherwise return the message unchanged.
 */
export function withReferent(message: string, snapshot: AttentionSnapshot | undefined): string {
  if (!snapshot) return message;

  const resolution = resolveReferent(message, snapshot);
  if (!resolution.referenced || !snapshot.referent) return message;

  const line = referentLine(snapshot);
  if (!line) return message;

  return `${message}\n\n${line}`;
}

/**
 * Describe a FocusRef in human-readable form.
 */
export function describeFocusRef(r: FocusRef): string {
  const kindLabel =
    r.kind === "task"
      ? "Task"
      : r.kind === "workflow-node"
        ? "Workflow node"
        : r.kind === "evidence"
          ? "Evidence"
          : r.kind === "capability"
            ? "Capability"
            : r.kind === "automation"
              ? "Automation"
              : r.kind === "file"
                ? "File"
                : r.kind === "session"
                  ? "Session"
                  : "Unknown";
  return `${kindLabel} "${r.label}"`;
}

export class FocusAuthorityError extends Error {
  override readonly name = "FocusAuthorityError";
}

export interface SharedFocus {
  readonly version: number;
  readonly primary?: FocusRef;
  readonly pinned: readonly FocusRef[];
}

/**
 * Create an empty SharedFocus with version 0.
 */
export function emptySharedFocus(): SharedFocus {
  return { version: 0, pinned: [] as readonly FocusRef[] };
}

export interface FocusCandidate {
  readonly id: string;
  readonly proposed: FocusRef;
  readonly reason: string;
  readonly evidenceToken: string;
  readonly sourceAgent: string;
  readonly status: "proposed" | "accepted" | "rejected";
  readonly resolvedBy?: string;
}

/**
 * Create a new proposed candidate.
 */
export function proposeCandidate(input: Omit<FocusCandidate, "status" | "resolvedBy">): FocusCandidate {
  return { ...input, status: "proposed" };
}

/**
 * Return false if an identical (same refKey AND same evidenceToken) candidate was already rejected.
 * A materially new evidenceToken is allowed.
 */
export function canPropose(candidate: Pick<FocusCandidate, "proposed" | "evidenceToken">, existing: readonly FocusCandidate[]): boolean {
  const key = refKey(candidate.proposed);
  for (const c of existing) {
    if (c.status === "rejected" && refKey(c.proposed) === key && c.evidenceToken === candidate.evidenceToken) {
      return false;
    }
  }
  return true;
}

/**
 * Accept a candidate (human only). Sets primary, increments version, marks candidate as accepted.
 * Throws FocusAuthorityError if actorKind is not "user".
 */
export function acceptCandidate(focus: SharedFocus, c: FocusCandidate, actorKind: string, resolvedBy: string): { focus: SharedFocus; candidate: FocusCandidate } {
  if (actorKind !== "user") {
    throw new FocusAuthorityError(`accept requires a person, not ${actorKind}`);
  }

  if (c.status !== "proposed") {
    throw new Error(`candidate status must be "proposed", not "${c.status}"`);
  }

  const nextFocus: SharedFocus = {
    version: focus.version + 1,
    primary: c.proposed,
    pinned: focus.pinned,
  };

  const nextCandidate: FocusCandidate = {
    ...c,
    status: "accepted",
    resolvedBy,
  };

  return { focus: nextFocus, candidate: nextCandidate };
}

/**
 * Reject a candidate (human only). Marks candidate as rejected.
 * Throws FocusAuthorityError if actorKind is not "user".
 */
export function rejectCandidate(c: FocusCandidate, actorKind: string, resolvedBy: string): FocusCandidate {
  if (actorKind !== "user") {
    throw new FocusAuthorityError(`reject requires a person, not ${actorKind}`);
  }

  return {
    ...c,
    status: "rejected",
    resolvedBy,
  };
}

/**
 * Pin a FocusRef (human only). Dedupes by refKey. Increments version only if it changed.
 * Throws FocusAuthorityError if actorKind is not "user".
 */
export function pinFocus(focus: SharedFocus, ref: FocusRef, actorKind: string): SharedFocus {
  if (actorKind !== "user") {
    throw new FocusAuthorityError(`pin requires a person, not ${actorKind}`);
  }

  const key = refKey(ref);
  const isDuplicate = focus.pinned.some((p) => refKey(p) === key);
  if (isDuplicate) {
    return focus;
  }

  return {
    ...focus,
    version: focus.version + 1,
    pinned: [...focus.pinned, ref],
  };
}

/**
 * Unpin a FocusRef (human only). Increments version only if it changed.
 * Throws FocusAuthorityError if actorKind is not "user".
 */
export function unpinFocus(focus: SharedFocus, ref: FocusRef, actorKind: string): SharedFocus {
  if (actorKind !== "user") {
    throw new FocusAuthorityError(`unpin requires a person, not ${actorKind}`);
  }

  const key = refKey(ref);
  const newPinned = focus.pinned.filter((p) => refKey(p) !== key);

  if (newPinned.length === focus.pinned.length) {
    return focus;
  }

  return {
    ...focus,
    version: focus.version + 1,
    pinned: newPinned,
  };
}

/**
 * Clear all focus (human only). Drops primary and pins. Increments version only if anything was dropped.
 * Throws FocusAuthorityError if actorKind is not "user".
 */
export function clearFocus(focus: SharedFocus, actorKind: string): SharedFocus {
  if (actorKind !== "user") {
    throw new FocusAuthorityError(`clear requires a person, not ${actorKind}`);
  }

  const changed = focus.primary !== undefined || focus.pinned.length > 0;

  if (!changed) {
    return focus;
  }

  return {
    version: focus.version + 1,
    primary: undefined,
    pinned: [] as readonly FocusRef[],
  };
}
