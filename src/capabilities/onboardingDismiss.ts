// `onboarding.dismiss`: the capability the first-run dialog pair invokes on "Continue" /
// "Configure later" / "Save and continue" (critic round-1 P0-1). Like `workspace.select` and
// `model.configure`, this is a `client.invoke` capability whose only side effect is starting a
// deterministic `agent.config` run so the durable event log — not component-local memory — is what
// "seen" state is derived from; a fresh `COGNATE_HARNESS_HOME` (no `onboarding.dismissed` events for
// either step) is exactly what makes the dialog pair reappear, matching the reference's per-`DSH_HOME`
// persistence.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export type OnboardingStep = "notice" | "apikey";

export interface OnboardingDismissInput {
  readonly step: OnboardingStep;
}

export function onboardingDismissComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "onboarding:dismiss",
    provides: [{ id: "onboarding.dismiss", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "onboarding.dismiss", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput) => {
        const input = rawInput as OnboardingDismissInput;
        if (input.step !== "notice" && input.step !== "apikey") throw new Error("onboarding.dismiss: step must be 'notice' or 'apikey'");
        const service = options.getService();
        await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "onboarding.dismissed", step: input.step },
          idempotencyKey: randomUUID(),
        });
        return { ok: true };
      });
    },
  };
}
