// `session.task.bind` (J-TASK-scope / J-TASK-link): the governed, durable Task↔Session binding a
// person chooses from the composer's Task control. Attaching (`taskId` set) validates that the
// task exists, lives in the session's own workspace, and is *available* to that session — a
// workspace task anywhere in the workspace, a session task only in its owning session. Detaching
// (`taskId: null`) records an explicit "no task" without deleting anything: the task, its
// evidence and its runs keep their own history.
//
// The event is recorded by a deterministic `agent.config` run (`session.recorded`) correlated to
// the session, and folded by the public `session-task-bindings` projection. Availability is not
// authority: binding never widens the task's contract — `authority.check` still governs every
// tool call at run time.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import type { ScopedTaskRecord } from "../workbench/state.ts";

export interface SessionTaskBindInput {
  readonly sessionId: string;
  /** The task to attach, or `null` to detach (an explicit, durable "no task"). */
  readonly taskId: string | null;
}

export function sessionTaskBindComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "session:task-bind",
    provides: [{ id: "session.task.bind", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "session.task.bind", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput) => {
        const input = rawInput as SessionTaskBindInput;
        if (typeof input.sessionId !== "string" || !input.sessionId.trim()) throw new Error("session.task.bind: a sessionId is required");
        const service = options.getService();
        const sessionRows = (await service.readProjection(options.systemCaller, { name: "sessions" })).rows;
        const session = sessionRows.find((r) => r.key === input.sessionId)?.value as { readonly workspaceId: string } | undefined;
        if (!session) throw new Error(`session.task.bind: unknown session ${input.sessionId}`);
        if (input.taskId === null || input.taskId === undefined) {
          await service.startRun(options.systemCaller, {
            agent: AGENT_CONFIG,
            input: { kind: "session.recorded", events: [{ type: "session.task.bound", payload: { sessionId: input.sessionId, workspaceId: session.workspaceId, taskId: null } }] },
            idempotencyKey: randomUUID(),
            correlationId: `session:${input.sessionId}`,
          });
          return { sessionId: input.sessionId, workspaceId: session.workspaceId, taskId: null };
        }
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("session.task.bind: taskId must be a task id or null");
        const taskRows = (await service.readProjection(options.systemCaller, { name: "workbench" })).rows;
        const task = taskRows.find((r) => r.key === `task/${input.taskId}`)?.value as ScopedTaskRecord | undefined;
        if (!task) throw new Error(`session.task.bind: unknown task ${input.taskId}`);
        if (task.workspaceId !== session.workspaceId) {
          throw new Error(`session.task.bind: task ${task.id} lives in another workspace — move it first instead of binding across workspaces`);
        }
        if (task.scope === "session" && task.sessionId !== input.sessionId) {
          throw new Error(`session.task.bind: task ${task.id} is session-scoped to another session — promote or move it before binding it here`);
        }
        await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "session.recorded", events: [{ type: "session.task.bound", payload: { sessionId: input.sessionId, workspaceId: session.workspaceId, taskId: task.id } }] },
          idempotencyKey: randomUUID(),
          correlationId: `session:${input.sessionId}`,
        });
        return { sessionId: input.sessionId, workspaceId: session.workspaceId, taskId: task.id };
      });
    },
  };
}
