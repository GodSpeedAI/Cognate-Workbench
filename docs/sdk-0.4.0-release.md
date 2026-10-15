# Cognate SDK 0.4.0 release evidence

Recorded 2026-10-15 UTC. This evidence separates the published SDK release from the Workbench's subsequent dependency upgrade. The consumer proof below validates published SDK packages; it does not establish Workbench parallelism or full Workbench verification.

## Source and CI

| Change | Head | Merge | CI evidence |
| --- | --- | --- | --- |
| [PR #42: `feat: native fenced dispatch, bounded runs and Linux execution world`](https://github.com/GodSpeedAI/Cognate/pull/42) | `033029d2be29fc3982dc4ac9de963a93ab266f90` | `c6e32079844dd36dd6c20d3516f8c6ac2f2c67f0` at 2026-10-14 21:08:54Z | [Package / clean-room install](https://github.com/GodSpeedAI/Cognate/actions/runs/38636835958), 21:00:37–21:01:21Z; [Ubuntu verify](https://github.com/GodSpeedAI/Cognate/actions/runs/38636836131), 21:00:37–21:02:27Z. Both passed on the exact PR head. |
| [PR #43: `chore(main): release main`](https://github.com/GodSpeedAI/Cognate/pull/43) | `f1a49147cdbd558ab328184fdc8884088a6a49ca` | `467a5f06f0a9d6f4bf03270bd128a17654dd356e` at 2026-10-14 23:58:18Z | Exact-head manual [Ubuntu verify](https://github.com/GodSpeedAI/Cognate/actions/runs/38656883563), 23:54:21–23:56:07Z; manual [package / clean-room install](https://github.com/GodSpeedAI/Cognate/actions/runs/38656883567), 23:54:20–23:55:17Z. Both passed. |

The verify jobs ran `just verify`, provider/agent interoperability conformance, and PostgreSQL-backed suites successfully. The DomainForge CLI and RealityTrace installation step was skipped in each verify run; this record does not treat that step as verified.

## Published release and package matrix

The [release workflow](https://github.com/GodSpeedAI/Cognate/actions/runs/38657275627) ran on merge commit `467a5f06f0a9d6f4bf03270bd128a17654dd356e` from 2026-10-14 23:58:21Z to 2026-10-15 00:26:56Z and completed successfully. The two release setup jobs succeeded. The manifest contained 45 package paths, matched one-to-one with 45 jobs whose names start with `publish `; every publish job succeeded, with no missing, unexpected, skipped, or failed package job.

The public [v0.4.0 release](https://github.com/GodSpeedAI/Cognate/releases/tag/v0.4.0) was published at 2026-10-14 23:58:36Z. It is not a draft or prerelease. Tag `v0.4.0` points directly to merge commit `467a5f06f0a9d6f4bf03270bd128a17654dd356e`.

Read-only registry checks covered each of the 45 manifest packages using `npm view <package>@0.4.0 --json version gitHead` (at most five concurrent requests). All reported version `0.4.0` and `gitHead` `467a5f06f0a9d6f4bf03270bd128a17654dd356e`; there were no mismatches.

## Clean-room consumer proof

The fixture at `/home/sprime01/projects/cognate-workbench/.tmp/consumer-proof-467a5f` is a new consumer directory with all 45 published packages pinned directly to `0.4.0`. From that directory:

```sh
npm install --no-audit --no-fund
npm ls --depth=0
```

The install added 185 packages. All 45 direct Cognate dependencies resolved at `0.4.0`, and the generated lockfile contained 45/45 SDK packages at that version with no missing package or version drift. npm's configured install-script trust policy blocked scripts for `ssh2`, `cpu-features`, and `@astryxdesign/core`; no scripts were approved or rerun. The runtime smoke below did not depend on those scripts.

With Bun 1.4.0, the consumer imported `createRuntime` from `@godspeedai/cognate-runtime-bun`, `createMemoryStore` from `@godspeedai/cognate-store-memory`, and `bubblewrapExecutionWorld` from `@godspeedai/cognate-execution`. It created two distinct slow agents, configured `execution: { maxConcurrentRuns: 2, resourceKeys: () => [] }`, started both runs, waited for idle, and asserted peak active execution was 2 and each run returned its own agent, input, and caller. The assertions passed. The smoke also confirmed `bubblewrapExecutionWorld` is a public function export and the memory store exposes `claimOutboxLeased` and `settleOutboxLease`.

The runtime smoke command, run from the fixture directory, was:

```sh
bun -e '
import assert from "node:assert/strict";
import { createRuntime } from "@godspeedai/cognate-runtime-bun";
import { createMemoryStore } from "@godspeedai/cognate-store-memory";
import { bubblewrapExecutionWorld } from "@godspeedai/cognate-execution";
const store = createMemoryStore();
assert.equal(typeof store.claimOutboxLeased, "function");
assert.equal(typeof store.settleOutboxLease, "function");
assert.equal(typeof bubblewrapExecutionWorld, "function");
const caller = { tenant: "consumer-smoke", actor: { id: "operator", kind: "user" } };
const policy = { authorize: () => ({ allow: true, policyId: "consumer-smoke", reason: "test" }) };
const actions = { authorize: () => ({ allow: true, reason: "test" }) };
let active = 0, peak = 0;
const agent = id => ({ id, version: "1.0.0", async run(input, ctx) {
  return ctx.step("slow", async () => {
    active++; peak = Math.max(peak, active);
    try { await Bun.sleep(120); return { agent: id, input, actor: ctx.actor.id }; }
    finally { active--; }
  });
} });
const agents = [agent("agent.slow.one"), agent("agent.slow.two")];
const runtime = await createRuntime({ store: { store }, agents, policy, actions,
  execution: { maxConcurrentRuns: 2, resourceKeys: () => [] } });
try {
  const started = await Promise.all(agents.map((a, i) => runtime.service.startRun(caller,
    { agent: a.id, input: { value: i + 1 }, idempotencyKey: `consumer:${i}` })));
  await runtime.idle();
  assert.equal(peak, 2);
  const runs = await Promise.all(started.map(row => runtime.service.getRun(caller, { runId: row.runId })));
  assert.deepEqual(runs.map(row => row.output), [
    { agent: "agent.slow.one", input: { value: 1 }, actor: "operator" },
    { agent: "agent.slow.two", input: { value: 2 }, actor: "operator" },
  ]);
  console.log({ peak, outputs: runs.map(row => row.output) });
} finally { await runtime.close(); }
'
```

This consumer proof is limited to the published SDK runtime. It does not prove the Workbench app runs two independent agents in parallel. It checked the leased-outbox method exports but did not exercise outbox lease ownership or recovery. It confirmed the Bubblewrap export but did not run a Linux sandbox. The `resourceKeys` eligibility callback is synchronous and process-local; this evidence does not establish asynchronous eligibility or distributed coordination. No production-hardening claim is made.

## Workbench upgrade status

The Workbench upgrade is a separate verified change. It covers 23 direct dependencies and 35 resolved lockfile pins at `0.4.0`, with no non-SDK package-entry drift or donor links. `just typecheck` and 42 targeted tests passed. Full `just verify` then passed **1,101 tests, zero failures, 6,860 assertions across 96 files in 403.64 seconds**, including actual browser journeys and PostgreSQL recovery. This establishes compatibility; Workbench still uses default serialized execution pending authoritative eligibility and UI integration.
