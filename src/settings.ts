// Settings -> General inventory (usage pass U2, reference-behavior-matrix.md §11): the shared
// vocabulary for every durable General setting besides Work details (which keeps its own module,
// `workDetails.ts`). Values are stored as fields of the `settings` projection's single "current"
// row (folded from `settings.changed` events); absence of a field means "the default", so a fresh
// `COGNATE_HARNESS_HOME` needs no seeded row. Labels match the reference's control labels exactly
// (generic single words / mode names); surrounding descriptions are §11's short functional
// sentences, same precedent as Work details' own "Choose how much detail to show for tool calls".
import { isWorkDetailsMode, type WorkDetailsMode } from "./workDetails.ts";
import { isShortcutOverrides, type ShortcutOverrides } from "./shortcuts.ts";
import { parseSpendingCeilings } from "./experts/billing.ts";
import { parseContainmentQuotas } from "./capabilities/aggregateContainment.ts";

// -- Permission (default access mode for NEW sessions) -----------------------------------------

export const PERMISSION_MODES = ["read-only", "workspace-write", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
/** Reference default: "Workspace Write" (reference-behavior-matrix.md §11). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "workspace-write";
export const PERMISSION_LABELS: Readonly<Record<PermissionMode, string>> = {
  "read-only": "Read Only",
  "workspace-write": "Workspace Write",
  "full-access": "Full access",
};

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

// -- Language -----------------------------------------------------------------------------------

export const LANGUAGE_CODES = ["zh", "en"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
/** Reference default: English (§11). Display-only persistence — see docs/known-gaps.md (no i18n
 *  strings exist; the app's copy is English-only). */
export const DEFAULT_LANGUAGE: LanguageCode = "en";
export const LANGUAGE_LABELS: Readonly<Record<LanguageCode, string>> = { zh: "中文", en: "English" };

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

// -- Appearance ---------------------------------------------------------------------------------

export const APPEARANCE_MODES = ["light", "dark", "system"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];
/** Reference default: "System" ([pressed] in §11's checkpoint 22). */
export const DEFAULT_APPEARANCE: AppearanceMode = "system";

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === "string" && (APPEARANCE_MODES as readonly string[]).includes(value);
}

// -- Font size ----------------------------------------------------------------------------------

/** Reference: 1px stepper, default 14, floor 12 ("Decrease font size" [disabled] at 12 —
 *  checkpoint 22h2). The reference's ceiling was not characterized; 32 is this app's own sane
 *  upper bound so the stepper cannot run unbounded (see docs/known-gaps.md). */
export const DEFAULT_FONT_SIZE_PX = 14;
export const MIN_FONT_SIZE_PX = 12;
export const MAX_FONT_SIZE_PX = 32;

export function isFontSizePx(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_FONT_SIZE_PX && value <= MAX_FONT_SIZE_PX;
}

// -- Performance & usage detail -----------------------------------------------------------------

export const PERFORMANCE_DETAIL_MODES = ["compact", "detailed"] as const;
export type PerformanceDetailMode = (typeof PERFORMANCE_DETAIL_MODES)[number];
/** Reference default: "Detailed" (§11). */
export const DEFAULT_PERFORMANCE_DETAIL: PerformanceDetailMode = "detailed";
export const PERFORMANCE_DETAIL_LABELS: Readonly<Record<PerformanceDetailMode, string>> = {
  compact: "Compact",
  detailed: "Detailed",
};

export function isPerformanceDetailMode(value: unknown): value is PerformanceDetailMode {
  return typeof value === "string" && (PERFORMANCE_DETAIL_MODES as readonly string[]).includes(value);
}

// -- Coding Tools -------------------------------------------------------------------------------

/** Reference default: on (§11 — `switch "Coding Tools" [checked]`). Gates the session tab strip
 *  (Chat/Trajectory) per the reference; the Trajectory tab itself lands in a later tranche, so
 *  until then this app's observable effect is the persisted value only. */
export const DEFAULT_CODING_TOOLS = true;

// -- Agent preset (default for new sessions) ------------------------------------------------------

/** Usage pass U4 (reference-behavior-matrix.md SS15): which agent preset NEW sessions start in —
 *  the composer sends it as `AgentCodingInput.preset`, scoping the turn's tool catalog
 *  (`agentCoding.ts`'s PRESET_TOOLS). The reference's fourth preset (Creator mode) is out of scope
 *  (docs/known-gaps.md). */
