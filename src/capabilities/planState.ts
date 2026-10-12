// `plan.state`: resolves a `sessionId` to its current `PlanState` via the `plans` projection — same
// shape as `workspace.path` (`workspacePath.ts`). `agent.coding` invokes this once per turn (`ctx.
// invoke`, so the read is recorded/replayable) to know whether the session is already in plan mode
// before deciding how to handle `exit_plan_mode`/`todo_write` calls this turn.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { PlanState } from "../projections/plans.ts";

export interface PlanStateInput {
  readonly sessionId: string;
}

const EMPTY: Omit<PlanState, "sessionId"> = { on: false, todos: [] };

export function planStateComponent(getService: () => RuntimeService, semanticRef?: SemanticRef): Component {
  return {
    id: "plan:state",
    provides: [{ id: "plan.state", version: "1.0.0", semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "plan.state", version: "1.0.0", semanticRef }, async (rawInput, ctx): Promise<PlanState> => {
        const input = rawInput as PlanStateInput;
        const service = getService();
        const caller = { actor: ctx.actor, tenant: ctx.tenant ?? "local" };
        const rows = (await service.readProjection(caller, { name: "plans" })).rows;
        const row = rows.find((r) => r.key === input.sessionId);
        if (!row) return { sessionId: input.sessionId, ...EMPTY };
        return row.value as unknown as PlanState;
      });
    },
  };
}
