// J-RW-AGGREGATE-CONTAINMENT: real Linux namespace proof for the T8 aggregate containment
// ledger. Like test/J-RW-contained-workspace.test.ts this requires the host-owned attestation
// for the patched Bubblewrap binary and a running controlled pg0 database; CI without those
// host prerequisites skips it (test/aggregateContainment.test.ts covers the ledger semantics
// without namespaces). Run with:
//   COGNATE_BWRAP_TESTS=1 COGNATE_BWRAP_TEST_ATTESTATION=/path/to/reviewed.json bun test test/J-RW-AGGREGATE-CONTAINMENT.test.ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { CONTAINMENT_THREAD } from "../src/capabilities/aggregateContainment.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";

const enabled = process.env.COGNATE_BWRAP_TESTS === "1" && process.platform === "linux";
const integrationTest = enabled ? test : test.skip;
const PATCHED_BWRAP_COMMIT = "2a76602a8c71f36c1527cf9fc3417d9149822e0c";

type WorkbenchClient = ReturnType<typeof createClient>;
const clientFor = (app: AppServer): WorkbenchClient => createClient({
  service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)),
  caller: LOCAL_OPERATOR,
});

async function verifiedContainmentConfig(): Promise<ContainmentConfig> {
  const proofPath = process.env.COGNATE_BWRAP_TEST_ATTESTATION;
  if (!proofPath) throw new Error("COGNATE_BWRAP_TESTS=1 requires COGNATE_BWRAP_TEST_ATTESTATION pointing to a reviewed host attestation JSON");
  const supplied = JSON.parse(await readFile(proofPath, "utf8")) as ContainmentConfig;
  const binaryHash = createHash("sha256").update(await readFile(supplied.executablePath)).digest("hex");
  expect(supplied.provenance.binarySha256).toBe(binaryHash);
  expect(supplied.provenance.operatorVerified).toBe(true);
  expect(supplied.provenance.patchedCve202687766).toBe(true);
  return supplied;
}

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

async function ledgerOf(app: AppServer): Promise<{ executions: Record<string, { outcome?: string; status: string; cpuSeconds: number }> }> {
  const thread = await app.runtime.service.readSharedState(SYSTEM, { threadId: CONTAINMENT_THREAD });
  return JSON.parse(JSON.stringify(thread.state ?? { executions: {} }));
}

async function liveCount(app: AppServer): Promise<number> {
  const state = await ledgerOf(app);
  return Object.values(state.executions).filter(e => e.status === "reserved").length;
}

async function setQuotas(app: AppServer, client: WorkbenchClient, containment: Record<string, number>): Promise<void> {
  await client.invoke("settings.changeContainment", { containment });
  for (let i = 0; i < 400; i++) {
    const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
    const current = rows.find(row => row.key === "current" || row.key.endsWith("/current"))?.value as { containment?: unknown } | undefined;
    if (current?.containment !== undefined) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("containment quotas did not become durable in time");
}

async function selectContained(client: WorkbenchClient, root: string): Promise<{ executionWorldId: string }> {
  const selected = await client.invoke("workspace.contained.select", { path: root }) as { executionWorldId: string };
  expect(selected.executionWorldId.startsWith("contained-")).toBe(true);
  return selected;
}

async function stop(app: AppServer | undefined): Promise<void> {
  if (app) await app.stop();
}

integrationTest("J-RW-AGGREGATE-CONTAINMENT: the kernel CPU cap kills a burner and the exhausted window fails closed", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-aggregate-cpu-"));
  const root = join(home, "work");
  let app: AppServer | undefined;
  try {
    await mkdir(root, { recursive: true });
    app = await startServer({ port: 0, home, devAuth: true, containmentConfig: await verifiedContainmentConfig() });
    const client = clientFor(app);
    const selected = await selectContained(client, root);
    const exec = (argv: readonly string[], timeoutMs = 20_000) => client.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: [...argv], cwd: "/workspace", timeoutMs,
    });

    // Sanity: prlimit is available inside the world (a public runtime root binary).
    const probe = await exec(["sh", "-c", "command -v prlimit"]) as { exitCode: number };
    expect(probe.exitCode).toBe(0);

    await setQuotas(app, client, { cpuSecondsPerExecution: 1, cpuSecondsPerWindow: 2 });
    const burn = "i=0; while :; do i=$((i+1)); done";

    // First burner: the kernel RLIMIT_CPU cap kills it with SIGXCPU (exit 152) at ~1s.
    const first = await exec(["sh", "-c", burn], 15_000) as { exitCode: number; timedOut?: boolean };
    expect(first.exitCode === 152 || first.timedOut === true).toBe(true);
    // Booked conservatively at its full cap.
    let state = await ledgerOf(app);
    expect(Object.values(state.executions).some(e => e.outcome === "cpu-capped" || e.outcome === "killed")).toBe(true);

    // Second burner: the window budget burns to its end (booked at the full cap again).
    await exec(["sh", "-c", burn], 15_000).catch(() => undefined);

    // The window is exhausted: NEW WORK FAILS CLOSED, even trivial work.
    await expect(exec(["sh", "-c", "printf ok"])).rejects.toThrow("Aggregate CPU-second window budget exhausted");
    state = await ledgerOf(app);
    const booked = Object.values(state.executions).reduce((sum, e) => sum + (e.cpuSeconds ?? 0), 0);
    expect(booked).toBe(2);
    expect(await liveCount(app)).toBe(0);
  } finally {
    await stop(app);
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);

