// Public projection `onboarding`: folds `onboarding.dismissed` events, one row per step, keyed
// `${tenant}/notice` / `${tenant}/apikey` (ReadProjection strips the tenant prefix before it reaches
// the client — see `useOnboardingDismissed` in src/ui/App.tsx, same convention as `model-config`'s
// "current" row). Absence of a row is what makes the first-run dialog pair (critic round-1 P0-1)
// reappear on a fresh `COGNATE_HARNESS_HOME` — durable per-home state, same mechanism as every other
// "seen"/"configured" flag in this app (`model-config`, `workspaces`).
import type { Projection } from "@godspeedai/cognate-projections";

export const onboardingProjection: Projection = {
  name: "onboarding",
  version: "1.0.0",
  apply(event) {
    if (event.eventType !== "onboarding.dismissed") return [];
    const payload = event.payload as { readonly step: "notice" | "apikey" };
    if (payload.step !== "notice" && payload.step !== "apikey") return [];
    return [{ key: `${event.tenant}/${payload.step}`, value: { dismissed: true, at: event.recordedAt } }];
  },
};
