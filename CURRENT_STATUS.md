# Current status — revision 34

The egm-bootstrap documentation pass is complete: 18 EGM-compliant contract
files (README.md blueprints) now cover the root, `domain/`, `scripts/`, `src/`
and all 14 `src/**` code directories, generated with the `egm-bootstrap` skill
(`elephant-goldfish-model`) and left semantically faithful by a drift review.
Docs-only change; no runtime code was touched.

**What was written.** Every contract carries Overview / Interface / Invariants /
Side Effects / Verification grounded in exact `[file:symbol]` citations from a
fresh read of the code (scouts ran inline, one worker at a time — RAM
constraint). The root README kept its human-authored product documentation and
gained a Repository Blueprint section (subdirectory boundaries, global
invariants/side effects, `just verify` verification) before `## License`.
Pruned out per the skill: `test/`, `docs/`, `fixtures/`, `screenshots/`,
`.agents/`, `.sea/`, `.github/`, `.jolli/`, `.serena/`.

**Verification.** A dedicated correctness pass explicitly read all 18 files:
18/18 PASS (sections, markdown, every relative link resolves, ~60 named test
files exist, 150+ citation spot-checks). The egm-drift-report pass verified
~350 documented claims plus a ~160-symbol reverse export inventory per
directory: verdict consistent, no doc-to-code hallucinations. Its four findings
were fixed and re-verified against source (`WORKBENCH_EVENTS` 27→28,
`seedCatalog` 16→17 in `src/workbench/README.md`; "30 mounted capability
components plus observation/settlement wiring" in `src/README.md`; secrets-path
env precedence in the root blueprint). One stale cross-reference in
`src/ui/experts/README.md` was corrected to link `src/ui/README.md`. No test
suite was run for this change (docs-only); the last full gate remains the
revision-33 settlement run.

**Deliberately not done.** No code changes; `cognate.config.ts` remains an
unconsumed metadata file (documented as such); `src/secrets.ts`'s module header
still says `$COGNATE_HARNESS_HOME` without the `COGNATE_WORKBENCH_HOME`
precedence (source comment, out of the skill's docs-only scope — noted for the
next code touch). Worker evidence and the drift report live outside the repo in
`/tmp/egm-cognate-status/` (worker logs, subtree-index checkpoints,
`final-verification.md`, `drift-report.md`).

**Remaining open:** unchanged from revision 33 — T07 durable steering queue,
T08 GitHub adapter, turn-attributed diffs, the projection re-read amplification
upstream proposal, and the other pre-existing debts. Still a single-operator
Workbench, not production-hardened multi-user.

---

# Current status — revision 33

The PandaCode affordance-delta mission is settled: task-scoped Git checkouts (Priority A, T05+T06)
plus the earlier conversation-affordance slices (T01–T04) are implemented, tested and evidenced on
`main`; T07 (durable steering queue) and T08 (GitHub adapter) remain designed-and-deferred, not
built. Reports: `.agents/plans/pandacode-affordance-delta/` (delta ledger, architecture, plan,
implementation, verification, deferred, final).

**Model first.** The IDM gained `TaskCheckoutRecord` (resource + Task→WorkspaceRecord flow) and
three canonical journeys (J-CHECKOUT-BIND/-EXECUTION/-LIFECYCLE) with catalog entries, validated
before any runtime code (`domainforge validate` 0 violations, `fmt --check` clean; the domain loader
now reports 257 objects). All seven checkout capability ids are anchored on the Task entity in
`domain/index.ts` (`CHECKOUT_CAPABILITY_ANCHORS` + `bindCheckoutCapabilities`).

**Implemented.** `src/workbench/gitOps.ts` (bounded Git operations: worktree
create/status/merge/remove/recreate, argument arrays, no shell, world-provider execution);
`src/capabilities/taskCheckout.ts` (six operator-only capabilities + the agent-invocable
`task.checkout.resolve` read); the public `task-checkout-bindings` projection; `agent.coding`
resolves the binding before each turn and freezes `checkoutRoot`/`checkoutBranch` into
`session.turn.started`; the composer's checkout chip (suggested branch from the task title, default
start point, merge gated on commits that actually exist, two-step remove, recreate when the folder
vanished). One live checkout per task is enforced before anything is created.

**Safety properties are tested, not asserted:** work is never discarded (dirty/untracked removal
refused), an unmerged branch outlives its checkout, conflicts report files and abort cleanly, a
RUNNING task is never re-pointed, a refused bind creates nothing, two tasks never share a
checkout, restart restores the binding from the event log.

