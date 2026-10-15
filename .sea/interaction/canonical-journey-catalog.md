# Canonical Journey Catalog — DeepSeek Harness Interaction Domain Model

Each entry mirrors the fields on the corresponding `Instance ... of "CanonicalJourney"` in
`interaction-model.sea` (instance name in parentheses), plus fields the `.sea` representation
cannot carry cleanly (nested failure/recovery detail, cross-references) documented here in prose.
Evidence tags refer to `../reference/observations/{product-characterization.md,
runtime-and-provider.md}` and `.agents/prompts/deepseek-harness-reconstruction-test.md` (Phase 6).

## Cognitive navigation (observed in the Cognate runtime)

These entries map to the executable `test/J-COG-*.test.ts` journeys. The model separates
Case intent, frozen criterion, world identity, verification evidence, operational risk, bounded
experimentation, method decisions, and ephemeral human attention. A candidate that is eligible for
settlement is still unsettled until the human acts.

### J-COG-cleanup (`j_cog_cleanup`)

- **Actor/intention**: User proposes a desired repository change against a known settled world.
- **Preconditions/affordance**: workspace and execution world; `case.open`, `criterion.freeze`,
  `world.freeze`, `world.fork`, `risk.assess`, `verification.run`, `case.derive`, `world.settle`.
- **Transition/output**: declare the outcome and checks; freeze criterion and baseline; fork a
  candidate; mediate consequential actions; freeze and verify candidate; repair deviations.
- **Evidence/settlement**: event-backed Case and world lineage; failed checks block settlement;
  only a human can move the settled head.
- **Failure/recovery/next**: restart reconstructs state; denied or unresolved approval leaves the
  protected action unapplied; failed checks return to inspection and repair. Observed by
  `test/J-COG-cleanup.test.ts`.

### J-COG-liveverify (`j_cog_liveverify`)

- **Actor/intention**: OperatorAgent changes a workspace within a Case that declared its checks.
- **Preconditions/affordance**: settled baseline and frozen criterion; `case.observe`, `world.freeze`,
  `verification.run`, `case.derive`.
- **Transition/output**: consequential edit triggers candidate hashing and the declared checks;
  observations are appended as facts and Case derivation exposes the deviation or next action.
- **Evidence/settlement**: unchanged work emits no new verification; failed checks keep settlement
  unreachable; a repair creates and verifies a distinct candidate. Observed by
  `test/J-COG-liveverify.test.ts`.

### J-COG-attention (`j_cog_attention`)

- **Actor/intention**: User focuses a recorded failure and asks what happened.
- **Preconditions/affordance**: a semantic evidence reference; `ui.focus.publish`, `ui.context`,
  `ui.request`, `ui.pending`.
- **Transition/output**: focus selects a small neighborhood derived from recorded facts; the agent
  answers from that neighborhood or asks the page to render a read-only Surface.
- **Evidence/settlement**: changing focus changes the grounded answer; attention changes no
  authoritative facts and grants no authority. Invalid focus or mutation requests are refused.
  Observed by `test/J-COG-attention.test.ts`.

### J-COG-search (`j_cog_search`)

- **Actor/intention**: User compares candidate approaches under a fixed criterion and round budget.
- **Preconditions/affordance**: settled parent, frozen criterion and checks; `experiment.round`,
  `experiment.status`, `method.review`, `method.accept`, `method.active`.
- **Transition/output**: isolated rounds are scored and retained/discarded/escalated; repeated
  residuals may produce a candidate MethodRecommendation.
- **Evidence/settlement**: candidates never auto-settle; recommendation alone does not change the
  active method; only explicit human acceptance does. Observed by `test/J-COG-search.test.ts`.

### J-COG-realitytrace (`j_cog_realitytrace`)

- **Actor/intention**: OperatorAgent records verification or world-lineage facts while observation
  delivery is enabled.
- **Preconditions/affordance**: configured runtime outbox; `world.freeze`, `verification.run`.
- **Transition/output**: durable event and observation intent are correlated, delivered, and queried
  through the existing RealityTrace adapter.
- **Evidence/settlement**: accepted or duplicate observer status links back to the original durable
  event. Observed by `test/J-COG-realitytrace.test.ts`.

---

## J-A-first-use (`j_a_first_use`)

- **Purpose**: get a first-time user from a cold launch to a usable composer.
- **Actor/role**: User.
- **Initiating condition**: launch `dsh web` / open the reconstruction for the first time.
- **Current → desired state**: no session, no workspace, composer disabled → composer enabled with
  a routable model.
- **Preconditions**: none (this is the entry journey); default-workspace init is attempted
  automatically at boot and may fail.
- **Steps**: launch → initial UI → configure a model (delegates to `J-CFG-model-provider`) →
  choose workspace (delegates to `J-WS-select`) → composer becomes available.
- **Capabilities/actions (proposed)**: `model.configure`, `workspace.select`, `composer.enable`.
- **Policy/authority**: none beyond the workspace/model preconditions gating the composer.
- **Artifacts/resources**: `ModelConfig`, `WorkspaceSelection`, `ComposerAvailability`.
- **Outcome**: composer accepts input.
- **Evidence**: `product-characterization.md` §2 ("The session composer remains unavailable until
  a workspace is selected" — actually sourced from §4, cross-referenced in §2 empty-states) and
  §4 workspace gating; spec Journey A (Phase 6, lines ~588-595).
- **Settlement criteria**: composer's disabled state clears; `modelCatalog()` lists ≥1 usable
  route.
- **Failure/recovery**: default-workspace auto-init failure shows `defaultWorkspace.failed` copy
  ("Unable to create default workspace. Use Choose workspace to select a folder.") — recovery path
  is the manual `J-WS-select` journey.
- **Next decisions/affordances**: `J-B-basic-session` (create first session).
- **Known variants**: auto-init succeeds (skips explicit workspace step) vs. auto-init fails
  (explicit Choose workspace required).
- **Evidence class**: declared.

## J-CFG-model-provider (`j_cfg_model_provider`)

- **Purpose**: configure a usable model route so sessions can generate.
- **Actor/role**: User.
- **Initiating condition**: open Settings → Models with no usable provider, or add/change one.
- **Preconditions**: Settings surface reachable independent of workspace/session state.
- **Steps**: open Settings → Models → select provider (DeepSeek / third-party / Custom model API)
  → enter credentials/base URL/protocol/model list → save → route usable immediately.
- **Capabilities/actions (proposed)**: `model.configure`, `credentials.set`, `model.catalog`.
- **Policy/authority**: credential writes go through `credentials.set` exclusively — separate
  channel from non-secret provider config (inferred: secrets never round-trip unmasked).
- **Artifacts/resources**: `ModelConfig`.
- **Outcome**: a new/updated provider entry in `cordis.patch.yml`-equivalent persisted config.
- **Evidence**: `product-characterization.md` §3 (Settings → Models), `runtime-and-provider.md`
  §5 (Custom provider configuration fields).
- **Settlement criteria**: `modelCatalog()` includes the route; "Model changes take effect on the
  next request" — no server restart needed (hot-apply).
- **Failure/recovery**: not directly documented; isolated provider failures are surfaced via
  `modelCatalog()`'s "isolated provider failures" field (inferred fail-soft, per-provider).
- **Next decisions/affordances**: `J-A-first-use` (composer unlock), `J-B-basic-session`.
- **Known variants**: DeepSeek credential-only onboarding mode (restricted `ProviderEditor`) vs.
  full custom-provider editor (base URL, API protocol picker, model list, advanced YAML-only
  fields).
- **Evidence class**: declared.

## J-WS-select (`j_ws_select`)

- **Purpose**: bind the session to a working directory so composer/file/shell tools have scope.
- **Actor/role**: User.
- **Initiating condition**: no workspace selected, or user wants to add/switch one.
- **Preconditions**: directory-picker capability available (native or browse variant).
- **Steps**: click "Choose workspace" → pick a project directory → workspace record
  created/adopted → composer unlocks.
- **Capabilities/actions (proposed)**: `workspace.select`, `workspace.create`, `composer.enable`.
- **Policy/authority**: workspace is host-side only — "invisible to models (no tools, no prompt
  text, no session events)".
