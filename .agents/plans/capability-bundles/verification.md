# Capability Bundles — verification log

Per-tranche evidence rows per the design's Verification Plan (`design.md`, Detailed
Implementation Plan). One row per tranche boundary; a tranche closes only when its rows
pass and `just verify` is green at the boundary (isolated-pass failures classified per the
host-concurrency flake class in `CURRENT_STATUS.md`).

## Pinned numbers (design.md Verification Plan; CR-B1 resolution)

| Parameter | Value | Justification |
| --- | --- | --- |
| Descriptor budget, per capability | ≤ 400 tokens | name + version + purpose + 8 skill entry lines + 8 tool lines; the Hallmark + Impeccable bundle fits with headroom |
| Descriptor budget, aggregate | ≤ 4,000 tokens | ≈2% of a 200k-token context; truncation at registration is visible and recorded |
| Bundle payload, per file | ≤ 512 KiB | matches the `workspaceFiles` bounded-directory guard scale |
| Bundle payload, per bundle | ≤ 5 MiB | bounds materialization time well under the 30 s mount budget |
| Bundle file count | ≤ 200 | markdown/reference payloads; Hallmark + Impeccable ≈ tens of files |
| Version-directory retention | active + 3 | rollback depth (CUJ 13) without a package store; pruned at registration |
| Per-call deadline | 60 s default / 300 s max | bounded drain for in-flight counters; capability-declarable up to the cap |
| Adapter mount timeout | 30 s | dispatcher's explicit choice (kernel default is 2 s, adapter-supplied) |
| Retained versions before prune | 3 | stated; revisit only with a journey that needs deeper history |

## Owner-condition gates (added at reconciliation; bind the affected tranches)

*   [ ] **P — marker evidence (condition 3):** the remediation marker is written by the
    evidence run against the real booted app and carries
    `{workbenchBuild, suiteDigest, recordedAt}`; a mismatched-build marker refuses
    `capability.runtime.enable` (asserted).
*   [ ] **T1 — substrate scope (condition 3):** the index suite asserts state-machine
    semantics only; no activation/dispatcher behavior tests in T1 (plan-conformance check).
*   [ ] **T1 — GC reference rule (condition 4):** prune refuses versions referenced by any
    activation row (persistent or session-scoped), any in-flight reference, or any open
    spawn-ledger entry; referenced-but-beyond-retention versions survive (asserted).
*   [ ] **T2 — governance integration (condition 1):** under `COGNATE_GOVERNANCE=sea-forge`,
    a bundle invoke is decided consistently with built-in treatment (authority request with
    full target identification); escalation parks and resumes via the existing machinery;
    no bypass path exists (call-site inventory covers the dispatcher).
*   [ ] **T3 — containment enforcement probes (condition 2):** per supported world, actual
    OS enforcement observed from inside a probe payload — bubblewrap namespace +
    `--unshare-all` isolation; `prlimit` caps applied; uncontained local/SSH/WSL recorded as
    not OS-confined; executable-payload availability per world matches the verified matrix;
    skills/data capabilities unaffected by posture on every world.
*   [ ] **T3 — identity alignment (condition 5):** grant records carry provenance fields;
    no new identity authority exists outside the workbench-local layer; `docs/known-gaps.md`
    carries the unified-identity migration responsibilities entry.

## Tranche P — §1.6 remediation + decision-record substrate

*   [x] `test/J-CAP-prerequisite.test.ts` green (6/6): the user-kind masquerade refused and
    durably recorded at the workbench human gates (guard evidence row with point/reason
    code/run id); ALL_ALLOWED retired — unbound and declared-outside-workspace scopes clamp
    to the operator runtime ceiling (approval, not allow) while in-workspace work flows;
    run_code joins the authority plane (deny without a shell grant, record for governed
    allows); subagent children run under derived per-agent principals
    (`wb-agent:coding` lineage provenance); the remediation marker records versioned build
    evidence (commit SHA + package version + suite digest) through the real recording path;
    decision records fold into the workbench projection.
*   [x] Guard adoption: the shared guard (`src/workbench/operatorGuard.ts`) replaces the
    kind-only/inline checks across the operator-only surfaces — workbench human gates,
    settlement, taskCheckout, containedWorkspace (asserted message preserved),
    workspaceFiles, browser, terminal, governance, ambiguousStep, expertEffect, and the
    `session.harness.bind` operator-only convention with in-run recorded refusal.
*   [x] Dispatcher tool ids present in `TOOL_DEFS`/`PRESET_TOOLS`/`EXPERT_TOOL_DEFS`; a
    dispatcher-id call before T2 fails closed (policy deny — the id is deliberately absent
    from `GRANTED_CAPABILITIES` until the T2 mount adds it, per design item 32).
*   [x] Policy agent branch: responsible-agent principals run the granted set minus the
    human-decision surfaces; expert runs start under `wb-agent:<expertId>` lineage.
