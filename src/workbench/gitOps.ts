// Bounded Git operations for task-scoped checkouts (J-CHECKOUT, PandaCode worktree affordance).
//
// Every Git call runs *through the workspace's execution-world provider* (`process.exec` with an
// explicit argv array) — never through a host shell, never through string interpolation — so a
// worktree of a WSL or SSH workspace is created on the machine that owns the repository, and a
// contained world is refused by the caller rather than silently degraded. Mechanisms (validation,
// refusal wording, safety semantics) are ported from PandaCode 0.3.56 `src-tauri/src/workspace.rs`
// (OBSERVED at donor commit ceed919); no donor code is copied.
//
// Invariants: nothing forces. `remove` relies on Git's own dirty refusal plus an explicit
// pre-check; branches are deleted only with `-d` (never `-D`), so an unmerged branch survives.
// A conflicted merge is aborted and reported, never claimed as integrated.
import type { ExecutionWorldProvider } from "@godspeedai/cognate-execution";
import { dirname, basename, posix } from "node:path";

/** Kinds of worlds whose process port can reach a sibling checkout of the repository root.
 *  Fail closed: anything else (contained bubblewrap sandboxes, the in-process memory world, new
 *  kinds) is refused by the caller with the reason, never silently run on the wrong machine. */
export const WORKTREE_CAPABLE_WORLD_KINDS: ReadonlySet<string> = new Set(["local", "wsl", "ssh"]);

export interface GitOutput {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

/** Run one Git command with an explicit argv, bounded output and a timeout. The single spawner —
 *  no other function in this module starts a process. */
export async function runGit(
  provider: ExecutionWorldProvider,
  cwd: string,
  args: readonly string[],
  options: { readonly limitBytes?: number; readonly timeoutMs?: number } = {},
): Promise<GitOutput> {
  const limit = options.limitBytes ?? 256 * 1024;
  const result = await provider.process.exec({ argv: ["git", ...args], cwd, timeoutMs: options.timeoutMs ?? 30_000 });
  const clip = (text: string): { readonly text: string; readonly truncated: boolean } => {
    const clipped = text.length > limit ? text.slice(0, limit) : text;
    return { text: clipped, truncated: clipped !== text };
  };
  const out = clip(result.stdout);
  const err = clip(result.stderr);
  if (result.timedOut) throw new Error(`git ${args[0] ?? ""} timed out in ${cwd}`);
  return { ok: result.exitCode === 0, exitCode: result.exitCode, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated };
}

/** Fail on a Git command that must succeed, with the first meaningful stderr line as the reason. */
export function mustGit(output: GitOutput, what: string): GitOutput {
  if (!output.ok) {
    const reason = output.stderr.trim().split("\n")[0] || output.stdout.trim().split("\n")[0] || `git exited ${output.exitCode}`;
    throw new Error(`${what}: ${reason}`);
  }
  return output;
}

/** Whether `root` is inside a Git work tree (`git rev-parse --is-inside-work-tree` prints true). */
export async function isRepository(provider: ExecutionWorldProvider, root: string): Promise<boolean> {
  const output = await runGit(provider, root, ["rev-parse", "--is-inside-work-tree"], { limitBytes: 4096 });
  return output.ok && output.stdout.trim() === "true";
}

/** The checked-out branch of `cwd`, or "" for a detached HEAD. */
export async function currentBranch(provider: ExecutionWorldProvider, cwd: string): Promise<string> {
  const output = await runGit(provider, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], { limitBytes: 8192 });
  return output.ok ? output.stdout.trim() : "";
}

export interface BranchList {
  readonly current: string;
  readonly default: string;
  readonly branches: readonly string[];
}

/** Local branches (most recently committed first, at most 200), the current branch, and the
 *  repository's default branch: origin's HEAD when known, else main/master when present. */
