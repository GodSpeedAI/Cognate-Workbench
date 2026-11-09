# Capability Bundles — a dynamically extensible Cognate Workbench

*   **Author:** Sam Prime
*   **Status:** Proposed — review-ready (revision 5; consolidated-review reconciliation applied; see `reconciliation.md`)
*   **Date:** 2026-11-08

**Decision baseline:** `.agents/plans/capability-bundles/concepts_brief.md`. References used
in this document: **D1** trust-model change (executable payloads under contracts) · **D2**
authority grants, not self-authorization (granted flow needs no extra approval; beyond it,
refuse or request authorization) · **D3** one capability model via coordinated migration ·
**D4** in-session hot-load is a core requirement; framework gaps go upstream · **D5** yank =
immediate suspension, never uninstall · **D6** mutable presentation, immutable core, safe
mode · **D7** post-E-phase sequencing, directory sources first, journey evidence. **OQ-B**
(decided): the §1.6 remediation cluster is a mandatory prerequisite tranche after rev 43
unless independently judged an immediate security fix. "E-phase" is the desktop
native-completion release qualification recorded in `CURRENT_STATUS.md` (revisions end at
rev 43); "cordis" is the plugin framework beneath the Cognate kernel.

--------------------------------------------------------------------------------

## Overview

The Cognate Workbench adapts its users' agent harness today only through engineering releases:
the extension surface is a static, code-defined plugin catalog whose stated trust boundary is
"no downloaded code is ever evaluated", and the skill OS can register capability definitions
that nothing dispatches. An operator who wants the workbench to learn a new skill, gain a new
tool, or change how its agents behave must wait for a build.

This feature makes capability a governed mechanism for adapting the Workbench and its agent
harness within a live session. A capability is the user-facing concept — built-in, installed,
composed, or dynamically created; a **bundle** is its packaging and distribution form (the
word "bundle" names payload, store, and manifest — never identifiers, handlers, or table
entries). Users and authorized agents create, compose, install, modify, and use capabilities
in the current session — including modifications to permitted harness behaviors (instruction
patches and toolset overrides in v1; model routing and workflow composition are recorded
follow-on surfaces, §3.1). The Hallmark and Impeccable example is the anchor journey: those
are external file-based design skills used as example payload — an operator asks the
orchestrator expert for a visual-design capability bundling them, and it is available and
usable without restarting the session.

The design stands on the existing Cognate architecture — capability contracts, fibers (kernel
execution units), the durable event log, the skill OS, the grant plane (per-task
`AuthorityScopes`) — and extends it with one new trusted surface: a dispatcher that is the
**sole route** to bundle functionality, holds the version-keyed handler table, and enforces
the authority decision per invocation. Bundle-authored code never runs inside the application
process (§2.1B); untrusted executables run as spawned, contained processes. Authority
originates from trusted grants attached to per-agent principals, never from the invoking
agent's declarations. The immutable security, identity, admission, approval, and recovery
machinery is preserved; the extension system operates through it. **V1 requires zero kernel
or SDK API changes** — the store's existing conditional-commit API is used directly by the
lifecycleRecorder (§1.5).

## The Problem

Three things are broken about extension today, and one is a defect:

1. **The catalog is static.** `PLUGIN_CATALOG` is compiled into the app; "installing" a plugin
   only activates an implementation the app already contains. The `PluginSource` seam
   (`src/components/pluginRegistry.ts:22`) was designed for marketplace and directory sources
   but never given one.
2. **The skill OS is a registry, not an execution plane.** `skill.register` records events;
   `canInvoke` (`src/workbench/skillOs.ts:50`) gates no invocation path; components mount at
   boot from a static list (`src/server.ts:788-902`). There is no path from a registered
   capability to a live, invocable surface.
3. **Harness adaptation requires a release.** Skills, prompts, tool compositions, and model
   routing are code. Nothing can be changed mid-session, and nothing an agent creates can
   enter a session.
4. **Defect: agents can declare their own authority — and identity collapse hides it.**
   `task.create` accepts a caller-supplied contract `authority`
   (`src/capabilities/workbench.ts:189-193`); `authority.check` honors exactly those scopes
   and only for `edit`/`bash` (`:381-402`, consulted at `src/agents/agentCoding.ts:625-626`);
   unbound runs default to `ALL_ALLOWED` (`:70-77`). Every agent-initiated run executes as
   the shared `system` caller (`startRun(SYSTEM_CALLER)`, `src/server.ts:585`) — and because
   `requireUser` checks only `ctx.actor.kind !== "user"` (`src/capabilities/workbench.ts:143-145`),
   a run whose caller was recorded with a user-kind actor passes human gates from inside an
   agent run (the user-kind masquerade: the run inherits its *starter's* recorded principal
   rather than an agent principal). Remediation of this cluster is a **prerequisite** of this
   feature (§1.6).

The proposed solution: capability bundles (skills with composition guides, MCP server
declarations, harness modifications, presentation fragments) loaded by a new skill loader,
routed exclusively through a boot-allowlisted dispatcher that registers bundle handlers into
its own version-keyed handler table and enforces per-invocation authority from durable,
runtime-owned records; untrusted executable payloads bounded by a governed execution-world
spawn boundary; suspension immediate; lifecycle records durable with CAS transitions; safe
mode automatic; and a coordinated SEA migration retiring the plugin entity and the old
trust-model clause through the model-first sequence.

## Goals

*   **G1 — In-session creation and use.** An operator or granted agent can create, compose,
    install, modify, and use a capability in the current session: no restart, and no
    additional human approval for operations covered by a valid authority grant (CUJs 1, 2).
*   **G2 — One capability model.** Plugins and skill-OS capabilities unify into one lifecycle
    and management model through a coordinated SEA migration (the authoritative interaction
    model at `.sea/interaction/interaction-model.sea`); semantic IDs and durable records are
    carried through with defined replay mappings over the historical log (§9.3).
*   **G3 — Authority that cannot be self-enlarged.** Effective authority is a read-time
    predicate over runtime-owned inputs — never caller-declared — evaluated at traced,
    non-bypassable enforcement points across every invocation path, with every decision and
    refusal durably recorded and a runtime-enforced boundary between trusted adapters and
    bundle-supplied code. The negative cases are proven by test: forged grants, alternate
    invocation paths, broader workspace scopes, subagent lineage escalation, and
    post-suspension invocations acquire no authority (CUJ 4). **Prerequisite:** the §1.6
    defect cluster is remediated and proven before the extensible runtime is enabled.
*   **G4 — Harness modification.** Capabilities can modify permitted harness behaviors under
    declared surfaces with conflict refusal, deterministic precedence, and operator-restorable
    state; configuration changes are resolved at run start and capability discovery at the
    next model-turn boundary, usable in the live session across every run source (CUJ 11).
    V1 ships two surfaces (instruction patches, toolset overrides); model routing and
    workflow composition are designed extension surfaces with recorded follow-on work (§3.1).
*   **G5 — Executable payloads under explicit contracts.** Untrusted executable payloads (MCP
    servers, executable handlers) run only as spawned processes through execution-world ports
    under a per-provider containment contract that refuses what the provider cannot enforce;
    secrets resolve env-only from the secret store and fail closed on missing keys; audit
    records reflect only what the runtime observed (CUJ 3).
*   **G6 — Skills that are discoverable and compose.** Discovery through lightweight metadata
    within pinned per-capability and aggregate token budgets; full instructions load on
    relevance; per-capability composition guides govern how constituent skills cooperate and
    resolve conflicts (CUJ 1 asserts guide delivery and gated use, not loading alone).
*   **G7 — Lifecycle with atomic reload.** Yank is immediate suspension — new and queued
    invocations are rejected at committed-event visibility via the commit-synchronous
    authority index; lifecycle transitions commit through the store's conditional-commit API;
    interrupted consequential work stays subject to commitment and reconciliation rules.
    Replacement is atomic and the last known-good version remains executable — payload
    availability is guaranteed by immutable version directories (§4.4). Uninstall and
    rollback are separate operations. Revocation of a grant suspends the activations it
    clamped (CUJs 5, 12, 13).
*   **G8 — Mutable presentation, immutable core, automatic safe mode.** Presentation is
    customizable starting from declarative fragments, with versioned extension boundaries
    that do not foreclose payload-bearing slot kinds later; governance surfaces are excluded
    and their override treated as a core violation; non-security built-ins are disable-able
    but never removable; safe mode recovers without rendering the broken component and
    without corrupting the durable registry (CUJs 6, 10).
*   **G9 — Sources that respect the execution-world boundary.** Directory sources work over
    provider-backed environments (SSH, WSL) identically to local; no host filesystem
    assumptions (CUJ 8).
