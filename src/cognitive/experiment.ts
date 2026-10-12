// Bounded candidate search as a Case affordance (not a mode). Rounds are immutable facts keyed by
// parent world, candidate world, criterion and method; the search never mutates the settled world
// and never settles. A round's result is decided against the frozen criterion's score, so changing
// the criterion starts a different comparison.
import type { CaseProjection } from "./case.ts";

export type RoundResult = "improved" | "neutral" | "regressed" | "invalid";
export type RoundDecision = "retain" | "discard" | "escalate";
export interface ExperimentRound {
  readonly roundId: string;
  readonly caseId: string;
  readonly parentWorldHash: string;
  readonly candidateWorldHash: string;
  readonly criterionHash: string;
  readonly methodHash: string;
  readonly sandboxId: string;
  readonly hypothesis: string;
  readonly operation: string;
  readonly result: RoundResult;
  readonly decision: RoundDecision;
  readonly score?: number;
  readonly residual?: string;
  readonly startedPosition: number;
  readonly completedPosition: number;
}

export interface SearchEligibility { readonly available: boolean; readonly why: readonly string[]; readonly blockedBy: readonly string[] }
export function searchEligibility(
  c: Pick<CaseProjection, "criterionHash" | "baseWorldHash">,
  env: { readonly candidateExecutionAvailable: boolean; readonly observerDiscriminates: boolean; readonly failuresDisposable: boolean; readonly roundsAffordable: number; readonly boundedScope: boolean },
): SearchEligibility {
  const blockedBy: string[] = [];
  if (!c.criterionHash) blockedBy.push("no frozen criterion");
  if (!c.baseWorldHash) blockedBy.push("no settled baseline");
  if (!env.candidateExecutionAvailable) blockedBy.push("no isolated candidate execution");
  if (!env.observerDiscriminates) blockedBy.push("no protected observer capable of discriminating improvement");
  if (!env.failuresDisposable) blockedBy.push("failed candidates are not disposable");
  if (env.roundsAffordable < 1) blockedBy.push("budget supports no rounds");
  if (!env.boundedScope) blockedBy.push("search scope is unbounded");
  return blockedBy.length === 0
    ? { available: true, blockedBy, why: ["criterion frozen", "candidate worlds isolated", "observer available", `budget supports ${env.roundsAffordable} rounds`, "failures disposable"] }
    : { available: false, why: [], blockedBy };
}

/** Result of one round against the best score so far (higher is better). `valid` is false on observer/execution failure or invariant violation. */
export function judgeRound(valid: boolean, score: number | undefined, best: number | undefined, epsilon = 0): { result: RoundResult; decision: RoundDecision } {
  if (!valid || score === undefined) return { result: "invalid", decision: "escalate" };
  if (best === undefined || score > best + epsilon) return { result: "improved", decision: "retain" };
  if (score < best - epsilon) return { result: "regressed", decision: "discard" };
  return { result: "neutral", decision: "discard" };
}

export interface SearchState { readonly bestRound?: ExperimentRound; readonly rounds: readonly ExperimentRound[]; readonly discarded: readonly string[] }
export function foldSearch(rounds: readonly ExperimentRound[]): SearchState {
  const ordered = [...rounds].sort((a, b) => a.completedPosition - b.completedPosition);
  let best: ExperimentRound | undefined;
  for (const r of ordered) if (r.decision === "retain" && (best === undefined || (r.score ?? -Infinity) > (best.score ?? -Infinity))) best = r;
  return { ...(best ? { bestRound: best } : {}), rounds: ordered, discarded: ordered.filter((r) => r.decision === "discard").map((r) => r.candidateWorldHash) };
}
