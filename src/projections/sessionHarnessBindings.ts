// Public projection `session-harness-bindings` (J-HARNESS-session): one durable row per session
// that names the external harness CLI the session runs through. Keyed `${tenant}/${sessionId}`;
// `harnessId: null` is an explicit return to the native agent. Truth is the `session.harness.bound`
// event (recorded by the validated `session.harness.bind` capability) plus the agent-emitted
// `harness.session.recorded` (the CLI's own session id, used to resume the next turn). Rows are
// derived and rebuildable.
import type { Projection } from "@godspeedai/cognate-projections";

export interface SessionHarnessBindingRow {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly harnessId: string | null;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly posture?: string;
  readonly resumeId?: string;
}

export const sessionHarnessBindingsProjection: Projection = {
  name: "session-harness-bindings",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "session.harness.bound" && event.eventType !== "harness.session.recorded") return [];
    const p = event.payload as Record<string, unknown>;
    if (typeof p.sessionId !== "string") return [];
    const key = `${event.tenant}/${p.sessionId}`;
    const existing = state.get(key) as SessionHarnessBindingRow | undefined;
    if (event.eventType === "harness.session.recorded") {
      if (!existing || existing.harnessId !== p.harnessId || typeof p.remoteSessionId !== "string") return [];
      return [{ key, value: { ...existing, resumeId: p.remoteSessionId } }];
    }
    if (typeof p.workspaceId !== "string") return [];
    const harnessId = typeof p.harnessId === "string" ? p.harnessId : null;
    // A new harness (or native) never inherits another CLI's session id.
    const keepResume = existing && existing.harnessId === harnessId ? existing.resumeId : undefined;
    return [{
      key,
      value: {
        sessionId: p.sessionId,
        workspaceId: p.workspaceId,
        harnessId,
        ...(harnessId && typeof p.permissionMode === "string" ? { permissionMode: p.permissionMode } : {}),
        ...(harnessId && typeof p.model === "string" ? { model: p.model } : {}),
        ...(typeof p.posture === "string" ? { posture: p.posture } : {}),
        ...(keepResume ? { resumeId: keepResume } : {}),
      },
    }];
  },
};
