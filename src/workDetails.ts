// Work-details presentation mode: shared between the durable event/projection layer
// (agentConfig.ts, capabilities/settingsChange.ts, projections/settings.ts) and the UI
// (src/ui/App.tsx). Mirrors the reference's own `TRANSCRIPT_VIEW_MODES` (Settings -> General ->
// "Work details" — "Choose how much detail to show for tool calls", .tmp/ref/deepseek-harness/
// packages/client/ui-chat/src/chat-settings.ts) — four modes, default "standard".
export const WORK_DETAILS_MODES = ["compact", "standard", "detailed", "verbose"] as const;

export type WorkDetailsMode = (typeof WORK_DETAILS_MODES)[number];

export const DEFAULT_WORK_DETAILS_MODE: WorkDetailsMode = "standard";

export const WORK_DETAILS_LABELS: Readonly<Record<WorkDetailsMode, string>> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  verbose: "Verbose",
};

export function isWorkDetailsMode(value: unknown): value is WorkDetailsMode {
  return typeof value === "string" && (WORK_DETAILS_MODES as readonly string[]).includes(value);
}

/**
 * Whether the running-tool activity label shows its detail suffix (path/command/description after
 * "· "), e.g. "Reading files · src/greet.ts" vs. plain "Reading files". Ported directly from the
 * reference's own presentation-policy table (.tmp/ref/deepseek-harness/packages/client/ui-chat/src/
 * client/presentation-policy.ts POLICIES[mode].liveProcessDetail) — true for "standard"/"detailed",
 * false for "compact"/"verbose". This is the one field of that table with a direct analogue in this
 * app's much simpler single-running-tool-button UI (src/ui/App.tsx's `toolActionLabel`); the
 * reference's other fields (foldCompletedTurns, stepGrouping, settledReasoningPreview) govern
 * completed-turn history grouping this app does not reproduce (see docs/known-gaps.md).
 */
export function showsLiveProcessDetail(mode: WorkDetailsMode): boolean {
  return mode === "standard" || mode === "detailed";
}
