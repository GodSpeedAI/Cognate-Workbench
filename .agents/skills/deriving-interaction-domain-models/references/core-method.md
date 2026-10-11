# Core Interaction Domain Modeling Method

## Contents

* System boundary
* Interaction candidate extraction
* Terminology normalization
* Canonicalization
* Interaction ontology
* Pricing the path
* Canonical journeys and settlement loops
* Invariants
* `.sea` representation rules
* Semantic validation

## System boundary

Determine:

* the purposeful system being modeled;
* its enduring purpose or mission;
* the current situation or unresolved condition;
* the desired direction;
* what is inside and outside the model;
* applicable governance, safety, legal, ethical, or resource constraints;
* what observable settlement would show the system is functioning.

When the evidence contains nested systems, identify their levels explicitly. A useful starting hierarchy is:

```text
enterprise
→ value stream
→ capability
→ project
→ product
→ feature
→ interaction
```

Do not collapse levels that carry materially different actors, authority, payment, or settlement conditions.

## Interaction candidate extraction

From each material source statement extract candidate:

* purposes and directions;
* actors or observers;
* intentions, jobs, needs, problems, threats, and opportunities;
* current and desired states;
* objects, resources, information, and artifacts;
* capabilities and actions;
* constraints and policies;
* outcomes and evidence;
* decisions and recovery paths;
* resulting affordances.

A single source phrase may contain several of these. Decompose it instead of copying it whole.

## Terminology normalization

Identify synonyms, overloaded words, implementation-specific labels, and inconsistent abstraction levels.

Create a controlled vocabulary that preserves meaningful domain language while separating:

* actor from role;
* intention from action;
* capability from implementation;
* journey from workflow instance;
* outcome from artifact;
* evidence from assertion;
* possibility from affordance;
* completion from settlement;
* canonical semantics from interface projection.

## Canonicalization

Cluster interaction candidates by their underlying:

* initiating intention or unresolved condition;
* starting state;
* transformation;
* required capability;
* affected object or artifact;
* outcome;
* evidence and settlement condition;
* next decision.

Classify source interactions as:

* canonical;
* specialization;
* variant;
* composition;
* duplicate;
* obsolete;
* ambiguous;
* unsupported.

Prefer explicit variation dimensions such as actor, object, channel, entry point, lifecycle stage, authority level, risk, exception, or environment over separate near-identical journeys.

Do not force an arbitrary number of canonical journeys. Seek **minimum sufficient structure**: the smallest model that preserves meaningful differences and explains the evidence.

## Interaction ontology

Use only concepts required by the domain. Candidate concepts include:

* Purpose;
* DesiredDirection;
* Actor;
* Role;
* Intention;
* Job;
* Situation;
* Context;
* Precondition;
* Affordance;
* CanonicalJourney;
* JourneyVariant;
* JourneyStep;
* Action;
* Capability;
* InteractionState;
* StateTransition;
* Resource;
* Artifact;
* Policy;
* Decision;
* Outcome;
* Evidence;
* SettlementCondition;
* RecoveryPath;
* NextAffordance;
* InterfaceProjection.

Model relationships among concepts rather than producing a flat inventory.

## Pricing the path

Where relevant, represent or document the payment required for an interaction:

* time;
* attention;
* effort or energy;
* money;
* risk;
* coordination;
* emotional or political burden;
* technical debt;
* opportunity cost;
* maintenance;
* externalities.

The IDM need not price every payment numerically, but it must not describe a path as available when material preconditions or payment currencies are missing.

## Canonical journeys and settlement loops

A canonical journey describes a stable transformation:

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

## Invariants

Encode invariants in `.sea` where supported and document the rest.

Candidate invariants include:

* every journey serves a declared purpose or direction;
* every journey has an initiating actor and condition;
* every variant maps to a canonical journey;
* every journey has explicit entry and settlement conditions;
* every meaningful step changes state, produces or modifies an artifact, exposes evidence, or enables a decision;
* every action maps to a capability and applicable authority;
* every claimed outcome has an evidence path;
* every failure has a recovery affordance or explicit terminal state;
* every settlement makes a next decision visible;
* an interface element is a projection, not a canonical interaction identity;
* multiple interfaces may project the same journey;
* variants may alter conditions without silently redefining canonical semantics.

Use only invariants supported by the domain and intended governance.

## `.sea` representation rules

Use the `domainforge-sea` skill as the authoritative source for `.sea` syntax, supported primitives, DomainForge CLI behavior, examples, and representation conventions.

Before authoring or modifying `.sea`:

1. Use the `domainforge-sea` skill.
2. Inspect relevant repository `.sea` sources and local conventions.
3. Follow the syntax and constructs supported by the installed DomainForge version.
4. Preserve the IDM semantics defined by this skill while delegating representation mechanics to `domainforge-sea`.

This skill defines **what interaction semantics must be represented**. The `domainforge-sea` skill defines **how those semantics may validly be expressed in `.sea`**.

Do not invent grammar.

When an IDM concept cannot be expressed cleanly with currently supported `.sea`:

* preserve the semantic requirement;
* use the nearest valid representation recommended by `domainforge-sea`;
* document the semantic compromise;
* preserve traceability in companion artifacts;
* record whether the limitation is local or recurring;
* do not modify the grammar during this task.

## Semantic validation

Use the `domainforge-sea` skill to determine and execute the appropriate validation, parsing, inspection, projection, policy, metric, or generation operations for the installed DomainForge version.

Do not hardcode CLI commands here when `domainforge-sea` owns current DomainForge usage.

After tool-level validation, inspect the resulting semantic structures, diagnostics, graph, AST, and relevant projections as available.

A passing parser proves that DomainForge accepts the model. It does not prove that the model faithfully represents the purposeful system.

This skill remains responsible for semantic correctness of the Interaction Domain Model. `domainforge-sea` remains responsible for correct `.sea` and DomainForge usage.

Revise until both conditions hold:

1. the representation is valid according to `domainforge-sea` and DomainForge; and
2. the resulting model satisfies the IDM semantics and invariants defined by this skill.

If they cannot both be satisfied, document the specific representation limitation and preserve the unresolved semantic requirement.
