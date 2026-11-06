# Cognate Workbench Capability Components (`src/capabilities`)

## Overview

This directory holds the app's Cognate `Component` definitions: each file mounts one or more
capability contracts (`{ id, version, semanticRef }`) onto a fiber via `fiber.provide`, following
the semantic IDs of the authoritative interaction model at `.sea/interaction/interaction-model.sea`
(loaded in place by `../domain/index.ts`, not copied into code). The capabilities fall into three
shapes:

- **Client-invoked mutations** (`client.invoke`, never recorded as an invocation event): the handler
  validates against the live projection, then starts a deterministic `agent.config` run
  (`../agents/agentConfig.ts` `AGENT_CONFIG`) whose event the projection folds — the durable event
  log, never component memory, owns the state (workspaces, sessions, settings, plugins, checkouts,
  proof declarations).
- **Agent-invoked reads and tools** (`ctx.invoke`, recorded/replayable): projection reads
  (`workspace.path`, `plan.state`, `session.history`), the model-facing `tool.*` family, Expert
  model routing, and the cognitive-navigation set.
- **Operator-only surfaces**: identity administration, ambiguous-invocation reconciliation, SEA-Forge
  governance approvals, settlement proof declaration, contained-workspace selection, and task-checkout
  lifecycle — all refuse calls from inside a run.

## Interface

Each entry cites the file and the exact exported symbol. All files export a `*Component` factory
returning a Cognate `Component`; many also export their input/result types and constants.

### Component factories (capability mounts)

- [aggregateContainment.ts:aggregateContainedRegistry] — registry decorator that wraps every
  `linux-bubblewrap` provider's process port with aggregate admission (`acquireContainedSlot`) and
  accounting (`releaseContainedSlot`); non-contained worlds pass through unchanged.
- [ambiguousStep.ts:ambiguousStepComponent] — mounts `run.invocation.reconcile`
  (`AMBIGUOUS_INVOCATION_CAPABILITY`), the operator's resolution of an `ambiguous-invocation`
  continuation.
- [cognitive.ts:cognitiveComponent] — mounts 20 cognitive capabilities in one component
  (`case.open`, `criterion.freeze`, `world.freeze`, `world.fork`, `world.attach`, `world.discard`,
  `verification.run`, `case.derive`, `world.settle`, `risk.assess`, `case.observe`, `ui.focus.publish`,
  `ui.context`, `ui.request`, `ui.pending`, `experiment.round`, `experiment.status`, `method.review`,
  `method.accept`, `method.active`); requires `filesystem.resolve`/`filesystem.readText`/
  `filesystem.list`/`process.exec`.
- [configPath.ts:configPathComponent] — mounts `config.path`: resolves the configuration file
  location, current durable settings, redacted environment description, and a downloadable export.
- [containedWorkspace.ts:containedWorkspaceComponent] — mounts `execution.containment.inspect` and
  `workspace.contained.select` (bubblewrap namespace containment; Linux only).
- [executionWorlds.ts:executionWorldsManageComponent] — mounts `execution.world.probe`,
  `execution.wsl.list`, `execution.world.connect`, `execution.world.check`,
  `execution.world.disconnect`.
- [expertEffect.ts:expertEffectComponent] — mounts `expert.tool.invoke`
  (`EXPERT_EFFECT_CAPABILITY`) and `expert.effect.resolve`; durable side-effect boundary for the
  `edit`/`bash`/`run_code` Expert tools via `CommitmentService` (`TARGET_ID` =
  `workbench.expert-tool-effect`).
- [expertModel.ts:expertModelGenerateComponent] — mounts `expert.model.generate`: per-Expert routed
  model dispatch with token-budget enforcement and durable billing reservation/settlement.
- [governance.ts:governanceComponent] — mounts `governance.status` (`GOVERNANCE_STATUS`),
  `governance.approvals.list` (`GOVERNANCE_APPROVALS_LIST`), `governance.approval.resolve`
  (`GOVERNANCE_APPROVAL_RESOLVE`), backed by one NDJSON request/response over the SEA-Forge Unix
  socket ([governance.ts:seaForgeCall]).
