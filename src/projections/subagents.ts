// Public projection `subagents`: one row per `subagent` tool call, keyed
// `${tenant}/${parentRunId}/${toolCallId}`. Fire-and-forget delegation (reference-behavior-matrix.md
// §6.4): the parent only ever records that it *started* a child (`subagent.spawned`, emitted by
// `agent.coding` right after `ctx.invoke("subagent.start", ...)` returns); the child's own
// completion is observed directly from *its* events (`message.completed`/`run.failed`, correlated
// `subagent:<parentRunId>:<toolCallId>` — see `src/capabilities/subagentStart.ts`), not from
// anything the parent emits — there is no parent-side wait, so the parent cannot durably record when
// the child finishes. Read by the UI (`useProjection("subagents")`) for the session banner's "N
// subagent(s)" disclosure, the "Subagent sessions" tree, and "Open <title> in sidebar"'s child
// transcript (reference-behavior-matrix.md §6.4, `14b-subagent-completed-panel`). Also read by
// `session.history` (`src/capabilities/sessionHistory.ts`) so a completed child's result durably
// "returns to the parent" as context on the parent session's *next* turn. Child runs are NOT
// sessions — `sessions.ts` explicitly excludes them (only "session:"-correlated runs are folded
// there); this projection is the only place their existence/result is recorded for the UI.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export interface SubagentRow {
  readonly parentRunId: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly childRunId: string;
  /** The `subagent` tool call's `description` argument — the row's title. */
  readonly title: string;
  /** The `subagent` tool call's `prompt` argument, truncated — the row's secondary text. */
  readonly desc: string;
  /** The `prompt` argument in full — used for the child-transcript panel ("Open ... in sidebar"). */
  readonly prompt: string;
  readonly status: "running" | "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt?: string;
  /** The child's final answer text, once `status` is `"completed"`. */
  readonly output?: string;
}

const DESC_MAX = 40;

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** `subagent:<parentRunId>:<toolCallId>` -> `{ parentRunId, toolCallId }`, or `undefined` for any
 *  other correlation (a real session, or anything else). `toolCallId` itself may contain `:`
 *  (mock-model ids don't, but this stays correct either way) — split only on the first two. */
function parseSubagentCorrelation(correlationId: string): { readonly parentRunId: string; readonly toolCallId: string } | undefined {
  if (!correlationId.startsWith("subagent:")) return undefined;
  const rest = correlationId.slice("subagent:".length);
  const sep = rest.indexOf(":");
  if (sep < 0) return undefined;
  return { parentRunId: rest.slice(0, sep), toolCallId: rest.slice(sep + 1) };
}

export const subagentsProjection: Projection = {
  name: "subagents",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType === "subagent.spawned") {
      const payload = event.payload as unknown as {
        readonly sessionId: string;
        readonly toolCallId: string;
        readonly description: string;
        readonly prompt: string;
        readonly childRunId: string;
      };
      const parentRunId = event.runId ?? "";
      const key = `${event.tenant}/${parentRunId}/${payload.toolCallId}`;
      const row: SubagentRow = {
        parentRunId,
        sessionId: payload.sessionId,
        toolCallId: payload.toolCallId,
        childRunId: payload.childRunId,
        title: payload.description,
        desc: truncate(payload.prompt, DESC_MAX),
        prompt: payload.prompt,
        status: "running",
        startedAt: event.recordedAt,
      };
      return [{ key, value: row as unknown as Json }];
    }
    // The child's OWN completion event (not anything the parent emits — fire-and-forget, no parent
    // wait). `message.completed`'s payload carries the final answer text directly.
    if (event.eventType === "message.completed") {
      const parsed = parseSubagentCorrelation(event.correlationId);
      if (!parsed) return [];
      const key = `${event.tenant}/${parsed.parentRunId}/${parsed.toolCallId}`;
      const existing = state.get(key) as unknown as SubagentRow | undefined;
      if (!existing) return [];
      const payload = event.payload as unknown as { readonly text?: string };
      const row: SubagentRow = { ...existing, status: "completed", completedAt: event.recordedAt, output: payload.text ?? "" };
      return [{ key, value: row as unknown as Json }];
    }
    if (event.eventType === "run.failed") {
      const parsed = parseSubagentCorrelation(event.correlationId);
      if (!parsed) return [];
      const key = `${event.tenant}/${parsed.parentRunId}/${parsed.toolCallId}`;
      const existing = state.get(key) as unknown as SubagentRow | undefined;
      if (!existing || existing.status !== "running") return [];
      const row: SubagentRow = { ...existing, status: "failed", completedAt: event.recordedAt };
      return [{ key, value: row as unknown as Json }];
    }
    return [];
  },
};
