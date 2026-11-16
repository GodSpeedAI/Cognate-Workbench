# Stage 7 — Critic Review (consolidated)

*   **Target:** `.agents/plans/capability-bundles/design.md` — FeatureRange 1–1062
*   **Reviewers:** egm-design + egm-structural (feature-spec standard), egm-style (copy) — fresh contexts, parallel
*   **Date:** 2026-11-08
*   **Severity totals:** 0 🔴 Blocker · 23 🟡 Major · 38 🟢 Nit

## egm-design findings

**DES-1. 🟡 Major — §1.3/§4.1 vs Alternative B: the stored activation ceiling is a stored intersection, contradicting the design's own prohibition.** The ceiling (an intersection of exactly the four D2-named inputs) is recorded durably on the activation row, while Alternative B rejects stored intersections and §2.1 says the index "holds the inputs, never a stored intersection." The mechanism is defensible (the ceiling is the activation's own bound; actor/context legs re-check live; revocation suspends via the CAS batch) but the reconciliation appears nowhere — an implementer reading Alternative B will refuse to store the ceiling or treat it as license to materialize full effective authority. **Fix:** one normative paragraph reconciling the activation ceiling with D2, stating the staleness rule (ceiling immutable; tightening requires new activation; live legs 2–3 govern).

**DES-2. 🟡 Major — §1.4 says level allowances are "in the index" but §2.1 defines the index as exactly two maps that exclude them.** The read path for a normative predicate leg is undefined; §8's invalidation matrix references a state the index cannot hold. **Fix:** amend the index to three maps, or fold allowances into the grants map.

**DES-3. 🟡 Major — §2.3 row 3 promises "per-principal grants where a grant exists" for direct built-in invokes; §1.6.v defines only a static allowlist.** No mechanism for the grant half. Related: the agent-branch membership rule is missing — the loop itself invokes `filesystem.*`, `risk.assess`, `subagent.start`, `case.observe`, `session.history`, `tool.*` as the run's actor, so an allowlist of literally {model generation, dispatcher} breaks every native tool call. **Fix:** define the membership rule (loop-invoked built-ins in; governance/operator-only ids out) and state whether the policy reads grants.

**DES-4. 🟡 Major — §2.1A's approval composition is ambiguous about which human-continuation gates an authority "allow" pre-empts; "approval parks" also conflicts with CUJ 4's blanket refusal.** The loop's parking gates include mode-based `approvalGate`, read-only-Expert override, and RiskPreflight/Sentinel destructive-command mediation — risk gates, not authority gates. If allow pre-empts them, grant-covered `bash` in plan mode executes `rm -rf` without Sentinel mediation. **Fix:** authority-allow pre-empts only the authority-plane continuation; mode/risk gates always still park; specify the park-vs-refuse mapping per operation class (see DES-6).

**DES-5. 🟡 Major — §1.5 cites "the single-process assumption this design already states" but the design never states it; under external PostgreSQL the no-fold-lag guarantee degrades silently.** The Postgres store is multi-process; cross-process index drain is async LISTEN. **Fix:** state the deployment invariant normatively (single committing process, checked at enablement/boot) or define stale-index decision behavior.

