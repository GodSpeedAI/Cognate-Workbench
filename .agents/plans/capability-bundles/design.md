# Capability Bundles — a dynamically extensible Cognate Workbench

*   **Author:** Sam Prime
*   **Status:** Proposed — finalized design, ready for `/egm-review`
*   **Date:** 2026-11-08

--------------------------------------------------------------------------------

## Overview

The Cognate Workbench adapts its users' agent harness today only through engineering releases:
the extension surface is a static, code-defined plugin catalog whose stated trust boundary is
"no downloaded code is ever evaluated", and the skill OS can register capability definitions
that nothing dispatches. An operator who wants the workbench to learn a new skill, gain a new
tool, or change how its agents behave must wait for a build.

This feature makes capability a normal, governed mechanism for adapting the Workbench and its
agent harness within a live session. A capability is the user-facing concept — built-in,
installed, composed, or dynamically created; a bundle is its packaging and distribution form.
Users and authorized agents create, compose, install, modify, and use capabilities in the
current session — including modifications to permitted harness behaviors themselves (agent
instructions, tool compositions, model routing, workflows). The Hallmark + Impeccable example
is the anchor journey: an operator asks the orchestrator expert for a visual-design
capability, and it is available and usable without restarting the session.

The design stands on the existing Cognate architecture — capability contracts, fibers, the
durable event log, the skill OS, the grant plane — and extends it with one new trusted
surface: a dispatcher that is the **sole route** to bundle-provided functionality, holds the
version-keyed handler table, and enforces the authority decision per invocation. Bundle-
authored code never runs inside the application process (§2.1B); untrusted executable payloads
run as spawned, contained processes. Authority originates from trusted grants attached to
per-agent principals, never from the invoking agent's declarations. The immutable security,
identity, admission, approval, and recovery machinery is preserved; the extension system
operates through it. **V1 requires zero kernel or SDK API changes** — the store's existing
conditional-commit API is used directly by the new lifecycle write adapter (§1.5).

## The Problem

Three things are broken about extension today, and one is an outright defect:

1. **The catalog is static.** `PLUGIN_CATALOG` is compiled into the app; "installing" a plugin
   only activates an implementation the app already contains. The `PluginSource` seam was
   designed for marketplace and directory sources but never given one.
2. **The skill OS is a registry, not an execution plane.** `skill.register` records events;
   `canInvoke` gates nothing on any invocation path; components mount at boot from a static
   list. There is no path from a registered capability to a live, invocable surface.
3. **Harness adaptation requires a release.** Skills, prompts, tool compositions, and model
   routing are code. Nothing can be changed mid-session, and nothing an agent creates can
   enter a session.
4. **Defect: agents can declare their own authority — and identity collapse hides it.**
   `task.create` accepts a caller-supplied contract `authority`, `authority.check` honors
   exactly those scopes (and only for `edit`/`bash`), and unbound runs default to
   `ALL_ALLOWED`. Worse: every agent-initiated run executes as the shared `system` caller, and
   `requireUser` checks only `ctx.actor.kind !== "user"` — so human-gated surfaces are
   reachable from agent runs today. Remediation of this cluster is a **prerequisite** of this
   feature (§1.6).

The proposed solution: capability bundles (skills with composition guides, MCP server
declarations, harness modifications, presentation fragments) loaded by a new skill loader,
routed exclusively through a boot-allowlisted dispatcher that registers bundle handlers into
its own version-keyed table and enforces per-invocation authority from durable, runtime-owned
records; untrusted executable payloads bounded by a governed execution-world spawn boundary;
suspension immediate; lifecycle records durable with CAS-atomic transitions; safe mode
automatic; and a coordinated SEA migration retiring the plugin entity and the old trust-model
clause through the model-first sequence.

## Goals

*   **G1 — In-session creation and use.** An operator or granted agent can create, compose,
    install, modify, and use a capability in the current session: no restart, and no
    additional human approval for operations covered by a valid authority grant (CUJs 1, 2).
*   **G2 — One capability model.** Plugins and skill-OS capabilities unify into one lifecycle
    and management experience through a deliberate, coordinated SEA migration; semantic IDs
    and durable records are carried through with defined replay mappings over the historical
    log (§9.2).
*   **G3 — Authority that cannot be self-enlarged.** Effective authority is a read-time
    predicate over runtime-owned inputs — never caller-declared — evaluated at traced,
    non-bypassable enforcement points across every invocation path, with every decision and
    refusal durably recorded and a runtime-enforced (not test-enforced) boundary between
    trusted adapters and bundle-supplied code. The negative cases are proven by test: forged
    grants, alternate invocation paths, broader workspace scopes, subagent lineage escalation,
    and post-suspension invocations acquire no authority (CUJ 4). **Prerequisite:** the
    caller-declared-authority and identity-collapse defect cluster is remediated and proven
    before the extensible runtime is enabled (§1.6; CUJ 4 doubles as its regression proof).
*   **G4 — Harness modification as a first-class affordance.** Capabilities can modify and
    compose permitted harness behaviors — agent instructions, tool compositions, model
    routing, workflows — under declared surfaces with conflict refusal, deterministic
    precedence, and operator-restorable state; changes are resolved at run start and thereby
    usable by the next agent run in the live session, uniformly across every run source
    (CUJ 11).
*   **G5 — Executable payloads under explicit contracts.** Untrusted executable payloads (MCP
    servers, executable handlers) run only as spawned processes through execution-world ports
    under a per-provider containment contract that refuses what the provider cannot enforce;
    secrets resolve env-only from the secret store and fail closed on missing keys; audit
    records reflect only what the runtime observed (CUJ 3).
*   **G6 — Skills that scale and compose.** Discovery through lightweight metadata within hard
    per-capability and aggregate token budgets; full instructions load on relevance;
    per-capability composition guides govern how constituent skills cooperate and resolve
    conflicts (CUJ 1 asserts guide delivery and gated use, not mere loading).
*   **G7 — Honest lifecycle with atomic reload.** Yank is immediate suspension — new and
    queued invocations are rejected at committed-event visibility via the commit-synchronous
    authority index; lifecycle transitions commit CAS-atomically through the store's
    conditional-commit API; graceful and emergency disciplines dispatch per payload type;
    interrupted consequential work stays subject to commitment and reconciliation rules.
    Replacement is atomic and the last known-good version remains executable — payload
    availability is guaranteed by immutable version directories (§4.4). Uninstall and rollback
    are separate operations. Revocation of a grant suspends the activations it clamped
    (CUJs 5, 12, 13).
*   **G8 — Mutable presentation, immutable core, automatic safe mode.** Presentation is
    customizable starting from declarative fragments, with versioned extension boundaries that
    do not foreclose richer future extensions; governance surfaces are excluded and their
    override treated as a core violation; non-security built-ins are disable-able but never
    removable; safe mode recovers without rendering the broken component and without
    corrupting the durable registry (CUJs 6, 10).
*   **G9 — Sources that respect the execution-world boundary.** Directory sources work over
    provider-backed environments (SSH, WSL) identically to local; no host filesystem
    assumptions (CUJ 8).
*   **G10 — Framework gaps go upstream.** Every SDK limitation the design encounters is named
    as an explicit upstream proposal, never worked around silently in app code (§10; v1 needs
    none — the store's conditional-commit API already provides the required concurrency
    guarantees).
*   **G11 — Model-first evidence.** The journey family enters the SEA catalog before
    implementation: ten canonical journeys carrying all thirteen CUJs as asserted variants;
    `domainforge validate` + `fmt --check` after every model change; `just verify` at tranche
    boundaries.

## Non-Goals

*   Becoming a cordis plugin host, or implementing a competing framework inside the Workbench.
*   A second parallel authority system: no stored effective-authority records, no second
    decision function, no delegation compiled onto `team.delegate`.
*   Running bundle-authored code inside the application process (§2.1B) — in-process code is
    app-owned and reviewable; bundle executables are spawned and contained.
*   Multi-identity RBAC rollout. Authority grants and context levels keep the extension path
    clean; the work-group key is reserved and fail-closed.
*   Bypassing or modifying the immutable authority, identity, admission, approval, and
    recovery machinery.
*   Shipping during E-phase: implementation begins after rev 43 settles.
*   Assuming every workspace is a local filesystem directory.
*   In v1: marketplace machinery, durable event-log payload copies, per-bundle event budgets,
    rollback-to-version UI, structured composition-guide formats, work-group substrate,
    native per-bundle model-facing tool registration, preset registration (toolset *overrides*
    of existing presets only), bundle tools in expert assignment `authorityTools` allowlists,
    theme-accent fragments (panel descriptors are the one v1 slot kind), a general package
    store (version directories are bounded-retention payload materialization, not one).

## Open Questions

Resolved across revisions (decisions in §1.5–1.7, §2, §4): tool-catalog insertion and the
generic dynamic-tool contract (§2.5); enforcement placement and the two-tier handler boundary;
session-scoped expiry; presentation durable record; inspector placement; grant subject;
clamp-grant singularity; the lifecycle write path (lifecycleRecorder over the store's
conditional-commit API); rollback vs source integrity (immutable version directories);
provider containment matrix and the spawn-ledger protocol; the enablement gate predicate;
the MCP client as named net-new engineering. **OQ-B is decided by the owner**: the §1.6
remediation cluster is a mandatory prerequisite in a separately verifiable tranche, scheduled
after rev 43 unless independently judged to require an immediate security fix on the current
release line. Remaining:

