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

### Tranche T3 — executables, committed (`feat/capability-runtime-t3`)
- `src/mcp/client.ts`: official MCP SDK (`@modelcontextprotocol/sdk` 1.32.2, exact pin) behind `ChannelTransport`, a custom Transport over a wrapper-owned stdio channel. No client capabilities are declared (server-initiated requests refused). `tools/list` is untrusted data: name pattern, UTF-8 byte bounds (description, schema, result, arguments), ajv-compiled schemas, per-tool exclusion; every call is recorded before it is sent (`capability.mcp.tool_invoked` started/finished/refused; arguments as digest and byte count only).
- `src/capabilities/execSpawn.ts`: the governed spawn wrapper. The §6.2 matrix as `worldMatrix`/`decideContainment` (unknown kind fails closed; a weaker posture needs an operator posture RECORD that is accurate and explained; an inaccurate record is a recorded core violation). Record-before-spawn ledger (`intended` with secret references only, `spawned`, `exited` / `reconciled-unknown`; one stream per spawn, ordered). Secrets env-only, redacted from everything kept. Long-lease slot class (`acquireLongLeaseSlot`, per-world cap, same containment ledger thread). Process-group ownership on the host-process path (`detached`, `kill(-pgid)`). Boot-sweep `reconcileSpawnLedger` (pid kill only under the version-directory signature).
- `src/capabilities/mcpManage.ts`: `capability.mcp.start|stop`, `capability.bundle.suspend|resume` and the `McpHost` the dispatcher routes `mcp.<serverId>.<tool>` through. New `authorizeCapabilityOp` ops `mcp.start` (operator, enabled, deployment ok, target slot active and unsuspended, ceiling covers `mcp.server`, live clamp), `mcp.stop`, `suspend`, `resume` (operator-only family). All mutating acts run in the shared mutex; start authorizes first, as the last step before the intent commit, and again after the spawn. A store commit listener stops servers in the commit's own turn on suspension (including the grant revoke/expiry batch), deactivation, uninstall, repoint and session archive; graceful servers drain in-flight calls (bounded), emergency servers and `integrity` suspensions are killed at once.
- Manifest: `mcpServers` (command with `${bundleDir}`, secret references, restrictions, stop mode), the `mcp.server` requirement/permission; the dispatcher requires `mcp.server` in addition to `capability.invoke` for MCP tools; callers may shorten (never extend) the per-call deadline (`deadlineMs`).
- Reducer folds `spawn/<id>` rows from the ledger events; boot sweep wired in `server.ts` (before any new spawn).
- Suites: `test/J-CAP-mcp.test.ts` (21; matrix per provider kind, record-before-spawn, secrets, slots, sweep, lifecycle, deadline, refusals, registry pin), `test/J-CAP-suspend.test.ts` (6; CUJ 5 graceful/emergency/second reason, CUJ 12 revoke batch and scheduler expiry); fixtures `test/fixtures/mcp-stub/`, `test/mcp-helpers.ts`.
- Recorded limits (open for the owner): the framework `ProcessPort` is buffered (`exec` returns after exit, no stdin/stdout), so an MCP stream cannot be held over an SSH, WSL or bubblewrap provider: those worlds pass the matrix under an honest posture record and then refuse with `stream-port-unavailable` (recorded); only the local host-process path spawns (and only under `uncontained-local`). Posture records are an operator-supplied `ServerOptions.executionPostureRecords` input; an operator-authored recorded edit surface is not built. The workbench fold keeps only a grant's id and status (not principal, permissions or expiry), so a boot rebuild of the index from the fold loses them (fails closed; belongs to the T4 restart journey).

## What remains (in dependency order)

### T2 leftovers (deliberately not in this tranche slice)
- `test/workbench-call-sites.test.ts` (design item 43, the grep-pinned call-site inventory)
- Boot remount of the active set (`activeSet` is still `[]` in `server.ts`; folds into the T4 restart journey)
- Activation/creation beyond an agent's grant refuses and records (D2's "park on the approval machinery" is not built)
- Session-bound activation routing: the dispatcher now derives the session from the run's own start input (never from tool input) and fails closed (a session-scoped suspension refuses any agent-shaped call whose session is unknown). Still open: subagent child runs do not carry their parent's session, so they resolve as session-unknown; `capability.bundle.activate`/`deactivate` still take an explicit `sessionId` target. Capability-declarable 300 s deadlines remain open

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

### Review round 1 (`test/J-CAP-review-r1.test.ts`)
- R1-1 session from run context, fail-closed suspension; R1-2 version identity = payload + whole manifest (`versionHashFor(payload, manifest)`, `verifyBundleIntegrity(dir, hash, manifest)`; reducer never rewrites a registered version row); R1-3 activation ceiling = requirements ∩ agent grant ∩ operator root (refuses `beyond-operator` / `no-root-grant`); R1-4 grant and clamp expiry checked at decision time against the injected `now`; R1-5 descriptor marker tokens reserved inside the 400-token budget

