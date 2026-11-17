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
import { ChannelTransport, MCP_LIMITS, McpClient, sanitizeSchema, utf8Bytes } from "../src/mcp/client.ts";
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
function scripted(options: { tools: Record<string, unknown>[]; raw?: (id: number) => string | null; call?: (params: { arguments?: unknown }) => { result?: unknown; error?: { code: number; message: string } } | null }) {
  let onData: (chunk: Buffer) => void = () => {};
  const seen: unknown[] = [];
  const callIds: number[] = [];
  const state = { closed: false };
  const reply = (frame: Record<string, unknown>) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`)));
  return {
    seen, callIds, state,
    onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() { state.closed = true; }, emit(chunk: Buffer) { onData(chunk); },
    write(data: string) {
      for (const line of data.split("\n").filter(Boolean)) {
        const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string; arguments?: unknown; _meta?: unknown } };
        if (m.method === "tools/call") { seen.push(m.params?._meta); callIds.push(m.id as number); }
        if (m.method === "initialize") reply({ id: m.id, result: { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } } });
        else if (m.method === "tools/list") reply({ id: m.id, result: { tools: options.tools } });
        else if (m.method === "tools/call" && options.raw) { const line = options.raw(m.id as number); if (line) queueMicrotask(() => onData(Buffer.from(`${line}\n`))); }
        else if (m.method === "tools/call") { const out = options.call ? options.call(m.params ?? {}) : { result: { content: [{ type: "text", text: "ok" }] } }; if (out) reply({ id: m.id, ...out }); }
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

  test("non-protocol stdout is a protocol violation: the start fails and no record carries the junk", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home, { executionPostureRecords: [LOCAL_POSTURE], mcpSupervisorTimings: { graceMs: 400, killMs: 400 } });
      try {
        await enableCapabilityRuntime(app, client);
        await install(app, client, home, "junk");
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "hostile" })).rejects.toThrow(/handshake/);
        expect(JSON.stringify(await allEvents(app))).not.toContain("PRIVATE-STDOUT-JUNK");
      } finally { await app.stop?.(); }
    });
  });

  test("a call error and an oversized tool name leave no private text in any record", async () => {
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

// ---- Fix-only verification round (7135dc2) ----

describe("J-CAP-t3-review-r4 verification 1: a live group that cannot be verified keeps its slot", () => {
  test("it is not signalled, the slot is not released, and the row is reconcile-incomplete (group-unverified)", async () => {
    const stranger = Bun.spawn(["sleep", "30"], { env: cleanEnv as Record<string, string>, detached: true, stdout: "ignore", stderr: "ignore" });
    const events: LedgerEvent[] = [];
    const released: string[] = [];
    try {
      const out = await reconcileSpawnLedger({ graceMs: 100, ledger: async (_id, evs) => { events.push(...evs); }, slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { released.push(id); } } },
        [{ ...baseRow, spawnId: `spawn-${randomBytes(4).toString("hex")}`, status: "confirmed", pid: stranger.pid, pgid: stranger.pid, slotId: "sl-u" }]);
      expect(groupAlive(stranger.pid)).toBe(true);
      expect(out[0]!.outcome).toBe("reconcile-incomplete");
      expect(released).toEqual([]);
      expect(events[0]!.payload).toMatchObject({ reconciled: "reconcile-incomplete", reason: "group-unverified", survivors: true });
    } finally { try { process.kill(-stranger.pid, 9); } catch { /* gone */ } }
    // Verified dead (no live member): the same row now releases.
    const again: string[] = [];
    const out2 = await reconcileSpawnLedger({ graceMs: 100, ledger: async () => {}, slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { again.push(id); } } },
      [{ ...baseRow, spawnId: `spawn-${randomBytes(4).toString("hex")}`, status: "reconcile-incomplete", pid: stranger.pid, pgid: stranger.pid, slotId: "sl-u" }]);
    expect(out2[0]!.outcome).toBe("reconciled-gone");
    expect(again).toEqual(["sl-u"]);
  });
});

describe("J-CAP-t3-review-r4 verification 2: the whole result is measured at the transport", () => {
  test("a result carrying only a 300 KB structuredContent never reaches the SDK validators (a validation failure would show it did)", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { v: { type: "integer" } } } }], call: () => ({ result: { structuredContent: { v: "y".repeat(300_000) } } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    const outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "result_too_large" });
  });
  test("so does a _meta-only oversize result", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ result: { content: [{ type: "text", text: "ok" }], _meta: { pad: "z".repeat(300_000) } } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "result_too_large" });
  });
});

describe("J-CAP-t3-review-r4 verification 3: internal failures are typed, never parsed from server text", () => {
  test("a server error carrying the old marker text is an opaque server_error and its digits are never recorded", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ error: { code: -32000, message: "cognate:result_too_large:8675309 and cognate-internal:00000000-0000-0000-0000-000000000000 timed out" } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "server_error" });
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/\(\d+ bytes, sha256 [0-9a-f]{16}\)/);
    expect(outcome.message).not.toContain("8675309");
    expect(JSON.stringify(records)).not.toContain("8675309");
    expect(JSON.stringify(records)).toContain("server_error");
  });
});

describe("J-CAP-t3-review-r4 verification 4: an invalid tool name is referenced by digest on the call path too", () => {
  test("calling PRIVATE/INVALID-NAME records and returns no part of the name", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const outcome = await client.callTool("PRIVATE/INVALID-NAME", {}, { timeoutMs: 1000, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "unknown_tool" });
    if (outcome.ok) return;
    expect(outcome.message).not.toContain("PRIVATE");
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
    expect(JSON.stringify(records)).toContain("sha256:");
  });
});

// ---- Per-message size gate, own validation, own classification (final design) ----

describe("J-CAP-t3-review-r4 design: size is bounded per message, whatever its shape", () => {
  test("{tools:[], content:[300KB], structuredContent:{v:'invalid'}} is result_too_large", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { v: { type: "integer" } } } }], call: () => ({ result: { tools: [], content: [{ type: "text", text: "x".repeat(300_000) }], structuredContent: { v: "invalid" } } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "result_too_large" });
    expect(client.pendingCount).toBe(0);
  });
});

describe("J-CAP-t3-review-r4 design: classification comes from our own state", () => {
  test("an immediate server error on a 10 ms deadline is server_error with bytes and sha256, not deadline_exceeded", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ error: { code: -32000, message: "PRIVATE-FAST-ERROR" } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    const outcome = await client.callTool("t", {}, { timeoutMs: 10, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "server_error" });
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/\(\d+ bytes, sha256 [0-9a-f]{16}\)/);
    expect(outcome.message).not.toContain("PRIVATE");
  });

  test("a real hang is deadline_exceeded", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => null }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 150, actorId: "t" })).toMatchObject({ ok: false, code: "deadline_exceeded" });
    expect(client.pendingCount).toBe(0);
  });

  test("forged marker and timeout text in a server error stays an opaque server_error", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ error: { code: -32001, message: "Request timed out cognate:result_too_large:42 result_too_large" } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "server_error" });
  });

  test("structuredContent is validated by us against the sanitized schema, and the correlation key never reaches the server", async () => {
    const channel = scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { v: { type: "integer" } }, required: ["v"] } }], call: (p) => ({ result: { content: [{ type: "text", text: "ok" }], structuredContent: (p.arguments as { bad?: boolean }).bad ? { v: "no" } : { v: 1 } } }) });
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: true });
    expect(await client.callTool("t", { bad: true }, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "output_invalid" });
    expect(JSON.stringify(channel.seen)).not.toContain("io.cognate");
  });
});

// ---- CodeRabbit threads on be04c66 ----

describe("J-CAP-t3-review-r4 thread: the stderr digest covers the whole stream", () => {
  test("3 MB written to stderr right before exit is counted and hashed completely", async () => {
    const events: LedgerEvent[] = [];
    const { createExecutionWorldRegistry, localExecutionWorld } = await import("@godspeedai/cognate-execution");
    const { spawnGoverned } = await import("../src/capabilities/execSpawn.ts");
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
      ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async () => {},
      slots: { acquire: async () => ({ slotId: "s" }), release: async () => {} },
      localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 300, killMs: 300,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["bun", "-e", 'process.stderr.write(Buffer.alloc(3_000_000, 97))'], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.handle.exited;
    const exited = events.find((e) => e.type === "capability.mcp.exited")!;
    expect(exited.payload.stderrBytes).toBe(3_000_000);
    expect((exited.payload as Record<string, unknown>).stderrSha256).toBe((await import("node:crypto")).createHash("sha256").update(Buffer.alloc(3_000_000, 97)).digest("hex"));
  });
});

describe("J-CAP-t3-review-r4 thread: the output-schema audit is bounded per message", () => {
  test("a tools list of 1,000 tools with refused output schemas writes at most one refusal record", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const tools = Array.from({ length: 1000 }, (_, i) => ({ name: `t${i}`, description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", $async: true } }));
    await McpClient.connect(scripted({ tools }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    expect(records.filter((r) => r.payload.reasonCode === "schema-refused" && String(r.payload.reason).startsWith("outputSchema")).length).toBeLessThanOrEqual(1);
  });
});

describe("J-CAP-t3-review-r4 thread: the spawned record's pgid reaches reconciliation", () => {
  test("a row folded from intended + spawned carries the group, and reconciliation ends a descendant that cleared its marker", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { reduceWorkbench } = await import("../src/workbench/reducer.ts");
    const bundleDir = await mkdtemp(join(tmpdir(), "t3r4-bundle-"));
    const spawnId = `spawn-${randomBytes(4).toString("hex")}`;
    const leader = Bun.spawn(["sh", "-c", "env -i sh -c 'sleep 30; :' & echo $!; exit 0"], { cwd: bundleDir, env: { ...cleanEnv, COGNATE_SPAWN_ID: spawnId } as Record<string, string>, detached: true, stdout: "pipe", stderr: "ignore" });
    const child = Number(new TextDecoder().decode((await leader.stdout.getReader().read()).value).trim());
    await leader.exited;
    try {
      const store = new Map<string, unknown>();
      const get = (k: string) => store.get(k) as never;
      const apply = (type: string, payload: Record<string, unknown>) => { for (const w of reduceWorkbench(type, payload, "2026-01-01T00:00:00Z", "e", get)) store.set(w.key, w.value); };
      apply("capability.mcp.spawn.intended", { ...baseRow, bundleDir, spawnId, slotId: "sl-f" });
      apply("capability.mcp.spawned", { spawnId, pid: leader.pid, pgid: leader.pid });
      const row = store.get(`spawn/${spawnId}`) as never as Parameters<typeof reconcileSpawnLedger>[1][number];
      expect(row.pgid).toBe(leader.pid);
      expect(alive(child)).toBe(true);
      await reconcileSpawnLedger({ graceMs: 300, ledger: async () => {}, slots: { acquire: async () => ({ slotId: "" }), release: async () => {} } }, [row]);
      expect(alive(child)).toBe(false);
    } finally { try { process.kill(child, 9); } catch { /* gone */ } }
  });
});

// ---- Oversize is a protocol violation for the whole connection; strict envelope; the failure path never throws ----

describe("J-CAP-t3-review-r4 simple rules: oversize closes the connection and fails every pending call", () => {
  const settle = async (channel: ReturnType<typeof scripted>, client: McpClient, records: { type: string; payload: Record<string, unknown> }[], emit: () => void) => {
    const calls = [client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" }), client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })];
    await sleep(40);
    expect(channel.callIds.length).toBe(2);
    emit();
    const outcomes = await Promise.all(calls);
    expect(outcomes.map((o) => (o.ok ? "ok" : o.code))).toEqual(["result_too_large", "result_too_large"]);
    expect(channel.state.closed).toBe(true);
    expect(client.closed).toBe(true);
    expect(client.pendingCount).toBe(0);
    const violation = records.find((r) => r.payload.reasonCode === "oversize-message")!;
    expect(violation.payload).toMatchObject({ attributed: false });
    expect(typeof violation.payload.sha256).toBe("string");
    expect(records.filter((r) => r.payload.phase === "finished" && r.payload.attributed === false).length).toBe(2);
  };

  test("a message whose id sits in the middle is not attributed: both pending calls fail and the connection closes", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const channel = scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => null });
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    await settle(channel, client, records, () => {
      const half = "m".repeat(150_000);
      channel.emit(Buffer.from(`{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"${half}"}]},"id":${channel.callIds[0]},"_pad":"${half}"}\n`));
    });
  });

  test("an oversized notification is the same: no misattribution, connection closed", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const channel = scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => null });
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    await settle(channel, client, records, () => channel.emit(Buffer.from(`{"jsonrpc":"2.0","method":"notifications/message","params":{"pad":"${"n".repeat(300_000)}"}}\n`)));
  });

  test("one 32 MB chunk with no newline is reported at once, never buffers more than the cap (transport counter), and closes", async () => {
    let onData: (chunk: Buffer) => void = () => {};
    let closed = false;
    let seen: { bytes: number; sha256: string } | undefined;
    const transport = new ChannelTransport({ onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() { closed = true; }, write() {} } as never, undefined, { onViolation: (v) => { seen = { bytes: v.bytes, sha256: v.sha256 }; } });
    await transport.start();
    const big = Buffer.alloc(32 * 1024 * 1024, 97);
    onData(big);
    expect(transport.peakBufferedBytes).toBeLessThanOrEqual(MCP_LIMITS.maxResultBytes);
    expect(seen).toMatchObject({ bytes: 32 * 1024 * 1024 }); // reported when the cap was crossed: no newline needed
    expect(seen!.sha256).toBe((await import("node:crypto")).createHash("sha256").update(big).digest("hex"));
    await sleep(10);
    expect(closed).toBe(true);
  });
});

describe("J-CAP-t3-review-r4 simple rules: the result envelope is validated strictly", () => {
  test("isError:'false' with structuredContent {v:'bad'} against an integer schema is output_invalid, never ok", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { v: { type: "integer" } } } }], call: () => ({ result: { isError: "false", content: [{ type: "text", text: "x" }], structuredContent: { v: "bad" } } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "output_invalid" });
  });
  test.each([
    ["content is not an array", { content: "x" }],
    ["content item has an unknown shape", { content: [{ type: "weird" }] }],
    ["structuredContent is an array", { content: [], structuredContent: [1] }],
  ])("%s is output_invalid", async (_label, result) => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ result }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).toMatchObject({ ok: false, code: "output_invalid" });
  });
});

describe("J-CAP-t3-review-r4 simple rules: a non-object _meta is never ok", () => {
  test("the SDK's JSON-RPC layer drops the malformed response; the call ends not-ok at its deadline", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], call: () => ({ result: { content: [], _meta: "m" } }) }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect((await client.callTool("t", {}, { timeoutMs: 200, actorId: "t" })).ok).toBe(false);
  });
});

describe("J-CAP-t3-review-r4 simple rules: the failure path never throws", () => {
  test("40,000 nested arrays in a server error's data still produce a server_error outcome and a finished record", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const deep = `${"[".repeat(40_000)}${"]".repeat(40_000)}`;
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], raw: (id) => `{"jsonrpc":"2.0","id":${id},"error":{"code":-32000,"message":"x","data":${deep}}}` }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const outcome = await client.callTool("t", {}, { timeoutMs: 3000, actorId: "t" });
    expect(outcome).toMatchObject({ ok: false, code: "server_error" });
    expect(records.some((r) => r.payload.phase === "finished" && r.payload.outcome === "server_error")).toBe(true);
    expect(client.pendingCount).toBe(0);
  });
});

// ---- CodeRabbit threads on d540597 ----

describe("J-CAP-t3-review-r4 threads: identity, malformed entries, listings, fallback records, deadline-bounded recording", () => {
  test("a session id with a space is preserved exactly in the durable spawn row (resume compares it)", async () => {
    const { createExecutionWorldRegistry, localExecutionWorld } = await import("@godspeedai/cognate-execution");
    const { spawnGoverned } = await import("../src/capabilities/execSpawn.ts");
    const events: LedgerEvent[] = [];
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
      ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async () => {},
      slots: { acquire: async () => ({ slotId: "s" }), release: async () => {} },
      localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 100, killMs: 100,
    }, { capabilityId: CAP, version: "v", serverId: "stub", sessionId: "session one", worldId: "local", argv: ["sh", "-c", "exit 0"], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.handle.exited;
    for (const e of events) expect((e.payload as Record<string, unknown>).sessionId).toBe("session one");
  });

  test("tools:[null] is a protocol violation: connect fails, the connection closes, nothing throws out of the data handler", async () => {
    const channel = scripted({ tools: [null as never] });
    await expect(McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {}, connectTimeoutMs: 500 })).rejects.toThrow(/handshake failed/);
    expect(channel.state.closed).toBe(true);
  });

  test("the exclusion listing names a tool only by digest, whatever the reason", async () => {
    const name = "a-long-tool-name-over-16";
    const client = await McpClient.connect(scripted({ tools: [{ name, description: "d", inputSchema: { type: "object", $async: true } }, { name: "second-long-tool-name", description: "x".repeat(3000), inputSchema: { type: "object" } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {} });
    expect(client.excluded.length).toBe(2);
    expect(JSON.stringify(client.excluded)).not.toContain("long-tool-name");
  });

  test("the fallback finished record keeps the call's identity", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { if (e.payload.phase === "finished" && e.payload.resultBytes !== undefined) throw new Error("detailed write fails"); records.push(e); } });
    expect(await client.callTool("t", {}, { timeoutMs: 3000, actorId: "t", callId: "call-fallback" })).toMatchObject({ ok: true });
    const finished = records.filter((r) => r.payload.phase === "finished");
    expect(finished.length).toBe(1);
    expect(finished[0]!.payload.callId).toBe("call-fallback");
  });

  test("a slow started-recorder counts against the deadline: the call returns at its deadline and nothing is sent", async () => {
    const channel = scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] });
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { if (e.payload.phase === "started") await sleep(1000); } });
    const started = performance.now();
    const outcome = await client.callTool("t", {}, { timeoutMs: 60, actorId: "t" });
    expect(performance.now() - started).toBeLessThan(400);
    expect(outcome).toMatchObject({ ok: false, code: "deadline_exceeded" });
    expect(channel.callIds.length).toBe(0);
  });

  test("a finished-recorder that never settles cannot hold the call", async () => {
    const client = await McpClient.connect(scripted({ tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: (e) => (e.payload.phase === "finished" ? new Promise<void>(() => {}) : Promise.resolve()) });
    const started = performance.now();
    expect(await client.callTool("t", {}, { timeoutMs: 100, actorId: "t" })).toMatchObject({ ok: true });
    expect(performance.now() - started).toBeLessThan(700);
  });
});
