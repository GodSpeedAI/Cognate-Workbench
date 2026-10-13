// Public projection `plugins`: one row per installed plugin, keyed `${tenant}/record/${pluginId}`.
// T11 (J-PLG-install). Installation is durable and reversible: `plugin.installed` writes the row,
// `plugin.uninstalled` deletes it (a `null` value deletes a projection key). Nothing else in the
// system derives plugin availability — the catalog is code, the install state is data, and the two
// are merged in `src/plugins.ts`.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export const pluginsProjection: Projection = {
  name: "plugins",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType === "plugin.installed") {
      const payload = event.payload as { readonly pluginId: string; readonly implementation?: string };
      return [
        {
          key: `${event.tenant}/record/${payload.pluginId}`,
          value: {
            pluginId: payload.pluginId,
            installedAt: event.recordedAt,
            ...(typeof payload.implementation === "string" ? { implementation: payload.implementation } : {}),
          },
        },
      ];
    }
    if (event.eventType === "plugin.uninstalled") {
      const payload = event.payload as { readonly pluginId: string };
      const key = `${event.tenant}/record/${payload.pluginId}`;
      // Refuse to delete a row that was never installed — the capability validates first, this
      // keeps the fold total against a replay of an unmatched pair.
      if (!state.get(key)) return [];
      return [{ key, value: null }];
    }
    return [];
  },
};