export async function listBranches(provider: ExecutionWorldProvider, root: string): Promise<BranchList> {
  const refs = mustGit(await runGit(provider, root, [
    "for-each-ref", "--format=%(refname:short)", "--sort=-committerdate", "refs/heads/",
  ], { limitBytes: 256 * 1024 }), "listing branches");
  const branches = refs.stdout.split("\n").map(line => line.trim()).filter(line => line.length > 0).slice(0, 200);
  const current = await currentBranch(provider, root);
  let originHead = "";
  const head = await runGit(provider, root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { limitBytes: 8192 });
  if (head.ok) {
    const short = head.stdout.trim();
    if (short.startsWith("origin/") && short.length > "origin/".length) originHead = short.slice("origin/".length);
  }
  const fallback = branches.find(name => name === "main") ?? branches.find(name => name === "master") ?? "";
  return { current, default: originHead || fallback, branches };
}

/** Whether a ref exists (`git rev-parse --verify --quiet`). */
export async function refExists(provider: ExecutionWorldProvider, root: string, reference: string): Promise<boolean> {
  const output = await runGit(provider, root, ["rev-parse", "--verify", "--quiet", reference], { limitBytes: 8192 });
  return output.ok;
}

/** The final branch name for a checkout request: validated, then namespaced `workbench/…` unless
 *  it already carries the namespace (donor `worktree_branch_name` semantics, ours names the host
 *  application rather than the donor). */
export function checkoutBranchName(branch: string): string {
  const trimmed = branch.trim();
  if (trimmed.length === 0 || trimmed.length > 120 || trimmed.includes("..")) {
    throw new Error("Use a branch name with letters, numbers, hyphens, underscores, and slashes (max 120 characters)");
  }
  if (![...trimmed].every(ch => /[A-Za-z0-9]/.test(ch) || ch === "/" || ch === "-" || ch === "_")) {
    throw new Error("Use a branch name with letters, numbers, hyphens, underscores, and slashes");
  }
  return trimmed.startsWith("workbench/") ? trimmed : `workbench/${trimmed}`;
}

/** Whether a start point looks like a plain local branch name (never an option or a range). */
export function validStartPoint(base: string): boolean {
  return base.length > 0 && base.length <= 200 && !base.includes("..") && !base.startsWith("-")
    && [...base].every(ch => /[A-Za-z0-9]/.test(ch) || "/-_.".includes(ch));
}

/** The sibling worktree container and destination for `branch` beside a repository root:
 *  `<parent>/<repo>-worktrees/<branch-with-slashes-dashed>` (donor layout). */
export function worktreeDestination(root: string, branch: string): string {
  const name = basename(root);
  if (!name) throw new Error("the workspace root has no repository directory name to derive a worktree folder from");
  const container = posix.join(dirname(root), `${name}-worktrees`);
  return posix.join(container, branch.replace(/\//g, "-"));
}

export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string;
  readonly detached: boolean;
  readonly prunable: boolean;
}

/** Parse `git worktree list --porcelain` into registered entries (including prunable ones whose
 *  folder is gone — the registration, not the folder, is what Git reports here). */
export function parseWorktreeList(text: string): readonly WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of text.split("\n\n")) {
    let path = "";
    let branch = "";
    let detached = false;
    let prunable = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
      else if (line.startsWith("branch refs/heads/")) branch = line.slice("branch refs/heads/".length).trim();
      else if (line === "detached") detached = true;
      else if (line.startsWith("prunable")) prunable = true;
    }
    if (path) entries.push({ path, branch, detached, prunable });
  }
  return entries;
}

export async function worktreeList(provider: ExecutionWorldProvider, root: string): Promise<readonly WorktreeEntry[]> {
  const output = mustGit(await runGit(provider, root, ["worktree", "list", "--porcelain"], { limitBytes: 256 * 1024 }), "listing worktrees");
  return parseWorktreeList(output.stdout);
}

export interface CreateWorktree {
  readonly path: string;
  readonly branch: string;
}

