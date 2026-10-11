# Mission: Translate a Purposeful System into an Interaction Domain Model

## Purpose

Given one or more descriptions of a purposeful system, reconstruct the system’s canonical **Interaction Domain Model (IDM)** and represent it in valid `.sea`.

A purposeful system is any organization, product, service, project, program, process, strategy, agent system, institution, or coordinated endeavor formed to pursue a direction, resolve a condition, or produce repeatable outcomes.

Possible source descriptions include:

- enterprise or organization descriptions;
- strategic situations and operating models;
- project charters and scope statements;
- product visions and roadmaps;
- epics, capabilities, user stories, and use cases;
- jobs-to-be-done;
- workflows, SOPs, BPMN, CMMN, and service blueprints;
- policies, requirements, architecture documents, and domain narratives;
- agent missions, tool workflows, and human-agent operating procedures.

Treat every source as **evidence**, not as an automatically correct or canonical model.

The task is not to rewrite the source description. The task is to discover and model the stable interaction structure beneath it.

Do not change the `.sea` grammar. Do not implement application code unless separately authorized.

---

## Desired Outcome

Produce a validated Interaction Domain Model that explains how purpose becomes consequential interaction:

```text
Purpose or desired direction
→ observer or actor
→ current condition
→ intention or job
→ available affordance
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

The model must distinguish a destination from a spendable path. A desired result without actors, preconditions, payment, actions, and settlement access is not yet an affordance.

The finished model should be usable as a semantic source for projections such as:

- web or mobile UI;
- CLI;
- API or MCP tools;
- workflow and case-management definitions;
- agent instructions and authority surfaces;
- documentation and training;
- tests and acceptance criteria;
- telemetry, evidence records, and organizational twins.

---

## Canonical Location

Use one durable source-of-truth location, normally:

```text
.sea/interaction/
```

Use `.agents/sea/` only for temporary working analysis when repository conventions require it. Do not leave competing canonical models.

Recommended structure:

```text
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

---

## Evidence Discipline

Inspect all relevant materials and classify each conclusion as:

- **declared** — explicitly stated by a source;
- **observed** — supported by implemented behavior, tests, records, or artifacts;
- **inferred** — the strongest explanation of multiple evidence sources;
- **proposed** — a recommended structure not yet established;
- **unknown** — insufficient evidence.

Do not silently reconcile contradictions. Record them and explain the modeling decision.

Do not let implementation accidents, document wording, organizational titles, screens, routes, or existing APIs automatically define the canonical domain.

---

## Core Method

Proceed in this order.

### 1. Establish the system boundary

Determine:

- what purposeful system is being modeled;
- its enduring purpose or mission;
- the current situation or unresolved condition;
- the desired direction;
- what is inside and outside the model;
- applicable governance, safety, legal, ethical, or resource constraints;
- what observable settlement would show that the system is functioning.

When the source contains several nested systems, identify their levels explicitly. For example:

```text
Enterprise
→ value stream
→ capability
→ project
→ product
→ feature
→ interaction
```

Do not collapse levels that carry materially different actors, authority, payment, or settlement conditions.

### 2. Extract interaction candidates

From each source statement, extract candidate:

- purposes and directions;
- actors or observers;
- intentions, jobs, needs, problems, threats, and opportunities;
- current and desired states;
- objects, resources, information, and artifacts;
- capabilities and actions;
- constraints and policies;
- outcomes and evidence;
- decisions and recovery paths;
- resulting affordances.

A source phrase may contain several of these at once. Decompose it rather than copying it whole.

### 3. Normalize terminology

Identify synonyms, overloaded words, implementation-specific labels, and inconsistent levels of abstraction.

Create a controlled vocabulary that preserves meaningful domain language while separating:

- actor from role;
- intention from action;
- capability from implementation;
- journey from workflow instance;
- outcome from artifact;
- evidence from assertion;
- possibility from affordance;
- completion from settlement;
- canonical semantics from interface projection.

### 4. Canonicalize interactions

Cluster interaction candidates by their underlying:

- initiating intention or unresolved condition;
- starting state;
- transformation;
- required capability;
- affected object or artifact;
- outcome;
- evidence and settlement condition;
- next decision.

Classify source interactions as:

- canonical;
- specialization;
- variant;
- composition;
- duplicate;
- obsolete;
- ambiguous;
- unsupported.

