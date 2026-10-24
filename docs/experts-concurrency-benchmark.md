# Workbench model-only concurrency measurement

Observed 2026-10-15 with published Cognate 0.5.0, Bun 1.4.0, PostgreSQL 18.1/pg0 and Linux
6.18.54.1-microsoft-standard-WSL2; six logical processors visible. Run:

```sh
bun test --timeout 120000 test/experts-app-capacity.test.ts
```

The test creates eight independent solo conversations and frozen intrinsic-return Assignments per
capacity. A deterministic model provider holds each batch until the configured number enters, then
performs 80 ms of controlled work. All eight must return successful handoffs with distinct
Assignment, conversation and run identities and no crossed task purpose. This tests native
admission and state contention, not model competence, external provider speed or workspace-effect
parallelism.

## Canonical characterization (2026-10-15, four fresh sweeps)

One sweep per capacity in a fresh Bun process, four times (1 → 2 → 4 → 8 within each sweep, the
historical order). The table reports the per-capacity median and the min–max range of the four
trials; RSS is the whole Bun process at the sample of the last trial.

| Startup capacity | Observed maximum active models | Completed assignments | Median elapsed ms (min–max, n=4) | Median assignments/sec | RSS bytes (last trial) |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 8 | 5643.9 (5607.6–5695.0) | 1.42 | 321396736 |
| 2 | 2 | 8 | 4985.1 (4736.2–5336.1) | 1.61 | 356962304 |
| 4 | 4 | 8 | 5064.5 (5043.2–5316.8) | 1.58 | 350625792 |
| 8 | 8 | 8 | 5151.9 (5055.5–5329.4) | 1.55 | 381333504 |

There is no confidence interval and no portable throughput guarantee. Elapsed spans command
creation through all handoffs and excludes initial app seeding; the harness polls the registry
aggregate during the handoff phase. Every case reached exactly the configured provider peak.

**The previously recorded capacity-8 regression did not reproduce.** The earlier single-sweep table
(capacity 4: 4688.3 ms, capacity 8: 5317.6 ms) showed a 13 % gap. In these four fresh sweeps the
capacity-4 and capacity-8 ranges overlap almost completely (medians 5064.5 vs 5151.9 ms, a 1.7 %
difference against a ±300 ms run-to-run spread). Capacity 1 is predictably slowest (eight
sequential 80 ms holds plus per-assignment overhead); capacity 2 is occasionally the fastest
because its release gate admits two at a time. The measured workload is dominated by fixed
per-assignment cost, not by admission capacity — the isolation below attributes that cost.

## Capacity-8 hypothesis isolation (registry CAS vs context materialization)

`test/experts-capacity-attribution.test.ts` runs the identical eight-assignment model-only workload
with the native shared-state seam wrapped (the same technique as `scripts/benchmark-experts.ts`) and
`ExpertsService.context` timed in place. It measures capacity 8 first in a fresh process (removing
the sweep-ordering confound) and then capacity 4. The second instrumented trial:

| Measurement | Capacity 8 | Capacity 4 |
| --- | --- | --- |
| Elapsed / submit / handoff phase (ms) | 5428.9 / 2893.6 / 2535.3 | 4970.1 / 2479.4 / 2490.7 |
| Experts-thread state reads (submit phase alone) | 447 (114) | 394 (99) |
| Sum of read latency (share of elapsed) | 2025.7 ms (37 %) | 1763.5 ms (35 %) |
| State commits / failed CAS attempts | 32 / 49 | 30 / 45 |
| CAS failures inside the submit phase | 48 of 49 | 44 of 45 |
| Sum of commit latency (share of elapsed) | 1451.9 ms (27 %) | 1339.8 ms (27 %) |
| Committed aggregate bytes per commit (p50/p95) | 2011 / 2011 | 2011 / 2011 |
| Execution-context rebuilds / total cost | 72 / 1.85 ms (0.03 %) | 66 / 1.56 ms (0.03 %) |

Isolated conclusions:

1. **Full context materialization is ruled out** for this workload. The in-memory execution-context
   rebuild costs under 2 ms in total (p50 ≤ 0.02 ms per call) — 0.03 % of elapsed. The first
   instrumented trial agrees (1.73 ms across 62 rebuilds).
