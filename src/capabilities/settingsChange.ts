// `settings.change*`: one client-invoke capability per Settings -> General setting group
// (usage pass U2, reference-behavior-matrix.md §11), extending the Work-details pattern
// (`settings.changeWorkDetails`, which keeps its id/behavior unchanged): like
// `onboarding.dismiss` / `workspace.select`, each capability's only side effect is starting a
// deterministic `agent.config` run whose `settings.changed` event carries just that setting's
// field — the durable event log, not component-local memory, is what the preference is derived
// from, so every setting survives a reload AND a full runtime restart. The `settings` projection
// merges the partial patches into its single "current" row (see `src/projections/settings.ts`).
import { randomUUID } from "node:crypto";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { isWorkDetailsMode } from "../workDetails.ts";
import {
  isAgentPreset,
  isAppearanceMode,
  isFontSizePx,
  isLanguageCode,
  isPerformanceDetailMode,
  isPermissionMode,
  isPluginStatePatch,
  isSendBehavior,
  type SettingsPatch,
} from "../settings.ts";

/** One descriptor per capability: the durable field it writes and the guard that validates the
 *  client's value before any event is recorded. Kept declarative so the component's `provides`
 *  list and its `fiber.provide` wiring stay in lockstep. */
interface SettingField {
  readonly capability: string;
  readonly field: keyof SettingsPatch;
  readonly validate: (value: unknown) => boolean;
}

const SETTING_FIELDS: readonly SettingField[] = [
  { capability: "settings.changeWorkDetails", field: "workDetails", validate: isWorkDetailsMode },
  { capability: "settings.changePermission", field: "permission", validate: isPermissionMode },
  { capability: "settings.changeLanguage", field: "language", validate: isLanguageCode },
  { capability: "settings.changeAppearance", field: "appearance", validate: isAppearanceMode },
  { capability: "settings.changeFontSize", field: "fontSize", validate: isFontSizePx },
  { capability: "settings.changePerformanceDetail", field: "performanceDetail", validate: isPerformanceDetailMode },
  { capability: "settings.changeCodingTools", field: "codingTools", validate: (v) => typeof v === "boolean" },
  { capability: "settings.changeSendBehavior", field: "sendBehavior", validate: isSendBehavior },
  { capability: "settings.changePreset", field: "preset", validate: isAgentPreset },
  // Usage pass U7: the one global plugin with runtime behavior behind it. The value is a per-key
  // patch (`{ plugins: { realitytrace: true } }`), merged per key by the settings projection fold.
  { capability: "settings.changePlugin", field: "plugins", validate: isPluginStatePatch },
];

export function settingsChangeComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** Per-capability semantic refs from `bindUsage2` (`domain/index.ts`), in SETTING_FIELDS order. */
  readonly semanticRefs: readonly (SemanticRef | undefined)[];
}): Component {
  const contract = (index: number) => ({
    id: SETTING_FIELDS[index]!.capability,
    version: "1.0.0",
    semanticRef: options.semanticRefs[index],
  });
  return {
    id: "settings:change",
    provides: SETTING_FIELDS.map((_, i) => contract(i)),
    activate(fiber) {
      SETTING_FIELDS.forEach((field, i) => {
        fiber.provide(contract(i), async (rawInput) => {
          const input = rawInput as Partial<Record<keyof SettingsPatch, unknown>>;
          const value = input[field.field];
          if (!field.validate(value)) {
            throw new Error(`settings.change*: ${field.field} failed validation`);
          }
          const service = options.getService();
          const eventInput: Record<string, unknown> = { kind: "settings.changed" };
          eventInput[field.field] = value;
          await service.startRun(options.systemCaller, {
            agent: AGENT_CONFIG,
            input: eventInput as unknown as Json,
            idempotencyKey: randomUUID(),
          });
          return { ok: true };
        });
      });
    },
  };
}
