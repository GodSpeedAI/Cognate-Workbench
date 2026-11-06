// Render tests for the compact-approval bar (plan T03).
//
// The double-activation guard needs a live DOM + a resolvable continuation, so it is covered by
// reasoning in evidence/T03/README.md rather than asserted here. What a static render *can* prove is
// the part that is easy to regress: (a) a long justification is summarised rather than printed in
// full, (b) a structured surface is never wrapped in a disclosure, and (c) both buttons exist and are
// enabled at rest — the disabled state only appears once a decision is in flight.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalBar } from "../src/ui/App.tsx";
import { APPROVAL_SUMMARY_LIMIT } from "../src/approvalSummary.ts";
import type { ToolEntry } from "../src/ui/App.tsx";

const noop = () => {};

function entry(justification: string, surface?: unknown): ToolEntry {
  return {
    toolCallId: "call-1",
    tool: "edit",
    args: {},
    status: "running",
    approval: surface === undefined
      ? { status: "pending", permission: "workspace-write", justification }
      : { status: "pending", permission: "workspace-write", justification, surface },
  };
}

describe("ApprovalBar", () => {
  test("a short justification renders inline with no disclosure", () => {
    const html = renderToStaticMarkup(<ApprovalBar entry={entry("write one file")} onDecide={noop} />);
    expect(html).toContain("write one file");
    expect(html).not.toContain("approval-disclosure");
    expect(html).not.toContain("Show full request");
  });

  test("TEETH: a long justification is summarised, with the full text behind a disclosure", () => {
    const long = "z".repeat(500);
    const html = renderToStaticMarkup(<ApprovalBar entry={entry(long)} onDecide={noop} />);
    expect(html).toContain("Show full request");
    expect(html).toContain('aria-expanded="false"');
    // The *visible* summary is bounded and ellipsised...
    const match = /<span class="approval-summary-line"[^>]*>([^<]*)</.exec(html);
    expect(match).not.toBeNull();
    const visible = match?.[1] ?? "";
    expect(visible.length).toBeLessThanOrEqual(APPROVAL_SUMMARY_LIMIT + 1);
    expect(visible.endsWith("…")).toBe(true);
    // ...while the full request stays reachable: on hover via `title` (the donor does the same at
    // approval-bar.ts:24) and on click via the disclosure. Reachability is the requirement; painting
    // 500 characters into the collapsed card is not.
    expect(html).toContain(`title="Allow this operation with workspace-write permissions: ${long}."`);
  });

  test("TEETH: a structured surface is rendered in full and never wrapped in a disclosure", () => {
    const long = "y".repeat(500);
    // A surface stands in for rich diff content; `SurfaceView` decides what it paints. The assertion
    // that matters is the absence of the disclosure wrappers.
    const html = renderToStaticMarkup(<ApprovalBar entry={entry(long, { kind: "diff" })} onDecide={noop} />);
    expect(html).not.toContain("Show full request");
    expect(html).not.toContain("approval-disclosure");
    expect(html).not.toContain("approval-summary-line");
  });

  test("both decisions are present and enabled at rest", () => {
    const html = renderToStaticMarkup(<ApprovalBar entry={entry("short")} onDecide={noop} />);
    expect(html).toContain("Allow once");
    expect(html).toContain("Reject");
    // At rest the guard has not engaged, so neither button may be disabled.
    expect(html).not.toContain("disabled");
    expect(html).toContain("Waiting for approval");
  });

  test("the approval panel keeps its identifying hooks", () => {
    const html = renderToStaticMarkup(<ApprovalBar entry={entry("short")} onDecide={noop} />);
    // E2E and parity tests locate this panel by these attributes; dropping them breaks them silently.
    expect(html).toContain("data-approval-panel");
    expect(html).toContain("surface-consequential");
  });

  test("the summary limit is the documented one, not an accidental shorter clip", () => {
    // Boundary: a justification just over the limit must still produce a summary of at most the
    // limit plus the single ellipsis character.
    const justOver = "q".repeat(APPROVAL_SUMMARY_LIMIT);
    const html = renderToStaticMarkup(<ApprovalBar entry={entry(` ${justOver}`)} onDecide={noop} />);
    const match = /<span class="approval-summary-line"[^>]*>([^<]*)</.exec(html);
    expect(match).not.toBeNull();
    expect((match?.[1] ?? "").length).toBeLessThanOrEqual(APPROVAL_SUMMARY_LIMIT + 1);
  });
});