Prefer explicit variation dimensions—such as actor, object, channel, entry point, lifecycle stage, authority level, risk, exception, or environment—over separate near-identical journeys.

Do not force an arbitrary number of canonical journeys. Seek **minimum sufficient structure**: the smallest model that preserves meaningful differences and explains the evidence.

### 5. Construct the interaction ontology

Use only concepts required by the domain. Candidate concepts include:

- Purpose;
- DesiredDirection;
- Actor;
- Role;
- Intention;
- Job;
- Situation;
- Context;
- Precondition;
- Affordance;
- CanonicalJourney;
- JourneyVariant;
- JourneyStep;
- Action;
- Capability;
- InteractionState;
- StateTransition;
- Resource;
- Artifact;
- Policy;
- Decision;
- Outcome;
- Evidence;
- SettlementCondition;
- RecoveryPath;
- NextAffordance;
- InterfaceProjection.

Model relationships among these concepts, not merely a flat inventory.

### 6. Price the path

Where relevant, represent or document the payment required for an interaction:

- time;
- attention;
- effort or energy;
- money;
- risk;
- coordination;
- emotional or political burden;
- technical debt;
- opportunity cost;
- maintenance;
- externalities.

The IDM need not calculate every payment numerically, but it must not describe a path as available when material preconditions or payment currencies are missing.

### 7. Define journeys and settlement loops

A canonical journey should describe a stable transformation:

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

For each journey define:

- purpose;
- actor and role;
- initiating condition;
- current and desired state;
- preconditions;
- steps;
- capabilities and actions;
- policies and authority;
- artifacts and resources;
- outcomes;
- evidence sources;
- settlement criteria;
- failure and recovery paths;
- next decisions and affordances;
- known variants.

### 8. Define invariants

Encode invariants in `.sea` where supported and document the rest.

Candidate invariants include:

- every journey serves a declared purpose or direction;
- every journey has an initiating actor and condition;
- every variant maps to a canonical journey;
- every journey has explicit entry and settlement conditions;
- every meaningful step changes state, produces or modifies an artifact, exposes evidence, or enables a decision;
- every action maps to a capability and applicable authority;
- every claimed outcome has an evidence path;
- every failure has a recovery affordance or explicit terminal state;
- every settlement makes a next decision visible;
- an interface element is a projection, not a canonical interaction identity;
- multiple interfaces may project the same journey;
- variants may alter conditions without silently redefining canonical semantics.

Use only invariants supported by the domain and intended governance.

### 9. Represent the model in `.sea`

Before authoring:

1. Read the current `.sea` and DomainForge reference material.
2. Inspect valid local examples.
3. Confirm CLI commands and repository conventions.
4. Use only supported syntax.

Represent the interaction model with existing primitives such as entities, roles, resources, flows, relations, instances, policies, metrics, mappings, projections, and concept changes.

Do not invent grammar.

When a concept cannot be expressed cleanly:

- use the nearest valid representation;
- document the semantic compromise;
- preserve traceability in companion artifacts;
- record whether the limitation is local or recurring;
- do not modify the grammar during this task.

### 10. Validate and revise

At minimum run the relevant equivalents of:

```bash
domainforge validate --format human <interaction-model.sea>
domainforge parse --ast --format json <interaction-model.sea>
domainforge parse --format json <interaction-model.sea>
```

Use relevant projection, policy, metric, or generation commands when they materially test the model.

Inspect the resulting AST, graph, diagnostics, and projections for semantic correctness. A passing parser proves that the file is accepted by the tool; it does not prove that the model faithfully describes the system.

Revise until the model validates or a genuine tool limitation is demonstrated and documented.

---

## Translation Rules by Source Type

Apply the same ontology while respecting each source’s representational level.

### Enterprise or organization description

Extract purpose, stakeholders, authority, capabilities, value-producing journeys, resources, evidence, recurring settlements, and external environment.

Do not treat an organizational chart as the interaction model.

### Strategic situation

Extract current reality, desired direction, active problems, needs, threats, opportunities, constraints, actors, candidate transformations, feedback signals, and first spendable paths.

### Project charter or scope statement

Extract intended transformation, sponsor and stakeholders, boundaries, deliverables, capabilities to be created, exclusions, acceptance evidence, risks, and the post-project affordances the project should create.

