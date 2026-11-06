// T8 aggregate containment ledger (J-RW-AGGREGATE-CONTAINMENT): unit journeys over a real
// PostgreSQL store and a stub contained provider — the admission, refusal, reaping, cancellation
// and fail-closed semantics, without needing real Linux namespaces (the OS journeys live in
// test/J-RW-AGGREGATE-CONTAINMENT.test.ts and run under the explicit bwrap gate).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createExecutionWorldRegistry, type ExecResult, type ExecutionWorldProvider } from "@godspeedai/cognate-execution";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import {
  aggregateContainedRegistry,
  bookedCpuSecondsInWindow,
  CONTAINMENT_THREAD,
  emptyContainmentState,
  isContainmentState,
  parseContainmentQuotas,
  ContainmentQuotaError,
} from "../src/capabilities/aggregateContainment.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };
type ExecHandler = (spec: { readonly argv: readonly string[] }, options?: { readonly signal?: AbortSignal }) => Promise<ExecResult>;

const stubProvider = (worldId: string, handler: ExecHandler): ExecutionWorldProvider => ({
  worldId,
  kind: "linux-bubblewrap",
  metadata: { containment: "stub" },
  fileSystem: {
    resolve: () => "/workspace",
    stat: async () => undefined,
    exists: async () => false,
    readText: async () => "",
    writeText: async () => {},
    list: async () => [],
    version: async () => "0",
  },
  process: { exec: handler },
  dispose: async () => {},
});

const ok: ExecResult = { stdout: "", stderr: "", exitCode: 0, timedOut: false };

interface Fixture {
  readonly app: AppServer;
  readonly setQuotas: (quotas: Record<string, number>) => Promise<void>;
  readonly ledger: () => Promise<{ executions: Record<string, { outcome?: string; status: string }> }>;
  readonly stop: () => Promise<void>;
}

async function withFixture(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "wb-containment-unit-"));
  let app: AppServer | undefined;
  try {
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home, devAuth: true });
    const service = createRemoteRuntimeService(connectTransport(app.url), () => `local:${LOCAL_OPERATOR.actor.id}`);
    const client = createClient({ service, caller: LOCAL_OPERATOR });
    const setQuotas = async (quotas: Record<string, number>) => {
      await client.invoke("settings.changeContainment", { containment: quotas });
      // The settings.changed run folds asynchronously; wait for the durable row.
      for (let i = 0; i < 400; i++) {
        const rows = (await app!.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
        const current = rows.find(row => row.key === "current" || row.key.endsWith("/current"))?.value as { containment?: unknown } | undefined;
        if (current?.containment !== undefined) return;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error("containment quotas did not become durable in time");
    };
    const ledger = async () => {
      const thread = await app!.runtime.service.readSharedState(SYSTEM, { threadId: CONTAINMENT_THREAD });
      return JSON.parse(JSON.stringify(thread.state ?? emptyContainmentState())) as { executions: Record<string, { outcome?: string; status: string }> };
    };
    await fn({ app, setQuotas, ledger, stop: async () => { await app?.stop(); app = undefined; } });
  } finally {
    await app?.stop();
    await rm(home, { recursive: true, force: true });
  }
}

test("aggregate containment: quota parsing is strict and the window budget requires a bookable cap", () => {
  expect(parseContainmentQuotas(undefined)).toBeUndefined();
  expect(parseContainmentQuotas({})).toBeUndefined();
  expect(parseContainmentQuotas({ maxConcurrent: 2 })).toEqual({ maxConcurrent: 2 });
  expect(() => parseContainmentQuotas({ maxConcurrent: 1.5 })).toThrow();
  expect(() => parseContainmentQuotas({ maxConcurrent: 0 })).toThrow();
  expect(() => parseContainmentQuotas({ unknownField: 1 })).toThrow("Unknown containment quota field");
  expect(() => parseContainmentQuotas({ cpuSecondsPerWindow: 10 })).toThrow("requires cpuSecondsPerExecution");
  expect(parseContainmentQuotas({ cpuSecondsPerExecution: 5, cpuSecondsPerWindow: 10 })).toEqual({ cpuSecondsPerExecution: 5, cpuSecondsPerWindow: 10 });
  expect(() => parseContainmentQuotas({ cpuWindowHours: 1.5 })).toThrow();
});

