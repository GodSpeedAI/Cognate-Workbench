# Subsystem: observations and RealityTrace

## Purpose

Add a per-step *evidence* layer on top of the execution trace the app already owns, without making
the app depend on an external tool.

## Responsibilities

- Decide which events are worth observing.
- Commit an observation intent atomically with the event it describes.
- Deliver observations to the pinned RealityTrace CLI at least once, in the background.
- Expose honest delivery status to the UI.

## Non-responsibilities

It is not the execution trace. The authoritative trace is the `session-trace` projection over the
event log. RealityTrace is enrichment. It also does not fail the app: an unreachable CLI degrades to
queued.

## Internal operation

### The outbox hook

`observationOutboxFor` is the runtime's generic `outboxFor` hook. It receives the pending event and
returns intents that the runtime commits **in the same decision as the event itself**. The runtime has
no dependency on RealityTrace; only this adapter's implementation does. That ordering is the whole
design: an observation can never claim something the event log does not record.

### Which events

```ts
tool.call.started · tool.call.completed · tool.call.failed
message.completed · run.failed
verification.observed
world.baseline.frozen · world.candidate.frozen · world.candidate.rejected · world.settled
sentinel.finding · experiment.round.completed · method.recommended · method.accepted
```

The set is deliberately small: every observation is an SXR ingest subprocess, and this family is
what the inspector actually enriches. Cognitive-navigation events that affect settlement ride the
same outbox rather than introducing a second evidence system.

Each intent is classified `durable_fact` and tagged with the capability it concerns (`tool.<name>`
for tool events; omitted for turn-level events).

### Delivery

`ObservationDelivery` drains at-least-once in the background with backoff (base 250 ms, max 4 s, 5
attempts), then poisons the entry for reconciliation. A drain cycle is skipped when the durable
RealityTrace plugin gate is off — which means nothing is lost, because enabling it drains the
backlog.

### Binaries

`defaultSxrBin()` prefers `SXR_BIN` when it points at an existing file, otherwise the pinned local
binary at `.tmp/realitytrace/bin/realitytrace`. Absent, it returns `undefined` and the boot logs a
warning. See [Install RealityTrace](../how-to/install-realitytrace.md).

### Read side

Two client-invoked capabilities, deliberately *unrecorded*:

- `observation.status` — per-event delivery state (observation id, state, target reference, attempts)
- `observation.record` — the correlation payload for one delivered observation

They are unrecorded because their receipts live in the DurableStore `observations` collection, not
in the event log. Putting them in a projection would be claiming they are domain facts when they are
diagnostics of an external system.

The read-side component is mounted **unconditionally**. With no CLI configured the inspector shows
honest queued states rather than erroring.

## State

| State | Where |
|---|---|
| Intents | DurableStore outbox, committed with the event |
| Receipts | DurableStore `observations` collection |
| Delivery loop | In memory, per process |
| Plugin enable gate | `settings.changed` → `plugins` fold, read per drain cycle |

## Failure modes

| Symptom | Cause | Meaning |
|---|---|---|
| Observations permanently queued | No SXR binary, or the plugin is disabled | Expected. Enabling the plugin drains the backlog |
| A delivery poisoned after 5 attempts | The CLI rejected or was unavailable | Reconcile manually; the event itself is unaffected |
| "No target configured" in the inspector | CLI absent | Not an error state; it is queued |

## Why the read side is not a projection

Because a receipt is a fact about an external system's ingestion, not a fact about this domain. The
same reasoning left `onboarding.dismiss` unbound to a semantic entity: inventing an entity for a
UI-flow flag would misstate the domain. See
[Capability model](../concepts/capability-model.md).

## Source trail

- `src/observations.ts` — `OBSERVED_EVENT_TYPES`, `capabilityIdOf`, `observationOutboxFor`,
  `defaultSxrBin`, `wireObservations`, `ObservationWiring`
- `src/server.ts` — the warning string, the unconditional read-side mount, `stop()`
- `src/projections/settings.ts` — the `plugins` gate fold
- `package.json` — `@godspeedai/cognate-realitytrace`
- `justfile` — `setup-realitytrace`
- `test/J-RT-realitytrace.test.ts`, `test/J-COG-realitytrace.test.ts`