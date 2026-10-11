// `subagent.start`: starts a child `agent.coding` run for the `subagent` tool
// (`agentCoding.ts`, invoked directly via `ctx.invoke("subagent.start", { agent, input, key })` —
// fire-and-forget, reference-behavior-matrix.md §6.4: the parent does not wait on the child). Named
// and shaped after `@godspeedai/cognate-profile-harness`'s own `subagent.start` (`profiles/harness/src/
// index.ts`'s `subagentStartComponent`, which `spawnSubagent` depends on) but not reused directly:
// the packaged version starts the child run with no `correlationId` at all, so a child would fall
// back to whatever the runtime defaults to — this app needs the child correlated as
// `subagent:<parentRunId>:<id>` specifically, both so it is queryable as a subagent run (the
// `subagents` projection parses this correlation back apart) and so it is *excluded* from the
// `sessions` projection's "session:"-only guard (`src/projections/sessions.ts`) — children must not
// appear as top-level sessions.
import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";

type SystemActor = { readonly id: string; readonly kind: "system" };

export interface SubagentStartInput {
  readonly agent: string;
  readonly input: Json;
  /** `${parentRunId}:${id}` — exactly the `key` `spawnSubagent` builds and also uses as the child
   *  run's idempotency key. */
  readonly key: string;
}

export function subagentStartComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemActor: SystemActor;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "subagent:start",
    provides: [{ id: "subagent.start", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "subagent.start", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput, ctx) => {
        const input = rawInput as SubagentStartInput;
        const parentRunId = ctx.runId;
        // `key` is always `${parentRunId}:${id}` (spawnSubagent's own construction) — recover `id`
        // to build this app's `subagent:<parentRunId>:<id>` correlation.
        const prefix = `${parentRunId}:`;
        const id = input.key.startsWith(prefix) ? input.key.slice(prefix.length) : input.key;
        const service = options.getService();
        const view = await service.startRun(
          { actor: options.systemActor, tenant: ctx.tenant ?? "local" },
          { agent: input.agent, input: input.input, idempotencyKey: input.key, correlationId: `subagent:${parentRunId}:${id}` },
        );
        return { runId: view.runId };
      });
    },
  };
}
