// Unit coverage for the pure worktree helpers in `src/workbench/gitOps.ts` — the parts a journey
// test would only reach indirectly: name namespacing/validation, the sibling-worktree layout, and
// the `worktree list --porcelain` parser (including prunable registrations whose folder is gone).
import { describe, expect, test } from "bun:test";
import { checkoutBranchName, parseWorktreeList, validStartPoint, worktreeDestination } from "../src/workbench/gitOps.ts";

describe("gitOps pure helpers", () => {
  test("checkoutBranchName namespaces once and rejects unsafe names", () => {
    expect(checkoutBranchName("feature-a")).toBe("workbench/feature-a");
    expect(checkoutBranchName("workbench/feature-a")).toBe("workbench/feature-a");
    expect(checkoutBranchName(" Feature/A_1 ")).toBe("workbench/Feature/A_1");
    expect(() => checkoutBranchName("")).toThrow(/branch name/);
    expect(() => checkoutBranchName("a..b")).toThrow(/branch name/);
    expect(() => checkoutBranchName("bad name")).toThrow(/branch name/);
    expect(() => checkoutBranchName("bad~name")).toThrow(/branch name/);
    expect(() => checkoutBranchName("x".repeat(121))).toThrow(/branch name/);
  });

  test("validStartPoint accepts plain local branch names and refuses options and ranges", () => {
    expect(validStartPoint("main")).toBe(true);
    expect(validStartPoint("release/2026.1")).toBe(true);
    expect(validStartPoint("v1.0.0")).toBe(true);
    expect(validStartPoint("")).toBe(false);
    expect(validStartPoint("--force")).toBe(false);
    expect(validStartPoint("main..other")).toBe(false);
    expect(validStartPoint("main;rm -rf /")).toBe(false);
  });

  test("worktreeDestination places checkouts beside the repository, branch slashes dashed", () => {
    expect(worktreeDestination("/home/op/project", "workbench/feature-a")).toBe("/home/op/project-worktrees/workbench-feature-a");
    expect(worktreeDestination("/home/op/project/", "workbench/x/y")).toBe("/home/op/project-worktrees/workbench-x-y");
  });

  test("parseWorktreeList reads each porcelain block, including prunable registrations", () => {
    const text = [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo-worktrees/workbench-feature-a",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/workbench/feature-a",
      "",
      "worktree /repo-worktrees/detached",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
      "worktree /repo-worktrees/gone",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/workbench/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    const entries = parseWorktreeList(text);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({ path: "/repo", branch: "main", detached: false, prunable: false });
    expect(entries[1]).toEqual({ path: "/repo-worktrees/workbench-feature-a", branch: "workbench/feature-a", detached: false, prunable: false });
    expect(entries[2]).toEqual({ path: "/repo-worktrees/detached", branch: "", detached: true, prunable: false });
    expect(entries[3]).toEqual({ path: "/repo-worktrees/gone", branch: "workbench/gone", detached: false, prunable: true });
  });
});
