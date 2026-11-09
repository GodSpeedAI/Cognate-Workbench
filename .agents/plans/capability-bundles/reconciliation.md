# Reconciliation matrix — consolidated review → design.md revision 5

Every blocker and major group from `consolidated_review_report.md`, with its disposition,
the location changed, and the evidence or test that closes it. Deferrals name a milestone
and confirm no v1 guarantee depends on them. Source: owner reconciliation direction
(2026-11-08).

## Blockers — all accepted, all resolved

| ID | Disposition | Changed in | Closed by |
| --- | --- | --- | --- |
| **CR-B1** (OQ-A numbers unpinned) | **Accepted** | design.md §4.2.2, §4.4, §5.1, Verification Plan; `verification.md` pinned table | Pinned with justification: descriptor ≤ 400/capability and ≤ 4,000 aggregate tokens; payload ≤ 512 KiB/file, ≤ 5 MiB/bundle, ≤ 200 files; retention active + 3; deadline 60 s/300 s; mount 30 s. Boundary and refusal tests: j_cap_create over-ceiling/over-budget assertions (item 38); deadline expiry in j_cap_mcp (item 47) |
| **CR-B2** (M tranche omits plugin-era files) | **Accepted** | design.md §9.1, §9.3; Detailed Plan items 13–16, 21 | `pluginRegistry.ts`, `plugins.ts`, `pluginInstall.ts`, `projections/plugins.ts` assigned to M with their twin/replay/compatibility roles; closed by the M replay-mapping test (verification.md Tranche M) |
| **CR-B3** (T1 schedules activation before its dispatcher) | **Accepted** | design.md §9.5, Detailed Plan tranche headers, items 28/31/33, journeys re-homed | T1 = register/validate/materialize/prune only (item 28 scoped, activation moved to item 33 in T2); j_cap_create/reload/source/refusal/harness moved to T2; "activation and its journeys never land before the dispatcher" stated in §9.5 and the plan header; closed by the tranche ordering itself + T2 gate |
| **CR-B4** (P cannot produce its own CUJ-4 evidence) | **Accepted** | design.md §1.6.vi, §1.7; Detailed Plan items 1–4, 10 | The decision-record substrate (`WORKBENCH_EVENTS` + allowlist + folds) lands in P; loop, policy-hook, narrowing, and harness.bind emitters named in §2.3's new observability column; item 10 writes the `remediation_verified` marker on pass; closed by j_cap_prerequisite green at the P gate |

## Major groups

