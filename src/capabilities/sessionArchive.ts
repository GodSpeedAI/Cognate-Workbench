// `session.setArchived` (T11, J-SESSION-archive): durable, reversible archiving of a conversation.
// Same shape as `workspace.rename` / `workspace.delete`: validate against the live `sessions`
// projection, then start a deterministic `agent.config` run whose `session.archived` event the
// projection folds — the event log owns the flag, not component memory.
//
// Archiving is deliberately *not* deletion: no turn, run or event is removed, and the projection row
// itself survives, so an archived conversation is fully restorable and its history reopens intact.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface SessionArchiveInput {
  readonly sessionId: string;
  readonly archived: boolean;
}

export function sessionArchiveComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef: SemanticRef | undefined;
}): Component {
  const contract = { id: "session.setArchived", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "session:archive",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput) => {
        const input = rawInput as SessionArchiveInput;
        if (typeof input.archived !== "boolean") {
          throw new Error("session.setArchived: archived must be a boolean");
        }
        if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
          throw new Error("session.setArchived: a non-empty sessionId is required");
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "sessions" })).rows;
        const known = new Set(rows.map((r) => r.key.slice(r.key.indexOf("/") + 1)));
        if (!known.has(input.sessionId)) {
          throw new Error(`session.setArchived: unknown session ${input.sessionId}`);
        }
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "session.archived", sessionId: input.sessionId, archived: input.archived },
          idempotencyKey: randomUUID(),
        });
        return { ok: true, sessionId: input.sessionId, archived: input.archived };
      });
    },
  };
}