*   **OQ-A — Pinned numbers.** Descriptor token budgets and bundle payload ceilings
    (per-bundle total, per-file, file count) and version-directory retention (default 3
    retained versions + active) are set at implementation planning and pinned in the
    verification plan; the mechanisms and the ceilings' existence are decided here
    (§4.4, §5.1).

## Critical User Journeys (CUJs)

### CUJ 1: Create a visual-design capability in-session

*   **Given**: An operator session whose orchestrator expert holds an authority grant to create
    and enable user-scoped capabilities; Hallmark and Impeccable skill payloads available from
    a directory source or authored by the expert.
*   **When**: The operator asks the orchestrator to create a visual-design capability bundling
    them.
*   **Then**: The expert understands the request, discovers existing reusable skills, composes
    the bundle (skills + composition guide), validates, registers, and activates it in the live
    session — no restart, no additional approval. A subsequent agent run in the same session
    exercises the capability: discovery metadata was present without full preload, the
    composition guide reaches the model and governs the workflow (Hallmark's anti-slop
    judgment and Impeccable's gated craft process cooperate per the guide's handoff and
    conflict rules — asserted from the skill-load sequence and `workbench.harness.assembled`),
    the skills load on relevance. The capability panel shows version, origin, creating actor
    (provenance), and effective grants.

### CUJ 2: Modify an installed skill — versioned reload

*   **Given**: An installed, active capability with a versioned binding.
*   **When**: The operator modifies a skill through the governed re-hash mutation, which
    materializes a new immutable version directory.
*   **Then**: The next eligible invocation — dispatch-committed after the reload commit —
    observes the new version without losing the session. In-flight calls complete under the
    version snapshot they took at dispatch start — asserted by the `repointed` commit
    preceding the old-version `tool.call.completed` record — or are refused per D5. The
    replaced binding is retired; conflict detection sees live bindings only.

### CUJ 3: MCP server lifecycle with authority and audit

*   **Given**: An authorized capability declaring an MCP server; parameterized over the local
    world and one provider-backed (SSH or WSL) world.
*   **When**: The capability is installed, started, invoked, suspended, and recovered.
*   **Then**: The server spawns only through the governed execution-world spawn boundary under
    its declared resource scopes, with the spawn recorded before the process starts (§6.3); a
    required restriction the provider cannot enforce refuses the spawn with a decision record
    (fail-closed) unless the operator's execution posture explicitly and accurately permits
    the weaker posture; a refused spawn (world unavailable, missing secret key, unenforceable
    restriction) emits a decision record with its reason; secrets resolve env-only from the
    secret store; recorded MCP tool invocation events are distinguished from unobserved
    subprocess activity; suspension stops managed processes promptly with provider-dependent
    termination honesty recorded; recovery re-resolves the world and remounts from durable
    state.

### CUJ 4: Refusal outside granted authority (negative proof)

*   **Given**: An agent holding a limited authority grant.
*   **When**: The agent forges its grants, requests a capability beyond its grant, uses a
    broader workspace scope, invokes through an alternate path (direct kernel capability
    invoke, expert tool, execution-world operation, subagent lineage), attempts to invoke a
    bundle handler as the system caller, or continues after suspension.
*   **Then**: Every attempt is refused at its traced enforcement point; the agent — and its
    subagent lineage, whose authority derives from the parent's ceiling by narrowing only —
    acquires no authority it lacked; each refusal is recorded in `authority.decision.recorded`
    with a reason code and the deciding enforcement point's identity. This CUJ is also the
    regression proof for the §1.6 prerequisite remediation.

### CUJ 5: Suspension blocks, preserves, and stays honest

*   **Given**: An active capability with in-flight consequential work.
*   **When**: The operator yanks it.
*   **Then**: New and queued invocations are rejected at committed-event visibility (the
    commit-synchronous authority index; no fold-lag window), each refusal recorded; managed
    processes stop promptly; graceful-vs-emergency follows the payload type; interrupted
    consequential operations keep their commitment states and enter the existing
    reconciliation path; the audit surface attributes every observed action; the suspension
    reason is recorded and `resumed` clears exactly that reason.

### CUJ 6: Safe mode from a broken extension

*   **Given**: A broken capability or presentation extension — including one that overrides a
    governance surface (a core violation).
*   **When**: Boot fails its readiness budget with extensions enabled, the extension's render
    or mount fails, or the override is attempted.
*   **Then**: Safe mode boots with a known-good presentation without rendering the broken
    component, suspends the problematic extensions, preserves the durable capability registry,
    and lets the operator inspect and recover one re-enable at a time; the manual clear is an
    operator-only capability with its own event; a governance-surface override attempt is
    refused and recorded as a core violation.

### CUJ 7: Restart restores only recorded effective state

*   **Given**: Mixed durable state — persistent installs, session-scoped activations,
    suspended capabilities, retired bindings, plugin-era historical events, and a crash that
    left an intended-but-unconfirmed or confirmed-but-running MCP spawn.
*   **When**: The Workbench restarts.
*   **Then**: Boot folds first and mounts second; only valid recorded effective state is
    restored; session-scoped activations follow the durable session-binding semantics (expiry
    is terminal; unarchiving a session never resurrects an activation); the boot sweep
    reconciles the spawn ledger — killing confirmed-but-running processes by record,
    best-effort signature kill for unconfirmed intents where the provider allows, and
    recording every outcome; plugin-era events replay to their defined mappings (§9.2); a
    bundle re-registering a built-in id cannot shadow it.

### CUJ 8: Provider-backed directory source

*   **Given**: A capability bundle directory on an SSH or WSL execution world.
*   **When**: The operator installs from it.
*   **Then**: Ingestion, hashing, version-directory materialization, registration, and loading
    behave identically to a local-world install; no host filesystem watch or read is involved.

### CUJ 9: Persistent activation across context levels

*   **Given**: A capability activated persistently (across sessions) at a stated context level.
*   **When**: Authority decisions are evaluated in sessions within and outside that level.
*   **Then**: The context-level scoping is observable in `authority.decision.recorded`; the
    activation survives restart per its stated scope; session-scoped and persistent
    authorities remain distinct.

### CUJ 10: Presentation extension in the normal path

*   **Given**: A declarative presentation extension (panel descriptor) from an installed
    capability.
*   **When**: The Workbench renders normally.
*   **Then**: The fragment renders through the slot registry and honesty machinery; governance
    surfaces (approval dialog, authority displays, audit views) are untouched by any
    extension.

### CUJ 11: Harness modification, hot-reloaded and demonstrably used

*   **Given**: An operator session with an orchestrator expert granted harness-modification
    authority for user-space, session-scoped changes (an instruction patch and a toolset
    override for the standard preset).
*   **When**: The operator asks the orchestrator to make the coding agent follow a
    "deep-dive then implement" workflow with a repo-conventions instruction patch.
*   **Then**: The expert authors the modification as a capability bundle (declared surfaces:
    instruction patch, toolset override), validates, registers, and activates it in the live
    session. The **next agent run** in the session demonstrably uses it, uniformly regardless
    of run source: the run-start resolver applies the patch and override from durable
    activation state, and `workbench.harness.assembled` records the effective instruction set,
    toolset, and routing for the run. Overlapping modifications compose in activation order or
    are refused at activation as conflicts; deactivating the capability restores the prior
    working configuration by replay.

### CUJ 12: Revocation of delegated authority

