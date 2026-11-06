// Unit tests for compact-approval summarisation (plan T03).
//
// The double-activation guard lives in the component (`ApprovalBar`) and needs a live DOM to test,
// so it is reasoned about separately in evidence/T03/README.md. What is proved here is the text
// reduction, where an off-by-one or a swallowed backtick is easy to ship and hard to notice.
import { describe, expect, test } from "bun:test";
import {
  APPROVAL_FALLBACK_SUMMARY,
  APPROVAL_SUMMARY_LIMIT,
  approvalNeedsDisclosure,
  summarizeApproval,
} from "../src/approvalSummary.ts";

describe("summarizeApproval", () => {
  test("takes the first meaningful line", () => {
    const summary = summarizeApproval("Allow writing to src/a.ts\n\nThis edits one file.");
    expect(summary.line).toBe("Allow writing to src/a.ts");
    expect(summary.isLong).toBe(false);
  });

  test("skips leading blank and whitespace-only lines", () => {
    expect(summarizeApproval("\n\n   \nThe real line").line).toBe("The real line");
  });

  test("strips backticks but keeps the code content readable", () => {
    // Markdown ticks are noise in a one-line summary; the words inside them are the useful part.
    expect(summarizeApproval("Runs `rm -rf build` in `./dist`").line).toBe("Runs rm -rf build in ./dist");
  });

  test("TEETH: a 500-char line is clipped to the limit, backticks gone, original still recoverable", () => {
    const long = `\`\`\`${"a".repeat(500)}`;
    const summary = summarizeApproval(long);
    // The rendered line, ellipsis included, must not exceed the limit.
    expect(summary.line.length).toBeLessThanOrEqual(APPROVAL_SUMMARY_LIMIT + 1);
    expect(summary.line.endsWith("…")).toBe(true);
    expect(summary.line).not.toContain("`");
    expect(summary.isLong).toBe(true);
    // The caller keeps the original string, so the full text stays reachable via the disclosure.
    expect(long.length).toBeGreaterThan(APPROVAL_SUMMARY_LIMIT);
  });

  test("a line exactly at the limit is not truncated", () => {
    const exact = "b".repeat(APPROVAL_SUMMARY_LIMIT);
    const summary = summarizeApproval(exact);
    expect(summary.line).toBe(exact);
    expect(summary.isLong).toBe(false);
  });

  test("a line one over the limit is truncated", () => {
    const over = "c".repeat(APPROVAL_SUMMARY_LIMIT + 1);
    const summary = summarizeApproval(over);
    expect(summary.isLong).toBe(true);
    expect(summary.line).toBe(`${"c".repeat(APPROVAL_SUMMARY_LIMIT)}…`);
  });

  test("empty or whitespace-only text falls back instead of rendering blank", () => {
    expect(summarizeApproval("").line).toBe(APPROVAL_FALLBACK_SUMMARY);
    expect(summarizeApproval("   \n\t\n").line).toBe(APPROVAL_FALLBACK_SUMMARY);
  });

  test("text that is only backticks falls back rather than showing an empty summary", () => {
    // Stripping the ticks leaves nothing, so the `.find(Boolean)` must skip that line.
    expect(summarizeApproval("```").line).toBe(APPROVAL_FALLBACK_SUMMARY);
  });

  test("only the first line is kept, not a joined multi-line blob", () => {
    const summary = summarizeApproval("First\nSecond\nThird");
    expect(summary.line).toBe("First");
    expect(summary.line).not.toContain("Second");
  });
});

describe("approvalNeedsDisclosure", () => {
  test("TEETH: a structured surface suppresses the disclosure entirely", () => {
    // SurfaceView renders rich diff content that must never be clipped or collapsed.
    const long = summarizeApproval("x".repeat(500));
    expect(long.isLong).toBe(true);
    expect(approvalNeedsDisclosure(long, true)).toBe(false);
  });

  test("a long plain-text approval does offer a disclosure", () => {
    expect(approvalNeedsDisclosure(summarizeApproval("x".repeat(500)), false)).toBe(true);
  });

  test("a short approval offers nothing to expand", () => {
    expect(approvalNeedsDisclosure(summarizeApproval("Short request"), false)).toBe(false);
  });
});