*   **G10 — Framework gaps go upstream.** Every SDK limitation the design encounters is named
    as an explicit upstream proposal, never worked around silently in app code (§10; v1 needs
    none — the store's conditional-commit API provides the required concurrency guarantees).
*   **G11 — Model-first evidence.** The journey family enters the SEA catalog before
    implementation: ten canonical journeys carrying all thirteen CUJs as asserted variants;
    `domainforge validate` and `domainforge fmt --check` on
    `.sea/interaction/interaction-model.sea` after every model change; `just verify` at
    tranche boundaries.

## Non-Goals

*   Becoming a cordis plugin host, or implementing a competing framework inside the Workbench.
*   A second parallel authority system: no second decision function, no delegation compiled
    onto `team.delegate`; effective authority is always derived at decision time from grants,
    activation state, and context.
*   Running bundle-authored code inside the application process (§2.1B).
*   Multi-identity RBAC rollout. Authority grants and context levels keep the extension path
    clean; the work-group key is reserved and fail-closed.
*   Bypassing or modifying the immutable authority, identity, admission, approval, and
    recovery machinery.
*   Shipping during E-phase: implementation begins after rev 43 settles.
*   Assuming every workspace is a local filesystem directory.
*   In v1: marketplace machinery, durable event-log payload copies, per-bundle event budgets,
    rollback-to-version UI, structured composition-guide formats, work-group substrate,
    native per-bundle model-facing tool registration, preset registration (toolset overrides
    of existing presets only), bundle tools in expert `authorityTools` allowlists,
    theme-accent fragments, an editable level-allowance record family (structural constants
    in v1, §1.3), model-routing and workflow harness surfaces (designed + deferred, §3.1),
    a general package store.

## Open Questions

All previously-open questions are resolved: §1.3 (level legs), §1.5–1.7 (write path,
deployment invariant, enablement gate), §2 (enforcement placement, tool catalog, deadlines),
§3.1 (surface staging), §6 (containment, posture, ledger), §10 (MCP SDK, schema validator,
timeout). The numbers formerly deferred to OQ-A are **pinned** in the Verification Plan and
`verification.md` (blocker CR-B1's resolution). OQ-B is recorded in the header. None
remaining.

## Critical User Journeys (CUJs)

### CUJ 1: Create a visual-design capability in-session

*   **Given**: An operator session whose orchestrator expert holds an authority grant to
    create and enable user-scoped capabilities; Hallmark and Impeccable payloads available
    from a directory source or authored by the expert.
*   **When**: The operator asks the orchestrator to create a visual-design capability bundling
    them.
*   **Then**: The expert composes the bundle (skills + composition guide), validates,
    registers, and activates it in the live session — no restart, no additional approval. A
    subsequent agent run in the same session exercises the capability: descriptor metadata was
    present without full preload, the composition guide reaches the model and governs the
    workflow (asserted from the skill-load sequence and `capability.harness.assembled`), and
    the skills load on relevance. The capability panel shows version, origin, creating actor,
    and effective grants. Asserted from a **preset-scoped session** (all four static gates
    covered, §2.4).

### CUJ 2: Modify an installed skill — versioned reload

*   **Given**: An installed, active capability with a versioned binding.
*   **When**: The operator modifies a skill through the governed re-hash mutation, which
    materializes a new immutable version directory.
*   **Then**: The next eligible invocation — dispatch-committed after the reload commit —
    observes the new version without losing the session. In-flight calls complete under the
    version snapshot they took at dispatch start — asserted by the `repointed` commit
    preceding the old-version `tool.call.completed` record — or are refused per D5. The
    replaced binding is retired; conflict detection sees live bindings only; the repoint
    re-ran the conflict check (§3.3).

### CUJ 3: MCP server lifecycle with authority and audit

*   **Given**: An authorized capability declaring an MCP server; parameterized over the local
    world and one provider-backed (SSH or WSL) world.
*   **When**: The capability is installed, started, invoked, suspended, and recovered.
*   **Then**: The server spawns only through the governed execution-world spawn boundary under
    its declared resource scopes, recorded before the process starts (§6.3); a restriction the
    provider cannot enforce refuses the spawn with a decision record — fail-closed — unless
    the world's execution-posture record explicitly authorizes the weaker posture (§6.2); a
    refused spawn (world unavailable, missing secret key, unenforceable restriction) emits a
    decision record with its reason; secrets resolve env-only; recorded MCP tool invocation
    events are distinguished from unobserved subprocess activity; at suspension the stop is
    initiated synchronously with the suspension commit and the termination outcome is recorded
    per the §6.1 discipline; recovery re-resolves the world and remounts from durable state.

### CUJ 4: Refusal outside granted authority (negative proof)

*   **Given**: An agent holding a limited authority grant.
*   **When**: The agent forges its grants, requests a capability beyond its grant, uses a
    broader workspace scope, invokes through an alternate path, attempts to invoke a bundle
    handler as the system caller, or continues after suspension.
*   **Then**: Every attempt is refused at its traced enforcement point, and each refusal is
    durably recorded in `authority.decision.recorded` with a reason code and the deciding
    point's identity — including the backstop rows: static-policy refusals (trace row 3) via
    the policy-refusal hook, subagent-lineage refusals (row 8) via the narrowing check's
    record, and `session.harness.bind` convention refusals (row 9) via its recorded refusal.
    This CUJ is the §1.6 prerequisite regression proof and the enablement gate's evidence
    source; the per-row observability contract is the last column of the §2.3 table.

### CUJ 5: Suspension blocks, preserves, and records

*   **Given**: An active capability with in-flight consequential work.
*   **When**: The operator yanks it.
*   **Then**: New and queued invocations are rejected at committed-event visibility (each
    refusal recorded); process stop is initiated synchronously with the suspension commit and
    the termination outcome is recorded per §6.1; graceful-vs-emergency follows the payload
    type; interrupted consequential operations keep their commitment states and enter the
    existing reconciliation path; the audit surface attributes every observed action; the
    suspension reason is recorded and `resumed` clears exactly that named reason (a
    still-non-empty reason set leaves the row suspended).

### CUJ 6: Safe mode from a broken extension

*   **Given**: A broken capability or presentation extension — including one that overrides a
    governance surface (a core violation).
*   **When**: Boot fails its readiness budget with extensions enabled, the extension's render
    or mount fails, or the override is attempted.
*   **Then**: Safe mode boots with a known-good presentation without rendering the broken
    component, suspends the problematic extensions, preserves the durable capability
    registry, and lets the operator inspect and recover one re-enable at a time; the manual
    clear is an operator-only capability with its own event; a governance-surface override
    attempt is refused at registration and recorded as a core violation.

### CUJ 7: Restart restores only recorded effective state

*   **Given**: Mixed durable state — persistent installs, session-scoped activations,
    suspended capabilities, retired bindings, plugin-era historical events, and a crash that
    left an intended-but-unconfirmed or confirmed-but-running MCP spawn.
*   **When**: The Workbench restarts.
*   **Then**: Boot folds first and mounts second; persistent recorded state is restored;
    **every session-scoped activation expires at boot (derived, before mount — §1.5)**; the
    boot sweep reconciles the spawn ledger — killing confirmed-but-running processes by
    record, best-effort version-directory-scoped signature kill for unconfirmed intents
    where the provider allows, recording every outcome; plugin-era events replay to their
    defined mappings (§9.3); a bundle re-registering a built-in id cannot shadow it.

### CUJ 8: Provider-backed directory source

*   **Given**: A capability bundle directory on an SSH or WSL execution world.
*   **When**: The operator installs from it.
*   **Then**: Ingestion, hashing, version-directory materialization, registration, and
    loading behave identically to a local-world install; no host filesystem watch or read is
    involved.

### CUJ 9: Persistent activation across context levels

*   **Given**: A capability activated persistently (across sessions) at a stated context
    level; level allowances are structural constants in v1 (§1.3).
*   **When**: Authority decisions are evaluated in sessions within and outside that level.
*   **Then**: The context-level scoping is observable in `authority.decision.recorded`; the
    activation survives restart per its stated scope; session-scoped and persistent
    authorities remain independent rows governed by the §4.1 selection rule.

### CUJ 10: Presentation extension in the normal path

*   **Given**: A declarative presentation extension (panel descriptor) from an installed
    capability.
*   **When**: The Workbench renders normally.
*   **Then**: The fragment renders through the slot registry and honesty machinery;
    governance surfaces (approval dialog, authority displays, audit views) are untouched by
    any extension.

### CUJ 11: Harness modification, hot-reloaded and demonstrably used

*   **Given**: An operator session with an orchestrator expert granted harness-modification
    authority for user-space, session-scoped changes (an instruction patch and a toolset
    override for the standard preset).
*   **When**: The operator asks the orchestrator to make the coding agent follow a
    "deep-dive then implement" workflow with a repo-conventions instruction patch.
*   **Then**: The expert authors the modification as a capability bundle (declared surfaces:
    instruction patch, toolset override), validates, registers, and activates it in the live
    session. The **next agent run** in the session demonstrably uses it, regardless of run
    source: the run-start resolver applies the patch and override from durable activation
    state, and `capability.harness.assembled` records the effective instruction set and
    toolset by hash + delta (§3.2). Overlapping modifications follow the per-surface overlap
    rule (§3.3); deactivating the capability restores the prior working configuration by
    replay.

### CUJ 12: Revocation of delegated authority

*   **Given**: An agent holding authority grant G, under which it activated capability C
    (C's activation ceiling was clamped by exactly G and the activation record names G).
*   **When**: The operator revokes G (or the durable scheduler records its expiry).
*   **Then**: The lifecycleRecorder commits, in **one CAS-atomic batch**, the suspensions
    (reason `grant-revoked`, or `grant-expired` for scheduler expiry) of every activation
    clamped by G together with the grant record; a concurrent state change fails the whole
    batch, which retries against the re-read index; new invocations of C under those
    activations are refused at committed-event visibility; process stop initiates
    synchronously with the batch commit and outcomes are recorded; operator-established
    activations are unaffected; C's registry record and provenance persist (suspended, not
    deleted). Grants are immutable — adjustment is revoke + reissue. Re-granting does not
    silently reactivate: resumption clears a named reason only by an explicit act.

### CUJ 13: Failed hot-reload rollback

*   **Given**: An active capability at version 1, whose payload lives in an immutable version
    directory.
*   **When**: A replacement (version 2) is registered and activated but its handler mount
    fails kernel activation — or the repoint's CAS commit fails because the activation was
    suspended concurrently.
*   **Then**: The failed handler is disposed (any abort after mount and before commit disposes
    the mounted handle); the activation record was never re-pointed, so version 1 remains the
    last valid effective state **and version 1's payload directory is untouched and still
    passes its integrity check**; the failure is recorded in `capability.repoint_failed`
    (mount failures: `capability.activation_failed`) with its reason; no partial mount
    exists; the next invocation uses version 1; the durable log shows the failed attempt
    without state corruption.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 0. Reading order, glossary, precedents

§1 authority model → §2 enforcement topology → §3–§7 subsystem contracts → §8 durable
substrate and the normative matrix → §9 migration → §10 framework gaps and dependency
decisions → §11 risks. Principles: one authority decision function; runtime-owned inputs
only; the dispatcher is the sole route to bundle functionality; bundle-authored code never
runs in-process; durable events own state via the normative transition×event×fold matrix
(§8); lifecycle-critical transitions commit through the store's conditional-commit API; the
smallest coherent mechanism that meets the contract.

**Existing-system terms:** **skill OS** — the capability-definition registry with its
nine-state lifecycle (`src/workbench/skillOs.ts`: `skill.register`/`skill.bind`/
`skill.lifecycle.advance`); **grant plane** — per-task `AuthorityScopes`
(`src/workbench/types.ts:10-18`) enforced per tool call; **fibers** — kernel execution units
that mount Components and serve capability contracts; **execution world** — a provider-backed
environment (local, SSH, WSL) reached only through provider ports (`filesystem.*`,
`process.exec`); **expert** — a governed agent identity in the Experts registry (the
orchestrator expert delegates via `team.delegate`); **honesty machinery** — the row-rendering
pattern that shows state with verbatim reasons (`pluginViews`, `src/plugins.ts:105-129`).
"CAS" = compare-and-swap via per-record `expectedVersion`.

**Precedents** (name → behavior → location): provider hot-swap (mount → wait ACTIVE →
dispose-on-failure rollback) → `src/components/providerRegistry.ts:130-146`; aggregate
containment (exec leases with CPU/memory caps, fail-closed when tooling absent) →
`src/capabilities/aggregateContainment.ts`; boot reconciliation →
`reconcileContainmentAtBoot` (`src/server.ts:751`) and `restoreExecutionWorlds`
(`src/capabilities/executionWorlds.ts:158`); unmatched-row fold refusal →
`src/projections/plugins.ts:29-31`; bounded directory guards (500 entries / 512 KiB, symlink
refusal) → `src/capabilities/workspaceFiles.ts`; process-group stop (detached group,
`kill(-pgid)`) → `src/agents/harness/hostProcess.ts:100-119`; SSH termination honesty
("no process group is reachable: close the channel") → `src/terminal/ssh.ts:100`;
conditional-commit + conformance proofs →
`node_modules/@godspeedai/cognate-events/src/conformance.ts`.

### 1. The authority model

**1.1 Subjects and principals.** Authority attaches to **per-agent principals**. Every
agent-initiated run — `agent.coding` runs, expert runs, subagent children — starts under the
responsible agent principal (`Principal.kind: "agent"` exists in the kernel;
`startRun(caller)` is app-controlled, so the discipline is a per-call-site rule with a
per-site table owned by tranche P — Detailed Plan item 7). UI-started runs carry the operator
principal for the client call; the agent work they start runs under the responsible agent's
principal. **Grant subject = principal id (+ optional task or workspace binding).** Subagent
children start under their parent's agent principal and inherit authority **by narrowing
only** — the child's effective set is the parent's ceiling ∩ the child's task scopes, never
wider (`Scope.child` — "never gains authority by inheritance",
`node_modules/@godspeedai/cognate-kernel-api/src/types.ts:195-205`).

**1.2 Four authority kinds, and the outcome table.**

| Kind | What it permits | Establishes |
| --- | --- | --- |
| **Author** | Compose/author a bundle; write to the authoring source | **Provenance only** — creator identity, source, content hashes. Authoring grants no execution authority. |
| **Install** | Bring a validated bundle into the registry as a dormant capability at a context level | The requirement set: declared requirements validated for satisfiability; unsatisfiable declarations fail install. |
| **Activate** | Establish an activation at a context level | **The activation ceiling** and its clamp provenance (1.3). Requires ladder ≥ AUTHORITY_GRANTED on the capability's primary implementation (published path) or a covering grant (delegated path). |
| **Invoke** | Call a capability's operations | Nothing durable — decided per invocation (1.4). |

**Outcome beyond authority, by kind (the D2 reconciliation, settled):** an **invocation**
attempt beyond the invoking actor's grant is **refused** (recorded); an **activation or
creation** request beyond the actor's grant **parks** on the existing approval machinery as
an authorization request (a durable human-gate continuation — D2's "request authorization");
D2's "inactive draft" option is **dropped** — the authorization request covers the need
without a second pending state (recorded rationale: one pending mechanism, not two). Inside
a covering grant, none of these park (D2's no-friction rule).

**1.3 Provenance is not authority; the ceiling; the level legs.** The creator's grant is
consulted at most once — when the creator is also the activator — and is recorded as the
ceiling's clamp provenance; never at invocation time. **An activation has exactly one clamp
grant**: the grant that authorized the activate operation (or `operator`). The ceiling is
`declaredRequirements ∩ clampGrant.permissions ∩ operatorPermissions ∩ levelAllowances`,
computed once at activation and recorded durably on the activation row with: capability id,
context level, session binding when session-scoped, clamp provenance, and the ceiling.

**The ceiling is not a stored effective-authority record** (reconciling Alternative B with
D2): it is the *activation's own immutable bound* — one input of the live predicate, not the
predicate's result. Effective authority is still derived at decision time (ceiling ∩
invoking-actor grant ∩ context, §1.4); a grant change never updates a stored intersection —
it changes what the live legs accept, or triggers the revocation batch. The staleness rule
is total: **the ceiling is immutable for the activation's life; tightening requires a new
activation; live inputs can never exceed it.**

The non-grant legs: **operatorPermissions** = the operator principal's durable root grant
record (operator-governable — issued and adjusted through the grant capability under the
operator-only rule; seeded at boot, Detailed Plan item 25). **levelAllowances** are
**structural constants in v1** (user space: the standard built-in allowance set; workspace:
the workspace-scoped subset; work group: empty, fail-closed) — the editable record family is
deliberately not built (Alternative K); it returns with a reconfiguration journey. Delegated
authority still derives from trusted grants and context at every decision.

**1.4 Per-invocation evaluation.** Every decision uses the **invoking actor's** authority,
never the creator's:

```
allow(op, actor, ctx) =
    op.requiredPermissions ⊆ activation.ceiling
  ∧ op.requiredPermissions ⊆ actor.grant                     (trusted, durable, per-principal)
  ∧ op.requiredPermissions ⊆ ctx.allowances                  (workspace-bound scopes at the tool
                                                              layer — re-checked per call because
                                                              workspace binding can differ from the
                                                              activation's level; level allowances are
                                                              structural constants folded into the
                                                              ceiling at activation)
  ∧ activation.state = active ∧ suspensionReasons = ∅        (selected row per §4.1)
  ∧ clamp provenance intact (grant not revoked/expired; vacuous for `operator`)
  ∧ staticPolicy.permits(actor)                              (app-side actor rules, §1.6.v)
```

All inputs are reads of the **commit-synchronous authority index** (§2.1) or structural
constants/context — never caller-supplied. Decisions are made live and never replayed, so
time-dependent reads read wall clock at decision time only. `ALL_ALLOWED` cannot appear in
any input.

**1.5 Revocation, expiry, suspension reasons — and the write path.** Suspension carries a
**reason set** (`operator-yank`, `grant-revoked`, `grant-expired`, `integrity`,
`safe-mode`); `resumed` clears exactly one named reason — a still-non-empty set leaves the
row suspended (fold rule). **"Expired" names two distinct things:** (a) the suspension
reason `grant-expired`, written by the durable scheduler's clock tick through the same CAS
batch as revocation; (b) the terminal state `expired` of a **session-scoped activation** —
derived, never an event: the fold marks session-bound rows expired on `session.archived`,
and **boot reconciliation expires every session-bound row before mount**; unarchiving a
session never resurrects an activation; re-establishment is a new activation with a fresh
ceiling. Replay is deterministic because both expiry rules are pure functions of the log.

*Write path:* the store provides conditional commit — atomic append+record batches with
per-record `expectedVersion`, conformance-proven. The general recording path (`agent.config`
runs via `ctx.emit`) exposes neither, and retrofitting it is out of scope. **A narrow,
app-owned lifecycleRecorder calls the store's conditional-commit API directly for exactly
six lifecycle-critical families** — activate, re-point, suspend/resume/deactivate,
**uninstall** (requires zero live activations, checked against the index at commit), the
grant revocation/expiry batch, and the enablement/remediation markers — with index
pre-validation, CAS on the touched records, and atomic batches (CUJ 12). All other
capability events keep the existing recording path (§9.2 records the split).
*Recorder discipline:* it constructs full event envelopes itself and carries idempotency
keys on CAS retries (a post-commit crash before recording success must not re-apply facts);
its stream ids are never run-shaped (the store fences run-shaped streams behind the
`runOwnership` credential — routing around it is deliberate); its commit-hook listeners are
pure in-memory updates (a committing listener would be deferred past the current commit's
synchronous window, breaking commit-synchronous ordering — the memory store's lock is a
promise queue, not a held mutex).
*Deployment invariant (enforced):* commit-synchronicity holds for the committing process.
**The capability runtime requires a single committing process: the enablement predicate and
the boot gate check the store kind — the default single-writer pg0 data home (its
one-live-owner rule, `src/cli.ts:67-72`) or the memory store. External PostgreSQL
(`COGNATE_POSTGRES_URL`) is an unsupported mode for the capability runtime in v1: enable is
refused and boot records the unsupported posture — fail-closed, never a silent revocation
gap.** The grant-expiry scheduler tick is owned in the Detailed Plan (T1, `automation.ts`).

**1.6 Defect remediation (prerequisite tranche P).** Before the extensible runtime is
enabled — gated by the durable enablement predicate (§1.7) — six remediations land and are
proven by CUJ 4's refusal matrix: (i) the **runtime authority clamp** — contract authority
demoted to a declarative hint; effective scopes = declared ∩ actor's grant ∩ operator
permissions at use time; `ALL_ALLOWED` retired for agent-initiated flows; the clamp covers
the **full tool catalog** (today edit/bash only; `run_code`'s `sandbox_permissions` maps onto
shell scopes). (ii) **per-agent run principals** at every agent-run start site (per-site
table in P: `server.ts`, `subagentStart.ts`, `experts/bridge.ts`, `taskCheckout.ts`,
`executionWorlds.ts`, `harness.ts`, `remote/mobile.ts`). (iii) **human-gate alignment** —
every governance-gated handler uses the shared operator guard whose **refusal condition** is
`ctx.actor.kind !== "user" || ctx.runId !== undefined` (the expression refuses when true;
today `requireUser` checks kind only, which is what let user-kind-masquerading runs pass);
the ten scattered operator-only checks consolidate onto the shared guard (`browser.ts`,
`containedWorkspace.ts`, `governance.ts`, `settlement.ts`, `taskCheckout.ts`, `terminal.ts`,
`workspaceFiles.ts`, `ambiguousStep.ts`, `expertEffect.ts`, `workbench.ts`) — one predicate,
one definition site, with the §1.6.v policy branch as the single agent-run access point.
(iv) **`session.harness.bind` gains the operator-only convention** with a recorded refusal.
(v) **the static policy's agent branch** — `buildPolicy` (app code) gains an
agent-principal branch: loop-invoked built-ins (`model.generate`, the dispatcher id,
`filesystem.*`, `risk.assess`, `subagent.start`, `case.observe`, `session.history`,
`tool.*`) are allowed for agent principals **intersected with the principal's grant where
one exists** (the branch reads the in-memory grant map); governance/operator-only ids stay
refused. (vi) **the decision-record substrate lands in P** — `authority.decision.recorded`
and `workbench.capability_runtime.*` join `WORKBENCH_EVENTS`/the recording allowlist and the
folds, and every enforcement point named in §2.3 emits them — so the P gate's evidence is
self-contained. Timing per OQ-B.

**1.7 The enablement gate.** The operator-only `capability.runtime.enable` command writes
`workbench.capability_runtime.enabled` via the lifecycleRecorder and **refuses unless**:
(a) the `workbench.capability_runtime.remediation_verified` marker is present in the fold
(written by the P verification journey's evidence run on pass — family and writer owned in
the Detailed Plan, item 10) and (b) the store is a supported single-committing-process
backend (§1.5). Boot reads both markers fold-first; absent or failing = bundles never mount;
fail-closed.

### 2. The enforcement topology

**2.1 One decision function, its read path, and its enforcement points.**
`decideCapabilityInvocation` (§1.4) is implemented once. (The §1.6.i clamp for built-in
tools is the same predicate's built-in shape — declared scopes ∩ grant ∩ operator
permissions — not a second function.) It reads the **commit-synchronous authority index**:
two in-memory maps — grants per principal, activations keyed `capability + level + session`
— plus structural constants, fed synchronously by the store's commit hook (both backends
fire listeners before `commit()` resolves). The same hook maintains a monotonically
increasing **capability-event sequence number** — the live-discovery signal for §5.1. Not in
the index, deliberately: bundles, hashes, faults, the spawn ledger (a boot-time store
query), integrity state (verified outside the index, §4.4). The index is in-memory only,
rebuilt from the log at boot, replay-equality tested; projections fold asynchronously for UI
only; enforcement never reads folds. On any inability to serve, the index fails closed.

Enforcement points:

*   **A. The harness tool loop — the single decision site for model-facing calls.** Every
    model tool call — the full catalog, including `run_code` — is decided here before
    `ctx.invoke`, replacing caller-declared scopes (§1.6.i); every loop refusal and every
    bundle-path allow is emitted as `authority.decision.recorded`.
    *Approval composition (total rule):* an authority **allow** pre-empts only the
    *authority-plane* continuation (the task-contract "requires approval" gate and the
    delegated-operation park). **Mode gates** (plan/read-only `approvalGate`) and **risk
    gates** (Sentinel/RiskPreflight destructive-command mediation) always still park — a
    grant never bypasses mode or risk mediation. An authority **deny** refuses outright.
    For the dispatcher tool ids, the loop routes to the dispatcher's decision and consumes
    its outcome — one owner, no shadow evaluation.
*   **B. The dispatcher — the sole route to bundle functionality, with a runtime-enforced
    trusted/untrusted boundary.** Three kinds of code, strictly separated:

    - **Trusted app-owned adapters** are the only code that runs in-process on a
      capability's behalf: reviewed, shipped application code. The dispatcher constructs and
      `Kernel.mount`s adapter Components (explicit **30 s mount timeout — the dispatcher's
      own choice; the kernel's default is 2 s and is adapter-supplied, not a kernel
      property**; per-capability child scope; per-version handle; failed components terminal
      until reset). Adapter `activate(fiber)` closures register typed interpreters into the
      dispatcher's version-keyed handler table. **Adapter invariants:** every registration
      pairs with a `fiber.effects.register` disposer (a failed activation, hot-reload
      teardown, or dependency loss must leave the table empty — test-asserted); adapters
      honor `fiber.signal`; declare no `requires` (dependency withdrawal would churn
      deactivate/reactivate cycles); do no slow work inside the closure (hash verification
      happens at registration, not inside it).
    - **Bundle-authored executable code never runs in the application process.** Adapter
      interpreters consume bundle **data** from two closed, app-owned vocabularies
      (§2.5's three data-operations; §7.1's panel-descriptor schema — both validated at
      registration with ajv). Executable logic must be declared as an **executable
      handler**: a program the governed spawn boundary runs as a contained process (§2.2,
      §6), speaking the framed protocol. There is no third path; the call-site inventory
      plus CUJ 4 prove no route loads bundle code as application code.
    - **Unforgeable invocation identity**: per-call tokens are minted by the trusted
      adapters ({capabilityId, version, callId} — constructed inside app-owned closures),
      carried on the framed protocol, and attributed through the spawn ledger and
      `capability.mcp.*` records. A spawned executable holds no kernel access and no
      application-process authority — its entire surface is its declared resource scopes
      plus the framed protocol, and the framed protocol refuses server-initiated requests
      (sampling/roots are not supported in v1).

    The dispatcher decides per call with the propagated caller's principal; the
    anti-laundering property (no handler re-invokes as the system caller) is runtime-based —
    untrusted code has no in-process foothold — and additionally test-enforced by the
    call-site inventory. Expert `authorityTools` allowlists gate the direct
    `edit`/`bash`/`run_code` tools; they do not gate the dispatcher (recorded audit
    consequence). **Per-call deadline:** the dispatcher enforces a deadline on every handler
    call — default 60 s, capability-declarable up to 300 s; expiry returns the structured
    `deadline_exceeded` envelope and decrements the per-version in-flight counter (the
    drain invariant requires call termination; hung calls cannot pin disposal).
*   **C. The governed execution-world spawn boundary.** All untrusted executable payloads go
    through a governed spawn wrapper on the provider ports (the aggregate-containment wrapper
    is the precedent), enforcing the per-provider containment matrix (§6.2) at spawn,
    writing the spawn ledger (§6.3), and emitting a decision record on refusal.
    Authorization of invocations (A/B) vs containment of processes (C): distinct, both
    named.

**2.2 Untrusted executable bounds (the containment contract).** Filesystem = declared
workspace-scoped paths via the provider port (never host paths; protected paths and the app
home refused — which also shields the bundle store). Network = declared outbound scope,
default deny. Secrets = env-only references resolved from the secret store at spawn,
fail-closed on missing keys, never argv, never logged. Subprocess = denied unless declared
and the provider matrix admits it. What the boundary cannot bound — the executable's
in-process behavior — is the observation line: the runtime records what it observes (tool
invocations through the MCP client with their decisions) and says nothing about unobserved
internal activity.

**2.3 The invocation-path trace and the non-bypassability proof.**

| # | Path | Today | Enforcement | Refusal recorded at |
| --- | --- | --- | --- | --- |
| 1 | Model tool calls — full catalog incl. `run_code` | caller-declared scopes, edit/bash only (defect) | **A** — clamp + decision; `sandbox_permissions` → shell scopes; `run_code`'s inner `Bun.spawn` inside the execution world is observation territory | loop emission |
| 2 | Model calls of bundle tools + MCP tool executions | — | **A → dispatcher decides once**, routes via its handler table | dispatcher emission |
| 3 | Direct `ctx.invoke` of built-ins from agent-principal runs | shared `system` caller (defect) | **§1.6.v** app-side agent branch (grant-intersected allowlist) | policy-refusal hook → `authority.decision.recorded` |
| 4 | Direct `ctx.invoke` of bundle capability ids | denied (not allowlisted) | **stays denied** — handlers never kernel-resolved | policy-refusal hook |
| 5 | Bundle-authored code in-process | — | **structurally impossible** (two-tier boundary) | attempted-load refusal at registration/dispatch |
| 6 | Expert tool calls (`EXPERT_TOOLS`) | assignment validation + commitments | **A**; dispatcher callable; bundle tools stay out of `authorityTools` | loop emission |
| 7 | Capability-internal provider-port operations | containment + grant plane | **C** + existing containment | spawn-boundary emission |
| 8 | Subagent children | `system` caller, `ALL_ALLOWED` base (defect) | §1.1 narrowing from the parent's ceiling | narrowing check's record |
| 9 | External harness CLI sessions (`session.harness.bind`) | no actor check (defect) | operator-only convention | recorded refusal |
| 10 | Operator-initiated spawns (terminal pty, browser CLI launch, desktop window, WSL probe) | operator surfaces | exclusion rows — operator acts, recorded; not agent-reachable | n/a (exclusion) |

The proof is a test, not an argument: each row's forged-authority attempt is refused and
recorded at the named site; the inventory of `ctx.invoke`, provider-port, and
`Bun.spawn`/`child_process` call sites is grep-pinned (`test/workbench-call-sites.test.ts`)
so a new untraced call site fails review. The inventory is a regression tripwire **on top
of** the structural boundary — the boundary is the dispatcher-sole-route + containment
design, not the test.

**2.4 Resolved architectural decisions.**

*   **Tool-catalog insertion:** pre-declared dispatcher tool ids, standing members of every
    catalog. The one-time code adds the ids to **four** static gates — `TOOL_DEFS`,
    `PRESET_TOOLS`, the expert-eligible catalog (`EXPERT_TOOL_DEFS`), and the policy
    allowlist `GRANTED_CAPABILITIES` — plus one loop branch that injects the decision and
    consumes its outcome (routing itself rides the loop's generic `tool.<name>` fallthrough).
    Between P (loop branch + ids) and T2 (dispatcher mount), a dispatcher-id call resolves
    to the kernel's structured "no eligible provider" refusal — fail-closed, recorded.
    Native per-bundle tools: post-v1 upstream proposal.
*   **Enforcement placement:** dispatcher-owned decision at the sole bundle route; the static
    kernel allowlist (with the §1.6.v branch) is the bypass backstop; **no kernel API change
    in v1**.
*   **Session-scoped expiry:** durable session binding; archive-expiry and boot-expiry are
    terminal (§1.5).
*   **Governance-mode interplay:** when the SEA-Forge external authority is enabled (the
    runtime governance mode configured via `COGNATE_SEA_FORGE_OPERATOR`,
    `src/capabilities/governance.ts`), bundle invocations are **refused** in v1 (the
    external authority knows nothing of activations); mirroring is post-v1.

**2.5 The generic dynamic-tool invocation contract.** The standing dispatcher tool ids
suffice for new tools in v1 — no per-tool application code:

*   **Dispatcher data-operations (closed vocabulary, registration-validated):** `tools.list`
    · `tool.invoke` · `skill.load`. Nothing else is interpreted; adding an operation is an
    app release.
*   **Discovery:** `tool.capability.invoke {capabilityId, op: "tools.list"}` returns the
    committed version's tool definitions (namespaced ids, descriptions, JSON-Schema input
    specs) from the manifest and, for MCP servers, the live `tools/list` response.
    MCP-supplied names/schemas are untrusted data, recorded as such and validated before
    any use (§11).
*   **Identification:** `mcp.<serverId>.<toolName>` for MCP tools;
    `<capabilityId>.<operation>` for executable handlers and data operations — unique per
    committed version.
*   **Invocation:** `tool.capability.invoke {capabilityId, tool, arguments}`. The dispatcher
    resolves the committed version (§4.2.5 snapshot rule), validates `arguments` against
    the tool's declared schema (**ajv**, compiled at registration; invalid schema fails
    registration; validation failure → structured refusal carrying the schema error),
    decides authority (§1.4), enforces the per-call deadline, then routes: MCP tools via the
    MCP client's `tools/call`; executable handlers via the framed protocol; data operations
    via the interpreter.
*   **Error envelope (everywhere):** `{code, message, retryable, decidingPoint}` — refusals
    (authority, schema, deadline, availability, containment) are distinguishable by the
    model and assertable by journeys.
*   **Next model turn after a hot-load:** newly activated capabilities become discoverable at
    the next eligible model-turn boundary of an already-running session (§5.1's live
    mechanism); no catalog, preset, or application change occurs.

### 3. Harness modification contract

**3.1 Surfaces: two in v1, two designed follow-ons.** Agent presets are a closed code union
today (`PRESET_TOOLS`, `src/agents/agentCoding.ts:37-41`; `settings.changePreset` selects
among three literals), and no instruction assembly exists for non-expert runs (expert
instructions are one template string per assignment, `src/experts/service.ts:192`) — the v1
surfaces are net-new engineering over new seams:

*   **Agent instructions (v1)** — named instruction sections introduced by the run-start
    resolver; a patch declares `{section, operation: append|replace, payload}`.
*   **Toolset override (v1)** — a per-existing-preset override record (validated with the
    settings writers' posture, consumed through the existing `toolsForPreset` seam,
    `src/agents/agentCoding.ts:47-51`).
*   **Model routing (follow-on, designed)** — per-expert routes exist
    (`src/experts/service.ts:131-137`); the surface contract is "route constraints within
    operator spending ceilings" (`parseSpendingCeilings`). Follow-on work: constraint record
    family, resolver leg, journey. Post-v1 — the v1 surface list is not the final scope of
    harness customization.
*   **Workflow composition (follow-on, designed)** — `workflow.define`/`workflow.instantiate`
    machinery exists (`src/capabilities/workbench.ts:413-441`). Follow-on work: the
    capability-owned workflow registration path and journey.

Modifying surfaces is authority-gated (a grant covering `harness.modify` at the surface's
level); admission, approvals, grants, identity, containment posture, the five core entries,
and governance surfaces are not surfaces.

**3.2 Visibility: run-start resolution + live capability discovery.** All run sources
resolve **configuration** (instructions, toolset) at run start from durable activation
state; nothing mutates a running run's configuration mid-flight. The resolver's result is
recorded per run in `capability.harness.assembled` — **by reference, not by value**: section
hashes plus deltas against the base preset; full text is recorded once per re-assembly of a
changed section (bounds per-run log cost). **Capability discovery is the one live-updated
context section**: the harness loop checks the index's capability-event sequence number at
each model-turn boundary (the existing steering/inbox push points,
`src/agents/agentCoding.ts:537-579`); on change, it re-reads the descriptor section from the
in-memory index and pushes a descriptor-update message — so a capability activated mid-run
is discoverable at the next eligible model-turn boundary without restart, with no per-turn
work when nothing changed. This is the explicit exception to the run-start snapshot rule,
and it carries no authority: descriptors are data; tool *availability* is unchanged
(dispatcher ids are standing catalog members); invocation still requires the §1.4 decision.
Failure semantics: index unavailable at run start → the run refuses to start (fail-closed,
recorded); an activation suspended between assembly and a later call → the assembled
snapshot stands for configuration, while invocation-time decisions govern that capability's
calls (they refuse).

**3.3 Overlap: one regime per surface.** Instruction-section patches **compose** in
deterministic precedence — operator configuration, then persistent activations in activation
order, then session-scoped activations in activation order; `append` appends, `replace`
supersedes earlier patches for that section (last-applied wins). Toolset overrides are
**exclusive-ownership** per preset: two capabilities overriding the same preset refuse
co-activation via `detectConflicts` (`src/workbench/skillOs.ts:395`). Conflict detection
runs at **both** commit points that can create co-activity: the activation commit and the
repoint commit (a new version's `owns` data is version-scoped — the repoint re-runs the
check against live bindings). The composed harness state is derived (never stored as a
blob), so deactivating the offending capability restores the prior configuration by replay.

### 4. Runtime sequence, atomic reload, and reconciliation

**4.1 Normative records, the join, and row selection — total rules.**

*   **Ladder row** (skill-OS, unchanged): key `capability + implementation`; human gates at
    REVIEWED/INSTALLED/AUTHORITY_GRANTED.
*   **Activation row** (new): key `capability + level (+ session binding)`; fields: **version
    (a field, re-pointed)**, ceiling, clamp provenance (grant id | `operator`),
    suspension-reason set, state (`dormant → active ⇄ suspended → retired`, terminal
    `expired` for session-bound rows per §1.5).

**Join (total):** published-path activation requires ladder ≥ AUTHORITY_GRANTED on the
capability's **primary implementation** — the implementation bound by the current
`skill.bind` active binding; no active binding → published activation refuses (the delegated
path does not consult the ladder). **Invocation row selection (total):** an invocation bound
to session S consults the session-scoped row for (capability, level, S) if one exists, else
the persistent row for (capability, level); the two rows are independent activations with
independent ceilings and independent suspension — suspending one never suspends the other;
exactly one row governs any given invocation. **Invocation eligibility = selected row state
`active` ∧ reasons ∅ ∧ §1.4's permission legs.** Conflict detection runs at the activation
commit and the repoint commit (§3.3).

**4.2 The runtime sequence with commit points.** Every arrow is a durable event;
lifecycle-critical commits go through the lifecycleRecorder (CAS + atomic batches; a
concurrent change fails the batch, which retries against the re-read index); the fold
refuses state-inconsistent transitions (unmatched-row precedent).

1. **Create/author** — bundle written to the authoring source; provenance recorded at
   registration (no separate event).
2. **Validate** — manifest schema (ajv), requirement satisfiability, content hashes,
   **payload ceilings** (pinned: ≤ 512 KiB per file, ≤ 5 MiB per bundle, ≤ 200 files —
   matched to the `workspaceFiles` guard scale, bounding materialization well under the
   mount budget; over-ceiling refuses registration, asserted in j_cap_create).
3. **Register** — the payload **materializes into an immutable version directory**
   (`<bundleStore>/<capabilityId>/<versionHash>/` under the app data home — the app home is
   refused to contained executables, so the store is unreachable from payloads); **pruning
   fires here**: retention = active + 3 versions, oldest pruned beyond retention, recorded
   as `workbench.bundles.pruned`. Nothing runs.
4. **Activate** — ceiling computed; adapter component constructed and mounted (30 s explicit
   timeout, dispose-on-failure, per-capability child scope, per-version handle); the
   activate closure registers the interpreter; **activation commits only after ACTIVE + CAS
   pre-state validation**. (Tranche note: this step lands with the dispatcher in T2 — §9.5.)
5. **Invoke** — decided per call against the index; the invocation takes its version+ceiling
   snapshot and increments the per-version in-flight counter in one synchronous critical
   section before the first await.
6. **Replace (hot reload)** — new version registered (new immutable directory); new handle
   mounted and verified ACTIVE; CAS revalidation including the §3.3 conflict re-check;
   **`capability.activation.repointed {from, to}` commits** — mutating the version field
   only. In-flight invocations keep their snapshots; the old handle is disposed strictly
   after its in-flight counter reaches zero (the kernel's teardown aborts in-flight calls;
   there is no kernel drain primitive — the app-side counter is net-new) or as calls hit
   the §2.1B per-call deadline, whichever drains first.
7. **Suspend/Yank** — **the suspension event's commit is the refusal point**; the index
   updates synchronously on commit. Process stop initiates synchronously with the commit
   (§6.1); the reason is recorded.
8. **Restart** — fold everything, expire session-bound rows (§1.5), then mount the active
   set (fold-first/mount-second). Kernel mounts are in-memory — a crash leaves no orphan
   mounts; the crash orphans are **durable-effect orphans**: spawn-ledger entries without
   terminal records (the boot sweep, §6.3) and partial version-directory materializations
   (deleted; re-materialized only by a fresh registration — registration is the sole
   writer; the source-reading rule below governs what a fresh registration may read).

**4.3 Failure semantics.** Every failure mode maps to exactly one event family:
`capability.activation_failed` (mount/activation failures), `capability.repoint_failed`
(failed replacements — CUJ 13's family), `capability.validation_failed`,
`capability.integrity_failed` — with reason codes. A failed replacement never re-points: the
last known-good version remains executable — its immutable directory untouched, hash-valid,
and still named by the activation row. **Any abort after mount and before commit disposes
the mounted handle.** **Reverse orphan:** a handler fiber failing mid-session leaves
committed state active but unmounted — the dispatcher's mount table reconciles against the
index on every activation-family commit (fed by the kernel-observation bridge, §8), and
refusals distinguish `suspended` from `unmounted`.

**4.4 Identity, version, integrity, source rules, retention.** Identity is
namespace-partitioned (built-in ids reserved; bundle ids namespaced; ownership enforced at
`skill.register`). Version = manifest version + payload content hash; bytes live in the
immutable version directory. **Source rule (stated once, governing §4.2.3, §4.2.8, and the
re-hash):** the recorded version's materialization source is **never** consulted for loading
or integrity — loading verifies the directory against its recorded hash; mismatch
(out-of-band tampering with the store) = fail-closed load + `capability.integrity_failed` +
reason-`integrity` suspension; the **only** path that reads an authoring/source location is
a fresh governed registration (the re-hash), which re-validates everything and materializes
a new version directory. Retention: active + 3 versions, pruned at registration (§4.2.3),
never touching the active version. Context-level change = new activation (never in-place).

### 5. Skill loader, discovery, and composition

**5.1 Discovery contract.** Each capability contributes a bounded **descriptor**: id,
version, one-line purpose, per-skill entry lines (name + when-to-use trigger), tool ids,
composition-guide entry-document flag. **Pinned budgets:** per-capability descriptor ≤ 400
tokens (name + version + purpose + 8 skill lines + 8 tool lines — the Hallmark + Impeccable
bundle fits with headroom); aggregate descriptor section ≤ 4,000 tokens (≈2% of a 200k-token
context). Over-budget descriptors truncate at registration — visibly, recorded — never
silently at load. Descriptors are assembled at run start (§3.2) and refreshed at
model-turn boundaries when the index's capability-event sequence changes — one in-memory
counter read per model step, a section re-read from the index only on change, delivery
through the existing steering push points. The relevance decision is the model's; content
loads only on `tool.skill.load`.

**5.2 Loading and invocation.** `tool.skill.load {capabilityId, skillId}` is a pre-declared
dispatcher tool: it decides authority, verifies the version-directory hash, and returns the
document. Composition guides are entry documents; their discovery line instructs the model
to load the guide before first use. Loads record through the loop's existing `tool.call.*`
records; the assembled snapshot (`capability.harness.assembled`) carries the descriptor
section hash at run start, and mid-run refresh is observable in the pushed
descriptor-update record — the durable evidence for CUJs 1 and 11.

**5.3 Composition is content, not machinery.** The guide is markdown the bundle authors; its
structured counterpart is contract data (`conflicts`/`complements`/`owns`), enforced by
`detectConflicts`. For the anchor journey the guide defines: Hallmark (an external file-based
design skill whose self-described "anti-slop" rules govern aesthetic judgment and the
audit/redesign verbs) supplies structural variety and anti-pattern rules; Impeccable
(external, a gated frontend-craft workflow) supplies the context gate, shape brief, and
preflight; the handoff feeds Hallmark's rules into Impeccable's shape brief; conflicts
resolve by domain — process gates defer to Impeccable's preflight, aesthetic judgment to
Hallmark's rules. CUJ 1 asserts the guide is loaded and *followed* (skill-load sequence +
assembled/refresh records), not merely present.

### 6. Untrusted executables: containment, providers, recovery

**6.1 Supervisor semantics.** The governed spawn wrapper owns the process group where the
provider supports it (local group-kill discipline; the host-process path — the exec port
kills only the direct child). **Stop discipline (measurable):** process stop is initiated
synchronously with the suspension commit; the termination outcome is recorded per provider
honesty below. Resume re-spawns from the durable declaration with secrets re-resolved
(fail-closed on missing keys). Restart re-resolves the world before remounting.

**6.2 The per-provider containment matrix (refusal is the default).**

| Restriction | local (contained) | local (uncontained) | SSH | WSL |
| --- | --- | --- | --- | --- |
| Filesystem bounds | yes — contained ports, path canonicity, `PathEscapeError` (TOCTOU caveat recorded by the provider) | port-level only | yes via ports | yes via ports |
| CPU/memory caps | yes — `prlimit --as/--cpu`, fail-closed when tooling absent; probe re-run on provider re-register (the per-world cache must not outlive a swap) | no → refuse caps-requiring payloads | no → refuse | no → refuse |
| Network | **total denial enforced** (`--unshare-all` unshares the network namespace) — any declared outbound scope refuses in this posture | no network control → posture-gated, default refuse | same | same |
| Process-group termination | yes — live-set SIGKILL | yes **on the host-process path the wrapper owns** (`kill(-pgid)`) | **no** — TERM-to-supervisor then channel close; "may ignore signals"; recorded best-effort | partial — second-session TERM→KILL, session close last resort; recorded best-effort |
| Child-process denial | not enforceable (nested fork/exec possible; nested user-ns blocked) → declared + posture | not enforceable | not enforceable | not enforceable |

**Execution posture (defined).** The execution posture is the per-world containment
configuration that already exists (`src/server.ts` posture wiring plus
`src/capabilities/containedWorkspace.ts`), extended with a **capability record naming, per
restriction, the enforcement level from this matrix's vocabulary** (enforced / partial /
not-enforced). A payload's declared restriction is satisfiable only if the world's posture
record claims enforcement at least as strong as required **and** the matrix supports that
claim. Posture edits are operator-only with recorded events; "explicitly and accurately"
means the record names the weaker posture honestly (e.g., "termination: best-effort channel
close on this world") — an inaccurate record is a recorded core violation surfacing in safe
mode. Long-lived spawned processes do not hold exec-shaped slots: a dedicated long-lease
slot class with a per-world cap (folded into the same `containment:aggregate:v1` accounting
thread); caps enforcement comes from the matrix row, not the exec-lease timeout.

**6.3 The spawn-ledger protocol (record-before-spawn).** The wrapper writes the **intent
record** (`capability.mcp.spawn.intended` — carrying spawn parameters **with secret
references only, never resolved values**) *before* spawning; on success a **confirmed
record** (`spawned`, pid where exposed); on exit the **terminal record** (`exited`, observed
outcome); unrecoverable reconciliation writes `reconciled-unknown`. The boot sweep:
`confirmed` without terminal → kill by recorded pid, or best-effort signature kill scoped to
the version-directory path (never a bare cmdline match), then record; `intended` without
confirm → best-effort signature kill where allowed, record `reconciled-unknown`. Every
outcome is durable; the guarantee is "every intent reconciles to a recorded outcome."

### 7. Presentation and recovery

**7.1 The v1 boundary and the future path.** Presentation extensions are declarative
fragments `{slotId, schemaVersion, payload}` consumed by named renderer slots. **The slot
registry and its error boundaries are net-new UI engineering** (precedents: the
`InspectorTab` declarative registration pattern, `src/ui/App.tsx:6194`; the honesty
machinery; React error boundaries do not exist in this codebase today and are introduced
explicitly by this plan — the render-failure detector depends on them). V1 ships **one**
net-new slot kind — panel descriptors — with a **closed payload schema** (validated at
registration with ajv; unknown slot ids or schema versions fail closed, recorded):
`{title ≤ 80 chars, summary ≤ 200 chars, capabilityId, viewRef}` where the referenced view
descriptor is one of the enumerated v1 kinds (`list` of label/value rows; `record` of typed
fields) — content is data references into the version directory, never directives. Richer
payload-bearing slot kinds later are additive schema evolution, not a redesign. Governance
surfaces are not slots (D6). Safe mode is **one module** (`src/workbench/safeMode.ts`)
exposing the boot exclusion read, boot-attempt counters, and sweep integration; the
manual-clear handler mounts from the capability component that needs it (no second
same-named file).

**7.2 Safe mode.** (a) render failure — the slot's error boundary marks the fragment faulty
(durable fault event), renders the core fallback, never the broken component; (b) mount
failure — hot-swap rollback disposes and records; (c) boot readiness failure with extensions
enabled — the desktop shell's startup budget and `/health` watchdog (the B5 lifecycle
hardening, `src-tauri/src/backend.rs`) fire safe mode: non-core fragments and bundle
handlers excluded at boot (the exclusion read precedes any render or mount), core shell
renders, banner, one-at-a-time re-enable; (d) governance-surface override attempt — refused
at the slot-registry registration boundary (the only place a fragment could claim a
governance surface), recorded as a core violation, escalating to safe mode. Two failed boots
with the same set keep extensions suspended until the operator-only manual clear (its own
event). Recovery never depends on rendering the broken component.