/** Create an isolated worktree of `root` (donor `create_worktree_with` semantics):
 *  - validate the final branch name and its ref format;
 *  - refuse a colliding branch unless `existing` explicitly adopts it;
 *  - refuse an existing-branch adoption that also names a base;
 *  - validate the base start point when one is named;
 *  - refuse a destination folder that already exists (never overwrite). */
export async function createWorktree(
  provider: ExecutionWorldProvider,
  root: string,
  input: { readonly branch: string; readonly base?: string; readonly existing?: boolean },
): Promise<CreateWorktree> {
  const branch = checkoutBranchName(input.branch);
  mustGit(await runGit(provider, root, ["check-ref-format", "--branch", branch], { limitBytes: 8192 }), "validating the branch name");
  const exists = await refExists(provider, root, `refs/heads/${branch}`);
  if (input.existing === true && !exists) throw new Error(`Branch ${branch} does not exist yet — create it instead`);
  if (input.existing !== true && exists) throw new Error(`Branch ${branch} already exists — adopt it explicitly or choose another name`);
  let base: string | undefined;
  const trimmedBase = input.base?.trim();
  if (trimmedBase) {
    if (input.existing === true) throw new Error(`${trimmedBase} cannot be a start point for an existing branch`);
    if (!validStartPoint(trimmedBase)) throw new Error("choose a valid local branch to start from");
    if (!(await refExists(provider, root, `${trimmedBase}^{commit}`))) throw new Error(`start point ${trimmedBase} was not found`);
    base = trimmedBase;
  }
  const destination = worktreeDestination(root, branch);
  const stat = await provider.fileSystem.stat(destination).catch(() => undefined);
  if (stat !== undefined) throw new Error("a worktree folder for this branch already exists — choose a different branch name");
  const args: string[] = ["worktree", "add"];
  if (input.existing !== true) args.push("-b", branch);
  args.push("--", destination);
  if (input.existing === true) args.push(branch);
  else if (base !== undefined) args.push(base);
  mustGit(await runGit(provider, root, args, { limitBytes: 16 * 1024, timeoutMs: 120_000 }), "creating the worktree");
  return { path: destination, branch };
}

/** A worktree is live when its folder exists and carries the `.git` file a linked checkout uses
 *  (the donor's exact criterion: a directory alone is not a checkout). */
export async function worktreeExists(provider: ExecutionWorldProvider, path: string): Promise<boolean> {
  const stat = await provider.fileSystem.stat(`${path}/.git`).catch(() => undefined);
  return stat !== undefined;
}

export interface WorktreeStatus {
  readonly exists: boolean;
  readonly branch: string;
  readonly changes: number;
  readonly clean: boolean;
  readonly hasUpstream: boolean;
  readonly ahead: number;
  /** Commits on the branch that the main checkout's HEAD does not contain (what a merge would add). */
  readonly pending: number;
  readonly merged: boolean;
}

/** Observe a worktree without writing anything (donor `worktree_status` semantics): existence,
 *  branch, uncommitted-change count, upstream link, unpushed commits, and whether the branch is
 *  already merged into the main checkout's current HEAD. */
export async function worktreeStatus(
  provider: ExecutionWorldProvider,
  mainRoot: string,
  path: string,
  storedBranch: string,
): Promise<WorktreeStatus> {
  const exists = await worktreeExists(provider, path);
  if (!exists) {
    let branch = storedBranch;
    if (!branch) {
      const entries = await worktreeList(provider, mainRoot).catch(() => [] as readonly WorktreeEntry[]);
      branch = entries.find(entry => entry.path === path)?.branch ?? "";
    }
    return { exists: false, branch, changes: 0, clean: true, hasUpstream: false, ahead: 0, pending: 0, merged: false };
  }
  let branch = await currentBranch(provider, path);
  if (!branch) branch = storedBranch;
  const status = mustGit(await runGit(provider, path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { limitBytes: 512 * 1024 }), "reading the worktree status");
  const changes = status.stdout.split("\0").filter(entry => entry.length > 0).length;
  const upstream = await runGit(provider, path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { limitBytes: 8192 });
  const hasUpstream = upstream.ok;
  let ahead = 0;
  if (hasUpstream) {
    const count = mustGit(await runGit(provider, path, ["rev-list", "--count", "@{upstream}..HEAD"], { limitBytes: 8192 }), "counting unpushed commits");
    ahead = Number.parseInt(count.stdout.trim(), 10) || 0;
  }
  let pending = 0;
  let merged = false;
  if (branch) {
    const count = await runGit(provider, mainRoot, ["rev-list", "--count", `HEAD..${branch}`], { limitBytes: 8192 });
    if (count.ok) pending = Number.parseInt(count.stdout.trim(), 10) || 0;
    const ancestor = await runGit(provider, mainRoot, ["merge-base", "--is-ancestor", branch, "HEAD"], { limitBytes: 8192 });
    merged = ancestor.ok;
  }
  return { exists: true, branch, changes, clean: changes === 0, hasUpstream, ahead, pending, merged };
}

