# Why the event log is authoritative

## The claim

This application has no mutable state. Every screen is a projection over an append-only event log,
and that is a deliberate architectural commitment rather than a framework default that happened to be
adopted.

## What "no mutable state" means here, concretely

- There is no session table. A session is a fold of `session.turn.started` and the events around it.
- There is no "is this approval pending" flag. An open continuation is a durable `run.waiting`
  state.
- There is no plan object. Plan mode is four event types folded into one row.
- There is no task board. The board is the `workbench` projection reduced by `src/workbench/reducer.ts`.
- There is no Case store. The Case is `deriveCase(events)`, recomputed on demand.

## Why

The problem this removes is **reconciliation**. A system with mutable state has, after a crash, two
sources of truth: what the state says, and what actually happened. Reconciling them is where the
expensive and embarrassing bugs live — and for an agent that has been writing files, the gap between
those two is exactly where you least want to find it.

Here, reality *is* the log. Everything else is a function of it, so there is nothing to reconcile.
The consequence is visible in [Restart and recovery](../workflows/restart-and-recovery.md): a restart
is not a recovery event.

The second reason is replay. A run's steps are recorded, and `ctx.step` wraps non-deterministic
effects so a replay reproduces them. That is what makes an approval safe to park for an unbounded
time: resuming it later is the same computation, not a resumption of some half-finished imperative.

The third reason is auditability. Every decision this system makes — an allow, a deny, a settle, an
accept — is a row you can find. That is the substrate the product's own principle rests on: authority
before action, evidence after action.

## What it costs

This is not free, and the code says so in places.

**Every read is a fold.** A projection is maintained, not computed on demand, so reads are cheap; but
maintaining it is the write-side cost of every event.

**Writes are more expensive than they look.** Because there is no direct append, every durable change
starts a run. See [Why `agent.config` is the write path](why-agent-config-is-the-write-path.md) for
the consequences, including read-after-write lag.

**The runtime executes runs serially.** An event recorded through a new run during an active run waits
behind it. This is why live steering is a write into the running run's shared state rather than a new
run.

**Deletion is not modelled.** Nothing in the current design retracts a recorded fact. `world.discard`
discards a *directory*, not the event that recorded its creation. If the product ever needs a true
deletion or correction primitive, the event log is where that tension will surface.

## What it rules out

- Local mutable caches as a source of truth. They would have to be rebuildable from the log anyway.
- Multi-writer optimistic concurrency in the application layer. The store is the concurrency boundary.
- Cheap writes. If a future feature needs thousands of writes a second, this architecture is wrong for
  it, and the answer would be a different mechanism rather than a bypass.

## Confidence

The design intent is **verified** from code: the header comments in `src/agents/agentConfig.ts`,
`src/workbench/reducer.ts`, every projection, and `src/capabilities/workbench.ts` state the same rule
independently and consistently.

The *original* motivation is **recovered knowledge**, not something this repository states in its own
words. The legacy reconstruction notes give the durability and replay rationale; the reconciliation
argument above is my reading of what the code implies. Treat the trade-off section as analysis, not
as a recovered rationale.

## Source trail

- `src/agents/agentConfig.ts` — "The run body only emits — no I/O, no randomness, replay-safe by
  construction"
- `src/capabilities/workbench.ts` — "The durable event log, never component memory, owns the state"
- `src/projections/*.ts` —  sixteen pure folds, each documenting what it folds and why
- `src/workbench/reducer.ts` — the `workbench.*` fold
- `src/cognitive/case.ts` — "a derived `CaseProjection` (no store of its own)"
- `src/agents/agentCoding.ts` — the `ctx.step` determinism discipline
- `test/J-G-persistence.test.ts`, `test/J-D-approval.test.ts` — the durability contracts
- `.tmp/reconstruction/README.md` — the pre-existing statement of intent (recovered; see
  [Evolution and provenance](evolution-and-provenance.md))