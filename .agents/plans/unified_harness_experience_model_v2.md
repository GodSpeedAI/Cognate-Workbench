# Unified Harness Experience Model
## Synthesis of the DeepSeek Harness and Bamboo Frontend Reconstructions as One Product

## Executive Thesis

Treat both walkthroughs as demonstrations of different workflows inside the **same underlying harness**.

The unified product is not a coding chat application and not merely a multi-agent IDE.

It is a:

# Capability-Native Agent Workbench

that turns intent into verified work by coordinating:

- bounded context;
- business/domain invariants;
- reusable skills/capabilities;
- structured representations;
- model/runtime selection;
- authority;
- delegation topology;
- active steering;
- artifacts;
- evidence;
- review;
- automation;
- cost/resource controls.

The fundamental loop is:

> **Understand → Represent → Contract → Actualize → Observe → Steer → Verify → Refine → Review → Operationalize**

The harness exists to make that loop explicit, composable, inspectable, and reusable.

---

# 1. One Unified Product Model

The two demonstrations reveal complementary halves of the same operating system.

## Workflow A — Business / analytical work
The user:
- selects a workspace;
- defines business rules;
- protects evidence;
- gives bounded authority;
- repairs logic;
- verifies tests and calculations;
- creates a report;
- inspects artifacts;
- steers the agent;
- refines the UI without corrupting business semantics;
- creates/installs a capability;
- schedules recurring work.

## Workflow B — Design / frontend work
The user:
- selects a project;
- assembles skills;
- defines product outcomes;
- distills references;
- sketches structure;
- persists design/product state;
- builds one anchor slice;
- inspects runtime behavior;
- grounds corrections to real elements;
- decomposes work;
- delegates independent components;
- integrates;
- audits;
- polishes;
- tests journeys;
- branches experiments;
- reviews changes.

These are not separate product concepts.

They are two domain-specific traversals through the same harness primitives.

---

# 2. The Unified Harness Object Model

The harness should have the following first-class objects.

## 2.1 Workspace

A durable boundary containing:
- files;
- project state;
- sessions;
- artifacts;
- capabilities;
- automations;
- product/domain representations;
- evidence;
- policies;
- branches/variants.

A workspace can exist without being active.

A task must explicitly bind to a workspace.

### Invariant
**Workspace existence ≠ task scope.**

---

## 2.2 Task

A bounded unit of intentional work.

A task has:
- goal;
- context;
- invariants;
- authority;
- capabilities;
- executor topology;
- budget;
- acceptance criteria;
- active state;
- evidence;
- artifacts.

The task is the economic and governance unit.

A user message is merely an input to a task.

---

## 2.3 Task Contract

The unified task contract should be visible before execution.

Recommended compact form:

> **Context | Goal | Skills | Authority | Executors | Budget | Invariants | Acceptance**

Expanded form:

### Context
- active workspace;
- selected files/objects;
- branch/worktree;
- attached representations.

### Goal
- user outcome;
- deliverable;
- explicit non-goals.

### Skills
- capability contracts required by the task;
- implementation bindings;
- conflicts/complements.

### Authority
- filesystem;
- shell;
- network;
- package install;
- destructive operations;
- approval policy.

### Executors
- primary model;
- architect;
- workers;
- verifier;
- provider/billing routes.

### Budget
- time;
- token/usage;
- cost;
- concurrency;
- provider quotas.

### Invariants
- business/domain rules;
- design/product rules;
- protected evidence;
- safety/governance constraints.

### Acceptance
- tests;
- user journeys;
- independent checks;
- review gates;
- human approval if required.

---


# 2.4 Workflow

A **Workflow** is a durable, reusable graph of purposeful work.

It is not just a sequence of prompts and not merely a board of tasks.

A workflow defines:

- the intended business/user outcome;
- ordered and conditional stages;
- capabilities required at each stage;
- representations consumed and produced;
- invariants inherited across stages;
- role/executor assignments;
- authority boundaries;
- parallelizable branches;
- review/acceptance gates;
- evidence requirements;
- budgets and resource constraints;
- failure/recovery paths;
- operationalization/scheduling rules.

A workflow can be instantiated many times against different workspaces, inputs, users, models, or providers without changing its semantic identity.

### Example

`Frontend Product Actualization`

