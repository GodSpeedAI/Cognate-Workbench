# Documentation map

Every canonical documentation page: what it is for, which reader need it answers, what it owns, and
what it links to. Read this before adding a page — it is the mechanism that prevents two pages from
competing to explain the same thing.

## Ownership rules

1. **One concept, one home.** If two pages explain something substantially, one of them is wrong.
2. **Link, do not duplicate.** A page that needs a concept explained points at the owning page.
3. **A page answers one reader need.** Explanation that belongs on a how-to goes on the how-to's
   target page.
4. **New page, new reader need.** If you cannot name the question a new page answers, extend an
   existing one instead.

## Pages

### Orientation

| Page | Reader need | Diátaxis | Owns | Prerequisites |
|---|---|---|---|---|
| [README](README.md) | "What is this and where do I start?" | orientation | — | none |
| [getting-started](getting-started.md) | "How do I run it?" | tutorial-adjacent | prerequisites, quick start, first verification | none |
| [glossary](glossary.md) | "What does this word mean here?" | reference | **all project vocabulary** | none |
| [mental-model](mental-model.md) | "What are the big pieces?" | explanation | the conceptual shape, boundaries, data flow | glossary |
| [architecture](architecture.md) | "How is it built, and what depends on what?" | reference/explanation | **the canonical architecture model** | mental model |

### Subsystems

Each page uses the same structure: purpose, responsibilities, non-responsibilities, position, core
abstractions, internal operation, state, lifecycle, failure modes, extension points, source trail.

| Page | Owns | Prerequisite |
|---|---|---|
| [runtime and server](subsystems/runtime-and-server.md) | boot, composition root, trust configuration, shutdown | architecture |
| [agents](subsystems/agents.md) | the three run bodies, the tool loop, presets | runtime, glossary |
| [capabilities](subsystems/capabilities.md) | the governed choke point, the write path | architecture, capability model |
| [projections](subsystems/projections.md) | the eleven read models and their fold styles | architecture |
| [workbench domain](subsystems/workbench-domain.md) | the sixteen pure modules | architecture, domain types |
| [cognitive domain](subsystems/cognitive-domain.md) | world identity, lineage, mediation, Surface | cognitive navigation |
| [execution worlds, providers, secrets](subsystems/execution-worlds-providers-secrets.md) | the trust surface | runtime |
| [observations and RealityTrace](subsystems/observations-realitytrace.md) | the evidence layer | projections |
| [ui](subsystems/ui.md) | the reader surface, the component contract | projections |

### Concepts

| Page | Owns | Prerequisite |
|---|---|---|
| [capability model](concepts/capability-model.md) | **the chain from a semantic name to a running capability**, and the three "not a contract" shapes | glossary |
| [authority and approval](concepts/authority-and-approval.md) | **the four gates, the durable wait, human-only decisions** | mental model |
| [evidence and done](concepts/evidence-and-done.md) | **the completion taxonomy, acceptance, review readiness, honest rendering** | glossary |
| [cognitive navigation](concepts/cognitive-navigation.md) | **Case, world, criterion, affordance, mediation, Surface** | glossary |

### Workflows

| Page | Question it answers |
|---|---|
| [application startup](workflows/application-startup.md) | What happens between `just dev` and a usable page? |
| [send a turn](workflows/send-a-turn.md) | What happens when I press Send? |
| [approval escalation](workflows/approval-escalation.md) | How does a privileged action get blocked and unblocked? |
| [task contract and review](workflows/task-contract-and-review.md) | How does work get accepted rather than merely finished? |
| [plan mode](workflows/plan-mode.md) | How do plans and to-dos work? |
| [subagent delegation](workflows/subagent-delegation.md) | How does the agent hand work to a child? |
| [provider hot-swap](workflows/provider-hot-swap.md) | How do I change models without restarting? |
| [restart and recovery](workflows/restart-and-recovery.md) | What comes back after a crash? |
| [cognitive case settlement](workflows/cognitive-case-settlement.md) | How does a candidate change get promoted? |

