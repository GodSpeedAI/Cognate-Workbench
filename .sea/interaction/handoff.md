# Handoff — Projecting This IDM into Cognate

## Current native Experts & Teams handoff (2026-10-15)

Published Cognate 0.4.0 is the runtime dependency; DomainForge 0.19.0 validates/formats the current
model with zero violations. The current published-package adapter check resolves **225 objects**,
27 Expert, four schedule, twenty cognitive and seven execution-world bindings, plus native runtime
inspection. J-RW-contained-workspace adds a human-only, host-configured Linux child containment
selection; its PostgreSQL/OS/browser slice is under final regression. J-EXPERT-PARALLEL remains
declared pending supported authoritative admission and application integration.

See [current debt evidence](../../docs/experts-debt-verification.md). Child containment is not
production identity, host isolation or aggregate resource containment. One process remains supported;
outbox fencing is not distributed run-write ownership.

## Historical native Experts & Teams handoff (2026-10-13)

The installed DomainForge adapter/CLI is 0.19.0. The complete model validates with zero violations,
projects 188 semantic objects, and resolves all 24 explicit Expert contracts in
`EXPERT_CAPABILITY_ANCHORS` / `bindExpertCapabilities` (`domain/index.ts`). The inherited
`deepseek-harness.interaction` namespace is preserved for existing evidence compatibility.

`expertsComponent` publishes typed identity, Team, conversation, Assignment, memory and human
decision capabilities. `expert.model.generate` routes the registered Assignment's frozen model
through existing published adapters. `expert.tool.invoke` and human-only `expert.effect.resolve`
use native Cognate commitments. The authoritative registry is a native shared thread state stream
with optimistic version checks and logical command receipts; `expertsProjection` is its redacted
read model. These are deliberate bindings, not automatic `.sea` policy execution.

`agent.expert` reuses `agent.coding`; the completion bridge supplies the missing 0.2.0
run-completion-condition evaluator through native continuations and persisted terminal runs.
The genuine subprocess interruption test preserves the child identity and delivers one handoff
without browser participation. Human review/settlement requires independent observable evidence;
the five-Expert disagreement scenario rejects unresolved acceptance.

Use [implementation evidence](../../docs/experts-verification.md) for current test results,
[user/runtime contracts](../../docs/experts-and-teams.md) for supported scope, and
[donor translation](../../docs/experts-donor-translation.md) for source provenance. Earlier
sections below are historical tranche records; their older package versions/object counts do not
describe the current adapter.

The Interaction Domain Model is sufficiently stable to serve as the canonical semantic source for downstream projections.

This model is consumed the way `.agents/skills/building-with-cognate/references/idm-to-cognate.md`
describes: `loadSemanticProjection(source, { uri })` (from `packages/domainforge/src/index.ts`,
pinned `@godspeedai/domainforge@0.18.1`) turns `interaction-model.sea` into a flat list of
read-only `SemanticObject`s — verified in `validation/domainforge-output.txt` (51 objects across
8 kinds: 14 Entity, 11 Resource, 2 Role, 11 Flow, 1 Relation, 1 Policy, 1 Metric, 10
EntityInstance). **Nothing becomes a Cognate capability implicitly.** `bindCapabilities` must be
called by hand, per capability, with an explicit `{ semanticId, capability: {id, version} }` pair.
The proposals below are exactly that: proposals for a future `bindCapabilities` call, not bindings
that exist yet.

## Per-journey proposed Cognate constructs

For each journey, "semantic anchor" names the `.sea` object (`Entity`/`Instance`) a future
`bindCapabilities` call would point `semanticId` at.

### J-A-first-use
- Semantic anchor: `Instance j_a_first_use of "CanonicalJourney"`.
- Proposed capability ids: `composer.enable` (published by a `Component` that also depends on
  `model.configure` and `workspace.select` completing).
- Continuation: none required to *start* — it's the entry journey — but the composer's
  disabled→enabled transition is naturally a gate: model it as a `Continuation` that resolves once
  both `J-CFG-model-provider` and `J-WS-select` have settled.
- Events: `composer.enabled` (`ctx.emit`), carrying `semanticRef` to `j_a_first_use`.
- Projections/artifacts: none of its own; composes child journeys' artifacts.

### J-CFG-model-provider
- Semantic anchor: `Entity "ModelProvider"`.
- Proposed capability ids: `model.configure`, `credentials.set`, `model.catalog`.
- Continuation type: none (single-shot host-side settings write); if the reconstruction wants
  hot-apply parity, treat "next request uses the new route" as an ordinary capability provider
  lookup at invocation time, not a continuation.
- Events: `model.configured` with `semanticRef` to the `ModelProvider` entity's `SemanticRef`.
- Projections/artifacts: Settings → Models page = a client-served frontend capability
  (`@cognate/client.provideCapability`) rendering `ModelConfig` state; Astryx form component.

### J-WS-select
- Semantic anchor: `Entity "WorkspaceRecord"`.
- Proposed capability ids: `workspace.select`, `workspace.create`.
- Continuation type: none for the happy path; the `defaultWorkspace.failed` recovery path is a
  `NextAffordance`, not a blocking continuation (user can retry `workspace.select` any time).