- **Artifacts/resources**: `WorkspaceSelection`, `WorkspaceRecord` (stable id over canonical path,
  display title, ordered session account).
- **Outcome**: a `WorkspaceRecord` exists.
- **Evidence**: `product-characterization.md` §4; spec's "Required Cognate Interpretation" table
  row "workspace → durable application/domain state + scoped capabilities".
- **Settlement criteria**: workspace persisted via the storage domain; a session's declared cwd
  validated against `SessionHeader.cwd`.
- **Failure/recovery**: `defaultWorkspace.failed` (see J-A) is this journey's failure mode when
  triggered automatically; manual selection is itself the recovery path.
- **Next decisions/affordances**: `J-B-basic-session`.
- **Known variants**: auto-created default workspace at boot vs. manual selection.
- **Evidence class**: declared.

## J-B-basic-session (`j_b_basic_session`)

- **Purpose**: run one complete request/response turn and see it durably represented in history.
- **Actor/role**: User.
- **Initiating condition**: workspace selected, model configured, composer available.
- **Preconditions**: ≥1 routable model.
- **Steps**: create session → send deterministic prompt → streamed assistant response → turn
  completes → session appears in sidebar (activity-ordered) → switch away → switch back.
- **Capabilities/actions (proposed)**: `session.create`, `session.send`, `session.stream`,
  `session.list`.
- **Policy/authority**: none beyond model/workspace preconditions.
- **Artifacts/resources**: `SessionEvent`; session title (generated `first-prompt`/`all-prompts`).
- **Outcome**: a session log with one completed turn.
- **Evidence**: `product-characterization.md` §5; spec Journey B (lines ~597-604).
- **Settlement criteria**: sidebar list shows the session after switch-away/switch-back with a
  generated title; `SessionController.list()` returns it ordered by activity.
- **Failure/recovery**: `api-session/error` event exists (inferred: distinct from success/idle);
  not fully characterized (see assumptions).
- **Next decisions/affordances**: `J-C-tool-execution`, `J-D-approval`, `J-E-plan`, `J-F-delegation`,
  `J-G-persistence`, `J-H-cancellation` (all compose on top of a basic session).
- **Known variants**: `first-prompt` vs. `all-prompts` title-generation cadence.
- **Evidence class**: declared.

## J-C-tool-execution (`j_c_tool_execution`)

