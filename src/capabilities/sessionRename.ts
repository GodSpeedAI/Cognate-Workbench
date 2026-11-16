// `session.rename` (J-SESSION-rename): a durable, operator-chosen title for a conversation. Same shape as
// `session.setArchived` / `workspace.rename`: validate against the live `sessions` projection, then start a
// deterministic `agent.config` run whose `session.renamed` event the projection folds. The event log owns the
// title; turns, runs and events are untouched. A later first prompt never overwrites a renamed title.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface SessionRenameInput {
  readonly sessionId: string;
  readonly title: string;
}

export const SESSION_TITLE_MAX = 120;

export function sessionRenameComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef: SemanticRef | undefined;
}): Component {
  const contract = { id: "session.rename", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "session:rename",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput) => {
        const input = rawInput as SessionRenameInput;
        if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
          throw new Error("session.rename: a non-empty sessionId is required");
        }
        const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
        if (!title) throw new Error("session.rename: a non-empty title is required");
        if (title.length > SESSION_TITLE_MAX) throw new Error(`session.rename: the title is too long (max ${SESSION_TITLE_MAX} characters)`);
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "sessions" })).rows;
        const known = new Set(rows.map((r) => r.key.slice(r.key.indexOf("/") + 1)));
        if (!known.has(input.sessionId)) throw new Error(`session.rename: unknown session ${input.sessionId}`);
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "session.renamed", sessionId: input.sessionId, title },
          idempotencyKey: randomUUID(),
        });
        return { ok: true, sessionId: input.sessionId, title };
      });
    },
  };
}
