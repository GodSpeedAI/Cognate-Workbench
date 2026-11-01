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
- **Preconditions/affordance**: configured runtime outbox; `world.freeze`, `verification.run`; read side `observation.status` (delivery state per event) and `observation.record` (the correlated record), both bound to the `VerificationObservation` resource.
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
- **Steps (revised 2026-10-31)**: launch → first-run flow opens on Welcome → Connect a model
  provider with the full provider form (delegates to `J-CFG-model-provider`: `model.configure`,
  key through `secret.put`, `model.catalog`) → Choose a folder (delegates to `J-WS-select`:
  `workspace.select`) → the flow ends and the composer is available.
- **Capabilities/actions**: `model.configure`, `workspace.select`, `composer.enable`,
  `onboarding.dismiss` (durable steps `notice` and `apikey`), `secret.put`, `model.catalog`.
- **Policy/authority**: none beyond the workspace/model preconditions gating the composer. The
  flow's current step is derived from durable state (dismissals plus the model-config and
  workspace projections), not stored as its own state.
- **Artifacts/resources**: `ModelConfig`, `WorkspaceSelection`, `ComposerAvailability`.
- **Outcome**: composer accepts input.
- **Evidence**: `product-characterization.md` §2/§4; spec Journey A (Phase 6, lines ~588-595);
  `test/E2E-onboarding.test.ts` (Welcome → provider form → folder → working conversation; reload
  shows no onboarding; Configure later → friendly empty state).
- **Settlement criteria**: composer's disabled state clears; `modelCatalog()` lists ≥1 usable
  route.
- **Failure/recovery**: default-workspace auto-init failure shows `defaultWorkspace.failed` copy
  and the Folder step is the manual `J-WS-select`; a rejected provider form keeps the operator on
  the Model step with the reason.
- **Next decisions/affordances**: `J-B-basic-session` (create first session).
- **Known variants**: auto-init succeeds (skips explicit workspace step) vs. auto-init fails;
  **Configure later** (or X / Esc) dismisses the remaining steps and lands on a friendly empty
  state from which Settings → Models and Add workspace still reach the same journeys; Back keeps
  entered values; the earlier DeepSeek credential-only mode is superseded by the full provider
  form.
- **Evidence class**: declared (flow observed by `test/E2E-onboarding.test.ts`; that test is not
  yet named after the journey id, see `validation/conformance-2026-10-31.md`).

## J-CFG-model-provider (`j_cfg_model_provider`)

- **Purpose**: configure a usable model route so sessions can generate.
- **Actor/role**: User.
- **Initiating condition**: open Settings → Models with no usable provider, or add/change one.
- **Preconditions**: Settings surface reachable independent of workspace/session state.
- **Steps**: open Settings → Models → select provider (DeepSeek / third-party / Custom model API)
  → enter credentials/base URL/protocol/model list → save → route usable immediately.
- **Capabilities/actions (proposed)**: `model.configure`, `credentials.set`, `model.catalog`.
- **Provider parity (server side)**: saving with the key blank keeps the stored key for that provider id; local servers (127.0.0.1/localhost, or `auth: none`) run with no key on every protocol; Azure OpenAI uses `auth: api-key` + `apiVersion` on the chat protocol. See J-CFG-provider-switch / J-CFG-provider-test.
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

These journeys model the execution-world abstraction (user-facing: **Remote Workspaces** and explicit contained workspaces).

### J-RW-contained-workspace — explicitly add a Linux-contained workspace

- **Actor/intention/current state**: human operator adds a new workspace through contained filesystem/process ports; existing local and remote workspaces retain their identity.
- **Preconditions/visible affordance**: `execution.containment.inspect` reports host configuration and limits; `workspace.contained.select` requires host-owned patched-binary provenance, exact hash, approved runtime roots, supported Linux namespaces and real preflight. Browser and agent input cannot attest binary trust.
- **Payment/authority**: a human selects a dedicated canonical root and accepts the child-process-only boundary; agents cannot establish or change it. Wall time/output limits are enforced; aggregate CPU/memory/network-enabled execution and production authentication are not promised.
- **Transition/artifacts/evidence**: typed configuration events record a distinct world and workspace; native tool invocations retain world identity and ordinary results. Real tests inspect read/write/process success, host sibling/network denial, cancellation cleanup and restart.
- **Settlement/failure/recovery**: restart reconstructs the same provider from safe root identity and host configuration. Missing configuration, wrong hash or failed preflight refuses new placement; a recorded but unavailable world never falls back locally. An uncontained same-path workspace remains separate.
- **Next affordance/status**: open an ordinary coding or Expert conversation in the chosen workspace; inspect execution evidence. **Declared** until native integration, OS adversarial tests and browser journeys pass. No production trust claim.
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

The narrower J-EXPERT-MODEL-PARALLEL below establishes only intrinsic-return model work; this broader
workspace-isolation journey remains declared.

- **Actor/intention**: User or OperatorAgent wants independent coding and Expert work to overlap without concurrent mutation of a shared workspace.
- **Preconditions/affordance**: Planned native Cognate 0.4 runtime exposes process-level `maxConcurrentRuns` (default 1; opt-in 2, 4, or 8); `execution.runtime.inspect` reports configured capacity and policy. Mutating run entries must resolve execution-world and canonical-root identity before admission.
- **Transition/output**: Every direct coding, Expert/Team, delegation, resume, and recovery entry uses `nativeExecutionSlots`. Distinct known roots may use separate native slots; equal, aliased, or nested roots serialize. Unknown root identity blocks admission without effects until safely resolved. The existing `ParallelPlan` remains an advisory plan, not admission authority.
- **Policy/authority**: Slot admission does not change captured model routing, mutation ownership, Team invariants, authorization, or human approval for protected effects. Inspection reports no active-worker count unless native telemetry later supplies one. Team-level maximum concurrency and batch delegation policy remain unsettled.
- **Evidence/settlement**: Pending native binding and journey tests must show two Experts actually overlap on distinct workspaces at capacity 2, while same/alias/nested roots serialize; restart preserves ownership, routing, and Team invariants. This is declared semantics, not observed implementation.
- **Failure/recovery/next**: Unresolvable roots block admission without effects; after resolving identity, the operator may retry. Operator inspects effective configured capacity/policy and may wait or retry after a run settles; no active-count or queue-position claim is implied. Read-only work does not bypass protected-effect approval.

