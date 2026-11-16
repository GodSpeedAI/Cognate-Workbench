# Stage 6 — Comprehension Test

*   **Target:** `.agents/plans/capability-bundles/design.md` — FeatureRange 1–1062, DetailedRange 1063–1216
*   **Reviewer:** egm-comprehension (fresh context, direct dispatch, no document standard)
*   **Date:** 2026-11-08

Reviewer result written verbatim below.

---

# Comprehension Goldfish — REVIEW of `.agents/plans/capability-bundles/design.md`

**Mode:** REVIEW · **Ranges audited:** FeatureRange lines 1–1062, DetailedRange lines 1063–1216 · Baseline brief read for grounding only; findings judge the design document's self-containment for a naive-but-technical reader (new developer or single operator).

No section defeated paraphrase outright, so there is no 🔴 Blocker by the persona's rule. The failures below are internal contradictions, dangling vocabulary imported from an unreferenced baseline, and load-bearing terms the document uses without ever defining.

## What this proposes

The Workbench gains a governed in-session extension mechanism: capabilities — skills with composition guides, MCP server declarations, harness modifications, presentation fragments — packaged as bundles, which operators and granted agents can create, compose, install, modify, and use without a restart. A new trusted, app-owned dispatcher is the sole route to bundle functionality: it holds a version-keyed handler table of app-owned adapters that interpret bundle *data*, while bundle-authored executable code never runs in-process — it runs only as spawned, contained processes through execution-world (local/SSH/WSL) ports under a per-provider containment matrix, with a record-before-spawn ledger. Authority originates in durable grants attached to per-agent principals; an activation computes a ceiling once (declared requirements ∩ clamp grant ∩ operator permissions ∩ level allowances) and every invocation is re-checked live against a commit-synchronous authority index, with every decision and refusal durably recorded. Lifecycle transitions (register, activate, re-point, suspend/resume/deactivate, grant revocation/expiry, runtime enable) commit CAS-atomically through the store's existing conditional-commit API via a narrow `lifecycleRecorder` adapter, so a yank is an immediate suspension visible at committed-event visibility, with immutable version directories guaranteeing rollback payload availability. Because the current system lets agents declare their own authority and hides it via a shared `system` caller, a prerequisite tranche (P) first remediates that defect cluster; a coordinated SEA model migration (M) then retires the Plugin entity and unifies plugins and skill-OS capabilities into one capability model with ten canonical journeys covering the thirteen CUJs; implementation then proceeds T1 (recorder, index, bundle store) → T2 (dispatcher, activation, loader, harness modification) → T3 (MCP client, spawn boundary) → T4 (presentation, safe mode, sources), each tranche gated by `just verify`, with a verification plan built on journey suites, replay-equality, grep-pinned call-site inventories, and CAS concurrency tests.

## How the existing system works, per this document

Today extension is release-bound: the plugin catalog is compiled into the app, so "installing" only activates code the app already ships, and the `PluginSource` seam has no marketplace or directory implementation. The skill OS is a registry without an execution plane — `skill.register` records events, `canInvoke` gates no invocation path, and components mount at boot from a static list — so no registered capability ever reaches a live, invocable surface. Harness behavior (skills, prompts, tool compositions, model routing) is code that cannot change mid-session, and nothing an agent creates can enter a session. Authority is caller-declared and identity-collapsed: `task.create` accepts contract `authority` scopes that `authority.check` honors (for edit/bash only), unbound runs default to `ALL_ALLOWED`, every agent-initiated run executes as the shared `system` caller, and `requireUser` checks only actor kind — so human-gated surfaces are reachable from agent runs. Beneath this sit durable foundations the design reuses unchanged: the workbench event log with a store offering conditional commit (per-record `expectedVersion` CAS), a kernel with a static capability allowlist and a mount/hot-swap discipline, provider-ported execution worlds (local, SSH, WSL) with existing containment machinery, a secret store, approval machinery, and the SEA interaction model as the authoritative catalog.

## Findings

**1. 🟡 Major — The normative event-family list contradicts every other use of the harness event names**
- Affected scope: §8 (`capability.harness.patched | harness.assembled`) vs §3.2, CUJ 1, CUJ 11, §5.2 (`workbench.harness.assembled`), Detailed Plan item 25 (`workbench.harness.patched`).
- Discrepancy: §8 is the normative family list the folds and journeys are built from, yet it is the sole place using the `capability.harness.*` prefix; four body sections and one implementation item use `workbench.harness.*`. A reader cannot tell whether these are two families or one misnamed.
- Ergonomic requirement: pick one prefix and reconcile §8 with the body and item 25; the normative list must match every assertion made against it.

