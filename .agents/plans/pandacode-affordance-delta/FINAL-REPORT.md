# Final report — PandaCode affordance delta → Cognate Workbench

Mission: port the operator affordances PandaCode has that the Workbench lacks,
re-implemented in the Workbench's own architecture (model-first, capability-gated,
evidence-tested), never copied. Donor: `aicodeking/pandacode` @ `ceed919`
(MIT with a fork-attribution condition; the Workbench is not a fork — no donor code,
no donor assets). Base `6fc51ab`; settled at `d8303b7`.

| Commit | Slice |
|---|---|
| `b9a6d79` | T01–T04: conversation affordances (tool-group summaries, screenshot paste with an explicit "not sent" limit, approval-text disclosure, multi-entry steering queue) — reported in `.agents/reports/pandacode-delta/` |
| `61dee32` | T05: governed task checkouts on real Git worktrees — model, Git ops, capabilities, projection, agent execution, journeys |
| `7cf4fa5` | T06: the composer's checkout control + browser E2E |
| `78926ed` | one live checkout per task, enforced before anything is created |
| `6a717f3` | E2E race fix found by the full-suite run + live-walkthrough evidence + settlement reports |
| `d8303b7` | evidence-screenshot refresh from the full-suite runs |

## What shipped

**Priority A (T05, T06) — task-scoped Git checkouts, the mission's core.** A Task may
be bound to an isolated worktree of its workspace's repository; bound turns execute
inside it with authority and risk scoped to the same root; the binding is durable,
replayable and frozen per turn. Seven capabilities (`git.branch.list`,
`git.checkout.attach/status/merge/remove/recreate`, `task.checkout.resolve`), the
`task-checkout-bindings` projection, a 257-object validated model with three
J-CHECKOUT journeys, and a composer control that suggests a branch from the task title,
preselects the repository default, gates Merge on commits that actually exist, and
removes only through an explicit confirmation. Safety properties are tested, not
asserted: work is never discarded, an unmerged branch outlives its checkout, conflicts
report files and abort cleanly, a RUNNING task is never re-pointed, a refused bind
creates nothing, and two tasks never share a checkout.

**Priority C (T01–T04) — conversation affordances**, settled earlier and reported
separately: 98 tests, four self-contained slices, all additive.

**Priority B (T08 GitHub) and T07 (durable steering-queue closure) were sequenced
behind T05/T06 and are not built.** Their designs, prerequisites and exclusions are
written down in `deferred.md` and `.agents/DEBT.md`; the write-only `queue-next`
channel remains the debt it was — nothing claims it works.

## Evidence

- `implementation-report.md` — what was built, capability by capability, and every
  deliberate deviation from the donor (force-remove paths refused; branch deletion
  `-d` only; no per-turn attribution claims).
- `verification.md` — every gate with its real result, the adversarial checks that
  found three genuine bugs during the build (the `task/<id>` projection-key miss, the
  untracked-file removal hole, the fresh-branch `merged:true` lie), the live
  operator walkthrough (7 states, real server, DOM text + screenshots
  `screenshots/workbench/checkout-live-01..07.png`), and the honest evaluation of the
  full-suite runs below.
- `deferred.md` — every donor affordance evaluated in `delta-ledger.md` has a
  disposition; none was silently ignored, and the wallpaper stays un-ported.
- `.agents/DEBT.md` — two new entries the live walkthrough found (checkout refusal
  under the default contained posture on local workspaces; the chip's facts going
  stale after external commits), plus the pre-existing debt inventory.

## The full-suite story, told straight

Three `just verify` runs happened on this work, on progressively later trees:

1. Run 1 (post-`61dee32` tree): 1361 pass / 12 skip / 3 fail.
2. Run 2 (same tree, quieter host): 1361 pass / 12 skip / 1 fail —
   `E2E-experts.test.ts`'s known load-sensitive second test, which passes standalone
   and is documented in `.agents/DEBT.md` with its unmodified-tree failures.
3. Run 3 (post-`78926ed` tree, while my own browser runs stole the host): 1359 pass /
   12 skip / 7 fail — six of the documented flake class (experts concurrency,
   J-CFG-model-provider, J-PREFS-shortcuts, E2E Experts and Teams) **and one real
   find**: the checkout E2E asserted the start-point select before the async
   `git.branch.list` result arrived, a race the standalone run never loses but the
   loaded suite did. Fixed in `6a717f3`; the fixed test passes standalone repeatedly.

The settlement run on the final tree (`d8303b7`, nothing else running):

**1365 pass / 12 skip / 1 fail** (1378 tests, 8423 expects, ~21 min). The one failure
is `E2E Experts and Teams`'s documented load-sensitive test — it has its own
`.agents/DEBT.md` entry with unmodified-tree failures — and it passed standalone
immediately after (2 pass, 79 s). Every checkout suite was green in the run.

Every non-checkout failure in every run belongs to the documented load-flake class
(`.agents/DEBT.md`, 2026-10-18 entry) or has a dedicated DEBT entry; each passes in
isolation. The checkout work itself is covered by deterministic journey tests that
never flaked across all three runs, plus the browser E2E and the live walkthrough.

## Where this leaves the Workbench

Still a single-operator Workbench; the dev authenticator remains a known security
limitation and no production-hardening claim is made. The next slices, in the order
the plan gates them, are T07 (durable steering queue — close the write-only channel
exactly as the DEBT entry prescribes, with the replay/idempotency analysis first) and
T08 (the thin `gh` adapter). The two new debt entries are small, honest limits of
what shipped this week, each with its closure written down.
