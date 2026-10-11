// Public projection `workspaces`: one key per `WorkspaceRecord` plus a `current` pointer.
// Usage pass U3 adds the sidebar's Rename/Delete actions: `workspace.renamed` rewrites the
// record's title in place; `workspace.deleted` deletes the record row and — if it was the current
// pointer — the pointer too (a `null` value deletes a projection key), which drops the UI back to
// the no-workspace state. Deleted workspaces' sessions' events stay in history untouched.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export const workspacesProjection: Projection = {
  name: "workspaces",
  version: "1.2.0",
  apply(event, state) {
    if (event.eventType === "workspace.added") {
      const payload = event.payload as { readonly workspaceId: string; readonly root: string; readonly title: string; readonly executionWorldId: string };
      return [
        {
          key: `${event.tenant}/record/${payload.workspaceId}`,
          value: { id: payload.workspaceId, root: payload.root, title: payload.title, executionWorldId: payload.executionWorldId },
        },
      ];
    }
    if (event.eventType === "workspace.selected") {
      const payload = event.payload as { readonly workspaceId: string };
      return [{ key: `${event.tenant}/current`, value: payload.workspaceId }];
    }
    if (event.eventType === "workspace.renamed") {
      const payload = event.payload as { readonly workspaceId: string; readonly title: string };
      const key = `${event.tenant}/record/${payload.workspaceId}`;
      const existing = state.get(key) as { readonly id: string; readonly root: string; readonly title: string; readonly executionWorldId: string } | undefined;
      if (!existing) return [];
      return [{ key, value: { ...existing, title: payload.title } }];
    }
    if (event.eventType === "workspace.deleted") {
      const payload = event.payload as { readonly workspaceId: string };
      const current = state.get(`${event.tenant}/current`);
      const writes: { key: string; value: Json | null }[] = [{ key: `${event.tenant}/record/${payload.workspaceId}`, value: null }];
      if (current === payload.workspaceId) writes.push({ key: `${event.tenant}/current`, value: null });
      return writes;
    }
    return [];
  },
};
