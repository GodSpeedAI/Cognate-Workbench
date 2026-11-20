# Workbench terminology implementation reference

The [glossary](../glossary.md) owns the conceptual terms. This reference ties them to the current implementation.

| Concept | Implementation name or source |
| --- | --- |
| Team Lead | `orchestrator` Team role in [expert types](../../src/experts/types.ts). The Team invariant requires exactly one for an active Team. |
| Expert Assignment | `Assignment`, separate from the Case Assignment contract. |
| Assignment Acceptance | `team.settle` and the Expert Assignment acceptance state. Review has a separate operation. |
| Candidate Promotion | `world.settle` and `world.settled`. |

### Agent

The [Agent Procedure](https://github.com/GodSpeedAI/Cognate/blob/29dcd1e/packages/runtime-api/README.md) is registered under labels such as `agent.coding`, `agent.config` and `agent.cognitive`. Workbench also dispatches Experts through `agent.expert`.

### Capability

Workbench advertises callable Capability Contracts with versioned capability IDs. See the [capability catalog](capability-catalog.md).

### Tool

Tool examples include `read`, `edit`, `bash`, `todo_write`, `exit_plan_mode`, `subagent`, and `run_code`. Admission checks still apply when a tool resolves to a capability.

### Projection

A derived read model folded from events. The UI subscribes to projections. A projection can be
deleted and rebuilt without loss. See [Projection catalog](projection-catalog.md).

### Continuation

`ctx.waitFor(...)` parks a run; `client.resolveContinuation(...)`
releases it. This is how approvals and plan reviews work, and it is why a pending approval survives
a full process restart.

### Run

One execution of one agent, correlated by a correlation id (`session:<id>`,
`subagent:<parentRunId>:<toolCallId>`). Runs are replayed deterministically from their recorded steps.

### Execution World

Where files are read and commands run. Local, an SSH host, a WSL distribution, or a disposable
directory copy. A workspace is `(executionWorldId, root)`; the agent loop never learns which kind it
is talking to.

### Semantic model

The [interaction model](../../.sea/interaction/interaction-model.sea) supplies declared semantics. The application reads it at start and records the loaded object count and digest.

### Binding

The only path from a semantic object to a capability contract. `domain/index.ts` performs every
binding through `bindCapabilities` and asserts the expected count for each tranche, so a silent
loss of a binding fails at boot.

### Journey

A canonical end-to-end scenario from the semantic model. Journey ids are stable and short
(`j_d_approval`, `j_e_plan`, `j_wb_task_contract`), and tests are named after them
(`test/J-D-approval.test.ts`).

### Permission Rule

One axis of an authority scope. Exactly one of `yes`, `approval`, `no`. `approval` means the
operation needs a human decision before it runs.

### Authority scopes

Per-task permissions for filesystem (read, write, outsideWorkspace), shell (run, destructive), and
network. A task with no scopes falls back to the app-wide defaults.

### Protected evidence

Paths matched by an app- or task-level protection rule. Enforcement is structural: `authority.check`
runs inside the tool loop before `tool.edit` or `tool.bash` executes, so the block does not depend on
the model agreeing to a prompt.

### Evidence

A recorded, criterion-bound observation. Evidence entries carry a kind (`AcceptanceKind` or a wider
`EvidenceKind`), a status (`pass` / `fail` / `pending`), and — for cognitive verification — the
criterion hash and candidate hash they were observed under.

### Done level

The taxonomy of completion: `not-started`, `finished`, `produced`, `tested`, `ready-for-review`,
`accepted`, `operationalized`. The model deliberately does not collapse these into a single "done".

### Acceptance criterion

A named, checkable condition attached to a task contract, with a kind (`test`,
`independent-check`, `journey`, `audit`, `integrity`, `human`) and a `required` flag. Review
readiness is computed from which required criteria are closed.

### Review gate

The human decision that promotes work from `ready-for-review` to `accepted`. Requires a `user`
actor, so an agent run cannot accept its own work.

### Installed Skill

A named capability with an implementation binding and a lifecycle state. The catalog is seeded;
`skill.lifecycle.advance` moves a capability through `CAPABILITY_LIFECYCLE`, one step at a time.

### Workflow

A directed graph of nodes with `needs` (must pass) and `after` (must settle) edges. Node status is
derived; advancement is explicit and can require evidence.

### Automation

An accepted workflow plus input binding, a schedule, an execution substrate, and an outcome gate.
Lifecycle: `SCHEDULED → DISPATCHED → RUNNING → PRODUCED → VERIFIED → COMPLETE`, with `FAILED`
reachable from any non-terminal state. The state machine exists; no scheduler fires it. See
[Known gaps](../known-gaps.md).

### Steering

Two queues of operator instructions: *steer now* (delivered at the run's next step boundary) and
*queue next* (delivered on the next turn). Steer-now is a write into the live run's shared state,
not a new run.

### Grounded feedback

A structured, UI-anchored repair request: a CSS selector, an optional screenshot reference, a
viewport, and a description. The contract and its validation exist; there is no element picker.

### Local Change Case

The derived state of one unit of intended change: desired outcome, base world hash, candidate world
hash, criterion, deviation, authority, evidence, unknowns, affordances, blocked affordances, and
settlement conditions. It is a fold of events, never stored.

### Execution Manifest

The consequential state a `worldHash` is computed over: workspace file digests, repo SHA, semantic
model / policy / environment hashes, and criterion and method hashes. Lineage metadata is
deliberately excluded.

### Execution State Digest

The implementation name for Execution State Digest. SHA-256 covers the canonicalized Execution Manifest. A matching hash establishes manifest equality at this scope. Status, lineage and semantic world identity remain separate.

### Candidate State

The historical implementation label for Candidate State. An experiment forks a local execution state and leaves its accepted parent intact.

### Candidate Promotion

The local operation `world.settle` records Candidate Promotion as `world.settled`. It requires a human actor outside a run, reachable mandatory conditions, a current parent and evidence. The separate `workbench.settlement.recorded` event reports a SEA-Forge judgment.

### Frozen Criterion

A frozen evaluation definition: required check ids, consequences, and observer coverage. Once
frozen it is deep-frozen and bound to its hash. A revision is a new criterion with a new hash and
requires human authority.

### Mediation

An ordered chain of interceptors around a capability invocation, tiered
`governance > system > product > user > core`. Sentinel sits above; risk assessment and live
verification sit below. A lower-trust mediator cannot lower a trusted approval requirement.

### Semantic Surface

A closed grammar for just-in-time representation: `callout`, `entity`, `table`, `compare`,
`timeline`, `preflight`, `ask`. Strictly validated; anything outside the grammar is rejected, never
rendered. Representation is a governed capability, not an injection channel.

### Method

A named approach under test. A method recommendation is a candidate change derived from observed
residuals; only a human can accept it and move the active method hash.

### Home

The application data directory. `COGNATE_WORKBENCH_HOME`, else the legacy `COGNATE_HARNESS_HOME`,
else `<repo>/.data`. It holds `secrets.json` and determines the PostgreSQL schema.

### Schema

`cognate_harness_<sanitised home path>`. Derived deterministically, so a home always maps to the
same schema and each test's temp home maps to an isolated one.

### Operator and system callers

`LOCAL_OPERATOR` is `{ tenant: "local", actor: { id: "operator", kind: "user" } }`.
`SYSTEM_CALLER` is the same tenant with a `system` actor. Both are defined in `src/server.ts`.

### Dev authenticator

`devTokenAuthenticator` from `@godspeedai/cognate-protocol-connect-bun`. It validates a bearer token
and grants the operator an explicit allow-list. It is not production authentication.

### Outbox

A generic runtime hook that commits an intent alongside an event. The observation layer uses it;
nothing else does.

### Workbench Observation Delivery

The outbox derives RealityTrace observations from selected events and delivers at least once. The existing observation allowlist includes `world.settled` and omits `workbench.settlement.recorded`. An observed candidate promotion establishes only the local decision.

## Words this repository deliberately does not use

- **Sandbox.** `run_code`'s `sandbox_permissions` field name is borrowed from a model tool schema.
  The mechanism is an approval gate plus workspace path containment, not an OS-level sandbox. Path
  checks and shell parsing are best-effort.
- **Production hardened.** The authenticator, the tool guards, and the multi-operator story are
  incomplete by design and by record.
- **Parity.** Pixel and behaviour parity with the original reference product was an earlier goal and
  has been retired. [DESIGN.md](../../DESIGN.md) records the replacement.