### 8. Durable state and event semantics — the normative matrix

**Transition × event × fold (normative):** every §4 arrow, §4.3 failure, §1.5 expiry cause,
and index invalidation input maps to exactly one row; the totality proof is replay-equality
(rebuild every projection and the index from genesis, diff against live).

| Transition / cause | Event (writer) | Fold / index effect |
| --- | --- | --- |
| Validate ok | `capability.bundle.validated` (recording path) | none |
| Register + materialize + prune | `capability.bundle.registered`; `workbench.bundles.pruned` (recording path) | bundle row; version known |
| Activate | `capability.activated` (lifecycleRecorder) | activation row → index |
| Invocation decision (bundle path; refusals everywhere) | `authority.decision.recorded` (loop / dispatcher / spawn boundary / policy hook / narrowing check / harness.bind) | none (audit) |
| Replace ok | `capability.activation.repointed` (lifecycleRecorder) | version re-pointed; old binding tombstoned (fold: `capability.binding.retired`); conflict re-check |
| Replace/mount failed | `capability.repoint_failed` / `capability.activation_failed` (lifecycleRecorder) | none (attempt history) |
| Validation failure | `capability.validation_failed` (recording path) | none |
| Integrity failure | `capability.integrity_failed` (lifecycleRecorder) | reason `integrity` suspension → index |
| Suspend / yank | `capability.suspended {reason}` (lifecycleRecorder) | reason set → index |
| Resume | `capability.resumed {clearedReason}` (lifecycleRecorder) | reason cleared → index |
| Deactivate | `capability.deactivated` (lifecycleRecorder) | row → `dormant` → index |
| Uninstall | `capability.uninstalled` (lifecycleRecorder; requires zero live activations) | row → `retired`; handler disposed |
| Grant issued / revoked / expired | `authority.grant.issued / .revoked / .expired` (grant capability; expiry via scheduler tick; revocation batch CAS-atomic with its suspensions) | grant map → index; clamp suspensions → index |
| Session binding | `session.activation` (recording path) | activation row session field → index |
| Session archived | `session.archived` (existing family — cross-family fold input) | session-bound rows → terminal `expired` (derived) |
| Harness patched / assembled | `capability.harness.patched` / `capability.harness.assembled` (recording path) | none (evidence) |
| Presentation fault | `capability.presentation.faulted` (recording path) | fault row (safe mode) |
| MCP spawn intent / confirmed / exited / tool invoked | `capability.mcp.spawn.intended / .spawned / .exited / .tool_invoked` (spawn wrapper + MCP client) | spawn ledger (boot-sweep query) |
| Safe mode boot / manual clear | `workbench.safemode.boot_attempted / .cleared` (safe-mode module / operator capability) | `safe-mode` reasons lifted on cleared → index |
| Runtime enable / remediation verified | `workbench.capability_runtime.enabled / .remediation_verified` (lifecycleRecorder / P evidence run) | enablement-predicate inputs |
| Kernel observations | `workbench.kernel.observed.{provided,withdrawn,fiber_state}` (bridge recorder, `capabilityRuntime.ts`) | mount-table reconciliation; **never joined to activation rows** |

