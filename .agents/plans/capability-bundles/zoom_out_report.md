# Stage 5 — Initial Zoom Out Review

*   **Target:** `.agents/plans/capability-bundles/design.md` (full file, lines 1–1216)
*   **Reviewer:** egm-zoom-out (fresh context), Zoom-Out Standard
*   **Baseline:** `concepts_brief.md` (D1–D7 + owner direction treated as settled)
*   **Date:** 2026-11-08

Context sufficiency: passes. All load-bearing precedent claims verified against the codebase
and framework packages before judging (store conditional-commit + conformance, the defect
cluster, tool-loop seams, kernel fiber/effects/Scope.child, ProviderRegistry hot-swap,
containment lease shapes, SSH/hostProcess termination, absence of error boundaries and of any
MCP client, `docs/known-gaps.md:225`).

## Findings

**Z5-1. 🟡 Major — YAGNI (over-build within settled scope)**
**Scope:** §1.3, §1.4, §8 (`authority.level.allowances.set`), T1 item 18.
The durable, operator-editable level-allowance record family is machinery no CUJ configures
and no journey exercises. Two implemented levels + a reserved fail-closed work-group key;
static app-owned constants for the implemented levels satisfy the ceiling formula's level leg
and CUJ 9's observability requirement with zero new machinery — and the fail-closed empty
default likely makes CUJ 9 unpassable without an unjournaled operator setup step. Smallest
version: hardcode the two levels' allowances; introduce the editable family when a real
reconfiguration need arrives.

**Z5-2. 🟡 Major — YAGNI (surface shipped with no journey)**
**Scope:** §3.1 (model routing constraints), G4, T2 items 23/25.
CUJ 11 exercises an instruction patch and a toolset override; no journey registers a route
constraint. Routing constraints ship record types, validation, precedence composition, and
resolver integration with no asserted evidence — the same deferral logic the design applies
to preset registration (Alternative H) and presentation slots. Smallest version: declare
routing a surface kind and refuse it at validation in v1, or defer entirely. Workflows are
fine (existing machinery).

**Z5-3. 🟢 Nit — premature concurrency bound**
**Scope:** §6.2 long-lease slot class. A per-world cap introduced without an observed storm,
against the brief's own item-11 discipline; the process count is already bounded by
operator-gated activations. Exempt long-lived processes from slot accounting in v1, record
the exposure, add the cap on evidence.

**Z5-4. 🟢 Nit — undeclared net-new engineering**
**Scope:** §2.5 schema validation; §10 inventory. No JSON-Schema validator exists in the app
or dependencies (verified); §10's net-new list omits it and no library-vs-hand-rolled
decision is recorded. Name it and choose the path.

**Z5-5. 🟢 Nit — right-placement**
**Scope:** T4 items 33/34 — two files named `safeMode.ts` in different layers. One module is
simpler to reason about and test.

**Z5-6. 🟢 Nit — internal tension**
**Scope:** §5.1 mid-run descriptor delivery vs §3.2 "nothing mutates a running run
mid-flight." Both CUJs assert discovery through a subsequent run; mid-run delivery is
model-visible surface mutation no journey asserts. Assemble at run start only, or reconcile
the two regimes in one explicit paragraph.

**Z5-7. 🟢 Nit — altitude drop**
**Scope:** §1.5 recorder-discipline paragraph is implementation-plan altitude inside an
architecture section. One sentence in the architecture; move the rest to T1 notes.

**Z5-8. 🟢 Nit — context sufficiency polish**
**Scope:** §7.2c "B5 budget/watchdog detectors", "rev 43", "E-phase", "OQ1 (rev 42)"
shorthand without in-document gloss. One-line glosses suffice.

## Checked and found sound

Commit-synchronous authority index (smallest mechanism meeting committed-event visibility);
narrow lifecycleRecorder over the store's existing API; per-version in-flight counters /
drain-then-dispose; MCP client as net-new (nothing reusable exists, verified); immutable
version directories; §1.6 prerequisite + enablement gate; Alternatives A–J grounded in
verified facts; reuse posture throughout; root-problem focus intact (G1–G11 trace to brief
decisions; non-goals enforced in the plan).