- [identityAdmin.ts:identityAdminComponent] — mounts `identity.session.issue`,
  `identity.session.revoke`, `identity.inspect`.
- [modelConfigure.ts:modelConfigureComponent] — mounts `model.configure`: writes the API key secret,
  hot-swaps the mounted provider via `ProviderRegistry.swap`, then records `model.configured`.
- [onboardingDismiss.ts:onboardingDismissComponent] — mounts `onboarding.dismiss` for steps
  `notice` | `apikey` (`OnboardingStep`).
- [planState.ts:planStateComponent] — mounts `plan.state`: resolves a `sessionId` to its `PlanState`
  from the `plans` projection.
- [pluginInstall.ts:pluginInstallComponent] — mounts `plugin.install`, `plugin.uninstall`,
  `plugin.catalog`.
- [providerManage.ts:providerManageComponent] — mounts `provider.delete` and `model.catalog`.
- [runtimeExecution.ts:runtimeExecutionComponent] — mounts `execution.runtime.inspect`
  (`RUNTIME_EXECUTION_INSPECT`), a read-only host execution inspection.
- [secretPut.ts:secretPutComponent] — mounts `secret.put`, the only path that writes a credential
  to disk.
- [sessionArchive.ts:sessionArchiveComponent] — mounts `session.setArchived` (reversible archiving).
- [sessionCreate.ts:sessionCreateComponent] — mounts `session.create`: durable draft session,
  deterministic on `(workspaceId, requestId)`.
- [sessionHistory.ts:sessionHistoryComponent] — mounts `session.history`: folds completed
  `agent.coding` runs in correlation `session:<id>` into `ModelMessage[]`, including completed
  subagent results as synthetic user messages.
- [sessionTaskBind.ts:sessionTaskBindComponent] — mounts `session.task.bind`: governed Task-to-Session
  binding (attach validates workspace and scope availability; detach records an explicit `taskId: null`).
- [settingsChange.ts:settingsChangeComponent] — mounts the 12 `settings.change*` capabilities listed
  in the private `SETTING_FIELDS` table plus `settings.changeShortcuts`.
- [settlement.ts:settlementComponent] — mounts `workspace.proof.declare` (`PROOF_DECLARE`),
  `workspace.proof.declare_contract` (`PROOF_DECLARE_CONTRACT`), `workspace.proof.current`
  (`PROOF_CURRENT`), `settlement.status` (`SETTLEMENT_STATUS`).
- [subagentStart.ts:subagentStartComponent] — mounts `subagent.start`: fire-and-forget child run
  correlated `subagent:<parentRunId>:<id>`.
- [taskCheckout.ts:taskCheckoutComponent] — mounts `git.branch.list`, `git.checkout.attach`,
  `git.checkout.status`, `git.checkout.merge`, `git.checkout.remove`, `git.checkout.recreate`,
  `task.checkout.resolve`.
- [tools.ts:toolCapabilitiesComponent] — mounts `tool.read`, `tool.edit`, `tool.bash`,
  `tool.run_code`; requires `filesystem.resolve`/`filesystem.readText`/`filesystem.writeText`/
  `process.exec` and delegates every operation to the workspace's execution-world provider.
- [workbench.ts:workbenchComponent] — mounts the 25 capabilities in
  [workbench.ts:WORKBENCH_CAPABILITY_IDS] (`task.*`, `worker.return`, `evidence.record`,
  `authority.check`, `authority.elevate`, `workflow.*`, `skill.*`, `automation.*`, `usage.record`,
  `parallelism.plan`, `steer.*`, `feedback.record`, `workbench.seed`).
- [workspaceDirectorySuggest.ts:workspaceDirectorySuggestComponent] — mounts
  `workspace.directory.suggest`: read-only bounded directory completion in the selected world.
