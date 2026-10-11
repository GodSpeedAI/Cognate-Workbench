// Public projection `model-config`: folds `model.configured` events. Never carries the secret —
// the event payload it folds never contained one (see agentConfig.ts / modelConfigure.ts).
import type { Projection } from "@godspeedai/cognate-projections";

export const modelConfigProjection: Projection = {
  name: "model-config",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "model.configured") return [];
    const payload = event.payload as { readonly providerId: string; readonly baseURL: string; readonly protocol: string; readonly model: string };
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
          configuredAt: event.recordedAt,
        },
      },
    ];
  },
};
