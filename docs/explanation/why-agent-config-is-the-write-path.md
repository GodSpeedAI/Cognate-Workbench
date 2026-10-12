# Why `agent.config` is the write path

## The unusual thing

Almost every mutation in this application follows the same shape, and the shape is not the obvious
one:

```
capability handler
  ├─ read a projection, validate
  ├─ perform the effect
  └─ service.startRun({ agent: "agent.config", input: { kind: "…" } })
        └─ agent.config emits the domain event
              └─ a projection folds it
```

There is no direct "append an event" API in the capability layer. Writing durable state means
starting a run, and the run is what emits.

## Why

`agent.config` exists to be the only writer of domain events, and it is deliberately the dullest
possible run body. Its header states the whole design:

> deterministic. All side effects (secret write, provider hot-swap, path validation) happen in the
> `model.configure` / `workspace.select` capability handlers *before* this run is started … The run
> body only emits — no I/O, no randomness, replay-safe by construction.

So the property the design is buying is: **the thing that records a fact cannot also change the
world.** Effects are separated from recording by a process boundary — the handler does them, the run
only writes them down. That is the same discipline as the rest of the system, applied one level down:
[the event log is authoritative](why-event-sourcing.md), and the append path has no side effects
either.

`AgentConfigInput` is a closed union of exactly what may be recorded: `model.configured`,
`workspace.added`, `workspace.selected`, `workspace.renamed`, `workspace.deleted`,
`execution.world.connected`, `execution.world.disconnected`, `onboarding.dismissed`,
`workbench.recorded` (a batch), and `settings.changed` with a `SettingsPatch`. A handler that wants
to record something new must extend the union — which means the set of recordable facts is one
type, greppable, rather than scattered string literals.

## The costs, stated plainly

This is where the design shows its strain, and the legacy design notes record it directly.

**Read-after-write lag.** A capability validates, starts a run, and returns. The run emits; the
projection folds. A read immediately after the write can see the previous state. The UI shows the
capability's own refusal text where that matters, and tests wait on durable rows rather than
sleeping.

**Serial execution.** The runtime executes runs serially. An event recorded through a *new* run
during an *active* run waits behind it. This is a real constraint, and it is why two things are
shaped the way they are:

- **Steering does not use the write path for "steer now".** A live steer is a caller write into the
  active run's shared state, delivered at the run's next step boundary. "Queue next" is a normal
  `workbench.*` write that lands on the following turn.
- **Cognitive fact recording goes through `agent.cognitive`,** which the same serial constraint
  shapes.

**The framework gap is named, not hidden.** The legacy notes list, as a gap to propose upstream, "a
way to record application events from a capability without starting a run", and observe that using
`agent.config` as the write path "puts every write behind the serial executor and forced the
shared-state design for steering." That is the right posture: the cost is written down where the next
maintainer will find it, rather than discovered.

## The alternative, and why it was not taken

The obvious alternative is a capability-context method that appends directly. That would remove the
lag and the serial constraint.

It was not taken, and the reasoning is inferable rather than stated: a direct append makes the
recording path capable of side effects, which collapses the separation that makes replay safety and
auditability straightforward. It also means "who recorded this event" is no longer uniformly "a run",
and correlating an event to the decision that caused it gets harder.

The trade is deliberate: **a slower, uniform, replayable write path in exchange for a recording path
that cannot have effects.** Whether that trade is still right depends on write volume, and this app's
write volume is low.

## What this means when you add a capability

1. Do the effect in the handler, before starting the run.
2. Start an `agent.config` run with the appropriate `AgentConfigInput` variant.
3. Do not record anything else. In particular, do not emit from the handler.
4. If you need a new recordable fact, extend `AgentConfigInput` first.
5. In tests, wait on the durable row. Do not sleep.

## Confidence

The mechanism and the stated rationale are **verified** from `src/agents/agentConfig.ts` and
`src/server.ts` comments. The serial-execution constraint, the read-after-write lag, and the steering
consequence are **verified** from the workbench design notes and visible in `src/workbench/steering.ts`.

The comparison with a direct-append alternative is **my inference**. The repository records the gap
and the cost; it does not record a rejected alternative.

## Source trail

- `src/agents/agentConfig.ts` — `AGENT_CONFIG`, `AgentConfigInput`, the header rationale
- `src/capabilities/workbench.ts` — `workbench.recorded`; the handler-then-run shape
- `src/capabilities/modelConfigure.ts`, `workspaceSelect.ts`, `workspaceManage.ts`,
  `settingsChange.ts` — the same shape across families
- `src/server.ts` — the comment recording that side effects happen before the run starts
- `src/workbench/steering.ts` — the shared-state response to serial execution
- `src/capabilities/cognitive.ts` — `agent.cognitive` as the cognitive write path
- `.tmp/reconstruction/WORKBENCH-DEVIATIONS.md` — "Design decisions worth knowing" (recovered; see
  [Evolution and provenance](evolution-and-provenance.md))