**2. 🟡 Major — Dispatcher tool-id insertion is described with two different gate lists, and the prerequisite wires routing to a component that does not exist yet**
- Affected scope: §2.4 vs Detailed Plan item 1; item 22 (T2).
- Discrepancy: §2.4 says the one-time code adds the ids to **three** gates — `TOOL_DEFS`, `PRESET_TOOLS`, `GRANTED_CAPABILITIES`; item 1 says the same change targets `TOOL_DEFS`/`PRESET_TOOLS`/"expert-eligible catalogs" (itself an undefined gate name). Both cannot be the canonical list. Separately, tranche P lands tool ids and "one loop branch routing them to the dispatcher's decision" before the dispatcher is built in T2; the document never says what a dispatcher-tool call resolves to in the interim.
- Ergonomic requirement: one canonical gate list (same names, same count) in both §2.4 and item 1, plus a sentence stating the fail-closed behavior of dispatcher ids between P and T2.

**3. 🟡 Major — Decision vocabulary imported from a baseline the document never references: D2/D5/D6, WP6, OQ1, B5**
- Affected scope: "refused per D5", "D2's frictionless flow", "(D6)", "WP6", "OQ1, rev 42", "the B5 budget/watchdog detectors", header/footer EGM references.
- Discrepancy: the document never mentions `concepts_brief.md`, yet uses its owner-decision numbers (D1–D7), a work-package number (WP6), and "OQ1" — which collides with this document's own OQ-A/OQ-B namespace. "B5" is an opaque label attached to the boot-readiness detector safe mode depends on. None of these keys resolve anywhere in the document.
- Ergonomic requirement: cite the baseline brief explicitly in the header, expand each D-ref at first use or provide a one-line key, rename OQ1 to avoid the OQ-A/OQ-B collision, and give B5 a real name or pointer.

**4. 🟡 Major — The human-gate defect and its fix are not derivable from the text alone**
- Affected scope: Problem #4, §1.6.iii, Detailed Plan item 2.
- Discrepancy: the document says `requireUser` "checks only `ctx.actor.kind !== "user"`" and that this makes human-gated surfaces reachable from agent runs. That causal claim only holds if the shared `system` caller masquerades as a user-kind actor — never stated — and the polarity of the predicate (refusal condition vs allow condition) is never stated, so two opposite implementations of `kind !== "user" || ctx.runId` both satisfy the text. This is the security-critical remediation whose evidence gates the entire enablement predicate (§1.7).
- Ergonomic requirement: state the predicate's polarity ("the expression is the refusal condition") and the masquerade mechanism in one sentence each at first use.

**5. 🟡 Major — Directory ingestion is placed in three different tranches**
- Affected scope: §9.5 vs item 19 (T1), item 35 (T4), T4 header, plan intro.
- Discrepancy: §9.5 bundles "directory ingestion" with the skill-loader step and justifies it ("loader payload journeys depend on ingestion"); the Detailed Plan puts ingestion helpers in T1's `bundleStore.ts` and the directory `PluginSource` in T4 — while the plan's intro omits "sources" from T4's summary and the T4 header includes it. A reader cannot reconcile the sequencing authority with the plan that claims to follow it.
- Ergonomic requirement: one sequencing statement reconciling payload materialization helpers (T1), the directory source connection (which tranche), and §9.5's loader-step phrasing.

**6. 🟡 Major — Unverifiable back-reference: "the single-process assumption this design already states"**
- Affected scope: §1.5.
- Discrepancy: no single-process assumption is stated anywhere earlier in the document. The reader is asked to accept a scoped correctness guarantee on the strength of a statement they cannot find.
- Ergonomic requirement: state the assumption inline where first relied on, or point to the section that states it.

**7. 🟡 Major — CUJ 13 asserts the wrong failure family against §4.3's totality rule**
- Affected scope: CUJ 13 vs §4.3 and §8.
- Discrepancy: §4.3's rule is "every failure mode maps to exactly one event family," and a failed hot-reload replacement is a repoint failure (`capability.repoint_failed`); CUJ 13 asserts the failure is "recorded in the `capability.activation_failed` family." Journeys assert event families, so the negative proof is pinned to a name the normative mapping contradicts.
- Ergonomic requirement: align CUJ 13's assertion with the family §4.3 assigns (or explicitly define `activation_failed` as the umbrella and say so in §4.3).

