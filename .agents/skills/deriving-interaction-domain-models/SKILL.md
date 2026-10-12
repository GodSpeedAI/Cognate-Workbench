---

name: deriving-interaction-domain-models
description: Reconstructs canonical Interaction Domain Models from enterprise, strategy, project, product, workflow, use-case, jobs-to-be-done, policy, architecture, or agent-system evidence and represents them in valid .sea with DomainForge. Use when deriving, canonicalizing, translating, validating, or refounding a purposeful system into an IDM, canonical journeys, affordances, settlement loops, interaction ontology, or downstream semantic source.
compatibility: Requires the domainforge-sea skill, the DomainForge CLI, and filesystem access to repository .sea sources and examples.

---

# Deriving Interaction Domain Models

Build the stable interaction structure beneath the supplied evidence. Do not merely rewrite source material.

Treat every source as evidence, not as automatically correct or canonical. Preserve contradictions and uncertainty instead of silently reconciling them.

Do not change the `.sea` grammar. Do not implement application code unless the user separately authorizes it.

## Required operating model

The target semantic chain is:

```text
purpose or desired direction
→ observer or actor
→ current condition
→ intention or job
→ reachable affordance
→ canonical journey
→ journey steps
→ capability and action
→ state transition
→ artifact
→ outcome and evidence
→ settlement
→ decision
→ next affordance
```

A desired result is not an affordance until a reachable path exposes its actors, preconditions, material payment, actions, authority, evidence, and settlement access.

## Workflow

1. **Inspect evidence and repository conventions**

   * Read all relevant user-provided and repository material before modeling.
   * Locate current `.sea` and DomainForge references and valid local examples.
   * Confirm the installed DomainForge CLI syntax instead of relying on stale commands.
   * **Always use the `domainforge-sea` skill for DomainForge operations and `.sea` authoring.**
   * Treat `domainforge-sea` as authoritative for current `.sea` syntax, supported language constructs, DomainForge CLI commands, validation procedures, and tool conventions.
   * Do not independently reconstruct, guess, or duplicate DomainForge or `.sea` instructions when `domainforge-sea` provides them.

2. **Establish the system boundary**

   * Identify purpose, current condition, desired direction, in-scope/out-of-scope boundaries, governing constraints, and observable settlement.
   * Preserve nested system levels when actors, authority, payment, or settlement differ materially.

3. **Extract and normalize interaction evidence**

   * Extract purposes, actors, intentions/jobs, states, resources/artifacts, capabilities/actions, policies, outcomes/evidence, decisions/recovery paths, and affordances.
   * Normalize synonyms and overloaded terms without erasing meaningful domain language.
   * Keep actor vs role, intention vs action, capability vs implementation, outcome vs artifact, evidence vs assertion, possibility vs affordance, completion vs settlement, and canonical semantics vs interface projection distinct.

4. **Canonicalize**

   * Cluster candidate interactions by initiating condition, starting state, transformation, capability, affected object/artifact, outcome, evidence/settlement, and next decision.
   * Classify source interactions as canonical, specialization, variant, composition, duplicate, obsolete, ambiguous, or unsupported.
   * Seek minimum sufficient structure: the smallest model that preserves meaningful differences and explains the evidence.

5. **Construct the interaction model**

   * Define only the concepts the domain needs.
   * Model relationships, not a flat concept inventory.
   * Represent material payment such as time, attention, effort, money, risk, coordination, political/emotional burden, technical debt, opportunity cost, maintenance, or externalities when it changes reachability.
   * Define canonical journeys, variants, invariants, failure/recovery paths, and next affordances.

6. **Author valid `.sea` using `domainforge-sea`**
   * Before writing or modifying `.sea`, use the `domainforge-sea` skill.
   * Follow its current syntax, modeling, CLI, and validation guidance rather than reproducing those rules independently.
   * Prefer one coherent canonical source when splitting would fragment semantics or duplicate truth.
   * Never invent grammar or use `.sea` constructs not supported by `domainforge-sea` and the installed DomainForge version.
   * If an IDM concept cannot be represented cleanly using supported `.sea`, preserve the semantic requirement, use the nearest valid representation recommended by `domainforge-sea`, and document the compromise rather than extending the grammar.

7. **Validate, inspect, revise using `domainforge-sea`**
   * Use the `domainforge-sea` skill to determine the correct DomainForge validation, parsing, inspection, and projection commands for the installed version.
   * Inspect resulting semantic structures, diagnostics, and projections; parser success alone is insufficient.
   * Correct errors and repeat until the model validates or a genuine DomainForge or `.sea` limitation is demonstrated and documented.

8. **Produce the companion artifacts**

   * Maintain one durable canonical location, normally `.sea/interaction/`, unless repository conventions establish another canonical location.
   * Use `.agents/sea/` only as temporary analysis when repository conventions require it.
   * Produce the translation map, journey catalog, assumptions/unknowns, validation record, and handoff needed for downstream projection.

## Evidence discipline

Classify material conclusions as:

* **declared**: explicitly stated by a source;
* **observed**: supported by implemented behavior, tests, records, or artifacts;
* **inferred**: strongest explanation of multiple evidence sources;
* **proposed**: recommended structure not yet established;
* **unknown**: insufficient evidence.

Do not let implementation accidents, organizational titles, screens, routes, APIs, or source wording automatically define the canonical domain.

## Canonical journey rule

A stable journey follows this pattern:

```text
actor encounters a condition
→ forms or holds an intention
→ selects a reachable affordance
→ supplies context or payment
→ invokes capabilities
→ changes state or produces artifacts
→ receives evidence
→ reaches settlement
→ selects the next affordance
```

For each canonical journey capture purpose, actor/role, initiating condition, current/desired state, preconditions, steps, capabilities/actions, policy/authority, artifacts/resources, outcomes, evidence, settlement criteria, failure/recovery, next decisions/affordances, and known variants.

## Progressive references

Read these directly when needed:

* [references/core-method.md](references/core-method.md): detailed boundary, extraction, canonicalization, ontology, payment, journey, invariant, and `.sea` representation rules.
* [references/source-translation.md](references/source-translation.md): source-type-specific translation rules for enterprise, strategy, projects, epics, stories, JTBD, use cases, workflows, case management, interfaces, and agent systems.
* [references/output-and-validation.md](references/output-and-validation.md): canonical file layout, required deliverables, validation loop, decision rules, completion standard, and final canonicality conclusion.

## Completion gate

Do not call the IDM canonical until all material source statements are represented or explicitly unresolved, duplicate/variant interactions are defensibly canonicalized, the `.sea` source validates, assumptions and limitations are documented, and downstream agents can project from the model without repeating domain discovery.

Finish the work with exactly one of the two canonicality conclusions defined in [references/output-and-validation.md](references/output-and-validation.md).