2. **Registry CAS is the dominant measured cost class.** State reads plus aggregate commits account
   for 62–64 % of elapsed at both capacities. Every command re-reads the whole aggregate and every
   commit writes a fresh 2 KB snapshot; a commit costs ~36–41 ms p50 (~100 ms p95) even at 2 KB, so
   contention on the single Experts thread — not payload size — sets the throughput ceiling.
3. **CAS conflicts concentrate in concurrent submission.** 48 of 49 (capacity 8) and 44 of 45
   (capacity 4) failed attempts occur while the eight `expert.converse` commands create their
   Assignments; returns contribute ~1 conflict each. Retries per committed assignment-creation write
   are nearly identical at both capacities (~2.7 vs ~2.8), which is why capacity 8 does not fall
   behind capacity 4 in a measurable way.
4. **There is no isolated capacity-8 regression to repair in this fixture.** The structural cost
   above is capacity-independent; improving it is the A4 retrieval/CAS work (indexed, paginated
   reads and the global root CAS) recorded for T3/T4, not a capacity-8 special case. The harness's
   own polling shares the same read path (handoff-phase reads 333/295), so application-only traffic
   is the submit-phase slice: ~13 registry reads per assignment.

Single-trial measurements remain labeled as such; these are small local WSL2/pg0 observations, not
throughput guarantees.
## Workspace-effect conflict inventory (T0)

Every Workbench surface that can mutate state another surface depends on, the run class that
carries the mutation, the canonical resource identity T1 must key on, and the authoritative source
that identity is derived from. Admission keys are never taken from run-supplied input: a run's
identity is resolved against authoritative records, and anything that does not resolve fails closed
to the unchanged global exclusion key `workbench:workspace-effects`.

