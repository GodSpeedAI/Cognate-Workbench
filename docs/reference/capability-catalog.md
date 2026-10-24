# Reference: capability catalog

Every capability id this application can invoke, who provides it, and who is allowed to call it.

## How to read this

A **capability** is a governed, leased unit of effect identified as `id.version` (every binding in
this application uses `1.0.0`).

**Grants** come from `GRANTED_CAPABILITIES` in `src/server.ts`, the allow-list handed to the
development authenticator. A capability absent from that list is not reachable from the client.

Not every capability is *bound* to a semantic id in the `.sea` model. See
[Capability model](../concepts/capability-model.md) for why three families deliberately are not, and
why one family is an open gap.

## Model, secret, workspace, session

| Capability | Provider | Bound to | Notes |
|---|---|---|---|
| `model.generate` | `modelProvider.ts` (streamed component) | `ModelProvider` | Publishes through `ctx.progress` |
| `model.configure` | `modelConfigure.ts` | `ModelProvider` | Validates, stores the secret, hot-swaps |
| `secret.put` | `secretPut.ts` | `ModelProvider` | The only capability writing the secrets file |
| `workspace.select` | `workspaceSelect.ts` | `WorkspaceRecord` | |
| `workspace.path` | `workspacePath.ts` | `WorkspaceRecord` | Resolves `(executionWorldId, root)` |
| `workspace.rename` | `workspaceManage.ts` | `WorkspaceRecord` | |
| `workspace.delete` | `workspaceManage.ts` | `WorkspaceRecord` | |
| `session.history` | `sessionHistory.ts` | `Session` | Folds prior turns per call |

## Tools

| Capability | Provider | Bound to | Notes |
|---|---|---|---|
| `tool.read` | `tools.ts` | `Tool` | Workspace-path-contained |
| `tool.edit` | `tools.ts` | `Tool` | Exact string replace, with a read-before-edit guard |
| `tool.bash` | `tools.ts` | `Tool` | Shell; destructive commands are classified and gated |
| `tool.run_code` | `tools.ts` | `Tool` | The escalation tool; `sandbox_permissions` triggers approval |

The `todo_write`, `exit_plan_mode` and `subagent` tools are handled in the agent loop, not as separate
tool capabilities.

## Plan, subagent, onboarding

| Capability | Provider | Bound to | Notes |
|---|---|---|---|
| `plan.state` | `planState.ts` | `PlanMode` | Read side for the plan projection |
| `subagent.start` | `subagentStart.ts` | `Subagent` | Starts the correlated child run |
| `onboarding.dismiss` | `onboardingDismiss.ts` | — (deliberately unbound) | A durable UI-flow flag |

## Settings

All ten are realised by one component, `settingsChange.ts`, each writing only its own field.

| Capability | Field |
|---|---|
| `settings.changeWorkDetails` | `workDetails` |
| `settings.changePermission` | `permission` |
| `settings.changeLanguage` | `language` |
| `settings.changeAppearance` | `appearance` |
| `settings.changeFontSize` | `fontSize` |
| `settings.changePerformanceDetail` | `performanceDetail` |
| `settings.changeCodingTools` | `codingTools` |
| `settings.changeSendBehavior` | `sendBehavior` |
| `settings.changePreset` | `preset` |
| `settings.changePlugin` | `plugins` (merged per key) |

Bound to `UserPreferences`.

## Execution

| Capability | Provider | Bound to |
|---|---|---|
| `filesystem.resolve`, `filesystem.readText`, `filesystem.list`, `process.exec` | `@godspeedai/cognate-execution` (+ `-ssh`, `-wsl`) | `ExecutionWorld` |
| `execution.world.probe` | `executionWorlds.ts` | `WorldConnection` — authenticates nothing |
| `execution.world.connect` | `executionWorlds.ts` | `ExecutionWorld` |
| `execution.world.check` | `executionWorlds.ts` | `WorldConnection` |
| `execution.world.disconnect` | `executionWorlds.ts` | `ExecutionWorld` — refused while a workspace uses it |
| `execution.wsl.list` | `executionWorlds.ts` | — (a diagnostic read, not bound) |

## Cognitive

Provided by `cognitiveComponent`. **Not bound to the semantic model** — see the gap note below.

| Capability | Human-only |
|---|---|
| `case.open` | |
| `case.derive` | |
| `case.observe` | |
| `criterion.freeze` | |
| `world.freeze`, `world.fork`, `world.attach`, `world.discard` | |
| `world.settle` | **yes** — throws if `ctx.runId` is set; requires a `user` actor |
| `verification.run` | |
| `risk.assess` | |
| `experiment.round`, `experiment.status` | |
| `method.review`, `method.active` | |
| `method.accept` | **yes** — throws if `ctx.runId` is set; requires a `user` actor |
| `ui.context`, `ui.request`, `ui.focus.publish`, `ui.pending` | |

## Observations

| Capability | Provider | Bound to | Notes |
|---|---|---|---|
| `observation.status` | `src/observations.ts` | — (deliberately unbound) | Per-event delivery state |
| `observation.record` | `src/observations.ts` | — (deliberately unbound) | Correlation payload for one delivered observation |

Both are client-invoked reads over the DurableStore `observations` collection, which is not the event
log. Modelling them as domain facts would misstate the domain.

## Workbench

Twenty-five ids, all from `src/capabilities/workbench.ts`.

| Capability | Purpose |
|---|---|
| `task.create` | Create a task |
| `task.contract.update` | Change one part of the contract |
| `task.status.change` | Move on the board |
| `task.review.request` | Open the review gate |
| `task.review.decide` | **Human-only** — accept or request changes |
| `worker.return` | Record a worker's return against the contract |
| `evidence.record` | Record an evidence entry |
| `authority.check` | Decide a write or a shell command |
| `authority.elevate` | **Human-only** — raise authority deliberately |
| `workflow.define` | Define a workflow graph |
| `workflow.instantiate` | Start an instance |
| `workflow.node.advance` | Advance a node |
| `skill.register` | Register a capability |
| `skill.bind` | Bind an implementation |
| `skill.lifecycle.advance` | Move one lifecycle step |
| `automation.create` | Create an automation |
| `automation.advance` | Advance its state machine |
| `usage.record` | Attribute a call to an executor |
| `parallelism.plan` | Plan parallel work |
| `steer.enqueue` | Add to a steering queue |
| `steer.pending` | Read the pending steering |
| `feedback.record` | Record grounded feedback |
| `workbench.seed` | Seed the capability catalog |

Every one of these validates against the live `workbench` projection using the pure modules, then
records through an `agent.config` run. None holds state.

## The cognitive family is bound

The cognitive capabilities are executable **and** bound. `bindCognitiveCapabilities(domain)` runs at
boot and anchors each one on an entity in the model — see
[the binding table](../concepts/capability-model.md#cognitive-bindings) for the full mapping.

An earlier revision of this page recorded them as an unbound gap because the `.sea` file was said to
carry another tranche's uncommitted edits. That is not true of the current tree.

## Adding one

See [How to add a capability](../how-to/add-a-capability.md). The binding is not optional bookkeeping:
it is what keeps a capability's meaning stable across implementation changes.

## Source trail

- `src/server.ts` — `GRANTED_CAPABILITIES`, the full allow-list
- `src/capabilities/workbench.ts` — `WORKBENCH_CAPABILITY_IDS`
- `src/capabilities/*.ts` — each provider
- `domain/index.ts` — every binding and its count assertion
- `.sea/interaction/interaction-model.sea` — the entities these bind to
- `src/observations.ts` — the unrecorded read side
- `src/capabilities/cognitive.ts` — the human-only guards