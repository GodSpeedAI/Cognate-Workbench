# Architecture — task-scoped Git checkouts in Cognate Workbench

## Principle

One Workspace remains one canonical root + one execution world. A **Git worktree is a
Task-scoped working directory inside that workspace's repository** — never a second
workspace, never a second event store, and explicitly *not* a Cognate execution-world
fork or cognitive candidate-world. The task→checkout association is a durable,
event-recorded binding exactly like the session→task binding it sits beside.

```
Task ──(workbench.checkout.bound: root, branch, kind=worktree)──▶ checkout dir
 └── contract.context.workspaceId still names the WORKSPACE (identity unchanged)
      └── agent turn: workspace.path → world; task.checkout.resolve → effective root
```

## Pieces

1. **`src/workbench/gitOps.ts`** (pure-ish helpers + bounded runner)
   - `runGit(provider, cwd, argv, {limit, timeoutMs, commit})` →
     `{exitCode, stdout, stderr, truncated}` via `provider.process.exec`.
     argv arrays only; no shell string is ever built. Output capped (64 KiB default
     read-side), timeouts (30 s default, 180 s for push), `commit: true` marks
     side-effecting calls for the recording gate.
   - `isRepo`, `listBranches`, `defaultBranch`, `currentBranch`, `refExists`,
     `checkRefFormat`, `createWorktree`, `worktreeStatus`, `mergeBranch`,
     `removeWorktree`, `recreateWorktree` — donor semantics (OBSERVED
     `workspace.rs:434-1160`), Workbench implementation. Nothing forces. Conflict
     paths come from `diff --name-only --diff-filter=U` after `merge --abort`.
   - Branch validation: ≤120 chars, `[A-Za-z0-9/_-]`, no `..`; namespaced
     `workbench/…` unless the name already starts with `workbench/` (donor uses
     `pandacode/`; ours names the host app, not the donor).
2. **`src/capabilities/taskCheckout.ts`** — one component, operator-only handlers
   (`ctx.actor.kind === "user" && !ctx.runId`, the containedWorkspace precedent):
   - `git.branch.list {workspaceId}` → `{current, default, branches[]}`
   - `git.checkout.attach {taskId, branch, base?, existing?}` → creates
     `<repo>-worktrees/<branch-dashed>` beside the workspace root **through the
     workspace's execution-world provider**; refuses: unknown task, cross-workspace
     task, RUNNING task, non-repo root, contained (`linux-bubblewrap`) world (the
     sandbox mounts only the workspace root — stated in the refusal), branch
     collision without `existing`, missing base. Records `workbench.checkout.bound`
     via a deterministic `agent.config` `workbench.recorded` run, correlation
     `task:<id>`.
   - `git.checkout.status {taskId}` → `{exists, branch, changes, clean, hasUpstream, ahead, merged, root}`
     (a read; no event).
   - `git.checkout.merge {taskId, target?}` → refuses missing worktree, dirty
     worktree, RUNNING task, dirty main checkout; merges into target (default:
     repo default branch) in the main checkout; conflict → error naming files,
     merge aborted, nothing fabricated.
   - `git.checkout.remove {taskId, deleteBranch?}` → refuses RUNNING task and dirty
     worktree (Git refuses without `--force` anyway; we pre-check to explain);
     `worktree remove -- <path>` + `prune`; `branch -d` only when asked — Git keeps
     unmerged branches and we surface the note. Records
     `workbench.checkout.removed`.
   - `git.checkout.recreate {taskId}` → same path + branch, after `prune`; refuses
     when the folder exists or the branch is gone.
   - `task.checkout.resolve {taskId}` → the live binding or null. Invocable by the
     agent loop (a recorded step), so replay sees the same checkout.
3. **`src/projections/taskCheckoutBindings.ts`** — public projection
   `task-checkout-bindings`, key `${tenant}/task/${taskId}`, folding the two event
   types; removed bindings delete the row (history stays in the log).
4. **`agent.coding`** — after `workspace.path` resolution: when the turn has an
   `effectiveTaskId`, `ctx.invoke("task.checkout.resolve", …)`; a binding replaces
   the turn's `root` for every tool call (`workspaceRoot`, `filesystem.resolve`,
   `risk.assess`) and `session.turn.started` gains `checkoutRoot` + `checkoutBranch`
   (frozen association, J-RUN-task-attribution precedent). The workspace's
   `executionWorldId` is unchanged — the worktree runs in the same world that owns
   the repository.
5. **`domain/index.ts`** — `CHECKOUT_CAPABILITY_ANCHORS` mapping capability ids to
   `TaskCheckoutRecord`, bound via `bindCheckoutCapabilities` (bindRedJourneys
   pattern; explicit, nothing implicit).
6. **`.sea` model** — `Resource "TaskCheckoutRecord" units`, its Flow, and three
   CanonicalJourney instances + catalog entries (see plan). Model-first: validated
   before runtime code.

## Safety properties (each has a test)

- No shell strings: argv arrays end-to-end (`runGit` is the only spawner).
- Never `--force`: removal relies on Git's own dirty refusal + explicit pre-checks.
- Unmerged branch survives removal (`branch -d`, note on refusal).
- RUNNING tasks refuse every mutating checkout op.
- Contained worlds refuse with the reason, never silently degrade.
- Conflicts abort clean and are reported with file names.
- Restart restores associations: the binding is a projection row over durable events.
- Worktree ≠ candidate-world: the checkout is *where work happens*; evidence,
  review and settlement vocabularies are untouched. The `.sea` journeys state this
  and `J-CHECKOUT-EXECUTION` settlement keeps run/task attribution separate from
  checkout location.

## What this deliberately is not

- Not a second workspace manager or task database.
- Not push/PR (T08 adapter, gated).
- Not per-turn byte attribution (deferred; separate mechanism).
- Not PandaCode's Tauri/SQLite stack; the event log stays the only truth.