| ID | Disposition | Changed in | Closed by |
| --- | --- | --- | --- |
| **CR-M1a** (allowance family) | **Partially accepted** | §1.3, §1.4, §8, item 17 (family struck), Alternative K | Level allowances = structural constants in v1; the editable record family is not built (returns with a reconfiguration journey). **Delegated authority remains derived**: operatorPermissions stays the operator's durable, operator-governable root grant record (not a constant — owner's "preserve operator-governable permissions"); ceilings still intersect grants + context live at decision time. CUJ 9 passable without unjournaled setup. Dissolves DES-2/STR-3(1)'s tightening hazard (constants cannot drift) |
| **CR-M1b** (live discovery) | **Rejected as deletion; accepted as redesign** | §3.2, §5.1, §2.1 (sequence number), item 1 + item 34, Alternative L records the rejection | Live discovery at the next eligible model-turn boundary is a defining behavior. Smallest mechanism: the index's monotonic **capability-event sequence number** (one in-memory read per model step, re-read of the descriptor section from the index only on change, delivery via the existing steering push points) — replaces the dirty-flag/per-turn re-assembly design; explicit §3.2 exception recorded (descriptors are data, no authority); j_cap_create asserts mid-run discovery (item 38) |
| **CR-M1c** (harness surfaces) | **Accepted as staged implementation** | G4, §3.1, item 35 | V1 ships instruction patches + toolset overrides. Model routing and workflow composition remain designed extension surfaces with contracts stated (spending-ceiling constraint; `workflow.define` machinery) and follow-on work recorded (record family, resolver leg, journey) — post-v1 milestone, no v1 guarantee depends on them (CUJ 11 exercises the two v1 surfaces) |
| **CR-M2** (authority contract gaps) | **Accepted** | §1.2 (outcome table + D2 reconciliation), §1.3 (ceiling-vs-Alternative-B reconciliation + staleness rule), §1.5 (grants immutable — change = revoke + reissue; `expired` disambiguated: reason `grant-expired` vs derived terminal state; single-process invariant enforced), §2.1A (approval composition: allow pre-empts only the authority-plane continuation; mode/risk gates always park; park-vs-refuse per kind), §2.3 row 3 + §1.6.v (grant-intersected agent branch + membership rule), §4.1 (total join: primary-implementation ladder gate; session-scoped row governs session invocations, else persistent; exactly one row governs), §2.1B (per-call deadline 60/300 s, `deadline_exceeded`, counter decrement), §1.5 (boot expires session-bound rows before mount) | Closed by the CAS concurrency suite (item 30), j_cap_suspend/revoke (item 48), j_cap_prerequisite (item 10), j_cap_restart boot-expiry assertions (item 53) |
| **CR-M3** (boundary/loader contract gaps) | **Accepted** | §2.5 (closed three-operation vocabulary; framed protocol refuses server-initiated requests), §7.1 (closed panel-descriptor schema, ajv-validated), §3.3 (one overlap regime per surface), §3.3/§4.2.6 (repoint re-runs conflict check), §4.4 (the source rule stated once), §1.6.iii (shared operator guard across the ten sites + policy point), §6.2 (execution-posture record defined: per-restriction enforcement levels, operator-only edits, accuracy = core violation) | Closed by registration-time validation tests (j_cap_create), j_cap_mcp posture refusals (item 47), j_cap_harness overlap assertions (item 42), CUJ 4 |
| **CR-M4** (evidence/matrix completeness) | **Accepted** | §8 (the normative transition×event×fold **matrix table now in the document** — 22 rows incl. create/author folded into register, `reconciled-unknown`, partial-materialization, uninstall rule), CUJ 13 (`capability.repoint_failed`), §9.1 (catalog-size scaling variant on j_cap_create), item 41 (enablement-gate refusal variant), grouped coverage nits assigned to journey assertions in `verification.md` | Closed by the replay-equality instrument (item 30) + the journey rows in verification.md |
| **CR-M5** (unassigned mechanisms) | **Accepted** | Detailed Plan: boot-gate read (items 25/31 + server.ts item 32), `GRANTED_CAPABILITIES` dispatcher id (item 32), sequence number (item 24), scheduler tick (item 26), kernel-observation bridge recorder (item 31), remediation-marker family + writer (items 2–4, 10), pruning trigger (§4.2.3 — at registration), descriptor delivery write side (items 1/34) | Every mechanism now has owner file + tranche; closed by the per-tranche verification.md rows |
| **CR-M6** (dependency selections) | **Accepted** | §10 | MCP: official TypeScript SDK + custom Transport adapter over provider streams (feasibility check recorded as a T3 gate in verification.md); JSON-Schema: ajv (draft 2020-12, compiled at registration); mount timeout 30 s stated as the dispatcher's choice — no implementer choice remains |
| **CR-M7** (test infrastructure/instruments unowned) | **Accepted** | items 29 (wb-helpers), 47 (MCP stub fixture), 30 (index suite: replay-equality + transparency + concurrency + adapter cleanup), 43 (call-site inventory), verification.md (created as the evidence log) | All instruments owned by named files and tranches |
| **CR-M8** (single-process invariant) | **Accepted — enforced** | §1.5 deployment invariant; §1.7 predicate leg (b); §11 risk row; item 25; `docs/known-gaps.md` entry (item 54) | Enablement predicate and boot gate check the store kind: default pg0 data home (one-live-owner rule) or memory store; external PostgreSQL = unsupported mode, enable refused, boot records the posture — fail-closed; the dangling "already states" reference replaced by the normative statement |
| **CR-M9** (Risks & Mitigations section) | **Accepted** | §11 (new) | Consolidated table naming prompt injection (mitigation: content-not-authority + live predicate), untrusted tool metadata, index memory bounds, mount storms, multi-process, secrets, subprocess residual, broken extensions |
| **CR-M10** (naming/cross-reference consistency) | **Accepted** | §8 normative (`capability.harness.*`; four body sections + item 35 corrected), §2.4 (four gates named identically, item 1 aligned), Overview + throughout (capability owns ids/handlers/table entries; bundle owns payload/store/manifest), status line "Proposed — review-ready" | Closed by the §8 normativity note + grep-consistency at review |
| **CR-M11** (documentation-level majors) | **Accepted** | header (baseline citation + D-key gloss + OQ-B + E-phase/cordis glosses), Problem #4 (masquerade + polarity), §2.4 (SEA-Forge referent), §0 (existing-system glossary + precedents table with anchors), §1.5 (CAS expanded at first use; runOwnership clause), STY-1 ("honest" register reworded to mechanisms), CUJs 3/5/12 ("promptly" replaced by the measurable stop discipline) | Closed by the self-containment improvements; verified by any future comprehension re-read |