Naming: the harness families are `capability.harness.*` — this list is normative; body
sections and implementation items use these strings. `invoked` is deliberately absent from
the kernel bridge: bundle handlers are never lease-invoked (§2.1B). Event volume is bounded:
decision records carry operation id + outcome (not full arguments);
`capability.harness.assembled` carries hashes + deltas, full text once per changed section.

### 9. SEA migration steps (model-first, coordinated)

1. **Model change (M tranche; one coordinated change set; `domainforge validate` and
   `domainforge fmt --check .sea/interaction/interaction-model.sea` before any code):**
   retire the Plugin entity and re-scope the trust clause; extend the skill-OS entities with
   version; add Capability/Bundle/grant/activation entities and anchors; extend
   `J-WB-capability-lifecycle`; supersede `J-PLG-install` with **ten canonical journeys
   carrying the thirteen CUJs as variants** (j_cap_create; j_cap_reload [+ j_cap_rollback
   variant]; j_cap_mcp; j_cap_refusal [+ enablement-gate-refusal variant]; j_cap_suspend
   [+ j_cap_revoke variant]; j_cap_safemode [+ j_cap_present variant]; j_cap_restart;
   j_cap_source; j_cap_persist; j_cap_harness); **re-author the in-code trust twin in the
   same change** (`src/components/pluginRegistry.ts`, `src/plugins.ts`,
   `src/capabilities/pluginInstall.ts`, `src/projections/plugins.ts`); add `domain/index.ts`
   anchor bindings; regenerate the doctor's model-hash manifest evidence (`src/cli.ts:309-316`).
