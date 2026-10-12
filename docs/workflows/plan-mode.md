# Workflow: plan mode

## Summary

Plan mode lets the agent propose a multi-step plan before it acts, keep a visible to-do list, and
require human approval before leaving the mode. All plan state is session state folded from four
event types — there is no separate plan object.

## Sequence

1. `agent.coding` invokes `plan.state` at the start of every turn, before reading history.
2. Two pure control commands, handled without a model round trip:
   - **`/plan off`** — if plan mode is on, emit `plan.mode.changed { on: false }`, emit
     `message.completed` with "Plan mode off.", and return. No model call happens.
   - **A leading `/plan ` prefix** — if plan mode is not already on, emit
     `plan.mode.changed { on: true }` and continue. The prefix is a composer affordance: the text
     sent to the model is unchanged.
3. With plan mode on, the agent may call `todo_write`, which emits `plan.todos.updated`.
4. To propose leaving the mode, the agent calls `exit_plan_mode` with markdown. The agent extracts a
   heading, emits `plan.review.requested { sessionId, toolCallId, heading, markdown }`, and opens a
   `plan-review` continuation.
5. The UI renders a review card from `plan.review.requested`. `Enter` approves, `Escape` requests
   changes — the same keyboard contract as the approval card.
6. On approval the agent emits `plan.review.decided { status: "approved" }`, emits
   `plan.mode.changed { on: false }`, and continues acting. On requested changes it emits
   `status: "changes_requested"` and stays in the mode.
7. Calling `exit_plan_mode` while not in plan mode returns
   `EXIT_PLAN_MODE_NOT_IN_PLAN_MODE` as a tool result.

## Why it is events, not an artifact

The legacy design notes considered modelling a plan as a durable artifact with its own lifecycle and
argued against it. The reasoning holds: a plan here is *session state* — on or off, a to-do list, and
at most one pending review — which the UI reads exactly as it reads any other projection. Its
markdown lives in a single event payload (`plan.review.requested`). Introducing a second persistence
mechanism for that would add a place for the two to disagree.

## State

```ts
interface PlanState {
  sessionId: string;
  on: boolean;
  todos: readonly TodoItem[];     // { content, status }
  review?: PlanReview;            // { status: "pending" | "approved" | "changes_requested",
}                                 //   toolCallId, heading, markdown }
}
```

Folded by the `plans` projection, keyed `${tenant}/${sessionId}`.

Two readers:

- `plan.state` — a read-side capability that `agent.coding` calls at the top of each turn. That is
  why the gate is checked against the agent's own view, not only the UI's.
- The UI — the to-dos widget, the plan review card, and the sidebar's "Plan awaiting review
  `<title>`" prefix.

## Events

| Event | Emitted when |
|---|---|
| `plan.mode.changed` | `/plan off`, or a leading `/plan ` prefix |
| `plan.todos.updated` | the agent calls `todo_write` |
| `plan.review.requested` | the agent calls `exit_plan_mode` |
| `plan.review.decided` | the operator approves or requests changes |

## Failure branches

| Branch | Behaviour |
|---|---|
| `exit_plan_mode` outside plan mode | `EXIT_PLAN_MODE_NOT_IN_PLAN_MODE` as a tool result |
| Review pending across a reload | The card is still there; the continuation is durable |
| Two reviews pending | The plan carries one pending review; a new request replaces it in the fold |

## Sequence diagram

```mermaid
sequenceDiagram
    participant OP as operator
    participant UI
    participant AG as agent.coding
    participant RT as runtime
    participant MD as model
    participant PRJ as plans projection

    AG->>RT: invoke plan.state
    RT->>PRJ: read ${tenant}/${sessionId}
    PRJ-->>AG: PlanState { on: false, todos: [] }
    OP->>UI: type "/plan add caching"
    Note over UI: the prefix flips mode; the model still receives the original text
    UI->>AG: startRun with the message
    AG->>RT: emit plan.mode.changed { on: true }
    AG->>MD: model.generate (with the planning instructions in effect)
    MD-->>AG: todo_write([...]) then exit_plan_mode(plan)
    AG->>RT: emit plan.todos.updated
    AG->>RT: emit plan.review.requested { heading, markdown }
    AG->>RT: ctx.waitFor("plan-review:...")
    RT-->>UI: open continuation
    UI->>OP: render the plan review card
    alt approve (Enter)
        OP->>RT: resolveContinuation(id, "resume", { approved: true })
        RT->>AG: resume
        AG->>RT: emit plan.review.decided { approved }
        AG->>RT: emit plan.mode.changed { on: false }
    else request changes (Escape)
        OP->>RT: resolveContinuation(id, "resume", { approved: false })
        RT->>AG: resume
        AG->>RT: emit plan.review.decided { changes_requested }
        Note over AG: stays in plan mode
    end
```

## Source trail

- `src/agents/agentCoding.ts` — the plan branch at turn start, the `exit_plan_mode` handling, the
  `plan-review` wait
- `src/domain/planGate.ts` — `isPlanOffCommand`, `splitPlanPrefix`, `extractPlanHeading`,
  `EXIT_PLAN_MODE_NOT_IN_PLAN_MODE`, `PLAN_APPROVED_TOOL_RESULT`,
  `planRequestChangesToolResult`
- `src/capabilities/planState.ts` — the read side
- `src/projections/plans.ts` — `PlanState`, `TodoItem`, `PlanReview`, `plansProjection`
- `src/ui/App.tsx` — the to-dos widget, the plan review card, the sidebar prefix
- `.sea/interaction/interaction-model.sea` — `Entity "PlanMode"`
- `.sea/interaction/canonical-journey-catalog.md` — journey `j_e_plan`
- `test/J-E-plan.test.ts`