test("aggregate containment: the concurrency ceiling fails closed and releases on completion", async () => {
  await withFixture(async ({ app, setQuotas, ledger }) => {
    await setQuotas({ maxConcurrent: 1 });
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    registry.register(stubProvider("w-stub", async () => {
      calls += 1;
      if (calls > 1) return ok;
      await firstInFlight; // the first execution stays in flight until the journey releases it
      await new Promise(r => setTimeout(r, 30));
      return ok;
    }));
    const provider = registry.get("w-stub");
    const first = provider.process.exec({ argv: ["sleep"], cwd: "/workspace" });
    await new Promise(r => setTimeout(r, 60)); // let the first acquire + start
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).rejects.toThrow("Aggregate contained-execution ceiling exceeded");
    releaseFirst();
    await first;
    const afterRelease = await ledger();
    expect(Object.values(afterRelease.executions).some(e => e.status === "completed" && e.outcome === "completed")).toBe(true);
    // The slot is free again: new work is admitted.
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).resolves.toBeTruthy();
  });
}, 60_000);

test("aggregate containment: kernel caps ride the argv, the window budget burns conservatively and fails closed", async () => {
  await withFixture(async ({ app, setQuotas, ledger }) => {
    await setQuotas({ cpuSecondsPerExecution: 1, cpuSecondsPerWindow: 2, maxAddressSpaceBytes: 536_870_912 });
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    const seen: string[][] = [];
    registry.register(stubProvider("w-stub", async (spec) => {
      // The availability probe answers "prlimit exists inside the world" and is not a child run.
      if (spec.argv.join(" ").includes("command -v prlimit")) return ok;
      seen.push([...spec.argv]);
      return { ...ok, exitCode: spec.argv.includes("spin") ? 152 : 0 };
    }));
    const provider = registry.get("w-stub");
    await provider.process.exec({ argv: ["spin"], cwd: "/workspace" });
    await provider.process.exec({ argv: ["spin"], cwd: "/workspace" });
    expect(seen[0]).toEqual(["prlimit", "--as=536870912", "--cpu=1:2", "--", "spin"]);
    expect(seen[1]).toEqual(["prlimit", "--as=536870912", "--cpu=1:2", "--", "spin"]);
    // Two booked executions exhaust the 2-second window: new work fails closed.
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).rejects.toThrow("Aggregate CPU-second window budget exhausted");
    const state = await ledger();
    expect(Object.values(state.executions).filter(e => e.outcome === "cpu-capped").length).toBe(2);
    // The accounting is conservative: the full cap, never a guessed smaller number.
    const thread = await app.runtime.service.readSharedState(SYSTEM, { threadId: CONTAINMENT_THREAD });
    expect(isContainmentState(thread.state)).toBe(true);
    expect(bookedCpuSecondsInWindow(thread.state as never, { cpuSecondsPerExecution: 1, cpuSecondsPerWindow: 2, cpuWindowHours: 24 }, Date.now())).toBe(2);
  });
}, 60_000);

test("aggregate containment: a configured quota fails closed when kernel limit tooling is unavailable", async () => {
  await withFixture(async ({ app, setQuotas, ledger }) => {
    await setQuotas({ cpuSecondsPerExecution: 1 });
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    registry.register(stubProvider("w-stub", async (spec) => {
      // The prlimit availability probe itself: not found inside the world.
      if (spec.argv.join(" ").includes("command -v prlimit")) return { ...ok, exitCode: 127 };
      throw new Error("the stub child must not run: caps were configured but unavailable");
    }));
    const provider = registry.get("w-stub");
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).rejects.toThrow(ContainmentQuotaError);
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).rejects.toThrow("refused rather than run uncapped");
    const state = await ledger();
    expect(Object.values(state.executions).filter(e => e.status === "reserved").length).toBe(0);
  });
}, 60_000);

test("aggregate containment: a crashed holder's lapsed slot is reaped and accounted conservatively", async () => {
  await withFixture(async ({ app, setQuotas, ledger }) => {
    await setQuotas({ maxConcurrent: 1 });
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    let crashed = false;
    registry.register(stubProvider("w-stub", async () => {
      if (!crashed) {
        // The "crashed holder": this exec never returns its slot (simulate by dying mid-flight).
        crashed = true;
        await new Promise(() => {});
      }
      return ok; // every later execution completes normally
    }));
    const provider = registry.get("w-stub");
    const never = provider.process.exec({ argv: ["crash"], cwd: "/workspace", timeoutMs: 50 });
    void never.catch(() => {});
    await new Promise(r => setTimeout(r, 120)); // the 50ms lease + 5s slack has NOT passed yet...
    // A second concurrent exec while the first still holds the slot: refused.
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).rejects.toThrow("Aggregate contained-execution ceiling exceeded");
    // Now the lease really lapses (execTimeoutMs 50ms + 5s slack): reap by waiting past it.
    await new Promise(r => setTimeout(r, 5_100));
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).resolves.toBeTruthy();
    const state = await ledger();
    expect(Object.values(state.executions).some(e => e.outcome === "reaped")).toBe(true);
  });
}, 60_000);

