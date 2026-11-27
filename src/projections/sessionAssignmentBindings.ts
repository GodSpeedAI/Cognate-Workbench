// Public projection `session-assignment-bindings` (WP-23, J-CASE-ASSIGNMENT-handoff): one durable
// row per conversation that names the case assignment handed to it — `{ sessionId, assignmentId,
// runId }`, keyed `${tenant}/${sessionId}`. The absence of a row means the conversation was never
// handed an assignment.
//
// The truth is the handed-off run's own `run.started` event: `session.caseAssignment.handoff` opens
// that run bound to the assignment, correlated to the conversation like any turn, so the event
// already carries all three facts. No second event is recorded for the binding — the row is a
// rebuildable view of that one event, and it is visible the moment the run starts.
//
// The fold reads only what erasure cannot take: the correlation id, the run id and the event's
// metadata. The event's payload holds the Brief and the message, which a retention policy may erase.
import type { Projection } from "@godspeedai/cognate-projections";

const SESSION_CORRELATION = "session:";

export interface SessionAssignmentBindingRow {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly runId: string;
}

export const sessionAssignmentBindingsProjection: Projection = {
  name: "session-assignment-bindings",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "run.started" || !event.correlationId.startsWith(SESSION_CORRELATION)) return [];
    const metadata = event.metadata as { readonly assignment?: { readonly assignment_id?: unknown } } | null | undefined;
    const assignmentId = metadata?.assignment?.assignment_id;
    const sessionId = event.correlationId.slice(SESSION_CORRELATION.length);
    // Only a run opened bound to an assignment binds its conversation: an ordinary turn, however
    // it is started, carries no assignment.
    if (typeof assignmentId !== "string" || !assignmentId || !sessionId || typeof event.runId !== "string") return [];
    const key = `${event.tenant}/${sessionId}`;
    // Idempotent fold: a replayed start must not rewrite the row it already produced.
    const existing = state.get(key) as SessionAssignmentBindingRow | undefined;
    if (existing?.assignmentId === assignmentId && existing.runId === event.runId) return [];
    return [{ key, value: { sessionId, assignmentId, runId: event.runId } }];
  },
};
