// Public projection `sessions`: keyed `${tenant}/${sessionId}` (per the architecture table's
// "Session" row). Title = the literal first human message text, truncated, set as soon as the turn
// starts — matching the reference's *in-flight* behavior (reference-behavior-matrix.md §4: "Derived
// verbatim from the literal first human message text ... at least at the moment of creation";
// confirmed in reference/observations/aria/06-user-message.desktop.txt and
// 08-tool-running.desktop.txt, both of which already show the literal-message title mid-run, not
// "New Session"). Before any turn starts, the row falls back to "New Session" (see
// reference/observations/aria/04-workspace-selected.desktop.txt). The reference's `all-prompts`
// LLM re-titling cadence (a separate model request; see reference-behavior-matrix.md §0/§4) was not
// observed to visibly replace this literal-text title within the pinned pass's timeframe, so this
// reconstruction does not implement a second titling call — see APP/README.md "Known gaps".
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

const TITLE_MAX = 80;

function titleFrom(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
}

/** `startRun`'s `correlationId` for `agent.coding` is always `session:<sessionId>` — the only way
 *  to recover which session a runId (and a bare `run.waiting`, which carries neither) belongs to. */
function sessionIdFromCorrelation(correlationId: string): string | undefined {
  return correlationId.startsWith("session:") ? correlationId.slice("session:".length) : undefined;
}

