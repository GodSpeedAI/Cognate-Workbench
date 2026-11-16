// Public projection `model-config`: folds `model.configured` events. Never carries the secret —
// the event payload it folded never contained one (see agentConfig.ts / modelConfigure.ts).
//
// T11 (J-CFG-provider-delete): `provider.deleted` removes the `current` row, which is what puts the
// UI back into the unconfigured state. A `null` value deletes a projection key. The event carries
// only the provider id — by the time it is recorded the secret has already been removed, so there
// is nothing secret left to fold even if someone later added a payload field.
import type { Projection } from "@godspeedai/cognate-projections";

export const modelConfigProjection: Projection = {
  name: "model-config",
  version: "1.2.0",
  apply(event, state) {
    if (event.eventType === "provider.deleted") {
      const key = `${event.tenant}/current`;
      const existing = state.get(key) as { readonly providerId?: string } | undefined;
      if (!existing) return [];
      // Deleting a stored provider that is not the active route must leave the active route alone.
      const deleted = (event.payload as { readonly providerId?: string }).providerId;
      if (deleted !== undefined && existing.providerId !== undefined && existing.providerId !== deleted) return [];
      return [{ key, value: null }];
    }
    if (event.eventType !== "model.configured") return [];
    const payload = event.payload as { readonly providerId: string; readonly baseURL: string; readonly protocol: string; readonly model: string; readonly displayName?: string; readonly auth?: string; readonly apiVersion?: string; readonly prices?: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number } };
    const key = `${event.tenant}/current`;
    void state;
    return [
      {
        key,
        value: {
          providerId: payload.providerId,
          baseURL: payload.baseURL,
          protocol: payload.protocol,
          model: payload.model,
          ...(payload.displayName ? { displayName: payload.displayName } : {}),
          ...(payload.auth ? { auth: payload.auth } : {}),
          ...(payload.apiVersion ? { apiVersion: payload.apiVersion } : {}),
          ...(payload.prices ? { prices: payload.prices } : {}),
          configuredAt: event.recordedAt,
        },
      },
    ];
  },
};