```text
Product Briefing
    ↓
Reference Distillation ─┐
Structural Sketch ──────┼─► Design Model
                        │
                        ▼
                Anchor Implementation
                        ↓
                 Runtime Inspection
                        ↓
                Direction Accepted?
                   ↙          ↘
                 no            yes
                 ↓              ↓
          Grounded Repair   Work Decomposition
                                ↓
                      ┌─────────┴─────────┐
                      ▼                   ▼
                  Worker A            Worker B
                      └─────────┬─────────┘
                                ▼
                            Integration
                                ↓
                    Audit → Polish → Verify
                                ↓
                              Review
                                ↓
                              Accept
```

The same workflow can bind:
- Impeccable or another design implementation;
- Playwright or Jev for browser verification;
- Opus, Flash, DeepSeek, or local models as executors.

The workflow is stable while those bindings change.

### Workflow Invariant

> **Workflow identity lives in the dependency and acceptance structure, not in the tools used to execute it.**


# 3. The Skill OS

The central synthesis is that capabilities should be stable semantic objects while their implementations and executors remain replaceable.

The harness should model:

> **Capability Contract → Implementation Binding → Executor Binding**

---

## 3.1 Capability Contract

Defines **what kind of work must happen**.

Examples:

- Product Briefing
- Domain Rule Extraction
- Reference Distillation
- Structural Sketch
- Design Initialization
- Frontend Actualization
- Code Repair
- Artifact Generation
- Runtime Preview
- Grounded Feedback
- Independent Verification
- Accessibility Audit
- Visual Polish
- Work Decomposition
- Parallel Implementation
- Team Supervision
- Browser Journey Verification
- Change Review
- Capability Creation
- Automation Scheduling
- Outcome Verification
- Variant Experimentation

A capability contract should remain stable even if its implementation changes.

---

## 3.2 Implementation Binding

Defines **which mechanism realizes the capability**.

Examples:

`Visual Polish`
→ Impeccable `/polish`

`Browser Journey Verification`
→ Playwright testing skill

`Browser Journey Verification`
→ Jev browser alternative

`Structural Sketch`
→ native sketch surface

`Reference Distillation`
→ native moodboard surface

`Capability Creation`
→ Creator mode

`Automation Scheduling`
→ Automation Tasks plugin

A package can expose multiple capabilities.

Example:

```text
Impeccable
Provides:
- Design Initialization
- Accessibility / Responsive Audit
- Visual Polish
```

The package is a provider.

The capability is the product primitive.

---

## 3.3 Executor Binding

Defines **who or what performs the implementation**.

Examples:
- Opus architect;
- Flash worker;
- DeepSeek standard agent;
- local model;
- deterministic Playwright runner.

Capability identity should not change when executor changes.

---

# 4. Skill Contract Schema

Every skill should declare:

## Identity
- id;
- category;
- purpose.

## Consumes
- files;
- representations;
- running application;
- business/domain model;
- design model;
- task state;
- journey contract.

## Produces
- code;
- artifact;
- evidence;
- model;
- report;
- patch;
- execution trace;
- recommendation.

## Authority
- inspect;
- advise;
- modify;
- execute;
- install;
- verify;
- approve.

## Scope
- files;
- DOM regions;
- design surface;
- workspace;
- branch;
- runtime.

## Preconditions
Examples:
- running application;
- approved design model;
- protected tests;
- accepted baseline;
- decomposable work.

## Invariants
What the skill must preserve.

## Conflicts
Capabilities that should not simultaneously own the same decision surface.

## Complements
Capabilities that naturally precede/follow it.

## Acceptance
How success is proven.

## Economics
- expected resource class;
- external credentials;
- likely model class;
- parallelism sensitivity.

---

# 5. Unified Capability Categories

## Understand

### Product Briefing
Converts vague product intent into behavioral outcomes.

### Domain Rule Extraction
Identifies business rules, metrics, constraints, definitions, and sources of truth.

### Requirement Distillation
Turns natural-language expectations into acceptance-relevant constraints.

---

## Represent

### Reference Distillation
Transforms external references into explicit properties/decisions.

### Structural Sketch
Represents spatial or interaction structure independent of final implementation.

### Product Model
Persists audience, required behavior, goals, exclusions.

### Design Model
Persists palette, typography, spacing, components, interaction grammar.

### Domain Model
Persists business entities, rules, metrics, semantic scopes.

---

## Actualize

### Code Repair
Corrects existing implementation while preserving acceptance evidence.

### Frontend Actualization
Builds a UI from product/design representations.

### Artifact Generation
Creates durable reports, documents, dashboards, or other outputs.

### Component Implementation
Implements bounded independent parts under inherited invariants.

---

## Inspect

