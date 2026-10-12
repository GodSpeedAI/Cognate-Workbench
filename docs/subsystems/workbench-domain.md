# Subsystem: workbench domain

## Purpose

Make agent work shapeable. The pure modules here decide what a task may touch, what counts as proof,
when work is done, and what a workflow still waits on. Nothing here performs I/O.

## Responsibilities

Sixteen modules, all deterministic, owning:

| Concern | Module |
|---|---|
| Contract completeness and chips | `contract.ts` |
| Authority decisions and protected evidence | `authority.ts` |
| Acceptance rows, review readiness, done levels | `ledger.ts` |
| Task and workflow record shapes | `state.ts`, `types.ts` |
| Workflow graph scheduling (`needs` / `after`) | `workflow.ts` |
| Capability catalog, bindings, lifecycle, conflicts | `skillOs.ts` |
| Two-queue steering semantics | `steering.ts` |
| Automation schedule and lifecycle | `automation.ts` |
| Usage, cost, budget state | `economics.ts` |
| Parallel work planning | `parallelism.ts` |
| Grounded feedback validation | `grounded.ts` |
| Focus and attention precedence | `focus.ts` |
| Glob matching for protection patterns | `glob.ts` |
| Shell command classification | `shellSafety.ts` |
| The `workbench.*` fold | `reducer.ts` |

## Non-responsibilities

No I/O, no clock reads, no randomness, no imports from `capabilities`, `agents`, `projections`, or
`ui`. `types.ts` imports nothing at all. That is what makes the 14 `test/workbench-*.test.ts` files
run without a runtime or a database.

## Position in the system

```
src/workbench/*  (pure)
   ▲                    ▲
   │ validates          │ folds
src/capabilities/workbench.ts   src/workbench/reducer.ts → src/projections/workbench.ts → UI
```

## Core abstractions

`TaskContract` is the spine: `context`, `goal`, `skills`, `authority`, `executors`, `budget`,
`invariants`, `acceptance`. `CONTRACT_FIELDS` names the eight fields, and `contractMissing()`
reports which are unsatisfied so the cockpit can render chips.

`AuthorityScopes` is a three-axis record — `filesystem` (read, write, outsideWorkspace), `shell`
(run, destructive), `network` — where each value is a `Grant` of `yes`, `approval`, or `no`.

`DoneLevel` is the seven-value taxonomy: `not-started`, `finished`, `produced`, `tested`,
`ready-for-review`, `accepted`, `operationalized`. `TaskStatus` is the board: `BACKLOG`,
`BRIEFING`, `READY`, `RUNNING`, `BLOCKED`, `READY_FOR_REVIEW`, `REWORK`, `ACCEPTED`,
`OPERATIONALIZED`.

Full type reference: [Domain types](../reference/domain-types.md).

## Internal operation

### Authority

`decideWrite` and `decideShell` take a grant plus a concrete operation and return
`{ outcome, rule, reason, pattern?, path? }`. Outcomes are ordered
`allow < approval < deny` and the strictest wins across every rule consulted, so adding a rule can
only ever tighten. Path matching uses `glob.ts`; command analysis uses `shellSafety.ts`.

`normalizeRelative` returns `{ path, escapes }` so a path leaving the workspace is distinguishable
from one that merely matched nothing.

### Ledger

`ledgerRows` groups acceptance criteria by state (`closed` / `failed` / `open`);
`acceptanceReady` and `reviewReadiness` compute whether a task can be sent to review;
`doneLevel` derives the taxonomy value; `groupLedger` produces the cockpit's grouped table.

### Workflow

Edges carry a mode: `needs` (must pass) and `after` (must settle). `readyNodes` computes the
currently available nodes from the graph and current statuses; `nextTransitions` returns the legal
moves with their evidence requirements and guards.

### Skill OS

`CAPABILITY_LIFECYCLE` is an ordered list; `nextLifecycle` and `advanceLifecycle` permit only the
immediate next step. `checkSubstitution` and `detectConflicts` reason about binding a capability to
an implementation without violating authority or uniqueness.

## State

None. These modules are pure. All resulting state is produced by folding `workbench.*` events
through `reducer.ts` into the `workbench` projection.

## Lifecycle

Per request. Called from capability handlers (validation) and from `reducer.ts` (folding) and from
cockpit components (rendering chips, grouping rows).

## Failure modes

| Symptom | Cause | Where |
|---|---|---|
| A write is refused citing a field | `contractMissing` found an unsatisfied field | `contract.ts` |
| A protected path blocks an edit that "should" work | Protection pattern matched | `authority.ts`, `glob.ts` |
| A workflow node will not advance | Missing evidence, or an unmet `needs` edge | `workflow.ts` |
| A capability cannot be advanced two steps | `advanceLifecycle` allows only the immediate next | `skillOs.ts` |
| A destructive command is not flagged | `shellSafety.ts` classifies the `rm -r` family plus SQL and device-redirect fallbacks; other commands are *not* classified, and unknown is treated as needing authority by the surrounding gate, not as safe | `shellSafety.ts`, `cognitive/sentinel.ts` |

## Extension points

New workbench behaviour follows a fixed order:

1. A pure function or types in the right module.
2. An event type in `WORKBENCH_EVENTS` and a row in `reducer.ts`.
3. A capability id in `WORKBENCH_CAPABILITY_IDS` and a handler that validates with the pure module.
4. A cockpit surface in `src/ui/workbench/` obeying `src/ui/workbench/UX.md`.
5. A unit test in `test/workbench-*.test.ts` and a journey test in `test/J-WB-*.test.ts`.

Human-only decisions (`task.review.decide`, `authority.elevate`) must check the actor is a `user`.

## Source trail

- `src/workbench/types.ts` — the shared vocabulary; every domain module imports from here
- `src/workbench/authority.ts` — `decideWrite`, `decideShell`, `normalizeRelative`, `Decision`
- `src/workbench/contract.ts` — `contractMissing`, `contractChips`, `CONTRACT_FIELDS`
- `src/workbench/ledger.ts` — `ledgerRows`, `groupLedger`, `openRequired`, `reviewReadiness`,
  `acceptanceReady`, `doneLevel`
- `src/workbench/workflow.ts` — `validateWorkflow`, `readyNodes`, `nextTransitions`, `workflowView`,
  `nodeDone`, `documentWorkflow`
- `src/workbench/skillOs.ts` — `seedCatalog`, `seedBindings`, `advanceLifecycle`, `checkSubstitution`,
  `detectConflicts`
- `src/workbench/automation.ts` — `newAutomation`, `advance`, `nextFire`, `deliveryReceipt`
- `src/workbench/economics.ts` — `rollupUsage`, `budgetState`, `provenanceLine`
- `src/workbench/steering.ts` — `enqueue`, `emptyInbox`
- `src/workbench/reducer.ts` — the `workbench.*` fold
- `src/workbench/shellSafety.ts`, `src/workbench/glob.ts`, `src/workbench/grounded.ts`,
  `src/workbench/parallelism.ts`, `src/workbench/focus.ts`, `src/workbench/state.ts`
- `test/workbench-*.test.ts` (14 files), `test/J-WB-*.test.ts` (8 files)