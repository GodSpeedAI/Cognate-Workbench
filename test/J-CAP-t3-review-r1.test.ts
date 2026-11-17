// Journey J-CAP-t3-review-r1: Codex blind review round 1 on PR #39 (tranche T3). Each test failed
// against the pre-fix source (46e2b01) and is the regression guard for its finding.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { reconcileSpawnLedger, spawnGoverned, type LedgerEvent } from "../src/capabilities/execSpawn.ts";
import { McpClient } from "../src/mcp/client.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { createRuntimeMutex } from "../src/workbench/runtimeMutex.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitUntil, withTempHome, allEvents } from "./wb-helpers.ts";
import { LOCAL_POSTURE, alive, authorStub, eventsOfType, sleep, stubManifest } from "./mcp-helpers.ts";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";

const CAP = "capability.bundle.t3r1";
type Out = { ok: boolean; code?: string; message?: string; result?: unknown; tools?: unknown };

async function boot(home: string, timings: Record<string, number> = { graceMs: 400, killMs: 400 }) {
  const booted = await bootApp(home, { executionPostureRecords: [LOCAL_POSTURE], mcpSupervisorTimings: timings } as never);
  await enableCapabilityRuntime(booted.app, booted.client);
  return booted;
}
const install = async (booted: Awaited<ReturnType<typeof boot>>, home: string, servers: Record<string, unknown>[]) => {
  await registerBundle(booted.app, booted.client, { capabilityId: CAP, sourceDir: await authorStub(home, "t3r1"), manifest: stubManifest(servers) } as never);
  await booted.client.invoke("capability.bundle.activate", { capabilityId: CAP });
};
const exits = async (app: Awaited<ReturnType<typeof boot>>["app"]) => (await eventsOfType(app, "capability.mcp.exited")).map((e) => e.payload as Record<string, unknown>);

describe("J-CAP-t3-review-r1 finding 1: secrets never come back through MCP responses", () => {
  test("a server that echoes its env secret in a tool name, description, result and error leaks it nowhere", async () => {
    const SECRET = `tok-${randomUUID()}`;
    const b64 = Buffer.from(SECRET).toString("base64");
    const url = encodeURIComponent(SECRET);
    const logged: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(originals) as (keyof typeof originals)[]) console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
    try {
      await withTempHome(async (home) => {
        const booted = await boot(home);
        const { app, client } = booted;
        try {
          await client.invoke("secret.put", { key: "stub-token", value: SECRET });
          await install(booted, home, [{ id: "stub", command: ["bun", "${bundleDir}/server.mjs"], secrets: [{ env: "STUB_TOKEN", key: "stub-token" }] }]);
          await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" });
          const callerSees: string[] = [];
          const call = async (tool: string) => { const out = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool, arguments: {} })) as Out; callerSees.push(JSON.stringify(out)); return out; };
          const listed = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, op: "tools.list" })) as Out;
          callerSees.push(JSON.stringify(listed));
          expect(JSON.stringify(listed)).toContain("[REDACTED:STUB_TOKEN]"); // the description survives, scrubbed
          const leak = await call("mcp.stub.leak");
          expect(JSON.stringify(leak)).toContain("[REDACTED:STUB_TOKEN]");
          const fail = await call("mcp.stub.fail");
          expect(fail.ok).toBe(false);
          for (const seen of callerSees) for (const needle of [SECRET, b64, url]) expect(seen).not.toContain(needle);
          const everything = JSON.stringify(await allEvents(app));
          for (const needle of [SECRET, b64, url]) expect(everything).not.toContain(needle);
          for (const line of logged) for (const needle of [SECRET, b64, url]) expect(line).not.toContain(needle);
          await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
        } finally {
          await app.stop();
        }
      });
    } finally {
      Object.assign(console, originals);
    }
  }, 120000);
});