### Explanation

Each page separates verified design rationale from inference.

| Page | Owns |
|---|---|
| [why the event log is authoritative](explanation/why-event-sourcing.md) | why there is no mutable state; what it costs |
| [why one Bun process](explanation/why-single-bun-process.md) | why not `cognate dev`; why no proxy |
| [why `agent.config` is the write path](explanation/why-agent-config-is-the-write-path.md) | why writing state starts a run, and what that costs |
| [why approval is a continuation](explanation/why-approval-is-a-continuation.md) | why a gate is a durable wait |
| [why the cognitive layer exists](explanation/why-cognitive-layer.md) | the problem the five objects solve |
| [evolution and provenance](explanation/evolution-and-provenance.md) | **where this came from, what was taken from where, verified vs recovered** |

### Tutorials

| Page | Ends with |
|---|---|
| [first run](tutorials/first-run.md) | a configured provider, a selected workspace, a tool-using turn, a durable approval, a restart |
| [workbench cockpit](tutorials/workbench-cockpit.md) | a task accepted against recorded evidence |

### How-to

| Page | Task |
|---|---|
| [run locally](how-to/run-locally.md) | get a server |
| [use an existing PostgreSQL](how-to/use-external-postgres.md) | point it at your own database |
| [add a capability](how-to/add-a-capability.md) | add a governed action |
| [add an event and a projection](how-to/add-an-event-and-projection.md) | record a fact and expose it |
| [add a model wire protocol](how-to/add-a-model-provider-protocol.md) | support a new endpoint shape |
| [add an execution world](how-to/add-an-execution-world.md) | put a workspace somewhere else |
| [install RealityTrace](how-to/install-realitytrace.md) | enable the evidence layer |
| [debug a test](how-to/debug-a-test.md) | diagnose a failure |

### Reference

| Page | Owns |
|---|---|
| [CLI](reference/cli.md) | every recipe, script and HTTP route — **and the commands that do not exist** |
| [configuration](reference/configuration.md) | environment variables, home resolution, durable settings |
| [capability catalog](reference/capability-catalog.md) | every capability id, provider, binding and grant |
| [event catalog](reference/event-catalog.md) | every durable event and what folds it |
| [projection catalog](reference/projection-catalog.md) | the eleven read models and their fold styles |
| [domain types](reference/domain-types.md) | type shapes and the invariants on them |
| [UI surfaces](reference/ui-surfaces.md) | which component shows what; the component contract |
| [test layout](reference/test-layout.md) | test naming, harness, infrastructure |
| [semantic model](reference/sea-model.md) | how to read `.sea/` |

### Diagnosis

| Page | Owns |
|---|---|
| [troubleshooting](troubleshooting.md) | symptom → cause → fix |
| [known gaps](known-gaps.md) | **what is deliberately incomplete, and the live conflicts** |

### Indexes

| Page | Owns |
|---|---|
| [source map](source-map.md) | concept → implementation location |
| [documentation map](documentation-map.md) | this file |

## Canonical ownership at a glance

If you are about to explain one of these, go to the listed page rather than writing it again.