| # | Mutating surface | Run class | Canonical resource identity | Authoritative source |
| --- | --- | --- | --- | --- |
| 1 | Tool-bearing Expert work (frozen tools beyond `expert_return`: Team Orchestrators, delegating Specialists, solo Experts with bash/edit) | `agent.expert` | `workspace:<workspaceId>` of the Assignment | `Assignment.workspaceId` in the `experts:registry` thread, cross-checked against the `workspaces` projection record `record/<id>` (root, execution world) |
| 2 | Model-only Expert work (frozen tools exactly `["expert_return"]`) | `agent.expert` | none — no workspace effects | `assertModelOnlyExpertRun` over the authoritative registry snapshot |
| 3 | Coding session turns (`read`/`edit`/`bash`/`run_code`) | `agent.coding` | `workspace:<workspaceId>` | `workspaces` projection `record/<workspaceId>`; the run-supplied id must resolve to a record |
| 4 | Coding subagent children | `agent.coding` via `subagent.start` | `workspace:<workspaceId>` | same as 3 (the child repeats the parent's workspace id) |
| 5 | Schedule dispatch | schedule evaluator → `expert.converse`/`team.converse` → Assignments → surfaces 1–2 | the Assignment's workspace | same as 1; schedule definitions themselves are application policy on the `schedules` thread, not a run |
| 6 | Workspace record configuration (add / select / rename / delete / contained add) | `agent.config` | `configuration` + `workspace:<id>` (+ `world:<id>` for contained creation) | `workspaces` and `execution-worlds` projections |
| 7 | Execution world connect / disconnect | `agent.config` | `world:<worldId>` + every `workspace:<id>` whose record names that world + `configuration` | `execution-worlds` projection, plus the workspaces enumerated by `executionWorldId` |
| 8 | Model and provider configuration (`model.configured`, `provider.deleted`) | `agent.config` | `configuration` | input kind (deterministic); the live provider registry is process state that run admission cannot fence — swaps remain fail-stop for in-flight runs, exactly as they already are for model-only Expert runs |
| 9 | App configuration (`settings.changed`, `plugin.*`, `session.archived`, `onboarding.dismissed`, `workbench.recorded`) | `agent.config` | `configuration` | input kind (deterministic) |
| 10 | Cognitive case and world records | `agent.cognitive` | `configuration` + `world:<worldId>` when the payload names one | validated payload field; invalid payload fails closed |
| 11 | Any other agent, or an input that does not classify against the rows above | any | `workbench:workspace-effects` (global) | fail closed — eligibility is never widened silently |

Rules the inventory pins down for T1:

- **Canonicalization.** A workspace id is `sha256(worldId ␀ resolvedRoot)` truncated to 16 hex
  characters, computed from the provider-resolved root at selection time, so distinct spellings of
  one directory produce one record and one key. Admission only ever *looks up* ids in authoritative
  records, so a forged or aliased identity cannot mint a new key: an unknown id fails closed to the
  global exclusion key rather than overlapping.
- **Mutators enumerate their conflict set.** World and workspace mutators (rows 6–7) name every
  resource they affect, so a world disconnect serializes against active runs in that world's
  workspaces without requiring every run to hold a shared world key — which is what keeps runs on
  different workspaces disjoint. If the affected set would exceed the SDK's 100-key limit, the run
  fails closed to the global key.
- **Runs hold only the resources they can mutate.** A workspace-keyed run does not hold a
  configuration key: configuration runs are short, and blocking them behind a long agent run would
  stall the operator surface. Configuration-vs-run interaction is therefore fail-stop for the shared
  process state (provider registry), unchanged from today's model-only behaviour.
- **Known boundary.** On the local execution world, `tool.bash` and `tool.run_code` run with the
  workspace root as working directory but without OS containment, so a single shell command can
  reach outside its workspace. Workspace-keyed overlap relies on the workspace-scoped authority
  plane (`authority.check`, protected evidence, path escape denial on `filesystem.*`), not on OS
  isolation; real containment is the contained-world tranche, and distributed safety is not claimed.

## T3 settlement (2026-10-15, with the T1/T2 policies active)

Four further sweeps on the tree that carries conflict-aware workspace admission and the Team
admission/batching policy (the capacity workload itself is model-only solo work, which holds no
resource keys, so T1/T2 cannot widen or narrow it — the re-run confirms that):

| Startup capacity | Observed maximum active models | Median elapsed ms (min–max, n=4) | Median assignments/sec |
| --- | --- | --- | --- |
| 1 | 1 | 6548.2 (5501.5–9452.9) | 1.22 |
| 2 | 2 | 5230.5 (4929.2–5612.7) | 1.53 |
| 4 | 4 | 5230.3 (4935.9–5957.6) | 1.53 |
| 8 | 8 | 5690.4 (5495.7–6021.1) | 1.41 |

Settled conclusion — **the measured capacity-8 shortfall is recorded as an accepted measured limit,
not repaired**, with this isolated cause attribution:

1. There is no discrete capacity-8 regression to repair. Both four-sweep batches agree the
   capacity-8 range overlaps capacity 4 (T0 batch medians 5064.5 vs 5151.9 ms, +1.7 %; T3 batch
   medians 5230.3 vs 5690.4 ms, +8.8 % with ranges 4935.9–5957.6 vs 5495.7–6021.1 overlapping), and
   run-to-run spread within a capacity (up to ±20 % in the noisier T3 batch) exceeds the gap.
2. The dominant, capacity-independent cost is the Experts-registry shared-state traffic isolated
   above: full-aggregate reads plus CAS commits are 62–64 % of elapsed at both capacities 4 and 8,
   and ~2.7–2.8 CAS retries per committed assignment-creation write at both capacities. Higher
   capacity multiplies concurrent `expert.converse` commands against one aggregate root, so the
   submission phase contends equally at 4 and 8 and throughput saturates near ~1.5 assignments/s.
3. A second, structural bound: a run waiting for a resource key still occupies one of the runtime's
   bounded dispatch slots (`maxConcurrentRuns`), so with mixed key conflicts a free slot can sit
   behind a key-waiting delivery. This is published-SDK dispatch semantics, recorded as a limit
   (a key-waiting run occupies one bounded dispatch slot), not a Workbench defect.

Repairing the cost class is the A4 tranche (scoped indexed/paginated retrieval and the global root
CAS), which removes the per-command full-aggregate read-modify-write, not a capacity-8 special
case. Default startup capacity remains 1. Single-trial measurements remain labeled as such; these
are small local WSL2/pg0 observations, not throughput guarantees.

## Existing journeys

Additional actual journeys in `test/J-EXPERT-model-parallel.test.ts` pass 8 tests / 48 assertions:
distinct frozen routes, two-model overlap, serial tool-bearing work, configuration ordering, profile
edits, forged-tool denial and same-run cooperative restart. Browser evidence is in
`screenshots/concurrency/`. Team-specific admission and batching remain open (T2); conflict-aware
per-resource admission is T1.