### Review round 2 and CI (`test/J-CAP-review-r2.test.ts`)
- A1 decision: the §1.5 store invariant is unchanged. `classifyCapabilityStore` treats an external PostgreSQL (`COGNATE_POSTGRES_URL`) as multi-writer unless the OPERATOR declares `COGNATE_CAPABILITY_SINGLE_WRITER=1` (kind `external-postgres-single-writer`). CI shards each own one PostgreSQL service and one test process, so `verify.yml` declares it; no test-only bypass exists in src.
- A2: `createAgentCodingAgent({ isCapabilityRuntimeEnabled })`; with the runtime disabled (or no probe) the loop makes no `capability.harness.resolve` call at all. The enablement read is boxed in `ctx.step`.
- B1-B3 share `src/workbench/authoritySelection.ts` (principal mapping, live grants, governing-row selection, live clamp/root) between the dispatcher and the resolver. B2: the resolver derives the run's principal from the call actor and applies patches only if principal grant ∩ live root cover `harness.modify`; refusals return as `decisions` the loop emits. B4: activation re-checks gate + authorize immediately before the commit and again after it (suspends on lapse); grants live on other streams, so this narrows rather than eliminates the window. B5: skill load scans, then reads the entry once and hashes those bytes against the verified digest. B6: the aggregate budget measures the joined text.

### Review round 3 (`test/J-CAP-review-r3.test.ts`) — one authorization function
- `authorizeCapabilityOp` (`src/workbench/authoritySelection.ts`) is the single decision point: enablement, the §1.5 deployment invariant (re-evaluated per call via `deploymentOk`), principal, live actor grant ∩ live root grant (expiry/revocation), governing row and session suspension (session from `sessionOfRun`, never input). Entry points: invoke, skill.load, activate, deactivate (new `bundle.deactivate` permission), harness resolve/refresh/apply. A registry test pins the handler set and that each routes through it. Refusals are recorded by the entry point that receives them; a disabled runtime or failed deployment invariant at resolve/refresh is a recorded-at-dispatcher/no-op, not a run refusal.
- Index rebuild is idempotent (one entry per grant id, one commit subscription). Activation/deactivation are serialized by a per-runtime mutex (valid under the single-writer invariant); conflicts and grants are re-read inside the critical section before the commit, closing the B4 window except the commit's own await (post-commit verify remains). `estimateTokens` is a never-under-counting bound (ASCII 4 chars/token, other characters their UTF-8 byte length).

### Review round 4 (`test/J-CAP-review-r4.test.ts`)
- One shared runtime mutex (`src/workbench/runtimeMutex.ts`, wired in `server.ts`) serializes activation, deactivation, uninstall and grant issue/revoke (valid under §1.5). Each op calls `authorizeCapabilityOp` as the last step before its commit (operator-only lifecycle acts via the `uninstall`/`grant.issue`/`grant.revoke` ops, which carry no enablement/root-liveness precondition so revoking the root grant cannot lock the operator out). Activation also re-checks the bundle is still installed with that version present. A grant revoke raised during a mount queues behind it and then suspends the activation.
- Handler table keyed by (capability, scope, version); deactivating a scope removes only its handlers. `estimateTokens` = UTF-8 byte length (provable upper bound; verified against gpt-tokenizer). Registration refusals (operator guard, schema) are recorded. Fixed latent wiring bug: the bundles component captured the authority index and recorder before they existed, so uninstall always threw; both are now lazy.

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

## Blind review of the T2 remainder (PR #38)
Codex (GPT Sol 6.1, read-only) reviewed the tranche in four full rounds plus a fix verification:
5, 6, 8 and 5 findings, every one reproduced and fixed with a red-then-green test
(`test/J-CAP-review-r1..r4.test.ts`). Round 3 drove the structural fix: one decision point,
`authorizeCapabilityOp`, for every entry point (pinned by a registry test), and one runtime mutex
for activation, deactivation, uninstall, grant issue/revoke and the grant expiry sweep.

Accepted residual risk (documented on the PR):
- The lifecycle recorder awaits a stream read inside its CAS append, so "no await between the final
  authorization and the append" holds only up to that read. Every path that can revoke or expire a
  grant (the revoke handler and the expiry sweep) holds the same mutex, so no revocation can
  interleave there under the §1.5 single-writer invariant. What remains is a grant whose expiry
  instant passes during that read: the mutating op may commit, but every later invocation
  re-checks expiry and refuses, and deactivation only reduces authority.

## Key infrastructure notes
- pg0 shared instance: max_connections saturates under peak parallel load; the verify recipe pre-starts it; bootApp retries the transient signature
- The lifecycleRecorder writes through the store's conditional-commit API directly (not ctx.emit)
- Bundle-authored code never runs in-process (the dispatcher mounts app-owned adapters)
- Authority enforcement: the dispatcher decides per invocation from the commit-synchronous index
- The authority index's sequence number is the live-discovery signal for the descriptor refresh
