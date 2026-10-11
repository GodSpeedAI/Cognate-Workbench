// Public projection `execution-worlds`: one record per connected remote world (SSH host / WSL
// distribution). The record is exactly what is needed to rebuild the provider after a restart and to
// show it in the UI — and nothing secret: no password, passphrase or key material, only the auth
// *kind*, a key *path*, and the pinned host-key fingerprint.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export interface WorldRecord {
  readonly worldId: string;
  readonly kind: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly connection: Json;
}

export const executionWorldsProjection: Projection = {
  name: "execution-worlds",
  version: "1.0.0",
  apply(event) {
    if (event.eventType === "execution.world.connected") {
      const p = event.payload as unknown as { readonly worldId: string; readonly worldKind: string; readonly label: string; readonly metadata: Record<string, string>; readonly connection: Json };
      const value: WorldRecord = { worldId: p.worldId, kind: p.worldKind, label: p.label, metadata: p.metadata, connection: p.connection };
      return [{ key: `${event.tenant}/record/${p.worldId}`, value: value as unknown as Json }];
    }
    if (event.eventType === "execution.world.disconnected") {
      const p = event.payload as { readonly worldId: string };
      return [{ key: `${event.tenant}/record/${p.worldId}`, value: null }];
    }
    return [];
  },
};
