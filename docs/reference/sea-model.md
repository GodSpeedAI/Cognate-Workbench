# Reference: the semantic model

`.sea/interaction/interaction-model.sea` is the domain's naming contract. This page explains how to
read it. It does not restate its content — the model and its companion documents are canonical and
live beside it.

## Where it lives

```
.sea/interaction/
  interaction-model.sea          the canonical model (644 lines)
  README.md                      what the files are
  source-translation-map.md      each source statement → the concept it became
  canonical-journey-catalog.md   the journeys, with ids
  assumptions-and-unknowns.md    declared / observed / inferred / proposed / unknown
  handoff.md                     how to project the model into runtime constructs
  validation/
    domainforge-output.txt       a DomainForge CLI validation record
    cognate-adapter-output.txt   a Cognate-adapter validation record
    check-cognate-adapter.ts     the adapter check script
    limitations.md               what the validation does and does not establish
```

Start at `.sea/interaction/README.md`.

## How it is consumed

`domain/index.ts` reads the file directly through `loadSemanticProjection`. No copy, no symlink. The
boot sequence logs the object count and the digest, and **fails fast** on a parse error, so a
malformed model stops the process rather than producing a half-mounted runtime.

`GET /health` returns `{ ok, semantic: { objects, digest } }`, which is a quick way to confirm the
model parsed.

## The representation compromise

DomainForge's `.sea` grammar has no native Journey, Affordance, or Actor primitive. The model
represents them as:

| Concept | Representation |
|---|---|
| A canonical journey | `Instance … of "CanonicalJourney"`, with narrative carried in string fields |
| Actors and system/domain objects | `Entity` |
| The approval-authorisation interaction | one `Role` / `Relation` pair |
| Occurrence counts | `quantity 1`, meaning "one occurrence of this canonical transformation" — **not** a measured count |

The model has 31 distinct `Entity` declarations and 62 `Entity` / `Instance` records. The compromise
is documented in the file's header and in `assumptions-and-unknowns.md` rather than being silent.

## Entities

Approval-related: `ApprovalGate`, `ApprovalAuthority`
Configuration: `User`, `UserPreferences`, `ModelProvider`
Work: `Session`, `Goal`, `Task`, `TaskContract`, `PlanMode`, `ReviewGate`, `EvidenceLedger`,
`UsageLedger`, `WorkerReturn` (as a role rather than an entity)
Capability: `Tool`, `SkillCapability`, `CapabilityImplementation`
Execution: `WorkspaceRecord`, `ExecutionWorld`, `WorldConnection`
Coordination: `ChildAgent`, `Subagent`, `SteeringInbox`, `Automation`, `Workflow`, `ParallelPlan`
Governance: `ProtectedEvidence`, `GroundedFeedback`
Interaction: `OperatorAgent`, `Composer`, `AttentionFocus`, `CanonicalJourney`

## Journeys

Ten canonical journeys, each with a purpose, an actor, steps, capabilities, settlement and variants.
They are in `canonical-journey-catalog.md`, with stable ids like `j_a_first_use`, `j_d_approval`,
`j_e_plan`, `j_f_delegation`, `j_wb_task_contract`.

Tests are named after these ids, which is what makes an unimplemented journey visible as a missing
`J-*.test.ts`. See [Test layout](test-layout.md).

## Assumptions

`assumptions-and-unknowns.md` classifies every material conclusion as declared, observed, inferred,
proposed, or unknown, and lists unresolved semantic questions and contradictions. `handoff.md`
describes how a downstream agent should project the model into real Cognate constructs without
repeating domain discovery.

**That classification is the honest place to look** when you need to know whether a statement about
this domain is evidence or inference.

## Changing the model

`AGENTS.md`: preserve the semantic ids unless performing an explicit data migration.

Renaming an entity touches `domain/index.ts` — every `domain.semanticId("…")` call — and anything
keyed on the name. Because bindings assert their expected count, a lost binding is a boot failure
rather than a silent regression.

Adding an entity for a capability you are adding is the preferred path, so the model stays complete.
Leaving a capability unbound is a recorded gap, not a neutral state.

## What validation does and does not establish

`validation/` holds records, not continuous checking. Read `validation/limitations.md` before citing
them as evidence: a validation record says the model parsed at a point in time under a particular
tool version. It does not say the model is complete or correct.

## Source trail

- `.sea/interaction/interaction-model.sea` — the model
- `.sea/interaction/README.md` — the file list and the representation compromise
- `.sea/interaction/canonical-journey-catalog.md` — the journeys
- `.sea/interaction/assumptions-and-unknowns.md` — the evidence classification
- `.sea/interaction/handoff.md` — how to project into runtime constructs
- `.sea/interaction/source-translation-map.md` — source statement → concept
- `.sea/interaction/validation/limitations.md` — what validation establishes
- `domain/index.ts` — `loadDomain` and every binding
- `src/server.ts` — the boot call and the `/health` response
- `AGENTS.md` — the semantic-id stability rule
- [`../concepts/capability-model.md`](../concepts/capability-model.md) — the chain from a name to a
  running capability