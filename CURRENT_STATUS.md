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
