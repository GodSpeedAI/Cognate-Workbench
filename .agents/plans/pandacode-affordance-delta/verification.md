# Verification — Task checkouts (T05, T06)

Every claim below is a command that was actually run in this checkout, with its
result. Where a result was not clean, the observation and its evaluation are kept:
a verification file that only records passes is not verification.

## Model

```
$ domainforge validate .sea/interaction/interaction-model.sea
Validation succeeded: 0 violations total

$ domainforge fmt --check .sea/interaction/interaction-model.sea
.sea/interaction/interaction-model.sea: already formatted   (exit 0)
```

Loader at boot: `[domain] loaded 257 semantic objects (digest sha256:cc4ca6bc…)`.

## Focused gates

```
$ bun test test/git-ops.test.ts test/J-CHECKOUT-parallel.test.ts \
           test/J-CHECKOUT-lifecycle.test.ts test/ui-checkout.test.tsx
17 pass, 0 fail, 124 expect() calls   [~26 s]

$ bun test --timeout 15000 test/E2E-checkout.test.ts
1 pass, 0 fail, 8 expect() calls     [~23 s, real Chromium]

$ just typecheck
$ tsc -p tsconfig.json               (exit 0)
```

What the journey tests actually assert (not just that a run completed):

- **Parallel isolation** — two Tasks, two `workbench/…` worktrees of one repository,
  both agents run the same relative write (`shared.txt`) concurrently;
  `task-a` exists only in worktree A, `task-b` only in worktree B, `shared.txt`
  does not exist in the main checkout, `src/greet.ts` still contains `Hello`, and
  `git status --porcelain` in the main checkout is empty.
- **Frozen provenance** — the `session.turn.started` payloads carry `taskId`,
  `checkoutRoot` and `checkoutBranch` matching the bindings; the checkout root in
  the event equals the worktree path on disk.
- **Restart** — `app.stop()`, second `bootApp(home)`, the binding resolves from the
  event log, `git.checkout.status` reports `exists: true`, and a new turn writes into
  the restored worktree (never into the workspace root).
- **Work safety** — removal with an uncommitted file and with an untracked file is
  refused and the file still exists; after committing, removal succeeds with
  `branchDeleted: false` and `refs/heads/workbench/feature-dirty` still resolves.
- **Recovery** — deleting the worktree folder yields `exists: false`, then
  `git.checkout.recreate` restores the path and the committed file.
- **Merge** — a conflicting change on both sides returns `conflicted: true` with
  `src/greet.ts` in `conflicts`, main keeps its own content, its status is clean and
  no `MERGE_HEAD` remains. A clean branch merges into `main` and `status.merged`
  becomes `true`.
- **In-flight protection** — with the task at `RUNNING`, attach, merge and remove all
  reject with a message naming RUNNING.
- **One live checkout per task** — attaching a second branch while the task's worktree
  still exists is refused and creates nothing (`git worktree list` still shows two
  entries); a second task cannot claim the first task's branch; after a clean removal
  (`deleteBranch: true`) the branch is genuinely free and re-attachable at the same path.

The E2E drives the real control: bind a Task via the composer, open the isolate form,
see the suggested branch and `main` start point, create the checkout, cross-check the
chip against `git.checkout.status`, remove with the explicit confirmation, and assert
`task.checkout.resolve` is `null` and the folder is gone afterwards. Screenshots:
`screenshots/workbench/e2e-checkout-0{1..4}*.png`. No page errors or console errors
were recorded (`expect(errors).toEqual([])`).

## Live operator walkthrough (agent-browser, real server)

Beyond the suites, the whole lifecycle was driven once through the real UI on a live
`bun src/server.ts` (scratch home, scratch Git repository, dev auth) with agent-browser,
reading the DOM at each step and capturing a screenshot per state —
`screenshots/workbench/checkout-live-01..07.png`:

1. Workspace selected → task "Tidy the greeting" created in the Workbench → session
   bound via the Task select → the chip renders **"Isolate in a worktree…"**.
2. The form pre-fills branch **`tidy-the-greeting`** (from the title) and start point
   **`main (default)`**; the preview line names the final `workbench/tidy-the-greeting`.
3. Create checkout → chip **"workbench/tidy-the-greeting · clean"**, "Merge into main"
   disabled (nothing to merge — observed, not inferred); the worktree exists at
   `<repo>-worktrees/workbench-tidy-the-greeting` on the base commit, clean.