2. **In-code recording-gate inventory:** `WORKBENCH_EVENTS` (`src/workbench/types.ts`), the
   `workbench.recorded` allowlist (`src/agents/agentConfig.ts`, built from
   `WORKBENCH_EVENTS`), `SESSION_EVENTS`, the reducer, a projection per family. The six
   lifecycleRecorder families are the deliberate, documented exception (§1.5). **P lands its
   substrate subset first** (decision-record + runtime-marker families join the gates in P,
   so the P gate's evidence is self-contained); M completes the set.
3. **Replay mappings (defined, not discovered):** `plugin.installed` → dormant Capability row
   (kind `legacy-plugin`, provenance and enable state carried); `plugin.uninstalled` →
   retired tombstone; the `plugins` projection survives as a compatibility read-model for
   the migration window, retired afterward with recorded rationale; `J-PLG-install`
   superseded by j_cap_create/j_cap_persist variants; `J-PLG-panels`/`J-PLG-toggle`
   re-pointed to the capability-panel suites; `workbench-plugins` retained for the legacy
   fold mapping; skill-OS seeded rows seed unchanged.
4. **Namespace partition** lands with the model change (reserved built-in ids; bundle
   namespace; enforcement at `skill.register`).
5. **Sequencing (corrected dependency order):** E-phase settles (rev 43) → **P** (§1.6
   remediation + decision-record substrate; independently verifiable; CUJ-4-proven) →
   **M** (SEA model change + the four plugin-era files; blocks all capability
   implementation) → **T1** (lifecycleRecorder, authority index, bundle store:
   register/validate/materialize/prune only — **no activation**) → **T2** (dispatcher +
   **activation machine** + skill loader + live descriptor delivery + directory source +
   harness resolver; j_cap_create, j_cap_reload [+rollback], j_cap_source, j_cap_refusal
   [+enablement variant], j_cap_harness) → **T3** (MCP client, spawn boundary; j_cap_mcp,
   j_cap_suspend [+revoke]) → **T4** (presentation slots, safe mode; j_cap_safemode
   [+present], j_cap_restart, j_cap_persist) — `just verify` gates every boundary;
   **activation and its journeys never precede the dispatcher they mount through**.

### 10. Framework gaps, upstream proposals, and dependency decisions

**V1 requires zero kernel and zero SDK API changes.** Everything used exists: `Kernel.mount`
with plain Components and per-component provides; the static policy as backstop; commit
hooks; the store's conditional-commit API; the provider hot-swap discipline; the
aggregate-containment wrapper precedent.

**Dependency decisions (settled — no implementer choice):**

*   **MCP protocol client** — use the **official MCP TypeScript SDK** with a **custom
    Transport adapter** over execution-world provider streams (the SDK's Transport interface
    supports exactly this); hand-roll only the small framed protocol for non-MCP executable
    handlers ({token, tool, arguments} → result or error). Rationale: the SDK implements the
    handshake/versioning/tool-registry semantics the design would otherwise re-derive; the
    adapter is the only integration point; the invocation-record emission wraps the client.
    If the SDK demonstrably cannot run over provider-port streams, that finding re-opens
    this decision with the constraint recorded — never silently.
*   **JSON-Schema validation** — **ajv** (draft 2020-12), schemas compiled at registration;
    an invalid tool schema fails registration. An app-side dependency addition (the Cognate
    SDK pins are untouched).
*   **Mount timeout** — 30 s, the dispatcher's explicit choice (the kernel default is 2 s,
    adapter-supplied).

