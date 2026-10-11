// Method review. The outer observer may read rounds and produce evidence-bearing recommendations.
// It has no write path to the active method, criterion, spec or AGENTS.md: observe != recommend !=
// decide != settle, and repeated evidence is not write authority. Only an explicit human decision
// moves the active methodHash.
import { hashOf } from "./canonical.ts";
import type { ExperimentRound } from "./experiment.ts";

export interface MethodRecommendation {
  readonly id: string;
  readonly status: "candidate";
  readonly active: false;
  readonly observedResidual: string;
  readonly supporting: readonly string[];
  readonly contradicting: readonly string[];
  readonly scope: string;
  readonly candidateChange: string;
  readonly expectedEffect: string;
}

export function recommendFromRounds(rounds: readonly ExperimentRound[], opts: { readonly minSupport?: number; readonly scope: string; readonly candidateChangeFor: (residual: string) => { change: string; effect: string } }): readonly MethodRecommendation[] {
  const min = opts.minSupport ?? 2;
  const residuals = [...new Set(rounds.map((r) => r.residual).filter((r): r is string => !!r))].sort();
  const out: MethodRecommendation[] = [];
  for (const residual of residuals) {
    const supporting = rounds.filter((r) => r.residual === residual).map((r) => r.roundId);
    if (supporting.length < min) continue;
    const contradicting = rounds.filter((r) => r.residual !== residual && r.decision !== "escalate").map((r) => r.roundId);
    const { change, effect } = opts.candidateChangeFor(residual);
    out.push({ id: `rec-${hashOf({ residual, supporting }).slice(0, 12)}`, status: "candidate", active: false, observedResidual: residual, supporting, contradicting, scope: opts.scope, candidateChange: change, expectedEffect: effect });
  }
  return out;
}

export interface MethodState { readonly activeMethodHash: string; readonly history: readonly { readonly methodHash: string; readonly acceptedBy: string; readonly recommendationId: string }[] }

/** Recommending leaves the registry untouched by construction (pure). */
export function acceptMethod(state: MethodState, rec: MethodRecommendation, nextMethod: unknown, authority: { readonly actorId: string; readonly kind: string }): MethodState {
  if (authority.kind !== "user") throw new Error("method promotion requires explicit human authority");
  const methodHash = hashOf(nextMethod);
  return { activeMethodHash: methodHash, history: [...state.history, { methodHash, acceptedBy: authority.actorId, recommendationId: rec.id }] };
}

const PROTECTED = [/(^|\/)AGENTS\.md$/i, /(^|\/)\.agents\/specs\//, /criterion/i, /active-method/i];
/** The outer observer's write guard: it may never write these through its own authority. */
export function observerMayWrite(target: string): boolean {
  return !PROTECTED.some((re) => re.test(target));
}
