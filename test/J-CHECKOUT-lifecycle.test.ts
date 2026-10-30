// Journey J-CHECKOUT-LIFECYCLE: the operator's safe integration and cleanup of a Task's isolated
// checkout. Every refusal here protects work that exists only in a worktree: a dirty checkout is
// never removed, an unmerged branch is never deleted, a missing checkout is diagnosed and
// recreated rather than silently re-pointed at the workspace root, and a conflicting merge reports
// its files and leaves both checkouts exactly as they were. A RUNNING task is never re-pointed.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { TaskRecord } from "../src/workbench/state.ts";
import { bootApp, createTask, fullContract, gitIn, inv, seedWorkspaceOnly, waitForRow, withTempHome } from "./wb-helpers.ts";

interface Attached {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly root: string;
  readonly branch: string;
  readonly kind: string;
}

interface Removal {
  readonly taskId: string;
  readonly removed: boolean;
  readonly branch: string;
  readonly branchDeleted: boolean;
  readonly note: string;
}

interface Merged {
  readonly taskId: string;
  readonly branch: string;
  readonly target: string;
  readonly commits: number;
}

describe("J-CHECKOUT-lifecycle", () => {
  test("a dirty worktree is never removed; an unmerged branch outlives its checkout", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Dirty work");
        const attached = (await inv(client, "git.checkout.attach", { taskId, branch: "feature-dirty" })) as unknown as Attached;

        await writeFile(join(attached.root, "wip.txt"), "not committed yet\n");
        let dirtyRefusal: unknown;
        try {
          await inv(client, "git.checkout.remove", { taskId });
        } catch (error) {
          dirtyRefusal = error;
        }
        expect(String((dirtyRefusal as Error)?.message ?? dirtyRefusal)).toMatch(/uncommitted changes/);
        expect(existsSync(join(attached.root, "wip.txt"))).toBe(true);

        await gitIn(attached.root, ["add", "-A"]);
        await gitIn(attached.root, ["commit", "-m", "Work in progress"]);

        const removal = (await inv(client, "git.checkout.remove", { taskId, deleteBranch: true })) as unknown as Removal;
        expect(removal.removed).toBe(true);
        expect(removal.branch).toBe("workbench/feature-dirty");
        // `branch -d` refuses to delete a branch with commits not on the target — work is preserved.
        expect(removal.branchDeleted).toBe(false);
        expect(existsSync(attached.root)).toBe(false);
        expect((await gitIn(workspaceDir, ["rev-parse", "--verify", "--quiet", "refs/heads/workbench/feature-dirty"])).trim()).not.toBe("");

        // The association is gone with the checkout; the event history is not.
        expect(await inv(client, "task.checkout.resolve", { taskId })).toBeNull();
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a vanished worktree is reported and can be recreated with the branch's work intact", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Vanished checkout");
        const attached = (await inv(client, "git.checkout.attach", { taskId, branch: "feature-vanish" })) as unknown as Attached;

        await writeFile(join(attached.root, "kept.txt"), "committed work\n");
        await gitIn(attached.root, ["add", "-A"]);
        await gitIn(attached.root, ["commit", "-m", "Committed work"]);

        await rm(attached.root, { recursive: true, force: true });
        const missing = (await inv(client, "git.checkout.status", { taskId })) as unknown as { readonly exists: boolean; readonly root: string };
        expect(missing.exists).toBe(false);
        expect(missing.root).toBe(attached.root);

        const recreated = (await inv(client, "git.checkout.recreate", { taskId })) as unknown as { readonly root: string; readonly branch: string };
        expect(recreated.root).toBe(attached.root);
        expect(recreated.branch).toBe("workbench/feature-vanish");
        expect(await readFile(join(recreated.root, "kept.txt"), "utf8")).toBe("committed work\n");

        const status = (await inv(client, "git.checkout.status", { taskId })) as unknown as { readonly exists: boolean; readonly clean: boolean };
        expect(status.exists).toBe(true);
        expect(status.clean).toBe(true);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a conflicting merge reports its files and rethrows nothing into either checkout", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Conflicting work");
        const attached = (await inv(client, "git.checkout.attach", { taskId, branch: "feature-conflict" })) as unknown as Attached;

        await writeFile(join(attached.root, "src", "greet.ts"), "// from the worktree\n");
        await gitIn(attached.root, ["commit", "-am", "Worktree change"]);
        await writeFile(join(workspaceDir, "src", "greet.ts"), "// from main\n");
        await gitIn(workspaceDir, ["commit", "-am", "Main change"]);

        const merged = (await inv(client, "git.checkout.merge", { taskId })) as unknown as {
          readonly conflicted: boolean;
          readonly conflicts: readonly string[];
          readonly message: string;
          readonly target: string;
        };
        expect(merged.conflicted).toBe(true);
        expect(merged.conflicts).toContain("src/greet.ts");
        expect(merged.message).toMatch(/conflict/i);

        // The merge was aborted: main keeps its own content and has no in-progress merge state.
        expect(await readFile(join(workspaceDir, "src", "greet.ts"), "utf8")).toBe("// from main\n");
        expect((await gitIn(workspaceDir, ["status", "--porcelain"])).trim()).toBe("");
        expect(existsSync(join(workspaceDir, ".git", "MERGE_HEAD"))).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a clean merge lands the branch's commits on the target and the status reports merged", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Clean work");
        const attached = (await inv(client, "git.checkout.attach", { taskId, branch: "feature-merge" })) as unknown as Attached;

        await writeFile(join(attached.root, "feature.md"), "# Feature\n");
        await gitIn(attached.root, ["add", "-A"]);
        await gitIn(attached.root, ["commit", "-m", "Add the feature note"]);

        const merged = (await inv(client, "git.checkout.merge", { taskId })) as unknown as Merged;
        expect(merged.target).toBe("main");
        expect(merged.commits).toBeGreaterThanOrEqual(1);
        expect(await readFile(join(workspaceDir, "feature.md"), "utf8")).toBe("# Feature\n");

        const status = (await inv(client, "git.checkout.status", { taskId })) as unknown as { readonly merged: boolean; readonly clean: boolean };
        expect(status.merged).toBe(true);
        expect(status.clean).toBe(true);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a RUNNING task's checkout is never re-pointed, merged, or removed", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Running work", fullContract(workspaceId));
        await inv(client, "git.checkout.attach", { taskId, branch: "feature-running" });
        // The workbench projection folds asynchronously: each transition must be visible before
        // the next one is requested, exactly as the UI waits for the row.
        await inv(client, "task.status.change", { taskId, to: "READY" });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (task) => task.status === "READY");
        await inv(client, "task.status.change", { taskId, to: "RUNNING" });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (task) => task.status === "RUNNING");

        await expect(inv(client, "git.checkout.attach", { taskId, branch: "feature-other" })).rejects.toThrow(/RUNNING/);
        await expect(inv(client, "git.checkout.merge", { taskId })).rejects.toThrow(/RUNNING/);
        await expect(inv(client, "git.checkout.remove", { taskId })).rejects.toThrow(/RUNNING/);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a non-repository workspace is refused with the reason; existing branches are adoptable", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seedWorkspaceOnly(client, home);

        // Adoption: a pre-existing (already namespaced) branch is adopted, never re-created.
        await gitIn(workspaceDir, ["branch", "workbench/feature-existing"]);
        const branches = (await inv(client, "git.branch.list", { workspaceId })) as unknown as {
          readonly default: string;
          readonly branches: readonly string[];
        };
        expect(branches.default).toBe("main");
        expect(branches.branches).toContain("workbench/feature-existing");
        const adopter = await createTask(app, client, workspaceId, "Adopting task");
        const adopted = (await inv(client, "git.checkout.attach", { taskId: adopter, branch: "workbench/feature-existing", existing: true })) as unknown as Attached;
        expect(adopted.branch).toBe("workbench/feature-existing");

        // A plain folder is not a repository: honest refusal, no worktree created beside it.
        const plain = join(home, "plain-folder");
        await mkdir(plain);
        const { workspaceId: plainId } = (await inv(client, "workspace.select", { path: plain })) as unknown as { readonly workspaceId: string };
        const plainTask = await createTask(app, client, plainId, "Plain task");
        const notRepoError = async (): Promise<Error | undefined> => {
          try {
            await inv(client, "git.checkout.attach", { taskId: plainTask, branch: "feature-plain" });
            return undefined;
          } catch (error) {
            return error as Error;
          }
        };
        let notRepo: Error | undefined;
        for (let attempt = 0; attempt < 400; attempt++) {
          const error = await notRepoError();
          if (error && /not a Git repository/.test(String(error.message ?? error))) { notRepo = error; break; }
          await Bun.sleep(25);
        }
        expect(notRepo).toBeDefined();
        expect(existsSync(`${plain}-worktrees`)).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a live checkout is never silently re-pointed, and two tasks never share one", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const taskA = await createTask(app, client, workspaceId, "First slice", fullContract(workspaceId));
        const a = (await inv(client, "git.checkout.attach", { taskId: taskA, branch: "feature-shared" })) as unknown as Attached;
        expect(existsSync(a.root)).toBe(true);

        // Re-pointing while the old worktree is live would leave a registration nothing manages.
        await expect(inv(client, "git.checkout.attach", { taskId: taskA, branch: "feature-second" })).rejects.toThrow(/already works in/);
        expect(existsSync(a.root)).toBe(true);
        expect(existsSync(join(a.root, "..", "workbench-feature-second"))).toBe(false);

        // A second task cannot claim the same branch, and the refusal creates nothing.
        const taskB = await createTask(app, client, workspaceId, "Second slice");
        await expect(inv(client, "git.checkout.attach", { taskId: taskB, branch: "workbench/feature-shared" })).rejects.toThrow(/another task already works/);
        const listing = await gitIn(a.root, ["worktree", "list", "--porcelain"]);
        expect(listing.split("\n").filter(line => line.startsWith("worktree ")).length).toBe(2);

        // Once the first checkout is retired the branch is genuinely free.
        const removal = (await inv(client, "git.checkout.remove", { taskId: taskA, deleteBranch: true })) as unknown as Removal;
        expect(removal.removed).toBe(true);
        expect(removal.branchDeleted).toBe(true);
        const b = (await inv(client, "git.checkout.attach", { taskId: taskB, branch: "feature-shared" })) as unknown as Attached;
        expect(b.branch).toBe("workbench/feature-shared");
        expect(b.root).toBe(a.root);
        expect(existsSync(b.root)).toBe(true);
        await expect(inv(client, "git.checkout.status", { taskId: taskA })).rejects.toThrow(/no checkout binding/);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);
});
