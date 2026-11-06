// Component specifications for the composer's Task-checkout control (J-CHECKOUT-LIFECYCLE). The
// component itself owns hooks and capability calls; these pure helpers are what a person reads and
// what the form proposes, so they are asserted here instead of through a React tree.
import { describe, expect, test } from "bun:test";
import { canMerge, checkoutStatusText, mergeOutcomeText, suggestBranchName } from "../src/workbench/checkoutUi.ts";
import type { WorktreeStatus } from "../src/workbench/gitOps.ts";

const status = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  exists: true,
  branch: "workbench/feature",
  changes: 0,
  clean: true,
  hasUpstream: false,
  ahead: 0,
  pending: 0,
  merged: false,
  ...overrides,
});

describe("checkout UI helpers", () => {
  test("suggestBranchName slugs the title and falls back to the task id", () => {
    expect(suggestBranchName("Fix the flaky merge", "task-1")).toBe("fix-the-flaky-merge");
    expect(suggestBranchName("  Release: 2026.1 / beta  ", "task-1")).toBe("release-2026-1-beta");
    expect(suggestBranchName("!!!", "task-abc")).toBe("task-abc");
    expect(suggestBranchName("", "task-abc")).toBe("task-abc");
    const long = suggestBranchName("a".repeat(80), "task-1");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("-")).toBe(false);
  });

  test("checkoutStatusText leads with what needs action", () => {
    expect(checkoutStatusText(status({ exists: false }))).toBe("checkout folder missing — recreate it");
    expect(checkoutStatusText(status({ changes: 2, clean: false }))).toBe("2 uncommitted changes");
    expect(checkoutStatusText(status({ changes: 1, clean: false }))).toBe("1 uncommitted change");
    expect(checkoutStatusText(status({ ahead: 1 }))).toBe("1 unpushed commit");
    expect(checkoutStatusText(status({ pending: 2 }))).toBe("2 commits to merge");
    expect(checkoutStatusText(status({ pending: 1, merged: false }))).toBe("1 commit to merge");
    expect(checkoutStatusText(status())).toBe("clean");
    expect(checkoutStatusText(status({ changes: 3, clean: false, ahead: 2 }))).toBe("3 uncommitted changes · 2 unpushed commits");
  });

  test("canMerge requires an existing, not-yet-merged checkout", () => {
    expect(canMerge(undefined)).toBe(false);
    expect(canMerge(status({ exists: false }))).toBe(false);
    expect(canMerge(status({ merged: true }))).toBe(false);
    expect(canMerge(status({ pending: 0 }))).toBe(false);
    expect(canMerge(status({ pending: 3, merged: false }))).toBe(true);
  });

  test("mergeOutcomeText reports a conflict as a warning with the files, never as success", () => {
    const conflict = mergeOutcomeText({ conflicted: true, conflicts: ["src/greet.ts", "README.md"], target: "main" });
    expect(conflict.kind).toBe("warn");
    expect(conflict.text).toContain("nothing changed");
    expect(conflict.text).toContain("src/greet.ts, README.md");

    const ok = mergeOutcomeText({ commits: 2, target: "main" });
    expect(ok.kind).toBe("ok");
    expect(ok.text).toBe("Merged 2 commits into main.");
    expect(mergeOutcomeText({ commits: 1, target: "main" }).text).toBe("Merged 1 commit into main.");
  });
});