describe("J-CAP-t3-review-r1 finding 2: revoked or lapsed authority stops running servers", () => {
  test("revoking the operator root stops an operator-established server, kills its group and records it", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app, client } = booted;
      try {
        await install(booted, home, [{ id: "stub", command: ["bun", "${bundleDir}/server.mjs"] }]);
        const started = (await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })) as { pid: number };
        expect(alive(started.pid)).toBe(true);
        await client.invoke("authority.grant.revoke", { grantId: "grant-operator-root" });
        const exited = await waitUntil("authority-lost exit", async () => (await exits(app)).find((e) => e.capabilityId === CAP), 6000);
        expect(String(exited.stopReason)).toMatch(/^authority-lost:/);
        await waitUntil("process gone", async () => !alive(started.pid), 6000);
        const decisions = (await eventsOfType(app, "authority.decision.recorded")).map((e) => e.payload as Record<string, unknown>);
        expect(decisions.some((d) => d.operation === "mcp.reauthorize" && d.outcome === "refused" && d.capability === CAP)).toBe(true);
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("a section 1.5 deployment-invariant failure stops running servers too", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home, { graceMs: 400, killMs: 400, reauthorizeMs: 100 });
      const { app, client } = booted;
      const previous = process.env.COGNATE_POSTGRES_URL;
      try {
        await install(booted, home, [{ id: "stub", command: ["bun", "${bundleDir}/server.mjs"] }]);
        const started = (await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })) as { pid: number };
        process.env.COGNATE_POSTGRES_URL = "postgres://unused.invalid/db"; // external PostgreSQL without a single-writer declaration
        await waitUntil("process gone", async () => !alive(started.pid), 6000);
        await waitUntil("authority-lost record", async () => (await exits(app)).some((e) => String(e.stopReason).startsWith("authority-lost:deployment-invariant")) || undefined, 6000);
      } finally {
        if (previous === undefined) delete process.env.COGNATE_POSTGRES_URL; else process.env.COGNATE_POSTGRES_URL = previous;
        await app.stop();
      }
    });
  }, 120000);
});

