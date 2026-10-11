// CaseProjection: the bounded representation of what presently matters relative to a desired
// difference. It is derived from durable events on every call — no store, no authority of its own.
// It also derives Reality: only recorded system facts, never agent language.
import { foldLineage, type LineageEvent, WORLD_EVENTS } from "./world.ts";
import { observe, criterionIntact, type CheckResult, type FrozenCriterion, type Observation } from "./criterion.ts";
import { resolveAffordances, type AffordanceField, type Facts, type PossibleOperation } from "./affordance.ts";

export interface CaseEvent extends LineageEvent {}

export const CASE_EVENTS = {
  opened: "case.opened",
  criterion: "criterion.frozen",
  verification: "verification.observed",
  finding: "sentinel.finding",
  approval: "tool.approval.decided",
} as const;

/** Event types Reality is allowed to read. Narrative events (assistant text, plans) are absent on purpose. */
const REALITY_SOURCES = new Set<string>([
  "tool.call.completed", "tool.call.failed", "tool.approval.requested", "tool.approval.decided",
  CASE_EVENTS.verification, CASE_EVENTS.finding, ...Object.values(WORLD_EVENTS),
]);

export interface RealityFact { readonly position: number; readonly eventType: string; readonly summary: string }
export function reality(events: readonly CaseEvent[]): readonly RealityFact[] {
  return [...events].filter((e) => REALITY_SOURCES.has(e.eventType)).sort((a, b) => a.position - b.position).map((e) => ({ position: e.position, eventType: e.eventType, summary: summarize(e) }));
}
function summarize(e: CaseEvent): string {
  const p = e.payload as Record<string, any>;
  if (e.eventType === CASE_EVENTS.verification) return `${p.checkId}: ${p.passed ? "passed" : "failed"}`;
  if (e.eventType === "tool.call.completed") return `${p.tool} completed`;
  if (e.eventType === "tool.call.failed") return `${p.tool} failed`;
  return e.eventType;
}
/** What Reality records about a check: only a durable verification event can establish it. */
export function realityOfCheck(events: readonly CaseEvent[], checkId: string): "passed" | "failed" | "not-established" {
  const last = [...events].filter((e) => e.eventType === CASE_EVENTS.verification && (e.payload as any).checkId === checkId).sort((a, b) => a.position - b.position).pop();
  return last ? ((last.payload as any).passed ? "passed" : "failed") : "not-established";
}

export interface SettlementCondition { readonly id: string; readonly label: string; readonly satisfied: boolean }
export interface OptionalAffordance { readonly id: string; readonly label: string; readonly payment?: string }
export interface CaseProjection {
  readonly caseId: string;
  readonly desiredOutcome: string;
  readonly baseWorldHash?: string;
  readonly candidateWorldHash?: string;
  readonly currentState: "no-baseline" | "baseline" | "candidate" | "settled";
  readonly criterionHash?: string;
  readonly observation?: Observation;
  readonly materialDeviation?: string;
  readonly unknowns: readonly string[];
  readonly evidencePositions: readonly number[];
  readonly field: AffordanceField;
  readonly settlementConditions: readonly SettlementCondition[];
  /** All mandatory closure conditions hold. Says nothing about whether to settle now. */
  readonly settlementReachable: boolean;
  readonly optionalRemaining: readonly OptionalAffordance[];
}

export interface CaseContext {
  readonly operations: readonly PossibleOperation[];
  readonly facts: Omit<Facts, "holds">;
  readonly optional?: readonly OptionalAffordance[];
}

