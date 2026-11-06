// Public projection `session-task-bindings` (J-TASK-scope / J-TASK-link): one durable row per
// session that names the Task the session explicitly selected — `{ sessionId, workspaceId,
// taskId }`, keyed `${tenant}/${sessionId}`. A row with `taskId: null` is an explicit detach;
// the absence of a row means the session was never bound (also "no task", and equally valid).
// The truth is the `session.task.bound` event log (recorded by validated capabilities through
// `agent.config`'s `session.recorded` command); these rows are derived and rebuildable.
//
// Bindings are never inferred: creating a workspace task does not bind any session, a workspace
// task stays merely *available* in every session of its workspace, and a session task binds only
// its owning session. Invalidating a binding (a move, a detach) writes `taskId: null` — history
// and run provenance are never rewritten.
import type { Projection } from "@godspeedai/cognate-projections";

export interface SessionTaskBindingRow {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
}

export const sessionTaskBindingsProjection: Projection = {
  name: "session-task-bindings",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "session.task.bound") return [];
    const payload = event.payload as { readonly sessionId: string; readonly workspaceId: string; readonly taskId: string | null };
    if (typeof payload.sessionId !== "string" || typeof payload.workspaceId !== "string") return [];
    const key = `${event.tenant}/${payload.sessionId}`;
    const existing = state.get(key) as SessionTaskBindingRow | undefined;
    // Idempotent fold: the same binding event replayed must not resurrect a detached binding
    // (events are ordered, so a later detach always wins over an earlier attach).
    if (existing && existing.taskId === payload.taskId) return [];
    return [
      {
        key,
        value: { sessionId: payload.sessionId, workspaceId: payload.workspaceId, taskId: payload.taskId === undefined ? null : payload.taskId },
      },
    ];
  },
};