### J-EXPERT-MODEL-PARALLEL (`j_expert_model_parallel`)

- **Actor/intention**: The operator enables bounded overlap of independent model decisions, retaining conservative workspace-effect serialization.
- **Preconditions/affordance**: Supported asynchronous native admission; startup capacity one, two, four or eight. `execution.runtime.inspect` reports effective capacity and policy. Only a registered unfinished system-started Expert Assignment with the matching attempt and frozen intrinsic-return-only tool list is independently eligible.
- **Transition/output**: Native slots execute eligible models concurrently and persist attributable handoffs. Tool-bearing Experts, ordinary coding and unknown agents share one exclusion key. Event-only `agent.config` is admitted without waiting for application readiness, avoiding seed deadlock.
- **Payment/authority**: Provider token/cost and captured attempt budgets still apply. Slot eligibility grants no tools, approval or coordination authority. Forged tool calls are rejected by the frozen tool dispatcher and invocation gates.
- **Evidence/settlement**: Declared pending actual PostgreSQL overlap, distinct-route returns, forged-tool denial, configuration boot, serial tool-bearing work and recovery tests. Inspection exposes no invented active count.
- **Failure/recovery/next**: Missing/stale/impersonated Assignments fail closed before model effects; native durable dispatch supplies retry/cancellation/recovery. Frozen authority survives profile edits. The operator can inspect results or restart with a deliberate capacity change. Team-specific limits and concurrent workspace effects remain open in J-EXPERT-PARALLEL.

## Session / Workspace / Task / Run journeys (RED contract baseline)

These six journeys accompany `docs/specs/session-workspace-task-red-journeys.md` and the
`test/*red.test.ts` suites on `test/red-session-workspace-task-contracts-20261020`. They are
canonical in the model (`.sea/interaction/interaction-model.sea`, instances `j_session_draft`,
`j_ws_directory_discovery`, `j_task_scope`, `j_task_move`, `j_run_task_attribution`,
`j_task_expert_provenance`); their capabilities are bound explicitly in `domain/index.ts`
(`RED_BINDINGS`). Evidence class is **observed** once the formerly red suites pass; the journeys
were added to the model before any implementation existed (model-first rule).

### J-SESSION-draft (`j_session_draft`)

- **Actor/intention**: User presses + and immediately gets a fresh conversation ready to type.
- **Preconditions/affordance**: a workspace named by stable id; `session.create`, `session.history`.
  No inference or model credential is needed to create a draft.
- **Transition/output**: a deterministic recording run emits `session.created` correlated
  `session:<id>`; the `sessions` projection folds a draft row (title New Session, status draft);
  the first submitted turn reuses the same identity.
- **Policy/authority**: creation validates the named workspace; duplicate create requests with
  the same idempotency identity return the same Session and emit exactly one event; the creation
  binds to the explicitly named workspace even when another workspace is current.
- **Evidence/settlement**: durable before any prompt; survives reload and full restart; no stale
  Task, approval, focus or conversation leaks from a previous Session; legacy sessions without
  `session.created` remain readable.
- **Failure/recovery/next**: unknown workspace refused with no durable effect; failures are
  visible with retry; clicks disabled only while genuinely pending.
- **Executable evidence**: `test/J-SESSION-draft-contract.red.test.ts`,
  `test/E2E-workspace-session-ux.red.test.ts`.

### J-WS-delete (`j_ws_delete`)

- **Actor/intention**: User. The operator removes a project from the sidebar without touching its files.
- **Preconditions/affordance**: the workspace exists in the `workspaces` projection. Capability `workspace.delete` (bound to `WorkspaceRecord`); the sessions leave the list through `session.archived` events recorded by the same `agent.config` run.
- **Steps**: workspace actions -> Delete workspace -> confirmation names the workspace and says its files are not touched -> Cancel keeps everything / Delete workspace records the deletion -> the workspace and its sessions leave the list -> toast names the removed workspace.
- **Decision (model first)**: deleting a workspace archives its non-archived sessions. Archiving is reversible and deletes no turn, run or event, so history stays; without it the sessions would remain in the `sessions` projection pointing at a record that no longer exists.
- **Evidence/settlement**: record gone, current pointer cleared if it was current, folder and files untouched, the workspace's sessions archived, other workspaces' sessions unchanged, unknown workspace refused.
- **Known variants**: cancel keeps the workspace; deleting the current workspace; no sessions; mixed archived and active sessions; re-adding the same folder later creates a fresh record.
- **Evidence class**: observed.
- **Executable evidence**: `test/J-WS-delete.test.ts` (server), `test/E2E-ui-production.test.ts` ("J-WS-delete E2E ...", confirmation dialog).

### J-H-provider-error (`j_h_provider_error`)

- **Actor/intention**: User. A turn is sent while the model provider fails (HTTP error, refused connection, DNS failure, timeout).
- **Preconditions/affordance**: a configured provider and a session with a workspace. The native agent owns the retry loop (the provider adapters do not retry), 1 attempt plus 5 retries, delay `MODEL_RETRY_BACKOFF_MS` (default 300 ms).
- **Transition/output**: every failed attempt records `model.request.retried` at once with `{attempt, maxAttempts, maxRetries, delayMs, errorCode, message, baseURLHost, error:{code,message}}`. `errorCode` is one of `HTTP_<status>`, `TIMEOUT`, `CONNECTION_REFUSED`, `DNS_FAILED`, `NETWORK_ERROR`. `message` is fixed human text (no provider detail, no secret); `baseURLHost` is `host[:port]` of the provider base URL, empty when unknown. After the last attempt `turn.failed` carries `{code, message, baseURLHost?}` and the run ends `failed`.
- **Evidence/settlement**: the planned delay and the wait are recorded steps, so a restart resumes without repeating events. Budget refusals fail at once without retries.
- **Evidence class**: observed.
- **Executable evidence**: `test/J-H-provider-error.test.ts` (HTTP 500, retry-then-recover, replay across restart, connection refused on three protocols with the first retry event inside 2 s), `test/J-AIM-aimock.test.ts`.

### J-WS-directory-discovery (`j_ws_directory_discovery`)

