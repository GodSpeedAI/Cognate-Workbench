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

## Tranche P — §1.6 remediation + decision-record substrate

*   [ ] `test/J-CAP-prerequisite.test.ts` green: the refusal matrix (clamp across the full
    tool catalog incl. `run_code`; per-agent principals at every start site in the item 7
    table; the shared operator guard at all ten sites; `session.harness.bind` refusal;
    policy agent branch incl. grant intersection), every refusal asserted from
    `authority.decision.recorded` with reason code + deciding point.
*   [ ] `workbench.capability_runtime.remediation_verified` written by the suite's evidence
    run on pass (the §1.7 gate's input).
*   [ ] Dispatcher tool ids present in `TOOL_DEFS`/`PRESET_TOOLS`/`EXPERT_TOOL_DEFS`; a
    dispatcher-id call before T2 returns the structured "no eligible provider" refusal.
*   [ ] `just verify` green at the P boundary; E-phase (rev 43) settled before P begins.

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