export const AGENT_PRESETS = ["standard", "ptc", "minimal"] as const;
export type AgentPreset = (typeof AGENT_PRESETS)[number];
/** Reference default: Standard mode. */
export const DEFAULT_AGENT_PRESET: AgentPreset = "standard";
export const AGENT_PRESET_LABELS: Readonly<Record<AgentPreset, string>> = {
  standard: "Standard mode",
  ptc: "PTC mode",
  minimal: "Minimal mode",
};

export function isAgentPreset(value: unknown): value is AgentPreset {
  return typeof value === "string" && (AGENT_PRESETS as readonly string[]).includes(value);
}

// -- Send behavior while busy -------------------------------------------------------------------

export const SEND_BEHAVIORS = ["queue", "steer"] as const;
export type SendBehavior = (typeof SEND_BEHAVIORS)[number];
/** Reference default: "Queue" (§11). */
export const DEFAULT_SEND_BEHAVIOR: SendBehavior = "queue";
export const SEND_BEHAVIOR_LABELS: Readonly<Record<SendBehavior, string>> = {
  queue: "Queue",
  steer: "Steer",
};

export function isSendBehavior(value: unknown): value is SendBehavior {
  return typeof value === "string" && (SEND_BEHAVIORS as readonly string[]).includes(value);
}

// -- Aggregate shapes ---------------------------------------------------------------------------

/** What a `settings.changed` event carries: one or more validated fields. Partial by design —
 *  each `settings.change*` capability writes only its own field, and the `settings` projection
 *  merges patches into the single current row (a field is never absent once set, and unset fields
 *  keep whatever the previous event left there). */
export interface SettingsPatch {
  readonly workDetails?: WorkDetailsMode;
  readonly permission?: PermissionMode;
  readonly language?: LanguageCode;
  readonly appearance?: AppearanceMode;
  readonly fontSize?: number;
  readonly performanceDetail?: PerformanceDetailMode;
  readonly codingTools?: boolean;
  readonly sendBehavior?: SendBehavior;
  /** Usage pass U4: the default agent preset for NEW sessions (see agentCoding.ts's PRESET_TOOLS). */
  readonly preset?: AgentPreset;
  /** Usage pass U7: global plugin enable state, per plugin id. Only plugins with real runtime
   *  behavior behind them are toggleable (`TOGGLEABLE_PLUGINS`); a plugin absent from the map is
   *  disabled. The projection fold merges this map per key (see projections/settings.ts). */
  readonly plugins?: Record<string, boolean>;
  /** T11 (J-PREFS-shortcuts): durable per-action keyboard-shortcut overrides. Whole-value write
   *  (the last write wins). Absent or a missing action id means "use the shipped default";
   *  `null` means explicitly unbound. See `src/shortcuts.ts`. */
  readonly shortcuts?: ShortcutOverrides;
  /** J-CONTEXT-BUDGET: operator-configured ordinary-session and global spending ceilings in USD.
   *  Enforcement fails closed — with ceilings configured, unpriced model activity is refused. */
  readonly spending?: { sessionUsd?: number; globalUsd?: number };
  /** T8 (J-RW-AGGREGATE-CONTAINMENT): operator-configured aggregate containment quotas for
   *  contained executions, enforced across processes by the aggregate containment ledger.
   *  Absence is the historical "no aggregate quota" behavior. Mirrors the ledger's own parser. */
  readonly containment?: {
    maxConcurrent?: number;
    cpuSecondsPerExecution?: number;
    cpuSecondsPerWindow?: number;
    cpuWindowHours?: number;
    maxAddressSpaceBytes?: number;
  };
}

/** Every General setting, fully resolved with defaults — the read-side shape the UI consumes.
 *  Spending ceilings stay optional: absence is the documented "no ceiling configured" default. */
export interface GeneralSettings extends Required<Omit<SettingsPatch, "spending" | "containment">> {
  readonly spending?: { sessionUsd?: number; globalUsd?: number };
  readonly containment?: SettingsPatch["containment"];
}

// -- Spending ceilings (J-CONTEXT-BUDGET) ------------------------------------------------------

/** Validates the durable spending-ceiling patch. Mirrors the billing ledger's own parser so the
 *  capability and the enforcement layer cannot drift apart. */
export function isSpendingCeilings(value: unknown): value is { sessionUsd?: number; globalUsd?: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    return parseSpendingCeilings(value) !== undefined;
  } catch {
    return false;
  }
}