- **Actor/intention**: User browses project directories without typing an entire absolute path.
- **Preconditions/affordance**: `workspace.directory.suggest` — an authorized, bounded, read-only
  query against the **selected execution world's** filesystem; `workspace.select` is the separate
  governed act of opening a chosen folder.
- **Transition/output**: matching directories only (never files), deterministic order, bounded
  results, exact chosen destination shown before confirmation; the Add-workspace dialog, first-run
  chooser and SSH/WSL folder step share one accessible picker (debounce, keyboard completion,
  pointer selection, loading/empty/error states, stale-response discard).
- **Policy/authority**: unknown or disconnected worlds fail closed — no local fallback; browsing
  never creates a workspace and never bypasses host filesystem authorization; the server enforces
  home expansion and path normalization, symlink-following (links to directories only) and protected application-home guards (empty result with a notice); responses carry no file
  contents, secrets or stack traces.
- **Evidence/settlement**: type a prefix, complete by keyboard, open the exact chosen workspace;
  repeat for a connected world and for denied/unknown locations; typing stays responsive on slow
  remote listings.
- **Executable evidence**: `test/J-WS-directory-discovery.red.test.ts`,
  `test/E2E-workspace-session-ux.red.test.ts`.

### J-TASK-scope (`j_task_scope`)

- **Actor/intention**: User knows which work a chat supports, and chooses a Task's visibility at
  creation (**This workspace / This session**) without internal Run ids.
- **Preconditions/affordance**: `task.create` (scope + optional owning session), `task.list`,
  `session.task.bind` (attach/detach); one Task entity — scopes are visibility, not two ledgers.
- **Transition/output**: session scope requires an existing Session of the same workspace and
  binds it; the composer shows the bound Task with an accessible change/detach control; **No
  task** is a valid, obvious state.
- **Policy/authority**: a workspace Task is available in every Session of its workspace but is
  never auto-selected; a session Task never appears as bindable in another Session unless
  promoted; cross-workspace or cross-scope bindings are refused with a readable reason.
- **Evidence/settlement**: bindings are durable rows in the public `session-task-bindings`
  projection (keyed by session, `{sessionId, workspaceId, taskId}`), retained on reload; a new
  Session starts unbound; a conversation with no Task remains valid.
- **Failure/recovery/next**: invalid scope/destination refused; detaching preserves the Task, its
  evidence and history.
- **Executable evidence**: `test/J-TASK-session-scope.red.test.ts`,
  `test/E2E-workspace-session-ux.red.test.ts`.

### J-TASK-move (`j_task_move`)

- **Actor/intention**: User promotes, moves or re-homes a Task without destroying its history.
- **Preconditions/affordance**: `task.move` — one governed explicit mutation to a destination
  workspace or session; destination must exist; in-flight work is not moved.
- **Transition/output**: Task id, evidence ledger rows and original source-workspace provenance
  are preserved; historical Runs are never reparented; contract context and scope are revalidated
  for the destination (a session Task moved across workspaces promotes to workspace scope).
- **Policy/authority**: cross-workspace moves recalculate resource and authority scope, not
  rename; stale Session bindings are invalidated; consequence preview shows changed tools, paths,
  executors, budget and acceptance applicability before confirmation.
- **Evidence/settlement**: the moved Task appears only in the destination inventory with its
  original evidence intact; nothing is silently accepted by moving.
- **Executable evidence**: `test/J-TASK-session-scope.red.test.ts`.

### J-RUN-task-attribution (`j_run_task_attribution`)

- **Actor/intention**: User understands what inference happened and which objective it served.
- **Preconditions/affordance**: every submitted turn invokes one Cognate Run (`agent.coding`),
  with or without tools; an optional `taskId` validated against the Session/Workspace context.
- **Transition/output**: the Run's initial task association is frozen into its
  `session.turn.started` evidence; later binding changes never rewrite a started Run's
  provenance; Runs, Tasks, plan steps and Expert Assignments stay distinct vocabularies.
- **Policy/authority**: an absent taskId is a valid unbound conversation execution; an invalid
  taskId is refused; conversation alone never creates a Task.
- **Evidence/settlement**: a plain question completes a Run with no Task and an empty Task
  ledger; a bound turn's frozen association is independently inspectable in event history.
- **Executable evidence**: `test/J-TASK-session-scope.red.test.ts` (J-RUN describe block).

### J-TASK-expert-provenance (`j_task_expert_provenance`)

- **Actor/intention**: Delegation serves an accountable Task; the user can trace which objective
  an Expert's work served.
- **Preconditions/affordance**: `team.converse` / `expert.converse` accept an explicit `taskId`
  validated against the Team's workspace; `team.delegate` inherits it on child Assignments.
- **Transition/output**: the Orchestrator's Assignment and its Specialist children retain the
  Task identity and their causal parent ids while keeping distinct Runs; attempts reuse the same
  Assignment lineage and never duplicate the Task.
- **Policy/authority**: unknown or cross-workspace Tasks are refused before any Assignment;
  assignments hold identity, not acceptance authority.
- **Evidence/settlement**: a successful Run, Expert handoff or Git commit never establishes
  human acceptance — acceptance remains a separate human and criterion gate.
- **Executable evidence**: `test/J-TASK-expert-provenance.red.test.ts`.

### J-CHECKOUT-BIND (`j_checkout_bind`)

- **Actor/intention**: the operator assigns a Task's work to an isolated Git checkout of its
  workspace's repository, so the Task's changes stay out of every other checkout.
- **Preconditions/affordance**: the Task exists, is not in flight, and its workspace root is a
  Git repository; `git.branch.list` offers current/default/local branches; `git.checkout.attach`
  creates the worktree and branch (or adopts an existing branch when explicitly requested).
- **Transition/output**: one durable `workbench.checkout.bound` event (checkout root + branch)
  recorded by a deterministic config run; the `task-checkout-bindings` projection carries the
  association across restarts.
- **Policy/authority**: operator-only capabilities; a Task in flight, a colliding branch without
  the existing flag, a missing base, a non-repository root, and a contained execution world
  that cannot reach a sibling checkout are each refused with the reason. The Task's workspace
  identity is unchanged; no second workspace or task ledger is created.
- **Evidence/settlement**: the binding is observable in the projection and the turn evidence of
  later runs freezes the checkout per turn.