**DES-6. 🟡 Major — The beyond-grant outcome mapping is internally inconsistent and the D2 reconciliation is unrecorded.** CUJ 4: every beyond-grant attempt refused; §2.1A: approval outcomes park (functionally D2's authorization request); §1.2's Activate kind defines no outcome when neither path exists; D2's "inactive draft" option is silently dropped. Likely intent: invocation attempts refuse; activation/creation requests park; no drafts. **Fix:** settle the per-authority-kind outcome table and record it as the D2 reconciliation.

**DES-7. 🟡 Major — Grant mutability is unspecified; the index is event-fed and record-only commits fire no listeners.** A permission-narrowing record mutation outside the event families desynchronizes the authority index invisibly. **Fix:** grants immutable (change = revoke + reissue) or add an update family through the lifecycleRecorder.

**DES-8. 🟡 Major — Conflict detection pinned to the activation commit, but a repoint can introduce co-activity conflicts no transition checks.** A new version's `owns` data can claim a surface another co-active capability owns. **Fix:** repoint re-runs the conflict check against live bindings (already a CAS commit point).

**DES-9. 🟡 Major — No deadline/timeout contract for in-flight handler calls; the drain invariant depends on their termination.** Hung MCP/framed call pins the counter forever; old handles and old-version processes leak; reverse-orphan reconciliation stalls. **Fix:** per-call deadline at the dispatcher/MCP-client layer (kernel `deadline_exceeded` envelope shape), expiry decrements the counter.

**DES-10. 🟡 Major — The source-reading rule contradicts itself across §4.2.3, §4.2.8, §4.4.** "The source is never read again" vs "re-materialized on demand" vs the governed re-hash which must read it. Unsafe misreading reintroduces the source as an unvalidated trust input. **Fix:** the recorded version's materialization source is never consulted for loading or integrity; the authoring location is read only by a fresh governed registration.

**DES-11. 🟡 Major — The restart fate of session-scoped activations is unspecified despite the baseline demanding it explicitly.** §4.2.8's "mount the active set" reads as restoring them, contradicting the baseline glossary ("ends at session end or restart"). **Fix:** state the boot rule (recommended: boot reconciliation expires every session-bound activation, fold-written, before mount).

**DES-12. 🟡 Major — The baseline's "catalog-size scaling check" evidence requirement is dropped without record.** No journey exercises descriptor budget behavior at catalog scale. **Fix:** add a scaling variant (j_cap_create or j_cap_persist with a large synthetic catalog) or record the delegation explicitly.

**DES-13. 🟡 Major — §1.6.iii aligns the scattered operator-only checks in place instead of the data-driven one-point surface the baseline directs.** The rot vector (next handler copies the wrong shape) remains. **Fix:** declared operator-only capability-id set refused at the single policy point, or record why alignment-only suffices for v1.

**DES-14. 🟢 Nit — §1.5's deadlock rationale is factually wrong** (promise-chain queue, not a held mutex — a listener commit would be deferred, not deadlocked). The rule is right for a different reason (ordering vs the commit-synchronous invariant). Fix the rationale.

**DES-15. 🟢 Nit — §3.2 "nothing mutates a running run" vs §5.1 mid-run descriptor refresh.** Carve the exception explicitly; add descriptors to §3.2's inventory; state tool availability is unaffected.

**DES-16. 🟢 Nit — How mid-run skill loads land in `workbench.harness.assembled` is unspecified** (re-emit per re-assembly, or loads carry their own records).

**DES-17. 🟢 Nit — §6.3's spawn-intent record must carry secret references only** (resolved values would leak into the durable log).

**DES-18. 🟢 Nit — Boot-sweep signature kill undefined; bound it to version-directory-scoped signatures.**

**DES-19. 🟢 Nit — The kernel-observation bridge's write path is unnamed** (non-run context; a new always-on recorder the §9.2 inventory must account for).

**DES-20. 🟢 Nit — `capability.uninstalled` sits outside the five CAS-atomic families; uninstall-vs-active racing rests on implicit fold refusal.** State the write path and rule (uninstall requires zero live activations, or suspends-then-uninstalls in one batch).

## egm-structural findings

**STR-1. 🟡 Major — Activation row vs ladder join under-specified (§4.1, §2.1).** (1) The published-path join never says *which implementation's* ladder row gates when a capability has more than one — not a total function on the implementation dimension. (2) The index key admits multiple simultaneously active rows per capability (persistent + session-scoped, CUJ 9 requires both distinct), but §1.4 never defines the row-selection rule (any-match, most-specific-wins, ceiling intersection?). **Fix:** state the join as an explicit total function — which ladder row gates the published path, which activation row(s) a decision consults.

**STR-2. 🟡 Major — The `expired` symbol is overloaded three ways and the expiry write path is unspecified (§1.5, §4.1, §8).** (a) suspension reason member, (b) terminal retirement state, (c) archive tombstone — but grant expiry routes through the revocation batch (no non-terminal suspension carries reason `expired`), and if the tombstone is fold-derived nothing is written while the five CAS families contain no session-expiry family. §8's totality claim cannot be discharged for the expiry cell. **Fix:** distinguish the three senses; name the mechanism (fold-derived terminal state vs recorded tombstone) per cause.

**STR-3. 🟡 Major — The index's invalidation closure has open inputs.** (1) Level allowances: no index home (same as DES-2); corollary — the ceiling bakes allowances in at activation, so a post-activation tightening is caught only if the live leg reads current allowances, requiring the missing structure. (2) `session.activation` has no stated index effect though the index keys activations by session binding. (3) `workbench.safemode.cleared` has no stated effect on the `safe-mode` suspension reasons the manual clear must lift. **Fix:** the two-direction table §8 promises — family → index effect for every family; decision input → producing family for every input.

**STR-4. 🟡 Major — Two-tier boundary: two bundle-data vocabularies the adapters interpret are never enumerated.** (1) Presentation payload `{slotId, schemaVersion, payload}` — the payload's *content* schema is never defined; an unrestricted payload is bundle-directed behavior in-process via the renderer. (2) "Data operations via the adapter interpreter" (`<capabilityId>.<operation>`): the vocabulary appears nowhere — an open-ended interpreter is a generic executor of bundle-directed operations, the channel the model exists to close. **Fix:** both vocabularies closed, app-owned, enumerated, with registration-time validation. Nit sub-point: state that the framed protocol refuses server-initiated requests (sampling/roots).

**STR-5. 🟡 Major — CUJ-to-contract coverage gaps.** Model routing and workflows (two declared surfaces) have no exercising CUJ; the §1.7 enablement gate's refusal path (marker absent → enable refuses / bundles never mount) is asserted nowhere; grouped nits: mid-session reverse orphan, install-time satisfiability refusal, schema-validation refusal + tools.list, governance-mode refusal, pruning, over-budget truncation; CUJ 4's alternate-path list omits `session.harness.bind`. **Fix:** add CUJ variants or record the delegation.

**STR-6. 🟡 Major — §8's totality claim rests on a matrix the document does not contain.** Arrow 1 (create/author) names no family; boot-sweep outcomes (`reconciled-unknown`) map to no family; partial-materialization handling names no event; activation-machine transitions unspecified (re-suspend while suspended, repoint-while-suspended, deactivate-from-suspended, uninstall-while-active). Totality is asserted, not shown. **Fix:** present the matrix (even as a table).

**STR-7. 🟡 Major — Standard compliance: no Risks & Mitigations section.** Risk content scattered; risk classes never named: prompt injection via bundle skill content (the implicit mitigation — per-invocation authority bounds what steered calls can do — never stated), untrusted MCP tool names/schemas via tools.list, authority-index memory bounds, mount-storm latency vs the activation timeout. **Fix:** consolidated section.

**STR-8. 🟢 Nit — "The kernel's activation timeout is 30 s" is wrong as written** — the timeout is adapter-supplied per mount (`waitFor` default 2000 ms; ActivationTimeoutError carries the caller's value; ProviderRegistry uses 5000). 30 s is the dispatcher's choice, not a kernel property.

**STR-9. 🟢 Nit — "One decision function" coexists with two decision formulas at point A** (the §1.6.i clamp for built-in tools, §1.4's five-leg predicate for dispatcher ids). One sentence relating them (the clamp as the built-in-tool shape of the same predicate).

**STR-10. 🟢 Nit — `resumed` clearing one reason from a non-empty set: the fold behavior (row stays suspended) is derivable but unstated.**

**Code spot-checks:** all load-bearing claims verified (store CAS on both backends, SSH honesty, hot-swap, Principal.kind, static gates and fallthrough, verbatim args recording, unmatched-row refusal, containment lease shape, no error boundaries, InspectorTab, harness actor-check absence, sandbox_permissions, coalescing, static buildPolicy).

## egm-style findings

**STY-1. 🟡 Major — Self-grading "honest/honestly" register (9 occurrences)**: G7 title, CUJ 3, CUJ 5 title, §2.2, §2.3 row 9, §3.1 title, §6.2, §7.1, §10 — grade the design's own candor instead of stating the property. Keep "honesty machinery" (repo artifact) and "observation-honesty" if a term of art; elsewhere state the mechanism ("recorded as observed", "net-new, named in §10").

**STY-2. 🟡 Major — Unmeasurable "promptly" in three acceptance criteria** (CUJ 3, CUJ 5, CUJ 12: "managed processes stop promptly"). Pin a bound or replace with "per the §6.1 stop discipline, outcome recorded."

**STY-3. 🟡 Major — Capability/bundle attribution drift**: the Overview defines capability (user-facing) vs bundle (packaging), then attributes identifiers to both — "bundle ids" in the diagram vs the allowlist `GRANTED_CAPABILITIES`, "bundle handlers", "bundle capability ids" — while §2.5 keys handlers by `<capabilityId>`. **Fix:** capability for ids/handlers/table entries; bundle for payload/store/manifest.

**STY-4. 🟡 Major — Event-family name drift**: `workbench.harness.assembled` (CUJs 1/11, §3.2, §5.2) vs §8's `capability.harness.*`. Journeys assert by event string — reconcile before the verification plan pins assertion strings. (Cross-routed to the substantive reviewers: same catch as comprehension finding 1.)

**STY-5..19. 🟢 Nits** — G2 doublet ("deliberate, coordinated") and brochure noun ("experience"); "uniformly" doublet (G4, CUJ 11); "first-class affordance" title (state the mechanism); G6 headline "scale" unmeasurable; "frictionless flow" epithet (twice verbatim); "genuinely…ever" absolute in §2.5 (scope to v1); vague "richer" (G8, §7.1); "largest hidden item" (§2.2); "outright defect"/"normal, governed mechanism" (Problem); "anti-slop" informal register (mark as quoted or replace); "not merely" construction (G6, §5.3); "(reconciled)" drafting residue (§6.2 heading); two names for one adapter (Overview vs `lifecycleRecorder`); "ceiling" overloaded four ways (reserve for the authority concept; "cap"/"budget" elsewhere); status line "Proposed — finalized" contradiction.

**Overall (style):** the no-glazing discipline largely held — no "leverage/seamless/robust", no filler connectives, alternatives argued on facts, spec quantifiers rather than hyperbole. What survived: the self-grading "honest" register, one unmeasurable adverb in acceptance criteria, and two naming drifts routed to the substantive reviewers.