// -- Aggregate containment quotas (T8, J-RW-AGGREGATE-CONTAINMENT) -------------------------------

/** Validates the durable aggregate-containment patch. Mirrors the containment ledger's own
 *  parser so the capability and the enforcement layer cannot drift apart. The empty object is
 *  the explicit "clear the quotas" patch, like spending's. */
export function isContainmentQuotas(value: unknown): value is NonNullable<SettingsPatch["containment"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Object.keys(value).length === 0) return true; // {} = clear all quotas
  try {
    return parseContainmentQuotas(value) !== undefined;
  } catch {
    return false;
  }
}

// -- Global plugins -----------------------------------------------------------------------------

/** The global plugins a client can actually toggle (`settings.changePlugin`): only entries with
 *  real runtime behavior behind them. RealityTrace observations gate the SXR evidence delivery
 *  (`wireObservations`' drain gate); the other global plugins in the UI's inventory are always-on
 *  compositions, so their switches stay informational (docs/known-gaps.md). */
export const TOGGLEABLE_PLUGINS: readonly string[] = ["realitytrace"];

export function isToggleablePluginId(value: unknown): value is string {
  return typeof value === "string" && (TOGGLEABLE_PLUGINS as readonly string[]).includes(value);
}

/** A `settings.changePlugin` patch: at least one toggleable plugin id mapped to a boolean. */
export function isPluginStatePatch(value: unknown): value is Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([id, enabled]) => isToggleablePluginId(id) && typeof enabled === "boolean");
}

/** Read-side helper: a plugin is enabled only when the durable map says so — absence means off. */
export function pluginEnabled(plugins: unknown, id: string): boolean {
  return typeof plugins === "object" && plugins !== null && !Array.isArray(plugins) && (plugins as Record<string, unknown>)[id] === true;
}

/**
 * Resolves a projection row's value (or anything) into a complete `GeneralSettings`, defaulting
 * each absent/invalid field. `legacyAppearance` is the pre-U2 `localStorage["cognate.theme"]`
 * value ("light"/"dark"): theme persistence migrated into the durable settings row this tranche,
 * and a home last used by an older build keeps its stored theme until the first explicit choice
 * writes a durable `appearance` (see docs/known-gaps.md).
 */
export function resolveGeneralSettings(value: unknown, legacyAppearance?: string): GeneralSettings {
  const row = (value ?? {}) as Partial<Record<keyof SettingsPatch, unknown>>;
  return {
    workDetails: isWorkDetailsMode(row.workDetails) ? row.workDetails : "standard",
    permission: isPermissionMode(row.permission) ? row.permission : DEFAULT_PERMISSION_MODE,
    language: isLanguageCode(row.language) ? row.language : DEFAULT_LANGUAGE,
    appearance: isAppearanceMode(row.appearance)
      ? row.appearance
      : legacyAppearance === "dark" || legacyAppearance === "light"
        ? legacyAppearance
        : DEFAULT_APPEARANCE,
    fontSize: isFontSizePx(row.fontSize) ? row.fontSize : DEFAULT_FONT_SIZE_PX,
    performanceDetail: isPerformanceDetailMode(row.performanceDetail) ? row.performanceDetail : DEFAULT_PERFORMANCE_DETAIL,
    codingTools: typeof row.codingTools === "boolean" ? row.codingTools : DEFAULT_CODING_TOOLS,
    sendBehavior: isSendBehavior(row.sendBehavior) ? row.sendBehavior : DEFAULT_SEND_BEHAVIOR,
    preset: isAgentPreset(row.preset) ? row.preset : DEFAULT_AGENT_PRESET,
    plugins: isPluginStatePatch(row.plugins) ? row.plugins : {},
    // T11: an absent shortcuts field means "no overrides", which resolveAll() falls back to the
    // shipped defaults for — so a fresh home behaves exactly as before editing existed.
    shortcuts: isShortcutOverrides(row.shortcuts) ? row.shortcuts : {},
    // J-CONTEXT-BUDGET: absent ceilings mean "no ceiling configured"; invalid stored values are
    // ignored on read but fail closed at dispatch time through the ledger's own parser.
    spending: isSpendingCeilings(row.spending) ? row.spending : undefined,
    // T8: absent quotas keep the historical no-aggregate-quota behavior; the containment ledger's
    // own parser fails closed on invalid stored values at admission time.
    containment: isContainmentQuotas(row.containment) ? row.containment : undefined,
  };
}