### Runtime Preview
Runs and renders the product.

### File / Artifact Inspection
Opens durable outputs without confusing preview with source.

### Trajectory Inspection
Shows agent actions, tools, changes, commands.

### Diff Review
Shows code/file changes.

### Dependency Review
Checks implementation proportionality and architecture drift.

---

## Steer

### Mid-Run Steering
Redirects active work without restarting.

### Queue Next
Adds future work after current work.

### Grounded UI Feedback
Anchors a correction to selected element + screenshot + viewport + preserve constraints.

### Scope-Preserving Repair
Changes only the bounded target while retaining accepted surrounding behavior.

---

## Orchestrate

### Work Decomposition
Partitions work according to dependency/ownership graph.

### Architect / Worker Delegation
Assigns shared decisions to architect and independent work to workers.

### Team Supervision
Exposes rounds, status, pause/stop, messages, checkpoints.

### Return Contract
Standardizes worker completion as:
> changed → tested → remaining → evidence.

---

## Verify

### Acceptance Testing
Runs protected tests.

### Independent Verification
Checks result through a separate calculation or mechanism.

### Integrity Verification
Confirms protected artifacts did not change.

### Accessibility Audit
Checks accessibility criteria.

### Responsive Audit
Checks viewport behavior.

### Browser Journey Verification
Executes real user flows.

### Outcome Verification
Confirms final artifact/business result rather than transport or dispatch.

---

## Refine

### Visual Polish
Improves appearance while preserving approved design model.

### Interaction Polish
Improves behavior without changing product semantics.

### Context-Preserving Drill-Down
Adds local focus without making global/local semantics ambiguous.

---

## Extend

### Capability Creation
Describe → build → inspect → install → grant → enable → exercise → verify.

### Capability Installation
Acquire implementation.

### Capability Enablement
Activate implementation separately from acquisition.

### Capability Review
Check provenance/source/permissions.

---

## Explore

### Variant Experimentation
Branches a verified baseline to test alternative direction.

### Worktree Isolation
Uses branch/worktree mechanics as one implementation.

### Preview Isolation
Uses distinct runtime identity/port.

---

## Operationalize

### Automation Scheduling
Turns an accepted manual workflow into scheduled work.

### Automation Editing
Changes instructions/timing.

### Delivery Inspection
Checks dispatch records.

### Outcome Closure
Verifies the scheduled job actually produced the intended result.

---

## Accept

### Review
Human/system gate before completion.

### Evidence Closure
All acceptance evidence satisfied.

### Human Journey Acceptance
Manual final walkthrough where appropriate.

### Accepted
Work is complete only after review criteria are satisfied.

---

# 6. Unified Representation Graph

The harness should treat context as typed representations, not merely attachments.

```text
                         INTENT
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
      Product Model    Domain Model     User Goal
           │               │                │
           ├───────────────┴────────────────┤
           ▼                                ▼
   Reference Distillation             Acceptance Model
           │                                │
           ▼                                │
      Reference Board                       │
           │                                │
     ┌─────┴─────┐                          │
     ▼           ▼                          │
 Design Model  Structural Sketch            │
     │           │                          │
     └─────┬─────┘                          │
           ▼                                │
        Task Contract ◄─────────────────────┘
           │
           ▼
      Actualization
           │
           ├───────────────┐
           ▼               ▼
        Artifacts       Running System
           │               │
           ▼               ▼
    Artifact Review    Runtime Inspection
           │               │
           └──────┬────────┘
                  ▼
               Evidence
                  │
                  ▼
               Review
```

Every representation should know:
- provenance;
- producer;
- consumers;
- invariants inherited;
- current status;
- confidence;
- acceptance relation.

---


# 6.1 Workflow Graph as the Execution Backbone

The harness should represent a workflow as an explicit graph rather than relying on conversation chronology.

Each workflow node should declare:

- capability required;
- input representation(s);
- output representation(s);
- preconditions;
- invariant set;
- authority requirement;
- executor requirement;
- budget/resource envelope;
- acceptance condition;
- next valid transitions.

Each edge should declare:

- trigger;
- guard/condition;
- evidence required;
- failure route;
- whether transition is automatic or requires review.

This means the workflow itself can answer:

- What stage are we in?
- What became possible because the previous stage completed?
- What capability is required next?
- Can this branch run in parallel?
- What evidence closes this stage?
- What must remain invariant downstream?
- What can be retried without restarting the entire workflow?
- What can be automated once the workflow has been proven?