## Editorial and comprehension nits

Resolved in the same pass where inexpensive: §9.2→§9.3 repoints; operator-term
normalization; `ctx.allowances` rationale (§1.4); Hallmark/Impeccable external-payload
clause; item mapping notation (item 38 spelled out); safe-mode single module naming (§7.1);
kernel-bridge in §10's net-new list; `runOwnership` clause; flake-class pointer
(Verification Plan); two-`safeMode.ts` merged; G2/G4/G6/G8 wording; "frictionless" epithet
removed; §2.5 absolutes scoped to v1; "richer" → "payload-bearing"; "largest hidden item"
rewording; "outright/normal" trimmed; "anti-slop" quoted as self-description;
"(reconciled)" residue dropped; adapter named `lifecycleRecorder` in the Overview;
"ceiling" reserved for the authority concept; STY nits (doublets, "first-class
affordance", "largest hidden item", "(reconciled)", two-names-one-thing); dead event
family (`rendered`) dropped; the `integrity_verified` per-event family dropped (integrity is
the precondition of recorded loads and repoint outcomes); the P-clamp-inputs-before-grants
question resolved: the operator root-grant seed lands in **T1** (item 25) with the grant
capability; until then, P's clamp intersects the identity-derived operator principal under
the constant posture — a sequencing note in the Detailed Plan, with no effect on any v1
guarantee, since P's evidence suite gates enablement, which itself requires T1.
Nits deferred (each confirmed non-blocking for v1): theme accents (post-v1 settings record),
rollback-to-version UI (post-v1; CUJ 13 covers automated rollback), structured guide
formats (post-v1; guides are markdown), deeper version history (post-v1).

## Defining behaviors — preserved (owner §4)

1. In-session create + activate — CUJ 1 (T2). 2. Skills + MCP tools composed into reusable
capabilities — §2.5, §5.3, CUJ 1/3. 3. Newly activated capabilities available to the ongoing
interaction without restart — §3.2/§5.1 live discovery (M1b), CUJ 1 mid-run assertion.
4. Harness changes effective at the run/turn boundary — §3.2 (configuration at run start,
discovery at model-turn), CUJ 11. 5. Authority cannot be self-enlarged or bypassed,
including subagents and executable payloads — §1, §2, CUJ 4. 6. Suspension, revocation,
reload, restart preserve stated correctness — CUJs 5, 12, 13, 7 + the CAS/concurrency and
replay-equality instruments. 7. Broken extensions recovered through safe mode without
durable-state loss — §7.2, CUJ 6.

## Deferral ledger (no v1 guarantee depends on any of these)

*   Model routing + workflow harness surfaces — post-v1 (contracts recorded, §3.1).
*   Editable level-allowance family — post-v1 (returns with a reconfiguration journey).
*   Preset registration — post-v1 (until a journey demands a new agent definition).
*   Native per-bundle model-facing tools — post-v1 upstream proposal.
*   Conditional-commit upstream in the recording path (v1 uses the lifecycleRecorder
    directly) — post-v1 upstream proposal.
*   `AuthorizationRequest` context fields, kernel drain primitive, durable kernel event
    sink, projection-amplification fix — post-v1 upstream proposals.
*   Marketplace sources, rollback-to-version UI, structured guide formats, deeper version
    history, theme accents — post-v1.