- **Executable evidence**: `test/J-CHECKOUT-*.test.ts` (bind, refusal and restart suites).

### J-CHECKOUT-EXECUTION (`j_checkout_execution`)

- **Actor/intention**: a Task's conversational turn does its file, edit, shell and inspection
  work inside the Task's isolated checkout.
- **Preconditions/affordance**: the turn carries a Task in scope; `task.checkout.resolve`
  (a recorded step) returns the live binding before any tool executes.
- **Transition/output**: every tool root for the turn is the checkout root; `session.turn.started`
  gains the frozen `checkoutRoot`/`checkoutBranch` beside the frozen Task association.
- **Policy/authority**: the workspace's execution world and the Task's authority scopes govern
  exactly as before — the checkout changes *where* work happens, never *what is allowed*; a
  missing checkout is reported with a recovery pointer instead of falling back to the
  workspace root.
- **Evidence/settlement**: two Tasks in separate worktrees of one repository can edit the same
  relative path without collision and the main checkout stays unchanged; the checkout is never
  a second source of task, run or settlement truth.
- **Executable evidence**: `test/J-CHECKOUT-*.test.ts` (parallel isolation suite).

### J-CHECKOUT-LIFECYCLE (`j_checkout_lifecycle`)

- **Actor/intention**: the operator inspects, integrates or cleans up a Task's checkout.
- **Preconditions/affordance**: `git.checkout.status` (read-only), `git.checkout.merge`,
  `git.checkout.remove`, `git.checkout.recreate`; all operator-only.
- **Transition/output**: merge integrates into the named target branch locally and records the
  outcome; remove records `workbench.checkout.removed`; recreate is a pure recovery.
- **Policy/authority**: never force; a RUNNING Task refuses every mutation; a dirty checkout is
  never removed; an unmerged branch is kept; a conflicted merge aborts clean and names the
  conflicting paths; a merge never settles the Task.
- **Evidence/settlement**: each refusal states its reason; the durable binding disappears only
  on a recorded removal.
- **Executable evidence**: `test/J-CHECKOUT-*.test.ts` (lifecycle and conflict suites).

## Packaged installation (standalone native distribution)

These journeys are operator-facing. Each is an `Instance ... of "CanonicalJourney"` in
`interaction-model.sea` with the same `journey_id`. Their evidence is the qualification scripts
(`scripts/qualify-*.sh`, `scripts/qualify-browser.ts`) run against the installed archive, and the
recorded results in `validation/`. Their status changes only when that evidence is recorded.

| Journey ID | Settles when |
|---|---|
| `J-PKG-first-launch` | The bundled instance is recorded initialised and running, `/health` reports the semantic model, and the UI renders |
| `J-PKG-durable-restart` | A value written before a clean stop is read after relaunch; the old boot's token is refused |
| `J-PKG-interrupted-ownership` | After SIGKILL, relaunch reuses the same postmaster and keeps the value; a second owner of the same home is refused |
| `J-PKG-external-postgres` | With `COGNATE_POSTGRES_URL`, no bundled instance starts, and the external server is untouched by Workbench |
| `J-PKG-fail-closed` | Each of the failure cases in the mission's Test E exits non-zero with a named condition and creates no store |
| `J-PKG-upgrade-uninstall` | Earlier state reads back after a package replacement; uninstall leaves the data home and instance |
| `J-PKG-doctor` | `cognate-workbench doctor` reports every required field and exits non-zero on an unusable installation |

## Observed settings, workspace, host and identity journeys (conformance pass 2026-10-31)

Each entry mirrors the `Instance ... of "CanonicalJourney"` record of the same `journey_id` in
`interaction-model.sea` (fields: actor, initiating condition, purpose, precondition, steps,
settlement, variants). Capabilities are bound explicitly in `domain/index.ts` and recorded in
`handoff.md` ("Capability binding register").

### J-CFG-config-path (`j_cfg_config_path`)

- **Actor/intention**: User. The operator wants to read or edit the configuration outside the app. Purpose: Give the operator a working way to reach the configuration file, respecting the browser/server filesystem boundary and never exposing secret values.
- **Preconditions/affordance**: The app is running. Capabilities: `config.path`.
- **Steps**: user asks to open the configuration -> the file location is resolved -> the path and a non-secret view of the contents are offered -> a missing or unwritable file reports that state instead of failing silently.
- **Evidence/settlement**: The operator can obtain the configuration file's location and its non-secret contents, with a stated reason where the environment offers no safe path.
- **Known variants**: file exists; file absent, the default location is still reported; the host offers no filesystem handoff, so copy is the offered action; secret values are never returned.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-config-path.test.ts`.

### J-CFG-config-edit (`j_cfg_config_edit`)

- **Actor/intention**: User. The operator wants to view or change the configuration file from the Settings side panel. Purpose: Let the operator edit the non-secret configuration as text, with every change validated by the same rules as the individual settings controls and applied all-or-nothing.
- **Preconditions/affordance**: The app is running and the Settings panel is open. Capabilities: `config.file.read, config.file.apply`.
- **Steps**: user opens the configuration file -> the current durable settings are rendered with a version token -> user edits the text and applies it -> the text is parsed and every changed key is validated -> all changes are recorded together -> the file on disk is rewritten atomically and a new version is returned.
- **Evidence/settlement**: A valid edit is recorded as the same durable settings events the controls write, the settings projection reflects it, and cognate.config.json mirrors the new rendering at mode 0600; any refusal leaves settings and file untouched and says why.
- **Known variants**: invalid JSON is refused with line and column; an unknown settings key is refused by name; an invalid value refuses the whole edit, including valid sibling keys; a stale version is refused as a conflict; edits to the informational fields (schema, note, home, environment) are ignored and listed; an edit with no change succeeds and applies nothing; secret values are never in the text.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-config-edit.test.ts`.

### J-CFG-model-catalog (`j_cfg_model_catalog`)