*   **Given**: An agent holding authority grant G, under which it activated capability C
    (C's activation ceiling was clamped by exactly G and the activation record names G).
*   **When**: The operator revokes G (or the durable scheduler records its expiry).
*   **Then**: The lifecycle recorder commits, in **one CAS-atomic batch** (the store's
    conditional-commit API), the suspensions of every activation clamped by G together with
    `authority.grant.revoked`; a concurrent state change makes the whole batch fail and retry
    against the re-read index rather than partially commit; new invocations of C under those
    activations are refused at committed-event visibility; managed processes are stopped
    promptly; operator-established activations are unaffected; C's registry record and
    provenance persist (suspended, not deleted). Re-granting does not silently reactivate:
    resumption clears a named suspension reason only by an explicit act.

### CUJ 13: Failed hot-reload rollback

*   **Given**: An active capability at version 1, whose payload lives in an immutable version
    directory.
*   **When**: A replacement (version 2) is registered and activated but its handler mount
    fails kernel activation — or the activation event's CAS commit fails because the
    activation was suspended concurrently.
*   **Then**: The failed handler is disposed (any abort after mount and before commit disposes
    the mounted handle); the activation record was never re-pointed, so version 1 remains the
    last valid effective state **and version 1's payload directory is untouched and still
    passes its integrity check** — the rollback guarantee covers metadata and payload
    availability; the failure is recorded in the `capability.activation_failed` family with
    its reason; no partial mount exists; the next invocation uses version 1; the durable log
    shows the failed attempt without state corruption.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 0. Reading order and design principles

§1 defines the authority model. §2 proves the enforcement topology, including the trusted/
untrusted code boundary (§2.1B) and the generic dynamic-tool contract (§2.5). §3–§7 are the
subsystem contracts. §8–§9 are the durable substrate and migration; §10 names the framework
gaps (none blocking). Principles: one authority decision function; runtime-owned inputs only;
the dispatcher is the sole route to bundle functionality; bundle-authored code never runs
in-process; durable events own state via a normative transition×event×fold matrix;
lifecycle-critical transitions commit CAS-atomically through the store's own API; the
provider hot-swap is the mount precedent; the smallest coherent mechanism that meets the
contract.

```text
              ┌────────────────────────────────────────────────────────────┐
              │ DURABLE SUBSTRATE (sole state authority)                   │
              │ workbench event log + commit-synchronous AUTHORITY INDEX   │
              │ (two maps: grants-per-principal; activations keyed         │
              │  capability+level+session, version a field — fed onCommit) │
              └──────┬───────────────────────────────┬─────────────────────┘
                     │ synchronous read (onCommit)   │ fold (async, UI only)
     ┌───────────────┴───────────────┐   ┌───────────┴────────────────────┐
     │ decideCapabilityInvocation()  │   │ projections (panels, inspector)│
     └───┬───────────────────────┬───┘   └────────────────────────────────┘
         │                       │
         │        static kernel allowlist (app-side agent branch, §1.6.v):
  enforce│        bundle ids ∉ GRANTED_CAPABILITIES → bypass refused; handlers
         │        are never kernel-resolved (dispatcher table only)
┌────────┴────────────────┐  ┌─────┴───────────────────────┐  ┌───────────────────────┐
│ A. harness tool loop    │  │ DISPATCHER capability       │  │ C. governed execution-│
│ full catalog incl.      │  │ (boot-allowlisted; SOLE     │  │ world spawn boundary  │
│ run_code; replaces      │  │ route; trusted app-owned    │  │ per-provider matrix   │
│ caller-declared         │  │ adapters interpret bundle   │  │ (§6.2); spawn ledger  │
│ authority.check; routes │  │ DATA; mounts app-owned      │  │ record-before-spawn   │
│ dispatcher ids straight │  │ adapter components; version-│  │ (§6.3); MCP client is │
│ to the dispatcher's     │  │ keyed handler table         │  │ net-new)              │
│ decision                │  └─────┬───────────────────────┘  └───────────┬───────────┘
└────────┬────────────────┘        │ Kernel.mount (hot-swap)              │
         │                         ▼                                      ▼
         │               version-keyed handler table            spawned untrusted executables
         │               + per-version in-flight counter        (MCP servers, executable
         ▼                                                      handlers) — never in-process
   model calls
```

### 1. The authority model

**1.1 Subjects and principals.** Authority attaches to **per-agent principals**. Every
agent-initiated run — `agent.coding` runs, expert runs, subagent children — starts under the
responsible agent principal (`Principal.kind: "agent"` exists; `startRun(caller)` is
app-controlled). UI-started runs carry the operator principal for the client call; the agent
work they start runs under the responsible agent's principal. **Grant subject = principal id
(+ optional task or workspace binding).** Subagent children start under their parent's agent
principal and inherit authority **by narrowing only** — the child's effective set is the
parent's ceiling ∩ the child's task scopes, never wider (`Scope.child`'s "never gains
authority by inheritance" is the stated precedent).

**1.2 Four authority kinds, distinguished.**

| Kind | What it permits | Establishes |
| --- | --- | --- |
| **Author** | Compose/author a bundle; write to the bundle store | **Provenance only** — creator identity, source, content hashes. Authoring grants no execution authority. |
| **Install** | Bring a validated bundle into the registry as a dormant installed capability at a context level | The requirement set: declared requirements validated for satisfiability; unsatisfiable declarations fail install. |
| **Activate** | Establish an activation at a context level | **The activation ceiling** and its clamp provenance (1.3). Requires either (a) ladder state ≥ AUTHORITY_GRANTED (published path), or (b) a grant covering activation at that level (delegated path — D2's frictionless flow). |
| **Invoke** | Call a capability's operations | Nothing durable — decided per invocation (1.4). |

**1.3 Provenance is not authority; the ceiling has exactly one clamp grant.** The creator's
grant is consulted at most once — when the creator is also the activator — and is recorded as
the ceiling's clamp provenance; never at invocation time. **An activation has exactly one
clamp grant**: the grant that authorized the activate operation (or `operator`). The ceiling
is `declaredRequirements ∩ clampGrant.permissions ∩ operatorPermissions ∩ levelAllowances`,
computed once at activation and recorded durably with: capability id, context level, session
binding when session-scoped, clamp provenance, and the ceiling itself. The two non-grant
inputs are durable records: **operatorPermissions** = the operator principal's root grant
record (seeded at boot by the identity seed, carried by the same grant families);
**levelAllowances** = a durable per-level allowance record family
(`authority.level.allowances`), operator-editable, defaulting fail-closed (empty) for
non-operator levels until configured.

**1.4 Per-invocation evaluation.** Every invocation decision uses the **invoking actor's**
authority, never the creator's:

```
allow(op, actor, ctx) =
    op.requiredPermissions ⊆ activation.ceiling
  ∧ op.requiredPermissions ⊆ actor.grant                    (trusted, durable, per-principal)
  ∧ op.requiredPermissions ⊆ ctx.allowances                 (workspace-bound scopes at the tool
                                                             layer; level allowances in the index)
  ∧ activation.state = active ∧ suspensionReasons = ∅
  ∧ clamp provenance intact (grant not revoked/expired; vacuous for `operator`)
  ∧ staticPolicy.permits(actor)                             (app-side actor rules, §1.6.v)
```

All inputs are reads of the **commit-synchronous authority index** (§2.1) or structural
context — never caller-supplied. Decisions are made live and never replayed, so the expiry
time-predicate reads wall clock at decision time only. `ALL_ALLOWED` cannot appear in any
input.

**1.5 Revocation, expiry, suspension reasons — and the lifecycle write path.** Suspension
carries a **reason set** (`operator-yank`, `grant-revoked`, `expired`, `integrity`,
`safe-mode`); `resumed` clears exactly one named reason. **Expiry of a session-scoped
activation is terminal**: archive-expiry writes an `expired` tombstone the unarchive fold
cannot clear — unarchiving restores the conversation, never the activation; re-establishment
is a new activation with a fresh ceiling.

*Write path (decided; the owner's preference adopted):* the store already provides conditional
commit — `DurableStore.commit` takes atomic append+record batches with per-record
`expectedVersion`, refusing stale versions, and its conformance suite proves both properties.
The application's general recording path (`agent.config` runs emitting via `ctx.emit`) does
not expose these primitives, and retrofitting the whole path is out of scope. **A narrow,
app-owned `lifecycleRecorder` adapter calls the store's conditional-commit API directly for
exactly five lifecycle-critical transition families** — activate, re-point,
suspend/resume/deactivate, the grant revocation/expiry batch, and the enablement marker —
using `expectedVersion` CAS on the touched activation/grant records and atomic multi-record
batches (a concurrent state change fails the whole batch, which retries against the re-read
index — CUJ 12). Every lifecycle write still validates its pre-state against the authority
index before committing, and the index updates synchronously on commit, so refusals are
visible at committed-event visibility with no fold-lag window. All other capability events
keep the existing recording path; the recording-gate inventory (§9.2) records this split and
its rationale: the gate's purpose — validated mutations against live state — is preserved by
index pre-validation plus CAS, and these five families are the security- and lifecycle-
critical set. Grant expiry is written by the durable scheduler (the automation machinery
extended with a clock-driven tick), producing the same CAS batch.

*Recorder discipline (verified against the store's contract):* the lifecycleRecorder
constructs full event envelopes itself (`tenant`, `correlationId`, `scopeId`, `occurredAt` —
an invalid envelope fails the whole batch before anything is written) and carries
idempotency keys on its CAS retries (a post-commit crash before recording success must not
re-apply facts). Its stream ids are **not run-shaped** — appends touching an enrolled run's
stream require the fenced `runOwnership` credential, which the recorder deliberately avoids.
The commit-hook listeners that feed the index and the descriptor dirty flag are **pure
in-memory updates** — a listener that itself commits would deadlock the memory store's commit
lock. Commit-synchronicity holds for the committing process (the single-process assumption
this design already states); cross-process LISTEN drain is asynchronous and out of scope.

**1.6 Defect remediation (prerequisite milestone — OQ-B decided).** Before the extensible
runtime is enabled — gated by a durable enablement predicate (§1.7) — five remediations land
and are proven by CUJ 4's refusal matrix: (i) the **runtime authority clamp** —
`task.create`-supplied authority demoted to a declarative hint; effective scopes = declared ∩
actor's grant ∩ operator permissions at use time; `ALL_ALLOWED` retired for agent-initiated
flows; the clamp covers the **full tool catalog** (today `authority.check` is consulted only
for `edit`/`bash`; `run_code`'s `sandbox_permissions` maps onto the shell scopes). (ii)
**per-agent run principals** (§1.1). (iii) **human-gate alignment** — every governance-gated
handler uses `kind !== "user" || ctx.runId` (today `requireUser` checks kind only). (iv)
**`session.harness.bind` gains the operator-only convention** (no actor check today while the
session host spawns host processes directly). (v) **the static policy's actor branch** —
`buildPolicy` (app code) gains an agent-principal branch over its allow-listed ids so
agent-principal runs can invoke the built-ins they legitimately need (model generation, the
dispatcher); the kernel API is untouched. **Tranche and timing (owner decision):** a
separately verifiable tranche scheduled after rev 43, unless independently judged to require
an immediate security fix on the current release line.

**1.7 The enablement gate.** Extensible-runtime mount is gated on a durable, evaluable
predicate: the operator-only `capability.runtime.enable` command writes
`workbench.capability_runtime.enabled` via the lifecycleRecorder, and its handler **refuses
unless the remediation evidence marker is present in the fold** (a remediation-complete
record written by the verification journey's evidence run). Boot reads the marker fold-first;
absent marker = bundles never mount; fail-closed.

### 2. The enforcement topology

**2.1 One decision function, its read path, and its enforcement points.**
`decideCapabilityInvocation` (§1.4) is implemented once. It reads the **commit-synchronous
authority index**: exactly two in-memory maps — grants per principal, and activations keyed
`capability + level + session` (version is a field, §4.1) — updated synchronously in the
store's commit hook (commit-synchronous on both backends). Deliberately *not* in the index:
bundles, hashes, faults, the spawn ledger (read at boot as a store query), and integrity
state (verified outside the index, §4.4) — they are not per-invocation decision inputs, and
keeping them out bounds the replay-equality test surface. The index is in-memory only,
rebuilt from the log at boot, replay-equality tested (§8); projections fold asynchronously
for UI only; enforcement never reads folds.

Enforcement points:

*   **A. The harness tool loop — the single decision site for model-facing calls.** Every
    model tool call — the full catalog, including `run_code` — is decided here before
    `ctx.invoke`, replacing caller-declared scopes (§1.6.i). For the dispatcher tool ids, the
    loop **routes to the dispatcher's decision and consumes its outcome** — one owner, no
    shadow evaluation. Composition order with the existing approval machinery: an **allow**
    pre-empts the human-continuation gate (a grant-covered operation does not park); an
    **approval** outcome parks as today; **deny** refuses.
*   **B. The dispatcher — the sole route to bundle functionality, with a runtime-enforced
    trusted/untrusted boundary.** Three kinds of code are strictly distinguished:

    - **Trusted app-owned adapters** are the only code that ever runs inside the application
      process on behalf of a capability. They are reviewed, shipped application code; the
      dispatcher mounts *adapter* Components (constructed by the dispatcher; their
      `activate(fiber)` closures register typed interpreters into the dispatcher's
      version-keyed table). Adapters interpret bundle **data** — manifest declarations, skill
      documents, tool schemas, harness patches, presentation fragments.
    - **Bundle-authored executable code never runs in the application process.** The v1
      handler kinds are data-interpreted: MCP tool routing (adapter → MCP client → spawned
      process), skill/payload serving (adapter reads version-directories), harness patches
      and presentation fragments (data consumed by the resolver and slot renderers). If a
      bundle needs custom executable logic, it declares an **executable handler**: a program
      the governed spawn boundary runs as a contained process (§2.2, §6), speaking the same
      framed protocol as an MCP server. There is no third path: the dispatcher never mounts a
      bundle-supplied function, and grep-pinned inventory plus CUJ 4 prove no route exists
      that loads bundle code as application code.
    - **Unforgeable invocation identity**: per-call tokens are minted by the trusted adapters
      ({capabilityId, version, callId} — constructed inside app-owned closures from the
      dispatcher's internal state, not derivable from bundle data), carried on the framed
      protocol to spawned executables, and attributed through the spawn ledger and
      `capability.mcp.*` records. A spawned executable holds **no kernel access and no
      application-process authority** — its entire capability surface is its declared
      resource scopes at spawn (§2.2) plus the framed protocol; everything else is refused by
      the process boundary itself.

    The dispatcher decides (§1.4) per call with the propagated caller's principal — context
    propagation carries the original invoker's actor through app-owned adapter code, and the
    anti-laundering property now has a runtime basis: untrusted code has no in-process
    foothold from which to re-invoke as the system caller. Expert assignment `authorityTools`
    allowlists gate the direct `edit`/`bash`/`run_code` tools; they do not gate the
    dispatcher (it is the bundle authority boundary itself) — recorded as the audit
    consequence.

    **Adapter-contract invariants (verified against kernel semantics):** interpreter-table
    registrations are app-side effects the kernel does not manage — every adapter registers
    its cleanup through `fiber.effects.register`, and the disposer convention is mandatory:
    a failed activation, hot-reload teardown, or dependency loss must leave the table empty
    (asserted by a test that fails an activation mid-registration). Adapters honor
    `fiber.signal` (an aborted-signal registration is disposed), declare **no `requires`**
    (a declared dependency's withdrawal would cascade deactivate/reactivate churn on every
    registry change), and do no slow work inside `activate` — the kernel's activation
    timeout is 30 s and content hashes are verified at registration, not inside the closure.
    Invocations racing activation receive the kernel's structured "no eligible provider"
    refusal (fail-closed; the journeys assert the envelope, not a crash).
*   **C. The governed execution-world spawn boundary.** All untrusted executable payloads go
    through a governed spawn wrapper on the provider ports — the aggregate-containment
    registry wrapper is the in-app precedent — enforcing the per-provider containment matrix
    (§6.2) at spawn, writing the spawn ledger (§6.3), and emitting a decision record on
    refusal. This bounds the *process*; per-tool-call authorization is A/B's job. The two
    layers are distinct and both named: **authorization of invocations vs containment of
    processes.**

**2.2 Untrusted executable bounds (the containment contract).** A spawned executable gets:
filesystem = its declared workspace-scoped paths via the provider port (never host paths;
protected paths and the app home refused); network = its declared outbound scope, default
deny; secrets = env-only references resolved from the secret store at spawn, fail-closed on
missing keys, never argv, never logged; subprocess = denied unless declared and the
provider's matrix admits it (the `run_code` nested-spawn shape is the live precedent the
contract governs). What the spawn boundary cannot bound — the executable's in-process
behavior — is the observation-honesty line: the runtime records what it observes (tool
invocations through the MCP client with their decisions) and says nothing about unobserved
internal activity. **The MCP protocol client (initialize handshake, tools/list, tools/call
framing, stdio transport over execution-world ports) is net-new engineering** — the largest
hidden item; sized in §10 and WP6.

**2.3 The invocation-path trace and the non-bypassability proof.** Every path by which work
executes, mapped to its enforcement point:

| # | Path | Today | Enforcement |
| --- | --- | --- | --- |
| 1 | Model tool calls — full catalog incl. `run_code` (harness loop) | `authority.check` on caller-declared scopes, **edit/bash only** (defect) | **A** — runtime clamp + decision; `sandbox_permissions` mapped onto shell scopes; `run_code`'s inner `Bun.spawn` inside the execution world is observation-honesty territory (§2.2) |
| 2 | Model calls of bundle tools + MCP tool executions (dispatcher tool ids) | — | **A → dispatcher decides once** with the caller's principal, then routes via its version-keyed table |
| 3 | Direct `ctx.invoke` of built-in capability ids from agent-principal runs | shared `system` caller (defect) | **§1.6.v** — app-side agent branch of the static policy; per-principal grants where a grant exists, allow-listed built-ins otherwise; CUJ 4 covers it |
| 4 | Direct `ctx.invoke` of bundle capability ids | denied (not allowlisted) | **stays denied** — the dispatcher is the sole route; handlers are never kernel-resolved (§2.1B) |
| 5 | Bundle-authored code in-process | — | **structurally impossible** — adapters are app-owned; executables are spawned; CUJ 4 includes the attempted-load refusal |
| 6 | Expert tool calls (`EXPERT_TOOLS`) | assignment validation + commitments | **A** (same loop); dispatcher callable; bundle *tools* stay out of `authorityTools` in v1 |
| 7 | Capability-internal provider-port operations (file/process) | workspace containment + grant plane | **C** + existing containment; grep-pinned inventory |
| 8 | Subagent children | `system` caller, no taskId, `ALL_ALLOWED` base (defect) | §1.1 narrowing — child authority derives from the parent's ceiling; remediated in the prerequisite |
| 9 | External harness CLI sessions (`session.harness.bind` → host process spawn) | **no actor check** (defect) | operator-only convention in the prerequisite; posture recorded honestly |
| 10 | Operator-initiated spawns (terminal pty local/SSH, browser CLI launch, desktop window, WSL probe) | operator surfaces | exclusion rows — operator acts, recorded; not agent-reachable |

The proof obligation is a test, not an argument: for each row, a forged-authority attempt is
refused; the inventory of `ctx.invoke` call sites, provider-port call sites, and
`Bun.spawn`/`child_process` sites is grep-pinned in the verification plan so a new call site
that skips the trace fails review.

**2.4 Resolved architectural decisions.**

*   **Tool-catalog insertion:** pre-declared dispatcher tool ids, standing members of every
    catalog (§2.1A); the generic dynamic-tool contract (§2.5) makes them sufficient for
    arbitrary new tools. `TOOL_DEFS` stays static; the one-time app code adds the ids to
    **three** static gates — `TOOL_DEFS`, `PRESET_TOOLS` (the per-preset filter that would
    otherwise hide them from every preset-scoped turn), and the policy allowlist
    `GRANTED_CAPABILITIES` — plus one loop branch that injects the §1.4 decision and consumes
    its outcome (routing itself needs no branch: the loop's generic `tool.<name>`
    fallthrough already reaches capability ids).
*   **Enforcement placement:** dispatcher-owned decision at the sole bundle route; the static
    kernel allowlist (with the §1.6.v app-side actor branch) is the bypass backstop; **no
    kernel API change in v1**.
*   **Session-scoped expiry:** durable session binding; archive-expiry terminal (§1.5).
*   **Governance-mode interplay:** when the SEA-Forge external authority is enabled, bundle
    invocations are **refused** in v1 (the external authority knows nothing of activations);
    mirroring the decision to the external authority is post-v1.

**2.5 The generic dynamic-tool invocation contract.** The standing dispatcher tool ids are
sufficient for genuinely new tools — no per-tool application code, ever:

*   **Discovery**: each capability's descriptor (§5.1) carries its tool entry lines; the
    dispatcher tool supports the discovery operation
    `tool.capability.invoke {capabilityId, op: "tools.list"}`, returning the committed
    version's tool definitions (namespaced ids, descriptions, JSON-Schema input specs) from
    the bundle's manifest and, for MCP servers, from the live `tools/list` response.
*   **Identification**: tool ids are namespaced strings — `mcp.<serverId>.<toolName>` for MCP
    tools, `<capabilityId>.<operation>` for executable handlers and data operations — unique
    per committed version.
*   **Invocation**: `tool.capability.invoke {capabilityId, tool, arguments}`. The dispatcher
    resolves the committed version (the §4.2.5 snapshot rule), validates `arguments` against
    the tool's declared schema (invalid → structured refusal carrying the schema error),
    decides authority (§1.4), then routes: MCP tools via the MCP client's `tools/call`;
    executable handlers via the framed protocol; data operations via the adapter interpreter.
*   **Error reporting**: one structured envelope everywhere — `{code, message, retryable,
    decidingPoint}` — so refusals (authority, schema, availability, containment) are
    distinguishable by the model and assertable by the journeys.
*   **What changes at the next model turn after a hot-load**: the descriptor section
    re-assembles when the activation commit marks it dirty (§5.1), so the model sees the new
    capability's entry lines; `tools.list` serves the new tool set from the committed
    version; no catalog, preset, or application change occurs.

### 3. Harness modification contract

**3.1 Honest substrate.** Three of the four surfaces are **net-new engineering over new
seams**: agent presets are a closed code union today (`PRESET_TOOLS` static;
`settings.changePreset` selects among three literals), and no instruction assembly exists for
non-expert runs (expert instructions are one template string snapshotted per assignment). The
v1 surfaces: **agent instructions** — named instruction sections are introduced by this design
as part of the run-start resolver (below); a patch declares `{section, operation:
append|replace, payload}`; **toolset override** — a per-existing-preset override record
(keyed by a preset id, validated with the settings writers' posture, consumed through the
existing `toolsForPreset` seam); full preset registration is out of scope until a journey
requires a new agent definition; **model routing** — per-expert routes exist; a capability may
register route constraints within operator ceilings (the spending-ceiling machinery bounds
cost); **workflows** — the one surface with existing machinery (`workflow.define`/
`workflow.instantiate`). Modifying surfaces is itself authority-gated (a grant covering
`harness.modify` at the surface's level); admission, approvals, grants, identity, containment
posture, the five core entries, and governance surfaces are not surfaces.

**3.2 Visibility: the run-start resolver.** All run sources — UI, mobile, subagent children,
schedules — resolve effective configuration at run start from durable activation state:
instructions (base + applied patches in precedence order), toolset (base preset map +
overrides), routing (base routes + capability constraints). Nothing mutates a running run
mid-flight. The resolver's result is recorded per run in `workbench.harness.assembled` — the
durable evidence CUJs 1 and 11 assert. Failure semantics: index unavailable at run start →
the run refuses to start (fail-closed, recorded); an activation suspended between assembly
and a later tool call → the assembled snapshot stands for the run's *configuration*, while
invocation-time decisions govern its *calls* into that capability (they refuse).

**3.3 Overlap resolution and restore.** Modifications declare their surface and are
conflict-checked at **activation** (the one transition where co-activity is decided): two
capabilities owning the same surface refuse co-activation via the `detectConflicts` ownership
machinery. Composable patches apply in deterministic precedence: operator-made configuration,
then persistent activations in activation order, then session-scoped activations in
activation order. The composed harness state is derived — folded from activation events,
never stored as a blob — so the operator restores a previous working configuration by
deactivating the offending capability; replay produces the prior state.

### 4. Runtime sequence, atomic reload, and reconciliation

**4.1 Normative records and the join.** Two record kinds with explicit keys:

*   **Ladder row** (skill-OS, unchanged): key `capability + implementation`; states
    `SPECIFIED → … → AVAILABLE`, human gates at REVIEWED/INSTALLED/AUTHORITY_GRANTED. Records
    definition and verification progress; gates the *published* activation path.
*   **Activation row** (new): **key `capability + level (+ session binding)` — version is a
    field on the row**, re-pointed by the repoint event; "mutates only the version field" is
    literally true. Other fields: ceiling, clamp provenance (grant id | `operator`),
    suspension-reason set, state (`dormant → active ⇄ suspended → retired`, with `expired`
    as a terminal retirement).

**Join:** activation requires either ladder ≥ AUTHORITY_GRANTED (published path) or a
covering grant (delegated path, §1.2). **Invocation eligibility = activation.state = active ∧
suspensionReasons = ∅ ∧ §1.4's permission legs.** The ladder is not the invocation gate for
delegated activations — that is D2's frictionless flow — and its human gates remain intact
for the publication path. Conflict detection is pinned to exactly one transition: the
activation commit; the binding-retirement tombstone is a precondition of that check's
correctness (live bindings only).

**4.2 The runtime sequence with commit points.** Every arrow is a durable event; bolded ones
are commit points the dispatcher and index read. Lifecycle-critical commits go through the
lifecycleRecorder (§1.5) with `expectedVersion` CAS and atomic batches; a concurrent state
change fails the batch, which retries against the re-read index; the fold refuses
state-inconsistent transitions (the unmatched-row precedent).

1. **Create/author** — bundle written to the authoring source; provenance recorded.
2. **Validate** — manifest schema, requirement satisfiability, content hashes, **payload
   ceilings** (per-bundle total, per-file, file count — numbers pinned at implementation
   planning, OQ-A; over-ceiling refuses registration).
3. **Register** — the payload **materializes into an immutable version directory**
   (`<bundleStore>/<capabilityId>/<versionHash>/`, copied once from the authoring/source
   location through the provider-backed ingestion path; the source is never read again);
   `capability.bundle.registered` records provenance and the version directory's hash.
   Nothing runs.
4. **Activate** — ceiling computed; the app-owned adapter component constructed and mounted
   (explicit-timeout wait ACTIVE, dispose-on-failure, per-capability child scope,
   per-version handle; failed components are terminal until reset — the dispatcher resets);
   the activate closure registers the interpreter into the dispatcher's table; **activation
   commits only after ACTIVE + CAS pre-state validation** — the commit point for "installed
   becomes live".
5. **Invoke** — decided per call against the index; **the invocation takes its version+ceiling
   snapshot and increments the per-version in-flight counter in one synchronous critical
   section before the first await** (the drain invariant depends on this).
6. **Replace (hot reload)** — new version registered (new immutable directory); new handle
   mounted and verified ACTIVE; CAS revalidation; **`capability.activation.repointed {from,
   to}` commits** — mutating the version field only. New invocations resolve the new version
   from the dispatcher's table; in-flight invocations keep their snapshots; the old handle is
   disposed **strictly after** its in-flight counter reaches zero (the kernel's teardown
   aborts in-flight calls, so disposal follows the counter, never precedes it — there is no
   kernel drain primitive; the app-side per-version counter is net-new, named).
7. **Suspend/Yank** — **the suspension event's commit is the refusal point**: the index
   updates synchronously on commit, so every enforcement point sees it with no fold-lag
   window. Managed processes stop per payload discipline (§6); the reason is recorded.
8. **Restart** — fold everything, then mount the active set (fold-first/mount-second). Kernel
   mounts are in-memory — a crash leaves no orphan mounts; the real crash orphans are
   **durable-effect orphans**: spawn-ledger entries without terminal records (the boot sweep
   reconciles per §6.3; the `reconcileContainmentAtBoot` pattern is the precedent) and
   partial version-directory materializations (incomplete directories are deleted and
   re-materialized on demand — registration is the only writer).

**4.3 Failure semantics.** Every failure mode maps to exactly one event family
(`capability.activation_failed`, `capability.repoint_failed`, `capability.validation_failed`,
`capability.integrity_failed`) with reason codes — the transition×event×fold matrix (§8) is
the totality proof. A failed replacement never re-points: **the last known-good version
remains executable — its immutable version directory is untouched, still hash-valid, and its
activation row still names it** (CUJ 13; the rollback guarantee covers metadata *and* payload
availability). **Any abort after mount and before commit disposes the mounted handle** (the
post-mount-abort rule). **Reverse orphan**: a handler fiber failing mid-session leaves
committed state active but unmounted — the dispatcher's mount table reconciles against the
index on every activation-family commit (the `fiber.state` observations feed it), and
refusals distinguish `suspended` from `unmounted`.

**4.4 Identity, version, integrity, retirement, context, source modification.** Identity is
namespace-partitioned (built-in ids reserved; bundle ids namespaced; ownership enforced at
`skill.register` — re-registering a foreign id refuses). Version = manifest version + payload
content hash; the version's bytes live in the immutable version directory, so integrity at
load = verifying the directory against its recorded hash (cheap, and a mismatch means
out-of-band tampering with the store itself — fail-closed load + `capability.integrity_failed`
+ reason-`integrity` suspension). Source modification is legitimate only through the governed
re-hash mutation, which materializes a new version directory and re-points (CUJ 2); the
authoring source location is never read after registration. Retention: the last N versions
(default 3, OQ-A) plus the active version are retained; pruning is an explicit recorded
maintenance event and never touches the active version. Retirement: `repointed` emits the old
binding's tombstone; conflict detection counts live bindings only. Context-level change = new
activation (never in-place).

### 5. Skill loader, discovery, and composition

**5.1 Discovery contract.** Each capability contributes a bounded **descriptor**: id, version,
one-line purpose, per-skill entry lines (name + when-to-use trigger), tool ids, and the
composition-guide entry-document flag. Descriptors are assembled per run by the run-start
resolver (§3.2); the assembled section is **re-assembled only when an activation-family
commit marks it dirty** (the same commit hook that feeds the index flips the flag) — so
in-session discovery of a newly activated capability arrives at the next turn boundary of an
already-running run, and every other turn pays once. Hard budgets: per-capability descriptor
ceiling and aggregate ceiling (numbers pinned at implementation planning, OQ-A);
over-budget descriptors truncate at registration, visibly recorded, never silently at load.
The relevance decision is the model's, made against descriptors; content loads only on
`tool.skill.load`.

**5.2 Loading and invocation.** `tool.skill.load {capabilityId, skillId}` is a pre-declared
dispatcher tool: it decides authority (reading a skill is an invocation), verifies the
version-directory hash, and returns the document. Composition guides are skills flagged as
entry documents; their discovery line instructs the model to load the guide before first use.
The descriptor load and the guide's delivery are recorded in `workbench.harness.assembled` —
the durable evidence for CUJs 1 and 11.

**5.3 Composition is content, not machinery.** The guide is a markdown document the bundle
authors; its structured counterpart remains contract data (`conflicts`/`complements`/`owns`),
enforced by `detectConflicts`. For the anchor journey the guide defines: Hallmark supplies
anti-slop aesthetic judgment and the audit/redesign verb set; Impeccable supplies the gated
craft workflow (context gate, shape brief, preflight); the handoff is Hallmark's structure and
anti-pattern rules feeding Impeccable's shape brief; conflicts resolve by domain — process
gates defer to Impeccable's preflight, aesthetic judgment defers to Hallmark's rules. CUJ 1
asserts the guide is loaded and *followed* (observable: the run's skill-load sequence and the
assembled record), not merely present.

### 6. Untrusted executables: containment, providers, and the spawn ledger

**6.1 Supervisor semantics.** The governed spawn wrapper owns the process group where the
provider supports it (local group-kill discipline); suspension stops managed processes;
resume re-spawns from the durable declaration with secrets re-resolved (fail-closed on
missing keys). Restart re-resolves the world before remounting.

**6.2 The per-provider containment matrix (verified against what each provider can actually
enforce; refusal is the default).**

| Restriction | local (contained posture) | local (uncontained) | SSH | WSL |
| --- | --- | --- | --- | --- |
| Filesystem bounds | yes — contained ports, path canonicity, `PathEscapeError` (TOCTOU caveat recorded by the provider) | port-level only | yes via ports | yes via ports |
| CPU/memory caps | yes — `prlimit --as/--cpu`, fail-closed when tooling absent; probe re-run on re-register (the per-world cache must not outlive a provider swap) | no → refuse caps-requiring payloads | no → refuse | no → refuse |
| Network | **total denial enforced** (`--unshare-all` unshares the network namespace) — a payload declaring any outbound scope is refused in this posture; what no provider offers is *scoped* outbound, which requires the operator's execution posture to explicitly and accurately permit an uncontained network posture | no network control → posture-gated, default refuse | no network control → posture-gated, default refuse | no network control → posture-gated, default refuse |
| Process-group termination | yes — live-set SIGKILL | yes **for the host-process path the spawn wrapper owns** (detached group + `kill(-pgid)`, the `hostProcess` precedent — not the exec port, which kills only the direct child) | **no** — channel close is not termination proof; TERM-to-supervisor best-effort, recorded as such | partial — group kill from a second session, TERM then KILL, session close last resort; best-effort recorded |
| Child-process denial | not enforceable (nested fork/exec inside the namespace is possible; nested user-ns is blocked) → declared + posture | not enforceable | not enforceable | not enforceable |

**Containment slots vs long-lived processes (reconciled):** the aggregate-containment slot
lease is exec-shaped — clamped timeout + 5 s, released at exec end — while MCP servers are
long-lived. Long-lived spawned processes therefore **do not hold exec slots**: they take a
dedicated long-lease slot class with their own bound (a per-world cap on concurrently held
long leases, folded into the same `containment:aggregate:v1` accounting thread), and their
resource-caps enforcement comes from the matrix row above, not from the exec-timeout lease.
The prlimit-availability probe is re-run when a world's provider re-registers, so a hot-swap
cannot inherit a stale probe result.

Behavior when a provider cannot enforce a required restriction: **refuse the spawn** and
record the decision, unless the operator's execution posture explicitly and accurately
authorizes the weaker posture for that payload (the posture is represented honestly in the
record — e.g. "termination on this world is best-effort channel close"). No parallel runtime
is introduced; existing execution-world facilities are used as they are.

**6.3 The spawn-ledger protocol (record-before-spawn).** The race — a process spawned before
its creation is durably recorded — is closed by ordering: the wrapper writes the **intent
record** (`capability.mcp.spawn.intended`, carrying spawn parameters and the invocation
token) *before* spawning; on success a **confirmed record** (`spawned`, with pid where the
provider exposes one) follows; on exit the **terminal record** (`exited`, with observed
outcome). The boot sweep reconciles: `confirmed` without terminal → kill by recorded pid
(where available) or best-effort signature kill (where the provider allows), then record;
`intended` without confirm → the process may or may not exist: best-effort signature kill
where allowed, then record `reconciled-unknown`. Every sweep outcome is a durable record; the
cleanup guarantee is exactly "every intent is reconciled to a recorded outcome," never more.

### 7. Presentation and recovery

**7.1 The v1 boundary and the future path.** Presentation extensions are declarative manifest
fragments: `{slotId, schemaVersion, payload}` consumed by named renderer slots. **The slot
registry and its error boundaries are net-new UI engineering** (the honest precedents: the
`InspectorTab` declarative registration pattern and the `pluginViews` honesty machinery;
React error boundaries do not exist in this codebase today and are introduced explicitly by
this plan as new infrastructure — the render-failure detector depends on them). V1 ships
**one** net-new slot kind — panel descriptors for capability-owned views rendered by
shell-owned components — plus capability rows through the honesty machinery; theme accents
are an ordinary settings record if wanted, not a slot. The boundary that protects the future:
slot consumers are swappable; unknown slot ids or schema versions **fail closed at
registration** (refused, recorded) — so richer slot types later are additive schema
evolution, not a redesign. Governance surfaces are not slots and cannot become them without a
core change (D6).

**7.2 Safe mode.** Failure classes and handling: (a) render failure — the slot's error
boundary marks the fragment faulty (durable fault event) and renders the core fallback, never
the broken component; (b) mount failure — hot-swap rollback disposes and records; (c) boot
readiness failure with extensions enabled — the B5 budget/watchdog detectors fire and safe
mode boots: all non-core fragments and bundle handlers excluded at boot (the exclusion read
precedes any render or mount), core shell renders, banner, one-at-a-time re-enable; (d)
governance-surface override attempt — refused at the render/bridge boundary, recorded as a
core violation, escalating to safe mode. Two failed boots with the same set keep extensions
suspended until the operator-only manual clear (its own event). Recovery never depends on
rendering the broken component because the exclusion read precedes render.

### 8. Durable state and event semantics

**The transition×event×fold matrix is normative**: every §4 arrow, every §4.3 failure mode,
every §1.5 expiry cause, and every index invalidation input maps to exactly one cell; the
totality proof is a replay-equality test (rebuild every projection and the index from
genesis, diff against live). Event families: `capability.bundle.registered | validated`;
`capability.activated | repointed | suspended | resumed | deactivated | uninstalled`;
`capability.activation_failed | repoint_failed | validation_failed | integrity_failed`;
`capability.binding.retired`; `capability.harness.patched | harness.assembled`;
`capability.presentation.faulted`; `capability.mcp.spawn.intended | spawned | exited |
tool_invoked` (the spawn ledger, §6.3); `authority.grant.issued | revoked | expired`;
`authority.level.allowances.set`; **`authority.decision.recorded {point, actor, capability,
operation, outcome, reasonCode}`** — the enforcement-decision record fed by A (refusals
always; bundle-path allows), the dispatcher, and the spawn boundary; built-in-tool allows
stay on the existing `tool.call.*` records, bounding volume; `session.activation` (binding
record); `workbench.safemode.boot_attempted | cleared`; `workbench.capability_runtime.enabled`;
`workbench.bundles.pruned` (retention maintenance); the kernel-observation bridge
(`workbench.kernel.observed.{provided,withdrawn,fiber_state}`, keyed by providerId, **never
joined to activation rows**; `invoked` is deliberately absent: bundle handlers are never
lease-invoked, §2.1B). Cross-family fold inputs are explicit: the capability fold consumes
`session.archived` (terminal expiry) and `authority.grant.*` (clamp suspension, CAS-atomic
batches). Effective state is derived everywhere; the index rebuilds from the log at boot with
replay-equality part of the totality test. Lifecycle-critical families are written by the
lifecycleRecorder (§1.5) — the recording-gate inventory in §9.2 records the split. One
volume note: `tool.call.started` records tool arguments verbatim today, so every dispatcher
call durably embeds its sub-tool arguments; the dispatcher's own emitted records bound and
truncate sub-tool argument payloads (the decision record carries the operation id and
outcome, not the full arguments), keeping §8's event volume bounded.

### 9. SEA migration steps (model-first, coordinated)

1. Model change (one coordinated change set, `domainforge validate` + `fmt --check` before any
   code): retire the Plugin entity and re-scope the trust clause; extend the skill-OS entities
   with version; add the Capability/Bundle/grant/activation entities and anchors; extend
   `J-WB-capability-lifecycle`; supersede `J-PLG-install` with **ten canonical journeys
   carrying the thirteen CUJs as variants** (j_cap_create, j_cap_reload [+ j_cap_rollback as
   its commit-revalidation-failure variant], j_cap_mcp, j_cap_refusal, j_cap_suspend [+
   j_cap_revoke as its grant-revocation variant], j_cap_safemode [+ j_cap_present as its
   positive variant], j_cap_restart, j_cap_source, j_cap_persist, j_cap_harness); re-author
   the in-code trust-boundary twin (`pluginRegistry.ts`, `plugins.ts`, `installRefusal`) in
   the same change; add the `domain/index.ts` anchor bindings; regenerate the doctor's
   model-hash manifest evidence.
2. **In-code recording-gate inventory** (the full set a new family threads):
   `WORKBENCH_EVENTS` (`src/workbench/types.ts`), the `workbench.recorded` allowlist
   (`src/agents/agentConfig.ts`), `SESSION_EVENTS`, the reducer, and a projection per family
   — the recording-path families join the command input union and the gate list; the five
   lifecycleRecorder families are recorded as the deliberate, documented exception with the
   §1.5 rationale.
3. **Replay mappings for legacy events (defined, not discovered):** `plugin.installed` folds
   to a dormant Capability row (kind `legacy-plugin`, provenance recorded, enable state
   carried); `plugin.uninstalled` folds to a retired tombstone; the `plugins` projection
   survives as a compatibility read-model for the migration window, retired afterward with
   recorded rationale; the four plugin suites: `J-PLG-install` superseded by
   j_cap_create/j_cap_persist variants; `J-PLG-panels`/`J-PLG-toggle` re-pointed to the
   capability-panel suites; `workbench-plugins` retained for the legacy fold mapping;
   skill-OS seeded rows seed unchanged.
4. Namespace partition lands with the model change (reserved built-in ids; bundle namespace;
   enforcement at `skill.register`).
5. Sequencing and dependencies: E-phase settles (rev 43) → **§1.6 prerequisite tranche
   (separately verifiable; CUJ-4-proven; timing per OQ-B)** → SEA model change (blocks all
   implementation) → lifecycleRecorder + authority index + event families → dispatcher +
   activation machine → skill loader + descriptor assembly and directory ingestion (loader
   payload journeys depend on ingestion) → MCP client + spawn boundary → presentation slots +
   safe mode (depends on error boundaries + fault families) → journey suites throughout, each
   tranche gated by `just verify`.

### 10. Framework gaps and upstream proposals

**V1 requires zero kernel and zero SDK API changes.** Everything the design needs exists:
`Kernel.mount` with plain Components and per-component provides; the static policy as the
bypass backstop; the store's conditional-commit API (used directly by the lifecycleRecorder);
commit hooks; the provider hot-swap discipline; the aggregate-containment wrapper precedent.
Net-new *app-side* engineering, honestly named: the run-start resolver and instruction
sections; the toolset-override record; the dispatcher's version-keyed handler table and
per-version in-flight counter (no kernel drain primitive — disposal follows the counter); the
commit-synchronous authority index (two maps); the lifecycleRecorder; the slot registry and
error boundaries; the spawn-ledger boot sweep; **the MCP protocol client**; the
grant-management capability family; the version-directory bundle store; the enablement gate.

Upstream proposals (post-v1, none blocking, none required by any contract in this design):

1. **`AuthorizationRequest` context fields** — would let the kernel policy evaluate
   per-principal, per-context decisions directly; v1 needs it not.
2. **Native tool-catalog dynamism** — per-bundle model-facing tools without dispatcher
   indirection.
3. **A kernel drain primitive** — graceful handler disposal with in-flight completion; v1
   uses the app-side counter.
4. **A durable kernel event sink** — kernel provide/withdraw events are ephemeral by design;
   v1 bridges the useful ones into the workbench log.
5. **Projection re-read amplification** — already recorded upstream (`docs/known-gaps.md`);
   v1 extends the in-app coalescing and keeps descriptor reads dirty-flagged.

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: Dynamic kernel policy branch (evaluate authority inside the kernel policy)

*   **Pros**: single chokepoint at the kernel; per-call context if `AuthorizationRequest` were
    extended; enforcement even for direct kernel invocations of bundle ids.
*   **Cons**: the kernel `AuthorizationRequest` cannot carry the invoking agent's identity
    usefully (every agent run presented as one shared principal until the per-agent-principal
    remediation) nor execution context; a custom async policy reading durable state per
    invocation adds a durable read to every call; the kernel registry's insertion-order
    resolution makes handler selection wrong regardless of policy.
*   **Reason for Rejection**: the dispatcher-sole-route design achieves the same refusal
    guarantees with the *unchanged* static policy as backstop (bundle ids are denied by
    absence from the allowlist), no new read on the hot path, and no resolution race. The
    `AuthorizationRequest` extension remains a post-v1 upstream proposal.

### Alternative B: Stored effective-authority records (materialize the intersection)

*   **Pros**: cheaper per-call decisions (no intersection at call time); simpler audits.
*   **Cons**: a fourth authority plane that can drift from the log — exactly the "second
    parallel authority system" D2 forbids; revocation and re-grant semantics become
    cache-coherence problems.
*   **Reason for Rejection**: effective authority is a read-time predicate over runtime-owned
    records; the authority index holds the *inputs*, never a stored intersection.

### Alternative C: In-process bundle handlers with test-enforced discipline

*   **Pros**: lowest latency; no protocol layer; simplest handler authoring.
*   **Cons**: untrusted code inside the application process cannot be reliably confined by
    convention; the "non-bypassability" claim would rest on grep-pinned tests substituting
    for a boundary.
*   **Reason for Rejection**: the owner required a runtime-enforced boundary. The two-tier
    model (§2.1B) — app-owned adapters interpreting bundle data; bundle executables spawned
    and contained — makes the boundary structural.

### Alternative D: Compensation logic around the existing recording path (no conditional commit)

*   **Pros**: no new write adapter; everything through `agent.config` runs.
*   **Cons**: `ctx.emit` has no `expectedVersion` and no cross-record atomicity; activate/
    repoint/revoke would need ordered-batch + reconciliation scaffolding whose correctness is
    argument, not guarantee — "complex compensation logic around a missing adapter."
*   **Reason for Rejection**: the store's conditional-commit API already exists and is
    conformance-proven; the `lifecycleRecorder` uses it directly for five families (§1.5).
    The owner's preference, adopted.

### Alternative E: Durable event-log payload copies (content-addressed partition store)

*   **Pros**: payload availability independent of the filesystem; one storage substrate.
*   **Cons**: a second source of truth diverging from the live directory; sync protocol;
    event-log bloat; experts-partition ceilings (768 KiB) ill-fitting for bundles.
*   **Reason for Rejection**: immutable version directories (§4.4) deliver the same
    availability and integrity guarantees at the filesystem layer with bounded retention, and
    the owner directed this resolution for the rollback contradiction.

### Alternative F: Host `fs.watch` on workspace/bundle directories

*   **Pros**: instant reload on edit.
*   **Cons**: crosses the execution-world provider boundary; silently breaks for SSH/WSL
    worlds; watcher storms amplify into recording runs.
*   **Reason for Rejection**: ingestion and materialization are provider-backed operations;
    modification is legitimate only through the governed re-hash; integrity at load catches
    out-of-band tampering without a watcher.

### Alternative G: Native per-bundle model-facing tools (dynamic `TOOL_DEFS`)

*   **Pros**: no dispatcher indirection; tools appear as first-class model tools.
*   **Cons**: requires dynamic tool-catalog machinery the runtime does not have (an SDK
    change); unbounded model-facing surface; harder refusal attribution.
*   **Reason for Rejection**: the generic dynamic-tool contract (§2.5) delivers arbitrary new
    tools through the static catalog; native dynamism is a post-v1 upstream proposal.

### Alternative H: Preset registration (new agent definitions) in v1

*   **Pros**: full harness-definition flexibility.
*   **Cons**: no journey requires it; new-preset namespace, lifecycle, and validation
    machinery would be unexercised code.
*   **Reason for Rejection**: toolset overrides of existing presets (§3.1) deliver CUJ 11;
    registration is deferred until a journey demands a new agent definition.

### Alternative I: Compiling authority grants onto `team.delegate`

*   **Pros**: existing delegation machinery; less net-new surface.
*   **Cons**: `team.delegate` inherits `authorityTools` verbatim — work decomposition, not
    authority delegation; no narrowing, no revocation plane.
*   **Reason for Rejection**: grants are net-new durable records; the only existing narrowing
    primitive is the kernel's `Scope.child`, which §1.1 uses for lineage.

### Alternative J: Notification channel for activation surfacing

*   **Pros**: push visibility for expert-created capabilities.
*   **Cons**: the owner decided the notification plugin is not shipped (OQ1, rev 42); the
    title-cue grammar would need a two-side protocol bump.
*   **Reason for Rejection**: the governance surface and attention cue are the recorded
    canonical channels.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Sequencing follows §9.5: **P** (prerequisite, separately verifiable) → **M** (SEA model
change) → **T1** (substrate: recorder, index, bundles) → **T2** (dispatcher, activation,
loader) → **T3** (executables: MCP client, spawn boundary) → **T4** (presentation, safe mode)
— with journey suites landing per tranche and `just verify` gating each boundary.

### Target Files to Create/Modify

#### Prerequisite tranche P (§1.6; CUJ 4 regression proof)

1. `src/agents/agentCoding.ts` (Modify) — the runtime authority clamp across the full tool
   catalog (replace the edit/bash-only `authority.check` consultation); map `run_code`'s
   `sandbox_permissions` onto shell scopes; add the two dispatcher tool ids to `TOOL_DEFS`/
   `PRESET_TOOLS`/expert-eligible catalogs and one loop branch routing them to the
   dispatcher's decision; the approval-gate composition order (allow pre-empts).
2. `src/capabilities/workbench.ts` (Modify) — `requireUser` aligned to
   `kind !== "user" || ctx.runId` everywhere; `task.create` authority demoted to a declarative
   hint (runtime clamp at use).
3. `src/server.ts` (Modify) — run-start caller discipline: agent-initiated runs start under
   per-agent principals; `buildPolicy` agent-principal branch over allow-listed ids.
4. `src/capabilities/subagentStart.ts` (Modify) — child runs start under the parent's agent
   principal with narrowed scopes.
5. `src/capabilities/harness.ts` (Modify) — `session.harness.bind` operator-only convention.
6. `test/J-CAP-prerequisite.test.ts` (Create) — the CUJ 4 refusal matrix for the clamp,
   principals, human gates, and harness.bind (the enablement marker's evidence source).

#### SEA model change M (§9.1–9.4; model-first)

7. `.sea/interaction/interaction-model.sea` (Modify) — retire the Plugin entity; re-scope the
   trust clause; version on skill-OS entities; Capability/Bundle/grant/activation entities;
   ten canonical journeys with the CUJ variants; `J-WB-capability-lifecycle` extension.
8. `domain/index.ts` (Modify) — anchor bindings for every new capability id.
9. `src/workbench/types.ts` (Modify) — `WORKBENCH_EVENTS` extension; `ActivationRecord`,
   `GrantRecord`, `DecisionRecord`, `SuspensionReason`, descriptor/bundle/harness types.
10. `src/workbench/skillOs.ts` (Modify) — version field on `CapabilityContractDef`;
    namespace partition enforcement at register; substitution checks against versions.
11. `src/workbench/reducer.ts` (Modify) — folds for every new family; binding-retirement
    tombstones; cross-family inputs (`session.archived`, `authority.grant.*`); refuse
    state-inconsistent transitions.
12. `src/projections/workbench.ts` (Modify) — capability/grant/decision/spawn folds.
13. `src/agents/agentConfig.ts` (Modify) — recording-path families join the command input
    union and the `workbench.recorded` allowlist; `SESSION_EVENTS` for `session.activation`.
14. `test/workbench-skillos.test.ts`, `test/workbench-contract.test.ts` (Modify) — version
    and partition updates; component-count contract refresh.
15. `test/J-PLG-install.test.ts`, `test/J-PLG-panels.test.ts`, `test/J-PLG-toggle.test.ts`,
    `test/workbench-plugins.test.ts` (Modify) — supersede/re-point/retain per §9.3.

#### T1 — substrate

16. `src/workbench/lifecycleRecorder.ts` (Create) — the conditional-commit write adapter
    (store `commit` with `expectedVersion`, atomic batches, index pre-validation, retry on
    CAS failure) for the five transition families.
17. `src/workbench/authorityIndex.ts` (Create) — the commit-synchronous index (two maps,
    commit-hook feed, boot rebuild, replay-equality support, fail-closed reads).
18. `src/capabilities/authorityGrants.ts` (Create) — `authority.grant.issue | revoke | list`,
    `authority.level.allowances.set`, `capability.runtime.enable` (operator-only; the §1.7
    predicate).
19. `src/capabilities/bundleStore.ts` (Create) — version-directory materialization, retention
    pruning (`workbench.bundles.pruned`), integrity verification helpers; provider-backed
    ingestion reusing the `workspaceFiles` bounded-directory guards.
20. `src/capabilities/capabilityBundles.ts` (Create) — bundle register/validate/activate/
    deactivate/uninstall; governed re-hash; conflict detection at activation; payload
    ceilings at validation.
21. `test/J-CAP-create.test.ts`, `test/J-CAP-reload.test.ts` (Create) — j_cap_create
    (CUJ 1, 11 data) and j_cap_reload (+rollback variant, CUJs 2, 13).

#### T2 — dispatcher, activation, loader, harness modification

22. `src/capabilities/capabilityRuntime.ts` (Create) — the dispatcher: boot-allowlisted
    capability; adapter-component construction and `Kernel.mount` (per-capability child
    scopes, per-version handles, explicit timeouts, reset discipline); version-keyed handler
    table; per-version in-flight counters; drain-then-dispose; reverse-orphan reconciliation
    against the index; `tool.capability.invoke` and `tool.skill.load` with the §2.5 contract;
    `authority.decision.recorded` emission.
23. `src/agents/runStartResolver.ts` (Create) — named instruction sections; toolset override
    application; routing constraints; descriptor assembly with dirty-flag re-assembly;
    `workbench.harness.assembled` recording; fail-closed on index unavailability.
24. `src/capabilities/skillLoader.ts` (Create) — descriptor registry; `tool.skill.load`
    serving from version directories with hash verification; entry-document flags.
25. `src/workbench/harnessPatches.ts` (Create) — instruction-patch/toolset-override/routing
    record types, validation, precedence composition, `workbench.harness.patched` events.
26. `test/J-CAP-harness.test.ts` (Create) — j_cap_harness (CUJ 11).

#### T3 — executables

27. `src/mcp/client.ts` (Create) — the MCP protocol client: initialize handshake, tools/list,
    tools/call framing over stdio through execution-world ports; invocation-record emission.
28. `src/mcp/spawn.ts` (Create) — the governed spawn wrapper: per-provider containment matrix
    (§6.2), record-before-spawn ledger protocol (§6.3), secrets env-only resolution,
    decision-record emission on refusal.
29. `src/capabilities/mcpManage.ts` (Create) — MCP server lifecycle capability family
    (start/stop/suspend/resume), supervisor integration.
30. `test/J-CAP-mcp.test.ts`, `test/J-CAP-suspend.test.ts`, `test/J-CAP-refusal.test.ts`
    (Create) — j_cap_mcp (CUJ 3, parameterized local + SSH/WSL), j_cap_suspend (+revoke
    variant, CUJs 5, 12), j_cap_refusal (CUJ 4 full matrix).

#### T4 — presentation, safe mode, sources

31. `src/ui/FragmentSlot.tsx` (Create) — the slot registry, React error boundaries
    (net-new infrastructure), fail-closed fragment registration, fault recording.
32. `src/ui/workbench/CapabilityDetail.tsx` (Modify/Create) — the capability inspector view in
    the governance surface (version, origin, creating actor, effective grants, attributable
    actions).
33. `src/workbench/safeMode.ts` (Create) — boot exclusion read (before render/mount), boot
    attempt counters, `reconcileContainmentAtBoot`-style sweep integration, core-violation
    detection.
34. `src/capabilities/safeMode.ts` (Create) — manual clear (operator-only, own event),
    boot_attempted recording.
35. `src/workbench/bundleSources.ts` (Create) — directory `PluginSource` implementation over
    provider-backed semantics (SSH/WSL identical); `BuiltinPluginSource` compatibility bridge
    during migration.
36. `test/J-CAP-safemode.test.ts`, `test/J-CAP-restart.test.ts`, `test/J-CAP-source.test.ts`,
    `test/J-CAP-persist.test.ts`, `test/J-CAP-present.test.ts` (Create) — j_cap_safemode
    (+present variant, CUJs 6, 10), j_cap_restart (CUJ 7), j_cap_source (CUJ 8),
    j_cap_persist (CUJ 9).

#### Documentation and ledger

37. `src/README.md`, `src/capabilities/README.md`, `src/workbench/README.md`,
    `src/components/README.md`, `docs/known-gaps.md` (Modify) — subsystem entries, invariant
    updates, upstream-proposal records.
38. `CURRENT_STATUS.md`, `.agents/CURRENT_STATUS.jsonl` (Modify) — milestone revisions per
    tranche; the EGM design artifacts recorded; rev 43 kept distinct.
39. `AGENTS.md` (Modify) — note the capability-runtime enablement gate and the
    single-operator limitation statement unchanged.

### Verification Plan

*   **Build/typecheck**: `just typecheck` after every tranche; `bun run typecheck` in CI.
*   **Model gates**: `domainforge validate` + `fmt --check` after every model change (§9.1)
    before any code lands; doctor's model-hash manifest regenerated at packaging.
*   **Unit/journey tests**: the ten canonical journeys (`test/J-CAP-*.test.ts`) carrying all
    thirteen CUJs; the §1.6 prerequisite suite gates enablement; replay-equality test
    rebuilding every projection and the authority index from genesis; the grep-pinned
    call-site inventory test (invoke sites, provider-port sites, spawn sites) refusing new
    untraced paths; cache/index transparency test (append each event family, assert decision
    equality); concurrent-transition tests (activate vs suspend, repoint vs revoke, revoke vs
    resume) proving CAS batch behavior.
*   **Negative proofs**: CUJ 4's refusal matrix (forged grants, alternate paths, lineage,
    post-suspension, attempted in-process load, system-caller laundering) — all asserted from
    `authority.decision.recorded`; the adapter-cleanup test (an activation failed
    mid-registration leaves the dispatcher's interpreter table empty — the
    `fiber.effects.register` disposer convention); the pre-ACTIVE refusal envelope assertion;
    CUJ 1 asserted from a preset-scoped session (the `PRESET_TOOLS` gate is covered).
*   **Full gate**: `just verify` at every tranche boundary; the documented
    host-concurrency flake classification discipline applies.
*   **Evidence**: per-tranche verification rows in `.agents/plans/capability-bundles/verification.md`;
    `CURRENT_STATUS` revisions per milestone; enablement recorded only after the prerequisite
    matrix passes.

--------------------------------------------------------------------------------

*Drafted with EGM*