The workflow therefore becomes the **execution skeleton**, while tasks are concrete runtime instances of its nodes.


# 7. Unified Cockpit UX

## Left Rail — Work Context

Contains:
- Workspaces
- Sessions / Tasks
- Board
- Skills / Capabilities
- Automations
- installed/custom extensions

This is navigation through durable work objects.

---

## Top Bar — Task Contract

Always-visible compact controls:

> Workspace | Goal | Skills | Authority | Executors | Budget | Invariants | Acceptance

The top bar answers:

- Where am I?
- What am I trying to accomplish?
- What capabilities are active?
- What may the system do?
- Which agents/models are responsible?
- What can it spend?
- What must remain true?
- What counts as done?

---

## Center — Conversation / Active Work

Contains:
- task conversation;
- current plan;
- tool activity;
- queued instructions;
- worker/architect messages;
- generated result narrative.

When active:

> **Queue next | Steer now | Stop**

Steering should be a permanent execution primitive.

---

## Right Pane — Reality

Tabs/surfaces:

### Changes
- files changed;
- insertions/deletions;
- diffs;
- dependency effects.

### Files / Artifacts
- authoritative outputs;
- file metadata;
- previews;
- preview-fidelity indicator.

### Browser / Runtime
- running app;
- local servers;
- viewport controls;
- selected element;
- screenshots.

### Evidence
- tests;
- independent checks;
- integrity checks;
- screenshots;
- journey traces;
- human review.

### Trajectory
- model turns;
- tools;
- commands;
- edits;
- delegation;
- approvals.

This pane represents **what actually happened**, not what the agent says happened.

---


## Workflow Surface

The cockpit should have a first-class workflow view alongside Conversation and Board.

It should show:

```text
Current Stage
    ↓
Inputs → Capability → Executor → Output → Evidence
    ↓
Next unlocked stages
```

For a larger workflow, show the dependency graph with:

- completed nodes;
- active nodes;
- blocked nodes;
- review gates;
- parallel branches;
- failed/retryable nodes;
- optional nodes;
- operationalized/scheduled nodes.

Selecting a node should reveal:

- stage purpose;
- active skill/capability;
- implementation binding;
- executor;
- inherited invariants;
- owned files/surfaces;
- evidence;
- cost/resource use;
- acceptance state;
- valid next transitions.

The user should be able to reason about the work at three levels:

1. **Conversation** — immediate interaction.
2. **Task** — bounded unit of execution.
3. **Workflow** — the larger dependency structure that gives tasks meaning.


## Bottom Runtime Strip

Shows:
- running / paused / waiting / review;
- elapsed time;
- turns/steps;
- tokens;
- cost;
- provider/quota;
- context usage;
- cache;
- concurrency;
- approvals pending.

The correct economic unit is the run/task trajectory.

---

# 8. Unified Task Lifecycle

The two reconstructions collapse into one lifecycle.

```text
DRAFT
  │
  ▼
BRIEF READY
  │
  ▼
CONTRACT READY
  │
  ▼
ANCHOR / BASELINE
  │
  ▼
RUNNING
  │
  ├── Steer
  ├── Queue
  ├── Approve
  ├── Pause
  └── Stop
  │
  ▼
PRODUCED
  │
  ▼
VERIFICATION
  │
  ├── tests
  ├── independent check
  ├── runtime journey
  ├── audit
  └── integrity
  │
  ▼
REVIEW
  │
  ├── diff
  ├── artifact
  ├── evidence
  └── human judgment
  │
  ├──► REWORK
  │
  └──► ACCEPTED
          │
          ├──► OPERATIONALIZE
          │       └── automation
          │
          ├──► EXTEND
          │       └── capability/plugin
          │
          └──► EXPLORE
                  └── branch/variant
```

---

# 9. Unified Delegation Model

The harness should treat team shape as part of the task contract.

## Architect

Owns:
- shared invariants;
- decomposition;
- shared files/tokens;
- integration;
- review;
- consequential design decisions.

## Workers

Own:
- bounded independent subgraphs;
- explicit files/surfaces;
- specific acceptance criteria.

## Verifier

Should be separable from implementer where useful.

Owns:
- testing;
- independent checks;
- runtime journeys;
- evidence capture.

---

## Worker contract

Every delegated unit should contain:

```text
Objective
Scope
Owned files / surfaces
Inherited invariants
Allowed authority
Acceptance criteria
Verification method
Budget
Return contract
```

Return contract:

