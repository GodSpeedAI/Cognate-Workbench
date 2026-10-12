# How-to: add a capability

## Goal

Add a new governed action that the agent or the UI can invoke.

## Decide first whether it should be a capability

Make it a capability if it:

- has an effect outside the process, or
- writes durable state, or
- answers a question the UI or the agent needs, or
- must be gated, refused, or audited.

Do **not** make it a capability if it is a pure function. Pure logic belongs in `src/workbench/`,
`src/cognitive/`, or `src/domain/`, where it can be unit-tested without a runtime.

## Prerequisites

A working `just dev`, and read
[Authority and approval](../concepts/authority-and-approval.md) so you know which gate your operation
belongs behind.

## Procedure

### 1. Add the pure logic, if there is any

In the right island module. No I/O, no clock, no randomness. Export a decision type that names the
outcome and the reason, following the existing shape:

```ts
export interface Decision {
  readonly outcome: "allow" | "approval" | "deny";
  readonly rule: string;
  readonly reason: string;
}
```

Returning a *reason* is not optional style — it is what the model and the operator both read.

### 2. Add an event type

In the relevant event namespace:

- workbench → `WORKBENCH_EVENTS` in `src/workbench/types.ts`, plus a branch in
  `src/workbench/reducer.ts`
- cognitive → `CASE_EVENTS` or `WORLD_EVENTS`, plus a fold in `case.ts` or `world.ts`
- everything else → a new literal, plus the projection that folds it

### 3. Extend the recordable set

If the capability writes state, its record shape must exist in `AgentConfigInput` in
`src/agents/agentConfig.ts`. That union is the closed set of facts this application can record. Do
not record anything else, and do not emit from a handler.

### 4. Write the handler

In `src/capabilities/`, following the shape every existing handler uses:

```ts
async (input, ctx) => {
  // 1. read the live projection
  // 2. validate — on failure, throw with a specific reason; nothing is written
  // 3. perform the effect
  // 4. record through a run
  await service.startRun(SYSTEM_CALLER, { agent: "agent.config", input: { kind: "…" } });
  return result;
}
```

Non-negotiables:

- validate before you act,
- never keep state between invocations,
- record through a run, never by emitting,
- refuse rather than silently no-op.

If a human must be involved, check the actor first:

```ts
if (ctx.actor.kind !== "user") throw new Error("<cap>: <decision> is a human act");
```

### 5. Bind it to a semantic id

In `domain/index.ts`, add to the relevant tranche's bindings and **update that tranche's count
assertion**. The assertion is what stops a binding from disappearing silently.

If the concept does not exist in `.sea/interaction/interaction-model.sea`, add it there first, or
record consciously that you are leaving it unbound. `AGENTS.md` requires preserving semantic ids
unless performing an explicit data migration.

### 6. Grant it

Add the id to `GRANTED_CAPABILITIES` in `src/server.ts` if the client invokes it directly. A
capability invoked only server-side needs no grant.

### 7. Mount it

Add the component to the mount sequence in `src/server.ts`.

### 8. Test it

- Pure logic → `test/workbench-<name>.test.ts` or `test/cognitive-<name>.test.ts`.
- The capability → a journey test named after its journey id, e.g. `test/J-<AREA>-<name>.test.ts`.
- A UI surface → `test/ui-<name>.test.tsx`, asserting the visible words, roles and aria attributes
  that carry meaning, using `renderToStaticMarkup`.

Follow `test/wb-helpers.ts`: boot a real server, wait on durable rows, never on sleeps.

### 9. Document it

Add the id to [Capability catalog](../reference/capability-catalog.md), the event to
[Event catalog](../reference/event-catalog.md), and any fold to
[Projection catalog](../reference/projection-catalog.md). Update
[Source map](../source-map.md).

## Validation

```bash
just typecheck
just smoke
bun test test/<your-test-file>.ts
just test
```

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| Boot throws naming a tranche count | You added a capability without updating the assertion | Update the count |
| Capability resolves but the UI 404s / errors | Not mounted, or not granted | Steps 6 and 7 |
| The event is in the log but not in the UI | The fold does not handle it | Step 2 |
| A read right after a write looks stale | Projection folds asynchronously | Wait on the durable row |
| `unknown tool` when the model calls it | Not in `TOOL_DEFS`, or outside the turn's preset | Add it, or send the `ptc` preset |

## Rollback

Remove the handler, the mount, the grant, the binding and its count, and the event branch. Because
state is events, a capability that already wrote events leaves them behind — which is why adding a
capability that records state is not a cheap experiment.

## Source trail

- `src/capabilities/tools.ts`, `workbench.ts`, `cognitive.ts` — the handler patterns
- `src/agents/agentConfig.ts` — `AgentConfigInput`, the closed recordable set
- `src/workbench/types.ts` — `WORKBENCH_EVENTS`; `src/workbench/reducer.ts` — the fold
- `src/cognitive/case.ts`, `world.ts` — the cognitive event sets
- `domain/index.ts` — the bindings and the count assertions
- `src/server.ts` — `GRANTED_CAPABILITIES` and the mount sequence
- `src/agents/agentCoding.ts` — `TOOL_DEFS`, `PRESET_TOOLS`
- `test/wb-helpers.ts`, `test/helpers.ts` — the test harness conventions
- [`../concepts/capability-model.md`](../concepts/capability-model.md) — why the chain exists