Net-new app-side engineering, honestly named: the run-start resolver + instruction
sections; the toolset-override record; the dispatcher (handler table, in-flight counters,
deadline enforcement); the commit-synchronous authority index (+ the capability-event
sequence number); the lifecycleRecorder; the slot registry and error boundaries; the
spawn-ledger boot sweep; **the MCP client (SDK transport adapter) and framed protocol**;
the grant-management capability family; the version-directory bundle store; the
kernel-observation bridge recorder; the enablement gate; the shared operator guard.

Upstream proposals (post-v1, none blocking): `AuthorizationRequest` context fields; native
tool-catalog dynamism; a kernel drain primitive; a durable kernel event sink; projection
re-read amplification (already recorded, `docs/known-gaps.md:225`).

### 11. Risks & Mitigations

| Risk | Mitigation (and where) |
| --- | --- |
| **Prompt injection via bundle skill content / composition guides** — the core payload is agent-directed prose | Skills and guides are data loaded as content, never instructions that elevate authority; every call a steered model makes still passes the §1.4 decision and the grant plane; a guide cannot widen a ceiling (immutable, §1.3) or a grant (immutable, §1.5). Residual: steered calls within granted authority — the same exposure as any model tool use, bounded by operator-issued grants. |
| **Untrusted MCP tool names/schemas via `tools.list`** | Treated as untrusted data; ajv-validated before use; namespaced ids prevent collisions; invocation still requires authority + deadline + containment (§2.5). |
| **Authority-index memory growth** | Two maps bounded by activation- and grant-gated creation; descriptors bounded by the §5.1 budgets; no event-log payload copies. |
| **Mount storms vs the activation timeout** | Activation is operator/delegation-gated, not model-reachable; the 30 s mount timeout bounds worst-case activation latency and rolls back to the last known-good state (§4.3). |
| **Multi-process revocation gap** | Single-committing-process invariant enforced at enable and boot; unsupported modes fail closed (§1.5). |
| **Secret leakage via logs or spawn records** | Secrets env-only, never argv; spawn-intent records carry references only; decision records truncate arguments; existing secret-store redaction rules stand (§6.3, §8). |
| **Unbounded subprocess activity** | §6.2 matrix refuses what providers cannot enforce; posture records must be accurate (inaccuracy = core violation); observation honesty names what is not bounded (§2.2). |
| **Broken extensions wedging the app** | Safe mode: exclusion read precedes render/mount; two-strike boot escalation; operator-only manual clear (§7.2). |

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: Dynamic kernel policy branch