export const sessionsProjection: Projection = {
  name: "sessions",
  version: "1.1.0",
  apply(event, state) {
    // T11 (J-SESSION-archive): archiving is recorded by an `agent.config` run, so this event is NOT
    // "session:"-correlated and would fall through the guard below. Handle it first. The fold only
    // ever rewrites the row's `archived` flag — turns, runs and events are never deleted, and the
    // row itself survives so an archived conversation is fully restorable from history.
    if (event.eventType === "session.archived") {
      const payload = event.payload as { readonly sessionId: string; readonly archived: boolean };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      // Defensive: archiving a session this projection has never seen must not invent a row with no
      // workspaceId/title. The capability validates existence first; this keeps the fold total.
      if (!existing) return [];
      return [{ key, value: { ...existing, archived: payload.archived } }];
    }
    if (!event.correlationId.startsWith("session:")) return [];
    // T10 (J-F-delegation): a subagent's child run is `agent.coding` too, so it emits the same
    // `session.turn.started`/`message.completed` event types as a real session turn — but
    // correlated `subagent:<parentRunId>:<id>`, not `session:<id>`. Excluding anything not
    // "session:"-correlated is what keeps children out of the sidebar's session tree (they are
    // tracked instead by the `subagents` projection — see `src/projections/subagents.ts`).
    if (event.eventType === "session.turn.started") {
      const payload = event.payload as { readonly sessionId: string; readonly workspaceId: string; readonly message: string; readonly mode?: string; readonly preset?: string };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      // Title from the literal first human message, set immediately (reference-behavior-matrix.md
      // §4) — only the *first* turn's message sets it; a later turn in the same session must not
      // overwrite an already-titled session.
      const title = existing?.title && existing.title !== "New Session" ? existing.title : titleFrom(payload.message);
      // Usage pass U2: fold the session's CURRENT access mode from the run input the turn started
      // with (the composer's per-session dropdown passes `AgentCodingInput.mode` through here; a
      // direct API run without a mode leaves whatever was already folded). This is distinct from
      // the sticky `mode: "ptc"` badge field below.
      const accessMode = typeof payload.mode === "string" ? payload.mode : existing?.accessMode;
      // Usage pass U4 (reference-behavior-matrix.md SS15): the header's mode badge reflects the
      // session's agent preset once a turn carries one (the composer always sends it); the
      // approval-derived sticky "ptc" below stays as the fallback for direct-API runs that never
      // name a preset. The badge vocabulary is the presets' own labels ("Standard mode" etc.).
      const preset = typeof payload.preset === "string" ? payload.preset : existing?.mode;
      return [
        {
          key,
          value: {
            id: payload.sessionId,
            workspaceId: payload.workspaceId,
            title,
            lastStatus: "running",
            runId: event.runId,
            updatedAt: event.recordedAt,
            // T11: this fold rebuilds the row rather than spreading it, so the durable archive flag
            // must be carried forward explicitly or a new turn would silently un-archive the session.
            ...(existing?.archived === true ? { archived: true } : {}),
            ...(accessMode !== undefined ? { accessMode } : {}),
            ...(preset !== undefined ? { mode: preset } : {}),
          },
        },
      ];
    }
    if (event.eventType === "message.completed") {
      const payload = event.payload as { readonly sessionId: string; readonly workspaceId: string; readonly text: string };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      // Title was already set from the literal first message at `session.turn.started` time; keep
      // it (falling back to the answer text only in the defensive case a `session.turn.started`
      // event was somehow never seen for this session). The folded `accessMode` (usage pass U2)
      // persists across the turn's completion the same way.
      return [
        {
          key,
          value: {
            id: payload.sessionId,
            workspaceId: payload.workspaceId,
            title: existing?.title ?? titleFrom(payload.text),
            lastStatus: "completed",
            runId: event.runId,
            updatedAt: event.recordedAt,
            // T11: same carry-forward as `session.turn.started` above — this fold also rebuilds.
            ...(existing?.archived === true ? { archived: true } : {}),
            ...(existing?.accessMode !== undefined ? { accessMode: existing.accessMode } : {}),
            // Usage pass U4: the folded preset (the row's `mode` badge field) persists across the
            // turn's completion the same way `accessMode` does.
            ...(existing?.mode !== undefined ? { mode: existing.mode } : {}),
          },
        },
      ];
    }
    // `run.waiting` (e.g. a pending tool approval): carries neither `sessionId` nor `workspaceId`
    // in its payload, only `runId`/`correlationId` on the envelope. Reproduces "Waiting for
    // approval <title>" surviving a reload (`11b-approval-pending-after-reload`): the sidebar/App
    // needs to know a session's run is waiting so it can reattach to the live run on reopen.
    if (event.eventType === "run.waiting") {
      const sessionId = sessionIdFromCorrelation(event.correlationId);
      if (!sessionId) return [];
      const key = `${event.tenant}/${sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      if (!existing) return [];
      return [{ key, value: { ...existing, lastStatus: "waiting", runId: event.runId } }];
    }
    // Header mode badge ("Standard mode" / "PTC mode" — reference-behavior-matrix.md, round-2 critic
    // batch B P1): the reference's badge reads "PTC mode" for sessions that have ever needed a
    // tool-approval escalation, "Standard mode" otherwise. Sticky once set — approvalGate.ts's
    // decision is per-tool-call, but the badge itself does not flip back once a session has crossed
    // into a permission-to-continue exchange.
    if (event.eventType === "tool.approval.requested") {
      const payload = event.payload as { readonly sessionId: string };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      if (!existing) return [];
      return [{ key, value: { ...existing, mode: "ptc" } }];
    }
    // T11 (J-H-cancellation / J-H-provider-error): these are runtime-emitted (not agent-emitted)
    // events on the run's own stream, so — like `run.waiting` above — they carry neither
    // `sessionId` nor `workspaceId` in their payload; only the correlation id names the session. The
    // sidebar has no distinct "cancelled" badge of its own (reference-behavior-matrix.md §7 — "no
    // distinct cancelled badge in the sidebar itself"), but `lastStatus` still needs to move off
    // "running" so `App.tsx`'s `openSession` stops treating the run as still in flight on reopen.
    if (event.eventType === "run.cancelled" || event.eventType === "run.failed") {
      const sessionId = sessionIdFromCorrelation(event.correlationId);
      if (!sessionId) return [];
      const key = `${event.tenant}/${sessionId}`;
      const existing = state.get(key) as Record<string, Json> | undefined;
      if (!existing) return [];
      const lastStatus = event.eventType === "run.cancelled" ? "cancelled" : "failed";
      return [{ key, value: { ...existing, lastStatus, runId: event.runId } }];
    }
    return [];
  },
};
