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
import { isShortcutOverrides, validateAssignment } from "../shortcuts.ts";

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
  /** T11: `settings.changeShortcuts` is bound in tranche 11, not usage 2, so its ref arrives here. */
  readonly shortcutsSemanticRef?: SemanticRef | undefined;
}): Component {
  const contract = (index: number) => ({
    id: SETTING_FIELDS[index]!.capability,
    version: "1.0.0",
    semanticRef: options.semanticRefs[index],
  });
  const shortcutsContract = { id: "settings.changeShortcuts", version: "1.0.0", semanticRef: options.shortcutsSemanticRef };
  return {
    id: "settings:change",
    provides: [...SETTING_FIELDS.map((_, i) => contract(i)), shortcutsContract],
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
      // T11 (J-PREFS-shortcuts): structurally valid overrides are not enough — two actions bound to
      // the same chord would make the binding ambiguous, and a later write would silently steal an
      // earlier action's chord. The patch is therefore validated against the *durable, currently
      // applied* overrides, not against an empty starting map: a patch that only rebinds one action
      // must still be refused when the chord it wants is already held by another action's standing
      // override or default, and unbinding one action must free its chord for the next patch.
      fiber.provide(shortcutsContract, async (rawInput) => {
        const input = rawInput as { readonly shortcuts?: unknown };
        const value = input.shortcuts;
        if (!isShortcutOverrides(value)) {
          throw new Error("settings.changeShortcuts: shortcuts must map known action ids to a chord string or null");
        }
        const service = options.getService();
        // Start from what is actually in force, so the simulation sees the real conflict surface.
        const rows = (await service.readProjection(options.systemCaller, { name: "settings" })).rows;
        // `readProjection` returns tenant-relative keys ("current"), so match both forms.
        const current = rows.find((r) => r.key === "current" || r.key.endsWith("/current"))?.value as { readonly shortcuts?: unknown } | undefined;
        const applied: Record<string, string | null> = { ...(isShortcutOverrides(current?.shortcuts) ? current.shortcuts : {}) };
        // Simulate the patch in turn against the standing overrides so a patch that binds two
        // actions to the same chord fails, and so a chord freed by this same patch is reusable.
        for (const [actionId, chord] of Object.entries(value)) {
          applied[actionId] = chord;
          if (chord === null) continue;
          const decision = validateAssignment(actionId, chord, applied);
          if (!decision.ok) throw new Error(`settings.changeShortcuts: ${decision.reason}`);
        }
        await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "settings.changed", shortcuts: value } as unknown as Json,
          idempotencyKey: randomUUID(),
        });
        return { ok: true, shortcuts: value };
      });
    },
  };
}
