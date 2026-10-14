// `planGate`: pure helpers for journey `J-E-plan` (`.sea/interaction/interaction-model.sea`'s
// `Entity "PlanMode"`), mirroring `approvalGate.ts`'s shape — `exit_plan_mode` is the same
// `PreToolDecision`/human-approval waterfall as `run_code`'s sandbox escalation (J-D-approval),
// applied to a different tool (canonical-journey-catalog.md `j_e_plan`: "the same `PreToolDecision`/
// approval waterfall as J-D, applied to a different tool"). Modeled as a distinct continuation type
// ("plan-review", not "tool-approval") because its payload/outcome shape and semantics differ (a
// plan heading/markdown to review, not a permission escalation to allow/deny).
const PLAN_PREFIX = /^\/plan\b\s*/i;

/** True for a message that is exactly the `/plan off` slash command (case/space-insensitive). */
export function isPlanOffCommand(message: string): boolean {
  return /^\/plan\s+off$/i.test(message.trim());
}

/** Splits a leading `/plan ` prefix (composer literal-insertion, reference-behavior-matrix.md §6.3)
 *  from the task text that follows it. Returns `undefined` if the message carries no such prefix. */
export function splitPlanPrefix(message: string): { readonly task: string } | undefined {
  if (isPlanOffCommand(message)) return undefined;
  const match = message.match(PLAN_PREFIX);
  if (!match) return undefined;
  return { task: message.slice(match[0].length) };
}

/** The plan's `heading` is its markdown's first `#`-level heading line (reference:
 *  `exit_plan_mode.plan` argument, e.g. `"# Update greeting\n\n1. ..."` -> `"Update greeting"`).
 *  Falls back to a truncated first line if the plan carries no heading. */
export function extractPlanHeading(markdown: string): string {
  const headingLine = markdown.split("\n").find((line) => /^#{1,6}\s+/.test(line));
  if (headingLine) return headingLine.replace(/^#{1,6}\s+/, "").trim();
  const firstLine = markdown.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.trim().slice(0, 80);
}

/** The exact denial text the reference feeds back when `exit_plan_mode` is called outside plan mode
 *  (reference-behavior-matrix.md §6.3: `Tool result: Error: exit_plan_mode is only available in
 *  plan mode`; the mock server's `__REFLECT_TOOL_RESULT__` step prepends `Tool result: `). */
export const EXIT_PLAN_MODE_NOT_IN_PLAN_MODE = "Error: exit_plan_mode is only available in plan mode";

/** The exact reflection text on Approve (reference-behavior-matrix.md §6.3, verbatim). */
export const PLAN_APPROVED_TOOL_RESULT =
  'Plan approved — plan mode exited; carry out the plan starting with your next step.';

/** "Request changes" (the plan journey's deny-equivalent) was not exercised against the pinned
 *  reference build (reference-behavior-matrix.md §6.3: "not exercised this pass — flagged under
 *  'Still unresolved'"). This wording is this app's own invention, shaped by
 *  `canonical-journey-catalog.md` `j_e_plan`'s step description ("feedback returned as a failed tool
 *  call; agent revises and re-presents") rather than copied from any observed reference string — see
 *  docs/known-gaps.md. */
export function planRequestChangesToolResult(feedback: string | undefined): string {
  const suffix = feedback && feedback.trim().length > 0 ? `: ${feedback.trim()}` : "";
  return `Error: the user requested changes to this plan${suffix}; revise the plan and call exit_plan_mode again`;
}