- **Actor/intention**: User. A base URL is entered and the operator wants the provider's real model list instead of typing one. Purpose: Discover models from the provider where discovery is supported, and say so plainly where it is not.
- **Preconditions/affordance**: A protocol and base URL are present. Capabilities: `model.catalog`.
- **Steps**: user requests the catalog -> the provider's discovery endpoint is queried -> real ids populate the list -> a discovery failure or an unsupported protocol reports a specific reason.
- **Evidence/settlement**: Supported providers return their real model ids into the editor; unsupported providers report that discovery is unavailable and offer manual entry; no model list is ever invented.
- **Known variants**: openai-compatible list endpoint supported; provider returns an error; protocol has no discovery; base URL empty refuses before any request; a base URL with or without a trailing /v1 reaches the same /models endpoint on every protocol; a keyless local server sends no Authorization header.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-model-catalog.test.ts`.

### J-CFG-provider-switch (`j_cfg_provider_switch`)

- **Actor/intention**: User. The operator has more than one stored provider and wants a different one (or a different model of the same one) to answer next. Purpose: Switch the active route between stored providers and models without re-entering any API key.
- **Preconditions/affordance**: At least one provider is stored; for a switch, a second stored provider exists. Capabilities: `provider.list, provider.activate, model.configure`.
- **Steps**: user opens the stored providers list -> picks a provider (optionally with another model) -> the registry hot-swaps and the choice is recorded as the same `model.configured` fact -> the next run uses the new route.
- **Evidence/settlement**: The chosen provider is the active route, the next run goes to it with the key already stored for it, the choice survives a restart, and no secret reached the client or an event.
- **Known variants**: switch model of the active provider with the key left blank; activate another stored provider; activating a provider that is not stored refuses; omitted model keeps the stored one; a provider with no stored key reports hasKey false.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-provider-switch.test.ts`.

### J-CFG-provider-test (`j_cfg_provider_test`)

- **Actor/intention**: User. The operator wants to know whether a stored provider, or an unsaved draft, is reachable and accepts its key. Purpose: Check connectivity and credentials with the cheapest safe request, never a paid completion.
- **Preconditions/affordance**: A stored provider id, or a draft base URL and protocol, is present. Capabilities: `provider.test`.
- **Steps**: user asks to test -> the key is resolved server-side -> the model list is requested -> the outcome is reported with latency.
- **Evidence/settlement**: ok with latency and model count, or a specific reason; the key is never returned, logged or recorded.
- **Known variants**: stored provider; unsaved draft with a typed key; local keyless server; rejected key; unreachable host; the stored key is only sent to the stored base URL.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-provider-test.test.ts`.

### J-CFG-provider-delete (`j_cfg_provider_delete`)

- **Actor/intention**: User. The configured model provider is no longer wanted. Purpose: Remove a provider and everything that was stored for it, without leaving an orphaned secret or a dangling active route.
- **Preconditions/affordance**: A provider configuration exists. Capabilities: `provider.delete`.
- **Steps**: user confirms deletion -> the provider's secret is removed -> the configuration is removed -> the active route is cleared -> Settings shows no configured provider.
- **Evidence/settlement**: The provider configuration and its stored secret are gone, the active route is cleared so the UI returns to the unconfigured state, and nothing later resolves to the deleted provider.
- **Known variants**: deleting the active provider; deleting a stored provider that is not the active one removes only its secret and route and leaves the active route running; deleting an unknown provider refuses; a failure while removing the secret aborts before the configuration is removed.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-CFG-provider-delete.test.ts`.

### J-SECRETS-storage (`j_secrets_storage`)

- **Actor/intention**: User. The operator saves a provider API key, or opens Settings to see where keys are kept. Purpose: Keep API keys in the operating system's secret store (Windows Credential Manager, Linux Secret Service, macOS Keychain) instead of a file, and say plainly which store is in use and why.
- **Preconditions/affordance**: The app has started and chosen a secret storage backend. Capabilities: `secrets.backend.describe, secret.put`.
- **Steps**: app starts -> the native store is probed -> it is selected, or the owner-only file is selected with a reason -> keys left in secrets.json are copied to the native store, verified by read-back, then the file is overwritten and removed -> the operator saves a key -> Settings shows the backend label.
- **Evidence/settlement**: Keys written by secret.put live only in the selected backend, scoped per data home; Settings can state the backend and, for a fallback, the reason; no secret value is in any event, projection, configuration export or capability result.
- **Known variants**: native store selected; no Secret Service or a locked keychain so the owner-only file is used with a stated reason; COGNATE_SECRET_STORE forces file or native; migration from secrets.json succeeds and removes the file; migration read-back mismatch keeps the file; two data homes on one machine never share keys.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-SECRETS-storage.test.ts`.

### J-WS-files-browse (`j_ws_files_browse`)

- **Actor/intention**: User. The operator opens the Files tab of the inspector for the current workspace. Purpose: Let the operator browse the workspace file tree and read a file without leaving the app.
- **Preconditions/affordance**: A workspace is selected and its execution world is connected; browsing is read-only. Capabilities: `workspace.files.list, workspace.file.read`.
- **Steps**: operator opens the Files tab -> the root is listed directories first -> operator expands a folder -> the folder is listed -> operator selects a file -> the file is read and shown read-only with its language.
- **Evidence/settlement**: Listings and reads come from the workspace's own execution world, are relative to and contained in the workspace root, bounded (500 entries, 512 KiB of text), hide .git, flag binary and truncated content, and refuse parent traversal, absolute paths, symbolic links that leave the root, the protected application home and unknown workspaces with a readable reason; nothing is ever written and agent runs cannot use these capabilities.
- **Known variants**: binary file shows no text; large file shows the first 512 KiB flagged truncated; symlink entries are listed but not followed outside the root; an unreadable path explains itself.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-WS-files-browse.test.ts`.

### J-PLG-install (`j_plg_install`)

