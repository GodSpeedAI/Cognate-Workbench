# PandaCode affordance delta — implementation plan

Mission: integrate PandaCode's missing affordances into Cognate Workbench. This plan
continues the prior conversation-ergonomics mission (T01–T04, committed as
`feat(ui): port PandaCode conversation affordances (T01-T04)`, evidence in
`.agents/reports/pandacode-delta/`) and covers the remaining donor families, with
**Priority A — Git branches, worktrees and task-scoped checkouts** as the major focus.

Donor: `aicodeking/pandacode` @ `ceed919` (v0.3.56), under `.tmp/donor/pandacode`.
Reconstruction: `.tmp/Panda_Code/` (captures v0.3.4; current source re-inspected for
every mechanism before classification).

## Tranches

### T05 — Git checkout foundation (model-first, Priority A) — IN PROGRESS

The smallest real task→checkout binding with safe creation and recovery.

1. Extend the IDM first (`.sea/interaction/interaction-model.sea`):
   - `Resource "TaskCheckoutRecord" units` + `Flow "TaskCheckoutRecord" from "Task" to "Workspace" quantity 1`
   - Canonical journeys `J-CHECKOUT-BIND`, `J-CHECKOUT-EXECUTION`, `J-CHECKOUT-LIFECYCLE`
     (+ catalog entries in `canonical-journey-catalog.md`).
   - Validate with `domainforge validate` + `fmt --check` before any runtime code.
2. `domain/index.ts`: `CHECKOUT_CAPABILITY_ANCHORS` + `bindCheckoutCapabilities(domain)`
   following the `bindRedJourneys` pattern.
3. `src/workbench/gitOps.ts`: bounded Git operations executed **through the workspace's
   execution-world provider** (`registry.get(worldId).process.exec({argv, cwd, timeoutMs})`)
   — argument arrays, null stdin, output caps, timeouts; never host-direct, never shell
   interpolation. Refuse contained (bubblewrap) worlds explicitly.
4. `src/capabilities/taskCheckout.ts`: operator-only capabilities
   - `git.branch.list` — local branches, current, default (read-only)
   - `git.checkout.attach` — create a worktree (+ branch) or adopt an existing branch for a task; refuses in-flight tasks; records `workbench.checkout.bound`
   - `git.checkout.status` — exists / branch / changes / clean / hasUpstream / ahead / merged
   - `git.checkout.remove` — guarded removal (dirty refused, branch kept unless merged, never forced)
   - `git.checkout.recreate` — recover a missing worktree at the same path
   - `git.checkout.merge` — local merge into a chosen base branch; conflicts reported, never fabricated
   - `task.checkout.resolve` — read the binding for a task (used by the agent loop)
5. `src/projections/taskCheckoutBindings.ts`: public `task-checkout-bindings` projection
   folding `workbench.checkout.bound` / `workbench.checkout.removed` (session-task-bindings pattern).
6. `agent.coding`: after `workspace.path`, resolve the task's checkout via
   `task.checkout.resolve` (a recorded step); a bound task's turn executes against the
   worktree root, and `session.turn.started` freezes `checkoutRoot`/`checkoutBranch`.
7. Journey tests `test/J-CHECKOUT-*.test.ts` (real runtime, real `git` binary):
   - two tasks in separate worktrees of one repo edit the same relative path without collision
   - the main checkout stays unchanged
   - each task's turn sees its own branch/files
   - dirty worktree refuses removal; unmerged branch is kept on removal
   - restart (second `bootApp` on the same home) restores the association
   - missing worktree is detected and recoverable via recreate
   - merge conflict is reported without claiming success
   - a started (RUNNING) task refuses checkout rebind
   - contained-world workspace is refused with an explicit explanation

Done when: the above tests pass against real Cognate execution with real Git worktrees,
and `domainforge validate` + `just typecheck` are clean.

### T06 — Checkout UX and lifecycle controls

- Composer context: compact checkout chip (branch + path) next to the Task control,
  backed by the `task-checkout-bindings` projection; only for bound tasks.
- "Work in a worktree…" flow: branch name suggested from the task title, base-branch
  selector from `git.branch.list`, live preview of the resulting path, explicit
  "use existing branch" when the name collides (donor dialog semantics, React idioms).
- Checkout menu (progressive disclosure): status summary, copy path, merge into
  default, remove…, recreate when missing. Safety copy mirrors the capability refusals.
- Render tests follow the T01–T04 DOM harness pattern (`test/checkout-*.test.tsx`).

### T07 — Durable steering queue (T04b closure)

Close the write-only `queue-next` channel exactly as `.agents/DEBT.md` prescribes:
consume `steer.pending().queued` at the agent's turn boundary, emit
`workbench.steer.consumed` per id, derive the composer queue from the `inbox/`
projection. Requires its own replay/idempotency analysis (an extra turn can appear
mid-session). Not started before T05/T06 settle.

### T08 — GitHub integration (Priority B, thin adapter)

`gh` CLI adapter (argument arrays, no credential storage, untrusted PR/issue content),
surfacing: connection status, issue→task suggestion, PR creation from a task branch,
PR link on the task. Gated on T05/T06. PR/merge remain consequential, operator-gated
actions.

### Deferred and excluded

See `deferred.md` (written at settlement) and `delta-ledger.md` § classifications.
Wallpaper/background customization: EXCLUDED by mission directive. Turn-attributed
diffs (donor `pandacode_track_files` handshake): DEFER with the attribution-correctness
prerequisite written out. Integrated terminal, in-app browser grounding, iOS simulator,
bots, cloud sandboxes: evaluated in the delta ledger; none silently ignored.

## Gates

Every tranche: `domainforge validate` (model touched), `bun test test/J-CHECKOUT-*.test.ts …`
(narrow), `just typecheck`, then `just verify` before settlement. A tranche is done only
when its journeys settle with recorded evidence, not when its controls render.
