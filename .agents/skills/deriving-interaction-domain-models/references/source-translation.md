# Source Translation Rules

## Contents

* General rule
* Enterprise or organization descriptions
* Strategic situations
* Project charters and scope statements
* Epics
* User stories
* Jobs-to-be-Done
* Use cases
* SOPs, BPMN, and workflows
* CMMN and case management
* Product and interface descriptions
* Agent missions and workflows

## General rule

Apply the same interaction ontology while respecting the representational level of each source.

Source artifacts are evidence and projections. Do not assume their native structure is canonical.

Recover the stable interaction structure beneath the source rather than preserving the source's native format by default.

Where source artifacts disagree, preserve the contradiction and classify the modeling decision according to the evidence discipline rather than silently reconciling them.

## Enterprise or organization descriptions

Extract:

* purpose;
* desired direction;
* stakeholders;
* actors and roles;
* authority;
* capabilities;
* value-producing journeys;
* resources;
* policies and constraints;
* outcomes;
* evidence;
* recurring settlements;
* external environment;
* resulting affordances.

Do not treat an organizational chart as the interaction model.

Organizational units and titles may provide evidence about actors, roles, authority, resources, or responsibility, but they do not automatically define canonical journeys.

## Strategic situations

Extract:

* current reality;
* desired direction;
* active problems;
* needs;
* threats;
* opportunities;
* constraints;
* actors;
* authority;
* candidate transformations;
* capabilities;
* resources;
* feedback signals;
* evidence;
* settlement conditions;
* first spendable paths.

A strategic destination is not yet an affordance.

Recover the reachable, payable, governable, settleable path from current condition toward desired direction.

Distinguish:

* desired direction from current affordance;
* strategic choice from implementation activity;
* proposed initiative from established capability;
* expected result from observable evidence;
* milestone from settlement.

Where several initiatives pursue the same underlying transformation, test whether they are variants, compositions, projections, or competing means rather than separate canonical journeys.

## Project charters and scope statements

Extract:

* intended transformation;
* sponsor and stakeholders;
* initiating condition;
* current and desired states;
* boundaries;
* exclusions;
* deliverables;
* capabilities to be created;
* authority;
* constraints;
* dependencies;
* risks;
* acceptance evidence;
* settlement criteria;
* post-project affordances the project should create.

Do not mistake project deliverables for the purposeful system's enduring purpose.

A project may settle when agreed deliverables and acceptance conditions are satisfied, while the capabilities or affordances created by the project continue afterward.

Distinguish:

* project completion from operational settlement;
* deliverable from capability;
* capability from implementation;
* acceptance criterion from broader outcome;
* project artifact from post-project affordance.

## Epics

Treat an epic as a candidate canonical journey, specialization, or composition of journeys.

Decompose it when it contains multiple independent:

* intentions;
* initiating conditions;
* transformations;
* actors or authority boundaries;
* settlement conditions;
* materially different outcomes.

Do not preserve epic boundaries merely because the source organizes work that way.

Several epics may project the same canonical journey, and one epic may contain several canonical journeys.

## User stories

Map:

```text
"As a..." → actor or role
"I want..." → intention or desired capability
"So that..." → purpose, outcome, or next affordance
```

Then recover what the story template usually omits:

* initiating condition;
* current state;
* desired state;
* preconditions;
* context;
* material payment;
* authority;
* actions;
* capabilities;
* affected artifacts or resources;
* evidence;
* settlement criteria;
* failure paths;
* recovery paths;
* next decisions and affordances.

Do not treat the user-story template as a complete interaction model.

Do not assume two stories are distinct canonical journeys simply because they have different actors, screens, channels, or wording.

Test whether those differences are better represented as explicit variation dimensions.

## Jobs-to-be-Done

Map the job to the settlement sought by the actor.

Identify:

* actor;
* situation or initiating condition;
* intention;
* desired progress or transformation;
* functional conditions;
* social conditions;
* emotional conditions;
* constraints;
* available affordances;
* material payment;
* evidence of progress;
* settlement condition;
* next affordance.

