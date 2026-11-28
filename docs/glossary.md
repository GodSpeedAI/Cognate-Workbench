# Cognate Workbench expert and candidate work

Workbench gives operators a place to direct Experts, evaluate their work, and promote local candidate states.

Workbench owns the Expert and Candidate State terms here. The [interaction model](../.sea/interaction/interaction-model.sea) and [candidate settlement workflow](workflows/cognitive-case-settlement.md) are their product sources. See [why the cognitive layer exists](explanation/why-cognitive-layer.md) and [implementation names](reference/terminology-implementation.md) for the existing types, events, operations, and operational vocabulary.

## Language

### Expert work

**Expert**:
A persistent, configurable worker with a specialization and a defined set of tools.

**Team**:
A managed group of Experts with shared tool and delegation limits. An active Team has one Team Lead.

**Team Lead**:
The Team member responsible for coordinating shared work and delegating to Specialists. A Team Lead’s delegation stays within the Team’s authority ceiling and the caller’s grant.

**Specialist**:
A Team member assigned bounded work under the Team Lead’s delegation and the Team’s limits.

**Expert Assignment**:
A durable commitment of work to an Expert with a purpose, acceptance conditions, authority limits, and a return to its requester. Retries can produce new runs against the same commitment.
_Avoid_: Assignment, Case Assignment, Task

**Expert Handoff**:
An Expert’s attributed return of an assignment’s output, artifacts, evidence, uncertainty, or reason for declining or failing.

**Expert Review**:
A separate judgment of an Expert’s handoff, performed with independence from the work under review.

**Assignment Acceptance**:
The operator’s decision to accept the returned work for an Expert Assignment after applicable review and reconciliation.

**Expert Memory**:
Retained, source-attributed material associated with an Expert or Team and scoped for reuse in later work.

**Task**:
An operator-accountable objective that can span multiple runs and Expert Assignments and has its own acceptance conditions.

**Task Acceptance**:
An operator’s decision that a Task satisfies its required criteria.

### Candidate work

**Local Change Case**:
A local navigation view of intended change, a reference state, a candidate state, available moves, and the evidence needed to decide whether to adopt the candidate.
_Avoid_: Managed Case, Purposeful Case

**Execution Manifest**:
The identification-relevant description of a local execution state, including its contents and the semantic, policy, environmental, method, and evaluation inputs under which it is considered.

**Execution State Digest**:
A content-derived identifier for an Execution Manifest. Equal digests denote equal manifest content under the same scheme.
_Avoid_: World Reference, world identity (unqualified)

**Candidate State**:
A disposable fork of a locally accepted execution state in which a change is tried before adoption.
_Avoid_: Candidate world, semantic world

**Candidate Promotion**:
An operator’s adoption of a Candidate State as the current local baseline, after applicable verification and a check that its parent is current.
_Avoid_: World settlement, operational settlement

**Frozen Criterion**:
The evaluation conditions and observer coverage held fixed for a candidate’s verification.

**Affordance Block**:
An assessed condition preventing a candidate move from becoming spendable.

**Steering**:
Operator input directed to either the next boundary of a live run or the next turn.

**Grounded Feedback**:
An operator’s requested change bound to specific observed material.

**Tool**:
A model-facing way to request an effect through the applicable operation boundary.

**Permission Rule**:
The rule for a task authority dimension, which can permit, deny, or require approval for a class of effects.

**Protected Evidence**:
Work material whose modification is restricted so that the work being evaluated cannot silently rewrite its basis.

### Work definitions

**Task Contract**:
The goal, scope, limits, and outcome conditions under which a Task can be carried out and accepted.

**Acceptance Criterion**:
A checkable condition that an operator requires or considers when accepting a Task.

**Work Evidence**:
A Workbench record of [Evidence](https://github.com/GodSpeedAI/godspeed-growth/blob/main/new_world/glossary.md#infrastructure-terms) bound to a condition for the work being evaluated.

**Done Level**:
A claim about how far work has progressed from producing an output through verification, acceptance, or operational use.

**Workflow**:
A graph of work whose steps become eligible according to the recorded outcomes of preceding work.

**Automation**:
An accepted Workflow with its inputs, trigger, execution conditions, and outcome gate specified.

**Semantic Surface**:
A declarative representation of information and available interactions at the point of work.

**External Harness Session**:
An ongoing interaction with an external agent environment bound to a local execution context and its applicable limits.

### Interaction and recorded state

**Workbench Event**:
An immutable record of a fact in Workbench’s application history. The event is the source for reconstructing local state.

**Workbench Projection**:
A rebuildable view of Workbench state derived from recorded events.

**Interaction Model**:
The declarative vocabulary of Workbench’s interactions and their relationships.

**Capability Binding**:
The mapping that connects a declared interaction to the Capability Contract that can handle it.

**Workbench Journey**:
An end-to-end proof scenario declared by the Workbench Interaction Model.

**Task Authority Scope**:
The combined Permission Rules for a Task’s effects. A task without explicit scope uses the application defaults.

**Review Gate**:
The requirement that a human accept a Task after its required evidence is ready. A run’s actor cannot accept its own work.

**Installed Skill**:
An installed work procedure with a lifecycle and an implementation binding. Installation alone establishes neither effective authority nor CognitiveOS Capability.

**Recorded State**:
Workbench’s account of facts reconstructed from durable events. An uncorroborated agent claim supplies no independent observation.

**Mediation**:
Ordered invocation checks that preserve the authority of higher-trust policy. Lower-trust checks cannot relax a required approval.

**Focus**:
The operator’s current attention in Workbench. Focus conveys no authority.

**Method**:
An approach evaluated against its observed consequences. An operator decides whether to adopt a recommended method.

**Workbench Observation Delivery**:
Delivery of an observation derived from Workbench’s local event stream to RealityTrace. Delivery supplies neither verification nor settlement standing.

### Shared terms

Cognate owns [Agent Procedure, Run, Continuation, Execution World and Capability Contract](https://github.com/GodSpeedAI/Cognate/blob/29dcd1e/packages/runtime-api/README.md). An Expert, its procedure, its authenticated principal and its Run have distinct lifecycles. A local Execution State Digest cannot supply a [DomainForge World Reference](https://github.com/GodSpeedAI/DomainForge/blob/35c4ed1/docs/reference/sea-application-contract.md#L931-L957).

The [SEA-Forge Case Assignment](https://github.com/GodSpeedAI/SEA-Forge/blob/main/docs/reference/terminology.md) names a case-bound attempt. An Expert Assignment may refer to it when explicitly bound. Candidate Promotion and Assignment Acceptance carry local standing. SEA-Forge owns its Operational Settlement and Settlement Receipt.

See [CognitiveOS Affordance](https://github.com/GodSpeedAI/godspeed-growth/blob/main/new_world/glossary.md#navigation-terms) for the source term. Workbench records both assessed moves and Affordance Blocks. RealityTrace owns [Observation and Verification Result](https://github.com/GodSpeedAI/RealityTrace/blob/42f38ca/sxr-core/src/types.rs#L207).
