// Compact approvals (plan T03) — the pure summarisation half.
//
// Ported from PandaCode 0.3.56 `src/approval-bar.ts:10-13`: a pending approval's request text is
// reduced to its first meaningful line, stripped of Markdown code ticks, and clipped to 240
// characters, so a long justification can never push Deny/Approve out of view.
//
// Deliberately scope-limited. The donor can also group several pending approvals into one line
// ("N approvals needed" / "Approve all", `approval-bar.ts:32-36`); this runtime cannot produce two
// pending approvals at once — `pendingApproval` is a single `.find()`
// (`src/ui/App.tsx`, `toolEntries.find(e => e.approval?.status === "pending")`) over a sequential
// tool loop — so that mechanism is excluded rather than stubbed. See delta-matrix.md §3.3.

/** Characters kept before the ellipsis. The donor's limit (`approval-bar.ts:12`). */
export const APPROVAL_SUMMARY_LIMIT = 240;

/** Shown when the request text has no meaningful content at all, so the bar never renders blank. */
export const APPROVAL_FALLBACK_SUMMARY = "Approval needed";

export interface ApprovalSummary {
  /** The one-line form: first non-empty line, backticks removed, clipped to the limit. */
  readonly line: string;
  /** True when `line` is a truncation of the full text, so the UI can offer a disclosure. */
  readonly isLong: boolean;
}

/** Reduce an approval request to one display line.
 *
 *  Rules, all from the donor: split on newlines, strip every backtick run from each part, trim, take
 *  the first part that is non-empty, and clip at the limit with a single `…` (never `...`, and never
 *  double-appended).
 */
export function summarizeApproval(text: string): ApprovalSummary {
  const line =
    text
      .split("\n")
      .map((part) => part.replace(/`+/g, "").trim())
      .find((part) => part.length > 0) ?? APPROVAL_FALLBACK_SUMMARY;

  if (line.length > APPROVAL_SUMMARY_LIMIT) {
    // Clip before appending the ellipsis so the total stays at the limit, not limit+1.
    return { line: `${line.slice(0, APPROVAL_SUMMARY_LIMIT)}…`, isLong: true };
  }
  return { line, isLong: false };
}

/** Whether a disclosure should be offered for this approval.
 *
 *  `structured` suppresses it: `SurfaceView` renders rich diff/structured content that must never be
 *  clipped or collapsed (plan T03 hot_context), so a surface-bearing approval is summarised only if
 *  its text is long *and* there is no surface to show instead.
 */
export function approvalNeedsDisclosure(summary: ApprovalSummary, structured: boolean): boolean {
  return summary.isLong && !structured;
}
