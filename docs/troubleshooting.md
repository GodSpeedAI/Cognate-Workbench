# Troubleshooting

Symptom-first. Each entry gives the likely cause, where to look, and what to do.

## Boot and startup

### The server will not start

| Message | Cause | Fix |
|---|---|---|
| A DomainForge parse error | The `.sea` model does not parse | Fix `.sea/interaction/interaction-model.sea`. Boot aborts on purpose rather than mounting a half-built runtime. |
| `expected N bound contracts, got M` | A component's capability list and its tranche count assertion in `domain/index.ts` disagree | Update the assertion — or restore the capability. The assertion exists to make this fail loudly. |
| `EADDRINUSE` | Another instance holds the port | `PORT=4000 just dev`, or stop the other one. |
| Connection refused to PostgreSQL | No `COGNATE_POSTGRES_URL` and no working pg0 | See [Use an existing PostgreSQL](how-to/use-external-postgres.md) |

### `just db-setup` fails

| Message | Cause | Fix |
|---|---|---|
| `no pinned pg0 binary for <platform>-<arch>` | Not Linux x86-64 | Install PostgreSQL yourself and use `COGNATE_POSTGRES_URL` |
| `sha256 mismatch for pg0` | Corrupt or tampered download | Re-run. Investigate before trusting the binary. |

### The server starts but the agent cannot call the model

No provider is configured, or none could be restored. **Settings → Models**, add one. The boot path
remounts the last provider from the `model-config` projection; a fresh home has no such row.

## Workspace

### The composer is disabled

No workspace is selected. That gating is deliberate. Add or select a workspace in the sidebar.

### Tools fail with "no provider" for the execution world

That world id is not registered at boot. Check `createExecutionWorldRegistry([...])` in
`src/server.ts`.

### A remote workspace shows an unreachable banner

The live connection did not survive. The durable `execution-worlds` record holds what is needed to
reconnect; the live session does not. Reconnect. **Nothing silently falls back to running locally** —
that is intentional.

### `execution.world.disconnect` is refused

A workspace still uses that world. Move or remove the workspace first.

## Turns

### The model never responds

Check, in order:

1. Is a provider configured and current?
2. Is the base URL reachable from this machine?
3. Does the transcript show a tool card stuck without a result?

### `Error: unknown tool "run_code"`

The turn's agent preset excludes it. `standard` has no `run_code`; `ptc` does. The failure is
deliberate and fail-closed: the model hallucinated a tool outside its catalog.

### The turn stopped and nothing is happening

The run is `waiting` on a continuation. Look for an approval card or a plan-review card. If none is
visible, check the side panel — a pending continuation survives reload by design.

### The turn failed with a provider error

Errors are classified and retried with backoff. `MODEL_RETRY_BACKOFF_MS` overrides the base delay.
After the retries are exhausted the error is surfaced, not swallowed.

### I pressed Stop and the partial answer disappeared

Cancelled turns retain the partial streamed content and show a "Stopped" status. If content is
missing entirely, the run failed rather than being cancelled — look for an error state.

## Authority and approvals

### The agent was blocked from writing a file

`Error: blocked by authority (<rule>): <reason>`. The refusal is fed back to the model as a tool
result and the turn continues.

If the block is correct: change the task's authority scopes, or narrow the protected pattern.
If you believe it is wrong: check whether the path matches a protected-evidence rule. See
[Authority and approval](concepts/authority-and-approval.md).

### An approval card survived a restart

That is the design, not a bug. Pending approvals are durable. See
[Restart and recovery](workflows/restart-and-recovery.md).

### The agent cannot accept its own work

`task.review.decide`, `authority.elevate`, `world.settle` and `method.accept` require a `user`
actor. An agent run invokes capabilities as a non-user principal. This is structural: the decision
must come from an operator.

### A destructive command asks for approval more often than expected

`risk.assess` classifies a command family and derives impact. Commands outside the classified
families are not classified — which is *not* the same as safe, and the surrounding gate treats them
conservatively.

## Workbench

### A contract chip will not clear

Each chip has an explicit satisfaction rule. `context` needs a workspace, `goal` needs a non-blank
outcome, `skills` and `executors` and `invariants` and `acceptance` need at least one entry,
`authority` and `budget` need to be defined. See [Domain types](reference/domain-types.md).

### Review is disabled

Required acceptance criteria are still open. The ledger shows which. That is `reviewReadiness` doing
its job.

### A write looks like it did not stick

Almost always read-after-write lag: the capability returned, the run has not emitted yet, the
projection has not folded. In tests, wait on the durable row — never sleep.

### A capability will not skip a lifecycle step

`advanceLifecycle` allows only the immediate next state. That is deliberate.

### An automation never fired

Nothing schedules it. The state machine exists and advances; there is no background scheduler.
Recorded in [Known gaps](known-gaps.md).

### Budget shows values that are not enforced

Correct. Usage and cost are recorded and displayed; nothing enforces a budget at runtime.

## Observations and RealityTrace

### Observations stay queued

No SXR binary. `just setup-realitytrace`, or set `SXR_BIN`. The boot log says
`observations stay queued` when it cannot find one.

### Observations are poisoned

Five failed delivery attempts against an unreachable or rejecting CLI. Reconcile manually. The
underlying events are unaffected — the outbox is separate.

### The delivery tests fail

Expected when the CLI is absent: they fail rather than skip, so a broken evidence layer cannot look
healthy. Install it.

## UI

### A disabled control explains itself only on hover

It should not. `App.tsx` currently renders 21 controls whose only explanation is a `title`, which
violates `src/ui/workbench/UX.md` rule 7. Known and recorded; see [Known gaps](known-gaps.md).

### The stats footer shows `0 turns 0 steps`

No accounting is implemented. Recorded as a gap rather than filled with plausible numbers.

### A cognitive Surface shows "Representation rejected"

The data violated the closed grammar. Check the block type against `src/cognitive/surface.ts`. An
unrenderable block and an unvalidatable block are both defects.

### The review panel's toolbar buttons do nothing

Several are deliberately inert — the multi-pane layout, real fullscreen and the collapsible sidebar
do not exist. See the count in [Known gaps](known-gaps.md).

## Tests

Covered in detail in [How to: debug a test](how-to/debug-a-test.md). The three most common:

1. **Hangs** — waiting on a continuation, or sleeping instead of waiting on a durable row.
2. **Needs infrastructure** — a journey test needs PostgreSQL; a browser test needs Chromium; a
   delivery test needs RealityTrace.
3. **`noUncheckedIndexedAccess`** — run `just typecheck` first; many "logic" failures are type errors.

## Still stuck

1. `GET /health` — does the model parse?
2. `just typecheck` — is it a type error?
3. The boot log — a missing binary, an unreachable world, or observations queued each produce a
   specific line.
4. The event log — the answer to most "what happened" questions is in there, and
   [Event catalog](reference/event-catalog.md) says which event to look for.

## Source trail

- `src/server.ts`, `src/store.ts`, `scripts/setup-pg0.ts` — boot failures
- `src/agents/agentCoding.ts` — turn failures, the preset check, retry
- `src/domain/approvalGate.ts`, `src/workbench/authority.ts`, `src/cognitive/preflight.ts` — gating
- `src/workbench/contract.ts`, `ledger.ts`, `skillOs.ts` — cockpit refusals
- `src/observations.ts` — observation states
- `src/ui/workbench/UX.md`, `PRODUCT.md` — the rules being violated
- `test/wb-helpers.ts` — the durable-wait rule
- [Known gaps](known-gaps.md) — everything deliberately incomplete