Do not stop at the desired outcome.

Add the reachable path by which the actor can actually spend time, attention, effort, money, risk, coordination, or other relevant payment to achieve settlement.

Distinguish the job from any particular product, interface, or implementation used to satisfy it.

## Use cases

Treat a use case as a candidate journey variant unless evidence shows it represents a stable canonical transformation.

Recover:

* initiating actor;
* initiating condition;
* intention;
* preconditions;
* main transformation;
* capabilities;
* state changes;
* artifacts;
* policies;
* evidence;
* settlement;
* alternate paths;
* failure and recovery;
* next affordances.

Use explicit variation dimensions instead of proliferating near-identical canonical journeys.

A use case may become canonical when its transformation, authority, settlement, or consequential outcome is materially distinct rather than merely a different scenario or channel.

## SOPs, BPMN, and workflows

Treat the sequence as an operational projection.

Recover the underlying:

* purpose;
* actors and roles;
* initiating conditions;
* intentions;
* states;
* capabilities;
* actions;
* authority;
* policies;
* resources;
* artifacts;
* evidence;
* decisions;
* exceptions;
* recovery paths;
* settlement conditions;
* next affordances.

Do not assume every task box is a canonical journey step.

A workflow task may instead represent:

* an implementation detail;
* an interface action;
* a policy checkpoint;
* evidence collection;
* coordination overhead;
* a decision;
* a projection of a broader capability.

Do not assume workflow order defines canonical semantics when sequencing exists only because of the current implementation.

Preserve sequencing when order is required by causality, authority, policy, safety, evidence, or settlement.

## CMMN and case management

Model:

* case purpose;
* evolving situation;
* actors and roles;
* intentions;
* discretionary affordances;
* authority;
* capabilities;
* milestones;
* resources and artifacts;
* evidence;
* policies and constraints;
* decisions;
* exceptions;
* recovery paths;
* closure or settlement conditions;
* next affordances.

Preserve uncertainty, discretionary choice, and changing context rather than forcing a fixed sequence.

Distinguish milestones from settlement when a milestone records progress but does not resolve the case's governing condition.

Case closure should be supported by observable evidence and explicit settlement conditions rather than administrative status alone.

## Product and interface descriptions

Treat:

* screens;
* pages;
* routes;
* buttons;
* dialogs;
* forms;
* menu items;
* components;
* API calls;
* endpoints;
* commands;
* tool invocations

as projections or bindings unless evidence establishes that they represent distinct canonical semantics.

Recover the canonical interactions they expose.

An interface element is not itself a canonical interaction identity.

Multiple interfaces may project the same canonical journey.

A single interface may expose several journeys.

Separate:

* intention from click or command;
* capability from endpoint;
* affordance from visible control;
* journey from navigation path;
* outcome from response payload;
* settlement from success message.

Interface differences should become canonical distinctions only when they correspond to materially different intentions, authority, payment, transformations, outcomes, or settlement conditions.

## Agent missions and workflows

Extract:

* agent purpose;
* initiating condition;
* actor or delegating authority;
* agent role;
* delegated intention;
* authority boundaries;
* tools;
* information and context;
* capabilities;
* actions;
* policies;
* constraints;
* artifacts;
* evidence obligations;
* decisions;
* stop conditions;
* escalation paths;
* failure conditions;
* recovery behavior;
* settlement conditions;
* capability updates;
* next affordances.

Tool access alone is not capability.

Capability requires a consequential, governable path that can produce supported outcomes and evidence within applicable authority.

Distinguish:

* tool availability from permission;
* permission from capability;
* capability from successful execution;
* successful execution from settlement;
* generated output from evidence;
* agent autonomy from delegated authority.

Model escalation when the agent encounters:

* insufficient authority;
* missing evidence;
* unresolved ambiguity;
* policy conflict;
* unacceptable risk;
* unavailable capability;
* failed recovery;
* conditions requiring human judgment.

Do not treat an agent's current prompt, orchestration graph, or tool chain as canonical merely because it is implemented.

Recover the stable interaction semantics that human, agent, or hybrid implementations may project.
