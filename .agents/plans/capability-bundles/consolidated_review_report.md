# Consolidated Review Report — Capability Bundles design

*   **Target:** `.agents/plans/capability-bundles/design.md` (FeatureRange 1–1062, DetailedRange 1063–1216)
*   **Pipeline:** Consolidated full flow — Stages 5–9, fresh-context reviewers, all findings deduplicated
*   **Stage reports:** `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `intermediate_zoom_out_report.md`, `implementation_readiness_report.md`
*   **Date:** 2026-11-08
*   **Totals after dedup:** 4 🔴 Blocker · 13 🟡 Major groups · ~35 🟢 Nit

**Overall verdict across stages:** the core mechanism survives every lens as the smallest
coherent one for its contract — dispatcher-sole-route topology, per-agent principals, the
CAS lifecycleRecorder, the commit-synchronous index, version directories, the two-tier
handler boundary, and the containment matrix all verified against code repeatedly. The
Blockers are completeness failures in the plan and evidence chain, not design failures; the
Major groups are contract-level specifications and scope-branch decisions. None requires
re-architecture.

## 🔴 Blockers

**CR-B1 — OQ-A numbers are not pinned anywhere; the Verification Plan violates the design's
own pinning requirement.** [IR-1] Descriptor token budgets, bundle payload ceilings
(per-bundle total, per-file, file count), and version-directory retention are deferred to
"implementation planning and pinned in the verification plan" — but the DetailedRange IS that
plan and pins nothing; no over-ceiling/over-budget refusal is asserted either. **Fix:** pin
the numbers in the Verification Plan (retention N — §4.4 suggests 3) and add the refusal
assertions to j_cap_create/j_cap_reload.

**CR-B2 — The M tranche omits the plugin-era files §9.1/§9.3 mandate re-authoring "in the
same change."** [IR-4, CD-1] `src/components/pluginRegistry.ts`, `src/plugins.ts`,
`src/capabilities/pluginInstall.ts`, `src/projections/plugins.ts` appear in no item — the
in-code trust twin (containing `plugin.install` in `GRANTED_CAPABILITIES`,
`verifyImplementation`, `installRefusal`) would still assert the retired trust model while
the replay mappings' fold-side homes go unassigned. **Fix:** add the four files to M with
their §9.1/§9.3 roles; fold item 35's `BuiltinPluginSource` bridge edits in.

**CR-B3 — T1 lands the activation machine and the CUJ 1/2/13 journey suites before the
dispatcher (T2) that activation structurally requires.** [CD-2, IR-8] §4.2.4's activation
mounts through the dispatcher's table; §9.5 groups "dispatcher + activation machine" as one
step; the T1 `just verify` gate cannot pass as itemized. **Fix:** move items 20–21 to T2, or
split register/validate (T1) from activate (T2) explicitly.

**CR-B4 — The P tranche cannot produce its own CUJ-4 evidence: `authority.decision.recorded`
has no emission home at enforcement point A and its recording substrate lands in M, after P.**
[CD-3, IR-10b, Z8-2] §8's emitter list (A, dispatcher, spawn boundary) does not cover the
backstop refusals the §2.3 rows 3/8/9 remediations produce (the §1.6.v policy branch, subagent
narrowing, `harness.bind` convention — `requireUser` today throws an unrecorded Error), and
`WORKBENCH_EVENTS`/`workbench.recorded` are extended only in M. The enablement gate's evidence
source is unwritable at the P boundary. **Fix:** assign the decision-record emission to item 1
(agentCoding), move the family's substrate extension into P (or schedule P after the substrate
piece of M), and name the backstop emitters (policy-refusal hook; convention checks converted
to recorded refusals) — or amend CUJ 4 to state per-row where each refusal is observable.

## 🟡 Major groups

**CR-M1 — Scope-branch decisions required (Stage 8); the recommended branches shrink v1
without touching any CUJ.** [Z8-8, Z8-9, Z8-10, Z5-1, Z8-6] (a) Allowances → structural
constants: strike `authority.level.allowances.set` (§8, item 18), amend §1.4's "in the index"
clause, dissolve DES-2/STR-3(1), operator root grant becomes a constant (dissolves the seed
gap in IR-5c); (b) Descriptors → run-start assembly only: delete the dirty-flag machinery
(item 23, §5.1, §2.5's next-turn story), removing §3.2's only needed exception; (c) Harness
surfaces → instruction patch + toolset override only: routing and workflows become post-v1
(G4, §3.1, item 25; dissolves STR-5's surface half). The editable/editable variants return
when a journey exercises them.

**CR-M2 — Contract gaps, authority model.** [DES-1, DES-3, DES-4, DES-6, DES-7, STR-1,
STR-2, DES-9, DES-11] (a) Reconcile the stored activation ceiling with Alternative B/D2
(one normative paragraph + staleness rule); (b) §2.3 row 3's grant half needs a mechanism and
the §1.6.v agent-branch membership rule (loop-invoked built-ins in; governance ids out) or
every native tool call breaks; (c) approval composition: authority-allow pre-empts only the
authority-plane continuation — mode/risk gates always still park; state the park-vs-refuse
mapping per authority kind (invocations refuse; activation/creation requests park; no drafts)
as the recorded D2 reconciliation; (d) grants immutable (change = revoke + reissue); (e) the
activation/ladder join as a total function (which implementation's ladder row gates; which
activation row a decision consults when persistent + session-scoped coexist); (f) `expired`
disambiguated (reason member vs terminal state vs tombstone) with a named writer per cause;
(g) a per-call deadline at the dispatcher/MCP-client layer (drain invariant depends on
termination); (h) the restart fate of session-scoped activations (recommended: boot
reconciliation expires every session-bound activation before mount).

**CR-M3 — Contract gaps, boundary/loader.** [STR-4, Z8-3, DES-8, DES-10, DES-13, COMP-10]
(a) The two adapter-interpreted data vocabularies must be closed and enumerated
(presentation payload content schema; the `<capabilityId>.<operation>` data-operation set)
with registration-time validation; state the framed protocol refuses server-initiated
requests; (b) one overlap regime per harness surface kind; (c) repoint re-runs the conflict
check against live bindings; (d) the source-reading rule stated once precisely (recorded
versions never consult the source for loading/integrity; the authoring location is read only
by a fresh governed registration); (e) the operator-only surface: consolidate to the single
policy point or record why alignment-only suffices for v1 (incl. the ten scattered sites —
IR-12); (f) define the execution-posture record (scope, owner, setter, and what makes
"explicitly and accurately" satisfiable).

**CR-M4 — Evidence and matrix completeness.** [STR-6, DES-12, STR-5, COMP-7] (a) §8's
transition×event×fold matrix must actually appear (missing cells: create/author arrow,
boot-sweep `reconciled-unknown`, partial-materialization, re-suspend/repoint-while-suspended/
deactivate-from-suspended/uninstall-while-active); (b) the baseline's catalog-size scaling
check: add a variant or record the delegation; (c) CUJ coverage for the enablement gate's
refusal path (+ the grouped nits: reverse orphan mid-session, satisfiability refusal,
schema-refusal envelope, tools.list, governance-mode refusal, pruning, truncation); (d) CUJ
13's failure family aligned with §4.3 (`repoint_failed`) or `activation_failed` defined as
the umbrella.

**CR-M5 — Unassigned mechanisms (feature content with no target file).** [IR-5, CD-4, CD-5,
CD-6, CD-7, DES-19, CD-10] §1.7's boot-gate read (server.ts mounting); the
`GRANTED_CAPABILITIES` dispatcher-id edit (§2.4's third gate — currently the dispatcher is
policy-denied on every call); the descriptor dirty-flag's write side; the grant-expiry
scheduler tick (`src/workbench/automation.ts`); the kernel-observation bridge
(`workbench.kernel.observed.*` writer); the remediation-complete marker family + writer; the
pruning trigger.

**CR-M6 — Zero-decision dependency selections.** [IR-6, Z8-1, Z5-4] MCP client:
SDK-adapter vs hand-roll (the official TS SDK supports custom transports — record the
decision with the transport-adapter constraint); JSON-Schema validator: choose the library
(none exists in the dependency tree) or an explicitly scoped subset; state the activation
timeout as the dispatcher's own choice (the kernel default is 2 s, adapter-supplied — STR-8).

**CR-M7 — Test infrastructure and instruments unowned.** [IR-11, CD-11, CD-14, IR-9]
`test/wb-helpers.ts` extensions (boot with runtime enabled, grant seeding, dispatcher
mounting) and the stdio MCP stub fixture; the five non-journey instruments (replay-equality,
grep-pinned inventory, index transparency, CAS concurrency, adapter cleanup) assigned to
named test files and tranches; `verification.md` added as a Create item.

**CR-M8 — Deployment invariant: single committing process.** [DES-5, COMP-6] Under external
PostgreSQL the cross-process index drain is async — the no-fold-lag guarantee holds only for
the committing process. State it normatively and check it at enablement/boot, or define
stale-index decision behavior. Also fix the dangling "already states" reference.

**CR-M9 — Risks & Mitigations section (standard compliance).** [STR-7] Consolidate the
scattered risk content and name the unnamed classes: prompt injection via bundle skill
content (state the implicit mitigation — per-invocation authority bounds what steered calls
can do), untrusted MCP tool names/schemas via tools.list, authority-index memory bounds,
mount-storm latency vs the activation timeout.

**CR-M10 — Naming and cross-reference consistency (contract-adjacent).** [COMP-1, STY-4,
STY9-6, STY-3, COMP-2] One prefix for the harness event family (§8 vs four body sections vs
item 25); one canonical gate list in §2.4 and item 1 (three named gates; "expert-eligible
catalogs" defined or renamed); capability-vs-bundle attribution (capability owns ids,
handlers, table entries; bundle owns payload/store/manifest).

**CR-M11 — Documentation-level comprehension majors.** [COMP-3, COMP-4, COMP-8, COMP-9,
COMP-11, STY-1, STY-2] Cite the baseline brief and gloss D2/D5/D6/WP6/OQ1/B5 at first use
(OQ1 collides with OQ-A/B); state the `requireUser` polarity and the user-kind masquerade;
expand SEA and define the SEA-Forge external-authority mode; define the six load-bearing
existing-system terms (skill OS, grant plane, fibers, execution world, expert, honesty
machinery); restore precedent anchors (one-line description + file); replace the
self-grading "honest" register (9 sites); pin or replace "promptly" in three CUJs.

## 🟢 Nits (grouped)

**Editorial/comprehension (COMP-12..26, STY-5..19, STY9-1..13):** CAS expansion; cordis
clause; E-phase/rev-43 gloss; §9.2→§9.3 repoints; §5.1 discovery-cost restatement
(subsumed by CR-M1b if the deletion branch is taken); operator-term normalization;
`ctx.allowances` rationale; Hallmark/Impeccable external-payload clause; item 21 mapping
notation; "bridge" naming in §7.2d; eight one-off glosses (identity seed, spending ceilings,
five core entries, trust twin, automation machinery, command input union, WSL probe,
component-count); `runOwnership` clause; flake-discipline pointer; two `safeMode.ts` files
(one module or named split — Z5-5); kernel-bridge in §10's net-new list; G2/G4/G6/G8 title
rewording; "frictionless" epithet; §2.5 absolutes scoped to v1; "richer" replaced; "largest
hidden item" rewording; "outright/normal" trimmed; "anti-slop" quoted or replaced;
"(reconciled)" residue; adapter named `lifecycleRecorder` in the Overview; "ceiling" reserved
for the authority concept; status line "Proposed — review-ready".
**Design nits (DES-14..20, STR-8..10, Z8-5, Z8-7, Z5-3, Z5-7):** deadlock rationale corrected
to the ordering hazard; mid-run skill-load records; spawn-intent carries secret references
only; signature kill scoped to version directories; uninstall write path + zero-live-activation
rule; "one decision function" related to the clamp; `resumed` fold behavior stated;
`PluginSource` consumer binding; inventory-as-tripwire sentence; long-lease cap deferred
(absorbed by CR-M1 scope decisions if adopted); recorder-discipline altitude moved to T1
notes.

## Traceability matrix

| Raw findings | Consolidated |
| --- | --- |
| IR-1 | CR-B1 |
| IR-4, CD-1 | CR-B2 |
| CD-2, IR-8, CD-8 (tranche parts) | CR-B3, CR-M5 |
| CD-3, IR-10b, Z8-2 | CR-B4 |
| Z8-8, Z8-9, Z8-10, Z5-1, Z8-6, Z5-3 | CR-M1 |
| DES-1, DES-3, DES-4, DES-6, DES-7, STR-1, STR-2, DES-9, DES-11 | CR-M2 |
| STR-4, Z8-3, DES-8, DES-10, DES-13, COMP-10, IR-12 | CR-M3 |
| STR-6, DES-12, STR-5, COMP-7 | CR-M4 |
| IR-5, CD-4, CD-5, CD-6, CD-7, DES-19, CD-10, COMP-2 | CR-M5 |
| IR-6, Z8-1, Z5-4, STR-8 | CR-M6 |
| IR-11, CD-11, CD-14, IR-9 | CR-M7 |
| DES-5, COMP-6 | CR-M8 |
| STR-7 | CR-M9 |
| COMP-1, STY-4, STY9-6, STY-3, COMP-2 | CR-M10 |
| COMP-3, COMP-4, COMP-8, COMP-9, COMP-11, STY-1, STY-2 | CR-M11 |
| COMP-12..26, STY-5..19, STY9-1..13, DES-14..20, STR-9, STR-10, Z8-5, Z8-7, Z5-5, Z5-7, Z5-8, IR-13, CD-12, CD-13 | Nits |
| Z5-2 (via Z8-10), STR-5 (surface half) | CR-M1c |
| IR-7 (items 18/23/25 unsettled) | CR-M1 |
| IR-10a, STY9-6 (event drift) | CR-M10 |
| CD-9 (P clamp inputs) | CR-M2b/c (P-scoped note) |
| CD-3 (substrate timing) | CR-B4 |
