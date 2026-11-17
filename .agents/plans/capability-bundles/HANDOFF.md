# Capability-runtime implementation handoff

## Committed and gated (17 commits, `814c63b` through `bf4c09f`)

### Tranche P — §1.6 defect remediation (`c56ab9a`, `814c63b`)
- Shared operator guard (`src/workbench/operatorGuard.ts`): refusal condition `kind !== "user" || runId`, adopted at all 10 operator-only surfaces
- Runtime authority clamp: `task.create` authority demoted to hint; effective scopes = declared ∩ actor grant ∩ operator permissions; ALL_ALLOWED retired
- Per-agent run principals (`wb-agent:*` namespace); subagent children lineage-derived
- `session.harness.bind` operator-only convention
- Static policy agent branch (grant-intersected allowlist over loop-invoked built-ins)
- `authority.decision.recorded` + `workbench.capability_runtime.*` in WORKBENCH_EVENTS/allowlist/folds
- `test/J-CAP-prerequisite.test.ts` (6 tests): masquerade refusal + recording, clamp across full catalog, run_code authority-plane membership, lineage provenance, remediation marker write

### Tranche M — SEA model change (`15d8646`)
- Plugin entity re-scoped to legacy-plugin compatibility surface (semantic ID preserved)
- `CapabilityBundle` / `AuthorityGrant` / `CapabilityActivation` entities + comments
- 10 canonical journeys (J-CAP-create/reload/mcp/refusal/suspend/safemode/restart/source/persist/harness) carrying 13 CUJs as variants
- `CAPABILITY_RUNTIME_ANCHORS` + `bindCapabilityRuntime` in `domain/index.ts`
- Trust-twin re-authored in `pluginRegistry.ts` / `plugins.ts`
- 27 event families in `WORKBENCH_EVENTS`; `session.activation` in `SESSION_EVENTS`
- Reducer folds for the full activation machine
- `CapabilityContractDef.version` + `owner` fields; namespace partition at `skill.register`

