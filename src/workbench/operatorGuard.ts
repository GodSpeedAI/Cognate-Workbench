// Shared operator-only guard (capability-bundles tranche P, §1.6.iii/§1.6.iv of
// .agents/plans/capability-bundles/design.md). The refusal condition is
// `kind !== "user" || runId !== undefined`: a human decision is a client act — never a step
// inside a run, whatever principal the run carries. The kind-only checks this replaces missed
// the user-kind masquerade (a run inheriting its starter's user actor passed `kind === "user"`).
// Refusals inside runs record `authority.decision.recorded` (durable P evidence); client-path
// refusals throw without a run to record from — the P evidence matrix asserts the in-run rows.
import type { HandlerContext } from "@godspeedai/cognate-kernel-api";

export interface OperatorGuardContext {
  readonly actor: { readonly id: string; readonly kind: string };
  readonly runId?: string;
}

export function operatorOnlyRefusal(what: string, ctx: OperatorGuardContext): string {
  return `${what} is a human decision: only a direct operator may do this, not ${ctx.actor.kind} "${ctx.actor.id}"${ctx.runId ? ` inside run ${ctx.runId}` : ""}`;
}

/** Refuses unless the caller is a direct operator outside any run. `record` persists the
 *  durable refusal (`authority.decision.recorded`) when a recorder is wired; a recording
 *  failure never masks the refusal itself. */
export async function requireOperator(ctx: OperatorGuardContext, what: string, record?: (event: { readonly type: string; readonly payload: unknown }) => Promise<void> | void): Promise<void> {
  if (ctx.actor.kind === "user" && !ctx.runId) return;
  const reason = operatorOnlyRefusal(what, ctx);
  try {
    await record?.({
      type: "authority.decision.recorded",
      payload: {
        decisionId: `${ctx.runId ?? "client"}:${what}:${Date.now()}`,
        point: "operator-guard",
        actorId: ctx.actor.id,
        actorKind: ctx.actor.kind,
        capability: what,
        outcome: "refused",
        reasonCode: "operator-only",
        reason,
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      },
    });
  } catch {
    // Recording is best-effort around the refusal; the refusal itself is unconditional.
  }
  throw new Error(reason);
}
