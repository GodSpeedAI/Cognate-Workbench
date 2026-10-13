# Handoff — Projecting This IDM into Cognate

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
in `domain/index.ts` (`WORKBENCH_ANCHORS`): 23 capabilities anchored on 13 entities. `AttentionFocus` has no
capability on purpose (client state). Test files follow the journey ids: `test/J-WB-<journey>.test.ts` plus
`test/E2E-workbench.test.ts` for the browser.