```text
Changed:
Tested:
Evidence:
Remaining:
Risks:
Ready for review: yes/no
```

---

# 10. Parallelism as Dependency Graph

Do not expose concurrency as merely:

> 1 / 2 / 5 / unlimited workers.

Before parallel execution, calculate or infer:

- file overlap;
- semantic overlap;
- shared design tokens;
- shared business rules;
- dependency order;
- merge surface;
- provider quota;
- model cost;
- review burden.

Then recommend:

> Parallel-safe

or:

> Shared dependency — keep sequential / architect-owned

This unifies Bamboo’s worker-decomposition insight with the DeepSeek harness’s resource/economic visibility.

---

# 11. Authority Plane

Permissions should be inspectable capability scopes.

Instead of only:

- Read Only
- Workspace Write
- Full Access

show what each grants:

```text
Filesystem
  workspace read: yes
  workspace write: yes
  outside workspace: no

Shell
  run existing commands: yes
  destructive commands: approval

Network
  outbound requests: approval

Packages
  install: approval

Extensions
  install plugin: approval
  enable plugin: user action

Protected evidence
  source.csv: immutable
  tests/: immutable
```

Authority should also apply to skills.

Example:

`Accessibility Audit`
- read: runtime + source
- interact: yes
- modify: no by default

`Visual Polish`
- read: design model + runtime + source
- modify: visual implementation
- may not modify product behavior unless explicitly elevated

---

# 12. Invariant Plane

Invariants must be first-class, inherited constraints.

## Domain invariants
Examples:
- cancelled orders contribute zero;
- refund quantity uses actual refunded units;
- report metrics preserve semantic scope.

## Product invariants
Examples:
- booking CTA stays discoverable;
- no fabricated reviews/availability;
- demo submission stays local.

## Design invariants
Examples:
- approved color palette;
- typography;
- spatial relationships;
- reduced-motion support.

## Governance invariants
Examples:
- protected evidence cannot be edited;
- approval required for risky shell/network operations.

## Workflow invariants
Examples:
- installation != enablement;
- dispatched != completed;
- worker done != accepted;
- preview != authoritative artifact;
- page loaded != journey verified.

---

# 13. Evidence Ledger

Every task should accumulate evidence.

Example:

```text
Evidence Ledger

Domain
✓ business rules loaded

Implementation
✓ expected files changed
✓ protected files unchanged

Tests
✓ unit tests 4/4
✓ independent calculation PASS

Runtime
✓ desktop journey PASS
✓ phone journey PASS
✓ keyboard journey PASS
✓ invalid form path PASS

Quality
✓ accessibility audit PASS
✓ console errors: 0

Review
✓ diff reviewed
✓ dependencies reviewed
○ human acceptance pending
```

Artifacts should link to the evidence used to accept them.

An artifact without acceptance evidence can still exist, but should not be represented as verified.

---

# 14. Artifact Model

Artifacts are durable work products.

Examples:
- report.html;
- calculations.md;
- code;
- design model;
- product model;
- screenshots;
- test report;
- generated plugin;
- scheduled-job output.

Every artifact should know:
- creator;
- task;
- version;
- source inputs;
- invariants;
- evidence;
- verification status;
- preview fidelity.

---

## Preview fidelity

A preview should explicitly declare:

- Authoritative native rendering
- High-fidelity rendered preview
- Approximation
- Static-value preview
- External application recommended

This prevents the preview from being confused with the deliverable.

---

# 15. Grounded Feedback as a Core Primitive

The Bamboo workflow and DeepSeek steering flow combine into one mechanism.

## For an active run

User can:
- Queue next;
- Steer now;
- Stop.

## For a completed/running UI artifact

User can ground feedback with:
- selected element;
- screenshot;
- viewport;
- file/component mapping;
- preserve constraints;
- requested delta;
- verification target.

Example contract:

```text
Target
#hero-title

Preserve
desktop composition
approved typography
booking CTA hierarchy

Change
on phone width, place heading below mountain ridge

Verify
390px viewport
CTA remains above fold
```

This should be a native change contract, not merely prompt prose.

---

# 16. Context-Preserving Focus

The sales-report product filter exposes a general UX law:

> **Changing focus must not silently change semantic scope.**

This should become a harness-wide rule.

Examples:

- local product metric vs whole-business metric;
- worker state vs team state;
- selected file vs workspace state;
- branch variant vs accepted baseline;
- one automation delivery vs workflow outcome;
- one artifact preview vs authoritative deliverable.