*   **Pros**: single chokepoint at the kernel; enforcement even for direct kernel invokes.
*   **Cons**: `AuthorizationRequest` cannot carry the invoking agent's identity or context; a
    durable read per call on the hot path; the kernel registry's insertion-order resolution
    breaks handler selection regardless of policy.
*   **Reason for Rejection**: the dispatcher-sole-route design achieves the same refusal
    guarantee with the unchanged static policy as backstop, no hot-path read, no resolution
    race. The `AuthorizationRequest` extension remains a post-v1 upstream proposal.

### Alternative B: Stored effective-authority records

*   **Pros**: cheaper per-call decisions; simpler audits.
*   **Cons**: a fourth authority plane that drifts — what D2 forbids; revocation becomes
    cache coherence.
*   **Reason for Rejection**: effective authority is derived at decision time; the activation
    ceiling is the activation's own immutable bound (§1.3's reconciliation), not a stored
    intersection of live authority.

### Alternative C: In-process bundle handlers with test-enforced discipline

*   **Pros**: lowest latency; simplest authoring.
*   **Cons**: untrusted code in-process cannot be confined by convention; non-bypassability
    would rest on tests substituting for a boundary.
*   **Reason for Rejection**: the owner required a runtime-enforced boundary; the two-tier
    model makes it structural (tests remain as the regression tripwire, §2.3).

### Alternative D: Compensation logic around the existing recording path

*   **Pros**: no new write adapter.
*   **Cons**: `ctx.emit` has no `expectedVersion` and no cross-record atomicity;
    activate/repoint/revoke correctness would rest on ordered-batch reconciliation argument.
*   **Reason for Rejection**: the store's conditional-commit API exists and is
    conformance-proven; the lifecycleRecorder uses it directly. Owner preference, adopted.

### Alternative E: Durable event-log payload copies

*   **Pros**: payload availability independent of the filesystem.
*   **Cons**: a second source of truth; sync protocol; event-log bloat; ill-fitting partition
    ceilings.
*   **Reason for Rejection**: immutable version directories deliver the same availability and
    integrity at the filesystem layer with bounded retention (owner-directed).

### Alternative F: Host `fs.watch` on workspace/bundle directories

*   **Pros**: instant reload on edit.
*   **Cons**: crosses the provider boundary; breaks SSH/WSL silently; watcher storms amplify
    into recording runs.
*   **Reason for Rejection**: ingestion/materialization are provider-backed; modification is
    legitimate only through the governed re-hash; load-time integrity catches tampering.

### Alternative G: Native per-bundle model-facing tools

*   **Pros**: no dispatcher indirection.
*   **Cons**: requires dynamic tool-catalog machinery (an SDK change); unbounded
    model-facing surface.
*   **Reason for Rejection**: §2.5 delivers arbitrary new tools through the static catalog;
    native dynamism is post-v1 upstream.

### Alternative H: Preset registration in v1

*   **Pros**: full harness-definition flexibility.
*   **Cons**: no journey requires it; unexercised namespace/lifecycle/validation machinery.
*   **Reason for Rejection**: toolset overrides deliver CUJ 11; registration is deferred
    until a journey demands a new agent definition.

### Alternative I: Compiling authority grants onto `team.delegate`

*   **Pros**: existing machinery.
*   **Cons**: `team.delegate` inherits `authorityTools` verbatim — work decomposition, not
    authority delegation; no narrowing, no revocation plane.
*   **Reason for Rejection**: grants are net-new durable records; `Scope.child` is the
    narrowing precedent the design uses for lineage.

### Alternative J: Notification channel for activation surfacing

*   **Pros**: push visibility for expert-created capabilities.
*   **Cons**: the owner decided the notification plugin is not shipped (rev 42, OQ1); the
    title-cue grammar would need a two-side protocol bump.
*   **Reason for Rejection**: the governance surface and attention cue are the recorded
    canonical channels.

### Alternative K: Editable level-allowance record family (v1)

*   **Pros**: operator-configurable per-level permission ceilings from day one.
*   **Cons**: no journey configures it; the fail-closed default complicates CUJ 9; index
    invalidation and staleness machinery for an unused surface.
*   **Reason for Rejection**: structural constants cover the two implemented levels (§1.3);
    the durable editable family returns with a reconfiguration journey.

### Alternative L: Run-start-only descriptor assembly

*   **Pros**: deletes the live-delivery mechanism; §3.2 keeps no exception.
*   **Cons**: breaks the defining behavior "newly activated capabilities become available to
    the ongoing agent interaction without restart" — discovery would wait for the next run.
*   **Reason for Rejection**: owner decision (M1b): live discovery at the next eligible
    model-turn boundary is essential; the §3.2/§5.1 sequence-counter mechanism is the
    smallest one that provides it (one in-memory read per model step).

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Sequencing follows §9.5: **P** (remediation + decision-record substrate; independently
verifiable) → **M** (SEA model change + plugin-era files) → **T1** (substrate:
recorder, index, bundle store — register/validate only) → **T2** (dispatcher +
**activation** + loader + sources + harness resolver) → **T3** (executables) → **T4**
(presentation, safe mode, restart/persist journeys) — `just verify` gates every boundary;
**activation and its journeys never land before the dispatcher (T2)**.

### Target Files to Create/Modify

#### Tranche P — §1.6 remediation + decision-record substrate (independently verifiable)

1. `src/agents/agentCoding.ts` (Modify) — the runtime authority clamp across the full tool
   catalog; `sandbox_permissions` → shell scopes; the two dispatcher tool ids into
   `TOOL_DEFS` + `PRESET_TOOLS` + `EXPERT_TOOL_DEFS`; the loop branch injecting the §1.4
   decision and consuming its outcome; **`authority.decision.recorded` emission for every
   loop refusal and bundle-path allow**; the approval composition (allow pre-empts only the
   authority-plane continuation; mode/risk gates park); the **per-model-turn
   capability-event sequence check + descriptor push** (§5.1's live discovery, reading the
   index item 24 builds).
2. `src/workbench/types.ts` (Modify, P subset) — `authority.decision.recorded` and
   `workbench.capability_runtime.*` join `WORKBENCH_EVENTS`; decision-record and
   suspension-reason types. (The full family set lands in M.)
3. `src/agents/agentConfig.ts` (Modify, P subset) — the same families join the
   `workbench.recorded` allowlist so P can record them.
4. `src/workbench/reducer.ts` + `src/projections/workbench.ts` (Modify, P subset) — folds
   for the decision-record family (audit rows only).
5. `src/capabilities/workbench.ts` (Modify) — `requireUser` replaced by the shared operator
   guard with the refusal condition `kind !== "user" || ctx.runId !== undefined`;
   `task.create` authority demoted to a declarative hint.
6. `src/workbench/operatorGuard.ts` (Create) — the shared guard; adopted by the ten
   scattered sites (each of `src/capabilities/{browser,containedWorkspace,governance,
   settlement,taskCheckout,terminal,workspaceFiles,ambiguousStep,expertEffect,workbench}.ts`
   Modified to import it).
7. `src/server.ts` (Modify) — the **per-site principal table** for agent-run starts
   (`server.ts`, `subagentStart.ts`, `experts/bridge.ts`, `taskCheckout.ts`,
   `executionWorlds.ts`, `harness.ts`, `remote/mobile.ts` — each Modified accordingly);
   `buildPolicy` agent branch (grant-intersected allowlist); the **policy-refusal hook**
   emitting `authority.decision.recorded` for trace rows 3/4.
8. `src/capabilities/harness.ts` (Modify) — `session.harness.bind` operator-only convention
   with a recorded refusal.
9. `src/capabilities/subagentStart.ts` (Modify) — child runs under the parent's agent
   principal with narrowed scopes; refusals recorded.
