// Journey J-CAP-t3-review-r4: final Codex round on PR #39 (head 2322f26). Each test failed against 2322f26 and
// guards its fix. The structural rules: a spawn's group is derived from its marker holders; a fatal init never
// reconciles; server schemas are an allowlist; every recorded string is bounded as its final value; no
// server-originated free text is ever recorded.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { reconcileSpawnLedger, type LedgerEvent } from "../src/capabilities/execSpawn.ts";
import * as mcpManage from "../src/capabilities/mcpManage.ts";
import { McpClient, sanitizeSchema, utf8Bytes } from "../src/mcp/client.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { createRuntimeMutex } from "../src/workbench/runtimeMutex.ts";
import { LOCAL_POSTURE, authorStub, sleep, stubManifest } from "./mcp-helpers.ts";
import { allEvents, bootApp, enableCapabilityRuntime, registerBundle, withTempHome } from "./wb-helpers.ts";

const CAP = "capability.bundle.t3r4";
const { COGNATE_SPAWN_ID: _drop, ...cleanEnv } = process.env;
void _drop;
const baseRow = { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", worldKind: "local", bundleDir: "/nonexistent/bundle", argv: ["sh"] };
const groupAlive = (pgid: number): boolean => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("J-CAP-t3-review-r4 item 1: the group of every marker holder is ended before the slot is released", () => {
  test("a pre-confirmation crash: the marked parent died with the intent unconfirmed and its child cleared the marker; the child is ended too", async () => {
    const spawnId = `spawn-${randomBytes(4).toString("hex")}`;
    const parent = Bun.spawn(["sh", "-c", "env -i sleep 30 & echo $!; exec sleep 30"], { env: { ...cleanEnv, COGNATE_SPAWN_ID: spawnId } as Record<string, string>, detached: true, stdout: "pipe", stderr: "ignore" });
    const child = Number(new TextDecoder().decode((await parent.stdout.getReader().read()).value).trim());
    const released: string[] = [];
    let childAliveAtRelease: boolean | undefined;
    try {
      expect(alive(child)).toBe(true);
      const events: LedgerEvent[] = [];
      const out = await reconcileSpawnLedger({ graceMs: 300, ledger: async (_id, evs) => { events.push(...evs); }, slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { childAliveAtRelease = alive(child); released.push(id); } } },
        [{ ...baseRow, spawnId, status: "intended", slotId: "sl-pre" }]);
      expect(alive(child)).toBe(false);
      expect(groupAlive(parent.pid)).toBe(false);
      expect(released).toEqual(["sl-pre"]);
      expect(childAliveAtRelease).toBe(false);
      expect(out[0]!.outcome).not.toBe("reconcile-incomplete");
    } finally { try { process.kill(-parent.pid, 9); } catch { /* gone */ } try { process.kill(child, 9); } catch { /* gone */ } }
  });
});

describe("J-CAP-t3-review-r4 item 2: a fatal initialisation failure does not reconcile", () => {
  test("ready rejected: no ledger read, admission stays closed, the failure is recorded without its text", async () => {
    let reads = 0;
    const decisions: Record<string, unknown>[] = [];
    const supervisor = mcpManage.createMcpSupervisor({
      tenant: "local", bootGate: true, mutex: createRuntimeMutex(), getRecorder: () => ({ commitBatch: async () => ({}) }) as never,
      getIndex: () => new AuthorityIndex({ onCommitted: () => () => {} } as never, "local"), isEnabled: async () => true,
      readRows: async () => { reads += 1; return []; }, recordDecision: async (e) => { decisions.push(e.payload); }, registry: () => ({}) as never, resolveSecret: async () => undefined,
      slots: { acquire: async () => ({ slotId: "" }), release: async () => {} }, getPosture: () => undefined, localHostSpawnAllowed: () => false,
    });
    const index = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local", { awaitInitialRebuild: true });
    index.fail(new Error("PRIVATE-BOOT-TEXT"));
    await (mcpManage as unknown as { reconcileAfterIndex(i: unknown, s: unknown): Promise<void> }).reconcileAfterIndex(index, supervisor);
    expect(reads).toBe(0);
    const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    supervisor.component().activate({ provide: (c: { id: string }, h: never) => handlers.set(c.id, h), effects: { register() {} } } as never);
    await expect(handlers.get("capability.mcp.start")!({ capabilityId: CAP, serverId: "stub" }, { actor: { id: "operator", kind: "user" } })).rejects.toThrow();
    expect(decisions.some((d) => d.reasonCode === "boot-init-failed")).toBe(true);
    expect(JSON.stringify(decisions)).not.toContain("PRIVATE-BOOT-TEXT");
  });
});

