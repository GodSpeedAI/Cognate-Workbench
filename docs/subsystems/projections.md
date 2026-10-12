# Subsystem: projections

## Purpose

Turn the event log into the read models the UI subscribes to. A projection is a pure function of
`(event, priorState)` returning row writes. Delete one and rebuild it; nothing is lost.

## Responsibilities

- Fold a named set of event types into rows.
- Own the key convention (`${tenant}/…`) for tenant scoping.
- Version themselves so a fold change is visible.

## Non-responsibilities

Projections do not perform I/O, do not call capabilities, do not start runs, and do not decide
whether an event should have happened.

## Position in the system

Registered on `createRuntime` in `src/server.ts` and read by the UI through `useProjection(name)`
from `@godspeedai/cognate-react`, and by capability handlers through
`runtime.service.readProjection(caller, { name })`.

## The eleven

| Name | File | Folds | Key shape |
|---|---|---|---|
| `sessions` | `sessions.ts` | `session.turn.started`, tool and message events | per session |
| `session-trace` | `sessionTrace.ts` | the authoritative event log | per event |
| `plans` | `plans.ts` | `plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`, `plan.review.decided` | `${tenant}/${sessionId}` |
| `subagents` | `subagents.ts` | `subagent.spawned`, plus the child's own completion events | `${tenant}/${parentRunId}/${toolCallId}` |
| `workbench` | `workbench.ts` | every `workbench.*` event, via `src/workbench/reducer.ts` | one cockpit view |
| `workspaces` | `workspaces.ts` | `workspace.added`, `workspace.selected`, `workspace.renamed`, `workspace.deleted` | per workspace + a current pointer |
| `execution-worlds` | `executionWorlds.ts` | `execution.world.connected`, `execution.world.disconnected` | `${tenant}/record/${worldId}` |
| `model-config` | `modelConfig.ts` | `model.configured` | `${tenant}/current` |
| `settings` | `settings.ts` | `settings.changed` | `${tenant}/current` |
| `onboarding` | `onboarding.ts` | `onboarding.dismissed` | `${tenant}/notice`, `${tenant}/apikey` |
| `cognitive` | `cognitive.ts` | any cognitive event type | `${tenant}/latest`, `${tenant}/activeCase` |

## Internal operation

Two fold styles appear, and the difference matters.

**Last-write-wins** (`model-config`, `onboarding`): the row simply records the newest event.

**Merging** (`settings`): events carry *partial* patches, because each `settings.change*` capability
writes only its own field. The fold merges into the prior row so a field, once set, keeps its value
until a later event changes it. The `plugins` map is a special case: it merges *per key*, so
toggling one plugin does not clobber the others.

**Derived change signal** (`cognitive`): a single `latest` row carrying `(position, eventType)` that
the UI subscribes to purely as a signal, then asks `case.derive` for the actual Case. The Case is
never stored here.

**Title from the first message** (`sessions`): a session's title is the literal first human message,
truncated by `titleFrom()`, set at turn start — not re-titled later by a model. An existing
non-default title is never overwritten by a later turn. There is no separate summarisation or
re-titling cadence.

**Cross-projection derivation** (`subagents`): a child run's completion is observed from *its own*
events, correlated `subagent:<parentRunId>:<toolCallId>`, not from anything the parent emits. There
is no parent-side wait, so the parent cannot record when the child finishes.

## State

Owns nothing durable. Its state is derived and rebuildable. Absence of a row is meaningful: a fresh
home directory has no `model-config`, no `settings`, and no `onboarding` rows, and that absence is
exactly what drives the UI's defaults and re-shows the first-run dialogs.

Note the key convention: the UI reads through `ReadProjection`, which strips the tenant prefix before
the value reaches the browser.

## Lifecycle

Rebuilt on demand. The `sessions` fold also sources the composer's current access mode and agent
preset from the *run inputs* carried on `session.turn.started`, not from a separate settings write.

## Failure modes

| Symptom | Cause | Where to look |
|---|---|---|
| A write is visible in the log but not in the UI | The fold does not handle that event type | the projection's `apply` |
| Settings reset when one field changes | Last-write-wins used where merge was intended | `settings.ts` |
| A subagent never shows as complete | The child's events are not correlating | `subagents.ts`, the correlation id |
| Plugins toggle clobbers other plugins | `plugins` treated as whole-value | `settings.ts` |

## Extension points

A new projection is a file in `src/projections/`, an `export const xProjection: Projection`, and a
registration in `src/server.ts`. Keys must be tenant-prefixed. If you change how a fold derives
values, bump its `version` — that is how a fold change becomes visible.

## Source trail

- `src/projections/` — all 11 definitions
- `src/workbench/reducer.ts` — the pure fold behind `workbench`
- `src/workbench/types.ts` — `WORKBENCH_EVENTS`
- `src/cognitive/case.ts` — `CASE_EVENTS`; `src/cognitive/world.ts` — `WORLD_EVENTS`
- `src/agents/agentCognitive.ts` — `COGNITIVE_EVENT_TYPES`
- `src/settings.ts` — `SettingsPatch`, `resolveGeneralSettings`
- `src/projections/settings.ts` — the per-key `plugins` merge
- `src/projections/subagents.ts` — the child-completion correlation contract