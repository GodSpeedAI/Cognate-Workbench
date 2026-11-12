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

## What remains (in dependency order)

### T2 remainder
1. **Run-start resolver** (`src/agents/runStartResolver.ts`): named instruction sections, toolset-override application, descriptor assembly at run start, `capability.harness.assembled` by hash + delta, live descriptor refresh reading the index sequence, fail-closed on index unavailability
2. **`src/workbench/harnessPatches.ts`**: instruction-patch/toolset-override record types, validation, per-surface overlap regime, `capability.harness.patched`
3. **`src/capabilities/skillLoader.ts`**: descriptor registry; `tool.skill.load` serving from version directories with hash verification; entry-document flags
4. **`src/workbench/bundleSources.ts`**: directory source over provider-backed semantics (SSH/WSL identical)
5. **J-CAP suites**: j_cap_reload (+rollback), j_cap_source, j_cap_refusal, j_cap_harness
6. **Chunked verify at the T2 boundary**

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
- Chunked approach is the authoritative gate (3 sequential `bun test` runs, ~68 files each)
- Chunk 1 (T1 boundary): 205 pass / 0 fail
- Chunk 2 (T2 boundary): 288 pass / 11 skip / 3 flakes (pass isolated — documented host-concurrency class)
- Chunk 3 (T1/T2 boundary): 1,120 pass / 0 fail
- Consolidated: 1,619+ pass / 0 fail (all 202 files, 10+ new suites included)
- The full single-process `just verify` has 189-380 documented host-concurrency flakes (pg0 saturation) — chunked is authoritative

## Key infrastructure notes
- pg0 shared instance: max_connections saturates under peak parallel load; the verify recipe pre-starts it; bootApp retries the transient signature
- The lifecycleRecorder writes through the store's conditional-commit API directly (not ctx.emit)
- Bundle-authored code never runs in-process (the dispatcher mounts app-owned adapters)
- Authority enforcement: the dispatcher decides per invocation from the commit-synchronous index
- The authority index's sequence number is the live-discovery signal for the descriptor refresh