- **Purpose**: let the agent read/execute/edit within the workspace with visible tool-call state.
- **Actor/role**: OperatorAgent (Component consuming tool capabilities on the user's behalf).
- **Initiating condition**: user sends a coding task inside an active session with a workspace.
- **Preconditions**: workspace selected; fs/bash tools not sandbox-denied for the requested scope.
- **Steps**: `read` → `bash`/shell → `edit` (gated: prior `read` of the *unchanged* file required,
  else `fs_not_observed`/`fs_stale_version`) → tool cards render pending/success/fail states →
  final answer → workspace file is actually mutated on disk.
- **Capabilities/actions (proposed)**: `tool.read`, `tool.bash`, `tool.edit`, `tool.fs_search`.
- **Policy/authority**: the "observation policy" (read-before-mutation) is a structured tool-level
  guard, not a user-approval prompt; `bash` runs under a file/network sandbox that can independently
  deny an operation (`[sandbox: file access denied under <mode> mode]`, do-not-retry).
- **Artifacts/resources**: `ToolCallEvidence`, `WorkspaceMutation` (the actual on-disk change).
- **Outcome**: mutated file(s) in the workspace.
- **Evidence**: `runtime-and-provider.md` §6 (tool inventory + observation policy); spec Journey C
  (lines ~606-614), which explicitly requires "verify actual workspace mutation" (not just a
  green tool-card).
- **Settlement criteria**: on-disk content matches the edit; observation policy was satisfied for
  every write/edit in the run.
- **Failure/recovery**: `fs_not_observed`/`fs_stale_version` structured errors (agent must `read`
  again, not a user-facing approval); sandbox denial is a distinct, separate failure mode that can
  escalate into `J-D-approval` (bash sandbox-escalation requires approval).
- **Next decisions/affordances**: continue the turn, or escalate into `J-D-approval`.
- **Known variants**: `write` to a new file (no read-gate) vs. `write`/`edit` to an existing file
  (read-gate applies).
- **Evidence class**: declared.

## J-D-approval (`j_d_approval`)

- **Purpose**: gate a privileged/escalated tool action behind an explicit human decision,
  fail-closed by default.
- **Actor/role**: ApprovalAuthority (the human approver / approval-answerer service); Operator
  role names the requester of the gated action (see `Relation "ApprovalAuthorization"`).
- **Initiating condition**: a tool call requests an operation outside its default
  sandbox/authority (bash sandbox escalation, `exit_plan_mode`, others behind the same waterfall).
- **Preconditions**: an approval answerer is attached to the session (else fail-closed
  `'unavailable'`).
- **Steps**: tool requests approval with a `justification` string → UI shows "Waiting for
  approval" banner + "Tool {toolName} requests privileged execution" escalation notice → execution
  remains pending → user decides **Reject** or **Allow once** (keyboard: Enter on the focused
  detail region approves, Escape rejects) → `approval/decided` logged (exactly one per
  `approval/asked`) → on `allowed-once` the tool call proceeds and the run resumes; on `Reject`
  the tool call fails, run continues without the privileged effect.
- **Capabilities/actions (proposed)**: `approval.request`, `approval.decide`, `tool.execute`.
- **Policy/authority**: per-session `ApprovalPolicy` (`ask`/`never`); "callers ... consume the
  closed outcome and fail closed unless it is `allowed-once`" — this is the canonical default-deny
  invariant for the whole system, not just this journey.
- **Artifacts/resources**: `ApprovalDecision`.
- **Outcome**: the gated action either executes (with recorded justification+decision) or does
  not.
- **Evidence**: `product-characterization.md` §8 (exact UI strings, keyboard behavior);
  `runtime-and-provider.md` §6 (`PreToolDecision` waterfall); spec Journey D (lines ~616-625,
  explicitly requiring both an approve branch and a deny branch).
- **Settlement criteria**: exactly one `approval/decided` per `approval/asked`; execution state
  (proceeded/failed) matches the decision; completion persisted.
- **Failure/recovery**: no answerer present at ask time → fail-closed `'unavailable'`, recorded;
  a withdrawn/replaced request cannot accept another answer, and an earlier failed answer cannot
  unlock its replacement.
- **Next decisions/affordances**: resume the parent turn (approve) or continue without the effect
  (reject).
- **Known variants**: Allow once vs. Reject vs. `'unavailable'` (no answerer); `source:
  'delegation'` policy override seeded into a child session at delegation time (see J-F).
- **Evidence class**: declared.

## J-E-plan (`j_e_plan`)

- **Purpose**: let the agent draft, revise, and get explicit sign-off on a multi-step plan before
  acting on it.
- **Actor/role**: OperatorAgent.
- **Initiating condition**: user requests a multi-step task, or invokes `/plan`.
- **Preconditions**: plan mode becomes the "effective target" for the session (may be queued if
  toggled mid-turn, applied at the next accepted pre-step).
- **Steps**: plan mode activates (blue "计划"/Plan badge with plan icon renders) → composer
  placeholder switches to "describe your task to generate plan" → agent calls `exit_plan_mode`
  with a markdown plan (must start with a `#` heading) → plan presented via the user-questions
  seam → user **approves** (carried out from next step) or **keeps planning** (feedback returned
  as a failed tool call; agent revises and re-presents) → plan mode exits on approval.
- **Capabilities/actions (proposed)**: `plan.set`, `plan.exit`, `plan.review`.
- **Policy/authority**: `exit_plan_mode` is only callable while in plan mode and requires explicit
  user approval to leave it — the same `PreToolDecision`/approval waterfall as J-D, applied to a
  different tool.
- **Artifacts/resources**: `PlanArtifact` (the markdown plan).
- **Outcome**: an approved plan the agent then executes against.
- **Evidence**: `product-characterization.md` §9; spec Journey E (lines ~627-633, "only assert the
  specific plan UI demonstrated by the reference" — deliberately narrow assertion scope, see
  assumptions).
- **Settlement criteria**: `plan/mode` reaches a terminal, explicitly-decided state (approved and
  exited, or still active after a revision cycle) with a legible plan-review record.
- **Failure/recovery**: "keep planning" is not a failure but an explicit revise-and-resubmit loop
  (feedback delivered as a failed tool call to the model, not a user-visible error).
- **Next decisions/affordances**: resumes the requested multi-step task (likely composing with
  `J-C-tool-execution`).
- **Known variants**: bare `/plan` (enable only) vs. `/plan <message>` (enable + steer next step
  via `agent.steer()`); mid-turn toggle queued vs. applied immediately at next accepted pre-step;
  `plan-narrow-viewport` snapshot implies an additional narrow-viewport behavior not otherwise
  documented (open question, see assumptions).
- **Evidence class**: declared.

## J-F-delegation (`j_f_delegation`)

- **Purpose**: delegate part of a task to a subagent and fold its terminal result back into the
  parent's work.
- **Actor/role**: OperatorAgent (parent); ChildAgent (subagent).
- **Initiating condition**: a task requires isolated/parallel or continuable execution the parent
  delegates rather than performs directly.
- **Preconditions**: a `SubagentProvider` is registered for the requested kind (one-shot or
  continuable).
- **Steps**: parent starts/delegates → child appears in the sidebar subagent activity view
  (live-pushed catalog, not polled) → child performs its work (interruptible even while the parent
  is offline) → child reaches a terminal `SubagentResult` → result consumed by the parent's run,
  rendered inline in the parent's tool-call/tool-result card (`parentCallId` PTC dispatch field) →
  parent's turn completes.
- **Capabilities/actions (proposed)**: `subagent.start`, `subagent.send_message`,
  `subagent.interrupt`, `subagent.result`.
- **Policy/authority**: model/route selection for the subagent is preflight-validated by the live
  LLM adapter; a per-session `ApprovalPolicy` can be overridden into a child session at delegation
  time (`source: 'delegation'`), linking this journey to J-D.
- **Artifacts/resources**: `SubagentResult`; the parent's durable `subagentCatalog` projection.
- **Outcome**: the parent's completed turn reflects the delegated outcome.
- **Evidence**: `product-characterization.md` §10; spec Journey F (lines ~635-642).
- **Settlement criteria**: `SubagentResult` recorded in `subagentCatalog` (survives
  reload/resume); catalog reads never require resuming the child Agent.
- **Failure/recovery**: `interruptByParent` accepts absent/idle/already-completed targets as
  no-ops (not an error path); no other subagent-specific failure mode directly documented (see
  assumptions — how a child's own failure surfaces to the parent is not confirmed).
- **Next decisions/affordances**: parent continues its turn using the child's result.
- **Known variants**: one-shot `SubagentRun`/`start()` vs. continuable (resident, addressable,
  interruptible) child; queue vs. steer delivery of a browser-authored message to a continuable
  child; image parts supported if the child's model accepts image input.
- **Evidence class**: declared.

## J-G-persistence (`j_g_persistence`)

- **Purpose**: prove session/workspace state survives a full process restart, not just an
  in-memory reload.
- **Actor/role**: User.
- **Initiating condition**: a multi-step session has produced durable events.
- **Preconditions**: state was written through the durable Host Session log, not held only in
  memory.
- **Steps**: perform a multi-step session → terminate the Web/runtime process → restart → reopen
  the workspace → reopen the session → observe the same durable visible state (`SessionInspection`
  can show status without resuming the Agent).
- **Capabilities/actions (proposed)**: `session.inspect`, `workspace.reopen`, `session.reopen`.
- **Policy/authority**: none beyond identity/ownership of the workspace/session.
- **Artifacts/resources**: `DurableSnapshot`.
- **Outcome**: reopened session state matches pre-termination state.
- **Evidence**: `product-characterization.md` §5 (`SessionInspection`, durable display path); spec
  Journey G (lines ~644-651).
- **Settlement criteria**: reopened session's history/title/status matches what was durably
  recorded before termination.
- **Failure/recovery**: not directly documented for a corrupted/unavailable persistence peer
  beyond "mandatory startup dependencies: an unavailable persistence peer leaves the plugin
  pending" (workspace subsystem note) — treated as a terminal blocked state, not a retryable one
  (see assumptions).
- **Next decisions/affordances**: resume the session normally (fully activate the Agent).
- **Known variants**: `SessionInspection` (non-activating) view vs. fully resumed Agent.
- **Evidence class**: declared.

## J-H-cancellation (`j_h_cancellation`)

- **Purpose**: let a user interrupt an in-flight turn/tool run, and separately verify
  deterministic provider-error handling.
- **Actor/role**: User.
- **Initiating condition**: a streaming turn or tool run is in progress, or a deterministic
  provider error is injected.
- **Preconditions**: a cancel/steer affordance is reachable during the running turn.
- **Steps**: begin a streaming/tool run → user cancels/interrupts (`steer`/`interruptByParent`) →
  UI reflects the interrupted state → user retries/resumes where the reference allows → separately:
  inject a deterministic provider error (mock server `connection_reset`/`stream_disconnect`/
  `server_error`/etc.) → compare failure/recovery behavior.
- **Capabilities/actions (proposed)**: `session.steer`, `session.interrupt`, `session.retry`.
- **Policy/authority**: none directly documented; interrupt works even for a currently-detached
  parent (subagent case).
- **Artifacts/resources**: `CancellationEvidence`.
- **Outcome**: an explicit interrupted/failed state, not a silent hang.
- **Evidence**: `product-characterization.md` §6 ("steer" fixture, `interruptByParent`);
  `runtime-and-provider.md` §4 (mock server scripted behaviors); spec Journey H (lines ~653-658).
- **Settlement criteria**: turn reaches an explicit interrupted or failed state; a
  retried/resumed turn completes normally where the reference allows it.
- **Failure/recovery**: this journey *is* the failure/recovery journey; the mock server's
  `script_exhausted` structured 500 is itself a distinct, deterministic failure mode worth
  reproducing.
- **Next decisions/affordances**: retry, resume, or abandon the turn.
- **Known variants**: user-initiated cancel vs. injected provider-side failure
  (`connection_reset`, `stream_disconnect`, `partial_disconnect`, `server_error`,
  `script_exhausted`).
- **Evidence class**: inferred (the turn-lifecycle state machine — idle/running/error/interrupted
  — is assembled from several separate observations, not one single declarative source quote; see
  `assumptions-and-unknowns.md`).

---

# Remote Workspaces (T1) — `J-RW-*`

These ten journeys model the execution-world abstraction (user-facing: **Remote Workspaces**).
They are framework-level journeys — they apply to any Cognate app whose workspaces have an
execution location — recorded here because this reconstruction is where the workspace journeys
live. Their evidence class is **proposed**: derived from Cognate's own architecture and the donor
mechanism study (`.agents/evidence/remote-workspaces-donor-provenance.md`), not from an
observation of the reference product. They do not alter `J-A`..`J-H`; those keep their meaning and
now settle against whichever world the selected workspace references.

Each entry mirrors its `Instance ... of "CanonicalJourney"` in `interaction-model.sea`.

## J-RW-select-world (`j_rw_select_world`)
- **Purpose**: make an execution location available as a first-class, selectable world.
- **Actor/role**: User. **Initiating condition**: the user wants a workspace that does not execute
  locally.
- **Steps**: declare a world (kind + provider configuration, secret *reference* not secret) →
  provider validates what it can without performing work → world registered and listed → selectable.
- **Capabilities (proposed)**: `world.register`, `world.list`, `world.select`.
- **Settlement**: the world is listed with a stable id and kind and is selectable.
- **Variants**: local (no configuration); ssh (host/user/auth reference/host-key policy/jump chain);
  a missing provider fails closed and lists as unavailable rather than falling back to local.

## J-RW-add-workspace (`j_rw_add_workspace`)
- **Purpose**: create a durable workspace owned by one execution world.
- **Steps**: pick a root in the selected world → provider canonicalizes and validates → workspace
  recorded with `executionWorldId` + opaque root → appears in the sidebar.
- **Capabilities (proposed)**: `workspace.select`, `workspace.path`.
- **Settlement**: a `WorkspaceRecord` with id, title, `executionWorldId`, provider-owned root.
- **Variants**: local root (OS path); remote root (POSIX path opaque above the provider); an
  unreachable root fails the add.

## J-RW-read-remote (`j_rw_read_remote`)
- **Purpose**: read a file from wherever the workspace executes, with no transport-specific tool.
- **Capabilities (proposed)**: `tool.read`, `filesystem.readText`, `filesystem.stat`.
- **Settlement**: contents returned through the ordinary `tool.read` result and recorded as
  `tool.call.completed`, identical in shape to a local read.
- **Variants**: readable; missing; path escape (denied by the provider boundary); world unreachable
  (fails closed — never reads a local file).

## J-RW-edit-remote (`j_rw_edit_remote`)
- **Purpose**: modify a file in place wherever the workspace executes.
- **Capabilities (proposed)**: `tool.edit`, `filesystem.readText`, `filesystem.writeText`.
- **Settlement**: replacement applied on the workspace's machine; ordinary `tool.edit` result
  (replacements + diff) recorded.
- **Variants**: unique; `replace_all`; not found; write fails after read (surface, never report
  success).

## J-RW-exec-remote (`j_rw_exec_remote`)
- **Purpose**: run a command or code snippet on the machine that owns the workspace.
- **Capabilities (proposed)**: `tool.bash`, `tool.run_code`, `process.exec`.
- **Settlement**: remote stdout/stderr/exit status returned through the ordinary `tool.bash` /
  `tool.run_code` result, `cwd` = the workspace's root.
- **Variants**: success; non-zero exit; timeout (`timedOut` true); world unreachable (fails closed).

## J-RW-cancel-timeout (`j_rw_cancel_timeout`)
- **Purpose**: make remote execution as cancellable and bounded as local execution.
- **Capabilities (proposed)**: `session.interrupt`, `process.exec`.
- **Settlement**: the remote execution is terminated (or reported timed out), the run settles as
  interrupted, and no orphan remote process keeps running for the aborted call.
- **Variants**: user cancellation; timeout expiry; cancellation while the connection degrades.

## J-RW-conn-failure (`j_rw_conn_failure`)
- **Purpose**: fail visibly and closed when a remote world is unavailable.
- **Capabilities (proposed)**: `filesystem.readText`, `process.exec`.
- **Settlement**: explicit attributable error through `tool.call.failed`; no local substitution;
  no partial success.
- **Variants**: connect-time; mid-operation; host-key verification failure (never auto-accepted).

## J-RW-reconnect (`j_rw_reconnect`)
- **Purpose**: let a later invocation succeed after a disconnect without changing tool/agent
  semantics.
- **Capabilities (proposed)**: `workspace.select`, `filesystem.readText`, `process.exec`.
- **Settlement**: the next operation succeeds through a re-established connection, unchanged code
  path.
- **Variants**: reuse a live connection; re-dial after a drop; persistent drop fails closed again.

## J-RW-coexist (`j_rw_coexist`)
- **Purpose**: prove execution location is a property of the workspace, not the app/process.
- **Capabilities (proposed)**: `workspace.select`, `workspace.path`, `tool.read`, `tool.bash`.
- **Settlement**: each operation reaches its own workspace's world in one process, no cross-talk.
- **Variants**: local→remote; remote→local; two remote workspaces on different hosts.

## J-RW-switch (`j_rw_switch`)
- **Purpose**: switch execution location with no change to the model-facing tool catalog or the
  agent loop.
- **Capabilities (proposed)**: `workspace.select`, `tool.read`, `tool.bash`, `tool.edit`.
- **Settlement**: after switching, the same tool definitions operate on the newly selected world;
  switching back restores the previous behaviour; no tool/agent implementation changed.
- **Variants**: switch to remote; back to local; to a third world.



---

# Workbench layer journeys (Unified Harness Experience Model v2)

Declared by `.agents/plans/unified_harness_experience_model_v2.md`; implemented per `WORKBENCH-PLAN.md`. Each is tested by `test/J-WB-*.test.ts` and, for the cockpit, `test/E2E-workbench.test.ts`. Evidence class: declared (the plan states them); implementation behaviour is recorded in `WORKBENCH-DEVIATIONS.md`.

## J-WB-task-contract (`j_wb_task_contract`)

- **Purpose**: Make the task contract visible and complete before execution begins.
- **Actor/role**: User.
- **Initiating condition**: A task is about to run and its contract (Context | Goal | Skills | Authority | Executors | Budget | Invariants | Acceptance) is not yet complete.
- **Preconditions**: The task is bound to an explicit workspace (workspace existence is not task scope).
- **Steps**: user creates a task -> the contract chips show set/missing per field -> user fills fields -> task.contract.update records the contract -> the task becomes READY only when no field is missing.
- **Capabilities/actions**: `task.create`, `task.contract.update`.
- **Settlement criteria**: The harness can name the workspace, goal, authority, capabilities, executors, budget, invariants and acceptance criteria of the task, and refuses to start a task whose contract has missing fields.
- **Failure/recovery and variants**: incomplete contract (start refused, missing fields named); workspace unbound; contract edited while RUNNING (rejected).
- **Evidence class**: declared.

## J-WB-protected-evidence (`j_wb_protected_evidence`)

- **Purpose**: Make protected evidence structurally immutable, not prompt prose.
- **Actor/role**: OperatorAgent.
- **Initiating condition**: The agent attempts to write or delete a path declared as protected evidence (source data, tests).
- **Preconditions**: The task contract's authority declares protected paths.
- **Steps**: agent calls edit/bash against a protected path -> the authority plane denies with rule protected-evidence -> the tool result tells the model why -> a human may elevate that one path.
- **Capabilities/actions**: `tool.edit`, `tool.bash`, `authority.elevate`.
- **Settlement criteria**: The write is blocked with an attributable reason unless the Reviewer explicitly elevated that exact path; the protected file is byte-identical afterwards.
- **Failure/recovery and variants**: edit denied; shell mutation of a protected path denied; elevated path proceeds to the ordinary write/approval rule; non-protected path unaffected.
- **Evidence class**: declared.

## J-WB-workflow (`j_wb_workflow`)

- **Purpose**: Give work a durable dependency and acceptance structure independent of the tools that execute it.
- **Actor/role**: User.
- **Initiating condition**: A purposeful body of work has more than one stage and the stages have dependencies.
- **Preconditions**: A workflow definition validates (acyclic, known nodes, evidence only on needs edges).
- **Steps**: user defines or picks a workflow -> instantiates it for a workspace -> nodes advance only when needs-edges are satisfied with closed evidence -> binding a different implementation changes only setup.
- **Capabilities/actions**: `workflow.define`, `workflow.instantiate`, `workflow.node.advance`, `skill.bind`.
- **Settlement criteria**: The workflow answers what stage is current, what became possible, what capability is next, which branches are parallel and what evidence closes a stage; swapping an implementation binding leaves the journey contract and acceptance criteria unchanged.
- **Failure/recovery and variants**: cycle or unknown node rejected; node done without its evidence does not unlock successors; failed node routes to its failure edge and is retryable without restarting upstream; compatible vs incompatible substitution.
- **Evidence class**: declared.

## J-WB-capability-lifecycle (`j_wb_capability_lifecycle`)

- **Purpose**: Keep build, install, grant, enable and verify as distinct states.
- **Actor/role**: User.
- **Initiating condition**: A capability implementation is generated, found or proposed.
- **Preconditions**: The capability contract exists in the catalog.
- **Steps**: user registers an implementation -> reviews provenance -> install -> grant authority -> enable -> exercise -> verify -> the capability becomes AVAILABLE.
- **Capabilities/actions**: `skill.register`, `skill.bind`, `skill.lifecycle.advance`.
- **Settlement criteria**: A capability cannot be invoked until ENABLED and is not trusted until VERIFIED; skipping a state is refused with the missing step named.
- **Failure/recovery and variants**: skip refused; overlapping primary decision surfaces reported as a conflict; verifier silently becoming an LLM refused on substitution.
- **Evidence class**: declared.

## J-WB-review-gate (`j_wb_review_gate`)

- **Purpose**: Separate produced, tested, ready for review and accepted, so a worker saying done is never acceptance.
- **Actor/role**: Reviewer.
- **Initiating condition**: A worker or task claims it is complete.
- **Preconditions**: The task contract lists acceptance criteria; evidence entries exist or are pending.
- **Steps**: worker returns changed/tested/evidence/remaining -> the ledger is evaluated -> review is requested -> the Reviewer sees intent, invariants, changes, evidence and remaining -> accept or request rework.
- **Capabilities/actions**: `evidence.record`, `worker.return`, `task.review.request`, `task.review.decide`.
- **Settlement criteria**: The task reaches READY_FOR_REVIEW only with changed files, tests, evidence and remaining work declared and every required non-human criterion closed (including independent checks); ACCEPTED only by a human Reviewer decision.
- **Failure/recovery and variants**: return contract incomplete (blockers listed); tests pass but an independent check is open (blocked); reviewer requests rework (REWORK, evidence reopened); an agent attempting to accept (refused: human only).
- **Evidence class**: declared.

## J-WB-automation (`j_wb_automation`)

- **Purpose**: Operationalize accepted work without confusing dispatch with completion.
- **Actor/role**: User.
- **Initiating condition**: An accepted manual workflow should recur.
- **Preconditions**: The workflow has been accepted at least once.
- **Steps**: user schedules the workflow with inputs and a substrate -> a run is dispatched -> running -> produced -> verified against acceptance -> complete.
- **Capabilities/actions**: `automation.create`, `automation.advance`.
- **Settlement criteria**: A delivery receipt means only DISPATCHED; the run is COMPLETE only after outputs exist and every acceptance item is closed; the execution substrate states whether quitting the app stops the run.
- **Failure/recovery and variants**: dispatched but never produced; produced but acceptance open (stays PRODUCED); failure at any edge is terminal and attributable.
- **Evidence class**: declared.

## J-WB-parallelism (`j_wb_parallelism`)

- **Purpose**: Recommend concurrency from the dependency graph rather than a worker count.
- **Actor/role**: OperatorAgent.
- **Initiating condition**: Work is decomposed into units that could run concurrently.
- **Preconditions**: Each unit declares owned files, reads, shared tokens, shared rules and dependencies.
- **Steps**: units are declared -> pair overlaps are assessed -> groups and architect-owned resources are returned.
- **Capabilities/actions**: `parallelism.plan`.
- **Settlement criteria**: Independent units get separate ownership and a Parallel-safe verdict; units sharing a stylesheet, tokens or rules are kept sequential or architect-owned with the shared resource named.
- **Failure/recovery and variants**: file overlap; shared design tokens; shared business rule; dependency order; concurrency limit splitting groups.
- **Evidence class**: declared.

## J-WB-economics (`j_wb_economics`)

- **Purpose**: Make cost and provenance visible per task trajectory, not per prompt.
- **Actor/role**: User.
- **Initiating condition**: A task is running or has finished.
- **Preconditions**: Model, tool and verification calls are recorded against the task.
- **Steps**: usage events are recorded per call -> rolled up per task -> compared with the budget -> shown in the runtime strip.
- **Capabilities/actions**: `usage.record`.
- **Settlement criteria**: The user can see executor, provider, billing route, usage, concurrency and budget state for the task; unknown cost is shown as unknown, never as zero.
- **Failure/recovery and variants**: budget warn at 80 percent; exceeded; cost unavailable from the provider; deterministic work never routed to an LLM.
- **Evidence class**: declared.

## J-WB-steering (`j_wb_steering`)

- **Purpose**: Make steering a permanent execution primitive: Queue next, Steer now, Stop.
- **Actor/role**: User.
- **Initiating condition**: A run is active and the user wants to redirect or add work.
- **Preconditions**: A run is in progress for the task.
- **Steps**: user sends steer-now -> the active run injects it at its next step boundary -> user sends queue-next -> it runs after the current turn.
- **Capabilities/actions**: `steer.enqueue`.
- **Settlement criteria**: Steer now changes the active trajectory at the next step boundary and is consumed exactly once; Queue next starts after the current run finishes.
- **Failure/recovery and variants**: steer consumed once; queue-next ordering is FIFO; stop cancels the run; steering with no active run becomes a normal message.
- **Evidence class**: declared.

## J-WB-grounded-feedback (`j_wb_grounded_feedback`)

- **Purpose**: Turn feedback into a native change contract, not prompt prose, and keep focus from silently changing scope.
- **Actor/role**: User.
- **Initiating condition**: A running or completed UI needs a bounded correction.
- **Preconditions**: A target element or component is identified.
- **Steps**: user selects an element -> attaches screenshot reference, viewport, preserve and change -> the contract is recorded -> repair is checked against the scope -> verification reruns at the viewport.
- **Capabilities/actions**: `feedback.record`.
- **Settlement criteria**: The correction names target, preserve constraints, requested change and verification viewport; a repair touching files outside the target is flagged; a focused metric always shows its reference scope.
- **Failure/recovery and variants**: missing preserve constraints refused; out-of-scope file touched; focus equal to reference scope refused.
- **Evidence class**: declared.

## J-WB-focus (`j_wb_focus`)

- **Purpose**: Give "this" one deterministic, visible and resettable meaning so changing focus never silently changes semantic scope.
- **Actor/role**: User.
- **Initiating condition**: The person refers to something with a word like this or it while a task is in view or bound to the conversation.
- **Preconditions**: A task or workflow stage is selected, or the conversation is bound to a task.
- **Steps**: person selects a task or stage -> the composer bar states what this means and why -> the person sends a message that says this -> the referent is frozen into the run input -> clearing the selection falls back to the bound task.
- **Capabilities/actions**: none. Attention is client state resolved by `src/workbench/focus.ts` (adapted from the operator's gs-term) and frozen into the run input.
- **Settlement criteria**: The agent receives the referent chosen by fixed precedence (explicit selection, keyboard focus, active run, pinned focus, workspace) as a frozen focus line, only when the message refers to something; the person can see what this means and clear an explicit selection.
- **Failure/recovery and variants**: explicit selection; fallback to the bound task; nothing in focus; a message that refers to nothing carries no focus line; a selection in another workspace is ignored.
- **Evidence class**: proposed. Tested by `test/E2E-workbench.test.ts` and `test/workbench-focus.test.ts`.

## Experts and Teams journeys (proposed)

These journeys extend the Workbench IDM and remain proposed until capabilities and journey tests
exist. State is expected to use Cognate shared thread state with compare-and-swap mutation; durable
run-completion continuations resolve specialist returns. Execution starts serialized. This section
is a semantic contract, not an implementation claim.

### J-EXPERT-CREATE (`j_expert_create`)
- **Actor/intention**: User creates or copies a reusable Expert identity.
- **Current → desired**: missing specialization → durable editable definition and persistent Expert identity.
- **Preconditions/affordance**: catalog available; `expert.save`, `expert.copy`, `expert.archive`.
- **Payment/authority**: operator configures tools/model/context; copied Expert receives no inherited private memory or elevated authority.
- **Transition/output**: save/copy persists definition and identity; archive preserves history and blocks new runs.
- **Evidence/settlement**: projection shows configuration and lifecycle; IDs and scope survive restart.
- **Failure/recovery/next**: invalid config explains field; then J-EXPERT-SOLO or J-TEAM-CREATE. Proposed.

### J-EXPERT-SOLO (`j_expert_solo`)
- **Actor/intention**: User converses with one Expert outside any Team.
- **Current → desired**: no solo context → durable scoped Conversation and attributable Cognate run.
- **Preconditions/affordance**: active Expert and configured route; `expert.converse`, `expert.context`, `expert.model.generate`.
- **Payment/authority**: user context and run budget; Expert uses only its allowlist and operator grant.
- **Transition/output**: persist message, run with captured route, store result and run receipt.
- **Evidence/settlement**: solo history survives restart and cannot read Team/other Expert private context.
- **Failure/recovery/next**: provider failure is visible/retryable, cancellation preserves partial evidence; continue or create Team. Proposed.

### J-TEAM-CREATE (`j_team_create`)
- **Actor/intention**: User creates/copies a governed collaboration space.
- **Current → desired**: none → draft Team with explicit members, roles, permission/context scopes and policy.
- **Preconditions/affordance**: eligible Experts; `team.save`, `team.copy`, `team.member`.
- **Payment/authority**: operator selects membership; joining defaults to Specialist; copy has fresh identity and isolated context.
- **Transition/output**: persist Team and membership records; draft may have zero Orchestrators.
- **Evidence/settlement**: projection shows membership and draft; it cannot execute until exactly one Orchestrator is active.
- **Failure/recovery/next**: stale/inactive member refused with reason; designate Orchestrator in J-TEAM-ACTIVATE. Proposed.

### J-TEAM-ACTIVATE (`j_team_activate`)
- **Actor/intention**: User makes a draft Team runnable.
- **Current → desired**: draft → active with exactly one Orchestrator.
- **Preconditions/affordance**: all memberships resolve to active Experts and one Orchestrator; `team.activate`.
- **Payment/authority**: operator confirms governance; activation cannot expand permissions.
- **Transition/output**: mutation boundary validates and CAS-commits Team state.
- **Evidence/settlement**: projected active state identifies its sole Orchestrator, including after concurrent writes.
- **Failure/recovery/next**: invalid cardinality refuses; CAS conflict reloads state; then J-TEAM-CONVERSE. Proposed.

### J-TEAM-REPLACE-ORCHESTRATOR (`j_team_replace_orchestrator`)
- **Actor/intention**: User transfers coordination or removes the current Orchestrator.
- **Current → desired**: one lead → different sole lead, or inactive Team.
- **Preconditions/affordance**: eligible replacement; `team.replaceOrchestrator`.
- **Payment/authority**: operator decision; invariant enforced atomically at mutation boundary.
- **Transition/output**: one CAS update demotes/promotes, or demotes and deactivates atomically.
- **Evidence/settlement**: durable old/new roles and exactly one lead if still active.
- **Failure/recovery/next**: stale update fails without partial state; reload and retry. Proposed.

### J-TEAM-DELEGATE (`j_team_delegate`)
- **Actor/intention**: Orchestrator delegates a bounded unit to a Specialist.
- **Current → desired**: team request → durable authorized Assignment and real Cognate run.
- **Preconditions/affordance**: active Team, sole Orchestrator, active Specialist, human-authorized scope; `team.delegate`, `expert.context`, `expert.model.generate`.
- **Payment/authority**: run cost; authority is intersection of human grant, Team policy, Expert allowlist and Assignment limits.
- **Transition/output**: persist assignment before serialized dispatch; freeze route/config and correlate run.
- **Evidence/settlement**: queued/running is not complete; run ID and acceptance/return contract are visible.
- **Failure/recovery/next**: deduplicate retry, typed abstention, provider failure and recursion limits are explicit; await J-TEAM-HANDOFF. Proposed.

### J-TEAM-HANDOFF (`j_team_handoff`)
- **Actor/intention**: Specialist returns output and evidence to its Orchestrator.
- **Current → desired**: terminal run → durable attributable return.
- **Preconditions/affordance**: Assignment, terminal run event and return contract; `team.handoff`.
- **Payment/authority**: delivery/reconciliation; return cannot expand authority or approve effects.
- **Transition/output**: completion continuation resolves Handoff with output, artifacts, evidence, uncertainty, failures and follow-up.
- **Evidence/settlement**: correlated return available to parent once logically, including after restart/redelivery without a browser.
- **Failure/recovery/next**: missing result becomes reconciliation-required; late cancelled result is evidence only; reconcile/retry. Proposed.

### J-TEAM-CONVERSE (`j_team_converse`)
- **Actor/intention**: User asks an active Team to coordinate work.
- **Current → desired**: addressed task → bounded conversation with reconciled contributions.
- **Preconditions/affordance**: active Team and durable Team Conversation; `team.converse`, `team.message`, `team.delegate`, `team.handoff`, `team.review`.
- **Payment/authority**: coordination and run budget; mentions route but do not authorize; Orchestrator cannot elevate or self-accept.
- **Transition/output**: request routes to sole Orchestrator, who selects necessary Specialists and records addressed assignments/messages.
- **Evidence/settlement**: sender, recipient, scope, assignment, run and handoff are attributable; limits/duplicates visible.
- **Failure/recovery/next**: cycles refused, limits queue/escalate, abstention and contradictions remain visible; review or settle. Proposed.

### J-EXPERT-STEER (`j_expert_steer`)
- **Actor/intention**: Human or authorized same-Team Expert sends an update to a running recipient.
- **Current → desired**: addressed update → ordered message incorporated at the next model decision.
- **Preconditions/affordance**: shared Team Conversation, active same-Team recipient Assignment/run; `team.inbox.send`, `team.message`, `team.inbox.consume`.
- **Payment/authority**: message affects context only; captured Assignment tools, execution mode and settlement authority remain unchanged.
- **Transition/output**: bounded message is CAS-appended with sequence, sender, recipient, correlation and target; the agent consumes only at a deterministic safe boundary.
- **Evidence/settlement**: one run-and-boundary receipt records the ordered batch and incorporation acknowledgement; a crash retry returns that same batch.
- **Failure/recovery/next**: active model calls are not interrupted; stale recipient or Team membership denies delivery; human can cancel or supersede an unincorporated message. Proposed.

### J-EXPERT-INBOX-RECOVER (`j_expert_inbox_recover`)
- **Actor/intention**: Operator resumes a live Team conversation after process restart.
- **Current → desired**: pending or acknowledged inbox → same logical delivery state after restart.
- **Preconditions/affordance**: native Experts thread state and Cognate run history are available; `team.inbox.consume`, `expert.context`.
- **Payment/authority**: replay reuses the target Assignment and authority snapshot.
- **Transition/output**: stable recorded consume invocation and registry CAS receipt reconcile the run-boundary batch.
- **Evidence/settlement**: message sequence and `incorporatedAtBoundary` point to one durable receipt; later boundaries do not redeliver it.
- **Failure/recovery/next**: cancellation and private conversation scopes remain isolated; stale assignment or team membership blocks incorporation. Proposed.

### J-TEAM-RECOVER (`j_team_recover`)
- **Actor/intention**: User resumes unfinished collaboration after restart.
- **Current → desired**: uncertain work → reconciled durable state and safe continuation.
- **Preconditions/affordance**: shared state and run-event history; `team.handoff`, `team.retry`, `team.cancel`, `expert.context`.
- **Payment/authority**: reconciliation cost; retries retain original authority and cancellation checks.
- **Transition/output**: reconcile queued messages, assignments, terminal runs and receipts before resuming.
- **Evidence/settlement**: all work has queued/running/waiting/completed/failed/cancelled/reconciliation-required status; no duplicate logical handoff.
- **Failure/recovery/next**: missing run becomes failed/reconciliation-required; late cancelled return is non-authorizing evidence. Proposed.

### J-TEAM-REVIEW (`j_team_review`)
- **Actor/intention**: Reviewer compares implementation, critique and independent verification.
- **Current → desired**: contributions → accept/revise/escalate recommendation with gaps and contradictions.
- **Preconditions/affordance**: Builder artifact, Critic result and Verifier receipts present or explicitly missing; `team.review`.
- **Payment/authority**: independent review effort; only human can settle protected acceptance.
- **Transition/output**: correlate claims to evidence and record rationale, gaps, and unresolved disagreement.
- **Evidence/settlement**: failed/missing check or contradiction prevents supported acceptance; recommendation cites receipts.
- **Failure/recovery/next**: failed verifier prompts repair/retest; request revision or present J-TEAM-SETTLEMENT. Proposed.

### J-EXPERT-MEMORY (`j_expert_memory`)
- **Actor/intention**: Expert retains or retrieves useful scoped continuity.
- **Current → desired**: transient context → attributable, scoped, searchable memory.
- **Preconditions/affordance**: explicit access to personal or Team scope; `expert.memory.write`, `expert.memory.read`, `expert.context`.
- **Payment/authority**: context budget; promotion follows provenance and trust rules.
- **Transition/output**: record provenance, scope and observation/assertion/inference/accepted-knowledge class; retrieve bounded relevant entries.
- **Evidence/settlement**: source and scope accompany retrieval; event log is truth, summaries/indexes rebuildable.
- **Failure/recovery/next**: private cross-scope read denied; assertions stay unverified; retrieved instructions are untrusted; restore commitments. Proposed.

### J-TEAM-SETTLEMENT (`j_team_settlement`)
- **Actor/intention**: Human decides whether Team evidence warrants acceptance.
- **Current → desired**: completion proposal → separately attributed human accept/revise/escalate decision.
- **Preconditions/affordance**: criteria, handoffs and independent evidence inspectable; `team.settle` presents decision.
- **Payment/authority**: human accountability; only human accepts protected work or approves gated effects.
- **Transition/output**: Orchestrator assembles artifacts, critique, verification, uncertainty and blockers; human decision is persisted.
- **Evidence/settlement**: acceptance requires human identity and supported criteria; contradiction/missing evidence keeps it open.
- **Failure/recovery/next**: unsupported proposal refused; revision creates follow-up assignment; then operationalize or continue. Proposed.

## Observed debt-closure journeys (2026-10-14)

These journeys extend the existing source and use published Cognate 0.2.0. They do not establish parallel or distributed Workbench execution.

| Journey / actor and intention | Preconditions, reachable capability, burden and authority | Transition, artifacts and observable settlement | Failure, recovery and next affordance |
| --- | --- | --- | --- |
| J-SCHEDULE-CREATE — human authorizes a bounded future objective | Active Expert or sole-Orchestrator Team and existing workspace; `schedule.save/manage/list`; creator owns intent, read-only effects require human approval | Versioned intent and next-due instant persist; create/edit/pause/resume/cancel/delete controls invoke native capabilities | Invalid rule/target refused; tombstone retains receipts; inspect next due or J-SCHEDULE-FIRE |
| J-SCHEDULE-FIRE — internal evaluator delivers due intent | Current creator, target, revision and workspace validated; `schedule.dispatch` is internal-only; one unresolved global slot by default | Stable occurrence reserves a deterministic Assignment and native run; receipts expose queued/running/waiting/result/failure; dispatch is not settlement | Misfires skip or coalesce without bursts; provider failure stays visible; inspect occurrence and human review |
| J-SCHEDULE-RECOVER — evaluator recovers interrupted delivery | PostgreSQL events and command identities intact; same native capabilities and authority revalidated | SIGKILL before due then fresh process after due produces one logical occurrence/Assignment/run; repeated delivery reuses identity | Cancelled intent stays inert; ambiguous effects keep reconciliation gate; retry eligible dispatch or review failure |
| J-MEMORY-MIGRATE — operator removes the single-event storage limit | Intact schema-1 event history; internal state writes preserve identity, scope and Team invariant | Immutable bounded partitions prepare before root CAS; >5 MiB fixture survives restart and rebuild; native erasure invalidates public current/cache rows | Pre-publication failure leaves old root authoritative; missing/hash-invalid references fail closed; restore source or explicitly recover; no automatic event rewrite |
| J-MEMORY-PAGINATE — human retrieves older scoped history | `expert.context` / `expert.memory.read`; scope/query/version-bound cursor; at most 100 items | 205-message and 205-memory fixtures page in order without duplicate IDs; private and other-Team material excluded | Changed state/query/scope and malformed cursor explicitly reject; restart from a fresh first page; materialized retrieval remains a limitation |
| J-CONTEXT-BUDGET — human constrains per-attempt inference | `expert.save` freezes limits; `expert.model.generate` includes visible messages/instructions/tool schemas and output reserve; explicit prices needed for cost cap | Over-budget native invocation never dispatches provider; active limits survive edits/restart; provider usage is observed, byte estimate labeled, unknown price stays unknown | Failed/unreported calls retain conservative reservations; required context is not silently discarded; inspect receipt and revise task/budget |

Executable evidence: `test/J-SCHEDULE-execution.test.ts`, `test/J-MEMORY-migration.test.ts`, `test/J-MEMORY-pagination.test.ts`, `test/expert-economics.test.ts`, and `test/E2E-experts-debt.test.ts`. Live inbox evidence and cognitive bindings are documented in the handoff. These tests use actual PostgreSQL/native execution with deterministic providers; they do not establish general Expert competence.

## Declared native run admission (implementation and proof pending)

### J-EXPERT-PARALLEL (`j_expert_parallel`)

- **Actor/intention**: User or OperatorAgent wants independent coding and Expert work to overlap without concurrent mutation of a shared workspace.
- **Preconditions/affordance**: Planned native Cognate 0.4 runtime exposes process-level `maxConcurrentRuns` (default 1; opt-in 2, 4, or 8); `execution.runtime.inspect` reports configured capacity and policy. Mutating run entries must resolve execution-world and canonical-root identity before admission.
- **Transition/output**: Every direct coding, Expert/Team, delegation, resume, and recovery entry uses `nativeExecutionSlots`. Distinct known roots may use separate native slots; equal, aliased, or nested roots serialize. Unknown root identity blocks admission without effects until safely resolved. The existing `ParallelPlan` remains an advisory plan, not admission authority.
- **Policy/authority**: Slot admission does not change captured model routing, mutation ownership, Team invariants, authorization, or human approval for protected effects. Inspection reports no active-worker count unless native telemetry later supplies one. Team-level maximum concurrency and batch delegation policy remain unsettled.
- **Evidence/settlement**: Pending native binding and journey tests must show two Experts actually overlap on distinct workspaces at capacity 2, while same/alias/nested roots serialize; restart preserves ownership, routing, and Team invariants. This is declared semantics, not observed implementation.
- **Failure/recovery/next**: Unresolvable roots block admission without effects; after resolving identity, the operator may retry. Operator inspects effective configured capacity/policy and may wait or retry after a run settles; no active-count or queue-position claim is implied. Read-only work does not bypass protected-effect approval.
