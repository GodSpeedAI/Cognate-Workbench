// `session.create` (J-SESSION-draft): the durable conversation identity the + action creates,
// *before* any prompt. Sessions were previously implicit — a sidebar in-memory UUID that only
// became durable when the first turn's `session.turn.started` event folded. This capability makes
// the draft itself durable: a deterministic `agent.config` run records `session.created`,
// correlated `session:<id>`, which the `sessions` projection folds into a draft row.
//
// Identity is deterministic on (workspaceId, requestId): the same create request returns the same
// session after a retry, a reload or a restart, and the runtime's idempotency key (derived from
// that same identity) guarantees the recording run executes exactly once — one `session.created`
// event per request identity, never a duplicate row. No inference, model or credential is needed
// to create a draft; the first submitted turn simply reuses the identity.
import { createHash } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface SessionCreateInput {
  /** The workspace this session belongs to, by stable id — never the global "current" pointer,
   *  so a workspace switch cannot race the creation. */
  readonly workspaceId: string;
  /** The caller's idempotency identity for this create request (the + click's request id). */
  readonly requestId: string;
}

export const DRAFT_SESSION_TITLE = "New Session";

/** Stable session identity: the same create request in the same workspace yields the same session. */
export function sessionIdFor(workspaceId: string, requestId: string): string {
  return `session-${createHash("sha256").update(`${workspaceId}\u0000${requestId}`).digest("hex").slice(0, 24)}`;
}

export function sessionCreateComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** Workspaces this process already knows (selected this boot or seeded from the projection) —
   *  the projection fold is asynchronous, so existence checks consult both to stay race-free. */
  readonly getKnownWorkspaceIds: () => ReadonlySet<string>;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "session:create",
    provides: [{ id: "session.create", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "session.create", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput) => {
        const input = rawInput as SessionCreateInput;
        const requestId = (input.requestId ?? "").trim();
        if (!requestId) throw new Error("session.create: a requestId is required (the + action's idempotency identity)");
        if (requestId.length > 200) throw new Error("session.create: requestId is too long (max 200 characters)");
        const service = options.getService();
        const workspaces = (await service.readProjection(options.systemCaller, { name: "workspaces" })).rows;
        const known =
          workspaces.some((r) => r.key === `record/${input.workspaceId}`) || options.getKnownWorkspaceIds().has(input.workspaceId);
        if (!known) {
          throw new Error(`session.create: unknown workspace ${input.workspaceId} — a session must live in an existing workspace`);
        }
        const sessionId = sessionIdFor(input.workspaceId, requestId);
        const { runId } = await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "session.created", sessionId, workspaceId: input.workspaceId, title: DRAFT_SESSION_TITLE },
          idempotencyKey: `session-create:${sessionId}`,
          correlationId: `session:${sessionId}`,
        });
        // Wait for the recording run to settle: the invoke's contract is "the draft exists now"
        // (J-SESSION-draft's settlement reads the event history immediately after create). A
        // duplicate request replays the same run — polling returns the same settled result.
        for (let i = 0; i < 400; i++) {
          const run = await service.getRun(options.systemCaller, { runId });
          if (run.status === "completed") break;
          if (run.status === "failed" || run.status === "cancelled") throw new Error(`session.create: recording failed (${run.status})`);
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        return { sessionId, workspaceId: input.workspaceId, title: DRAFT_SESSION_TITLE };
      });
    },
  };
}