- [workspaceManage.ts:workspaceManageComponent] — mounts `workspace.rename` and `workspace.delete`.
- [workspacePath.ts:workspacePathComponent] — mounts `workspace.path`: resolves a `workspaceId` to
  `{ root, executionWorldId, title }` from the `workspaces` projection.
- [workspaceSelect.ts:workspaceSelectComponent] — mounts `workspace.select`: validates the root in
  the chosen execution world, derives the stable id, records `workspace.added`/`workspace.selected`.

### Exported types, constants and helpers

- [aggregateContainment.ts:CONTAINMENT_THREAD] — shared-state thread id `containment:aggregate:v1`;
  [aggregateContainment.ts:ContainmentQuotas], [aggregateContainment.ts:ContainmentExecution],
  [aggregateContainment.ts:ContainmentState], [aggregateContainment.ts:ContainmentQuotaError],
  [aggregateContainment.ts:ContainmentAdmission]; [aggregateContainment.ts:parseContainmentQuotas]
  (authoritative quota parser, fail-closed), [aggregateContainment.ts:readContainmentQuotas],
  [aggregateContainment.ts:acquireContainedSlot] (reaps expired leases before admitting),
  [aggregateContainment.ts:releaseContainedSlot], [aggregateContainment.ts:reconcileContainmentAtBoot],
  [aggregateContainment.ts:bookedCpuSecondsInWindow], [aggregateContainment.ts:containmentOverview],
  [aggregateContainment.ts:readContainmentOverview], [aggregateContainment.ts:prlimitArgv]
  (`prlimit --as/--cpu` prefix; CPU cap is `soft:hard` so SIGXCPU delivers before SIGKILL),
  [aggregateContainment.ts:emptyContainmentState], [aggregateContainment.ts:isContainmentState].
- [ambiguousStep.ts:AMBIGUOUS_INVOCATION_CAPABILITY] (`run.invocation.reconcile`),
  [ambiguousStep.ts:AMBIGUOUS_INVOCATION_CONTINUATION] (`ambiguous-invocation`),
  [ambiguousStep.ts:AmbiguousInvocationReconcileInput], [ambiguousStep.ts:isModelGeneration],
  [ambiguousStep.ts:interruptedCapability].
- [cognitive.ts:CASE_OPERATIONS] — the pure-data operations a coding Case may offer;
  [cognitive.ts:CognitiveOptions].
- [configPath.ts:ConfigPathResult].
- [containedWorkspace.ts:ContainmentConfig] (host-owned bubblewrap options),
  [containedWorkspace.ts:validateContainmentConfig] (structural validation incl. required operator
  provenance: `operatorVerified`, `binarySha256`, `patchedCve202687766`),
  [containedWorkspace.ts:awaitConfigurationRun] (deadline, cancel, event-evidence rollback decision),
  [containedWorkspace.ts:ConfigurationRunError] (implements
  [containedWorkspace.ts:ConfigurationRunFailureDetails]), [containedWorkspace.ts:ContainmentInspection].
- [executionWorlds.ts:WorldConnection], [executionWorlds.ts:ConnectInput],
  [executionWorlds.ts:containedWorldId] (`contained-<sha256(config, canonicalRoot)[0:16]>`),
  [executionWorlds.ts:parseConnect] (validates untrusted input into a connection descriptor plus the
  secrets to store), [executionWorlds.ts:CredentialsMissingError], [executionWorlds.ts:buildProvider]
  (rebuilds a live provider from a durable descriptor + secret store; re-verifies bubblewrap root
  canonicity), [executionWorlds.ts:parseWslList] (UTF-16LE/UTF-8 `wsl.exe` output),
  [executionWorlds.ts:restoreExecutionWorlds] (re-registers durable worlds at boot, lazily),
  [executionWorlds.ts:unavailableReason].