10. `test/J-CAP-prerequisite.test.ts` (Create) — the P refusal matrix (clamp, principals,
    human gates, harness.bind, policy branch) with per-row `authority.decision.recorded`
    assertions; **writes `workbench.capability_runtime.remediation_verified` on pass** (the
    enablement gate's evidence; the family landed via items 2–4).

#### Tranche M — SEA model change + plugin-era files (blocks all capability implementation)

11. `.sea/interaction/interaction-model.sea` (Modify) — retire the Plugin entity; re-scope
    the trust clause; version on skill-OS entities; Capability/Bundle/grant/activation
    entities; ten canonical journeys with variants; `J-WB-capability-lifecycle` extension.
12. `domain/index.ts` (Modify) — anchor bindings for every new capability id.
13. `src/components/pluginRegistry.ts` (Modify) — trust-twin re-authored; the `PluginSource`
    seam re-bound to bundle ingestion (§9.3; the D7 shape commitment preserved under
    capability vocabulary).
14. `src/plugins.ts` (Modify) — catalog honesty text re-authored; `installRefusal` updated.
15. `src/capabilities/pluginInstall.ts` (Modify) — `plugin.install`/`plugin.uninstall`
    handlers retired (superseded paths recorded).
16. `src/projections/plugins.ts` (Modify) — replay mappings per §9.3; compatibility
    read-model for the migration window (post-window retirement recorded).
17. `src/workbench/types.ts` (Modify, remainder) — full `WORKBENCH_EVENTS` extension;
    `ActivationRecord`, `GrantRecord`, descriptor/bundle/harness/posture types.
18. `src/workbench/skillOs.ts` (Modify) — version field; namespace-partition enforcement at
    register; substitution checks against versions.
19. `src/workbench/reducer.ts` + `src/projections/workbench.ts` (Modify, remainder) — folds
    for every family in the §8 matrix; cross-family inputs (`session.archived`,
    `authority.grant.*`); state-inconsistent transition refusal.
20. `src/agents/agentConfig.ts` (Modify, remainder) — remaining families join the input
    union and allowlist.
21. `test/J-PLG-install.test.ts`, `test/J-PLG-panels.test.ts`, `test/J-PLG-toggle.test.ts`,
    `test/workbench-plugins.test.ts` (Modify) — supersede/re-point/retain per §9.3.
22. `test/workbench-skillos.test.ts`, `test/workbench-contract.test.ts` (Modify) — version
    and partition updates; seed-catalog floor refresh.

#### Tranche T1 — substrate (register/validate only; no activation)

23. `src/workbench/lifecycleRecorder.ts` (Create) — the conditional-commit write adapter
    (six CAS families; envelope construction; idempotency keys; index pre-validation).
24. `src/workbench/authorityIndex.ts` (Create) — the commit-synchronous index (two maps +
    structural constants + the capability-event sequence number; commit-hook feed; boot
    rebuild; fail-closed reads).
25. `src/capabilities/authorityGrants.ts` (Create) — `authority.grant.issue / revoke / list`;
    the operator root-grant seed at boot; `capability.runtime.enable` (the §1.7 predicate:
    remediation marker + store-kind check).
26. `src/workbench/automation.ts` (Modify) — the clock-driven grant-expiry tick producing
    the CAS batch (reason `grant-expired`).
27. `src/capabilities/bundleStore.ts` (Create) — version-directory materialization,
    registration-time pruning (retention = active + 3), integrity verification;
    provider-backed ingestion reusing the `workspaceFiles` bounded guards.
28. `src/capabilities/capabilityBundles.ts` (Create) — bundle register/validate only (ajv
    manifest validation; payload ceilings; requirement satisfiability). Activate/
    deactivate/uninstall land in T2 with the dispatcher.
29. `test/wb-helpers.ts` (Modify) — boot with the runtime enabled, operator/grant seeding,
    dispatcher mounting helpers (used by every later J-CAP suite).
30. `test/workbench-authority-index.test.ts` (Create) — replay-equality (projections + index
    from genesis), index transparency (append each family, assert decision equality), CAS
    concurrency (activate vs suspend, repoint vs revoke, revoke vs resume), adapter-cleanup
    assertion (a failed activation mid-registration leaves the table empty).

#### Tranche T2 — dispatcher, activation, loader, sources, harness resolver

31. `src/capabilities/capabilityRuntime.ts` (Create) — the dispatcher: adapter-component
    construction and `Kernel.mount` (30 s explicit timeout; per-capability child scopes;
    per-version handles; reset discipline; the `fiber.effects.register` disposer
    convention); version-keyed handler table; per-version in-flight counters; per-call
    deadlines (60 s default / 300 s max, `deadline_exceeded` envelope); drain-then-dispose;
    reverse-orphan reconciliation; the **kernel-observation bridge recorder**
    (`workbench.kernel.observed.*`); `tool.capability.invoke` + `tool.skill.load` per §2.5.
32. `src/server.ts` (Modify) — `GRANTED_CAPABILITIES` gains the dispatcher id (§2.4's fourth
    gate lands here, when the dispatcher mounts).
33. `src/capabilities/capabilityBundles.ts` (Modify) — activate/deactivate/uninstall
    (uninstall requires zero live activations; the repoint conflict re-check) via the
    lifecycleRecorder.
34. `src/agents/runStartResolver.ts` (Create) — named instruction sections; toolset-override
    application; descriptor assembly at run start; **live descriptor refresh reading the
    index sequence** (the item 1 loop hook calls into this module);
    `capability.harness.assembled` by hash + delta.
35. `src/workbench/harnessPatches.ts` (Create) — instruction-patch/toolset-override record
    types, validation, the per-surface overlap regime (§3.3), `capability.harness.patched`.
36. `src/capabilities/skillLoader.ts` (Create) — descriptor registry; `tool.skill.load`
    serving from version directories with hash verification; entry-document flags.
37. `src/workbench/bundleSources.ts` (Create) — the directory source over provider-backed
    semantics (SSH/WSL identical), feeding bundle ingestion through the §9.3-bound
    `PluginSource` contract; the `BuiltinPluginSource` compatibility bridge.
38. `test/J-CAP-create.test.ts` (Create) — j_cap_create (CUJ 1; preset-scoped session;
    over-ceiling and over-budget refusals; the **catalog-size scaling variant**: a
    50-capability synthetic catalog asserting aggregate descriptor-budget behavior;
    mid-run live discovery at the next model-turn boundary).
39. `test/J-CAP-reload.test.ts` (Create) — j_cap_reload + the j_cap_rollback variant
    (CUJs 2, 13: the `repointed`-precedes-old-completion assertion;
    `capability.repoint_failed` on the failure variant; v1 payload availability).
40. `test/J-CAP-source.test.ts` (Create) — j_cap_source (CUJ 8, SSH/WSL parameterized).
41. `test/J-CAP-refusal.test.ts` (Create) — j_cap_refusal + the enablement-gate variant
    (CUJ 4's full bundle-path matrix; the marker-absent refusal).
42. `test/J-CAP-harness.test.ts` (Create) — j_cap_harness (CUJ 11).
43. `test/workbench-call-sites.test.ts` (Create) — the grep-pinned inventory (invoke sites,
    provider-port sites, spawn sites) refusing new untraced paths. (Lands T2, when all
    enforcement points exist; the P-subset rows are asserted by item 10.)

#### Tranche T3 — executables

44. `src/mcp/client.ts` (Create) — the MCP client: the official TypeScript SDK with a custom
    Transport adapter over provider streams (§10 decision); invocation-record emission.
45. `src/capabilities/execSpawn.ts` (Create) — the governed spawn wrapper (per-provider
    matrix; record-before-spawn ledger; secrets env-only; posture-record checks; the
    long-lease slot class; boot-sweep reconciliation helpers) — placed with the containment
    machinery per repo convention; `src/mcp/` holds only the protocol client.
46. `src/capabilities/mcpManage.ts` (Create) — MCP server lifecycle (start/stop/suspend/
    resume) with supervisor integration.
47. `test/fixtures/mcp-stub/` (Create) + `test/J-CAP-mcp.test.ts` (Create) — the stdio MCP
    stub fixture and j_cap_mcp (CUJ 3, local + SSH/WSL parameterized; deadline expiry
    asserted).
48. `test/J-CAP-suspend.test.ts` (Create) — j_cap_suspend + the j_cap_revoke variant
    (CUJs 5, 12: committed-visibility refusal; batch atomicity; scheduler-expiry reason).

#### Tranche T4 — presentation, safe mode, restart/persist

49. `src/ui/FragmentSlot.tsx` (Create) — the slot registry, React error boundaries (net-new
    infrastructure), fail-closed registration with the closed panel-descriptor schema, fault
    recording; the governance-surface refusal at registration.
50. `src/ui/workbench/CapabilityDetail.tsx` (Create) — the capability inspector (version,
    origin, creating actor, effective grants, attributable actions), wired as a shell tab
    consumer of `FragmentSlot` (`src/ui/workbench/Workbench.tsx` Modified).
51. `src/workbench/safeMode.ts` (Create) — the one safe-mode module: boot exclusion read
    (before render/mount), boot-attempt counters, sweep integration, core-violation
    detection; the manual-clear handler mounts from the capability component.
52. `test/J-CAP-safemode.test.ts` (Create) — j_cap_safemode + the j_cap_present variant
    (CUJs 6, 10).
53. `test/J-CAP-restart.test.ts`, `test/J-CAP-persist.test.ts` (Create) — j_cap_restart
    (CUJ 7: boot expiry of session rows, the spawn-ledger sweep, replay mappings),
    j_cap_persist (CUJ 9).

#### Documentation and ledger

54. `src/README.md`, `src/capabilities/README.md`, `src/workbench/README.md`,
    `src/components/README.md`, `docs/known-gaps.md` (Modify) — subsystem entries; the
    single-committing-process deployment invariant; upstream-proposal records.
55. `CURRENT_STATUS.md`, `.agents/CURRENT_STATUS.jsonl` (Modify) — milestone revisions per
    tranche; rev 43 kept distinct.
56. `AGENTS.md` (Modify) — note the capability-runtime enablement gate. The single-operator
    limitation statement stays unchanged.

### Verification Plan

*   **Build/typecheck**: `just typecheck` after every tranche.
*   **Model gates**: after every model change — `domainforge validate
    .sea/interaction/interaction-model.sea` and `domainforge fmt --check
    .sea/interaction/interaction-model.sea`; the doctor's model-hash manifest regenerated at
    packaging.
*   **Pinned numbers (blocker CR-B1)**: descriptor budget ≤ 400 tokens per capability,
    ≤ 4,000 aggregate; payload ≤ 512 KiB per file, ≤ 5 MiB per bundle, ≤ 200 files; version
    retention = active + 3; per-call deadline 60 s default / 300 s maximum; mount timeout
    30 s. Over-ceiling registration refusal and over-budget truncation asserted in j_cap_create
    (item 38); deadline expiry asserted in j_cap_mcp (item 47).
*   **Journeys**: the ten canonical journeys (items 38–42, 47–48, 52–53) carrying all
    thirteen CUJs; the P suite (item 10) gates enablement.
*   **Instruments (owned)**: replay-equality + index transparency + CAS concurrency +
    adapter cleanup → `test/workbench-authority-index.test.ts` (T1, item 30); the grep-pinned
    call-site inventory → `test/workbench-call-sites.test.ts` (T2, item 43); per-row CUJ-4
    observability → items 10 + 41; the negative proofs (forged grants, alternate paths,
    lineage, post-suspension, attempted in-process load, laundering) → items 10 + 41,
    asserted from `authority.decision.recorded`.
*   **Test infrastructure (owned)**: helper extensions → item 29; the MCP stub fixture →
    item 47.
*   **Full gate**: `just verify` at every tranche boundary; a boundary failure that passes
    isolated is classified per the host-concurrency flake class recorded in
    `CURRENT_STATUS.md`.
*   **Evidence**: per-tranche rows in `.agents/plans/capability-bundles/verification.md`;
    `CURRENT_STATUS.md` revisions per milestone; enablement recorded only after the P matrix
    passes and the §1.7 predicate is satisfied.

--------------------------------------------------------------------------------

*Drafted with EGM*
