# Output, Validation, and Completion Standard

## Contents

* Canonical location
* Required deliverables
* Source Translation Map
* Canonical Journey Catalog
* Interaction Grammar Summary
* Assumptions, Unknowns, and Contradictions
* Validation and Limitation Report
* Handoff
* Decision rules
* Completion standard
* Final canonicality conclusion

## Canonical location

Use one durable source-of-truth location, normally:

```text id="f6j0dx"
.sea/interaction/
```

Use `.agents/sea/` only for temporary working analysis when repository conventions require it. Do not leave competing canonical models.

Recommended structure:

```text id="17siar"
.sea/interaction/
├── interaction-model.sea
├── README.md
├── source-translation-map.md
├── canonical-journey-catalog.md
├── assumptions-and-unknowns.md
├── handoff.md
└── validation/
    ├── domainforge-output.txt
    ├── diagnostics.md
    └── limitations.md
```

Prefer one coherent validated `.sea` source when module boundaries would fragment the modeled world. Split only when DomainForge semantics and repository conventions preserve coherence without duplication.

## Required deliverables

### 1. Canonical `.sea` Interaction Domain Model

Produce a valid source model for the system's interaction ontology, canonical journeys, invariants, and supported projection bindings.

### 2. Source Translation Map

Trace every material source statement to modeled concepts.

Use these columns:

| Source | Source Statement | Extracted Concepts | Canonical Journey | Status | Evidence Class | Notes |
| ------ | ---------------- | ------------------ | ----------------- | ------ | -------------- | ----- |

The translation map must make it possible to determine whether each material source statement is:

* represented;
* canonicalized into another interaction;
* treated as a variant or projection;
* contradicted by other evidence;
* unsupported;
* ambiguous;
* intentionally excluded;
* still unresolved.

Do not silently drop material source evidence.

### 3. Canonical Journey Catalog

Document every canonical journey using the fields defined in the core methodology, including:

* purpose;
* actor and role;
* initiating condition;
* current and desired state;
* preconditions;
* steps;
* capabilities and actions;
* policies and authority;
* artifacts and resources;
* outcomes;
* evidence sources;
* settlement criteria;
* failure and recovery paths;
* next decisions and affordances;
* known variants.

The catalog should expose why multiple source interactions were merged, separated, specialized, or treated as variants.

### 4. Interaction Grammar Summary

Explain:

* the system's fundamental verbs and nouns;
* how journeys compose;
* which distinctions are canonical;
* which are specializations or variants;
* which structures are operational projections;
* which structures are implementation or interface bindings;
* which variation dimensions explain the source material.

The summary should let a downstream agent understand the modeled interaction language without rediscovering the domain.

### 5. Assumptions, Unknowns, and Contradictions

Record:

* unresolved semantic questions;
* conflicting source claims;
* unsupported assumptions;
* ambiguous terminology;
* missing evidence;
* proposed interpretations;
* decisions requiring domain-owner review.

Classify material conclusions using the skill's evidence discipline:

* declared;
* observed;
* inferred;
* proposed;
* unknown.

Do not silently reconcile contradictions.

When choosing one interpretation over another, record:

* the competing interpretations;
* the evidence supporting each;
* the selected modeling decision;
* the evidence class of that decision;
* what evidence would overturn it.

### 6. Validation and Limitation Report

Record:

* DomainForge version;
* relevant CLI version information;
* commands executed;
* validation results;
* parse results;
* inspected AST, graph, diagnostics, or projections;
* errors discovered;
* corrections made;
* remaining diagnostics;
* semantic compromises;
* unsupported representations;
* recurring limitations;
* credible future grammar candidates;
* `domainforge-sea` skill usage and any relevant guidance or constraints it established.

Use `domainforge-sea` for DomainForge and `.sea` validation mechanics. Parser or validator success is necessary but not sufficient for IDM semantic correctness.

A grammar extension is a credible future candidate only when the concept:

* recurs across materially different domains or journeys;
* carries meaningful enforceable invariants;
* supports multiple downstream projections;
* remains materially lossy under existing constructs.

Do not modify the `.sea` grammar during the modeling task.

If the current grammar cannot represent a concept cleanly:

1. use the nearest valid representation;
2. document the semantic compromise;
3. preserve traceability to the source evidence;
4. record whether the limitation appears local or recurring;
5. continue with valid `.sea` rather than inventing syntax.

### 7. Handoff

Explain how another agent, engineer, analyst, or designer should use the IDM to create downstream projections without repeating domain discovery.

Address relevant projections such as:

* UI;
* CLI;
* API;
* MCP tools;
* workflows;
* case-management definitions;
* backend implementation;
* documentation;
* training;
* tests and acceptance criteria;
* telemetry and evidence records;
* agent instructions;
* authority surfaces;
* organizational twins.

The handoff must preserve the distinction between canonical semantics and projections.

Downstream implementations may differ in interface or mechanism while still projecting the same canonical journey.

## Decision rules

* Model purpose and consequential interaction before implementation.
* Preserve semantics, not source wording.
* Treat source descriptions as evidence rather than automatically canonical structures.
* Preserve materially different intentions, authority, payment, transformations, outcomes, or settlement conditions.
* Prefer composition and explicit variation over duplication.
* Seek minimum sufficient structure rather than an arbitrary number of journeys.
* Do not confuse actor with role.
* Do not confuse intention with action.
* Do not confuse capability with implementation or tool access.
* Do not confuse resources with affordances.
* Do not confuse artifacts with outcomes.
* Do not confuse evidence with assertion.
* Do not confuse completion with settlement.
* Do not confuse interface elements with canonical interaction identities.
* Do not call a destination an affordance until a reachable, payable, governable, settleable path is visible.
* Separate declared, observed, inferred, proposed, and unknown conclusions.
* Treat UI, APIs, workflows, code, tools, and organizational structures as projections or evidence unless the domain establishes otherwise.
* Do not invent unsupported capabilities.
* Do not invent `.sea` syntax.
* Do not change `.sea` grammar or application code unless separately authorized.
* Do not leave invalid or competing canonical models.
* Do not silently reconcile contradictory evidence.
* Do not stop at plausible prose.
* Validate the `.sea` model with DomainForge and inspect its resulting semantic structure.

## Completion standard

The task is complete only when:

* the purposeful system's boundary is explicit;
* its purpose or desired direction is explicit;
* relevant actors and roles are explicit;
* initiating conditions and intentions are explicit;
* current and desired states are explicit where material;
* reachable affordances are distinguished from mere possibilities or destinations;
* material preconditions and payment are represented where they affect reachability;
* capabilities and actions are explicit;
* relevant authority and policies are explicit;
* canonical transformations are explicit;
* artifacts and resources are correctly distinguished from outcomes;
* evidence paths exist for material claimed outcomes;
* settlement conditions are observable;
* failure and recovery paths are represented or explicitly terminal;
* next decisions and affordances are visible;
* all material source statements are represented or explicitly unresolved;
* duplicate and variant interactions are collapsed into a defensible canonical structure;
* meaningful variation dimensions are preserved;
* the Interaction Domain Model exists in valid `.sea`;
* the installed DomainForge tooling has exercised the model;
* parser or validator success has been supplemented by semantic inspection;
* assumptions, contradictions, unknowns, and grammar limitations are documented;
* no competing canonical source has been left behind;
* downstream agents can project from the model without repeating domain discovery.

## Final canonicality conclusion

End the work with exactly one of the following conclusions.

If the completion standard is satisfied:

> The Interaction Domain Model is sufficiently stable to serve as the canonical semantic source for downstream projections.

If unresolved semantic issues prevent canonicality:

> The Interaction Domain Model should not yet be treated as canonical because the following unresolved semantic issues remain.

When using the second conclusion, immediately enumerate the unresolved semantic issues that prevent canonicality.