### Epic

Treat an epic as a candidate canonical journey or composition of journeys. Decompose it when it contains multiple independent intentions or settlements.

### User story

Map:

```text
“As a…” → actor or role
“I want…” → intention or desired capability
“So that…” → purpose, outcome, or next affordance
```

Then add the missing current state, preconditions, payment, actions, evidence, settlement, and recovery conditions. Do not treat the story template as a complete interaction model.

### Job-to-be-Done

Map the job to the settlement sought by the actor. Distinguish functional, social, and emotional conditions where relevant. Add the reachable path, constraints, evidence, and next affordance.

### Use case

Treat it as a journey variant unless evidence shows it represents a stable canonical transformation.

### SOP, BPMN, or workflow

Treat the sequence as an operational projection. Recover the underlying intentions, capabilities, states, policies, artifacts, evidence, exceptions, and settlement conditions. Do not assume every task box is a canonical journey step.

### CMMN or case-management description

Model the case purpose, evolving situation, actors, discretionary affordances, milestones, evidence, constraints, and closure conditions. Preserve uncertainty and discretionary choice rather than forcing a fixed sequence.

### Product or interface description

Treat screens, routes, buttons, dialogs, API calls, and components as projections or bindings. Recover the underlying canonical interactions they expose.

### Agent mission or workflow

Extract agent purpose, authority, tools, information, actions, evidence obligations, stop conditions, escalation paths, recovery behavior, and capability updates. Tool access alone is not capability.

---

## Required Deliverables

### 1. Canonical `.sea` Interaction Domain Model

A valid source model for the system’s interaction ontology, canonical journeys, invariants, and supported projection bindings.

### 2. Source Translation Map

Trace every material source statement to the modeled concepts.

| Source | Source Statement | Extracted Concepts | Canonical Journey | Status | Evidence Class | Notes |
|---|---|---|---|---|---|---|

### 3. Canonical Journey Catalog

Document each journey using the fields defined in this methodology.

### 4. Interaction Grammar Summary

Explain:

- the system’s fundamental verbs and nouns;
- how journeys compose;
- which distinctions are canonical;
- which are variants, operational projections, or implementation bindings;
- which variation dimensions explain the source material.

### 5. Assumptions, Unknowns, and Contradictions

List unresolved semantic questions, conflicting sources, unsupported claims, and decisions that require domain-owner review.

### 6. Validation and Limitation Report

Record:

- DomainForge and CLI versions;
- commands executed;
- validation and parse results;
- errors corrected;
- inspected projections;
- semantic compromises;
- recurring limitations;
- credible future grammar candidates.

A grammar extension is credible only when a concept recurs across materially different domains or journeys, carries enforceable invariants, supports multiple projections, and remains materially lossy under existing constructs.

### 7. Handoff

Explain how another agent or engineer should use the IDM to create UI, API, workflow, backend, documentation, tests, telemetry, or agent projections without rediscovering the domain.

---

## Decision Rules

- Model purpose and consequential interaction before implementation.
- Preserve semantics, not source wording.
- Preserve materially different intentions, authority, payment, or outcomes.
- Prefer composition and explicit variation over duplication.
- Do not confuse resources with affordances or outcomes with final purpose.
- Do not call a destination an affordance until a reachable, payable, governable, settleable path is visible.
- Separate declared, observed, inferred, proposed, and unknown.
- Treat UI, APIs, workflows, and code as projections or evidence.
- Do not invent unsupported capabilities.
- Do not change `.sea` grammar or application code.
- Do not leave invalid or competing canonical models.
- Do not stop at plausible prose; validate the `.sea` model with DomainForge.

---

## Completion Standard

The task is complete when:

- the purposeful system’s boundary, purpose, actors, intentions, transformations, and settlement conditions are explicit;
- all material source statements are represented or explicitly unresolved;
- duplicate and variant interactions are collapsed into a defensible canonical model;
- the Interaction Domain Model exists in valid `.sea`;
- DomainForge has exercised the model;
- assumptions, contradictions, and grammar limitations are documented;
- downstream agents can project the model without repeating domain discovery.

End with exactly one conclusion:

> The Interaction Domain Model is sufficiently stable to serve as the canonical semantic source for downstream projections.

or:

> The Interaction Domain Model should not yet be treated as canonical because the following unresolved semantic issues remain.