### Tranche T1 part 1 — authority substrate (`3912074`)
- `src/workbench/authorityIndex.ts`: commit-synchronous index (grants per principal; activations keyed capability+level+session), boot rebuild from fold, fail-closed reads
- `src/workbench/lifecycleRecorder.ts`: conditional-commit write adapter (six CAS families, atomic batches, envelope construction, idempotency keys, never run-shaped stream ids)
- `src/capabilities/authorityGrants.ts`: grant issue/revoke/list + operator root-grant seed + `capability.runtime.enable` (§1.7 predicate)
- Grant-expiry sweep interval (60s, unref'd)
- Server wiring with lazy accessors (constructed in the createRuntime options list)

### Tranche T1 part 2 — bundle store + register (`3e27bf9`)
- `src/capabilities/bundleStore.ts`: version-directory materialization, integrity verification, retention pruning (active + 3), bounded scan (512 KiB/file, 5 MiB/bundle, 200 files)
- `src/capabilities/capabilityBundles.ts`: register/validate (ajv manifest schema, ceilings, satisfiability)
- `test/workbench-authority-index.test.ts` (5 tests): CAS concurrency, index transparency, replay-equality, adapter-cleanup, fail-closed reads
- Projection filter extended to `capability.*` families
- Selection-rule fix: session-scoped row governs whenever it exists (§4.1 total rule)

### Infrastructure fixes
- `93d7836`: pg0 start-race retry in bootApp (8 attempts, backoff, matches pg0/ECONNREFUSED/too-many-clients)
- `a5ca1ef`: boot additions non-blocking (index rebuild fire-and-forget, handlers await ready)
- `465ec1d`: verify recipe pre-starts pg0
- `bf4c09f`: ajv dependency (draft 2020-12, compiled at registration)

### Tranche T2 dispatcher — committed (`34f67e9`, `b3ef296`, `77e9774`)
- `src/capabilities/capabilityRuntime.ts`: the dispatcher
  - Adapter components mounted via `Kernel.mount` (30s timeout, per-capability child scope, per-version handle)
  - `fiber.effects.register` disposer convention (failed activation leaves the table empty)
  - Version-keyed handler table + per-version in-flight counters
  - Per-call deadlines (60s default / 300s max, `deadline_exceeded` envelope)
  - `tool.capability_invoke` + `tool.skill_load` (GRANTED_CAPABILITIES + standing catalog members)
  - Structured refusal envelopes with `authority.decision.recorded` emission
  - Activate handler reads the bundle row for version/dir; commits `capability.activated` after ACTIVE
  - Deactivate handler drains in-flight then disposes
- `capability.bundle.register` + activate/deactivate in GRANTED_CAPABILITIES
- `test/J-CAP-create.test.ts` (3 tests): register → activate → invoke in-session, over-ceiling refusal, in-session discovery

### Tranche T2 remainder — committed (`feat/capability-runtime-t2`)
- `src/capabilities/capabilityRuntime.ts` (reworked): version-keyed handler table; the §1.4 decision implemented once in `decide` (enablement marker ∧ not the system caller ∧ index available ∧ selected row active, reasons ∅ ∧ ceiling ∧ actor grant, unexpired ∧ clamp grant intact); every refusal AND bundle-path allow recorded (`authority.decision.recorded`, on a per-capability `decisions:` stream so audit appends never race lifecycle CAS); in-flight counter taken in the same synchronous section as the decision; deadline timers cleared; hot reload = mount v2 → integrity + conflict re-check + CAS pre-state → `capability.repointed` → old handle drained then disposed; failures: `capability.activation_failed` (first activation) / `capability.repoint_failed` (replacement), v1 untouched; load-time integrity failure → `capability.integrity_failed` + `integrity` suspension
- `src/workbench/harnessPatches.ts`: closed section vocabulary (conventions/workflow/tooling/style), explicit refusal of non-surfaces, toolset-override validation (dispatcher ids kept, no `run_code` outside ptc), §3.3 composition (persistent then session order, `replace` last-wins), exclusive per-preset toolset ownership via `detectConflicts`, `capability.harness.patched`
- `src/agents/runStartResolver.ts`: run-start resolution as the read-only capabilities `capability.harness.resolve` / `.refresh` (the loop emits the returned `capability.harness.assembled` records — a resolver that recorded would deadlock behind its own serial run); hashes + delta by reference, full text once per changed section; fail-closed on index unavailability; live descriptor refresh keyed on the index sequence; wired into `agentCoding.ts` (system message for standard runs, `instructions` for Expert runs, `toolsForPreset` override seam, step-boundary refresh)
- `src/capabilities/skillLoader.ts`: descriptors with pinned budgets (400 / 4,000 tokens, visible truncation recorded at registration), closed-vocabulary `skill.load` (manifest-declared skills only), hash verification on every load
- `src/workbench/bundleSources.ts`: provider-backed directory source (stat-bounded reads through the world filesystem port into a staging dir, then the identical hash/materialize pipeline), `BundleBackedPluginSource` bridge; `capability.bundle.register` accepts `executionWorldId`
- Registration now records the validated manifest (`bundle-version/<cap>/<hash>` rows keep every version's manifest), records `capability.validation_failed` on every refusal, and requires `harness.modify` for harness-declaring bundles
- Dispatcher principal rule: a user-kind actor inside a run is the operator's client identity carried into agent work, not the operator; it resolves to `wb-agent:coding` and needs its own grant (fail-closed by default)
- Test seams: `ServerOptions.capabilityRuntimeHooks` (never set in production) and `bootApp(home, extra)`
- Suites: `test/J-CAP-reload.test.ts` (CUJ 2/13, 5 tests), `test/J-CAP-source.test.ts` (CUJ 8, ssh/wsl/local parameterized, 7 tests), `test/J-CAP-refusal.test.ts` (CUJ 4 bundle-path matrix + enablement gate, 2 tests), `test/J-CAP-harness.test.ts` (CUJ 11 + refusals + resolver units, 7 tests); `test/J-CAP-create.test.ts` now enables the runtime first

## What remains (in dependency order)

### T2 leftovers (deliberately not in this tranche slice)
- `test/workbench-call-sites.test.ts` (design item 43, the grep-pinned call-site inventory)
- Boot remount of the active set (`activeSet` is still `[]` in `server.ts`; folds into the T4 restart journey)
- Activation/creation beyond an agent's grant refuses and records (D2's "park on the approval machinery" is not built)
- Session-bound activation routing through the loop (the dispatcher accepts `sessionId`; the loop does not yet pass it); capability-declarable 300 s deadlines

### T3 — executables
1. **`src/mcp/client.ts`**: MCP protocol client — official TypeScript SDK with custom Transport adapter over execution-world provider streams; invocation-record emission
2. **`src/capabilities/execSpawn.ts`**: governed spawn wrapper — per-provider containment matrix, record-before-spawn ledger, secrets env-only, posture-record checks, long-lease slot class, boot-sweep reconciliation
3. **`src/capabilities/mcpManage.ts`**: MCP server lifecycle (start/stop/suspend/resume)
4. **`test/fixtures/mcp-stub/`** + **`test/J-CAP-mcp.test.ts`** (CUJ 3)
5. **`test/J-CAP-suspend.test.ts`** (CUJs 5, 12)

### T4 — presentation, safe mode, restart/persist
1. **`src/ui/FragmentSlot.tsx`**: slot registry, React error boundaries, fail-closed registration, fault recording, governance-surface refusal
2. **`src/ui/workbench/CapabilityDetail.tsx`** (Create) + `Workbench.tsx` (Modify): capability inspector + shell tab consumer
3. **`src/workbench/safeMode.ts`**: boot exclusion read, boot counters, sweep integration, core-violation detection
4. **`test/J-CAP-safemode.test.ts`**, **`test/J-CAP-restart.test.ts`**, **`test/J-CAP-persist.test.ts`**

### Documentation and enablement
1. `src/README.md`, `src/capabilities/README.md`, `src/workbench/README.md`, `docs/known-gaps.md` (single-committing-process invariant, upstream proposals)
2. `CURRENT_STATUS.md` + `.agents/CURRENT_STATUS.jsonl` milestone revisions
3. `AGENTS.md` capability-runtime enablement gate note
4. Enablement: write `workbench.capability_runtime.enabled` after the full chunked gate passes

## Verification state
- CI is the authoritative gate since PR #37: four timing-balanced test shards, each with its own
  PostgreSQL service. The local chunked run (3 sequential `bun test` runs) is a fallback; on the
  8 GB development host it stalled during the T2 remainder, so CI decides.
- T2 remainder, local (2026-11-17): J-CAP-refusal 4/0, J-CAP-reload 5/0, J-CAP-harness 7/0,
  J-CAP-source 6/0, J-CAP-create 3/0, J-CAP-prerequisite 6/0 (pass/fail); typecheck clean.
- Red evidence against main's src (same tests): J-CAP-refusal 1 pass / 3 fail (the principal-mapping
  and enablement invariants); J-CAP-reload, J-CAP-harness and J-CAP-source fail to load (the modules
  they exercise do not exist on main); J-CAP-create passes on main (its change only enables the
  runtime first, which the new gate requires).
- Earlier tranches: chunk 1 (T1) 205/0; chunk 2 (T2 dispatcher) 288 pass, 11 skip, 3 flakes passing
  in isolation; chunk 3 1,120/0. The single-process `just verify` has documented host-concurrency
  flakes (pg0 saturation).

## Key infrastructure notes
- pg0 shared instance: max_connections saturates under peak parallel load; the verify recipe pre-starts it; bootApp retries the transient signature
- The lifecycleRecorder writes through the store's conditional-commit API directly (not ctx.emit)
- Bundle-authored code never runs in-process (the dispatcher mounts app-owned adapters)
- Authority enforcement: the dispatcher decides per invocation from the commit-synchronous index
- The authority index's sequence number is the live-discovery signal for the descriptor refresh