export function deriveCase(caseId: string, events: readonly CaseEvent[], ctx: CaseContext): CaseProjection {
  const mine = events.filter((e) => (e.payload as any).caseId === undefined || (e.payload as any).caseId === caseId);
  const lineage = foldLineage(mine);
  const opened = mine.find((e) => e.eventType === CASE_EVENTS.opened);
  const crit = [...mine].reverse().find((e) => e.eventType === CASE_EVENTS.criterion)?.payload.criterion as FrozenCriterion | undefined;
  const candidates = [...lineage.worlds.values()].filter((w) => w.status === "candidate" && !lineage.rejected.has(w.worldHash) && w.parentWorldHash === lineage.settledHead);
  const candidate = candidates.sort((a, b) => b.createdPosition - a.createdPosition)[0];
  const justSettled = [...lineage.worlds.values()].find((w) => w.settledFromCandidate && w.worldHash === lineage.settledHead);

  const subject = candidate?.worldHash;
  const results: CheckResult[] = mine
    .filter((e) => e.eventType === CASE_EVENTS.verification && (e.payload as any).candidateHash === subject)
    .map((e) => ({ checkId: String(e.payload.checkId), passed: e.payload.passed === true, criterionHash: String(e.payload.criterionHash) }));
  const intact = crit ? criterionIntact(crit) : false;
  const observation = crit && intact ? observe(crit, results) : undefined;

  const holds = new Set<string>();
  if (lineage.settledHead) holds.add("baseline.frozen");
  if (crit && intact) holds.add("criterion.frozen");
  if (candidate) holds.add("candidate.exists");
  if (observation && observation.total > 0 && observation.missing.length < observation.total) holds.add("verification.ran");
  if (observation?.allRequiredPassed) holds.add("verification.passed");
  if (observation && !observation.allRequiredPassed && observation.failed.length > 0) holds.add("verification.failed");
  if (mine.some((e) => e.eventType === CASE_EVENTS.approval && (e.payload as any).approved === true)) holds.add("human.approved");

  const field = resolveAffordances(ctx.operations, { ...ctx.facts, holds });

  const conditions: SettlementCondition[] = [
    { id: "baseline", label: "settled baseline frozen", satisfied: !!lineage.settledHead },
    { id: "criterion", label: "criterion frozen and intact", satisfied: !!crit && intact },
    { id: "candidate", label: "candidate world frozen", satisfied: !!candidate },
    { id: "checks", label: observation ? `${observation.passed}/${observation.total} required checks passed` : "required checks passed", satisfied: observation?.allRequiredPassed === true },
    { id: "coverage", label: "no unobserved consequence", satisfied: !!crit && crit.unobserved.length === 0 },
  ];
  const settlementReachable = conditions.every((c) => c.satisfied);

  let materialDeviation: string | undefined;
  if (observation?.failed.length) materialDeviation = `${observation.failed.length} required check${observation.failed.length > 1 ? "s" : ""} failed: ${observation.failed.join(", ")}`;
  else if (observation?.missing.length && candidate) materialDeviation = `${observation.missing.length} required check${observation.missing.length > 1 ? "s" : ""} not yet observed`;
  else if (crit && crit.unobserved.length > 0) materialDeviation = `observer gap: ${crit.unobserved.join(", ")} unobserved`;

  return {
    caseId,
    desiredOutcome: String(opened?.payload.desiredOutcome ?? ""),
    ...(lineage.settledHead ? { baseWorldHash: candidate?.parentWorldHash ?? lineage.settledHead } : {}),
    ...(candidate ? { candidateWorldHash: candidate.worldHash } : {}),
    currentState: justSettled && !candidate ? "settled" : candidate ? "candidate" : lineage.settledHead ? "baseline" : "no-baseline",
    ...(crit ? { criterionHash: crit.criterionHash } : {}),
    ...(observation ? { observation } : {}),
    ...(materialDeviation ? { materialDeviation } : {}),
    unknowns: (opened?.payload.unknowns as string[] | undefined) ?? [],
    evidencePositions: mine.filter((e) => e.eventType === CASE_EVENTS.verification).map((e) => e.position),
    field,
    settlementConditions: conditions,
    settlementReachable,
    optionalRemaining: ctx.optional ?? [],
  };
}
