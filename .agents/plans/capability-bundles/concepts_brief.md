# Capability Bundles — a dynamically extensible Workbench

* **Author:** Sam Prime (EGM brainstorm: six-lens Goldfish review 2026-11-08; owner decisions recorded 2026-11-08; six-lens re-review 2026-11-08; this v3 folds the re-review in)
* **Date:** 2026-11-08 (v3 — supersedes v1/v2 of the same day)
* **Status:** Ideation final — decisions D1–D7 are binding; the re-review verdict is "closes for design". At handoff the owner settled item 0's direction (dispatcher-owned, per-invocation enforcement with validated authority ceilings, conditioned on non-bypassability) and added six binding design requirements — see "Owner direction on item 0" in the Analysis. `/egm-draft` ingests this brief as its authoritative baseline.

## Intent (the experience this feature exists to deliver)

A dynamically extensible Cognate Workbench in which users and authorized agents can create,
compose, install, modify, and use capabilities within the current session. Capabilities are a
normal mechanism for adapting the Workbench and its agent harness — not merely an extension of
today's plugin catalog. Evaluations of this concept are made against this intended user journey
and the Verifiable End-State journeys, not only against how the current code happens to be
structured.

## Glossary (binding vocabulary)

| Term | Meaning | Where it lives today |
| --- | --- | --- |
| **Capability** | The user-facing concept: a unit of Workbench/harness adaptation — built-in, installed, composed, or dynamically created. May contain several skills and MCP servers, or expose one specialized function. The design phase mints compound names early (capability *definition* / *instance* / *bundle*) to keep the senses apart in prose. | this feature |
| **Bundle** | The packaging and distribution form of a capability — not a competing concept, and not the client script bundle. | new |
| Kernel contract | `{ id, version, semanticRef }` provided by a Component at boot | `src/capabilities/workbench.ts:93`, Cognate kernel |
| SEA capability id | A semantic anchor in the interaction model (e.g. `plugin.install`) | `.sea/interaction/interaction-model.sea` |
| Skill-OS contract | A `capability.*` catalog definition with lifecycle + bindings | `CapabilityContractDef`, `src/workbench/types.ts:136-148` |
| Runtime capability instance | What a mounted component actually serves in a live session | Cognate kernel fiber |
| **Authority grant** (this feature's "delegation") | Authority an operator grants an agent to exercise specified powers within a scope. Agents may exercise delegated authority; they may never create or enlarge their own authority. Deliberately *not* called "delegation" in prose: "delegation" already names subagent task delegation in this app (`J-F-delegation`, the Subagents plugin row, `delegate()` in `src/capabilities/tools.ts:29`). The durable grant record is net-new — `team.delegate` is work-decomposition (it inherits `authorityTools` verbatim) and is not the substrate; the only existing narrowing primitive is the kernel's `Scope.child`. | new |
| **Effective authority** | A derived, read-time predicate — the intersection of: the capability's declared requirements, the creator's authority grant, the operator's permissions, and the active execution context. Equivalent to "refuse if any layer refuses". Computed at enforcement points; stored nowhere (a stored intersection would be a fourth authority plane — forbidden by D2). | new |
| **Session-scoped activation / persistent installation / broader-scope installation** | Three distinct authorities: activate for the current chat session (ends at session end or restart — scenario 7 states the fate explicitly); persist across sessions; install at a wider scope. "Session" means the chat/run session (`session.create`), not the 24-hour auth session and not the kernel mount `Scope`. | new |
| Graceful suspension / Emergency termination | Two disciplines of one suspension primitive: suspension immediately rejects new and queued invocations; managed processes stop promptly (process-group kill where the provider allows it); already-started consequential operations reach safe boundaries or are recorded as uncertain, and remain subject to commitment/reconciliation rules. Graceful-vs-emergency is a property of the payload type, not two code paths. | new |
| Skill payload | Markdown skills + references + scripts + a **composition guide** (a markdown document marked as the entry document in discovery metadata; its structured counterpart already exists as contract `conflicts`/`complements`/`owns` fields) | new, loaded by a new skill loader |
| MCP server declaration | A declared external process with its tools | new |
| Grant plane | Per-task `AuthorityScopes` (filesystem/shell/network/packages/extensions). Today its values are caller-declared via task contracts — see Open item 0. | `src/workbench/types.ts:10-18` |
| Core catalog entries | The five `core` plugins (model-provider, session-history, workspaces, approvals, preferences) | `src/plugins.ts:54-58` |
| Context levels | User space (default) and workspace/project are implemented; **work group is a reserved, fail-closed key** — refused until a substrate exists (`tenant` in `src/auth/identity.ts` is the nearest dimension; no work-group scenario exists). | new |
| Hallmark, Impeccable | External file-based design skills (anti-slop design rules; gated frontend design workflow) used as the payload of journey scenario 1. They are bundle payload, not Workbench concepts. | external |

## Owner decisions (recorded 2026-11-08 — binding constraints for design)

**D1. Trust boundary: the recorded trust-model change (v1's B1b).** Executable capability
payloads are in scope, including MCP servers. Declarative-only capabilities remain first-class —
not every capability needs executable code (the Hallmark + Impeccable visual-design example must
work through skill composition alone). A capability may contain: file-based skills (references,
instructions, scripts); MCP servers and their declared tools; composition instructions;
configurable agent behaviors, prompts, tool compositions, and routing; presentation and UI
extensions subject to the immutable core boundary. Authority is enforced at install, enable, and
invocation. A capability can never gain more authority than its operator or delegated agent may
exercise in the relevant context. Provenance, content integrity, execution containment, secrets,
and process lifecycle are handled through explicit contracts; content hashes establish
integrity, not trust by themselves. The immutable authority, identity, admission, approval, and
recovery machinery is preserved — the extension system operates through these mechanisms, never
around them.

**D2. Expert creation: authority grants, not self-authorization (v1's B3b, refined).**
The governing rule: agents may exercise granted authority but may not create or enlarge their
own authority. Where the operator has granted the power (e.g. "create and enable user-scoped
capabilities"), the orchestrator's full flow — understand the request, discover reusable skills
and tools, compose or author missing parts, validate and register, activate in the current
session, make available to the requesting agent, report what was created with controls for
edit/suspend/remove — requires no additional manual approval, because the operations are covered
by a valid grant. Authorship is not approval: authoring, validation, authorization, and
activation are separate steps, with policy evaluation and activation enforcement owned by the
trusted runtime. Operations exceeding existing grants produce either an authorization request (a
durable continuation — precedent: the `ambiguous-invocation` continuation shape) or an inactive
draft. To be implemented for the single operator across the context levels first; a clean
extension path to multi-identity RBAC, without a second parallel authority system.

**D3. Unification: one capability model with a compatibility bridge during migration (v1's B5).**
Capability is the user-facing concept whether built-in, installed, composed, or dynamically
created; a bundle is its packaging form. Internal technical distinctions (kernel contracts,
semantic anchors, runtime instances) are preserved where correctness requires. The existing
PluginSource and Skill OS mechanisms are used where they genuinely help; a compatibility bridge
is an acceptable migration technique, but the target is one coherent capability lifecycle and
management experience — not two permanently competing systems. Because D1 already requires an
explicit SEA trust-model change, the capability-model migration is evaluated as part of that
coordinated change. Existing durable records and semantic IDs are carried through a deliberate
migration.

**D4. Runtime loading and skill composition are core requirements.** Hot-load and immediate use
in the current session is not optional. Whether the runtime extension point belongs in Cognate
itself is to be investigated first; framework gaps are made explicit and proposed upstream per
building-with-cognate — never silently worked around inside the Workbench. The skill system
supports discovery, loading, composition, and invocation: discovery through lightweight
metadata; full instructions and referenced resources loaded when relevant (a session never
preloads every installed skill's *content*); per-capability composition guides; deterministic,
versioned reload effective in the current session; a replacement retires the previous effective
binding — no phantom active versions.

**D5. Yank = immediate suspension — never uninstall, never rollback.** Suspension immediately
prevents new invocations and rejects queued invocations that have not started. In-flight work
distinguishes graceful suspension (already-started operations reach a safe boundary where
possible) from emergency termination (managed processes stop promptly; operations with uncertain
outcomes are recorded as such — the `UNKNOWN_RECONCILIATION_REQUIRED` commitment state already
exists). Interrupted consequential operations remain subject to the existing commitment and
reconciliation rules — terminating a process never assumes its effects are reversed. Uninstall
and version rollback are separate operations. The operator can see, per capability: what was
activated, its version and origin, the creating actor, its effective grants, and the actions
attributable to it. The existing event architecture is the durable source of truth, extended
with capability-lifecycle and MCP invocation records; audit claims reflect only what the runtime
actually observed, including the distinction between a recorded MCP tool invocation and
unobserved subprocess activity.

**D6. Mutable presentation, immutable core, safe mode.** The security and authority core is not
modifiable through capabilities. The presentation layer is intentionally customizable — how the
Workbench looks, behaves, and presents its capabilities. Declarative UI extension points are an
initial implementation, but the design must not encode a permanent architectural restriction
that makes richer operator-authorized UI extensions impossible. **Governance-presenting
surfaces — the approval dialog, authority/grant displays, suspension and audit views — are
presentation *and* governance: they are rendered only by core renderers, excluded from
presentation extension, and an extension that overrides them is a core violation (safe mode
treats it as such, not as a broken extension to suspend-and-continue).** Certain non-security
built-ins may be disabled but not removed; essential recovery and governance facilities remain
available. Safe mode recovers from broken capability configurations or UI extensions: boots with
a known-good presentation, suspends problematic extensions, preserves durable records, and lets
the operator inspect and recover without relying on the broken component.

**D7. Implementation and evidence discipline.** The E-phase release boundary (through rev 43)
is respected before implementation. The design must explicitly settle: the runtime dispatch
mechanism; the lifecycle and activation-state model; capability versioning and binding
retirement; the effective-authority calculation; and the skill loading/invocation contract.
Directory-based sources first (marketplace is post-v1; the only v1 commitment is the
`PluginSource`-shaped abstraction); the source mechanism must accommodate provider-backed
environments (SSH, WSL) without assuming every workspace is a local filesystem directory.
End-to-end journey evidence covers the ten scenarios in the Verifiable End-State section.

## Analysis (v3 — two six-lens passes, deduplicated)

### Factual corrections the re-review established (the design must reason from these)

1. **Post-boot mounting is proven in-app — the v2 premise was wrong.** `ProviderRegistry.swap`
   (`src/components/providerRegistry.ts:130-146`) mounts a replacement provider component
   mid-session, waits for `ACTIVE`, and disposes on failure with rollback — invoked from
   `model.configure`. Boot also mounts several components post-construction (`src/server.ts:788-902`).
   The real gaps are narrower: no post-boot mount extends the *capability surface*;
   `GRANTED_CAPABILITIES` is a boot-static allowlist, so a runtime-mounted component's
   capabilities are not policy-invocable mid-session; the kernel's `capability.provided` /
   `capability.withdrawn` / `invocation` events have zero subscribers anywhere (in-memory emit,
   `cognate-kernel-cordis/src/kernel.ts:55-57`); and the model-facing tool catalog comes from
   static arrays (`TOOL_DEFS` etc., `src/agents/agentCoding.ts:231-342`) while dispatch itself is
   generic `ctx.invoke`. The provider hot-swap (mount → wait ACTIVE → dispose-on-failure) is the
   in-app precedent the dispatcher compiles onto — option (a) below is legitimate use of an
   existing surface, not a framework workaround.
2. **`canInvoke`/`isTrusted` have one production caller**: the capability panel's status display
   (`src/ui/workbench/CapabilityList.tsx:6,69-72`) — display only, never invocation gating. The
   substance stands: nothing gates invocation on skill-OS state.
3. **The grant plane's values are caller-declared today.** `task.create` accepts an arbitrary
   contract `authority`; `authority.check` honors exactly those scopes; unbound runs default to
   `ALL_ALLOWED` (`src/capabilities/workbench.ts:70-77, 189-193, 381-402`). An agent can declare
   its own full scopes today. D2's governing rule therefore has no enforcement point until this
   is closed (Open item 0).
4. **The operator-only convention is scattered imperative checks**, not a plane: at least ten
   handlers independently implement `ctx.actor.kind !== "user" || ctx.runId` with subtly
   different shapes (`browser.ts:26`, `containedWorkspace.ts:265`, `governance.ts:132`,
   `settlement.ts:91`, `taskCheckout.ts:48`, `terminal.ts:35`, `workspaceFiles.ts:78`,
   `ambiguousStep.ts:58`, `expertEffect.ts:255`, `workbench.ts:144`).
5. **"J-PLG family" is one modeled journey** (`J-PLG-install`, `.sea:1035-1046`) plus four test
   suites (`J-PLG-install`, `J-PLG-panels`, `J-PLG-toggle`, `workbench-plugins`); the skill-OS
   side of the model (`SkillCapability`/`CapabilityImplementation` entities at `.sea:57-59`, the
   `J-WB-capability-lifecycle` journey at `.sea:780-786`, the `skill.*` anchors at `.sea:764,777`)
   is part of the same coordinated migration surface.
6. **SSH worlds cannot group-kill**: "No process group is reachable: close the channel (sends
   EOF)" (`src/terminal/ssh.ts:100`) — prompt termination is provider-dependent (Open item 6).
7. **The visual-design composition is already rehearsed in the seed catalog**:
   `capability.visual-polish` → `impl.impeccable-polish` (`src/workbench/skillOs.ts:275-282`).
   The new engineering is the loader and activation, not new model entities.
8. **Event-amplification mitigation exists**: `coalesceProjectionReads`
   (`src/ui/coalesceReads.ts:12-27`) shares one in-flight read per projection; the documented
   client amplification is classified as a framework matter (`docs/known-gaps.md:225`).

### Open for design — the load-bearing remainder, in order

**0. Enforcement topology of effective authority (the decisive question — settles before or
first in design).** The four-leg intersection (declared requirements ∩ creator's grant ∩
operator permissions ∩ execution context) is underivable at any existing single chokepoint, and
the kernel seam cannot even express its inputs: `AuthorizationRequest` carries only
`{operation, actor, tenant, scopeId, capability, providerId, correlationId}`
(`cognate-kernel-api/src/types.ts:69-77`) — no session, workspace, task, or execution-context
field; the app policy is static membership over `GRANTED_CAPABILITIES` (`src/server.ts:219-326`);
the grant plane's values are caller-declared (correction 3). The design must:

- Name **one enforcement chokepoint** that owns the intersection (leading shape: the dispatcher's
  per-invocation decision, composed with a validate-at-declaration ceiling check at
  `task.create`/bind time that refuses-or-drafts per D2 — never a stored intersection);
- Enumerate the **bypass list** and close it (direct `ctx.invoke` paths exist, e.g.
  `src/agents/agentCoding.ts:182,724`);
- Classify each intersection input as runtime-owned or declarative, retire the `ALL_ALLOWED`
  default for agent-initiated flows, and clamp declared scopes at use time
  (declared ∩ grant ∩ operator permissions);
- Replace the scattered operator-only checks (correction 4) with a data-driven actor-authority
  surface enforced at one point — a prerequisite, not a parallel system;
- Make the **approval gate grant-aware**: the tool-approval gate (`agentCoding.ts:646`,
  `tool-approval` continuations) would otherwise park the granted flow on human continuations —
  the exact friction D2 rejects. Grant-covered operations resolve without a human continuation;
  everything else parks as today. This is part of the coordinated SEA change, not a
  dispatcher-side skip.
- Record the `AuthorizationRequest` shape limitation as an **explicit upstream proposal** (D4's
  framework-gap discipline), or declare the dispatcher the sole grant/context gate with kernel
  policy retaining static actor grants — and state the audit consequence (refusals originate
  where they are decided).

**Owner direction on item 0 (recorded at handoff, 2026-11-08 — binding for design):** the
preferred direction is **dispatcher-owned, per-invocation enforcement with validated authority
ceilings**, conditioned on the dispatcher being established as a genuinely non-bypassable
enforcement boundary. Six requirements follow from this:

1. **Authority originates from a trusted source, not the invoking agent.** An agent can request
   an operation but cannot determine its own effective grants by supplying `AuthorityScopes`.
   The `ALL_ALLOWED` behavior is retired for agent-initiated operations. Authority ceilings are
   established by trusted authority and enforced independently of caller-supplied declarations.
2. **The authorization boundary is complete.** Every invocation path is traced — dynamically
   mounted kernel capabilities, built-in tools, MCP calls, expert delegation, and direct
   execution-world operations. Any path that bypasses the dispatcher is either routed through
   the enforcement boundary or enforces the same authoritative decision at a lower layer. No
   parallel, inconsistent authorization mechanisms.
3. **Authorized operations stay frictionless.** Operations within an existing grant proceed
   without additional human approval; operations beyond it are refused or trigger an
   authorization request. The approval machinery recognizes valid grants without letting the
   agent grant itself new authority.
4. **Authority is separate from activation.** An installed or enabled capability is not
   automatically authorized for every actor or context. Invocation requires both an effective
   activation state and valid authority; context-specific permissions are evaluated at
   invocation time, including after hot reloads, suspension, and revocation.
5. **The existing Cognate architecture is used appropriately.** Start from the proven
   `Kernel.mount` precedent and existing authorization facilities. If the kernel cannot enforce
   the required boundary without an unsafe bypass, identify the precise missing kernel contract
   and propose the upstream change. No competing authority system inside the Workbench.
6. **The existing self-declared authority behavior is an independent correctness defect** —
   caller-declared contract authority and the `ALL_ALLOWED` default. The design records its
   remediation, including implications for the current release boundary; the new capability
   system must not perpetuate the defect.

The design must **prove the negative cases**: an agent forging its grants, invoking a
capability through an alternate path, using a broader workspace scope, or continuing invocation
after suspension must not acquire authority it lacks. The enforcement topology is designed
first; its consequences inform the lifecycle, runtime dispatch, skill loader, and migration
design. Prefer the smallest coherent mechanism that meets the complete contract — without
simplifying away any intended affordance.

**1. Runtime dispatch mechanism.** Investigate from correction 1's verified facts: (a) one
dispatch capability allow-listed at boot, routing to bundle-provided handlers mounted via
`Kernel.mount` (the policy allowlist never mutates at runtime — the mount surface is proven by
the provider hot-swap), or (b) an upstream framework change. Includes the tool-catalog
insertion seam: how a bundle-provided tool reaches the model's turn catalog (pre-declared
dispatcher ids vs upstream agent-definition extension), versioned and retired. Refusal contract
and audit attribution shape with item 0.

**2. Lifecycle and activation-state model.** Two machines, composed: the grant ladder stays
forward-only with human gates at exactly REVIEWED/INSTALLED/AUTHORITY_GRANTED (D2 keeps those);
a separate per-binding activation axis (dormant → session-active → suspended, with tombstone
retirement events) carries D2/D5 semantics. Invocation eligibility is the conjunction of the
two. Sub-questions to settle: which machine gates invocation (given the enable-time conflict
check reads lifecycle over bindings); session-scoped activation expiry (no terminal session
event exists today — only archive); single authoritative owner of effective runtime state (see
item 9's rule).

**3. Versioning and binding retirement.** Version on `CapabilityContractDef` (the payload hash
is part of version identity — couples to item 7's re-hash duty); retirement of superseded
bindings (tombstone event + fold); conflict detection over live bindings only (the current fold
counts stale rows: `reducer.ts:124-131`, `workbench.ts:483`).

**4. Authority-grant records and the intersection.** Durable grant records (net-new — correction
and glossary above), the delegated-power → grant-plane-scope mapping table (with the bundle
store as a named first-class scope target), how the read-time predicate evaluates at the item-0
chokepoint, and the authorization-request continuation shape.

**5. Skill loading/invocation contract.** Discovery metadata (what the model sees before
loading), load-on-relevance, the composition guide as entry document, the invocation path, and
the authority rules for reading skill files and scripts. **Token economics are part of this
item**: a hard per-capability metadata budget and an aggregate ceiling; the relevance-deciding
mechanism named (model-visible preamble paid every turn vs pre-context filter paid in compute —
an order-of-magnitude cost difference); the evidence suite includes a catalog-size scaling
check.

**6. MCP execution contracts.** Spawn-world rule: **bundle-provided servers execute only
through execution-world ports, never as uncontained host processes** (the default contained
posture refuses them; scenario 3 parameterizes over local and one provider-backed world).
Secrets env-only, never argv, fail-closed on missing keys. The spawn/exit/kill event family.
The attribution boundary at the MCP client records tool invocations with the observation-honesty
line D5 requires. Termination honesty per provider: local group-kill exists; SSH degrades to
channel close — recorded, never assumed.

**7. Bundle storage and integrity.** Directory payloads are the durable home for v1 (no payload
copies into the event store — no second source of truth); the durable record carries
provenance, version, and content hash only. **Reconciliation rule**: hashes verified at every
load/invocation dispatch, not install-time only; mismatch = fail-closed load + recorded
integrity event; modification happens only through a governed re-hash mutation that bumps the
version (journey 2's operator edit is that mutation, not an in-place edit). Size ceilings
stated; the content-addressed partition store (`src/experts/persistence.ts`) is the known
solution deferred to post-v1 sources. `protectedPaths` at bind time defends against agent tool
calls only — bundle-spawned processes are covered by item 6's containment contract, and the
operator's own editor is covered by the governed re-hash rule.

**8. Coordinated SEA migration (D1+D3).** Full inventory: the Plugin entity and trust-model
clause (`.sea:114-118`); `J-PLG-install` (one journey, `.sea:1035-1046`) and the four plugin
test suites; `plugin.*` anchors and the `domain/index.ts` bindCapabilities step; the `plugins`
projection **and its second consumer** — the `agent.config` recorder (`src/agents/agentConfig.ts:69-70,172-173`);
the in-code trust-boundary twin (`pluginRegistry.ts:12-15`, `verifyImplementation`,
`installRefusal`, `plugins.ts:1-17`, `plugin.install` inside `GRANTED_CAPABILITIES`) re-authored
in the same change; the skill-OS side (`SkillCapability`/`CapabilityImplementation` entities,
`J-WB-capability-lifecycle` settlement encoding the ladder, `skill.*` anchors); the namespace
partition rule (reserved built-in ids or a namespaced bundle prefix, ownership enforced at
`skill.register` — today a bundle could shadow a built-in id permanently); the doctor's
model-hash manifest regeneration. **Replay compatibility is binding**: plugin-era and
skill-OS-era events must replay to valid state under the new folds (the projection already
refuses unmatched-row deletion to keep folds total, `projections/plugins.ts:29-31`).

**9. Single durable owner and the two-log rule.** The workbench event log is the sole durable
owner of effective runtime state. Kernel mount/withdraw are **derived, never independently
authoritative**: the dispatcher mounts from committed workbench state, boot ordering is fold
first / mount second (the `restoreExecutionWorlds` boot-reconciliation precedent,
`src/server.ts:762`), and a crash between mount and record is resolved by boot re-derivation.
Kernel provide/withdraw/invocation events are observed and folded into the durable log for
bundle-mounted components, carrying the `PolicyDecision` into attribution (nothing subscribes
today — the bridge is mandatory). **Suspension enforcement ordering**: the dispatcher refuses
on committed-event visibility (record is fire-and-forget; `recordAndWait` is unusable from
agent-invoked paths), or suspension is decided inside the recording run — never a
fold-lag window.

**10. Safe mode mechanics.** The durable suspension record is a fold of the capability-lifecycle
event family (not a parallel record); read before any bundle mounts; boot-attempt counters for
escalation; known-good presentation; operator recovery surface; manual clear as an
operator-only capability with its own event; B5 budgets + `/health` watchdog as detectors; boot
re-registration replays durable records (`workbench.seed` seeds-only-when-empty stands).
Presentation extensions are declarative manifest fragments rendered by existing UI surfaces
through the honesty machinery (`pluginViews`-style rows with verbatim reasons); the durable
form of a presentation extension and its exclusion-at-boot read path are defined here. The
governance-surface exclusion (D6) is enforced by safe mode as a core violation.

**11. Event economics.** Debounce/coalesce at the reload entry point inside the dispatcher (one
place, scenario-2-driven), extending `coalesceProjectionReads`; no per-bundle event budgets or
per-session caps in v1 (deferred until a storm is observed in evidence); the projection
amplification is recorded as the upstream proposal it already is (`docs/known-gaps.md:225`);
authoring spend attributed through the existing billing ceilings.

### Holds together (verified across both passes)

Five core catalog entries = the immutable five; the skill OS register/bind/lifecycle with prefix
rule, substitution check, conflict detection; `PluginSource` designed for future sources (the
v1-only distribution commitment); secret-store invariants match D1; process-group kill precedent
(local terminal); title cue is the recorded canonical attention surface; tenant isolation end to
end; the human-gate chain is agent-invocable up to exactly the gated states — the seam D2's
authority grants compile onto; `CommitmentService` states (`UNKNOWN_RECONCILIATION_REQUIRED`)
and the `ambiguous-invocation` continuation already express D5's honesty and D2's
authorization-request shape; the disable-not-remove mechanism reuses the settings-toggle
machinery wholesale (`PluginImplementation` settings-toggle kind, `TOGGLEABLE_PLUGINS`,
`pluginViews` honesty text); provider hot-swap proves mid-session mount; directory ingestion can
reuse the bounded, guarded directory semantics of `workspaceFiles`/`workspaceDirectorySuggest`
(500 entries / 512 KiB, symlink refusal, protected app home) over SSH/WSL worlds.

## Goals vs. Non-Goals

**In-Scope Goals**

- Session-scoped hot-load and immediate use of created, composed, installed, and modified
  capabilities (D4) — deterministic, versioned, with binding retirement and a single durable
  state owner.
- Executable payloads including MCP servers under explicit contracts (D1), with declarative
  capabilities equally first-class.
- The authority-grant creation flow (D2): understand → discover → compose → validate → register
  → activate → report, without extra approval inside a valid grant; authorization request or
  inactive draft beyond it; grant-aware approval gating; declared-authority clamping.
- One capability model (D3) reached through the coordinated SEA migration (item 8), with the
  compatibility bridge as technique.
- Skill discovery via lightweight metadata within hard token budgets, load-on-relevance,
  per-capability composition guides.
- Immediate suspension (D5) — one primitive, per-payload disciplines, commitment preservation,
  observation-honest audit attribution, committed-event-visibility enforcement ordering.
- Mutable presentation (D6) — declarative manifest fragments first, no permanent ceiling,
  governance surfaces excluded and violation-treated; disable-not-remove built-ins; automatic
  safe mode.
- Directory sources first (D7) over provider-backed semantics; marketplace post-v1 through the
  same contract shape.
- The ten journey scenarios as end-to-end evidence.

**Out-of-Scope Non-Goals**

- Becoming a cordis plugin host, or silently implementing a competing framework inside the
  Workbench — kernel gaps go upstream (D4; `AuthorizationRequest` shape, tool-catalog
  extension, and projection amplification are named candidates).
- A second parallel authority system — the intersection is a derived read-time predicate over
  the existing planes plus the net-new grant records; stored effective-authority records are
  forbidden (D2).
- Multi-identity RBAC rollout — authority-grant records and context levels keep the extension
  path clean; the work-group key is reserved and fail-closed (D2).
- Bypassing the immutable authority/identity/admission/approval/recovery machinery (D1, D6).
- Shipping during E-phase (D7).
- Assuming every workspace is a local filesystem directory (D7).
- Marketplace machinery, durable payload copies, per-bundle event budgets, rollback-to-version
  UI, structured guide formats, and work-group substrate in v1.

## Alternatives Weighed

1. **Cosmetic rename only** — rejected: does not deliver on-the-fly creation, hot reload, or
   bundles.
2. **Bridge as the target architecture** — rejected as the target by D3; retained as an
   acceptable migration technique during the coordinated change.
3. **Declarative-only as the architectural boundary** — rejected by D1; retained as a possible
   intermediate milestone.
4. **Next-session activation fallback** — rejected: D4 makes in-session use a core requirement.
5. **A parallel RBAC layer now** — rejected by D2: authority grants and context levels compile
   onto `GRANTED_CAPABILITIES`, the grant plane, and the tenant dimension.
6. **Marketplace-first distribution** — rejected by D7: directory sources first; marketplace
   post-v1.
7. **Host `fs.watch` on workspace roots** — rejected: crosses the provider boundary; breaks
   SSH/WSL worlds silently; ingestion is defined over provider-backed semantics.
8. **Notification channel for activation surfacing** — rejected: OQ1 (rev 42) decided the
   notification plugin is not shipped.
9. **Per-operation manual approval inside granted authority** — rejected by D2; the control is
   grant-aware approval gating plus separation of authorship from authorization.
10. **Preload every installed skill into session context** — rejected by D4: discovery metadata
    + load-on-relevance within budgets.
11. **A stored effective-authority record** (materializing the intersection as a projection) —
    rejected: a fourth authority plane and a drift-prone second system; the intersection is a
    read-time predicate (re-review, zoom-out).
12. **Compiling authority grants onto `team.delegate`** — rejected: it inherits `authorityTools`
    verbatim with no narrowing; grants are net-new records (re-review, codebase-details).
13. **Dual suspension engines (graceful vs emergency code paths)** — rejected: one suspension
    primitive with per-payload dispatch to existing disciplines (re-review, zoom-out).
14. **Durable payload copies in the event store** — rejected: second source of truth vs the
    live directory; hash-only durable records with the item-7 reconciliation rule (re-review,
    zoom-out + structural).
15. **A custom async kernel Policy reading grant records per invocation** — held as the fallback
    if the dispatcher-owned topology fails review; costs a durable read on every invocation in
    every agent run (re-review, design).

## Verifiable End-State (journey scenarios — evidence required)

1. An operator asks the orchestrator to create a visual-design capability using Hallmark and
   Impeccable. It is available and usable without restarting the session. (Assertable: a
   subsequent run exercises the created capability; the composition guide reaches the model;
   discovery metadata was present without full preload.)
2. The operator modifies an installed skill or capability — through the governed re-hash
   mutation. The next eligible invocation — dispatched after the reload commit — observes the
   new version, without losing the session; in-flight calls complete under the old binding or
   are refused per D5.
3. An authorized capability containing an MCP server is installed, started, invoked, suspended,
   and recovered, with correct authority and audit attribution — parameterized over the local
   world and one provider-backed world; recorded MCP tool invocation events are distinguished
   from unobserved subprocess activity; spawn fails closed when the world cannot.
4. An agent requests a capability outside its granted authority and is correctly refused
   without being allowed to grant itself additional authority — including the caller-declared
   authority clamp.
5. Suspending a capability blocks subsequent calls (committed-event-visibility enforcement
   ordering), handles in-flight work correctly, and preserves reconciliation evidence.
6. A broken capability or presentation extension triggers safe-mode recovery without corrupting
   the durable capability registry; a governance-surface override is treated as a core
   violation.
7. A restart restores only the valid, recorded effective capability state — explicitly
   including the fate of session-scoped activations.
8. A capability is installed from a directory source on a provider-backed (SSH or WSL) world
   and behaves identically to a local-world install (D7's no-local-filesystem-assumption
   promise).
9. A capability is activated persistently (across sessions) at a stated context level, and the
   context-level scoping is observable in authority decisions (D2's three distinct authorities).
10. A declarative presentation extension renders correctly in the normal path (the positive
    path behind safe mode's negative scenario 6).

## Key Decisions & Staging for Next Steps

**Decisions D1–D7 are binding.** The design document must explicitly settle — in order — the
enforcement topology (item 0), the runtime dispatch mechanism (item 1), the lifecycle and
activation-state model (item 2), capability versioning and binding retirement (item 3), the
effective-authority calculation (item 4), and the skill loading/invocation contract (item 5) —
and must name every Cognate framework gap it encounters as an explicit upstream proposal rather
than a workaround (candidates already named: the `AuthorizationRequest` shape, tool-catalog
extension, projection-read amplification).

**Staging:**

1. E-phase settles (rev 43) before implementation begins; the concept state and this re-review
   outcome are recorded in the status ledger without blurring into rev 43.
2. Design work opens with items 0–5; item 0 (enforcement topology) is settled in direction
   (owner handoff) but the design must first prove the dispatcher's non-bypassability against
   the complete invocation-path trace before the topology's consequences are allowed to inform
   items 1–5.
3. Model-first: the coordinated SEA change (trust model + capability model + namespace partition
   + the new canonical journey family) enters the catalog via `domainforge validate` +
   `fmt --check` before any implementation; `J-PLG-install` and `J-WB-capability-lifecycle` are
   rewritten or superseded with recorded rationale; replay compatibility over the historical log
   is a binding constraint.
4. The skill loader is its own work package — the largest single piece of new engineering.
5. Work packages (revised by the re-review): (WP1) coordinated SEA migration design and inventory;
   (WP2) runtime extension-point investigation + dispatcher, from the provider-hot-swap
   precedent; (WP3) lifecycle, versioning, binding retirement state machines; (WP4) authority
   grants and the effective-authority enforcement topology; (WP5) skill loader, discovery,
   composition, and metadata budgets; (WP6) MCP execution contracts and the process supervisor;
   (WP7) suspension, yank, safe mode, recovery, and the capability inspector/governance surface;
   (WP8) declarative presentation fragments through the honesty machinery; (WP9) directory
   sources over provider-backed semantics (marketplace post-v1; storage ceilings live here);
   (WP10) journey suites and end-to-end evidence (spans all tranches, not deferred to the end).
   Dependencies: WP1 gates all implementation; WP2/WP3 feed WP5–WP7; WP4 needs WP3's single
   lifecycle owner; each tranche maps to one or more canonical journeys end to end.