- **Actor/intention**: User. The operator wants a catalogued plugin active in this deployment. Purpose: Make installation a real lifecycle step: register, activate what the catalog declares, and be honest about what cannot run.
- **Preconditions/affordance**: The Plugins panel is open. Capabilities: `plugin.install, plugin.uninstall`.
- **Steps**: operator chooses a catalog entry -> installs -> the plugin is registered and its declared implementation activated -> its enable switch now drives real behavior -> uninstalling reverses registration.
- **Evidence/settlement**: An installed plugin is durable, its enable state is honoured by whatever it actually drives, and a catalog entry with no executable implementation installs as inert and says so.
- **Known variants**: entry with an executable implementation becomes toggleable; entry without one installs inert with a stated reason; installing an already-installed plugin is refused; arbitrary downloaded code is never executed.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-PLG-install.test.ts`.

### J-PREFS-shortcuts (`j_prefs_shortcuts`)

- **Actor/intention**: User. The operator wants a keyboard shortcut to mean something different, or to restore the defaults. Purpose: Make shortcut editing real, durable and conflict-aware without intercepting typing or overriding browser-reserved chords.
- **Preconditions/affordance**: The Keyboard shortcuts dialog is open. Capabilities: `settings.changeShortcuts`.
- **Steps**: user edits a shortcut -> the chord is captured -> conflicts and reserved chords are refused with a reason -> the binding is recorded -> the chord fires the action -> restore defaults rewrites them all.
- **Evidence/settlement**: The edited chord is durable across restart, fires its action, conflicts are reported before they are accepted, and Restore all defaults returns every editable action to its shipped chord.
- **Known variants**: global application shortcuts (command palette, keyboard shortcuts, new session, toggle sidebar, open settings, toggle inspector) fire from anywhere outside text entry and show their chord as a key hint wherever the action is offered; Apple platforms treat Cmd as Ctrl; New Session ships as Ctrl+Alt+N because Ctrl+N is browser-reserved; conflict with another action; browser-reserved chord refused; a chord that types into a text field must not fire; restore defaults with no overrides still succeeds.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-PREFS-shortcuts.test.ts`.

### J-SESSION-archive (`j_session_archive`)

- **Actor/intention**: User. A conversation is finished but the operator wants it out of the working list without losing it. Purpose: Let the operator set a session aside reversibly, and choose whether archived conversations are visible.
- **Preconditions/affordance**: The session exists in the sessions projection. Capabilities: `session.setArchived`.
- **Steps**: user archives a session -> the archived flag is recorded as an event -> the sessions projection folds it -> Hide archived removes it from the sidebar and All conversations restores it -> unarchive reverses it.
- **Evidence/settlement**: The session's archived flag is durable across restart, the filter immediately changes what the sidebar lists, and no history is deleted.
- **Known variants**: archive then restart, still archived; archive the currently open session; unarchive while hidden behind the filter; archiving never deletes turns or events.
- **Evidence class**: declared.
- **Executable evidence**: `test/J-SESSION-archive.test.ts`.

### J-TEAM-ADMISSION (`j_team_admission`)

- **Actor/intention**: User or OperatorAgent. An active Team admits new Expert work while other runs of the same Team are unfinished. Purpose: Bound how many of a Team's own runs may overlap from the Team's authoritative policy, independently of process capacity, and dispatch queued roots in the Team's configured batch.
- **Preconditions/affordance**: The Team is active with an authoritative limits policy (maximum concurrent runs and admission batch); each admitted root resolves to a canonical workspace identity. Capabilities: `team.converse, expert.converse, team.retry, team.handoff, execution.runtime.inspect`.
- **Steps**: operator saves authoritative Team limits -> a Team turn admits work through the native admission boundary -> per-Team lane keys serialize the Team's runs beyond its policy -> queued roots dispatch in the Team's batch -> operator inspects run and admission evidence.
- **Evidence/settlement**: Admission lane count derives only from authoritative Team metadata; a Team exceeding its maxConcurrentRuns waits even when process capacity is free; disjoint roots overlap only up to the policy; queued roots dispatch in the configured batch; client-supplied policy is refused before any effect; unknown or inactive Teams and invalid policy fail closed to full Team serialization; a recovered run may re-enter a different lane, which can only serialize more and never admits beyond the policy.
- **Known variants**: forged or stale client-supplied maxConcurrentRuns or admissionBatch is refused before any effect; raising the authoritative policy permits genuine overlap without changing process capacity; process restart preserves the policy and never widens it; solo model-only work keeps its overlap semantics.
- **Evidence class**: observed.
- **Executable evidence**: `test/J-TEAM-admission.test.ts`.

### J-AUTH-SESSION (`j_auth_session`)

- **Actor/intention**: Operator. The operator replaces client-claimed identities with server-issued durable sessions. Purpose: Make the effective caller a durable, revocable server-side fact instead of a client-supplied string.
- **Preconditions/affordance**: A durable identity ledger exists; the browser entry and every remote request must present a session the server itself issued. Capabilities: `identity.session.issue, identity.session.revoke, identity.inspect`.
- **Steps**: boot seeds the operator identity and issues one session for this browser entry -> every request authenticates against the durable session ledger -> operator may issue further sessions for provisioned identities -> operator revokes a session -> the revoked session's replayed request is refused before any capability or service mutation -> boot reconciles expired sessions.
- **Evidence/settlement**: Every admitted request resolves to a live unexpired unrevoked session bound to one identity; a revoked or expired session is refused with no durable effect; a captured token replayed after revocation produces no durable write anywhere in the store.
- **Known variants**: the raw development bearer format is refused in the production posture unless an explicit dev opt-in is armed; revocation takes effect without restart; session tokens exist in cleartext only in the issued entry and the holder's memory, the ledger stores verified hashes; an unknown token, an altered token or a session for a missing identity is refused.
- **Evidence class**: proposed.
- **Executable evidence**: `test/J-AUTH-SESSION.test.ts`.

### J-AUTH-TENANT-ISOLATION (`j_auth_tenant_isolation`)

- **Actor/intention**: Operator. The operator provisions an identity in a second tenant on one shared store. Purpose: Prove one tenant's session cannot observe or mutate another tenant's work on a shared store.
- **Preconditions/affordance**: Sessions bind each caller to the tenant of its durable identity; public projections and run, artifact and stream reads are tenant-partitioned by the framework. Capabilities: `identity.session.issue`.
- **Steps**: operator issues a session for a second-tenant identity -> both sessions drive the same shared store -> each caller's projection reads stay inside its tenant prefix -> cross-tenant run, artifact and event reads are refused as not found -> a client-claimed tenant string without a session is refused -> operator inspects both partitions.
- **Evidence/settlement**: Each authenticated caller sees only its own tenant's partition: its projections, runs, artifacts and streams; a cross-tenant replay or a forged tenant claim is refused with no durable effect; an empty foreign partition is indistinguishable from an absent one.
- **Known variants**: a session token from one tenant cannot be replayed into another tenant's context; the framework's tenant partitioning is observed end to end, not assumed; multi-tenant application seeding (per-tenant Experts and schedules) is out of scope and not claimed.
- **Evidence class**: proposed.
- **Executable evidence**: `test/J-AUTH-TENANT-ISOLATION.test.ts`.