**Gates.** Focused suites: 17 pass / 124 expects (git-ops, J-CHECKOUT-parallel, J-CHECKOUT-lifecycle
with 7 tests, ui-checkout) + E2E-checkout 1 pass in real Chromium; `just typecheck` clean;
`domainforge validate` clean. Live operator walkthrough on a real server captured 7 states
(`screenshots/workbench/checkout-live-01..07.png`). Three full `just verify` runs are recorded
verbatim in the verification report; the one checkout failure across them was a real race in the
checkout E2E itself (asserted the async branch list before it loaded), fixed in `6a717f3`; every
other failure is the documented pre-existing host-load flake class, each passing in isolation.
Settlement run on the final tree: **1365 pass / 12 skip / 1 fail** — the one failure is the documented
pre-existing `E2E Experts and Teams` load-sensitive test (passes standalone, 2 pass / 79 s); every
checkout suite green in the run.

**New debt (`.agents/DEBT.md`):** checkout capabilities inherit the agent-effects refusal under the
default contained posture on `local` worlds (message aimed at agent runs); the chip's facts go stale
after commits made outside the app until a reload (capability layer re-checks, so no unsafe
action is possible).

**Remaining open:** T07 durable steering queue (close the write-only `queue-next` channel exactly as
the DEBT entry prescribes, replay/idempotency analysis first); T08 thin `gh` adapter (argument
arrays, no credential storage, untrusted PR content, operator-gated PRs); turn-attributed diffs
(attribution-correctness prerequisite); plus the pre-existing open debts from revision 32
(per-event projection re-read amplification, symlinked directory suggestions, live aggregate
memory accounting, multi-tenant seeding, distributed schedule-evaluator ownership, generalized SDK
inbox, co-tenancy E2E flakiness under parallel verify). Still a single-operator Workbench, not
production-hardened multi-user.

Next: propose the projection-sync batching/delta change upstream; then T07 when its
replay/idempotency analysis is done.

---

# Current status — revision 32

The RED-journeys mission is settled: the five intentionally red Session/Workspace/Task/Run suites
and the E2E UX suite on `test/red-session-workspace-task-contracts-20261020` (PR #2) are green
against real Cognate execution.

**Model first.** The IDM gained the `AgentRun` entity, the SessionDraft / DirectorySuggestion /
TaskBindingRecord / TaskMoveRecord / RunTaskAttribution / AssignmentTaskRecord resources and flows,
and six canonical journeys (J-SESSION-draft, J-WS-directory-discovery, J-TASK-scope, J-TASK-move,
J-RUN-task-attribution, J-TASK-expert-provenance) with catalog entries — validated before any
implementation (`domainforge validate` 0 violations, `fmt --check` clean, 252 objects). New
capabilities are bound explicitly in `domain/index.ts` (`RED_JOURNEY_ANCHORS`; `task.list`/`task.move`
joined the workbench Task family).

**Implemented.** Durable idempotent session drafts (deterministic identity, one `session.created`
event, draft rows survive reload/restart, explicit-workspace binding, first-turn reuse). Read-only
execution-world directory suggestions with one shared accessible picker across the Add-workspace
dialog, SSH/WSL folder step and first-run chooser. One Task entity with workspace/session scope,
`task.list` visibility semantics, governed `task.move` (identity/evidence/provenance preserved,
stale bindings invalidated, in-flight refused), and the durable per-session `session.task.bind`
binding surfaced as the composer's Task control. `agent.coding` freezes the validated taskId into
`session.turn.started`; `team.converse` validates and stamps the Task on orchestrator and specialist
assignments. The + action creates a selected draft from every screen, focuses the composer, and
shows retryable errors; New-task presents the This workspace / This session choice; TaskDetail
gains Move-or-promote with consequence previews.

**Races found by existing expert E2E suites, fixed in the product:** the session-task-bindings store
no longer mounts with no session open (per-event projection re-read amplification exhausted
Chromium's request pool on long logs); `startNewSession` closes panels at click time instead of
after its async invoke. The amplification itself is a known limitation needing an upstream framework
change (docs/known-gaps.md).

**Gates.** All five red suites green (18 tests, real runtime + real Chromium); `just verify` green
(1,197 pass / 9 pre-existing skips / 0 fail, 1,206 tests); expert regression suites green in
isolation; DomainForge validation and the Cognate adapter check clean. UX evidence captured in
`screenshots/red-journeys/` by `test/E2E-red-journeys-evidence.test.ts`. Two red-test selectors were
refined with assertions preserved/strengthened (documented in-file and in the handoff).

**Remaining open:** the client's per-event projection re-read amplification (framework change to
propose upstream); strict-prefix directory suggestions with symlinked directories never offered;
no retroactive draft rows for pre-existing sessions; the move preview is descriptive, not a
destination-config diff; plus the pre-existing open debts from revision 31 (co-tenancy E2E flakiness
under parallel verify, live aggregate memory accounting, multi-tenant seeding, distributed
schedule-evaluator ownership, generalized SDK inbox). Still a single-operator Workbench, not
production-hardened multi-user.

Next: mark PR #2 ready for review with the final report; propose the projection-sync batching/delta
change upstream.
