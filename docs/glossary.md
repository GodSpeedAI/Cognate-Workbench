# Glossary

Project vocabulary. Terms are defined as they are used *in this repository*, not in general.

---

## The ten you need first

### Agent
A named run body. Three exist: `agent.coding` (the tool loop), `agent.config` (emit-only, records
domain events), `agent.cognitive` (records cognitive facts). An agent performs I/O by invoking
capabilities and by emitting events. It does not own state.

### Capability
A governed, leased unit of effect with a stable `id.version`. Roughly 60 capability ids exist.
A capability validates its input, performs the effect, and records the result. It is the only way
anything consequential happens. See [Capability catalog](reference/capability-catalog.md).

### Tool
A model-facing schema entry the model may call: `read`, `edit`, `bash`, `todo_write`,
`exit_plan_mode`, `subagent`, `run_code`. A tool is not an authority; it resolves to exactly one
capability that is.

### Event
An immutable, recorded fact. The event log is the application's truth. Nothing else is.

### Projection
A derived read model folded from events. The UI subscribes to projections. A projection can be
deleted and rebuilt without loss. Eleven exist. See [Projection catalog](reference/projection-catalog.md).

### Continuation
A durable human wait inside a run. `ctx.waitFor(...)` parks a run; `client.resolveContinuation(...)`
releases it. This is how approvals and plan reviews work, and it is why a pending approval survives
a full process restart.

### Run
One execution of one agent, correlated by a correlation id (`session:<id>`,
`subagent:<parentRunId>:<toolCallId>`). Runs are replayed deterministically from their recorded steps.

### Execution world
Where files are read and commands run. Local, an SSH host, a WSL distribution, or a disposable
directory copy. A workspace is `(executionWorldId, root)`; the agent loop never learns which kind it
is talking to.

### Task contract
The declared shape of a unit of work: context, goal, skills, authority scopes, executors, budget,
invariants, acceptance criteria. It is validated before work starts and is the thing review checks
against.

### Affordance
An operation that is *currently available*, derived from what holds right now. Distinct from
possibility. A blocked affordance names what blocks it and the move that would unblock it.

---

## Domain concepts

### Semantic model
`.sea/interaction/interaction-model.sea`. A DomainForge `.sea` file declaring 31 entities that give
the domain its names. It is read at boot; its object count and digest are logged. It is the naming
contract, not the runtime state.

### Binding
The only path from a semantic object to a capability contract. `domain/index.ts` performs every
binding through `bindCapabilities` and asserts the expected count for each tranche, so a silent
loss of a binding fails at boot.

### Journey
A canonical end-to-end scenario from the semantic model. Journey ids are stable and short
(`j_d_approval`, `j_e_plan`, `j_wb_task_contract`), and tests are named after them
(`test/J-D-approval.test.ts`).

### Grant
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

### Skill / Skill capability
A named capability with an implementation binding and a lifecycle state. The catalog is seeded;
`skill.lifecycle.advance` moves a capability through `CAPABILITY_LIFECYCLE`, one step at a time.

### Workflow
A directed graph of nodes with `needs` (must pass) and `after` (must settle) edges. Node status is
derived; advancement is explicit and can require evidence.

### Automation
An accepted workflow plus input binding, a schedule, an execution substrate, and an outcome gate.
Lifecycle: `SCHEDULED → DISPATCHED → RUNNING → PRODUCED → VERIFIED → COMPLETE`, with `FAILED`
reachable from any non-terminal state. The state machine exists; no scheduler fires it. See
[Known gaps](known-gaps.md).

### Steering
Two queues of operator instructions: *steer now* (delivered at the run's next step boundary) and
*queue next* (delivered on the next turn). Steer-now is a write into the live run's shared state,
not a new run.

### Grounded feedback
A structured, UI-anchored repair request: a CSS selector, an optional screenshot reference, a
viewport, and a description. The contract and its validation exist; there is no element picker.

---

## Cognitive concepts

These belong to the cognitive-navigation layer, described in
[Why the cognitive layer exists](explanation/why-cognitive-layer.md).

### Case
The derived state of one unit of intended change: desired outcome, base world hash, candidate world
hash, criterion, deviation, authority, evidence, unknowns, affordances, blocked affordances, and
settlement conditions. It is a fold of events, never stored.

### World manifest
The consequential state a `worldHash` is computed over: workspace file digests, repo SHA, semantic
model / policy / environment hashes, and criterion and method hashes. Lineage metadata is
deliberately excluded.

### worldHash
`SHA-256` over the canonicalised manifest. Two worlds with the same hash are the same world, which
is what makes settlement promotion meaningful.

### Candidate world
A forked, disposable execution world plus the change being trialled in it. A candidate never
overwrites its settled parent.

### Settlement
Human promotion of a candidate to the settled world. Requires a human actor, no enclosing run,
reachable mandatory conditions, a current parent, and evidence.

### Criterion
A frozen evaluation definition: required check ids, consequences, and observer coverage. Once
frozen it is deep-frozen and bound to its hash. A revision is a new criterion with a new hash and
requires human authority.

### Reality
Facts derived from durable events. Agent language cannot author it.

### Mediation
An ordered chain of interceptors around a capability invocation, tiered
`governance > system > product > user > core`. Sentinel sits above; risk assessment and live
verification sit below. A lower-trust mediator cannot lower a trusted approval requirement.

### Semantic Surface
A closed grammar for just-in-time representation: `callout`, `entity`, `table`, `compare`,
`timeline`, `preflight`, `ask`. Strictly validated; anything outside the grammar is rejected, never
rendered. Representation is a governed capability, not an injection channel.

### Focus
Where the human's attention currently is. Ephemeral, and never authority.

### Method
A named approach under test. A method recommendation is a candidate change derived from observed
residuals; only a human can accept it and move the active method hash.

---

## Runtime vocabulary

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

### Observation
One evidence record destined for RealityTrace, derived from an observed event. Delivery is
at-least-once.

---

## Words this repository deliberately does not use

- **Sandbox.** `run_code`'s `sandbox_permissions` field name is borrowed from a model tool schema.
  The mechanism is an approval gate plus workspace path containment, not an OS-level sandbox. Path
  checks and shell parsing are best-effort.
- **Production hardened.** The authenticator, the tool guards, and the multi-operator story are
  incomplete by design and by record.
- **Parity.** Pixel and behaviour parity with the original reference product was an earlier goal and
  has been retired. Root `DESIGN.md` records the replacement.