Where two scopes coexist:
- label them;
- preserve reference context;
- make selection visible;
- provide reset/escape.

---

# 17. Capability Lifecycle

A capability should have explicit lifecycle states.

```text
SPECIFIED
  ↓
IMPLEMENTATION AVAILABLE
  ↓
REVIEWED
  ↓
INSTALLED
  ↓
AUTHORITY GRANTED
  ↓
ENABLED
  ↓
EXERCISED
  ↓
VERIFIED
  ↓
AVAILABLE
```

Creator mode is one implementation of `Capability Creation`.

A capability can be generated without being:
- trusted;
- installed;
- enabled;
- verified.

These are distinct states.

---

# 18. Capability Creation

The unified harness should include a meta-skill:

# Create Capability

Contract:

1. Describe categorical capability.
2. Define where it appears.
3. Define inputs/outputs.
4. Define authority.
5. Define verification.
6. Select/build implementation.
7. inspect source/provenance.
8. install.
9. grant.
10. enable.
11. exercise.
12. verify.
13. register into catalog.

This turns the DeepSeek Creator workflow into the Skill OS itself extending its vocabulary.

---

# 19. Automation as Operationalized Skill Composition

Automation should not be a separate conceptual island.

A manual accepted workflow can become:

> **Skill composition + input binding + schedule + execution substrate + outcome gate**

Example:

```text
Weekly Sales Report

Inputs
latest sales.csv

Capabilities
- Domain Calculation
- Report Generation
- Independent Verification

Schedule
Monday 08:00 America/New_York

Runner
local desktop service

Acceptance
- calculations tests pass
- report generated
- net revenue present
- evidence ledger closed
```

---

## Automation state machine

```text
SCHEDULED
   ↓
DISPATCHED
   ↓
RUNNING
   ↓
PRODUCED
   ↓
VERIFIED
   ↓
COMPLETE
```

Failure can occur at any edge.

Delivery receipt means only:

> DISPATCHED

not:

> COMPLETE.

---

# 20. Execution Substrate

Every automation/task should display:

- local desktop;
- local background service;
- remote runner;
- cloud execution;
- current availability.

The user must know whether closing/quitting the application affects execution.

---

# 21. Business / Domain Model

The unified harness should always ask:

> **What makes this output correct in the domain?**

For analytical work:
- rules;
- calculations;
- metric semantics;
- protected inputs.

For product/design work:
- audience;
- conversion path;
- truthfulness;
- accessibility;
- demo/production boundary.

The domain model is upstream of the artifact.

---

# 22. Economics Plane

Both workflows imply the same economic model.

## Harness economics
The application/workbench may have its own cost.

## Executor economics
Models/providers have separate billing or quotas.

## Skill economics
Some implementations may require:
- paid APIs;
- external credentials;
- browser models;
- compute.

## Team economics
Concurrency consumes shared quota and increases review/coordination cost.

## Reasoning economics
Higher reasoning may improve consequential decisions but is not universally justified.

---

## Economic unit

The meaningful unit is:

> **task / run / trajectory**

not:

> prompt.

One task may create:
- many model calls;
- worker calls;
- tool invocations;
- retries;
- verification steps;
- browser runs.

---

## Optimization objective

Do not optimize:

> cheapest token

Optimize:

> **lowest total cost to verified acceptance**

Total cost includes:
- model usage;
- rework;
- failed parallelism;
- merge conflict;
- verification;
- human supervision;
- latency;
- external tools.

---

# 23. Role-Aware Model Routing

Executor selection should follow decision leverage.

## Strong / expensive model
Use for:
- architecture;
- domain interpretation;
- design direction;
- decomposition;
- integration;
- review.

## Cheaper / faster model
Use for:
- bounded implementation;
- repetitive transformations;
- deterministic execution;
- worker tasks.

## Non-LLM executor
Use where a deterministic tool is sufficient:
- tests;
- Playwright;
- file hash verification;
- build;
- lint;
- static checks.

The harness should route at capability level.

---

# 24. Unified Review Model

“Done” is not a single event.

Different completion concepts:

## Agent finished
Execution stopped.

## Produced
An output exists.

## Tested
Specified verification ran.

## Ready for review
Worker/task evidence is complete enough to inspect.

## Accepted
Review gate passed.

## Operationalized
Accepted workflow is reusable/scheduled.

The UI must not collapse these.

---

# 25. Review Surface

For any result, review should combine:

### Intent
What was requested?

### Invariants
What had to remain true?

### Changes
What changed?

### Evidence
What proves correctness?