### J-RW-AGGREGATE-CONTAINMENT (`j_rw_aggregate_containment`)

- **Actor/intention**: Operator. The operator configures aggregate resource ceilings for contained executions. Purpose: Bound aggregate contained resource consumption across processes so exhaustion of a configured quota refuses new work instead of silently widening it.
- **Preconditions/affordance**: A contained workspace is selected and its provider owns the OS boundary; the aggregate containment ledger is the durable admission truth across processes. Capabilities: `settings.changeContainment, workspace.contained.select, process.exec`.
- **Steps**: operator configures aggregate containment quotas -> every contained execution acquires a durable aggregate slot under the quota before launch -> admitted executions run under kernel per-execution CPU and address-space limits -> completion, cancellation and crash release or reap the slot durably -> exhausted quota fails closed for new work across processes -> operator inspects the aggregate ledger.
- **Evidence/settlement**: New contained work that would exceed the aggregate concurrent-execution ceiling or the aggregate CPU-second window budget is refused before any child process is launched, from any process sharing the store; each admitted execution runs under its kernel CPU and address-space caps; a cancelled or completed execution releases its aggregate slot; a crashed holder's stale slot is reaped after its lease and accounted conservatively.
- **Known variants**: an unconfigured quota keeps historical uncontained-aggregate behavior; a configured quota with kernel limit tooling unavailable inside the world refuses the execution rather than running uncapped; a CPU-capped execution is recorded as capped and booked conservatively; per-process memory accounting is bounded by the kernel address-space cap and the aggregate concurrency ceiling, not measured; local uncontained workspaces are not aggregate-contained and never were.
- **Evidence class**: proposed.
- **Executable evidence**: `test/J-RW-AGGREGATE-CONTAINMENT.test.ts`.

### J-DESKTOP-launch (`j_desktop_launch`)

- **Actor/intention**: User. The operator opens the installed Workbench from its shortcut, or runs cognate-workbench launch. Purpose: Open the Workbench like a desktop application, with one server per data home, one dedicated app window and a server whose lifetime is the window's lifetime.
- **Preconditions/affordance**: The Workbench is installed; at most one Workbench owns a data home at a time. Capabilities: none (host-surface journey: CLI commands launch and stop; no Cognate capability).
- **Steps**: operator launches -> the data home is checked for a running instance -> none: the server starts and the app window opens on its URL; running: the app window opens on the existing URL and the launcher exits -> the operator closes the launching window -> the launcher shuts the server down and removes the lock -> or the operator runs stop at any time.
- **Evidence/settlement**: A launch with no running instance starts the server and opens a Chromium-family browser in app mode with a dedicated profile under the data home; a second launch reuses the running instance and only opens another window; closing the launching window shuts the server down cleanly and releases the data-home lock; stop asks the running instance to stop; with no suitable browser the default browser is opened and the server keeps running until stop.
- **Known variants**: second launch while the first window is open reuses the instance; no Chromium-family browser found opens the default browser and the server stays up until stop; a window process that exits within seconds is treated as a hand-off to an already-running browser and the server stays up; COGNATE_NO_WINDOW starts the server without a window; COGNATE_APP_BROWSER overrides browser discovery; stop on a data home with no instance reports that; another instance holding the data home refuses a plain start by naming it.
- **Evidence class**: observed.
- **Executable evidence**: `test/J-DESKTOP-launch.test.ts` (fake-browser launch suite; host-surface journey).

### J-UI-command-palette (`j_ui_command_palette`)

- **Actor/intention**: User. The operator wants to reach an action, a Settings section, a workspace or a session without hunting through the interface. Purpose: Offer one fuzzy-searchable go-to-anything surface over the affordances that already exist, owning no mutation of its own.
- **Preconditions/affordance**: The application shell is rendered; no capability is needed to open the palette itself. Capabilities: `settings.changeShortcuts, session.create, workspace.select`.
- **Steps**: operator presses the palette chord or chooses it from the interface -> items are assembled from actions, Settings sections, workspaces and sessions -> operator types and the list is ranked fuzzily -> operator selects with the keyboard or pointer -> the underlying affordance runs.
- **Evidence/settlement**: Choosing an item runs exactly the handler the rest of the interface runs for that affordance, so every effect and refusal is the one the underlying journey defines; items unavailable in the current condition are not offered; the palette closes and returns focus.
- **Known variants**: empty query shows actions first and only the most recent sessions; no match says so; Escape or the close control dismisses without effect; the chord is the user-editable open-command-palette shortcut; Workbench appears only with a workspace selected.
- **Evidence class**: observed.
- **Executable evidence**: test/ui-shell.test.tsx (palette fuzzy search); `test/E2E-ui-shell.test.ts`.

### J-UI-inspector (`j_ui_inspector`)

- **Actor/intention**: User. The operator wants context, changes, details, files or configuration for the current work beside the conversation. Purpose: Give the current work a right-hand inspector whose tabs are projections of other journeys, so inspecting never becomes a second source of truth.
- **Preconditions/affordance**: The shell is rendered; each tab declares its own precondition (Files needs a connected workspace). Capabilities: `workspace.files.list, workspace.file.read, config.file.read, config.file.apply`.
- **Steps**: operator toggles the inspector or opens a named tab -> tabs register by identity and the selected tab renders -> the tab reads through its journey (Files through J-WS-files-browse, Config through J-CFG-config-edit) -> operator switches tabs or closes the inspector.
- **Evidence/settlement**: Tabs Context, Changes, Details, Files and Config each show only data their own journey authorizes; the open state, width and selected tab survive reload; a tab with nothing to show explains why; mobile presents the inspector as an overlay.
- **Known variants**: opening a tab before it has registered still selects it once it appears; Changes shows a count of reviewable items; Files and Config are read through read-only or all-or-nothing capabilities and do not widen authority; narrow screens use an overlay instead of a docked panel.
- **Evidence class**: observed.
- **Executable evidence**: test/ui-inspector-tabs.test.tsx (Files and Config tabs); `test/E2E-ui-shell.test.ts`.