4. Commit in the worktree from the shell → after a page reload the chip reads
   **"1 commit to merge"** and enables Merge. (The stale-facts gap before the reload is
   recorded in `.agents/DEBT.md`, not hidden: the chip observes only on mount and after
   its own actions.)
5. Merge into main → **"Merged 1 commit into main."**, chip back to `clean`; on disk
   `main` carries `tidy: warmer greeting` and the file content matches.
6. Remove → two-step confirm (**"Remove this checkout? Uncommitted work would block
   it." / Confirm / Keep**) renders before anything happens.
7. Confirm → **"Checkout removed and its merged branch deleted."**; the chip returns to
   "Isolate in a worktree…", the worktree folder is gone, `git worktree list` shows only
   the main checkout, and `git branch` shows only `main` (the merged branch was deleted).

The same walkthrough on the **default contained execution posture** found the honest
refusal instead of the flow: `git.branch.list` is refused on the uncontained `local`
world with the agent-effects posture message, and the isolate form opens with an empty
start-point list and that message. Restarting with
`COGNATE_EXECUTION_POSTURE=uncontained-local` (the posture the journey and E2E tests
run under) made the identical flow succeed. This posture interaction is recorded as debt
with its evidence (`.agents/DEBT.md`, "Task checkouts are refused on local workspaces
under the default contained posture").

## Full suite

```
$ just verify            # bun run typecheck && bun test --timeout 15000 test
```

Run 1: `1361 pass, 12 skip, 3 fail, 8396 expect() across 148 files` (≈17 min).
Run 2: `1361 pass, 12 skip, 1 fail`.

Failures observed, and what they are:

| Failure | Run | Isolated re-run |
|---|---|---|
| `E2E Experts and Teams > creates, edits and copies a routed Expert, then reopens solo and private history` | 1 and 2 | `bun test test/E2E-experts.test.ts` → **2 pass, 0 fail** (67 s; test budget 120 s) |
| two further failures in run 1 | 1 | absent in run 2 and in the focused runs; both were Playwright E2E files under full-suite load |

Evaluation: these are load-sensitive browser waits in pre-existing E2E files that
this change does not touch (no shared code paths, no fixtures, no aimock scripts used
by them). The suite was run twice; the same test failed once and passed in isolation
at 67 s, and the other two did not reproduce. The checkout work itself is covered by
non-browser journeys that are deterministic. This is recorded as a known
full-suite-load flake, not as a green full run.

## Adversarial checks performed during implementation

- The projection lookup originally keyed on `endsWith('/task/<id>')`; the local
  tenant is empty, so the key is `task/<id>` and `task.checkout.resolve` returned
  `null` while the row existed. Caught by the journey test (the write landed in the
  workspace root); fixed to match on the row's own `taskId`.
- The removal guard used `hasTrackedChanges` (tracked files only), so an untracked
  file let `git worktree remove` fail with Git's raw message instead of the
  capability's refusal. Caught by the lifecycle test; fixed to use the status change
  count (tracked + untracked).
- A freshly created branch reported `merged: true` (it equals the target's HEAD) and
  the UI offered a merge that would do nothing. Caught by the browser E2E; the status
  now reports `pending` (commits the target lacks), the chip says "clean" for a fresh
  checkout, and `canMerge` requires a pending commit.
- A re-bind while the old worktree was live would have orphaned a registered worktree
  (the collision was checked only after creating it). Caught while writing the
  settlement reports, before any release: `git.checkout.attach` now refuses a task
  whose live checkout still exists, and checks cross-task destination/branch collisions
  before creating anything; the lifecycle journey proves the refusal creates nothing.

## Limits of this verification

- The contained-world refusal is now evidenced end-to-end (see the walkthrough above),
  but only its refusal, not a contained checkout: a Linux-containment config whose
  sandbox can write a sibling `-worktrees` directory was not built for this run, so the
  contained-path success case remains covered by the shared
  `WORKTREE_CAPABLE_WORLD_KINDS` gate and reasoning, not by a journey.
- Worktree operations run through the execution-world provider. For remote (SSH/WSL)
  worlds the code path is the same provider interface, but only the local world is
  exercised by tests here.
- The chip's facts go stale after commits made outside the app until a reload (see
  `.agents/DEBT.md`); the walkthrough demonstrates both the stale state and the correct
  post-reload facts.
- The `gh`/GitHub family and the durable steering-queue closure (T07, T08) are not
  implemented; see `deferred.md`.
