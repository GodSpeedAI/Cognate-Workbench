# Implementation report — Task checkouts (T05, T06)

Priority A of the PandaCode affordance delta: Git branches, worktrees and task-scoped
checkouts, implemented model-first in the Workbench's own architecture. T01–T04
(conversation affordances) are reported in `.agents/reports/pandacode-delta/`.

Base for this tranche: `b9a6d79` (T01–T04).
Settled at: `7cf4fa5`.

| Commit | Scope |
|---|---|
| `61dee32` | Model, Git operations, capabilities, projection, agent execution, journey tests |
| `7cf4fa5` | Composer checkout control, pure UI logic, browser E2E, screenshots |
| `78926ed` | One-live-checkout-per-task enforcement (rebind and collision refusals before creation) |

Donor evidence: `aicodeking/pandacode` @ `ceed919`, `.tmp/donor/pandacode/src-tauri/src/workspace.rs`
(worktree creation/status/merge/removal), re-read line by line before writing any code.
No donor code was copied; the mechanisms were re-derived against Cognate's capability,
projection and execution-world model. The donor is MIT with a fork-attribution condition
and the Workbench is not a fork.

## What a Task checkout is here

A Task may be bound to an isolated Git worktree of its workspace's repository. A bound
Task's agent turns then execute **inside that worktree**: the turn's tool root is the
checkout, while authority checks and risk preflight scope to the same root. The
association is durable (`workbench.checkout.bound` / `.removed` events), replayable
(`task-checkout-bindings` projection), and frozen per turn (`session.turn.started`
carries `checkoutRoot`/`checkoutBranch`), so a later rebind never rewrites the
provenance of a finished run.

A checkout is *where a Task's work happens* — not a second workspace, not a second
task ledger, and not a Cognate execution-world or cognitive candidate-world fork.

## Model first (`.sea`)

- `Resource "TaskCheckoutRecord" units`
- `Flow "TaskCheckoutRecord" from "Task" to "WorkspaceRecord" quantity 1`
- Canonical journeys `J-CHECKOUT-BIND`, `J-CHECKOUT-EXECUTION`, `J-CHECKOUT-LIFECYCLE`
  (catalog entries in `.sea/interaction/canonical-journey-catalog.md`).
- `domain/index.ts`: `CHECKOUT_CAPABILITY_ANCHORS` (all seven anchored on the `Task`
  entity — capability anchors are Entities, never Resources) + `bindCheckoutCapabilities`.
- Validated with `domainforge validate` (0 violations) and `fmt --check` clean before
  runtime code; the domain loader now reports 257 objects.

## Capabilities (`src/capabilities/taskCheckout.ts`)

Six operator-only capabilities plus one agent-invocable read. "Operator-only" means the
handler refuses `ctx.runId`/non-user actors: an agent run can never merge, remove or
re-point its own checkout, and the one capability it may call is a pure read.

| Capability | Behaviour |
|---|---|
| `git.branch.list` | local branches, current, repository default (`origin/HEAD` → `main`/`master` fallback) |
| `git.checkout.attach` | create a namespaced `workbench/<name>` branch + worktree, or adopt an existing branch explicitly; refuses a RUNNING task, a non-repository, a worktree-incapable world, a destination or branch another task already owns (checked **before** creation, so a refused bind creates nothing), and a re-bind while the task's own live checkout still exists — remove or recreate it first; also refuses invalid names and a missing start point |
| `git.checkout.status` | `exists`, `branch`, `changes`, `clean`, `hasUpstream`, `ahead`, `pending` (commits the target lacks), `merged` — observed, never inferred |
| `git.checkout.merge` | merges the worktree branch into a named target (default branch by default); a conflict aborts the merge, reports the file list, and leaves both checkouts unchanged |
| `git.checkout.remove` | refuses any uncommitted or untracked work, never `--force`, prunes the registration, deletes the branch only with `-d` (an unmerged branch is kept and the note says why) |
| `git.checkout.recreate` | rebuilds a vanished worktree at the same path from its branch |
| `task.checkout.resolve` | the recorded read the agent loop uses; returns the binding or `null` |

All Git runs through `src/workbench/gitOps.ts`, which spawns `git` **through the
workspace's execution-world provider** with argument arrays, no stdin, bounded output
and timeouts — no shell interpolation, no host-direct bypass. Contained
(`linux-bubblewrap`), and any other world whose sandbox cannot reach a sibling
directory, is refused with an explanation instead of failing obscurely.

## Runtime wiring

- `src/workbench/types.ts`: `WORKBENCH_EVENTS` gains `workbench.checkout.bound` /
  `workbench.checkout.removed`, so the deterministic `agent.config` recorder can mint
  them (and cannot mint anything else).