### Artifact
What was produced?

### Runtime
How does it behave?

### Economics
What did it consume?

### Remaining
What is unresolved?

This is the single review object both videos imply.

---

# 26. Board / Workflow State

Recommended universal states:

```text
BACKLOG
BRIEFING
READY
RUNNING
BLOCKED
READY FOR REVIEW
REWORK
ACCEPTED
OPERATIONALIZED
```

Optional workflow-specific sub-states can exist.

Examples:
- Anchor Slice Verified
- Audited
- Polished
- Journey Verified

But the core lifecycle remains consistent.

---

# 27. Unified Global Navigation

Recommended left navigation:

```text
New Task

Workspaces
  workspace A
    sessions
    tasks
    variants

Board

Capabilities
  Catalog
  Installed
  Custom

Automations

Evidence / Reviews

Settings
```

Custom capability pages may appear contextually but do not need to become permanent global navigation by default.

---

# 28. Unified Settings

## General
- appearance;
- language;
- font;
- link behavior;
- busy-send behavior;
- coding/trajectory visibility.

## Executors / Models
- providers;
- credentials;
- account/API funding routes;
- context sizes;
- model capabilities.

## Authority
- default permission;
- approval policies;
- protected artifact defaults.

## Skills / Capabilities
- catalog;
- bindings;
- implementation sources;
- enablement;
- conflicts;
- trust status.

## Teams
- reusable architect/worker profiles;
- concurrency limits;
- default role routing.

## Economics
- budgets;
- quotas;
- warnings;
- preferred routing.

## Automation
- runner/substrate;
- timezone defaults;
- history retention.

---

# 29. Unified Recommendations

## Critical


### 0. Workflow as a First-Class Primitive

Do not let workflows exist only as implicit chains of tasks, prompts, or board columns.

A workflow should be:
- named;
- versioned;
- inspectable;
- instantiable;
- parameterizable;
- reusable;
- schedulable;
- auditable.

The workflow should own the dependency graph and acceptance progression.

Tasks are workflow-node executions.

Skills are capability providers.

Agents/models are executors.

Artifacts and state models are representations.

Evidence closes transitions.

This is the layer that turns the harness from an agent IDE into an operating system for purposeful work.



### 1. Task Contract
Make:
> Context | Goal | Skills | Authority | Executors | Budget | Invariants | Acceptance

the central task object.

### 2. Skill OS
Make capabilities first-class and separate from implementations/executors.

### 3. Invariant Model
Move domain/product/design/governance rules out of transient prompt prose.

### 4. Evidence Ledger
Make verification inspectable and linked to artifacts.

### 5. Review Gate
Separate produced, verified, review-ready, and accepted.

### 6. Protected Evidence
Enforce immutability structurally where possible.

### 7. Automation Outcome State Machine
Separate dispatch from verified completion.

### 8. Worker Return Contracts
Standardize:
> changed / tested / evidence / remaining.

---

## High

### 9. Grounded Feedback
Element + screenshot + viewport + preserve constraints + requested delta.

### 10. Dependency-Aware Parallelism
Recommend concurrency based on graph partitioning.

### 11. Economic Observability
Show task/run-level cost/quota/resource state.

### 12. Role-Aware Model Routing
Match executor quality/cost to decision leverage.

### 13. Capability Conflict Detection
Prevent overlapping primary authorities.

### 14. Preview Fidelity
State whether preview is authoritative/approximate.

### 15. Variant Experimentation
Expose branch/worktree isolation as a user-facing capability.

### 16. Execution Substrate Visibility
Make local/remote/background execution explicit.

---

# 30. Unified Validation Traces

## V-001 — Task contract completeness

**Given**
a new task

**When**
execution begins

**Then**
the harness can identify:
- workspace;
- goal;
- authority;
- capabilities;
- executors;
- budget;
- invariants;
- acceptance criteria.

---

## V-002 — Capability substitution

**Given**
Browser Journey Verification bound to Playwright

**When**
binding changes to Jev or another compatible implementation

**Then**
- journey contract stays unchanged;
- acceptance criteria stay unchanged;
- implementation-specific setup alone changes.

---

## V-003 — Protected evidence

**Given**
source data/tests marked protected

**When**
an agent attempts write access

**Then**
write is blocked or requires explicit elevation.

---

## V-004 — Mid-run steering

**Given**
active execution

**When**
user selects Steer now

**Then**
active trajectory changes rather than merely queuing future work.

---

## V-005 — Grounded UI repair