- [expertEffect.ts:EXPERT_EFFECT_CAPABILITY], [expertEffect.ts:ExpertToolInvokeInput],
  [expertEffect.ts:ExpertEffectReconciliationRequired].
- [expertModel.ts:ExpertModelGenerateInput], [expertModel.ts:ExpertModelGenerateOptions] (includes
  the `authorize` callback — the authoritative assignment check — and a test `providerFactory` seam).
- [governance.ts:ENV_OPERATOR] (`COGNATE_SEA_FORGE_OPERATOR`),
  [governance.ts:externalAuthorityFromEnv] (unset/off gives `undefined`; refuses `COGNATE_SEA_FORGE_OPERATOR`
  set while governance is off, and an operator id equal to the service actor),
  [governance.ts:ExternalAuthority], [governance.ts:SeaForgeActor], [governance.ts:seaForgeCall]
  (default 5s timeout).
- [identityAdmin.ts:IdentityAdminOptions].
- [modelConfigure.ts:ModelConfigureInput] (`apiKey` is write-only; optional operator-declared
  `prices` parsed by `parseBillingPrices`).
- [onboardingDismiss.ts:OnboardingStep], [onboardingDismiss.ts:OnboardingDismissInput].
- [planState.ts:PlanStateInput].
- [pluginInstall.ts:PluginInstallResult], [pluginInstall.ts:PluginCatalogResult].
- [providerManage.ts:ProviderDeleteInput], [providerManage.ts:ModelCatalogInput].
- [runtimeExecution.ts:RUNTIME_EXECUTION_INSPECT], [runtimeExecution.ts:RuntimeRunCapacity]
  (`1 | 2 | 4 | 8`), [runtimeExecution.ts:RuntimeAdmissionPolicy]
  (`"serial" | "model-only-parallel"`), [runtimeExecution.ts:RuntimeExecutionInspection],
  [runtimeExecution.ts:runtimeExecutionInspection] (throws `RangeError` on any other capacity).
- [secretPut.ts:SecretPutInput].
- [sessionArchive.ts:SessionArchiveInput].
- [sessionCreate.ts:DRAFT_SESSION_TITLE] (`"New Session"`), [sessionCreate.ts:sessionIdFor]
  (`session-<sha256(workspaceId, requestId)[0:24]>`), [sessionCreate.ts:SessionCreateInput].
- [sessionHistory.ts:SessionHistoryInput].
- [sessionTaskBind.ts:SessionTaskBindInput].
- [settlement.ts:recordWorkbenchEvents] (records through the replay-safe configuration agent and
  waits until committed), [settlement.ts:validateProof] (strict unknown-field refusal, relative
  `cwd`, `timeoutS` 1–3600), [settlement.ts:validateProofContract] (SWE_SEED spec path + pinned
  sha256 via `normaliseSha256`).
- [subagentStart.ts:SubagentStartInput].
- [taskCheckout.ts:TaskCheckoutOptions], [taskCheckout.ts:CheckoutAttachInput].
- [tools.ts] input/result types [tools.ts:ToolReadInput], [tools.ts:ToolEditResult] (carries
  `diffLines`/`additions`/`deletions` from the common-prefix/suffix line diff in
  [tools.ts:diffLines]), [tools.ts:ToolBashResult], [tools.ts:ToolRunCodeResult] (snippet runs via
  `bun -e` with the [tools.ts:RUN_CODE_HARNESS] `tools.bash` shim); re-exports
  [tools.ts:PathEscapeError] from `@godspeedai/cognate-execution`.
- [workbench.ts:WORKBENCH_CAPABILITY_IDS], [workbench.ts:WorkbenchCapabilityId].
- [workspaceDirectorySuggest.ts:splitTypedPath] (`/a/b` -> parent `/a`, prefix `b`; trailing
  separator = empty prefix), [workspaceDirectorySuggest.ts:DirectorySuggestInput],
  [workspaceDirectorySuggest.ts:DirectorySuggestion], [workspaceDirectorySuggest.ts:DirectorySuggestResult];
  re-exports the `WorldUnavailableError` type.