test("aggregate containment: a provider refusal or caller cancellation releases the slot", async () => {
  await withFixture(async ({ app, setQuotas, ledger }) => {
    await setQuotas({ maxConcurrent: 1 });
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    registry.register(stubProvider("w-stub", async (_spec, options) => {
      if (options?.signal) throw new Error("aborted by the caller");
      return ok;
    }));
    const provider = registry.get("w-stub");
    const controller = new AbortController();
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" }, { signal: controller.signal })).rejects.toThrow("aborted by the caller");
    // The aborted execution's slot was released: the next execution is admitted.
    await expect(provider.process.exec({ argv: ["true"], cwd: "/workspace" })).resolves.toBeTruthy();
    const state = await ledger();
    expect(Object.values(state.executions).some(e => e.outcome === "cancelled")).toBe(true);
    expect(Object.values(state.executions).filter(e => e.status === "reserved").length).toBe(0);
  });
}, 60_000);

test("aggregate containment: a caller-supplied timeout cannot outlive the slot lease, and quotas clear explicitly", async () => {
  await withFixture(async ({ app, setQuotas }) => {
    await setQuotas({ maxConcurrent: 4 });
    const { acquireContainedSlot, releaseContainedSlot } = await import("../src/capabilities/aggregateContainment.ts");
    const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };
    // A 24-hour caller timeout is clamped to the wrapper's bound: the lease covers the child.
    const admission = await acquireContainedSlot(app.runtime.service, SYSTEM, { worldId: "w-clamp", execTimeoutMs: 24 * 60 * 60 * 1000 });
    expect(admission.leaseUntilMs).toBeLessThanOrEqual(Date.now() + 300_000 + 5_000 + 50);
    expect(admission.leaseUntilMs).toBeGreaterThan(Date.now());
    await releaseContainedSlot(app.runtime.service, SYSTEM, admission.slotId, "completed", 1);
    // ...while a short timeout leases exactly short-time + slack.
    const short = await acquireContainedSlot(app.runtime.service, SYSTEM, { worldId: "w-clamp", execTimeoutMs: 1_000 });
    expect(short.leaseUntilMs).toBeLessThanOrEqual(Date.now() + 1_000 + 5_000 + 50);
    await releaseContainedSlot(app.runtime.service, SYSTEM, short.slotId, "completed", 1);

    // The empty object is the explicit "clear the quotas" patch: contained work is unquotalimited
    // again afterwards, and a later quota re-arm re-enables admission.
    const service = createRemoteRuntimeService(connectTransport(app.url), () => `local:${LOCAL_OPERATOR.actor.id}`);
    const client = createClient({ service, caller: LOCAL_OPERATOR });
    await client.invoke("settings.changeContainment", { containment: {} });
    for (let i = 0; i < 400; i++) {
      const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
      const current = rows.find(row => row.key === "current" || row.key.endsWith("/current"))?.value as { containment?: unknown } | undefined;
      if (current?.containment !== undefined && Object.keys(current.containment as object).length === 0) break;
      await new Promise((r) => setTimeout(r, 15));
    }
    const cleared = await acquireContainedSlot(app.runtime.service, SYSTEM, { worldId: "w-clamp" });
    expect(cleared.slotId).toBe(""); // no quotas configured: historical pass-through admission
  });
}, 60_000);

test("aggregate containment: with no quota configured, contained executions keep historical behavior", async () => {
  await withFixture(async ({ app }) => {
    const registry = aggregateContainedRegistry(createExecutionWorldRegistry(), { getService: () => app.runtime.service, systemCaller: SYSTEM });
    let ran = 0;
    registry.register(stubProvider("w-stub", async (spec) => {
      ran += 1;
      expect(spec.argv[0]).toBe("true"); // no prlimit prefix, no admission accounting
      return ok;
    }));
    const provider = registry.get("w-stub");
    await Promise.all([
      provider.process.exec({ argv: ["true"], cwd: "/workspace" }),
      provider.process.exec({ argv: ["true"], cwd: "/workspace" }),
      provider.process.exec({ argv: ["true"], cwd: "/workspace" }),
    ]);
    expect(ran).toBe(3);
    const thread = await app.runtime.service.readSharedState(SYSTEM, { threadId: CONTAINMENT_THREAD });
    expect(thread.version).toBe(0); // the ledger was never written
  });
}, 60_000);
