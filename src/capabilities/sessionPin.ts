// `session.setPinned` (F1, J-SESSION-pin): durable, sort-independent pinning of a conversation.
// Same shape as `session.setArchived` / `session.rename`: validate against the live `sessions`
// projection, then start a deterministic `agent.config` run whose `session.pinned` event the
// projection folds — the event log owns the flag, not component memory. Pinning is pure
// view-ordering: no turn, run or event is touched, and Unpin restores the ordinary sort.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface SessionPinInput {
  readonly sessionId: string;
  readonly pinned: boolean;
}

export function sessionPinComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef: SemanticRef | undefined;
}): Component {
  const contract = { id: "session.setPinned", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "session:pin",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput) => {
        const input = rawInput as SessionPinInput;
        if (typeof input.pinned !== "boolean") {
          throw new Error("session.setPinned: pinned must be a boolean");
        }
        if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
          throw new Error("session.setPinned: a non-empty sessionId is required");
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "sessions" })).rows;
        const known = new Set(rows.map((r) => r.key.slice(r.key.indexOf("/") + 1)));
        if (!known.has(input.sessionId)) {
          throw new Error(`session.setPinned: unknown session ${input.sessionId}`);
        }
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "session.pinned", sessionId: input.sessionId, pinned: input.pinned },
          idempotencyKey: randomUUID(),
        });
        return { ok: true, sessionId: input.sessionId, pinned: input.pinned };
      });
    },
  };
}