- [workspaceManage.ts:WorkspaceManageInput].
- [workspacePath.ts:WorkspacePathInput], [workspacePath.ts:WorkspacePathResult].
- [workspaceSelect.ts:workspaceIdFor] (sha256 of `worldId\0root`, hex slice 16),
  [workspaceSelect.ts:WorkspaceSelectInput].

No child subdirectories.

## Invariants

- **The durable event log owns state.** Every mutating capability validates against the live
  projection and then records via a deterministic `agent.config` run — the event, not component
  memory, is the truth [workspaceManage.ts:workspaceManageComponent], [settingsChange.ts:settingsChangeComponent],
  [pluginInstall.ts:pluginInstallComponent], [workbench.ts:workbenchComponent],
  [taskCheckout.ts:taskCheckoutComponent].
- **Archiving is not deletion**: `session.setArchived` removes no turn, run or event; the projection
  row survives [sessionArchive.ts:sessionArchiveComponent].
- **Operator-only surface** — a handler must refuse when `ctx.actor.kind !== "user"` or `ctx.runId`
  is set: [identityAdmin.ts:identityAdminComponent] (`operatorOnly`), [ambiguousStep.ts:ambiguousStepComponent],
  [governance.ts:governanceComponent], [settlement.ts:settlementComponent] (`operatorOnly`),
  [containedWorkspace.ts:containedWorkspaceComponent] (`operatorOnly`), [taskCheckout.ts:operatorOnly]
  (mutating checkout operations only; `task.checkout.resolve` is a pure read), [workbench.ts:requireUser]
  (`task.review.decide`, `authority.elevate`), and the human-act promotions
  [cognitive.ts:cognitiveComponent] (`world.settle`, `method.accept`), [expertEffect.ts:expertEffectComponent]
  (`expert.effect.resolve`). An agent must never reconcile, approve, declare, merge, or accept its own work.
- **Secrets never reach events, projections, or responses**: `secret.put` returns confirmation only,
  never the value [secretPut.ts:secretPutComponent]; `model.configure` persists the API key via the
  secret store and records only non-secret fields [modelConfigure.ts:modelConfigureComponent];
  `model.catalog` resolves the key server-side and never echoes it [providerManage.ts:providerManageComponent];
  `identity.session.issue` is the one place a cleartext token is returned, and it is never persisted
  [identityAdmin.ts:identityAdminComponent].
- **The one place a run-recorded secret write is forbidden**: `secret.put` must never be invoked from
  inside an agent's `run()` (that would record the raw secret in a `run.invocation` event payload)
  [secretPut.ts:secretPutComponent].
- **No local fallback**: an unknown or unreachable execution world fails the operation
  (`WorldUnavailableError`) rather than silently using the local machine
  [workspaceSelect.ts:workspaceSelectComponent], [workspaceDirectorySuggest.ts:workspaceDirectorySuggestComponent].
- **Fail-closed containment**: admission under an invalid stored quota throws
  [aggregateContainment.ts:parseContainmentQuotas]; configured kernel caps with unavailable
  `prlimit` tooling refuse the execution rather than run uncapped
  ([aggregateContainment.ts:wrapContainedProcess]); the slot lease derives from
  `MAX_CONTAINED_EXEC_MS` clamping, never a caller-supplied timeout
  [aggregateContainment.ts:acquireContainedSlot].
- **Deterministic identity**: workspace identity is `(worldId, root)`
  [workspaceSelect.ts:workspaceIdFor]; session identity is `(workspaceId, requestId)`
  [sessionCreate.ts:sessionIdFor]; contained world identity is `(containment config, canonical root)`
  [executionWorlds.ts:containedWorldId]. The same create request yields the same session after
  retry/reload/restart, with the runtime idempotency key guaranteeing exactly one
  `session.created` event [sessionCreate.ts:sessionCreateComponent].