describe("J-CAP-t3-review-r1 finding 3: reconciliation leaves no process of a spawn's group alive", () => {
  test("a child that spawned `sleep 30` and died between spawn and confirm is swept: nothing survives", async () => {
    const spawnId = `spawn-${randomUUID()}`;
    // The leader starts a grandchild (a different cwd, a different program) and is then killed, as a crash would.
    const leader = Bun.spawn(["sh", "-c", "cd /; sleep 30 & echo $! ; wait"], { env: { ...process.env, COGNATE_SPAWN_ID: spawnId }, detached: true, stdout: "pipe", stderr: "ignore" });
    const first = await leader.stdout.getReader().read(); // the pid line (the pipe stays open for the grandchild's lifetime)
    const grandchild = Number(new TextDecoder().decode(first.value).trim().split("\n")[0]);
    leader.kill(9);
    await leader.exited;
    expect(alive(grandchild)).toBe(true);
    const events: LedgerEvent[] = [];
    const outcome = await reconcileSpawnLedger(
      { ledger: async (_id, evs) => { events.push(...evs); }, slots: { acquire: async () => ({ slotId: "" }), release: async () => {} } },
      [{ spawnId, status: "intended", capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", worldKind: "local", bundleDir: "/nonexistent/bundle", argv: ["sh"] }],
    );
    try {
      expect(outcome[0]!.spawnId).toBe(spawnId);
      await waitUntil("grandchild dead", async () => !alive(grandchild), 3000);
    } finally {
      try { process.kill(grandchild, 9); } catch { /* already gone */ }
    }
  });

  test("the spawn record carries the group id, and after the child exits nothing of its group is alive", async () => {
    const events: LedgerEvent[] = [];
    const registry = createExecutionWorldRegistry([localExecutionWorld()]);
    const result = await spawnGoverned({
      registry, getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined, ledger: async (_id, evs) => { events.push(...evs); },
      recordRefusal: async () => {}, slots: { acquire: async () => ({ slotId: "s" }), release: async () => {} }, localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 200, killMs: 200,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["sh", "-c", "sleep 30 & sleep 30 & echo started; exec sleep 0.2"], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spawned = events.find((e) => e.type === "capability.mcp.spawned")!;
    expect(spawned.payload.pgid).toBe(result.handle.pid);
    await result.handle.exited;
    let survivors = true;
    try { process.kill(-result.handle.pid, 0); } catch { survivors = false; }
    expect(survivors).toBe(false);
  });
});

describe("J-CAP-t3-review-r1 finding 4: an untrusted schema cannot freeze the app", () => {
  const server = (schemas: Record<string, unknown>[]) => {
    let onData: (chunk: Buffer) => void = () => {};
    const reply = (id: unknown, result: unknown) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)));
    return {
      onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() {},
      write(data: string) {
        for (const line of data.split("\n").filter(Boolean)) {
          const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string } };
          if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } });
          else if (m.method === "tools/list") reply(m.id, { tools: schemas.map((s, i) => ({ name: `t${i}`, description: "d", inputSchema: s })) });
          else if (m.method === "tools/call") reply(m.id, { content: [{ type: "text", text: "ok" }] });
        }
      },
    };
  };

  test("`^(a+)+$` in a server schema validates in well under 50 ms; the pattern is stripped and the stripping recorded", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(server([{ type: "object", properties: { a: { type: "string", pattern: "^(a+)+$", format: "regex" } } }]) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const started = performance.now();
    const outcome = await client.callTool("t0", { a: `${"a".repeat(26)}!` }, { timeoutMs: 5000, actorId: "t" });
    expect(performance.now() - started).toBeLessThan(50);
    expect(outcome.ok).toBe(true);
    expect(JSON.stringify(records)).toContain("pattern");
  });

  test("oversize, over-deep and over-wide schemas are refused with a recorded refusal", async () => {
    let deep: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 40; i++) deep = { type: "object", properties: { x: deep } };
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`p${i}`, { type: "string" }])) };
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(server([deep, wide, { type: "object" }]) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    expect(client.tools().map((t) => t.name)).toEqual(["t2"]);
    expect(records.some((r) => r.payload.reasonCode === "schema-refused")).toBe(true);
  });
});

describe("J-CAP-t3-review-r1 finding 5: an early start does not deadlock boot reconciliation", () => {
  test("a start issued before reconciliation waits OUTSIDE the mutex; reconciliation finishes; later mutex users are not blocked", async () => {
    const mutex = createRuntimeMutex();
    const supervisor = createMcpSupervisor({
      tenant: "local", bootGate: true, mutex, getRecorder: () => ({ commitBatch: async () => ({}) }) as never,
      getIndex: () => new AuthorityIndex({ onCommitted: () => () => {} } as never, "local"), isEnabled: async () => true, readRows: async () => [],
      recordDecision: async () => {}, registry: () => ({}) as never, resolveSecret: async () => undefined,
      slots: { acquire: async () => ({ slotId: "" }), release: async () => {} }, getPosture: () => undefined, localHostSpawnAllowed: () => false,
    });
    const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    supervisor.component().activate({ provide: (c: { id: string }, h: never) => handlers.set(c.id, h), effects: { register() {} } } as never);
    const early = handlers.get("capability.mcp.start")!({ capabilityId: CAP, serverId: "stub" }, { actor: { id: "operator", kind: "user" } }).then(() => "started", (e: Error) => `refused: ${e.message}`);
    await sleep(50);
    expect(await Promise.race([mutex.run(async () => "free"), sleep(500).then(() => "blocked")])).toBe("free");
    expect(await Promise.race([supervisor.reconcileBoot().then(() => "reconciled"), sleep(1500).then(() => "deadlocked")])).toBe("reconciled");
    const settled = await Promise.race([early, sleep(1500).then(() => "never")]);
    expect(settled).toMatch(/^refused: .*no activation/);
  });
});

void join; void readFile;