**Given**
running UI and selected element

**When**
user attaches element + screenshot + preserve constraints + change

**Then**
repair remains bounded and verification reruns against the specified viewport/journey.

---

## V-006 — Safe parallelization

**Given**
two independent components

**When**
work is decomposed

**Then**
workers receive separate ownership and inherited invariants.

---

## V-007 — Unsafe parallelization

**Given**
two tasks touching shared stylesheet/tokens

**When**
parallelism plan is evaluated

**Then**
system warns or retains shared work under architect ownership.

---

## V-008 — Worker review gate

**Given**
worker says implementation is complete

**Then**
worker becomes Ready for review only after:
- changed files reported;
- tests reported;
- evidence attached;
- remaining work declared.

---

## V-009 — Business-semantic verification

**Given**
a report derived from business rules

**When**
tests pass

**Then**
independent check must still verify critical totals if required by acceptance.

---

## V-010 — Context-preserving focus

**Given**
global metrics and local filtered metrics

**When**
focus changes

**Then**
scope remains explicit and reference context is preserved.

---

## V-011 — Capability lifecycle

**Given**
new plugin/capability implementation

**Then**
Build does not imply Install;
Install does not imply Enable;
Enable does not imply Verify.

---

## V-012 — Automation outcome

**Given**
scheduled task

**When**
instruction is dispatched

**Then**
status is not Complete until intended output is produced and acceptance evidence closes.

---

## V-013 — Cost provenance

**Given**
a running task

**Then**
user can determine:
- executor/provider;
- billing/quota route;
- usage;
- concurrency;
- meaningful cost/resource state.

---

# 31. The Unified End-to-End Loop

The final operating model is:

```text
UNDERSTAND
  ↓
Represent product/domain intent

REPRESENT
  ↓
Build reference, structural, design, and domain models

CONTRACT
  ↓
Bind workspace, skills, authority, executors, budget, invariants, acceptance

ACTUALIZE
  ↓
Build/repair/create artifacts

OBSERVE
  ↓
Inspect trajectory, files, runtime, artifacts

STEER
  ↓
Queue, redirect, approve, pause, stop, ground corrections

DECOMPOSE
  ↓
Partition independent work when useful

DELEGATE
  ↓
Architect + workers under explicit ownership/return contracts

VERIFY
  ↓
Tests + independent evidence + audits + journeys

REFINE
  ↓
Polish without semantic/design drift

REVIEW
  ↓
Diff + artifact + evidence + runtime + economics

ACCEPT
  ↓
Explicit completion gate

OPERATIONALIZE
  ↓
Schedule/reuse workflow

EXTEND
  ↓
Create new capability when a recurring missing affordance exists

EXPLORE
  ↓
Branch variants from accepted baseline
```

---

# 32. Final Reconception

If these two walkthroughs were demonstrations of one harness, the product's actual thesis would be:

> **A harness is an operating system for intentional agent work.**

It should not primarily organize around:
- chats;
- packages;
- models;
- commands.

It should organize around:

> **intent → representations → capabilities → authority → execution → evidence → acceptance**

Models are swappable compute.

Plugins are swappable implementations.

Skills are categorical capabilities.

Files and UI states are representations.

Agents are executors.

Tests and runtime traces are evidence.

Automations are operationalized accepted workflows.

The stable product is the semantic control plane connecting all of them.


# 33. Workflow as the Integrating Primitive

The unified hierarchy is:

```text
WORKSPACE
  contains
    ↓
WORKFLOWS
  instantiate
    ↓
TASKS / STAGES
  require
    ↓
CAPABILITIES
  bind to
    ↓
IMPLEMENTATIONS
  executed by
    ↓
AGENTS / MODELS / TOOLS
  operating on
    ↓
REPRESENTATIONS
  producing
    ↓
ARTIFACTS + EVIDENCE
  evaluated by
    ↓
ACCEPTANCE GATES
```

This makes the architecture coherent:

- **Workspace** answers: where does the work live?
- **Workflow** answers: how does purposeful work progress?
- **Task** answers: what bounded unit is executing now?
- **Capability** answers: what kind of work must be done?
- **Implementation** answers: how is that capability realized?
- **Executor** answers: who/what performs it?
- **Representation** answers: what structured state is being transformed?
- **Artifact** answers: what durable output exists?
- **Evidence** answers: why should we trust it?
- **Acceptance** answers: is the stage/workflow actually complete?

The harness should therefore organize around **workflow progression**, not conversation chronology.

