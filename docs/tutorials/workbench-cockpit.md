# Tutorial: driving a task through the cockpit

The conversational loop lets you *ask* an agent to do something. The cockpit lets you *declare* what
it may do and *decide* whether it did. This tutorial walks a task from creation to acceptance.

## Before you start

- A running server and a configured provider ([Tutorial: first run](first-run.md)).
- A selected workspace with some real content. The fixture workspace in `fixtures/workspace/template/`
  is a good low-stakes target.

## The idea

A task carries a **contract**: what it should produce, what it may touch, who or what executes it,
what must remain true, and how you will know it worked. The agent then works inside that contract
instead of a prompt, and the evidence it produces is what review reads.

## Step 1 — create a task

Open the workbench cockpit and create a task.

Give it a name and a workspace. At this point its contract is empty, and the cockpit shows one chip
per contract field with the unsatisfied ones marked:

| Field | Satisfied when |
|---|---|
| context | a workspace is bound |
| goal | a non-blank outcome |
| skills | at least one |
| authority | defined |
| executors | at least one |
| budget | defined |
| invariants | at least one |
| acceptance | at least one |

**Verify:** the chips reflect exactly what is missing. This is `contractMissing()` in
`src/workbench/contract.ts`, and it is the same function the capability uses to refuse an
unsatisfiable change.

## Step 2 — write the goal and the non-goals

Fill in the outcome, and — this is the part people skip — the non-goals.

```
goal.outcome      Add a greeting helper with a unit test.
goal.deliverable  src/greet.ts and test/greet.test.ts
goal.nonGoals     Do not change the package name. Do not add dependencies.
```

Non-goals matter because they are the cheapest place to record intent that a review can later check
the agent against.

## Step 3 — scope the authority

This is the field that decides what the agent may touch. Each axis is `yes`, `approval`, or `no`.

```
filesystem.read              yes
filesystem.write             approval
filesystem.outsideWorkspace  no
shell.run                    yes
shell.destructive            approval
network                      no
```

Start narrower than you think you need. You can widen it deliberately later, and the widening is
recorded.

**Verify:** with `filesystem.write: approval`, an edit produces an approval gate rather than
happening silently. See [Authority and approval](../concepts/authority-and-approval.md).

You can also mark paths as **protected evidence**, which is enforced structurally in `tool.edit` and
`tool.bash` before the tool runs.

## Step 4 — bind executors and a budget

An executor pairs a role with something that does the work:

```
primary   → model:<your-model>       (llm)
verifier  → tool:bun-test             (deterministic)
```

Set a budget: a maximum token count, a maximum cost, a maximum duration, or a concurrency limit.

**Verify what the budget does not do:** it is informational. Nothing enforces it at runtime. That is a
recorded gap, listed in [Known gaps](../known-gaps.md). Use it to observe, not to constrain.

## Step 5 — state invariants and acceptance criteria

An **invariant** is a statement that must remain true:

```
INV-1  domain:   Every greeting is exactly one sentence.
INV-2  design:   No new dependencies.
```

An **acceptance criterion** is a named, checkable condition with a kind:

```
AC-1  test              bun test exits 0                    required
AC-2  journey           The greet import works from src/   required
AC-3  human             Output reviewed and accepted       required
```

The `kind` says *how* it gets closed, not just whether. A `test` criterion closes on a passing check;
a `human` criterion closes on a person.

## Step 6 — seed the capability catalog

If the cockpit's capability list is empty, seed it (`workbench.seed`). The catalog holds named
capabilities with implementation bindings, and each moves through its lifecycle one step at a time.
`skill.lifecycle.advance` refuses to skip a step, and `skill.bind` checks substitution compatibility
and conflicts rather than overwriting.

**Verify:** the cockpit's capability list shows the seeded entries and their states.

## Step 7 — run it

Move the task to `RUNNING`. Now send it work in the session, or let the task's executors drive.

**Expected:** every tool call goes through the same gates as before, plus the task's authority
scopes. A write outside the granted scopes is refused; a write inside them but gated as `approval`
asks you.

## Step 8 — watch the evidence and the ledger

As the work proceeds:

- **Usage** attributes calls to executors (model, tool, verification, retry).
- **Evidence** accumulates against your acceptance criteria, each with a kind and a status.
- The **ledger** groups acceptance criteria into `closed`, `failed` and `open`.
- The **done ladder** shows where the work currently sits: `finished`, `produced`, `tested`, …

**Verify:** the ledger shows your required criteria still `open`. Review is not yet available. That is
`reviewReadiness` doing its job, not a broken button.

## Step 9 — record evidence against a criterion

Use the ledger panel to record an entry against `AC-1` with a pass and the command you ran.

**Verify:** `AC-1` moves to `closed`. The cockpit renders acceptance criteria and evidence in one
table, because the question they answer is one question: *what must stay true, and what is proven?*

## Step 10 — request review, then accept

With the required criteria closed, review becomes available. Request it, then decide.

**Verify the human-only rule.** If you try to drive the decision from an agent context, it is
refused: `task.review.decide` requires a `user` actor, and an agent run invokes capabilities as a
non-user principal. The cockpit's accept and request-changes actions come from your operator
session.

Requesting changes sends the task to `REWORK` and records the worker return. Accepting advances the
done level to `accepted`.

## Step 11 — compound the result

`accepted` is not the end. `operationalized` means the result became something reusable: a seeded
capability, a skill, an automation.

If you want the workflow to repeat, define one (nodes with `needs` and `after` edges), then create an
automation from it: the accepted workflow plus input binding, a schedule, an execution substrate, and
an outcome gate.

**Verify what does not happen:** nothing fires the automation on a schedule. The state machine
exists and advances; no scheduler runs it. Recorded in [Known gaps](../known-gaps.md).

## What you have learned

- Work is shaped by a contract before it runs.
- Authority is declared, not requested.
- Acceptance is a human decision against recorded evidence.
- "Done" is a taxonomy, not a single event.
- Some of the surrounding machinery is recorded intent, not wired execution.

## Where to go next

- [Task contract and review](../workflows/task-contract-and-review.md) — the full mechanism.
- [Domain types](../reference/domain-types.md) — every field.
- [UI surfaces](../reference/ui-surfaces.md) — which component shows what.
- [How to add a workbench capability](../how-to/add-a-capability.md) — extend this yourself.