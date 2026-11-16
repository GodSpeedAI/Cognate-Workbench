# Stage 8 — Intermediate Zoom Out Review

*   **Target:** `.agents/plans/capability-bundles/design.md` (full file, lines 1–1216)
*   **Reviewer:** egm-zoom-out (fresh context), Zoom-Out Standard, second pass
*   **Baselines:** Stage 5 report + Stage 6/7 finding lists; `concepts_brief.md` (D1–D7 settled)
*   **Date:** 2026-11-08

## (a) New findings — not surfaced in Stages 5–7

**Z8-1. 🟡 Major — The MCP protocol client is hand-rolled with no library decision recorded.**
§2.2/§10/T3 item 27. The largest net-new cost is a bespoke implementation of a standard,
versioned wire protocol; the official MCP TypeScript SDK supports custom transports, so a
transport adapter over the execution-world ports is feasible. The JSON-Schema question got an
explicit decision obligation (Z5-4); this is the same decision class and it gates T3 sizing.
Smallest version: record a library-vs-hand-rolled decision with the transport-adapter and
honesty-wrapping constraints; hand-roll only if the SDK demonstrably cannot run over
provider-port streams.

**Z8-2. 🟡 Major — The negative-proof evidence chain has no emitter for backstop refusals.**
CUJ 4 asserts every refusal recorded in `authority.decision.recorded`; §8 names emitters A,
the dispatcher, and the spawn boundary — but the §2.3 rows 3/8/9 refusals (§1.6.v static-
policy branch, subagent narrowing, `harness.bind` convention) fire at the static kernel
policy or as bare handler-convention throws (verified: today `requireUser` throws an
unrecorded `Error`). The negative cases that justify the design — and feed the enablement
gate's evidence — are asserted against records no section says are written. Fix without new
machinery: name the backstop points as `authority.decision.recorded` sources (a policy-
refusal hook at the app-side branch; convention checks converted to recorded refusals), or
amend CUJ 4 to state per-row where each refusal is observable. Settle before implementation.

**Z8-3. 🟡 Major — Harness overlap has two regimes but no rule assigning surfaces to them.**
§3.3 owns conflict refusal at activation via `detectConflicts` (verified exclusive-ownership
over `owns` — binary refusal, no precedence concept) and separately declares "composable
patches apply in deterministic precedence." Nothing says which surface kind maps to which
regime, nor what happens to two `replace` patches on one instruction section, or two
overrides of the same preset. CUJ 11's "or" is the ambiguity restated. Fix: one sentence per
surface kind (instruction-section patches compose in precedence; toolset overrides per preset
are exclusive), or simplify to one regime.

**Z8-4. 🟡 Major — `workbench.harness.assembled` writes an unbounded per-run blob into the
sole durable authority.** §8 bounds dispatcher sub-tool arguments but the resolver records
the full effective instruction set, toolset, routing, and descriptor section on every run —
and every subagent child is a run. Per-run prompt-sized records permanently raise fold, boot,
and replay-equality test cost. Smallest version: record the assembled configuration by
reference (section hashes + deltas against the base preset) or truncate, with full text
recorded once per re-assembly.

**Z8-5. 🟢 Nit — The directory source implements a seam whose namesake consumer the same
design retires.** Item 35's `PluginSource` implementation needs one sentence binding the
source contract to the bundle ingestion path once `plugin.install` is retired (the D7 shape
commitment preserved under capability vocabulary).

**Z8-6. 🟢 Nit — The operator root grant record is Z5-1's over-build on the operator side.**
With one operator and no RBAC rollout, a static app-owned constant suffices for v1; the
durable root grant arrives with the RBAC path. Compounds Z5-1: three of the ceiling's four
legs reduce to constants in v1.

**Z8-7. 🟢 Nit — The grep-pinned inventory is a tripwire inside a design that rejects
test-enforced boundaries.** Compatible — the boundary is structural, the inventory is a
regression tripwire for new call sites — but say so in one sentence.

## (b) Mitigation interactions — the recorded fixes conflict; branch decisions required

**Z8-8. 🟡 Major — Z5-1's fix and DES-2/STR-3(1) are mutually exclusive as literally
written.** Hardcoded allowance constants (Z5-1) make DES-2's index amendment a constant
behind a cache and STR-3(1)'s tightening scenario impossible; editable allowances make
STR-3(1)'s hazard live with no staleness rule (ceiling bakes allowances at activation while
§1.4 reads them live — which wins?). **Coherent synthesis: apply Z5-1** — strike
`authority.level.allowances.set` from §8 and item 18, amend §1.4's clause to "structural
constants," mark DES-2/STR-3(1) dissolved, and CUJ 9 becomes passable without an unjournaled
setup step. The editable family returns when a reconfiguration journey exists.

**Z8-9. 🟡 Major — Z5-6 and DES-15 prescribe opposite resolutions of the §3.2/§5.1 tension,
and §2.5 is load-bearing on the losing side.** DES-15 legitimizes mid-run descriptor
delivery; Z5-6's first option deletes it. The text bakes in the mid-run regime (§2.5's
next-turn story, the dirty-flag machinery) while no CUJ asserts mid-run delivery — all CUJs
assert discovery through a subsequent run. **High-altitude resolution: take the deletion
branch — run-start-only assembly** removes §3.2's only needed exception, deletes the
dirty-flag machinery, and still passes CUJs 1, 2, and 11. If next-turn hot-load visibility
is wanted instead, DES-15's carve-out must be written and the machinery kept knowingly.

**Z8-10. 🟡 Major — Z5-2's fix applied as written contradicts G4 and half of STR-5.**
"Declare routing a surface kind and refuse it at validation" is dead configuration. Clean
application: remove routing from the v1 surface list, delete item 25's routing record types,
record the surface kind as post-v1 — which also dissolves the routing half of STR-5.
Symmetrically, workflows equally has no exercising CUJ; the same deferral logic extends to
it. **Result: v1 harness surfaces = exactly the two CUJ 11 exercises (instruction patch +
toolset override); G4 claims two surfaces, not four.** Scope shrink the finding set
independently justifies twice.

No conflict otherwise: Z5-3's exemption shrinks §6.2 cleanly; the editorial and additive
fixes compose; DES-7 (immutable grants), DES-11 (boot expiry of session bindings), DES-13
(one-point operator-only surface) are consistent with the CAS families, the session-binding
semantics, and correction 4.

## (c) Closing judgment

**The core mechanism survives as the smallest coherent one for its contract** — verified:
store conditional-commit (conformance-proven) makes the lifecycleRecorder the minimal write
path; the two-map commit-synchronous index the minimal read path; the static gates and
zero-subscriber kernel events confirm the dispatcher-sole-route topology needs no kernel
change; version directories carry the rollback guarantee without a second store. No finding
attacks that spine.

What the accumulated set changes is the periphery, consistently in one direction: **v1
repeatedly ships affordances no journey exercises** — editable level allowances, routing
constraints, workflows, mid-run descriptor refresh, long-lease caps, the durable operator
root grant. Applying the branch decisions above deletes three pieces of machinery and two
surfaces without touching any CUJ. Scope is right in the main line, but the design should
not proceed until the mitigation branch decisions (Z8-8/9/10) are made and the two
implementation-blocking evidence items (Z8-2 backstop refusal records, Z8-4 assembled-record
bound) are settled in text.