- `src/projections/taskCheckoutBindings.ts`: public `task-checkout-bindings`, keyed
  `task/<id>` (the local tenant is empty), idempotent on replay, deletes on removal.
- `src/server.ts`: component registration + projection + the seven ids in
  `GRANTED_CAPABILITIES` (system and local-operator invokes are gated there).
- `src/agents/agentCoding.ts`: after `workspace.path`, the turn resolves the binding
  once via `task.checkout.resolve` and freezes `checkoutRoot`/`checkoutBranch` on
  `session.turn.started`; `effectiveRoot = checkout?.root ?? workspace.root` is what
  tools, `authority.check`, `risk.assess` and `case.observe` receive. The workspace's
  execution world is unchanged — a checkout moves *where*, never *what* is allowed.

## UI (T06)

- `src/ui/workbench/CheckoutChip.tsx` — beside the composer's Task control: the
  binding (branch), live facts from `git.checkout.status`, `Change`, `Merge into
  <default>` (disabled until there is a commit to merge), two-step `Remove`, and
  `Recreate` when the folder vanished. Unbound tasks get `Isolate in a worktree…`.
- The form suggests a branch from the task title (`suggestBranchName`), offers the
  local branches as start points with the repository default preselected, and says
  the exact final name (`workbench/…`) before anything is created. An existing
  branch is adopted explicitly, not silently.
- Moving a bound task retires the old checkout first (the capability refuses while it
  holds uncommitted work), so a rebind cannot orphan an unmanaged worktree.
- `src/workbench/checkoutUi.ts` holds the pure wording/defaults so they are tested
  without a DOM, matching the T01–T04 pattern.
- Screenshots: `screenshots/workbench/e2e-checkout-01-unbound.png`,
  `-02-form.png`, `-03-bound.png`, `-04-confirm-remove.png`.

## Tests (18 new, 132 expectations)

| File | Tests | Proves |
|---|---|---|
| `test/J-CHECKOUT-parallel.test.ts` | 2 | two tasks edit the same relative filename in sibling worktrees; both writes land; main checkout untouched and clean; turn evidence freezes root+branch; restart restores the binding from the log and still executes there |
| `test/J-CHECKOUT-lifecycle.test.ts` | 7 | dirty/untracked removal refused; unmerged branch preserved on removal (row deleted, history kept); vanished worktree reported then recreated with its work; conflict reports files and aborts cleanly; clean merge lands commits + `merged` observed; RUNNING refuses attach/merge/remove; non-repository refused; existing branch adoptable; one live checkout per task (re-bind refused, no sharing, a retired branch is genuinely free again) |
| `test/git-ops.test.ts` | 4 | name namespacing/validation, start-point validation, sibling layout, `worktree list --porcelain` parsing (including prunable registrations) |
| `test/ui-checkout.test.tsx` | 4 | branch suggestion, status wording order, `canMerge` gate, merge outcome text (a conflict is never success) |
| `test/E2E-checkout.test.ts` | 1 | real Chromium: bind a task, isolate it through the form, chip states cross-checked against the capabilities, remove with confirmation, page console clean |

Focused gate: `17 pass, 0 fail, 124 expect()` across the four non-browser files;
the E2E adds `1 pass, 8 expect()`.

## Live operator walkthrough

The full lifecycle was also driven once through the real UI on a live server
(`bun src/server.ts`, scratch home and repository) with agent-browser — DOM text read
at every step, one screenshot per state:
`screenshots/workbench/checkout-live-01-unbound.png` … `07-removed.png`
(unbound chip → suggested form → bound `clean` chip with Merge gated →
"1 commit to merge" after an external commit and reload → "Merged 1 commit into main." →
two-step Remove confirm → removed, branch deleted). The same walkthrough on the default
contained posture captured the honest refusal and is recorded as debt
(`.agents/DEBT.md`, posture entry). Details and DOM text: `verification.md`.

## Deliberate deviations from the donor

| Donor | Here | Why |
|---|---|---|
| Worktree container `<repo>-worktrees` | same layout | it works, and it keeps checkouts discoverable beside the repository |
| `pandacode_track_files` per-turn attribution handshake | **not ported** | turn-attributed diffs need a correctness design of their own; running `git status` after each turn is neither truthful nor cheap (see `deferred.md`) |
| Force-remove paths (`--force`) | refused | removal must never discard work; a dirty or untracked checkout is a refusal, not a prompt |
| Branch deletion on cleanup | only `-d` | an unmerged branch is evidence; keeping it is the safe default |
| UI dialog copies | React inline form | no modal focus-trap machinery exists in this app; the inline form follows existing composer patterns |