## External agent-harness journeys (J-HARNESS-*)

New in this pass; `evidence_class: proposed` until the tests below are observed passing. Source: PandaCode's harness design (protocol families, argv, permission mapping), re-implemented; see `.agents/reports/ui-production-readiness/recon/R6-agent-harnesses.md` and `framework-gap-streaming-process.md`.

### J-HARNESS-detect (`j_harness_detect`)

- **Actor/intention**: User. The operator sees which external agent-harness CLIs are installed on the machine the server runs on.
- **Preconditions/affordance**: `agent.harness.list` (`{refresh?}`); detection is host-side (PATH + known install folders), `--version` probe with a 2 s timeout, 60 s cache.
- **Transition/output**: The list returns `{id,label,installed,path?,version?,protocol,supportsApprovals,permissionModes,installHint,signInHint,reasonUnavailable?}` plus the host platform; unverified catalog entries (Gemini, Qwen) stay hidden unless present and their `--help` prints the ACP flag.
- **Policy/authority**: No model call and no login; detection never reflects an SSH/WSL/contained workspace's machine.
- **Evidence/settlement**: The result is a read; nothing is recorded.
- **Failure/recovery/next**: Missing tools are listed as not installed with an install hint.
- **Executable evidence**: `test/J-HARNESS-detect.test.ts`.

### J-HARNESS-session (`j_harness_session`)

- **Actor/intention**: User. The operator runs a Session through an external harness CLI and sees its output in the normal transcript.
- **Preconditions/affordance**: `session.harness.bind` (`{sessionId, harnessId|null, permissionMode?, model?}`), `session.harness.resolve`, `harness.turn.advance` (internal, recorded), agent `agent.harness` (same input as `agent.coding`).
- **Transition/output**: Streamed text, tool calls (edits carry diffs when reported), usage and the final message are emitted as the same domain events as the native agent (`tool.call.*`, `message.completed`, `workbench.usage.recorded`); the CLI's session id is recorded (`harness.session.recorded`) and resumed next turn.
- **Policy/authority**: Posture labels: `harness-own-sandbox`, `harness-bridged-approvals`, `harness-uncontained` (full access). GUARANTEE GAPS: per-tool `authority.check`, containment of the CLI's tool effects, protected-evidence blocking and settlement as `agent.coding` do NOT apply; evidence is what the CLI self-reports. The CLI process is launched by an explicit host-process runner on the local world only (framework gap: the execution port has no streaming/stdin); remote, contained, SSH and WSL workspaces are refused; SEA-Forge governance on refuses binding. The child environment is an allowlist, never the Workbench's provider credentials.
- **Evidence/settlement**: Binding is a durable `session.harness.bound` event folded by the public `session-harness-bindings` projection; turns are ordinary runs correlated `session:<id>`.
- **Failure/recovery/next**: Binding while a run is active is refused; a restart mid-turn ends the turn as session-lost.
- **Remote variant**: a turn sent from the paired phone to a harness-bound Session starts `agent.harness` (never `agent.coding`); a turn already running is refused with `harness-busy` and a readable message instead of being steered; the phone may answer the CLI's `tool-approval`. Evidence `test/J-HARNESS-remote.test.ts`.
- **Executable evidence**: `test/J-HARNESS-session.test.ts`, `test/J-HARNESS-remote.test.ts`.

### J-HARNESS-approval (`j_harness_approval`)

- **Actor/intention**: User. The operator allows or denies a CLI's permission request and the CLI resumes accordingly.
- **Preconditions/affordance**: `session.harness.bind` (permission mode), the CLI protocol's permission request (Claude `can_use_tool`, Codex `*/requestApproval`, ACP `session/request_permission`).
- **Transition/output**: The request becomes `tool.approval.requested` plus a `tool-approval` human-approval continuation; the decision becomes `tool.approval.decided` and is sent to the CLI (allow or refusal); denied tools fail with the reason.
- **Policy/authority**: This is the CLI's own gate bridged to the operator, not the Workbench approval gate; plan mode declines state-changing requests; full access never asks.
- **Evidence/settlement**: Approval request and decision events on the run.
- **Failure/recovery/next**: A withdrawn request is dropped; structured questions are declined with a note.
- **Executable evidence**: `test/J-HARNESS-approval.test.ts`.

### J-HARNESS-cancel (`j_harness_cancel`)

- **Actor/intention**: User. The operator stops a running harness turn.
- **Preconditions/affordance**: `run.cancel` on the harness run.
- **Transition/output**: Protocol interrupt, stdin close, process-group SIGTERM then SIGKILL (`taskkill /T /F` on Windows); the run is cancelled and keeps its partial transcript; a process left waiting for approval of a cancelled run is reaped.
- **Policy/authority**: No process outlives the run.
- **Evidence/settlement**: Run status `cancelled`; process gone.
- **Failure/recovery/next**: An ignored interrupt escalates to a tree kill.
- **Executable evidence**: `test/J-HARNESS-cancel.test.ts`.

### J-HARNESS-unavailable (`j_harness_unavailable`)

- **Actor/intention**: User. A missing, signed-out, limited or crashing CLI fails closed with a readable reason.
- **Preconditions/affordance**: `session.harness.bind`, `harness.turn.advance`.
- **Transition/output**: Missing CLI refuses binding with the install hint; an authentication error ends the turn as `turn.failed` (`AUTH_REQUIRED`) naming the CLI and its sign-in command; limits, crashes and nonzero exits end the turn as `turn.failed` (`RATE_LIMITED`, `FAILED`).
- **Policy/authority**: No silent fallback to the native agent.
- **Evidence/settlement**: `turn.failed` event and a failed run.
- **Failure/recovery/next**: Remote/contained/SSH/WSL workspaces refused; SEA-Forge governance refuses binding.
- **Executable evidence**: `test/J-HARNESS-unavailable.test.ts`.

Notes: `J-DESKTOP-launch` is a host-surface journey: it governs the process around the server
(launcher, app window, lock, stop), has no Cognate capability and no event; `J-UI-command-palette`
and `J-UI-inspector` are UI-surface journeys that are pure projections of other journeys (no
capability of their own, no authority). They exist so a downstream agent can see which surfaces
are contractually thin.