| Concept | Canonical home |
|---|---|
| Project vocabulary | [glossary](glossary.md) |
| The high-level architecture | [architecture](architecture.md) |
| The conceptual shape | [mental-model](mental-model.md) |
| Semantic name → running capability | [concepts/capability-model.md](concepts/capability-model.md) |
| Gates and approval | [concepts/authority-and-approval.md](concepts/authority-and-approval.md) |
| Completion and proof | [concepts/evidence-and-done.md](concepts/evidence-and-done.md) |
| Case, world, affordance, Surface | [concepts/cognitive-navigation.md](concepts/cognitive-navigation.md) |
| The tool loop | [workflows/send-a-turn.md](workflows/send-a-turn.md) |
| What survives a restart | [workflows/restart-and-recovery.md](workflows/restart-and-recovery.md) |
| Every capability id | [reference/capability-catalog.md](reference/capability-catalog.md) |
| Every event | [reference/event-catalog.md](reference/event-catalog.md) |
| Every projection | [reference/projection-catalog.md](reference/projection-catalog.md) |
| Every command | [reference/cli.md](reference/cli.md) |
| Every environment variable and setting | [reference/configuration.md](reference/configuration.md) |
| Every type and invariant | [reference/domain-types.md](reference/domain-types.md) |
| Every component | [reference/ui-surfaces.md](reference/ui-surfaces.md) |
| Every test | [reference/test-layout.md](reference/test-layout.md) |
| Everything incomplete | [known-gaps.md](known-gaps.md) |
| Where anything is implemented | [source-map.md](source-map.md) |
| Why anything is the way it is | [explanation/](explanation/) |
| Where this came from | [explanation/evolution-and-provenance.md](explanation/evolution-and-provenance.md) |
| The visual system | [`../DESIGN.md`](../DESIGN.md) — not duplicated here |
| Product truth and principles | [`../PRODUCT.md`](../PRODUCT.md) — not duplicated here |
| The component contract | [`../src/ui/workbench/UX.md`](../src/ui/workbench/UX.md) — not duplicated here |
| The semantic model | [`../.sea/interaction/`](../.sea/interaction/README.md) — not duplicated here |

## Knowledge recovered from removed documentation

The tracked `docs/` tree was removed in the working tree and its content relocated under the
gitignored `.tmp/`. The following knowledge was migrated into the pages above.

| Recovered source | Now lives in |
|---|---|
| "Why `createRuntime`, not `createHarness`" | [explanation/why-single-bun-process.md](explanation/why-single-bun-process.md) |
| "Why the Connect service is served in-process" | same page |
| Tool loop and approval mechanics | [workflows/send-a-turn.md](workflows/send-a-turn.md), [workflows/approval-escalation.md](workflows/approval-escalation.md) |
| Plan mode (T9) | [workflows/plan-mode.md](workflows/plan-mode.md) |
| Subagents (T10) | [workflows/subagent-delegation.md](workflows/subagent-delegation.md) |
| Remote workspaces | [subsystems/execution-worlds-providers-secrets.md](subsystems/execution-worlds-providers-secrets.md) |
| Cognitive-navigation proof | [concepts/cognitive-navigation.md](concepts/cognitive-navigation.md), [subsystems/cognitive-domain.md](subsystems/cognitive-domain.md) |
| Domain wiring | [concepts/capability-model.md](concepts/capability-model.md) |
| Secrets handling | [subsystems/execution-worlds-providers-secrets.md](subsystems/execution-worlds-providers-secrets.md) |
| Validation traces, plan sections not built, framework gaps | [known-gaps.md](known-gaps.md) |
| "Design decisions worth knowing" | [explanation/why-agent-config-is-the-write-path.md](explanation/why-agent-config-is-the-write-path.md) |
| Capability binding enumeration, "not bound" sections | [reference/capability-catalog.md](reference/capability-catalog.md), [concepts/capability-model.md](concepts/capability-model.md) |
| Donor table and reference manifest | [explanation/evolution-and-provenance.md](explanation/evolution-and-provenance.md) |
| Migration snapshot and the CI caveat | [explanation/evolution-and-provenance.md](explanation/evolution-and-provenance.md), [known-gaps.md](known-gaps.md) |
| Journey naming and what each test establishes | [reference/test-layout.md](reference/test-layout.md) |
| "Run it" | [getting-started.md](getting-started.md), [how-to/run-locally.md](how-to/run-locally.md) |

**Deliberately not migrated:** the reference behaviour matrix, which documented a third-party
product's behaviour, is stale with respect to this application, and has no reader need inside this
repository. Pixel-parity scoring was retired as a goal. Both remain in git history.

## Maintaining this file

Update it whenever a page is created, renamed, split, merged or removed. If you add a page and this
file does not mention it, the navigation has an orphan.