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
  version: "1.2.0",
  apply(event, state) {
    if (event.eventType !== "settings.changed") return [];
    const payload = event.payload as Record<string, Json>;
    const key = `${event.tenant}/current`;
    const existing = state.get(key) as Record<string, Json> | undefined;
    // The `plugins` and `shortcuts` maps merge PER KEY (usage pass U7, T11): those capabilities
    // carry only the ids they toggle/bind, and merging them wholesale would clobber every other
    // entry's durable state — a patch that rebinds one shortcut would silently unbind the rest.
    // Every other field stays whole-value (the last write wins).
    let patch: Record<string, Json> = payload;
    for (const mapField of ["plugins", "shortcuts"] as const) {
      const value = payload[mapField];
      if (value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)) {
        patch = {
          ...patch,
          [mapField]: { ...(((existing?.[mapField] as Record<string, Json> | undefined) ?? {})), ...(value as Record<string, Json>) },
        };
      }
    }
    return [
      {
        key,
        value: { ...(existing ?? {}), ...patch, updatedAt: event.recordedAt },
      },
    ];
  },
};
