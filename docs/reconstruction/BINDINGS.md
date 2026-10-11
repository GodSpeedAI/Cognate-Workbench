# Capability bindings (T5, extended T7, T9, T10)

Per `idm-to-cognate.md`: `bindCapabilities` is the only path from a `SemanticObject` to a
`CapabilityContract`, and it is 100% explicit. This file lists every binding this app makes — no
more, no fewer (see `.sea/interaction/handoff.md` "What downstream agents should NOT do": don't
bind speculatively).

All bindings live in `domain/index.ts` (`tranche5Bindings`), against
`.sea/interaction/interaction-model.sea` (namespace `deepseek-harness.interaction`, 51 semantic
objects, digest logged at startup).

| # | Semantic id | Capability | Published by | Why |
|---|---|---|---|---|
| 1 | `deepseek-harness.interaction::ModelProvider` | `model.generate` v1.0.0 | `streamingProviderComponent` (`src/components/modelProvider.ts`), mounted/hot-swapped by `ProviderRegistry` (`src/components/providerRegistry.ts`) | The live model route is exactly the IDM's `ModelProvider` entity made executable. |
| 2 | `deepseek-harness.interaction::ModelProvider` | `secret.put` v1.0.0 | `secretPutComponent` (`src/capabilities/secretPut.ts`) | The credential a `ModelProvider` needs; kept on the same semantic anchor since it has no separate `.sea` entity of its own. |
| 3 | `deepseek-harness.interaction::ModelProvider` | `model.configure` v1.0.0 | `modelConfigureComponent` (`src/capabilities/modelConfigure.ts`) | The orchestration capability the UI's Settings → Models "Save" invokes: writes the secret, hot-swaps the provider, and starts the durable `agent.config` run. |
| 4 | `deepseek-harness.interaction::WorkspaceRecord` | `workspace.select` v1.0.0 | `workspaceSelectComponent` (`src/capabilities/workspaceSelect.ts`) | Validates a directory and durably records `workspace.added`/`workspace.selected` — the `WorkspaceRecord` entity's only producer. |
| 5 | `deepseek-harness.interaction::Session` | `session.history` v1.0.0 | `sessionHistoryComponent` (`src/capabilities/sessionHistory.ts`) | Folds a `Session`'s prior turns into model messages — the "History" row of the architecture table. |
| 6 | `deepseek-harness.interaction::Tool` | `tool.read` v1.0.0 | `toolCapabilitiesComponent` (`src/capabilities/tools.ts`) | Reads a file inside the session's workspace. Path-contained (`resolveInWorkspace`, rejects any escape). |
| 7 | `deepseek-harness.interaction::Tool` | `tool.edit` v1.0.0 | `toolCapabilitiesComponent` (`src/capabilities/tools.ts`) | Exact `old_string`/`new_string` replace (unique match required unless `replace_all`); path-contained. |
| 8 | `deepseek-harness.interaction::Tool` | `tool.bash` v1.0.0 | `toolCapabilitiesComponent` (`src/capabilities/tools.ts`) | Runs a shell command as a Bun subprocess, `cwd` = workspace root, timeout + output caps. |
| 9 | `deepseek-harness.interaction::Tool` | `tool.run_code` v1.0.0 | `toolCapabilitiesComponent` (`src/capabilities/tools.ts`) | Runs a code snippet (original small `tools.bash`-providing harness, not copied from the reference) as a Bun subprocess; the tool a `sandbox_permissions` escalation request rides on — see `approvalGate.ts`. |
| 10 | `deepseek-harness.interaction::WorkspaceRecord` | `workspace.path` v1.0.0 | `workspacePathComponent` (`src/capabilities/workspacePath.ts`) | Resolves a `workspaceId` to its canonical path for the tool loop (`agent.coding`'s `ctx.invoke("workspace.path", ...)`). |
| 11 | `deepseek-harness.interaction::PlanMode` | `plan.state` v1.0.0 | `planStateComponent` (`src/capabilities/planState.ts`) | Resolves a `sessionId` to its current plan-mode/todos/review state (the `plans` projection) — `agent.coding`'s per-turn read of whether the session is genuinely in plan mode. |
| 12 | `deepseek-harness.interaction::Subagent` | `subagent.start` v1.0.0 | `subagentStartComponent` (`src/capabilities/subagentStart.ts`) | Starts a child `agent.coding` run correlated `subagent:<parentRunId>:<id>`, invoked directly and fire-and-forget by the `subagent` tool (`agentCoding.ts`) — not `@cognate/profile-harness`'s packaged `subagent.start` (see the file's own comment for why). |
| 13 | `deepseek-harness.interaction::UserPreferences` | `settings.changeWorkDetails` v1.0.0 | `settingsChangeComponent` (`src/capabilities/settingsChange.ts`) | Usage pass U2: writes the Work-details field of the durable General-settings row (pre-U2 capability, retroactively anchored on the new entity). |
| 14 | `deepseek-harness.interaction::UserPreferences` | `settings.changePermission` v1.0.0 | `settingsChangeComponent` | Usage pass U2: the default access mode for NEW sessions (consumed by the composer's per-session dropdown → `AgentCodingInput.mode` → `approvalGate`); "Full access" commits only through the confirmation dialog. |
| 15 | `deepseek-harness.interaction::UserPreferences` | `settings.changeLanguage` v1.0.0 | `settingsChangeComponent` | Usage pass U2: Language (display-only persistence — no i18n strings, see DEVIATIONS.md). |
| 16 | `deepseek-harness.interaction::UserPreferences` | `settings.changeAppearance` v1.0.0 | `settingsChangeComponent` | Usage pass U2: Light/Dark/System; System follows `prefers-color-scheme` live. |
| 17 | `deepseek-harness.interaction::UserPreferences` | `settings.changeFontSize` v1.0.0 | `settingsChangeComponent` | Usage pass U2: conversation-content font size (1px stepper, floor 12, ceiling 32). |
| 18 | `deepseek-harness.interaction::UserPreferences` | `settings.changePerformanceDetail` v1.0.0 | `settingsChangeComponent` | Usage pass U2: Performance & usage detail level (Compact/Detailed). |
| 19 | `deepseek-harness.interaction::UserPreferences` | `settings.changeCodingTools` v1.0.0 | `settingsChangeComponent` | Usage pass U2: the Coding Tools switch (gates the Trajectory surface from the developer-tools tranche onward). |
| 20 | `deepseek-harness.interaction::UserPreferences` | `settings.changeSendBehavior` v1.0.0 | `settingsChangeComponent` | Usage pass U2: what Enter does while a run streams (Queue/Steer — see DEVIATIONS.md for Steer's semantics). |
| 21 | `deepseek-harness.interaction::WorkspaceRecord` | `workspace.rename` v1.0.0 | `workspaceManageComponent` (`src/capabilities/workspaceManage.ts`) | Usage pass U3: the sidebar's per-workspace Rename action (§12) — validates against the live projection, starts the durable `agent.config` run, and the projection rewrites the record's title. |
| 22 | `deepseek-harness.interaction::WorkspaceRecord` | `workspace.delete` v1.0.0 | `workspaceManageComponent` | Usage pass U3: the sidebar's Delete workspace action — removes the record (and a current pointer to it); sessions' events stay in history. |
| 23 | `deepseek-harness.interaction::UserPreferences` | `settings.changePreset` v1.0.0 | `settingsChangeComponent` | Usage pass U4: the default agent preset for NEW sessions (Standard/PTC/Minimal) — the composer sends it as `AgentCodingInput.preset`, scoping the turn's tool catalog (`agentCoding.ts`'s PRESET_TOOLS); the sessions projection folds it into the row's mode badge. |

| 24 | `deepseek-harness.interaction::ExecutionWorld` | `process.exec` v1.0.0 | `executionWorldsComponent` (`@cognate/execution`) | Remote Workspaces T4: the framework `filesystem.*` / `process.exec` family (one semantic anchor for the family) — where a workspace's files are read and commands run. |
| 25 | `deepseek-harness.interaction::ExecutionWorld` | `execution.world.connect` v1.0.0 | `executionWorldsManageComponent` (`src/capabilities/executionWorlds.ts`) | Registers an SSH host / WSL distribution after verifying it can be used; secrets to the secret store, safe metadata + pinned host-key fingerprint to the durable record. |
| 26 | `deepseek-harness.interaction::ExecutionWorld` | `execution.world.disconnect` v1.0.0 | same | Releases a world, deletes its secrets; refused while a workspace uses it. |
| 27 | `deepseek-harness.interaction::WorldConnection` | `execution.world.probe` v1.0.0 | same | Reads a server's host key and stops (nothing authenticated); the human confirms the fingerprint. |
| 28 | `deepseek-harness.interaction::WorldConnection` | `execution.world.check` v1.0.0 | same | Is the live connection usable now (reconnects lazily); the UI's reachability banner. |

`bindExecutionWorlds` (`domain/index.ts`) binds #24-28. `execution.wsl.list` is a diagnostic read and is not bound.

`tranche7Bindings`/`bindTranche7` (`domain/index.ts`) bind #6-10, alongside `tranche5Bindings` above.
`tranche9Bindings`/`bindTranche9` (`domain/index.ts`) bind #11.
`tranche10Bindings`/`bindTranche10` (`domain/index.ts`) bind #12.

## Not bound (open gap, DEBT-023)

- The cognitive-navigation capabilities (`case.open`, `case.derive`, `case.observe`,
  `criterion.freeze`, `world.freeze|fork|attach|discard|settle`, `verification.run`, `risk.assess`,
  `experiment.round|status`, `method.review|accept|active`, `ui.*`) are real executable capabilities
  that *should* be bound but are not yet: the `.sea` model carries another tranche's uncommitted
  edits. This is a gap, not a design decision; see `.agents/DEBT.md` DEBT-023.

## Not bound (deliberately)

- `observation.status` / `observation.record` (usage pass U6) — a diagnostic read over the
  RealityTrace adapter's receipt store (DurableStore `observations` collection, not the event
  log), same precedent as `onboarding.dismiss`: no domain entity describes an evidence-ledger
  receipt, and inventing one for a read-side diagnostic would misstate the domain. See
  `src/observations.ts`.
