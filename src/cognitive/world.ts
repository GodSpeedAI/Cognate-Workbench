// World identity and lineage.
//
// worldHash = SHA-256(canonical consequential manifest). The manifest holds only state that changes
// what the world *is*: the workspace content digest map, the repo SHA (evidence, not identity), the
// semantic model / policy / environment hashes, and the criterion / method in force. Origin case,
// origin run, parent, status and timestamps are lineage metadata: they ride on events, never in the
// hash, so a candidate promoted to settled keeps the same worldHash (Sₙ₊₁ == the candidate it was).
import { hashOf } from "./canonical.ts";

export const MANIFEST_VERSION = 1;

export interface WorldManifest {
  readonly schemaVersion: typeof MANIFEST_VERSION;
  readonly repoSha?: string;
  /** path -> content hash for the consequential workspace files. */
  readonly files: Readonly<Record<string, string>>;
  readonly semanticModelHash: string;
  readonly policyHash: string;
  readonly environmentHash: string;
  readonly criterionHash?: string;
  readonly methodHash?: string;
}

export function worldManifest(input: Omit<WorldManifest, "schemaVersion">): WorldManifest {
  return { schemaVersion: MANIFEST_VERSION, ...input };
}

export function worldHash(manifest: WorldManifest): string {
  return hashOf(manifest);
}

// -- lineage (folded from durable events) -------------------------------------------------------
export interface LineageEvent {
  readonly position: number;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorldRecord {
  readonly worldHash: string;
  readonly parentWorldHash?: string;
  readonly status: "settled" | "candidate";
  readonly manifest?: WorldManifest;
  readonly originCase?: string;
  readonly originRun?: string;
  readonly sandboxId?: string;
  readonly createdPosition: number;
  readonly settledFromCandidate?: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly settledBy?: string;
}

export interface Lineage {
  readonly worlds: ReadonlyMap<string, WorldRecord>;
  /** The current settled world, i.e. the head every candidate must descend from. */
  readonly settledHead?: string;
  readonly rejected: ReadonlySet<string>;
}

export const WORLD_EVENTS = {
  baseline: "world.baseline.frozen",
  candidate: "world.candidate.frozen",
  settled: "world.settled",
  rejected: "world.candidate.rejected",
} as const;

/** Rebuildable read model: nothing here is stored, it is always a fold of the event log. */
export function foldLineage(events: readonly LineageEvent[]): Lineage {
  const worlds = new Map<string, WorldRecord>();
  const rejected = new Set<string>();
  let head: string | undefined;
  for (const e of [...events].sort((a, b) => a.position - b.position)) {
    const p = e.payload as Record<string, any>;
    if (e.eventType === WORLD_EVENTS.baseline) {
      if (!worlds.has(p.worldHash)) {
        worlds.set(p.worldHash, { worldHash: p.worldHash, status: "settled", manifest: p.manifest, originCase: p.caseId, originRun: p.runId, createdPosition: e.position });
      }
      head = p.worldHash;
    } else if (e.eventType === WORLD_EVENTS.candidate) {
      // A candidate never replaces an existing record: identical content keeps its first identity.
      if (!worlds.has(p.candidateHash)) {
        worlds.set(p.candidateHash, { worldHash: p.candidateHash, parentWorldHash: p.parentWorldHash, status: "candidate", manifest: p.manifest, originCase: p.caseId, originRun: p.runId, sandboxId: p.sandboxId, createdPosition: e.position });
      }
    } else if (e.eventType === WORLD_EVENTS.rejected) {
      rejected.add(p.candidateHash);
    } else if (e.eventType === WORLD_EVENTS.settled) {
      const prior = worlds.get(p.worldHash);
      if (prior?.status === "candidate") {
        worlds.set(p.worldHash, { ...prior, status: "settled", settledFromCandidate: true, evidenceRefs: p.evidenceRefs, settledBy: p.authority?.actorId });
        head = p.worldHash;
      }
    }
  }
  return { worlds, ...(head ? { settledHead: head } : {}), rejected };
}

export interface PromotionRequest {
  readonly candidateHash: string;
  readonly authority: { readonly actorId: string; readonly kind: string };
  readonly evidenceRefs: readonly string[];
  /** Whether the Case's mandatory settlement conditions currently hold (derived, never asserted by the executor). */
  readonly settlementReachable: boolean;
}

export type PromotionDecision = { readonly ok: true } | { readonly ok: false; readonly reason: "unknown-candidate" | "rejected" | "stale-parent" | "not-human-authority" | "no-evidence" | "settlement-not-reachable" };

/** Execution produces candidates; only this check lets one become settled. */
export function checkPromotion(lineage: Lineage, req: PromotionRequest): PromotionDecision {
  const record = lineage.worlds.get(req.candidateHash);
  if (!record || record.status !== "candidate") return { ok: false, reason: "unknown-candidate" };
  if (lineage.rejected.has(req.candidateHash)) return { ok: false, reason: "rejected" };
  if (record.parentWorldHash !== lineage.settledHead) return { ok: false, reason: "stale-parent" };
  if (req.authority.kind !== "user") return { ok: false, reason: "not-human-authority" };
  if (req.evidenceRefs.length === 0) return { ok: false, reason: "no-evidence" };
  if (!req.settlementReachable) return { ok: false, reason: "settlement-not-reachable" };
  return { ok: true };
}

/** What differs between two manifests (the `compare` surface's data). */
export function diffManifests(a: WorldManifest, b: WorldManifest): readonly { readonly key: string; readonly before?: string; readonly after?: string }[] {
  const out: { key: string; before?: string; after?: string }[] = [];
  const scalar = ["repoSha", "semanticModelHash", "policyHash", "environmentHash", "criterionHash", "methodHash"] as const;
  for (const k of scalar) if (a[k] !== b[k]) out.push({ key: k, before: a[k], after: b[k] });
  const paths = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  for (const p of [...paths].sort()) if (a.files[p] !== b.files[p]) out.push({ key: `file:${p}`, before: a.files[p], after: b.files[p] });
  return out;
}
