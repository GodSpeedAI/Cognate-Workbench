# Reference: event catalog

Every durable event, who emits it, and which projection folds it.

## How to read this

An **event** is an immutable recorded fact. This application has no other source of truth. An event
is written only by a run — normally `agent.config`, sometimes an agent directly.

`RuntimeService.startRun` is **not** itself an event. The domain event the run emits is.

Every event carries `tenant`, `position`, `recordedAt`, and a payload.

## Session and conversation

| Event | Emitted by | Folded into |
|---|---|---|
| `session.turn.started` | `agent.coding` | `sessions` — and it carries `mode` and `preset` when present, which is how the composer's selections read back |
| `message.completed` | `agent.coding` | `sessions`, `session-trace`, observed by the outbox |
| `tool.call.started` | `agent.coding` | `sessions`, `session-trace`, `subagents`, observed |
| `tool.call.completed` | `agent.coding` | as above, observed |
| `tool.call.failed` | `agent.coding` | as above, observed |
| `run.failed` | runtime / agents | `session-trace`, observed |

`tool.call.started` is emitted **before** any gating, always. The transcript keys tool entries off it,
so a pending approval has a visible tool card to hang its state on.

Model errors and retries are emitted by `agent.coding` with the classified failure in the payload.

## Plan mode

| Event | Emitted by | Folded into |
|---|---|---|
| `plan.mode.changed` | `agent.coding` | `plans` |
| `plan.todos.updated` | `agent.coding` (via `todo_write`) | `plans` |
| `plan.review.requested` | `agent.coding` (via `exit_plan_mode`) | `plans` |
| `plan.review.decided` | `agent.coding`, after the continuation resolves | `plans` |

## Model and configuration

| Event | Emitted by | Folded into | Notes |
|---|---|---|---|
| `model.configured` | `agent.config` (`kind: "model.configured"`) | `model-config` | **Never carries a secret.** The payload is `{ providerId, baseURL, protocol, model }`. |
| `settings.changed` | `agent.config` (`SettingsPatch`) | `settings` | Partial patches; the fold merges. |
| `onboarding.dismissed` | `agent.config` | `onboarding` | `{ step: "notice" \| "apikey" }` |

## Workspace and execution worlds

| Event | Emitted by | Folded into |
|---|---|---|
| `workspace.added` | `agent.config` | `workspaces` |
| `workspace.selected` | `agent.config` | `workspaces` |
| `workspace.renamed` | `agent.config` | `workspaces` |
| `workspace.deleted` | `agent.config` | `workspaces` |
| `execution.world.connected` | `agent.config` | `execution-worlds` |
| `execution.world.disconnected` | `agent.config` | `execution-worlds` |

`execution.world.connected` carries safe metadata only: the world kind, a label, metadata, and the
connection. Auth *kind* and a key *path* and a pinned fingerprint, never a password, passphrase, or
key material.

## Delegation

| Event | Emitted by | Folded into |
|---|---|---|
| `subagent.spawned` | `agent.coding`, right after `subagent.start` returns | `subagents` |

A child's completion is **not** an event the parent emits. The child run emits its own
`message.completed` or `run.failed`, correlated `subagent:<parentRunId>:<toolCallId>`, and the
`subagents` projection observes those directly. There is no parent-side wait.

## Workbench

All emitted through `agent.config` with `kind: "workbench.recorded"` carrying a batch of
`{ type, payload }` entries. Names follow `WORKBENCH_EVENTS` in `src/workbench/types.ts`.

The family covers: task creation, contract updates, status changes, review requests and decisions,
worker returns, evidence records, protection blocks, workflow definition/instantiation/advancement,
skill registration/binding/lifecycle, automation creation and advancement, usage records, parallelism
plans, steering, and grounded feedback.

One deserves calling out:

| Event | Meaning |
|---|---|
| `workbench.protection.blocked` | A write or command was refused because a protected-evidence pattern matched. Carries the path, the pattern, and the reason. |

All of them fold into the single `workbench` projection via `src/workbench/reducer.ts`.

## Cognitive

Event names live in two constant sets: `CASE_EVENTS` in `src/cognitive/case.ts` and `WORLD_EVENTS`
in `src/cognitive/world.ts`. `COGNITIVE_EVENT_TYPES` in `src/agents/agentCognitive.ts` is the union
the `cognitive` projection watches.

The families:

| Family | Examples |
|---|---|
| Case | `case.opened` |
| Criterion | the criterion-frozen event |
| World | `world.baseline.frozen`, `world.candidate.frozen`, `world.candidate.rejected`, `world.settled` |
| Verification | `verification.observed` |
| Search | experiment-round events |
| Method | `method.recommended`, `method.accepted` |
| Governance | `sentinel.finding` |

Four of these (`world.baseline.frozen`, `world.candidate.frozen`, `world.candidate.rejected`,
`world.settled`), together with `verification.observed`, `sentinel.finding`,
`experiment.round.completed`, `method.recommended` and `method.accepted`, also ride the RealityTrace
outbox. Cognitive events that affect settlement therefore use **one** evidence system rather than
introducing a second.

## What is deliberately not an event

| Fact | Why |
|---|---|
| API keys, SSH passphrases | They live in `<home>/secrets.json`. The `model.configured` payload never contained one. |
| Observation delivery receipts | They live in the DurableStore `observations` collection. That is why the observation read side is two unrecorded capabilities rather than a projection. |
| `RuntimeService.startRun` | Starting a run is not itself a fact about the domain; the event the run emits is. |
| Fork directory contents | Disposable. Lineage events are the truth. |

## Naming conventions observed

- Namespace by subsystem: `session.*`, `tool.call.*`, `plan.*`, `workspace.*`, `workbench.*`,
  `cognitive.*`.
- Past tense for facts (`message.completed`, `workspace.renamed`).
- Subject before verb (`tool.call.started`, not `startedToolCall`).
- Event payloads are `Json`; capability ids are dotted lower-case.

## Source trail

- `src/agents/agentCoding.ts` — the session, tool, plan and subagent emits
- `src/agents/agentConfig.ts` — `AgentConfigInput`, the closed recordable set
- `src/workbench/types.ts` — `WORKBENCH_EVENTS`
- `src/workbench/reducer.ts` — the `workbench.*` fold
- `src/cognitive/case.ts` — `CASE_EVENTS`
- `src/cognitive/world.ts` — `WORLD_EVENTS`
- `src/agents/agentCognitive.ts` — `COGNITIVE_EVENT_TYPES`
- `src/observations.ts` — `OBSERVED_EVENT_TYPES`, `capabilityIdOf`
- `src/projections/*.ts` — which fold consumes which