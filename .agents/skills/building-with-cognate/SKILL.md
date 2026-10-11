---
name: building-with-cognate
description: Model-first software engineering on the Cognate framework (Bun/TypeScript semantic application substrate). Use when building, extending, reconstructing, or reviewing an application, agent, capability, UI, or protocol surface on Cognate — for example "build X with Cognate", recreating an existing product on Cognate, adding agents/capabilities/shared state/human approval/AG-UI/Connect/MCP/A2A surfaces, or checking an implementation against its domain model. Derives an Interaction Domain Model in DomainForge `.sea` first (via the deriving-interaction-domain-models and domainforge-sea skills), then realises each canonical journey with Cognate runtime, capability, state, artifact, and evidence constructs, with tests traced back to the model.
---

# Building with Cognate

Build software as: **validated interaction model → explicit bindings → deterministic agents and capabilities → journey tests → recorded evidence**. The `.sea` model owns domain meaning; Cognate owns execution and durable truth. Never let routes, screens, or the source product's code structure define the domain.

## Required companion skills

- **deriving-interaction-domain-models** — the method for the domain model (boundary, journeys, affordances, settlement, deliverables, canonicality conclusion). Follow it; do not restate or shortcut it.
- **domainforge-sea** — the only authority for `.sea` syntax and DomainForge CLI commands. Load it before writing or validating any `.sea`.

## Tooling

Invoke the Cognate CLI only as `cognate <command>`. Resolve what `cognate` means (the published [`@godspeedai/cognate-cli`](https://www.npmjs.com/package/@godspeedai/cognate-cli) package; `create` still needs `--source <checkout>`) from [references/cli.md](references/cli.md) before first use. Keep install paths and version pins out of every other file in this skill.

## References (load as needed)

- [references/cli.md](references/cli.md): how to install and invoke `cognate` (`create`, `dev`) in the current distribution mode, and where the starter's `domain/` `.sea` files go.

- [references/cognate-api.md](references/cognate-api.md): package map, import paths, agent/RunContext, RuntimeService, capabilities, shared state, client/React, protocol surfaces, stores, testing, pitfalls. Read before writing Cognate code.
- [references/idm-to-cognate.md](references/idm-to-cognate.md): how `@godspeedai/domainforge` consumes `.sea`, the IDM-concept → Cognate-construct mapping, and traceability rules. Read before step 3.

Inside the Cognate repo, `docs/documentation-map.md` routes to deeper docs, and `examples/` holds runnable idiomatic code; prefer copying an example's shape over inventing one. If the code and a reference disagree, trust the code.

## Workflow

### 1. Plan in tranches

Before coding, write a plan that decomposes the work into tranches. Each tranche is a vertical slice that covers one or more canonical journeys end to end: model, agent and capabilities, surface, and test. Order the tranches by dependency and risk. The first tranche proves the thinnest complete journey. Record the plan where the host repository keeps plans; a Cognate checkout uses `.agents/plans/`.

### 2. Model the domain (IDM in `.sea`)

Run the deriving-interaction-domain-models workflow over the available evidence, such as specs, the product being recreated, its docs, and its observed behaviour. Output goes to `.sea/interaction/`, including `interaction-model.sea`, the journey catalog, the translation map, the assumptions, and the handoff. Validate with the DomainForge CLI per domainforge-sea. Do not implement a journey that is absent from the catalog. Add the journey to the model first.

### 3. Scaffold, project, and bind

For a new app, generate a starter with `cognate create` using the profile closest to the product (see `cli.md`), and place the validated model where the starter loads `.sea` from. Load the model with `@godspeedai/domainforge` (`loadSemanticProjection`), and treat the resulting semantic objects as read-only. Nothing becomes a capability implicitly. Bind semantic IDs to capability contracts explicitly with `bindCapabilities`, and record every binding in the handoff so names stay traceable. Use the mapping in `idm-to-cognate.md` to decide what each IDM element becomes. With the installed DomainForge 0.19.0 binding, Entity, Resource, Flow, Role, Relation, the programmatic ResourceInstance collection, SEA entity instances, policies, metrics, patterns, concept changes, dimensions, units, mappings, and projections all reach the projection as read-only objects (DEBT-003 closed). Policies remain read-only referenced constraints: Cognate does not evaluate them or turn them into capabilities or permissions. Hand-implement any runtime checks the app needs, and name them after their `.sea` declarations.

### 4. Implement journey by journey

For each canonical journey in the current tranche:

- **Actors and roles:** map them to principals and authorization. The default is no authority. Grant it explicitly, and check it at invocation.
- **Intentions and journeys:** map them to agent runs. Keep agent code deterministic. Put all I/O, time, randomness, and model calls in recorded steps or capabilities, so replay reproduces the run.
- **Capabilities and actions:** map them to capability contracts plus providers. Eligibility rules express policy and authority. The ranker only orders the providers that are already eligible.
- **State transitions:** map them to events and shared state. Use `state.changed` snapshots or patches, and `updateState` with idempotency keys and `expectedVersion`.
- **Artifacts:** map them to artifacts. **Human decisions and approval gates:** map them to continuations.
- **Outcomes, evidence, and settlement:** map them to emitted events, projections, and RealityTrace records. Carry correlation IDs through all of them.
- **Surfaces:** expose the journey through the client or React hooks, AG-UI, Connect, MCP, or A2A, as the product requires. These are projections of the journey, never the source of its meaning.

### 5. Test against the model

Each canonical journey needs at least one test. The test runs the real runtime with the SQLite store where durability matters, and asserts that the journey reaches settlement using observable evidence (events, state, artifacts), not merely that it completed. Cover the failure and recovery paths the catalog names. Use the conformance kit for any new `RuntimeService` or port implementation. Name tests after journey IDs so a reader can trace a test back to its journey.

### 6. Verify and record

- Run the narrow tests, then the host repository's full gate. In a Cognate checkout that is `just verify` and `just gates`.
- Re-validate the `.sea` model.
- Update the model's handoff and validation record.
- Report exact commands and their pass/fail results.
- For reconstructions, capture side-by-side evidence (screenshots or recorded behaviour) for each journey against the original. A tranche is done only when its journeys settle and its evidence is recorded.

## Rules

- Model first; code second. If implementation reveals a domain gap, fix the model, re-validate it, and then change the code.
- Keep `.sea` and DomainForge independent of runtime code. Cognate consumes the projection and never writes back into the model.
- Treat the durable event log as truth. Cognition (memory, rankers, indexes) is derived and rebuildable.
- Keep credentials and personal data out of events, logs, and cognitive indexes.
- Do not claim a journey works without an observed passing test. A skipped or missing test is an unmet gate.
- When Cognate lacks something the product needs, say so and propose it as a separate framework change. Do not work around it silently in app code.