// ---- a scripted stdio MCP server for the client-level tests ----
function scripted(options: { tools: Record<string, unknown>[]; call?: (params: { arguments?: unknown }) => { result?: unknown; error?: { code: number; message: string } } }) {
  let onData: (chunk: Buffer) => void = () => {};
  const reply = (frame: Record<string, unknown>) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`)));
  return {
    onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() {},
    write(data: string) {
      for (const line of data.split("\n").filter(Boolean)) {
        const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string; arguments?: unknown } };
        if (m.method === "initialize") reply({ id: m.id, result: { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } } });
        else if (m.method === "tools/list") reply({ id: m.id, result: { tools: options.tools } });
        else if (m.method === "tools/call") reply({ id: m.id, ...(options.call ? options.call(m.params ?? {}) : { result: { content: [{ type: "text", text: "ok" }] } }) });
      }
    },
  };
}

describe("J-CAP-t3-review-r4 item 3: server schemas are an allowlist and oversize results never reach the validators", () => {
  test("uniqueItems on ten 580-element object arrays validates in under 50 ms", async () => {
    const props = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, { type: "array", uniqueItems: true, items: { type: "object" } }]));
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object", properties: props } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const args = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, Array.from({ length: 580 }, (_, j) => ({ i: j }))]));
    const started = performance.now();
    const outcome = await client.callTool("t", args, { timeoutMs: 5000, actorId: "t" });
    expect(performance.now() - started).toBeLessThan(50);
    expect(outcome.ok).toBe(true);
    expect(JSON.stringify(records)).toContain("uniqueItems");
  });

  test("only the structural keywords survive; the rest is recorded as stripped", () => {
    const safe = sanitizeSchema({
      type: "object", title: "t", description: "d", required: ["a"], additionalProperties: { type: "string" },
      properties: { a: { type: "array", items: { type: "integer", minimum: 0, maximum: 9, exclusiveMinimum: -1, exclusiveMaximum: 10 }, minItems: 0, maxItems: 4, uniqueItems: true }, b: { enum: [1, 2], const: 1, default: 1, minLength: 1, maxLength: 3, format: "email", multipleOf: 2 }, c: { items: [{ type: "string" }] }, d: { anyOf: [{ type: "string" }], not: {} } },
      "x-vendor": { huge: true },
    });
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    expect(JSON.stringify(safe.schema)).toBe(JSON.stringify({
      type: "object", title: "t", description: "d", required: ["a"], additionalProperties: { type: "string" },
      properties: { a: { type: "array", items: { type: "integer", minimum: 0, maximum: 9, exclusiveMinimum: -1, exclusiveMaximum: 10 }, minItems: 0, maxItems: 4 }, b: { enum: [1, 2], const: 1, default: 1, minLength: 1, maxLength: 3 }, c: {}, d: {} },
    }));
    expect(safe.stripped.sort()).toEqual(["(other)", "anyOf", "format", "items(tuple)", "multipleOf", "not", "uniqueItems"].sort());
  });

  test("a tool result over the bound is refused before the SDK validates it", async () => {
    const big = "y".repeat(300_000);
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { v: { type: "string" } } } }], call: () => ({ result: { content: [{ type: "text", text: "ok" }], structuredContent: { v: big } } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    const outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "result_too_large" });
  });
});

describe("J-CAP-t3-review-r4 item 4: every recorded or returned message is bounded as its final string", () => {
  test("refusals and record failures stay within 512 bytes whatever prefix and detail they carry", async () => {
    const long = "é".repeat(3000);
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    let failRecords = false;
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object", properties: { n: { type: "integer" } }, additionalProperties: false } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { if (failRecords) throw new Error(`record store down: ${long}`); records.push(e); } });
    const outcomes = [
      await client.callTool(`${long}`, {}, { timeoutMs: 1000, actorId: "t" }),
      await client.callTool("t", { [long]: 1 }, { timeoutMs: 1000, actorId: "t" }),
      await client.callTool("t", { n: "x".repeat(70_000) }, { timeoutMs: 1000, actorId: "t" }),
    ];
    failRecords = true;
    outcomes.push(await client.callTool("t", {}, { timeoutMs: 1000, actorId: "t" }));
    expect(outcomes.map((o) => o.ok)).toEqual([false, false, false, false]);
    expect(outcomes[3]).toMatchObject({ code: "record_failed" });
    for (const o of outcomes) if (!o.ok) expect(utf8Bytes(o.message)).toBeLessThanOrEqual(512);
    const strings: string[] = [];
    const walk = (v: unknown): void => { if (typeof v === "string") strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(records);
    for (const s of strings) expect(utf8Bytes(s)).toBeLessThanOrEqual(512);
  });
});

describe("J-CAP-t3-review-r4 items 5 and 6: no server-originated text is persisted, and rejected names are hash-only", () => {
  const install = async (app: Parameters<typeof registerBundle>[0], client: Parameters<typeof registerBundle>[1], home: string, mode: string) => {
    const dir = await authorStub(home, `hostile-${mode}`);
    await copyFile(join(import.meta.dir, "fixtures/mcp-stub/hostile.mjs"), join(dir, "hostile.mjs"));
    await registerBundle(app, client, { capabilityId: CAP, sourceDir: dir, manifest: stubManifest([{ id: "hostile", command: ["bun", "${bundleDir}/hostile.mjs", mode] }]) });
    await client.invoke("capability.bundle.activate", { capabilityId: CAP });
  };

  test("a handshake error carrying private text leaves no trace in any record", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home, { executionPostureRecords: [LOCAL_POSTURE], mcpSupervisorTimings: { graceMs: 400, killMs: 400 } });
      try {
        await enableCapabilityRuntime(app, client);
        await install(app, client, home, "handshake");
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "hostile" })).rejects.toThrow(/handshake/);
        expect(JSON.stringify(await allEvents(app))).not.toContain("PRIVATE-HANDSHAKE-TEXT");
      } finally { await app.stop?.(); }
    });
  });

  test("stdout junk, a call error and an oversized tool name leave no private text in any record", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home, { executionPostureRecords: [LOCAL_POSTURE], mcpSupervisorTimings: { graceMs: 400, killMs: 400 } });
      try {
        await enableCapabilityRuntime(app, client);
        await install(app, client, home, "call");
        await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "hostile" });
        await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.hostile.boom", arguments: {} }).catch(() => {});
        await sleep(100);
        const text = JSON.stringify(await allEvents(app));
        expect(text).not.toContain("PRIVATE-CALL-TEXT");
        expect(text).not.toContain("PRIVATE-STDOUT-JUNK");
        expect(text).not.toContain("PRIVATE-NAME-");
      } finally { await app.stop?.(); }
    });
  });

  test("an oversized rejected tool name in a tools list is referenced by digest in the sanitizer's audit", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const hostile = `PRIVATE-NAME-${"x".repeat(900)}`;
    const client = await McpClient.connect(scripted({ tools: [{ name: "ok", description: "d", inputSchema: { type: "object" } }, { name: hostile, description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { a: { pattern: "x" } }, $async: true } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    expect(client.tools().map((t) => t.name)).toEqual(["ok"]);
    expect(JSON.stringify(records)).not.toContain("PRIVATE-NAME-");
    expect(JSON.stringify(client.excluded)).not.toContain("PRIVATE-NAME-");
  });
});