*   [ ] `just verify` green at the P boundary — **in flight**; result recorded on completion.
*   Recorded deviations: (a) chat/mobile-run principals stay operator in P (client-API run
    starter is the authenticated HTTP session; per-agent chat principals land in T2 with the
    dispatcher's attribution surface; the masquerade hole is closed by the runId guard
    regardless); (b) the policy-refusal hook emission (trace rows 3/4 refusal records from
    the sync kernel policy) lands with the authority index in T1 — policy denials refuse
    fail-closed today but are not yet durably recorded; (c) the operator runtime ceiling
    preserves the operational baseline (shell/network/install "yes" per pre-P parity,
    destructive mediation unchanged at the existing risk.assess/Sentinel gate) — per-principal
    tightening arrives with grant records in T1; (d) E-phase/rev-43 settlement was recorded
    as the P start gate; implementation began on the owner's explicit instruction while
    E-phase completes concurrently.

## Tranche M — SEA model change + plugin-era files

*   [ ] `domainforge validate` + `domainforge fmt --check` on the model: Plugin entity
    retired, trust clause re-scoped, version on skill-OS entities, grant/activation
    entities, ten canonical journeys with variants — 0 violations.
*   [ ] The four plugin-era files re-authored in the same change set
    (`pluginRegistry.ts`, `plugins.ts`, `pluginInstall.ts`, `projections/plugins.ts`);
    `plugin.install` retired from `GRANTED_CAPABILITIES`.
*   [ ] Replay-mapping test: `plugin.installed`/`plugin.uninstalled` history replays to
    dormant/retired capability rows; projection rebuild from genesis equals live.
*   [ ] Doctor's model-hash manifest regenerated and packaging evidence updated.
*   [ ] Superseded suites re-pointed (J-PLG-install → j_cap_create/j_cap_persist variants;
    panels/toggle → capability-panel suites; workbench-plugins retained for legacy folds).

## Tranche T1 — substrate (register/validate only)

*   [ ] `test/workbench-authority-index.test.ts` green: replay-equality (projections + index
    from genesis), index transparency (each §8 family appended one at a time → decision
    equality), CAS concurrency (activate vs suspend, repoint vs revoke, revoke vs resume —
    batch atomicity proven), adapter-cleanup (failed activation mid-registration leaves the
    handler table empty).
*   [ ] lifecycleRecorder: conditional-commit on the six families; idempotency-key retry
    proven; run-shaped stream ids absent.
*   [ ] Bundle store: materialization, integrity verification, registration-time pruning
    (retention active + 3), over-ceiling refusal asserted.
*   [ ] Grant capability + operator root-grant seed; scheduler expiry tick writes the CAS
    batch with reason `grant-expired`.
*   [ ] `just verify` green at the T1 boundary. **No activation code or journey in T1.**

## Tranche T2 — dispatcher, activation, loader, sources, harness resolver

*   [ ] `GRANTED_CAPABILITIES` gains the dispatcher id; dispatcher mounts adapters
    (30 s timeout; child scopes; per-version handles; disposer convention).
*   [ ] j_cap_create (CUJ 1): preset-scoped session; in-session create → activate → use;
    live descriptor discovery at the next model-turn boundary mid-run; over-ceiling and
    over-budget refusals; the catalog-size scaling variant (50-capability synthetic catalog).
*   [ ] j_cap_reload + rollback variant (CUJs 2, 13): `repointed` precedes old-version
    completion; snapshot consistency; repoint conflict re-check; `capability.repoint_failed`
    on the failure variant; v1 payload availability after failed replacement.
*   [ ] j_cap_source (CUJ 8): SSH/WSL directory install identical to local.
*   [ ] j_cap_refusal + enablement variant (CUJ 4): full bundle-path matrix; marker-absent
    enable refusal; unsupported-store refusal.
*   [ ] j_cap_harness (CUJ 11): instruction patch + toolset override effective at the next
    run start, uniform across run sources; per-surface overlap rule; replay restore.
*   [ ] `test/workbench-call-sites.test.ts` green (the grep-pinned inventory).
*   [ ] `just verify` green at the T2 boundary.

## Tranche T3 — executables

*   [ ] j_cap_mcp (CUJ 3): local + SSH/WSL parameterized; record-before-spawn ledger;
    posture-gated refusals recorded; secrets env-only, fail-closed on missing keys; deadline
    expiry (`deadline_exceeded`) asserted; termination honesty per provider recorded.
*   [ ] j_cap_suspend + revoke variant (CUJs 5, 12): committed-visibility refusal; batch
    atomicity under concurrent transition; scheduler-expiry reason; operator-established
    activations unaffected.
*   [ ] MCP SDK transport adapter verified over provider streams (the §10 decision's
    demonstrability check).
*   [ ] `just verify` green at the T3 boundary.

## Tranche T4 — presentation, safe mode, restart/persist

*   [ ] j_cap_safemode + present variant (CUJs 6, 10): the exclusion read precedes
    render/mount; fault marking; the governance-surface override refused at registration as
    a core violation; two-strike boot escalation; the operator-only manual clear.
*   [ ] j_cap_restart (CUJ 7): boot expiry of session rows; spawn-ledger sweep outcomes
    recorded; replay mappings; namespace shadowing refused.
*   [ ] j_cap_persist (CUJ 9): persistent sessions; context-level scoping
    observable in decision records.
*   [ ] `just verify` green at the T4 boundary.

## Enablement

*   [ ] §1.7 predicate satisfied: remediation marker present + supported store kind.
*   [ ] `workbench.capability_runtime.enabled` recorded (operator-only act, after rev 43).