integrationTest("J-RW-AGGREGATE-CONTAINMENT: the aggregate concurrency ceiling fails closed across two processes on one store", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-aggregate-xproc-"));
  const root = join(home, "work");
  let appA: AppServer | undefined;
  let appB: AppServer | undefined;
  try {
    await mkdir(root, { recursive: true });
    const config = await verifiedContainmentConfig();
    appA = await startServer({ port: 0, home, devAuth: true, containmentConfig: config });
    const clientA = clientFor(appA);
    const selected = await selectContained(clientA, root);
    await setQuotas(appA, clientA, { maxConcurrent: 2 });
    const execA = (timeoutMs: number) => clientA.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "sleep 3"], cwd: "/workspace", timeoutMs,
    });

    // Process A holds both aggregate slots with in-flight contained executions.
    const slow1 = execA(20_000);
    const slow2 = execA(20_000);
    await new Promise((r) => setTimeout(r, 400));
    expect(await liveCount(appA)).toBe(2);

    // Process B boots on the SAME store, restores the same contained world, and its new work
    // is refused: the ceiling is aggregate across processes, from the durable ledger.
    appB = await startServer({ port: 0, home, devAuth: true, containmentConfig: config });
    const clientB = clientFor(appB);
    await expect(clientB.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "printf b"], cwd: "/workspace", timeoutMs: 10_000,
    })).rejects.toThrow("Aggregate contained-execution ceiling exceeded");

    // Release A's slots; B's identical work is admitted.
    await Promise.all([slow1, slow2]);
    expect(await liveCount(appA)).toBe(0);
    const admitted = await clientB.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "printf b"], cwd: "/workspace", timeoutMs: 10_000,
    }) as { stdout: string };
    expect(admitted.stdout).toBe("b");
  } finally {
    await stop(appA);
    await stop(appB);
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);

integrationTest("J-RW-AGGREGATE-CONTAINMENT: a provider-killed execution releases its slot and a crashed holder's slot is reaped", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-aggregate-reap-"));
  const root = join(home, "work");
  let app: AppServer | undefined;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "seed.txt"), "ok");
    app = await startServer({ port: 0, home, devAuth: true, containmentConfig: await verifiedContainmentConfig() });
    const client = clientFor(app);
    const selected = await selectContained(client, root);
    await setQuotas(app, client, { maxConcurrent: 1 });

    // A timed-out (provider-killed) execution is not a leaked slot: the ceiling opens again.
    const timedOut = await client.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "sleep 5"], cwd: "/workspace", timeoutMs: 700,
    }) as { exitCode: number; timedOut?: boolean };
    expect(timedOut.timedOut === true || timedOut.exitCode !== 0).toBe(true);
    expect(await liveCount(app)).toBe(0);
    await expect(client.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "printf ok"], cwd: "/workspace", timeoutMs: 10_000,
    })).resolves.toBeTruthy();

    // A crashed holder: reserve the slot directly (the ledger's own admission, no completion),
    // let its lease lapse, and prove a later admission reaps it instead of wedging the ceiling.
    const { acquireContainedSlot } = await import("../src/capabilities/aggregateContainment.ts");
    const crashed = await acquireContainedSlot(app.runtime.service, SYSTEM, { worldId: selected.executionWorldId, execTimeoutMs: 50 });
    expect(crashed.slotId).toBeTruthy();
    await expect(client.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "printf x"], cwd: "/workspace", timeoutMs: 10_000,
    })).rejects.toThrow("Aggregate contained-execution ceiling exceeded");
    await new Promise((r) => setTimeout(r, 5_200)); // the 50ms exec lease + 5s slack lapses
    const after = await client.invoke("process.exec", {
      worldId: selected.executionWorldId, argv: ["sh", "-c", "printf x"], cwd: "/workspace", timeoutMs: 10_000,
    }) as { stdout: string };
    expect(after.stdout).toBe("x");
    const state = await ledgerOf(app);
    expect(Object.values(state.executions).some(e => e.outcome === "reaped")).toBe(true);
  } finally {
    await stop(app);
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);