- `settings.changeWorkDetails` was unbound until usage pass U2 created `UserPreferences`;
  `onboarding.dismiss` remains unbound (a durable UI-flow dismissal, not a domain capability).


- `agent.config` and `agent.coding` are `AgentDefinition`s, not capabilities — an agent id is not a
  `CapabilityContract`, so `bindCapabilities` does not apply to them. Their runs still carry
  `semanticRef` transitively: `agent.coding`'s `ctx.invoke("model.generate", ...)`,
  `ctx.invoke("session.history", ...)`, `ctx.invoke("workspace.path", ...)` and
  `ctx.invoke("tool.<name>", ...)` calls record the bound contracts' `semanticRef` in
  `run.invocation` events (traceability rule #2).
- **`ApprovalGate`** — deliberately realized as a pure decision function (`approvalGate` in
  `src/domain/approvalGate.ts`, named after this `.sea` entity) plus a `ctx.waitFor` continuation
  inside `agent.coding`, not as a `CapabilityContract`. An approval gate is a policy decision over an
  already-invoked tool call's arguments, not itself an invokable capability — there is nothing for a
  `Component` to `provide`. `j_d_approval`'s `Flow "ApprovalDecision" from "ApprovalAuthority" to
  "ApprovalGate"` is realized as the `tool-approval` continuation's resume input (`{ approved:
  boolean }`), resolved via `client.resolveContinuation`/`RuntimeService.resolveContinuation` — see
  `README.md` "Tool loop and approvals (T7-T8)".
- `Goal`, `ChildAgent`, `ApprovalAuthority`, `Composer`, `OperatorAgent`, `User` — real `.sea`
  entities with no bound capability yet; they belong to later tranches (T11) or are not surfaced by
  this reconstruction at all, and are intentionally left unbound until this app actually publishes
  something for them.
- The `subagent` tool itself is not a `CapabilityContract` — same "policy/orchestration lives in
  `agent.coding`, only the leaf I/O is a capability" shape as `ApprovalGate`/`PlanMode` above. Only
  the leaf capability the child run needs to actually start (`subagent.start`, #12) is bound; there is
  no continuation and no completion-watcher (fire-and-forget delegation, T10's correction — see
  `README.md` and `DEVIATIONS.md`).
- `PlanMode`'s plan-mode-on/off and todos/review state (T9) is realized the same way as
  `ApprovalGate`: app events (`plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`,
  `plan.review.decided`) emitted directly by `agent.coding`, not a `CapabilityContract` a UI action
  invokes — the only bound capability is the read side, `plan.state` (#11 above). `exit_plan_mode`'s
  review is a `ctx.waitFor("plan-review:<toolCallId>", ...)` durable continuation, the same pattern
  as `tool-approval` but a distinct `type` (different payload/outcome shape — a plan heading/markdown
  to review, not a permission to allow/deny). See `src/domain/planGate.ts` and README.md.

## Workbench layer

Anchors for the unified-harness-experience-model-v2 tranche (`domain/index.ts`: `WORKBENCH_ANCHORS`,
`bindWorkbench`). All explicit; nothing is inferred. Events are the truth, the public `workbench`
projection is derived (`src/projections/workbench.ts`, folded by the pure `src/workbench/reducer.ts`).

| Entity | Capabilities |
|---|---|
| `Task` | `task.create`, `task.status.change` |
| `TaskContract` | `task.contract.update` |
| `ReviewGate` | `task.review.request`, `task.review.decide` (person only), `worker.return` |
| `EvidenceLedger` | `evidence.record` |
| `ProtectedEvidence` | `authority.check` (called by `agent.coding`), `authority.elevate` (person only) |
| `Workflow` | `workflow.define`, `workflow.instantiate`, `workflow.node.advance` |
| `SkillCapability` | `skill.register`, `workbench.seed` (infrastructure: loads the starter catalog) |
| `CapabilityImplementation` | `skill.bind`, `skill.lifecycle.advance` (grant steps are person only) |
| `Automation` | `automation.create`, `automation.advance` |
| `UsageLedger` | `usage.record` |
| `ParallelPlan` | `parallelism.plan` |
| `SteeringInbox` | `steer.enqueue`, `steer.pending` |
| `GroundedFeedback` | `feedback.record` |

Deliberately unbound: `AttentionFocus` (client-side attention, resolved by `src/workbench/focus.ts` and frozen
into the run input). Human-only capabilities check `HandlerContext.actor.kind === "user"`: an agent run invokes
capabilities as a non-user principal, so it cannot accept its own work or elevate a protected path.