**8. 🟡 Major — "SEA" is never expanded, and "SEA-Forge external authority" has an ambiguous referent**
- Affected scope: G2, G11, §2.4, §9, Detailed Plan item 7.
- Discrepancy: the migration's central mechanism ("SEA migration," "SEA model change") is never defined or linked. §2.4's "when the SEA-Forge external authority is enabled, bundle invocations are refused in v1" turns on a term the reader cannot resolve: modeling tooling, or a runtime governance mode?
- Ergonomic requirement: expand SEA once at first use with a pointer to the model file, and one line stating what SEA-Forge's external-authority mode is and where it lives.

**9. 🟡 Major — Load-bearing existing-system vocabulary used without definition**
- Affected scope: "skill OS", "grant plane", "fibers", "execution world", "expert"/"expert assignment"/"orchestrator expert", "honesty machinery".
- Discrepancy: all are project-specific subsystem names the whole design stands on, yet none is defined, glossed, or anchored. Misreading them changes the model in §1, §2.3, §6, §7.
- Ergonomic requirement: define each at first use in one clause, or add a short "existing system" glossary adjacent to §0.

**10. 🟡 Major — "Execution posture" is a load-bearing refusal input but is never defined as a mechanism**
- Affected scope: CUJ 3, §6.2, §2.3 row 9.
- Discrepancy: the containment contract's central escape hatch — refuse "unless the operator's execution posture explicitly and accurately permits the weaker posture" — branches on a posture whose storage, setter, granularity (per world? per payload?), and "accurate" criterion are never specified.
- Ergonomic requirement: define the posture record (scope, owner, how the operator sets it) and what its contents must say for "explicitly and accurately" to be satisfiable.

**11. 🟡 Major — "Precedent" names justify feasibility with no anchors or descriptions**
- Affected scope: provider hot-swap (§0), aggregate-containment wrapper (§2.1C), `reconcileContainmentAtBoot`/unmatched-row (§4.2), `fiber.state` (§4.3), `hostProcess` (§6.2), `InspectorTab`/`pluginViews` (§7.1), `workspaceFiles` guards (item 19), `Scope.child` (§1.1).
- Discrepancy: the feasibility argument rests on named in-app precedents, but none carries a file anchor or a one-line description; the baseline brief had `file:line` anchors and this document dropped them.
- Ergonomic requirement: restore one-line description + file anchor per precedent, or collect them in a precedents table.

**12. 🟢 Nit — "CAS" unexpanded at first use** (line 66; mechanism only at §1.5). Expand once.
**13. 🟢 Nit — "cordis" unexplained** (Non-Goals). One clause: the framework beneath the Cognate kernel.
**14. 🟢 Nit — "E-phase" and "rev 43" assumed.** One line defining the release-line convention with a pointer to the status ledger.
**15. 🟢 Nit — Replay-mapping cross-references point at §9.2; the mappings are in §9.3** (G2, CUJ 7). Repoint both.
**16. 🟢 Nit — §5.1's discovery cost sentence is cryptic and shifts units** ("assembled per run" vs "next turn boundary"; "pays once"). Restate which turns include the section, when re-assembly fires, and what "pays once" counts.
**17. 🟢 Nit — "Operator" shifts meaning** ("non-operator levels", "operator ceilings" vs operator-as-principal; operator↔user-kind bridge unstated). Normalize.
**18. 🟢 Nit — §1.4's `ctx.allowances` leg duplicates the ceiling's allowance input without rationale.** One sentence on why workspace-bound scopes are re-checked per call.
**19. 🟢 Nit — Hallmark/Impeccable's status as external example payloads is only implicit.** One clause at first use.
**20. 🟢 Nit — Item 21's "(CUJ 1, 11 data)" shorthand is ambiguous** (CUJ 11 has its own j_cap_harness). Spell out what data j_cap_create carries for CUJ 11.
**21. 🟢 Nit — "render/bridge boundary" uses an undefined "bridge"** (§7.2d). Name the component.
**22. 🟢 Nit — Secondary one-off undefined references:** "identity seed", "spending-ceiling machinery", "the five core entries", "trust-boundary twin", "the automation machinery", "command input union", "WSL probe", "component-count contract". One-clause gloss or file anchor each.
**23. 🟢 Nit — Recorder discipline assumes the store's run-stream fencing knowledge** (what `runOwnership` guards and why routing around it). One clause.
**24. 🟢 Nit — Unlinked "documented" discipline in the Verification Plan** (host-concurrency flake classification). Add the pointer.
**25. 🟢 Nit — Two `safeMode.ts` files with different responsibilities.** Rename one or state the split explicitly.
**26. 🟢 Nit — The kernel-observation bridge is v1 work but absent from §10's net-new inventory.** Add it.
