# Why approval is a continuation

## The claim

When Workbench needs a human decision, it does not pause, prompt, or hold a promise in memory. It
opens a **durable continuation**: a recorded wait inside a run that survives reload, survives a
process restart, and is resolved by an explicit client call.

## What that looks like in code

```ts
// src/agents/agentCoding.ts, inside the tool loop
await ctx.waitFor(`approve:${toolCallId}`, {
  type: "tool-approval",
  condition: { kind: "human_approval" },
  payload: { tool, args, permission, justification },
});
```

And the UI:

```ts
client.resolveContinuation(continuationId, "resume", { approved });
```

The run's status becomes `waiting`. There is no in-memory promise, no socket to hold open, no
timeout that silently proceeds.

## Why this rather than an HTTP request that waits

The obvious implementation is a plain HTTP call that blocks until the operator answers. It fails in
three ways, all of which matter here.

**A page reload loses it.** The operator refreshes, or the browser drops the connection. With a
blocking request, the decision context is gone and the run is stuck in an unrecoverable state.

**A process restart loses it.** The server restarts — for a deploy, a crash, or `just dev` picking up
a code change. A blocked request is gone, and the run was mid-step.

**There is no durable answer.** Even if the operator clicked, the fact that they clicked and what they
clicked would not be in the event log. It would be a socket that happened to still be open.

A continuation fixes all three because the *wait itself* is durable state. The run is `waiting`; that
is a recorded condition, not a suspended thread. The operator's decision is an input to a resumed
computation, and the resulting events land in the same log as everything else.

## Why this rather than an event and a poll

The alternative is to emit "approval requested" and have the run poll the projection until a decision
event appears. That works, and it is worse:

- It burns steps and requires a step budget for something that is not work.
- It makes the run's progress depend on reading its own output, which is exactly the loop the
  rest of the design avoids.
- The distinction between "waiting for a person" and "computing" is lost.

`ctx.waitFor` keeps the distinction explicit in the runtime's model: a run is *running*, *waiting*,
or *done*.

## The consequences

**A pending approval is a first-class, inspectable fact.** The `sessions` and `session-trace`
projections can render it. The transcript can show the tool card and its pending state, because
`tool.call.started` was emitted before the gate ran.

**The approval survives anything the process does.** Reload, restart, crash. `test/J-D-approval.test.ts`
asserts that after a full `stop()` and a fresh `startServer()` against the same store the continuation
is still `OPEN` and the run is still `waiting`, and that resolving it then still completes the run.

**It forces a provider at boot.** A resumed run needs a live `model.generate` before it can finish.
That is why `src/server.ts` remounts the last-configured provider at boot — a dependency the blocking
implementation would never have had.

**The operator can leave.** The run waits indefinitely. Nothing expires it.

**Human-only decisions are separately enforced.** `world.settle` and `method.accept` throw if
`ctx.runId` is set. The run-body check and the continuation mechanism are two different guards doing
two different jobs: one stops an *agent* from escalating, the other lets a *human* interrupt an
agent.

## The two kinds

| Continuation type | Raised by | Resolved with |
|---|---|---|
| `tool-approval` | the tool loop's gates | `{ approved: boolean }` |
| `plan-review` | `exit_plan_mode` | approval or requested changes |

They are two types rather than one generic "approval" because their payload and outcome shapes
differ: a permission to allow or deny versus a plan heading and markdown to review. That decision is
recorded in the legacy design notes and holds.

## What it does not buy

The wait is durable, but the *decision* is still a single boolean or a single choice. There is no
rich approval payload, no partial authorisation, no "allow this once and remember the pattern". If
that is needed, it is a change to the continuation's condition and payload shape, not to the
mechanism.

## Confidence

The mechanism is **verified** from `src/agents/agentCoding.ts`, `src/domain/planGate.ts`, and
`src/ui/App.tsx`.

The restart-durability behaviour is **verified** by `test/J-D-approval.test.ts`.

The *comparison* with a blocking HTTP request is **my inference**. The repository records the
mechanism and the durability contract; it does not record the rejected alternatives.

One recovered detail worth flagging: the reference product this app was reconstructed from did *not*
survive a restart with a pending approval — it silently finalised the turn. Reproducing that would
have meant treating durable history as something to paper over. That divergence is deliberate and is
recorded in [Restart and recovery](../workflows/restart-and-recovery.md).

## Source trail

- `src/agents/agentCoding.ts` — the `ctx.waitFor("approve:…")` call and the plan-review wait
- `src/domain/approvalGate.ts` — what triggers the wait
- `src/domain/planGate.ts` — the plan-review shape and its distinct outcome
- `src/ui/App.tsx` — `useContinuations`, `client.resolveContinuation`, the card, `Enter` / `Escape`
- `src/server.ts` — the boot provider remount that a resumed run depends on
- `test/J-D-approval.test.ts` — allow, deny, restart-while-pending, replay safety