- **Provider deletion order is secret-first**: `provider.delete` removes the stored secret before
  dismounting the provider, so a failure aborts with the configuration intact
  [providerManage.ts:providerManageComponent].
- **An interrupted model call cannot be reconciled as `succeeded`** — its response cannot be
  reconstructed; the honest outcome is `failed` so the agent retries [ambiguousStep.ts:ambiguousStepComponent].
- **Expert effect identity is stable**: `toolCallId` is the deterministic `step:call` position, the
  payload fingerprint (`fingerprint` from `@godspeedai/cognate-events`) must match on reuse, and any
  non-`INTENDED`/`SUCCEEDED`/`FAILED` commitment state requires human reconciliation
  [expertEffect.ts:expertEffectComponent].
- **`expert.model.generate` requires an `agent.expert` run** and never mutates the global
  `ProviderRegistry` — each dispatch builds an isolated provider [expertModel.ts:expertModelGenerateComponent].
- **Every `expert.model.generate` dispatch holds a durable billing reservation**; a failed dispatch
  still settles its reservation conservatively, and a crash leaves it blocking until reconciliation
  [expertModel.ts:expertModelGenerateComponent].
- **Session/task binding never widens authority**: availability is a read; `authority.check` still
  governs every tool call at run time [sessionTaskBind.ts:sessionTaskBindComponent], and binding is
  refused across workspaces or into another session's session-scoped task
  [sessionTaskBind.ts:sessionTaskBindComponent].
- **Stale bindings are invalidated, never silently kept**: moving a task records explicit
  `taskId: null` unbinds for every other bound session [workbench.ts:task.move handler];
  in-flight (`RUNNING`) tasks refuse move/contract-update/checkout-attach/merge/remove
  [workbench.ts:task.move handler], [taskCheckout.ts:taskCheckoutComponent].
- **`READY_FOR_REVIEW`, `ACCEPTED` and `REWORK` are reachable only through the review capabilities**,
  not `task.status.change` [workbench.ts:task.status.change handler].
- **`recordAndWait` (settle-before-return) is never called from an agent-reachable path** — it would
  deadlock the single admission slot on its own child run [workbench.ts:recordAndWait],
  [taskCheckout.ts:recordAndWait].
- **Runtime execution inspection is read-only**: it never reports live worker counts nor accepts
  configuration [runtimeExecution.ts:runtimeExecutionComponent].
- **Directory suggestions are directory-only, sorted, bounded** (limit 1–100, default 20), and the
  local world never suggests paths inside the protected application home
  [workspaceDirectorySuggest.ts:workspaceDirectorySuggestComponent].
- **World trust is a human act**: `execution.world.connect` requires the host-key fingerprint the
  human confirmed via `execution.world.probe`, and the provider refuses any other key
  [executionWorlds.ts:executionWorldsManageComponent]; `disconnect` refuses the `local` world and any
  world still used by a workspace [executionWorlds.ts:executionWorldsManageComponent].

## Side Effects

- **Durable event recording via `startRun`** of `AGENT_CONFIG` (or `AGENT_COGNITIVE` for the
  cognitive set), producing `workspace.added`/`workspace.selected`/`workspace.renamed`/
  `workspace.deleted`, `session.created`/`session.archived`/`session.recorded`, `settings.changed`,
  `model.configured`, `provider.deleted`, `plugin.installed`/`plugin.uninstalled`,
  `onboarding.dismissed`, `workbench.recorded` (all `workbench.*` task/workflow/skill/automation/
  evidence/authority events), `workbench.checkout.bound`/`workbench.checkout.removed`,
  `execution.world.connected`/`execution.world.disconnected`, and the proof/settlement events
  (`PROOF_DECLARED` from `../settlement/orchestrator.ts`).
