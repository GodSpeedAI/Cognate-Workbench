# Workflow: subagent delegation

## Summary

The agent can hand a task to a child agent that runs in the background. It is fire-and-forget:
the parent records only that it *started* a child, and the child's completion is observed from the
child's own events rather than awaited.

## Sequence

1. The model calls the `subagent` tool with `{ description, prompt, run_in_background? }`.
2. `agent.coding` checks the preset (the `subagent` tool is in `standard` and `ptc`, not `minimal`).
3. It invokes `subagent.start`.
4. `subagent.start` starts a **real, separately-correlated `agent.coding` run**, correlated
   `subagent:<parentRunId>:<toolCallId>`.
5. When `subagent.start` returns, `agent.coding` emits `subagent.spawned`. The parent moves on
   immediately.
6. The child runs on its own. Its `message.completed` or `run.failed` events carry the same
   correlation id.
7. The `subagents` projection observes those child events directly and folds them into the child's
   row.
8. On the parent's **next** turn, `session.history` folds the completed child's result into the
   parent's context.

## Why fire-and-forget

There is no parent-side wait. An agent run cannot await a child run, so the parent cannot durably
record when the child finishes. Rather than pretend otherwise, the design moves the observation to
the read side: the `subagents` projection watches the child's own events.

The consequence is a genuine trade. It means:

- The parent does not block, which is the point.
- The parent's *current* turn will not contain the child's result.
- The result arrives as context on the *next* turn.
- The cockpit shows child status by reading the projection, not by the parent saying anything.

## The projection

One row per `subagent` tool call, keyed `${tenant}/${parentRunId}/${toolCallId}`, covering
`status` (`running` / `completed` / `failed`), `startedAt`, and the child's summary.

The UI renders a subagent panel and a sidebar tree; a completed child can be opened from the sidebar.

## What is bound and what is not

Only `subagent.start` is a bound capability. The `subagent` **tool** is not, and the decision to
delegate is not either — both live in `agent.coding`. The rationale is in
[Capability model](../concepts/capability-model.md): model the governed act, not the agent's choice.

This app implements its own `subagent.start` rather than reusing the packaged
`@godspeedai/cognate-profile-harness` one; `src/capabilities/subagentStart.ts` documents why.

## State changes

| Where | What |
|---|---|
| Event log | `subagent.spawned` from the parent; the child's own turn, tool and message events |
| `subagents` projection | the child's row, status observed from the child's events |
| `sessions` projection | the parent's next turn includes the folded child result via `session.history` |

## Failure branches

| Branch | Behaviour |
|---|---|
| The child fails | `run.failed` with the child's correlation id; the row shows `failed` |
| The parent never turns again | The child still completes; the panel reflects it |
| A child result arrives after the parent's next turn | It is folded into that turn's history; history is read at turn start |

## Sequence diagram

```mermaid
sequenceDiagram
    participant M as model
    participant P as parent agent.coding
    participant CAP as subagent.start
    participant C as child agent.coding
    participant PRJ as subagents projection
    participant UI

    M-->>P: tool call subagent({ description, prompt })
    P->>CAP: invoke subagent.start
    CAP->>C: startRun(correlated subagent:<parentRunId>:<toolCallId>)
    CAP-->>P: returns
    P->>PRJ: emit subagent.spawned
    PRJ-->>UI: row { status: "running" }
    Note over P: the parent continues; it does not wait
    C->>C: does the work
    C->>PRJ: message.completed (child correlation id)
    PRJ-->>UI: row { status: "completed", summary }
    Note over P: on the parent's NEXT turn
    P->>CAP: session.history (folds the completed child result in)
```

## Source trail

- `src/capabilities/subagentStart.ts` — `subagentComponent`, the correlation id, and why the
  packaged profile capability is not reused
- `src/agents/agentCoding.ts` — the `subagent` tool definition, the `PRESET_TOOLS` entry, and the
  `subagent.spawned` emit
- `src/projections/subagents.ts` — the row shape, the observed-from-child-events contract
- `src/capabilities/sessionHistory.ts` — folding the child result into the parent's next turn
- `.sea/interaction/interaction-model.sea` — `Entity "Subagent"`
- `.sea/interaction/canonical-journey-catalog.md` — journey `j_f_delegation`
- `test/J-F-delegation.test.ts`