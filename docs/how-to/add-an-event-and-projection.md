# How-to: add an event and a projection

## Goal

Record a new fact and expose it in a read model.

## Prerequisites

Read [Projections](../subsystems/projections.md) first, so the two fold styles are familiar.

## Procedure

### 1. Define the event

Emit it from wherever it genuinely happens — normally an `agent.config` run, sometimes an agent
directly, as `tool.call.started` is.

```ts
await ctx.emit("widget.renamed", { widgetId, title } as unknown as Json);
```

Naming:

- namespace by subsystem (`session.*`, `tool.call.*`, `plan.*`, `workspace.*`,
  `workbench.*`, `cognitive.*`),
- past tense for facts (`message.completed`, `workspace.renamed`),
- put the subject first, not the verb (`tool.call.started`, not `startedToolCall`).

Follow the existing examples: `tool.call.started` / `completed` / `failed`,
`plan.mode.changed`, `plan.todos.updated`.

### 2. Register it where the namespace lives

| Namespace | Constant |
|---|---|
| `workbench.*` | `WORKBENCH_EVENTS` in `src/workbench/types.ts` |
| `case.*`, `criterion.*`, `verification.*`, `experiment.*`, `method.*` | `CASE_EVENTS` in `src/cognitive/case.ts` |
| `world.*` | `WORLD_EVENTS` in `src/cognitive/world.ts` |
| cognitive generally | `COGNITIVE_EVENT_TYPES` in `src/agents/agentCognitive.ts` |
| everything else | a literal in the emitting code, plus a check in the observing projection |

For the `workbench.*` namespace, add a branch in `src/workbench/reducer.ts` as well.

### 3. Write the fold

Add a branch to the projection:

```ts
export const widgetsProjection: Projection = {
  name: "widgets",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "widget.renamed") return [];
    return [{ key: `${event.tenant}/${payload.widgetId}`, value: { title: payload.title } }];
  },
};
```

Rules:

- **Tenant-prefix every key.** The UI reads through `ReadProjection`, which strips the prefix.
- **Choose a fold style deliberately.** Last-write-wins, or merge — and if you merge, decide
  whether a nested map merges per key or wholesale. `settings.ts` is the example of each: fields are
  last-write-wins, the `plugins` map merges per key.
- **Absence is meaningful.** No row means "not configured" and is what drives UI defaults.
- **Bump `version`** when you change how values are derived.

### 4. Register the projection

Add it to the projections passed to `createRuntime` in `src/server.ts`.

### 5. Read it

In the UI:

```ts
const rows = useProjection("widgets", { tenant });
```

In a capability: `runtime.service.readProjection(caller, { name: "widgets" })`.

### 6. Test it

- Fold behaviour → a unit test that applies a sequence of events and asserts the resulting rows.
- End to end → a journey test that performs the action and waits on the durable row.

## Decide the fold style before writing

| Situation | Style |
|---|---|
| The event carries the whole row | last-write-wins (`model-config`, `onboarding`) |
| The event carries part of the row | merge into the prior row (`settings`) |
| A nested map is partial | merge **per key** (`settings.plugins`) |
| The row only signals that something changed | a single `latest` row (`cognitive`) |
| The value is computed from *another* run's events | observe those directly (`subagents`) |

Choosing last-write-wins for a partial event silently drops every field the event did not mention.
That is the bug this table exists to prevent.

## Validation

```bash
just typecheck
bun test test/<your-fold-test>.ts
just test
```

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| Event is in the log; UI never changes | The projection does not branch on that type | Step 3 |
| A field resets when another field changes | Last-write-wins on a partial event | Switch to merge |
| One plugin's toggle clobbers the others | Nested map merged wholesale | Merge per key |
| UI shows tenant-prefixed keys | Reading the raw store instead of `ReadProjection` | Use the hook |
| A resumed run behaves differently | The event was emitted from a handler rather than a run | Route it through `agent.config` |

## Source trail

- `src/projections/settings.ts` — merging, and the per-key `plugins` merge
- `src/projections/modelConfig.ts`, `onboarding.ts` — last-write-wins
- `src/projections/cognitive.ts` — the change-signal pattern
- `src/projections/subagents.ts` — observing another run's events
- `src/projections/workbench.ts` — delegating to the reducer
- `src/workbench/types.ts` — `WORKBENCH_EVENTS`; `src/workbench/reducer.ts` — the fold
- `src/cognitive/case.ts`, `world.ts`, `src/agents/agentCognitive.ts` — the cognitive namespaces
- `src/server.ts` — projection registration