- Events: `workspace.selected` with `semanticRef` to `WorkspaceRecord`.
- Projections/artifacts: durable application/domain state per the spec's own interpretation table
  row ("workspace → durable application/domain state + scoped capabilities"); scoped capabilities
  are `tool.read`/`tool.bash`/`tool.edit` becoming reachable only once a workspace is selected.

### J-B-basic-session
- Semantic anchor: `Entity "Session"`.
- Proposed capability ids: `session.create`, `session.send`, `session.stream`, `session.list`.
- Continuation type: the in-flight turn is naturally a `ContinuationView` with `waitingOn` the
  model's streamed response; resolved by the terminal stream event, not a user decision.
- Events: `session.created`, `session.turn.started`, `session.turn.completed` — each carrying
  `semanticRef` to `j_b_basic_session`. Session history = durable `EventStore` projection (per the
  spec's own interpretation table).
- Projections/artifacts: chat view (`ui-chat`) and trajectory view (`ui-trajectory`) as two
  independent client Projections over the same event stream — do not conflate them into one
  renderer; the reference treats them as parallel, not variant, implementations.

### J-C-tool-execution
- Semantic anchor: `Entity "Tool"`.
- Proposed capability ids: `tool.read`, `tool.bash`, `tool.edit`, `tool.fs_search` — name these
  after the reference's own tool names (`read`, `bash`, `edit`, `fs_search`) per the traceability
  rule ("name capability ids after the IDM, not the other way round").
- Continuation type: none for read/bash; `tool.edit`'s read-before-mutation gate is better modeled
  as a `Capability requirement` precondition check inside the `edit` `Component.activate`, not a
  `Continuation` — it fails closed synchronously (`fs_not_observed`/`fs_stale_version`), it doesn't
  wait on anyone.
- Events: `tool.call.pending` / `tool.call.succeeded` / `tool.call.failed`, each carrying
  `semanticRef` to `j_c_tool_execution` and the specific tool `Entity`'s ref.
- Projections/artifacts: `ctx.artifact()` for the mutated file's before/after diff (settlement
  evidence for "verify actual workspace mutation" — correlate via RealityTrace if wired in, per
  `idm-to-cognate.md` traceability rule #4).

### J-D-approval
- Semantic anchor: `Entity "ApprovalGate"`, plus `Relation "ApprovalAuthorization"`.
- Proposed capability ids: `approval.request`, `approval.decide`.
- Continuation type: this is the canonical **policy gate + Continuation** case from the spec's
  interpretation table. Model as a `ContinuationView` opened by `approval.request` with
  `waitingOn: { kind: "approval", toolName, justification }`, resolved via `resolveContinuation`
  with an `allowed-once` or `reject` outcome. Default-deny: an unresolved/closed continuation with
  no explicit `allowed-once` must resolve to denial, matching "fail closed unless it is
  allowed-once."
- Events: `approval.asked`, `approval.decided` — mirror the reference's own event names 1:1 since
  they already carry the right semantics (exactly one `decided` per `asked`).
- Projections/artifacts: `ApprovalCard`/`Approvals` Astryx component (per idm-to-cognate.md's UI
  surface row) rendering the waiting banner + Reject/Allow-once buttons; reuse the reference's
  exact strings (see catalog) as Cognate-branded copy, not new microcopy.

### J-E-plan
- Semantic anchor: `Entity "PlanMode"`.
- Proposed capability ids: `plan.set`, `plan.exit`, `plan.review`.
- Continuation type: `plan.exit`'s user review step is another policy-gate Continuation, same
  shape as J-D's (`exit_plan_mode` already goes through the identical `PreToolDecision` waterfall
  per the evidence) — consider whether to literally reuse the `approval.*` continuation machinery
  parameterized by tool name, rather than inventing a parallel plan-specific continuation type.
- Events: `plan.activated`, `plan.presented`, `plan.approved` / `plan.revision_requested`.
- Projections/artifacts: `PlanArtifact` = `ctx.artifact()` holding the markdown plan text; plan
  badge = client Projection driven by `plan/mode`'s `{active, pending}` state.

### J-F-delegation
- Semantic anchor: `Entity "Subagent"`.
- Proposed capability ids: `subagent.start`, `subagent.send_message`, `subagent.interrupt`.
- Continuation type: the parent's wait on the child is a scoped agent Component/child execution
  per the spec's interpretation table, not a `Continuation` in the approval sense — model the
  child as its own `AgentDefinition.run` with the parent holding a reference (its `runId`), and
  the parent's own step blocks on that child run's terminal `RunView.output`, i.e. an ordinary
  `ctx.invoke` awaiting a nested run rather than a `resolveContinuation` call.
- Events: `subagent.started`, `subagent.result` — `subagent.result`'s payload becomes the value
  fed back into the parent's `ctx.step`.
- Projections/artifacts: sidebar subagent activity view = live-pushed client Projection over the
  parent's durable `subagentCatalog` (an `EventStore` projection, per the spec's own row for
  "session history").

