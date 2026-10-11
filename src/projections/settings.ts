// Public projection `settings`: folds `settings.changed` events into a single "current" row, the
// same one-row-per-tenant convention `model-config` uses. Events carry partial patches (usage pass
// U2: each `settings.change*` capability writes only its own field — `workDetails`, `permission`,
// `language`, `appearance`, `fontSize`, `performanceDetail`, `codingTools`, `sendBehavior`), so the
// fold MERGES into the previous row instead of replacing it: a field, once set, keeps its value
// until a later event changes it, and fields an event does not mention are untouched. Absence of
// the row (or of a field) is what makes the UI fall back to the documented defaults on a fresh
// COGNATE_HARNESS_HOME (`src/settings.ts`'s `resolveGeneralSettings`).
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export const settingsProjection: Projection = {
  name: "settings",
  version: "1.1.0",
  apply(event, state) {
    if (event.eventType !== "settings.changed") return [];
    const payload = event.payload as Record<string, Json>;
    const key = `${event.tenant}/current`;
    const existing = state.get(key) as Record<string, Json> | undefined;
    // The `plugins` map merges PER KEY (usage pass U7): a `settings.changePlugin` event carries
    // only the plugin ids it toggles, and merging it wholesale would clobber every other
    // plugin's durable state. Every other field stays whole-value (the last write wins).
    const patch = payload.plugins !== undefined && payload.plugins !== null && typeof payload.plugins === "object" && !Array.isArray(payload.plugins)
      ? { ...payload, plugins: { ...((existing?.plugins as Record<string, Json> | undefined) ?? {}), ...(payload.plugins as Record<string, Json>) } }
      : payload;
    return [
      {
        key,
        value: { ...(existing ?? {}), ...patch, updatedAt: event.recordedAt },
      },
    ];
  },
};