/** Whether `cwd` has tracked (non-untracked) changes — the dirty check for merges. */
export async function hasTrackedChanges(provider: ExecutionWorldProvider, cwd: string): Promise<boolean> {
  const status = mustGit(await runGit(provider, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=no"], { limitBytes: 512 * 1024 }), "checking for uncommitted changes");
  return status.stdout.length > 0;
}

export class MergeConflictError extends Error {
  constructor(
    message: string,
    readonly branch: string,
    readonly target: string,
    readonly conflicts: readonly string[],
  ) {
    super(message);
    this.name = "MergeConflictError";
  }
}

export interface WorktreeMerge {
  readonly branch: string;
  readonly target: string;
  readonly commits: number;
  /** The branch the main checkout was on before it moved to the target, when it moved. */
  readonly switchedFrom: string | undefined;
}

/** Merge a worktree's committed branch into `target` in the main checkout (donor
 *  `merge_worktree` semantics). Refuses a missing worktree, a detached branch, or uncommitted
 *  work on either side; a conflict aborts the merge and throws `MergeConflictError` with the
 *  conflicting paths, leaving both checkouts unchanged. */
export async function mergeWorktree(
  provider: ExecutionWorldProvider,
  mainRoot: string,
  path: string,
  target: string,
): Promise<WorktreeMerge> {
  if (!(await worktreeExists(provider, path))) throw new Error("the worktree folder is missing — recreate it first");
  const branch = await currentBranch(provider, path);
  if (!branch) throw new Error("the worktree is on a detached HEAD — commit or reattach a branch first");
  if (await hasTrackedChanges(provider, path)) throw new Error("the worktree has uncommitted changes — commit them before merging");
  if (await hasTrackedChanges(provider, mainRoot)) throw new Error("the project checkout has uncommitted changes — commit or stash them before merging");
  const count = mustGit(await runGit(provider, mainRoot, ["rev-list", "--count", `${target}..${branch}`], { limitBytes: 8192 }), "counting merge commits");
  const commits = Number.parseInt(count.stdout.trim(), 10) || 0;
  const currentMain = await currentBranch(provider, mainRoot);
  const switchedFrom = currentMain !== target ? currentMain || undefined : undefined;
  if (switchedFrom !== undefined) {
    mustGit(await runGit(provider, mainRoot, ["switch", target], { limitBytes: 64 * 1024 }), `switching the project checkout to ${target}`);
  }
  if (commits > 0) {
    const merged = await runGit(provider, mainRoot, ["merge", "--no-edit", branch], { limitBytes: 64 * 1024, timeoutMs: 120_000 });
    if (!merged.ok) {
      const conflicted = await runGit(provider, mainRoot, ["diff", "--name-only", "--diff-filter=U"], { limitBytes: 64 * 1024 });
      const conflicts = conflicted.ok ? conflicted.stdout.split("\n").map(line => line.trim()).filter(line => line.length > 0) : [];
      await runGit(provider, mainRoot, ["merge", "--abort"], { limitBytes: 8192 });
      if (switchedFrom !== undefined) await runGit(provider, mainRoot, ["switch", switchedFrom], { limitBytes: 64 * 1024 });
      throw new MergeConflictError(
        conflicts.length > 0
          ? `merging ${branch} into ${target} conflicts in ${conflicts.join(", ")} — nothing was changed; merge ${target} into the worktree, resolve it there, and try again`
          : `git could not merge ${branch} into ${target} — nothing was changed; resolve the divergence in the worktree and try again`,
        branch,
        target,
        conflicts,
      );
    }
  }
  return { branch, target, commits, switchedFrom };
}

export interface WorktreeRemoval {
  readonly removed: boolean;
  readonly branch: string;
  readonly branchDeleted: boolean;
  /** Why a requested branch deletion was skipped (an unmerged branch is kept, never forced). */
  readonly note: string;
}

/** Remove a worktree without force (donor `remove_worktree` semantics): Git itself refuses a
 *  dirty checkout, the registration is pruned, and the branch is deleted only with `-d` — an
 *  unmerged branch is kept and the note says so. A folder that is already gone only prunes. */
export async function removeWorktree(
  provider: ExecutionWorldProvider,
  mainRoot: string,
  path: string,
  storedBranch: string,
  deleteBranch: boolean,
): Promise<WorktreeRemoval> {
  if (path === mainRoot) throw new Error("the project's own checkout cannot be removed");
  let branch = storedBranch;
  if (!branch) {
    const entries = await worktreeList(provider, mainRoot).catch(() => [] as readonly WorktreeEntry[]);
    branch = entries.find(entry => entry.path === path)?.branch ?? "";
  }
  const present = await worktreeExists(provider, path);
  if (present) {
    const registered = (await worktreeList(provider, mainRoot)).some(entry => entry.path === path);
    if (!registered) throw new Error("this folder is not a registered worktree of the project");
    mustGit(await runGit(provider, mainRoot, ["worktree", "remove", "--", path], { limitBytes: 16 * 1024, timeoutMs: 60_000 }), "removing the worktree");
  }
  mustGit(await runGit(provider, mainRoot, ["worktree", "prune"], { limitBytes: 16 * 1024 }), "pruning worktree registrations");
  let branchDeleted = false;
  let note = "";
  if (deleteBranch && branch) {
    const deletion = await runGit(provider, mainRoot, ["branch", "-d", branch], { limitBytes: 16 * 1024 });
    if (deletion.ok) branchDeleted = true;
    else note = `branch ${branch} was kept: ${deletion.stderr.trim().split("\n")[0] || "it is not fully merged"}`;
  }
  return { removed: present, branch, branchDeleted, note };
}

/** Check the branch out again at the same path after its folder disappeared (donor
 *  `recreate_worktree`). Refuses a folder that exists or a branch that is gone. */
export async function recreateWorktree(
  provider: ExecutionWorldProvider,
  mainRoot: string,
  path: string,
  storedBranch: string,
): Promise<string> {
  if (await provider.fileSystem.stat(path).catch(() => undefined) !== undefined) throw new Error("the worktree folder already exists");
  let branch = storedBranch;
  if (!branch) {
    const entries = await worktreeList(provider, mainRoot).catch(() => [] as readonly WorktreeEntry[]);
    branch = entries.find(entry => entry.path === path)?.branch ?? "";
  }
  if (!branch) throw new Error("the worktree's branch is unknown — create a new worktree instead");
  if (!(await refExists(provider, mainRoot, `refs/heads/${branch}`))) throw new Error(`branch ${branch} no longer exists — create a new worktree instead`);
  mustGit(await runGit(provider, mainRoot, ["worktree", "prune"], { limitBytes: 16 * 1024 }), "pruning worktree registrations");
  mustGit(await runGit(provider, mainRoot, ["worktree", "add", "--", path, branch], { limitBytes: 16 * 1024, timeoutMs: 120_000 }), "recreating the worktree");
  return path;
}