### J-G-persistence
- Semantic anchor: `Entity "Session"` + `Entity "WorkspaceRecord"` (reused from J-B/J-WS — this
  journey is a *property* of those entities' durability, not a new domain object).
- Proposed capability ids: `session.inspect`, `session.reopen`, `workspace.reopen`.
- Continuation type: none — this is pure replay from Cognate's authoritative event log (per the
  spec's interpretation table row "persisted recovery → replay from Cognate authoritative
  events"). No continuation state should be needed to reconstruct the visible state; if one is,
  that's a signal the reconstruction leaked non-durable state somewhere.
- Events: none new; this journey's test asserts that `J-B-basic-session`'s events replay correctly
  after a process restart.
- Projections/artifacts: same chat/trajectory projections as J-B, re-rendered from replayed events.

### J-H-cancellation
- Semantic anchor: `Entity "Session"` (reused).
- Proposed capability ids: `session.steer`, `session.interrupt`, `session.retry`.
- Continuation type: the in-flight turn's `ContinuationView` (from J-B) is *closed* early here —
  model cancellation as `ContinuationClosedError`/an explicit `run.failed`-with-`kind:"cancelled"`
  event, not a silent drop. Deterministic provider-error injection maps to
  `InvocationFailure{kind:"failed"|"unavailable"|...}` from the capability provider.
- Events: `session.interrupted`, `session.retried`, `run.failed`.
- Projections/artifacts: none new; reuses J-B's chat/trajectory rendering to show the
  interrupted/error state distinctly.

## Remote Workspaces (T1) — proposed constructs

New semantic anchors: `Entity "ExecutionWorld"`, `Entity "WorldConnection"`,
`Resource "WorkspaceRoot"`, plus the `J-RW-*` journey instances. Proposed bindings (again
*proposals*, made by hand in `domain/index.ts` once the components exist):

| Semantic anchor | Capability id | Provider component |
|---|---|---|
| `ExecutionWorld` | `world.register` v1.0.0 | world-registry component |
| `ExecutionWorld` | `world.list` v1.0.0 | world-registry component |
| `ExecutionWorld` | `filesystem.readText` v1.0.0 | `@cognate/execution` execution-worlds component |
| `ExecutionWorld` | `filesystem.stat` v1.0.0 | `@cognate/execution` execution-worlds component |
| `ExecutionWorld` | `filesystem.writeText` v1.0.0 | `@cognate/execution` execution-worlds component |
| `ExecutionWorld` | `process.exec` v1.0.0 | `@cognate/execution` execution-worlds component |
| `WorkspaceRecord` | `workspace.select` v1.0.0 | `workspaceSelectComponent` (extended with a world) |
| `WorkspaceRecord` | `workspace.path` v1.0.0 | `workspacePathComponent` (now returns `{ root, executionWorldId }`) |

`tool.read` / `tool.edit` / `tool.bash` / `tool.run_code` keep their existing `Tool` anchor; only
their *implementation* changes (they invoke `filesystem.*` / `process.exec` instead of `node:fs`
and `Bun.spawn`). The model-facing tool catalog and the agent loop are unchanged.

The framework-owned contracts and the replaceable providers live in `@cognate/execution` (local +
deterministic memory providers) and `@cognate/execution-ssh` (SSH provider). The design rationale
for providers-not-parallel-tools is in
`docs/decisions/ADR-0013-execution-worlds-are-providers.md`.

## What downstream agents should NOT do

- Do not call `bindCapabilities` "for everything" just because a `SemanticObject` exists for it —
  bind only when a real `Component` capability is being published, per the explicit-only rule.
- Do not encode the approval/observation-policy authority rules as DomainForge `.sea` `Policy`
  declarations expecting them to be enforced — `.sea` `Policy` is a referenced constraint only
  (see `idm-to-cognate.md` "Gaps"); the real authority lives in hand-authored Cognate `Policy`
  (`packages/kernel-api/src/policy.ts`) and the approval `Continuation` machinery described above.
- Do not treat the two extra journeys (`J-CFG-model-provider`, `J-WS-select`) as optional filler —
  `J-A-first-use`'s settlement condition depends on both having their own capability ids to bind
  against; collapsing them loses the ability to test them independently (e.g. reconfiguring a
  provider mid-session, which is not part of "first use").
- Do not assume this file wires `domain/*.sea` in an app automatically — per `idm-to-cognate.md`
  "Gaps," there is no canonical `.sea/interaction/` → `domain/*.sea` step in the CLI; the
  reconstruction's own `domain/` directory must explicitly copy, symlink, or re-export
  `interaction-model.sea` (record that decision in the reconstruction app's own docs, not here).

## Test-file naming (per idm-to-cognate.md traceability rule #3)

One test file per canonical journey, named after the journey id: `J-A-first-use.test.ts`,
`J-CFG-model-provider.test.ts`, `J-WS-select.test.ts`, `J-B-basic-session.test.ts`,
`J-C-tool-execution.test.ts`, `J-D-approval.test.ts` (both approve and deny branches in one file,
per the spec's "second branch" instruction), `J-E-plan.test.ts`, `J-F-delegation.test.ts`,
`J-G-persistence.test.ts`, `J-H-cancellation.test.ts` (cancel + injected-error branches).

## Experts and Teams extension (proposed; implementation handoff)

The authoritative model now declares `ExpertDefinition`, persistent `Expert`, `Team`,
`TeamMembership`, scoped `Conversation`, `Assignment`, Cognate `ExpertRun`, `Handoff`,
`ExpertMessage`, and attributable `ExpertMemory`. `domain/index.ts` explicitly maps the proposed
capability IDs in `EXPERT_CAPABILITY_ANCHORS`; `bindExpertCapabilities()` verifies every anchor
through the installed Cognate DomainForge adapter. These bindings are semantic contracts only and
must not be described as runtime implementations until capabilities are registered and journey
tests pass.

### Proposed state and execution boundary

- Use Cognate durable shared thread state and compare-and-swap updates for Experts, Teams,
  memberships, assignments, messages, and logical handoff receipts. Do not add a second event store.
- Enforce exactly one active Orchestrator on activation, membership edits, removal, and replacement
  at the mutation boundary. Replacement is atomic; invalid concurrent writes fail/retry against
  current state. A draft may have zero Orchestrators and cannot execute.
- A Team request enters through its sole Orchestrator. Persist a bounded Assignment before starting
  a real Cognate Expert run. Intersect human scope, Team policy, member allowlist, and assignment
  authority. Capture provider/model/tools/context at run start.
- Resolve durable Specialist returns from Cognate run-completion continuations. Persist a structured
  Handoff keyed by Assignment/run identity and idempotency key before notifying the parent. Redelivery
  is deduplicated logically; the UI must not be required for reconciliation.
- Begin serialized. Existing `subagent.start` is fire-and-forget and is not a sufficient return
  contract. Do not infer safe parallelism from the Workbench planner.
- Conversations and memory retain Solo, Team-shared, and private Expert-in-Team scopes. Retrieved
  memory is untrusted input with source provenance; indexes/summaries are derived from durable facts.
- Human-only protected acceptance and approval remain outside Orchestrator authority.

### Live Expert inbox slice (`J-EXPERT-STEER`, `J-EXPERT-INBOX-RECOVER`)

Implemented in the native shared Experts thread, without a separate inbox engine. A human sends to
an explicitly running/waiting Team Assignment; an Expert sender must already have `team_message`
authority and address an active same-Team member. The CAS message record carries sequence,
correlation, sender, target Assignment/run, queued/pending/incorporated/cancelled/superseded/late
state and boundary acknowledgement. `team.inbox.consume` records one receipt per run and deterministic
decision boundary in the same shared-state mutation that acknowledges its ordered batch. If a message
arrives after the last allowed decision, it is marked `late` rather than falsely acknowledged as
incorporated. The agent
invokes it through Cognate before the next model request; messages are untrusted user context and do
not alter tools, mode, or settlement authority. The active provider call is never interrupted.
Private Expert-in-Team conversations do not opt into this inbox. `test/J-EXPERT-inbox.test.ts`
exercises a live mid-call send, incorporation before the next model decision, restart persistence,
stale target refusal, forged human Expert-message refusal, cancellation, sender permission, and late
terminal delivery. `test/J-EXPERT-inbox-replay.test.ts` SIGKILLs the Workbench subprocess after the
CAS receipt is committed but before the consume invocation returns; after restart the same run
replays that ordered message batch into a provider request exactly once. No claim is made about an
unpublished Cognate inbox API: this composes the installed 0.2 runtime's recorded invocations and
native shared-state CAS.

### Required implementation evidence

Implement and test the 12 catalog journeys before changing them from `proposed`: `J-EXPERT-CREATE`,
`J-EXPERT-SOLO`, `J-TEAM-CREATE`, `J-TEAM-ACTIVATE`, `J-TEAM-REPLACE-ORCHESTRATOR`,
`J-TEAM-DELEGATE`, `J-TEAM-HANDOFF`, `J-TEAM-CONVERSE`, `J-TEAM-RECOVER`, `J-TEAM-REVIEW`,
`J-EXPERT-MEMORY`, and `J-TEAM-SETTLEMENT`. Include restart, duplicate delivery, provider failure,
cancellation/late return, concurrent invariant updates, and authority-denial evidence.

## Workbench layer (unified harness experience model v2)

Source: `.agents/plans/unified_harness_experience_model_v2.md`. Tranche plan: `WORKBENCH-PLAN.md`; honest
status per validation trace: `WORKBENCH-DEVIATIONS.md`. The IDM gained 14 Entities, 12 Resources/Flows, the
`Reviewer` role, a `ReviewAuthorization` relation and 11 journeys (`J-WB-*`). Bindings are explicit and live
in `domain/index.ts` (`WORKBENCH_ANCHORS`): 23 capabilities anchored on 13 entities. `AttentionFocus`
remains ephemeral client state, while its publish/context/request capabilities have explicit semantic
contracts in the cognitive tranche. Test files follow the journey ids: `test/J-WB-<journey>.test.ts` plus
`test/E2E-workbench.test.ts` for the browser.

## Cognitive navigation binding

The observed cognitive journeys are `J-COG-cleanup`, `J-COG-liveverify`, `J-COG-attention`,
`J-COG-search`, and `J-COG-realitytrace`. The model separates `Case`, `SuccessCriterion`,
`WorldSnapshot`, `Verification`, `RiskAssessment`, `Experiment`, `MethodRecommendation`, and the
existing `AttentionFocus`. These names describe the current runtime contracts and event-backed
facts; they make no claim that a Case contains a filesystem world or that any `.sea` policy is
automatically enforced.

`domain/index.ts` exports `COGNITIVE_CAPABILITY_ANCHORS` and binds all 20 executable
`cognitiveComponent` contracts to those concepts. `src/server.ts` passes the resulting per-capability
SemanticRefs to the component. `CognitiveOptions.semanticRef` remains a fallback for existing
callers; the server uses `semanticRefs`. `test/cognitive-bindings.test.ts` checks the full binding
table and observes a `run.invocation.semanticRef` during the existing attention journey. Human-only
`world.settle` and `method.accept` remain runtime-enforced acts; binding a contract grants no
authority.

| IDM concept | Bound capabilities |
|---|---|
| `Case` | `case.open`, `case.derive`, `case.observe` |
| `SuccessCriterion` | `criterion.freeze` |
| `WorldSnapshot` | `world.freeze`, `world.fork`, `world.attach`, `world.discard`, `world.settle` |
| `Verification` | `verification.run` |
| `RiskAssessment` | `risk.assess` |
| `AttentionFocus` | `ui.focus.publish`, `ui.context`, `ui.request`, `ui.pending` |
| `Experiment` | `experiment.round`, `experiment.status` |
| `MethodRecommendation` | `method.review`, `method.accept`, `method.active` |

Validation evidence: DomainForge 0.19.0 reports zero violations and clean formatting; all 222
projected semantic objects load through the Cognate adapter. `bun run typecheck` and
`bun test test/cognitive-bindings.test.ts test/sea-format.test.ts` pass. The binding test confirms
the 20 published contracts each carry the expected SemanticRef, including one actual recorded
`ui.context` invocation. Existing entity, role, resource, relation, instance, policy and metric
name-to-ID pairs remain unchanged.

## Debt-closure native bindings and settlement evidence (2026-10-14)

`bindExpertCapabilities` resolves 27 Expert contracts, including the three safe-boundary inbox
contracts. `bindScheduleCapabilities` resolves `schedule.save`, `schedule.manage`, `schedule.list`
and internal-only `schedule.dispatch` against the existing Automation semantic anchor. Model budget
checks extend the existing `expert.save` / `expert.model.generate` contracts; paginated reads extend
`expert.context` / `expert.memory.read` without changing legacy response shapes.

The new canonical journeys are observed in real PostgreSQL/native runtime tests: schedule create,
fire and SIGKILL recovery; live inbox steering and crash replay; immutable partition migration and
source erasure; scoped cursor pagination; frozen context/economic budgets. UI tests inspect actual
schedule, handoff, usage and live-delivery receipts. See the canonical catalog and
`docs/experts-debt-closure.md` for exact boundaries and commands.

These bindings do not establish distributed run ownership, parallel workers on the installed SDK,
or production trust. Upstream PR https://github.com/GodSpeedAI/Cognate/pull/42 contains separately
tested native dispatch/concurrency/containment contracts; Workbench remains on published 0.2.0.

## Session / Workspace / Task RED journeys — bindings and settlement evidence (2026-10-20)

Six canonical journeys were added to the model first (instances `j_session_draft`,
`j_ws_directory_discovery`, `j_task_scope`, `j_task_move`, `j_run_task_attribution`,
`j_task_expert_provenance`; catalog section "Session / Workspace / Task / Run journeys"), together
with the `AgentRun` entity and the `SessionDraft`, `DirectorySuggestion`, `TaskBindingRecord`,
`TaskMoveRecord`, `RunTaskAttribution`, `AssignmentTaskRecord` resources and their flows.

`RED_JOURNEY_ANCHORS` in `domain/index.ts` binds the new capabilities explicitly:

| Semantic entity | Capabilities |
|---|---|
| `Session` | `session.create`, `session.task.bind` |
| `ExecutionWorld` | `workspace.directory.suggest` |
| `Task` (workbench family) | `task.list`, `task.move` (via `WORKBENCH_ANCHORS`) |

`task.create` gains `scope`/`sessionId` and `team.converse` gains a validated `taskId` on their
existing `Task`/`Conversation` anchors — no new bindings were minted for them. Projections: the
`sessions` projection folds `session.created` draft rows; the new public
`session-task-bindings` projection folds `session.task.bound`. Recording runs go through the
deterministic `agent.config` (`session.created`, `session.recorded`, and `workbench.recorded` now
accepting the `session.task.bound` family for task.create's ordered batch).

Settlement evidence (all formerly red, now observed):

- `test/J-SESSION-draft-contract.red.test.ts` (5) — durable drafts, explicit-workspace binding,
  idempotent identity with exactly one event, unknown-workspace refusal, first-turn reuse.
- `test/J-WS-directory-discovery.red.test.ts` (3) — directory-only prefix completion, fail-closed
  unknown worlds, bounded deterministic results with no file content.
- `test/J-TASK-session-scope.red.test.ts` (5) — workspace availability without auto-binding,
  session-scope visibility and durable bind/detach, identity/evidence-preserving move with
  destination revalidation, nonexistent-destination refusal, and J-RUN-task-attribution
  (unbound turns carry no taskId; bound turns freeze it into `session.turn.started`).
- `test/J-TASK-expert-provenance.red.test.ts` (1) — orchestrator and specialist Assignments retain
  the Task with distinct Runs; no automatic acceptance.
- `test/E2E-workspace-session-ux.red.test.ts` (4) — real-pointer journeys: + from Experts & Teams
  produces a selected, focused, reload-surviving draft; per-workspace + switches the current
  selection with no stale task; keyboard-driven directory completion opens the exact destination;
  task visibility is understandable at creation and a new session starts unbound.

Two test selectors were refined with the assertions preserved and strengthened (documented
in-file): the active-row button is matched by an anchored name (the row's archive control also
contains the title), and two reads tolerate the durable projection settle while asserting strictly
more (the session task is not even offered in the new session's combobox).

`just verify` (typecheck + full suite) passes: 1197 pass / 0 fail / 9 pre-existing skips.
DomainForge 0.19.0: `validate` zero violations, `fmt --check` clean. UX evidence screenshots are in
`screenshots/red-journeys/` (produced by `test/E2E-red-journeys-evidence.test.ts`).

Known limits are recorded in `docs/known-gaps.md`; the client's per-event projection re-read
amplification is the one item that needs an upstream framework change rather than app mitigation.

## Capability binding register and 2026-10-31 journey additions

Conformance pass over `feat/ui-production-readiness` (record: `validation/conformance-2026-10-31.md`).

### New and changed journeys

| Journey | Change | Capabilities | Evidence |
|---|---|---|---|
| `J-A-first-use` | revised to the first-run flow Welcome -> Connect a model provider (full provider form) -> Choose a folder -> ready; Configure later lands on a friendly empty state | `model.configure`, `secret.put`, `model.catalog`, `workspace.select`, `onboarding.dismiss` | `test/E2E-onboarding.test.ts` (not yet journey-named) |
| `J-DESKTOP-launch` | new host-surface journey: single instance per data home, app window, closing it stops the server, default-browser fallback, `stop` | none; CLI `launch` / `stop` in `src/cli.ts`, `src/desktopWindow.ts` | `test/J-DESKTOP-launch.test.ts` |
| `J-UI-command-palette` | new UI-surface journey; the palette owns no mutation | none of its own; runs existing handlers | `test/ui-shell.test.tsx`, `test/E2E-ui-shell.test.ts` |
| `J-UI-inspector` | new UI-surface journey; tabs Context, Changes, Details, Files, Config | reads through `workspace.files.list`, `workspace.file.read`, `config.file.read`, `config.file.apply` | `test/ui-inspector-tabs.test.tsx`, `test/E2E-ui-shell.test.ts` |
| `J-PREFS-shortcuts` | variant added: global application shortcuts | `settings.changeShortcuts` | `test/J-PREFS-shortcuts.test.ts` |
| `J-WS-directory-discovery` | variant added: partial, home-relative and fuzzy folder matching | `workspace.directory.suggest` | `test/J-WS-directory-suggest-matching.test.ts` |
| `J-CFG-config-edit`, `J-WS-files-browse`, `J-SECRETS-storage` and ten other model-only journeys | catalog entries added (the `.sea` records already existed) | see register below | named tests under `test/` |

`J-DESKTOP-launch` is a host-surface journey: it needs no capability, binding or event, and a
downstream agent must not mint one. Its settlement is observable process behavior (health on the
app URL, the second launch reusing the instance, the port closed and `server.lock` removed after
the window closes).

### Capability binding register

Every capability id listed in `GRANTED_CAPABILITIES` in `src/server.ts` as a literal (ids supplied
by `*_ANCHORS` spreads are bound by those tables, already documented above). "Bound to" is the
semantic entity and the exported table in `domain/index.ts`.

| Capability | Bound to | Journeys |
|---|---|---|
| `agent.harness.list` | HarnessCli (HARNESS_CAPABILITY_ANCHORS) | J-HARNESS-detect, J-HARNESS-unavailable |
| `case.derive` | Case (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup, J-COG-liveverify |
| `case.observe` | Case (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-liveverify |
| `case.open` | Case (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup |
| `config.file.apply` | UserPreferences (TRANCHE11_ANCHORS) | J-CFG-config-edit, J-UI-inspector |
| `config.file.read` | UserPreferences (TRANCHE11_ANCHORS) | J-CFG-config-edit, J-UI-inspector |
| `config.path` | UserPreferences (TRANCHE11_ANCHORS) | J-CFG-config-path |
| `criterion.freeze` | SuccessCriterion (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup |
| `execution.containment.inspect` | named in (domain/index.ts:236) | J-RW-contained-workspace |
| `execution.world.check` | named in (domain/index.ts:235) | none (support capability) |
| `execution.world.connect` | named in (domain/index.ts:231) | none (support capability) |
| `execution.world.disconnect` | named in (domain/index.ts:233) | none (support capability) |
| `execution.world.probe` | named in (domain/index.ts:234) | none (support capability) |
| `execution.wsl.list` | ExecutionWorld (CONFORMANCE_GAP_ANCHORS) | J-RW-select-world |
| `experiment.round` | Experiment (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-search |
| `experiment.status` | Experiment (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-search |
| `git.branch.list` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-BIND |
| `git.checkout.attach` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-BIND |
| `git.checkout.merge` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-LIFECYCLE |
| `git.checkout.recreate` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-LIFECYCLE |
| `git.checkout.remove` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-LIFECYCLE |
| `git.checkout.status` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-BIND, J-CHECKOUT-LIFECYCLE |
| `harness.turn.advance` | HarnessBinding (HARNESS_CAPABILITY_ANCHORS) | J-HARNESS-session, J-HARNESS-approval, J-HARNESS-cancel, J-HARNESS-unavailable |
| `identity.inspect` | named in (domain/index.ts:539) | J-AUTH-SESSION |
| `identity.session.issue` | named in (domain/index.ts:537) | J-AUTH-SESSION, J-AUTH-TENANT-ISOLATION |
| `identity.session.revoke` | named in (domain/index.ts:538) | J-AUTH-SESSION |
| `method.accept` | MethodRecommendation (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-search |
| `method.active` | MethodRecommendation (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-search |
| `method.review` | MethodRecommendation (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-search |
| `model.catalog` | ModelProvider (TRANCHE11_ANCHORS) | J-A-first-use, J-CFG-model-provider, J-CFG-model-catalog |
| `model.configure` | named in (domain/index.ts:84) | J-A-first-use, J-CFG-model-provider |
| `model.generate` | named in (domain/index.ts:82) | none (support capability) |
| `observation.record` | VerificationObservation (CONFORMANCE_GAP_ANCHORS) | J-COG-realitytrace |
| `observation.status` | VerificationObservation (CONFORMANCE_GAP_ANCHORS) | J-COG-realitytrace |
| `onboarding.dismiss` | UserPreferences (CONFORMANCE_GAP_ANCHORS) | J-A-first-use |
| `plan.state` | named in (domain/index.ts:141) | J-RUN-task-attribution |
| `plugin.catalog` | shares the `Plugin` anchor of `plugin.install` (`catalogSemanticRef ?? installSemanticRef` in `src/capabilities/pluginInstall.ts`) | none (support capability) |
| `plugin.install` | Plugin (TRANCHE11_ANCHORS) | J-PLG-install |
| `plugin.uninstall` | Plugin (TRANCHE11_ANCHORS) | J-PLG-install |
| `provider.activate` | ModelProvider (PROVIDER_CAPABILITY_ANCHORS) | J-CFG-provider-switch |
| `provider.delete` | ModelProvider (TRANCHE11_ANCHORS) | J-CFG-provider-delete |
| `provider.list` | ModelProvider (PROVIDER_CAPABILITY_ANCHORS) | J-CFG-provider-switch |
| `provider.test` | ModelProvider (PROVIDER_CAPABILITY_ANCHORS) | J-CFG-provider-test |
| `risk.assess` | RiskAssessment (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup |
| `secret.put` | named in (domain/index.ts:83) | J-A-first-use, J-SECRETS-storage |
| `secrets.backend.describe` | ModelProvider (TRANCHE11_ANCHORS) | J-SECRETS-storage |
| `session.create` | Session (RED_JOURNEY_ANCHORS) | J-B-basic-session, J-SESSION-draft, J-UI-command-palette |
| `session.harness.bind` | HarnessBinding (HARNESS_CAPABILITY_ANCHORS) | J-HARNESS-session, J-HARNESS-unavailable |
| `session.harness.resolve` | HarnessBinding (HARNESS_CAPABILITY_ANCHORS) | J-HARNESS-session |
| `session.history` | named in (domain/index.ts:86) | J-SESSION-draft, J-RUN-task-attribution |
| `session.setArchived` | Session (TRANCHE11_ANCHORS) | J-SESSION-archive |
| `session.task.bind` | Session (RED_JOURNEY_ANCHORS) | J-TASK-scope, J-RUN-task-attribution |
| `settings.changeAppearance` | named in (domain/index.ts:182) | none (support capability) |
| `settings.changeCodingTools` | named in (domain/index.ts:185) | none (support capability) |
| `settings.changeContainment` | named in (domain/index.ts:540) | J-RW-AGGREGATE-CONTAINMENT |
| `settings.changeFontSize` | named in (domain/index.ts:183) | none (support capability) |
| `settings.changeLanguage` | named in (domain/index.ts:181) | none (support capability) |
| `settings.changePerformanceDetail` | named in (domain/index.ts:184) | none (support capability) |
| `settings.changePermission` | named in (domain/index.ts:180) | none (support capability) |
| `settings.changePlugin` | named in (domain/index.ts:188) | none (support capability) |
| `settings.changePreset` | named in (domain/index.ts:187) | none (support capability) |
| `settings.changeSendBehavior` | named in (domain/index.ts:186) | none (support capability) |
| `settings.changeShortcuts` | UserPreferences (TRANCHE11_ANCHORS) | J-PREFS-shortcuts, J-UI-command-palette |
| `settings.changeSpending` | named in (domain/index.ts:189) | J-CONTEXT-BUDGET |
| `settings.changeWorkDetails` | named in (domain/index.ts:179) | none (support capability) |
| `subagent.start` | named in (domain/index.ts:157) | J-F-delegation, J-EXPERT-PARALLEL |
| `task.checkout.resolve` | Task (CHECKOUT_CAPABILITY_ANCHORS) | J-CHECKOUT-EXECUTION |
| `tool.bash` | named in (domain/index.ts:113) | J-C-tool-execution, J-RW-exec-remote, J-RW-coexist, J-RW-switch, J-WB-protected-evidence |
| `tool.edit` | named in (domain/index.ts:112) | J-C-tool-execution, J-RW-edit-remote, J-RW-switch, J-WB-protected-evidence |
| `tool.read` | named in (domain/index.ts:111) | J-C-tool-execution, J-RW-read-remote, J-RW-coexist, J-RW-switch |
| `tool.run_code` | named in (domain/index.ts:114) | J-RW-exec-remote |
| `ui.context` | AttentionFocus (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-attention |
| `ui.focus.publish` | AttentionFocus (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-attention |
| `ui.pending` | AttentionFocus (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-attention |
| `ui.request` | AttentionFocus (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-attention |
| `verification.run` | Verification (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup, J-COG-liveverify |
| `workspace.contained.select` | named in (domain/index.ts:232) | J-RW-contained-workspace, J-RW-AGGREGATE-CONTAINMENT |
| `workspace.delete` | named in (domain/index.ts:210) | J-WS-delete |
| `workspace.directory.suggest` | ExecutionWorld (RED_JOURNEY_ANCHORS) | J-WS-directory-discovery |
| `workspace.file.read` | WorkspaceRecord (RED_JOURNEY_ANCHORS) | J-WS-files-browse, J-UI-inspector |
| `workspace.files.list` | WorkspaceRecord (RED_JOURNEY_ANCHORS) | J-WS-files-browse, J-UI-inspector |
| `workspace.path` | named in (domain/index.ts:115) | J-RW-contained-workspace, J-RW-add-workspace, J-RW-coexist |
| `workspace.rename` | named in (domain/index.ts:209) | none (support capability) |
| `workspace.select` | named in (domain/index.ts:85) | J-A-first-use, J-WS-select, J-RW-add-workspace, J-RW-reconnect, J-RW-coexist, J-RW-switch, J-SESSION-draft, J-WS-directory-discovery, J-UI-command-palette |
| `world.attach` | WorldSnapshot (COGNITIVE_CAPABILITY_ANCHORS) | none (support capability) |
| `world.discard` | WorldSnapshot (COGNITIVE_CAPABILITY_ANCHORS) | none (support capability) |
| `world.fork` | WorldSnapshot (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup |
| `world.freeze` | WorldSnapshot (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup, J-COG-liveverify |
| `world.settle` | WorldSnapshot (COGNITIVE_CAPABILITY_ANCHORS) | J-COG-cleanup |

### External agent-harness bindings (J-HARNESS-*)

`HARNESS_CAPABILITY_ANCHORS` in `domain/index.ts` binds `agent.harness.list` to `HarnessCli` and
`session.harness.bind`, `session.harness.resolve`, `harness.turn.advance` to `HarnessBinding`.
Event `session.harness.bound` is recorded by `agent.config` (`session.recorded`) and folded, with the
agent-emitted `harness.session.recorded`, by the public `session-harness-bindings` projection.
Agent `agent.harness` takes the same input as `agent.coding`; a UI that sees a binding must start it
instead of `agent.coding`. Gaps stated, not hidden: per-tool authority checks, containment of the
CLI's effects, protected-evidence blocking and settlement as `agent.coding` do not apply; the
host-process runner (`src/agents/harness/hostProcess.ts`) exists because the Cognate execution port
cannot stream or take stdin (`.agents/DEBT.md`, `framework-gap-streaming-process.md`).


### Binding gaps closed (2026-11-01)

`CONFORMANCE_GAP_ANCHORS` in `domain/index.ts` (bound by `bindConformanceGaps`, wired in `src/server.ts`)
now anchors `onboarding.dismiss` on `UserPreferences`, `execution.wsl.list` on `ExecutionWorld`, and
`observation.status` / `observation.record` on the `VerificationObservation` resource. Journeys:
`J-A-first-use` (dismiss), `J-RW-select-world` (wsl list variant), `J-COG-realitytrace` (read side).

### Workspace delete, provider errors, remote harness (2026-11-01)

- `workspace.delete` archives the workspace's non-archived sessions (J-WS-delete); files on disk are never touched.
- `model.request.retried` payload is `{attempt, maxAttempts, maxRetries, delayMs, errorCode, message, baseURLHost, error}` and is emitted on every failed attempt (J-H-provider-error). The `delayMs` is the recorded wait before the next attempt.
- Mobile remote: a turn for a harness-bound session starts `agent.harness`; a running harness turn is refused with `harness-busy` (HTTP 409, `message` readable). Evidence `test/J-HARNESS-remote.test.ts`.

## Provider parity, server side (J-CFG-provider-switch, J-CFG-provider-test)

- `model.configure` keeps the stored secret when `apiKey` is omitted or empty; only a non-empty key replaces it. `provider.activate` re-mounts a stored route and records it as `model.configured` (so `model-config` `current` and `provider-routes` follow, and the choice survives restart). `provider.delete` accepts any stored provider id; only the active one clears the live route. `provider.list` is the UI read (projection `provider-routes` plus `hasKey`/`isCurrent`). `provider.test` lists models only (never a completion).
- Journey evidence: `test/J-CFG-provider-switch.test.ts`, `test/J-CFG-provider-test.test.ts`, extended `test/J-CFG-model-catalog.test.ts`, `test/J-CFG-provider-delete.test.ts`, `test/J-CFG-model-provider.test.ts`.
- Framework gap: none for Azure on the chat protocol (api-key header and api-version query are applied through the adapter's `fetch` option). Azure on Responses/Anthropic wire is not offered.
- UI read contract: `provider.list` returns `{ providers: StoredProviderRow[] }` with `StoredProviderRow = { providerId, displayName, protocol, baseURL, model, hasKey, isCurrent, keyless, auth?, apiVersion? }` (current first, then by name). The public `provider-routes` projection holds `{ providerId, baseURL, protocol, model, displayName?, auth?, apiVersion?, prices? }` per `provider:<providerId>` and has no key state.
