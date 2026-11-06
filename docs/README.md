# Cognate Workbench documentation

Cognate Workbench is a development harness for capability-native agents. It exists to make the part
of agent work that tooling usually leaves implicit explicit: the place where an agent's meaning,
authority, capabilities and evidence are declared, bound to implementations, executed and verified,
so that what an agent may do and what it has actually done are inspectable rather than narrated.

It is a browser application over a durable, event-sourced Cognate runtime backed by PostgreSQL,
serving both its UI and its RPC API from one Bun process. Every consequential decision it records —
an approval, a settlement, an acceptance — survives a restart as a fact, not as memory.

The conversational coding loop is one surface it hosts. The cockpit is another: a place to author a
task contract, scope what the work may touch, watch a workflow advance, and accept or reject it
against recorded evidence. Both sit on the same substrate, so a capability exercised in one is the
same capability the other exercises.

This directory is the map of that system. Start wherever the index below sends you.

## Learn the system

| Page | Answers |
|---|---|
| [Getting started](getting-started.md) | How do I run it? |
| [Glossary](glossary.md) | What do these words mean here? |
| [Mental model](mental-model.md) | What are the big pieces and how do they relate? |
| [Architecture](architecture.md) | How is it built, and what depends on what? |
| [Subsystems](subsystems/) | What does each part own? |

## Follow execution

| Page | Answers |
|---|---|
| [Application startup](workflows/application-startup.md) | What happens between `just dev` and a usable page? |
| [Send a turn](workflows/send-a-turn.md) | What happens when I press Send? |
| [Approval escalation](workflows/approval-escalation.md) | How does a privileged action get blocked, and how do I unblock it? |
| [Task contract and review](workflows/task-contract-and-review.md) | How does work get accepted rather than merely finished? |
| [Plan mode](workflows/plan-mode.md) | How do plans and to-dos work? |
| [Subagent delegation](workflows/subagent-delegation.md) | How does the agent hand work to a child agent? |
| [Provider hot-swap](workflows/provider-hot-swap.md) | How do I change models without restarting? |
| [Restart and recovery](workflows/restart-and-recovery.md) | What comes back after a crash? |
| [Cognitive case settlement](workflows/cognitive-case-settlement.md) | How does a candidate change get promoted? |

## Understand why

| Page | Answers |
|---|---|
| [Why the event log is authoritative](explanation/why-event-sourcing.md) | Why is there no mutable application state? |
| [Why one Bun process](explanation/why-single-bun-process.md) | Why not `cognate dev`? Why not a second API server? |
| [Why `agent.config` is the write path](explanation/why-agent-config-is-the-write-path.md) | Why does writing state start a run? |
| [Why approval is a continuation](explanation/why-approval-is-a-continuation.md) | Why is a gate a durable wait, not an in-process pause? |
| [Why the cognitive layer exists](explanation/why-cognitive-layer.md) | What problem do Cases, worlds and affordances solve? |
| [Evolution and provenance](explanation/evolution-and-provenance.md) | Where did this come from, and which parts came from where? |

## Get something done

| Page | Answers |
|---|---|
| [Tutorial: first run](tutorials/first-run.md) | Walk me through a working session. |
| [Tutorial: the workbench cockpit](tutorials/workbench-cockpit.md) | How do I drive a task through contract to acceptance? |
| [How-to guides](how-to/) | Add a provider, a capability, a projection, an execution world. |

## Look something up

| Page | Answers |
|---|---|
| [CLI reference](reference/cli.md) | Which `just` recipes exist? |
| [Configuration and environment](reference/configuration.md) | Which knobs and environment variables change behaviour? |
| [Capability catalog](reference/capability-catalog.md) | Which capability ids exist and who grants them? |
| [Event catalog](reference/event-catalog.md) | Which durable events exist? |
| [Projection catalog](reference/projection-catalog.md) | Which read models exist and what do they fold? |
| [Domain types](reference/domain-types.md) | What are `TaskContract`, `AuthorityScopes`, `DoneLevel`, and friends? |
| [UI surfaces](reference/ui-surfaces.md) | Which cockpit component shows what? |
| [Test layout](reference/test-layout.md) | How are the tests named and what do they establish? |
| [The `.sea` domain model](reference/sea-model.md) | How do I read the semantic model? |

## When something is wrong

| Page | Answers |
|---|---|
| [Troubleshooting](troubleshooting.md) | What is this symptom and what do I do? |
| [Known gaps](known-gaps.md) | What is deliberately incomplete, and which test proves what? |

## Find the implementation

| Page | Answers |
|---|---|
| [Source map](source-map.md) | Which files and symbols implement each concept? |
| [Documentation map](documentation-map.md) | Which page owns which concept? |

## See it move

Single-file interactive explainers. Open them from disk; they make no network requests.

| Page | Shows |
|---|---|
| [Authority decision explorer](visuals/authority-decision-explorer.html) | Every input to `decideWrite` and `decideShell`, and the order of checks that produces the outcome |
| [Done level ladder](visuals/done-level-ladder.html) | Why `doneLevel` cannot skip an unmet level, shown over all seven |

## Pages kept outside this directory

Three files are canonical in their current location and are linked, not duplicated:

- [`../PRODUCT.md`](../PRODUCT.md) — who this is for, brand voice, design principles.
- [`../DESIGN.md`](../DESIGN.md) — the locked visual system (Cobalt) the interface serves.
- [`../.sea/interaction/`](../.sea/interaction/README.md) — the semantic model's own companion
  documents, including the canonical journey catalog.
- [`../src/ui/workbench/UX.md`](../src/ui/workbench/UX.md) — the per-component contract enforced by
  every cockpit component.

## Conventions used here

- Every substantial page ends with a **Source trail** listing the files and symbols that establish
  its claims.
- Claims are separated into what the repository demonstrates and what is inferred. Where rationale
  could not be recovered from this repository, the page says so instead of inventing it.
- Diagrams are Mermaid and are treated as technical claims: they are checked against code.