- **Secret store writes/deletes**: [secretPut.ts:secretPutComponent] (`store.put`),
  [modelConfigure.ts:modelConfigureComponent] (`model-provider:<providerId>`),
  [providerManage.ts:providerManageComponent] (delete), [executionWorlds.ts:executionWorldsManageComponent]
  (`execution-world:<worldId>:password|passphrase` put on connect, delete on disconnect/failure).
- **Provider registry mutations**: swap [modelConfigure.ts:modelConfigureComponent], clear
  [providerManage.ts:providerManageComponent], register/unregister of SSH/WSL/bubblewrap/local-fork
  providers [executionWorlds.ts:executionWorldsManageComponent], [containedWorkspace.ts:containedWorkspaceComponent],
  [cognitive.ts:cognitiveComponent] (`world.fork`/`world.attach`/`world.discard`/`experiment.round`).
- **Filesystem access**: existence check of the config file [configPath.ts:configPathComponent];
  directory-copy forks (`mkdtemp`/`cp`/`rm`) under `forkRoot` [cognitive.ts:cognitiveComponent];
  recursive removal of discarded forks [cognitive.ts:cognitiveComponent]; read of `~/.ssh/known_hosts`
  during `execution.world.probe` [executionWorlds.ts:executionWorldsManageComponent]; Git worktree
  create/status/merge/remove through the workspace's execution-world provider
  (`../workbench/gitOps.ts`) [taskCheckout.ts:taskCheckoutComponent]; bounded directory listing via
  the world's provider [workspaceDirectorySuggest.ts:workspaceDirectorySuggestComponent].
- **Network**: provider catalog fetch with 15s timeout [providerManage.ts:providerManageComponent];
  model dispatch/stream [expertModel.ts:expertModelGenerateComponent]; SEA-Forge NDJSON over a Unix
  socket [governance.ts:seaForgeCall]; SSH/WSL world connections [executionWorlds.ts:buildProvider].
- **Cross-process shared state**: optimistic-concurrency CAS loop on thread
  `containment:aggregate:v1` via `readSharedState`/`updateSharedState`
  [aggregateContainment.ts:acquireContainedSlot], [aggregateContainment.ts:releaseContainedSlot].
- **Billing ledger**: `reserveModelCall`/`settleModelCall` per dispatch, priced from operator
  ceilings read via `readSpendingCeilings` [expertModel.ts:expertModelGenerateComponent].
- **Commitment persistence**: `CommitmentService` over the runtime store, with `commitments.dispatch()`
  for the expert effect target [expertEffect.ts:createService].
- **Identity service**: `ensureIdentity`/`issueSession`/`revokeSession` in `../auth/identity.ts`
  [identityAdmin.ts:identityAdminComponent].
- **Polling waits**: settlement loops (15ms polls, bounded) that block the caller until the recording
  run settles [sessionCreate.ts:sessionCreateComponent], [settlement.ts:recordWorkbenchEvents],
  [workbench.ts:recordAndWait], [taskCheckout.ts:recordAndWait],
  [executionWorlds.ts:executionWorldsManageComponent].
- **In-memory (non-durable, by design)**: the FocusContext store and pending surface queue of the
  cognitive attention bridge — lost on restart, never an event [cognitive.ts:cognitiveComponent];
  `MAX_WORLD_FAIL` failure-reason map [executionWorlds.ts:unavailableReason].

## Verification

- Run (from repo root): `bun run test` (= `bun test --timeout 15000 test`)
- Type check: `just typecheck`; full gate: `just verify`
- Targeted suites verified to cover this directory: `test/aggregateContainment.test.ts`,
  `test/containedWorkspace.test.ts`, `test/executionWorlds.test.ts`, `test/expert-effect.test.ts`,
  `test/expert-model-routing.test.ts`, plus the journey suites `test/J-CHECKOUT-lifecycle.test.ts`,
  `test/J-RW-AGGREGATE-CONTAINMENT.test.ts`, `test/J-SEA-FORGE-AUTHORITY.test.ts`,
  `test/J-AUTH-SESSION.test.ts`.
