// Journey J-CAP-t3-review-r3: independent review round 3 on PR #39 (tranche T3). Each test failed against
// 7a3c63e for the stated reason and guards its fix.
import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import Ajv from "ajv";
import { reconcileSpawnLedger, spawnGoverned, type LedgerEvent, type ProcView } from "../src/capabilities/execSpawn.ts";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { McpClient, boundBytes, sanitizeSchema, utf8Bytes } from "../src/mcp/client.ts";
import { reduceWorkbench } from "../src/workbench/reducer.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { createRuntimeMutex } from "../src/workbench/runtimeMutex.ts";
import { LOCAL_POSTURE } from "./mcp-helpers.ts";

const CAP = "capability.bundle.t3r3";
const stubborn: ProcView = { readCmdline: async () => undefined, readCwd: async () => undefined, listPids: async () => [], pidsWithSpawnId: async () => [99_999_999] };
const baseRow = { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", worldKind: "local", bundleDir: "/nonexistent/bundle", argv: ["sh"] };

describe("J-CAP-t3-review-r3 finding 1: survivors keep their slot at boot and on the normal stop path", () => {
  test("boot frees orphaned slots but keeps the slot of a spawn whose reconciliation is incomplete, and records it", async () => {
    const reserved = new Set(["sl-survivor", "sl-orphan"]);
    const events: LedgerEvent[] = [];
    const supervisor = createMcpSupervisor({
      tenant: "local", bootGate: true, mutex: createRuntimeMutex(), getRecorder: () => ({ commitBatch: async (_k: string, evs: LedgerEvent[]) => { events.push(...evs); return {}; } }) as never,
      getIndex: () => new AuthorityIndex({ onCommitted: () => () => {} } as never, "local"), isEnabled: async () => true,
      readRows: async () => [{ key: "spawn/spawn-s", value: { ...baseRow, spawnId: "spawn-s", status: "confirmed", pid: 99_999_998, pgid: 99_999_998, slotId: "sl-survivor" } }],
      recordDecision: async () => {}, registry: () => ({}) as never, resolveSecret: async () => undefined,
      slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { reserved.delete(id); }, releaseAll: async (keep: readonly string[] = []) => { for (const id of [...reserved]) if (!keep.includes(id)) reserved.delete(id); } },
      getPosture: () => undefined, localHostSpawnAllowed: () => false, proc: stubborn, graceMs: 50,
    });
    const outcomes = await supervisor.reconcileBoot();
    expect(outcomes[0]!.outcome).toBe("reconcile-incomplete");
    expect([...reserved]).toEqual(["sl-survivor"]);
  });

  test("normal stop with a survivor records reconcile-incomplete and keeps the slot", async () => {
    const events: LedgerEvent[] = [];
    const released: string[] = [];
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
      ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async () => {},
      slots: { acquire: async () => ({ slotId: "s" }), release: async (id) => { released.push(id); } },
      localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 50, killMs: 50, proc: stubborn,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["sh", "-c", "exec sleep 0.1"], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.handle.exited;
    const exited = events.find((e) => e.type === "capability.mcp.exited")!;
    expect(exited.payload).toMatchObject({ outcome: "reconcile-incomplete", survivors: true });
    expect(released).toEqual([]);
  });
});

describe("J-CAP-t3-review-r3 finding 2: server schemas may not use references", () => {
  const defs: Record<string, unknown> = { d0: { type: "object" } };
  for (let i = 1; i < 28; i++) defs[`d${i}`] = { allOf: [{ $ref: `#/$defs/d${i - 1}` }, { $ref: `#/$defs/d${i - 1}` }] };
  const bomb = { type: "object", $defs: defs, allOf: [{ $ref: "#/$defs/d27" }] };

  test("the 28-definition schema validates {} in under 20 ms with its references stripped", () => {
    const ajv = new Ajv({ strict: false });
    ajv.compile({ type: "object", properties: { a: { allOf: [{ type: "string" }] } } })({}); // warm the compiler
    const started = performance.now();
    const safe = sanitizeSchema(bomb);
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    const validate = ajv.compile(safe.schema);
    expect(validate({})).toBe(true);
    expect(performance.now() - started).toBeLessThan(20);
    // r4: the allowlist drops the combinator and the definitions before any reference is reached.
    expect(safe.stripped).toEqual(expect.arrayContaining(["strip.reference", "strip.combinator"]));
    expect(JSON.stringify(safe.schema)).not.toContain("$ref");
  });

  function server(tool: Record<string, unknown>) {
    let onData: (chunk: Buffer) => void = () => {};
    const reply = (id: unknown, result: unknown) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)));
    return {
      onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() {},
      write(data: string) {
        for (const line of data.split("\n").filter(Boolean)) {
          const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string } };
          if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } });
          else if (m.method === "tools/list") reply(m.id, { tools: [tool] });
          else if (m.method === "tools/call") reply(m.id, { content: [{ type: "text", text: "ok" }], structuredContent: {} });
        }
      },
    };
  }

  test("input and output schemas on the client path are stripped, the call is fast, and the stripping is recorded", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(server({ name: "t", description: "d", inputSchema: bomb, outputSchema: bomb }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const started = performance.now();
    const outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
    expect(outcome.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
    expect(JSON.stringify(client.tools())).not.toContain("$ref");
    const stripped = records.filter((r) => r.payload.reasonCode === "schema-sanitized").map((r) => JSON.stringify(r.payload.stripped));
    expect(stripped.length).toBeGreaterThanOrEqual(2); // input and output
    expect(stripped.every((s) => s.includes("strip.combinator"))).toBe(true);
  });
});

describe("J-CAP-t3-review-r3 finding 3: server stderr content is never recorded", () => {
  test("a 6,000-character secret emitted as UTF-16LE base64 leaves no 16-character substring of any encoding in the records", async () => {
    const secret = randomBytes(4500).toString("base64").slice(0, 6000);
    const events: LedgerEvent[] = [];
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => secret,
      ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async () => {},
      slots: { acquire: async () => ({ slotId: "s" }), release: async () => {} },
      localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 300, killMs: 300,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["bun", "-e", 'process.stderr.write(Buffer.from(process.env.BIG, "utf16le").toString("base64")); process.stderr.write(process.env.BIG); process.exit(3)'], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [{ env: "BIG", key: "big" }], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.handle.exited;
    const text = JSON.stringify(events);
    const wide = Buffer.from(secret, "utf16le");
    const bytes = Buffer.from(secret, "utf8");
    const encodings = [secret, bytes.toString("base64"), bytes.toString("hex"), wide.toString("base64"), wide.toString("hex"), wide.toString("base64url")];
    for (const enc of encodings) for (let i = 0; i + 16 <= enc.length; i += 1) if (text.includes(enc.slice(i, i + 16))) throw new Error(`an encoding of the secret leaked into the records at offset ${i}`);
    const exited = events.find((e) => e.type === "capability.mcp.exited")!;
    expect(exited.payload).not.toHaveProperty("stderrTail");
    expect(exited.payload.stderrBytes).toBe(Buffer.from(secret, "utf16le").toString("base64").length + secret.length);
    expect(typeof exited.payload.stderrSha256).toBe("string");
    void createHash;
  });
});

// ---- Round 2 of review threads (CodeRabbit on PR #39) ----

const groupAlive = (pgid: number): boolean => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
const { COGNATE_SPAWN_ID: _drop, ...cleanEnv } = process.env;
void _drop;

describe("J-CAP-t3-review-r3 thread: a recorded group id is signalled only when a live member proves it ours", () => {
  test("an unrelated group that now holds the recorded id is never signalled, and the sweep records that", async () => {
    const stranger = Bun.spawn(["sleep", "30"], { env: cleanEnv as Record<string, string>, detached: true, stdout: "ignore", stderr: "ignore" });
    const events: LedgerEvent[] = [];
    try {
      const out = await reconcileSpawnLedger({ graceMs: 100, ledger: async (_id, evs) => { events.push(...evs); }, slots: { acquire: async () => ({ slotId: "" }), release: async () => {} } },
        [{ ...baseRow, spawnId: `spawn-${randomBytes(4).toString("hex")}`, status: "confirmed", pid: stranger.pid, pgid: stranger.pid, slotId: "sl-x" }]);
      expect(groupAlive(stranger.pid)).toBe(true);
      expect(out[0]!.outcome).toBe("reconcile-incomplete"); // r4: alive but unverified keeps the slot
      expect(events[0]!.payload).toMatchObject({ groupUnverified: true });
    } finally { try { process.kill(-stranger.pid, 9); } catch { /* gone */ } }
  });
});

describe("J-CAP-t3-review-r3 thread: survivors are re-targeted until verified gone", () => {
  const fold = (payload: Record<string, unknown>) => reduceWorkbench("capability.mcp.exited", payload, "2026-01-01T00:00:00Z", "e1", () => ({ ...baseRow, spawnId: "spawn-1", status: "confirmed" }) as never);
  test("an exit record that reports survivors folds to the one explicit status, whatever its outcome", () => {
    const [write] = fold({ spawnId: "spawn-1", outcome: "crashed", survivors: true, exitCode: 1 });
    expect(write!.value).toMatchObject({ status: "reconcile-incomplete" });
  });
  test("a reconcile-incomplete row is swept again at the next boot and its slot freed once nothing survives", async () => {
    const spawnId = `spawn-${randomBytes(4).toString("hex")}`;
    const child = Bun.spawn(["sleep", "30"], { env: { ...cleanEnv, COGNATE_SPAWN_ID: spawnId } as Record<string, string>, detached: true, stdout: "ignore", stderr: "ignore" });
    const released: string[] = [];
    try {
      const out = await reconcileSpawnLedger({ graceMs: 300, ledger: async () => {}, slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { released.push(id); } } },
        [{ ...baseRow, spawnId, status: "reconcile-incomplete", pid: child.pid, pgid: child.pid, slotId: "sl-again" }]);
      expect(out[0]!.outcome).toBe("reconciled-killed");
      expect(released).toEqual(["sl-again"]);
      expect(groupAlive(child.pid)).toBe(false);
    } finally { try { process.kill(-child.pid, 9); } catch { /* gone */ } }
  });
});

describe("J-CAP-t3-review-r3 thread: reconciliation waits for the real index initialisation", () => {
  test("`ready` is pending from construction until the first rebuild completes, and rejects on a fatal failure", async () => {
    const store = { onCommitted: () => () => {} } as never;
    const index = new AuthorityIndex(store, "local", { awaitInitialRebuild: true });
    let settled = false;
    void index.ready.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    await index.rebuild([]);
    await index.ready;
    expect(settled).toBe(true);
    const failing = new AuthorityIndex(store, "local", { awaitInitialRebuild: true });
    failing.fail(new Error("fatal"));
    await expect(failing.ready).rejects.toThrow("fatal");
  });
});

describe("J-CAP-t3-review-r3 thread: a truncated message stays within its byte bound", () => {
  test("ASCII and multibyte input, with the marker counted", () => {
    for (const text of ["a".repeat(513), "é".repeat(400), "😀".repeat(200), "日本語".repeat(100)]) {
      const out = boundBytes(text, 512);
      expect(utf8Bytes(out)).toBeLessThanOrEqual(512);
      expect(out.endsWith("...")).toBe(true);
      expect(out).not.toContain("\uFFFD");
      expect([...out].every((ch) => ch.codePointAt(0)! < 0xd800 || ch.codePointAt(0)! > 0xdfff)).toBe(true);
    }
    expect(boundBytes("short", 512)).toBe("short");
  });
});

describe("J-CAP-t3-review-r3 thread: the sanitizer walks schema positions, not property names or data", () => {
  test("properties named like keywords, and enum/const/required data, survive; keywords in schema positions are still stripped", () => {
    const schema = {
      type: "object", additionalProperties: false, required: ["patternProperties", "pattern"],
      properties: { patternProperties: { type: "string" }, pattern: { type: "string", pattern: "^(a+)+$" }, $ref: { type: "string" }, definitions: { type: "string" }, kind: { enum: ["format", "pattern", "$ref"], const: "pattern" } },
    };
    const safe = sanitizeSchema(schema);
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    const props = safe.schema.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(props)).toEqual(["patternProperties", "pattern", "$ref", "definitions", "kind"]);
    expect(props.pattern).toEqual({ type: "string" });
    expect(props.kind).toEqual({ enum: ["format", "pattern", "$ref"], const: "pattern" });
    expect(safe.schema.required).toEqual(["patternProperties", "pattern"]);
    expect(safe.stripped).toEqual(["strip.pattern"]);
    const validate = new Ajv({ strict: false }).compile(safe.schema);
    expect(validate({ patternProperties: "x", pattern: "y" })).toBe(true);
  });
});

describe("J-CAP-t3-review-r3 thread: the call sends exactly what was validated and recorded", () => {
  function recorder() {
    let onData: (chunk: Buffer) => void = () => {};
    const sent: unknown[] = [];
    let resultText = "ok";
    const reply = (id: unknown, result: unknown) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)));
    const channel = {
      onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() {},
      write(data: string) {
        for (const line of data.split("\n").filter(Boolean)) {
          const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string; arguments?: unknown } };
          if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } });
          else if (m.method === "tools/list") reply(m.id, { tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }] });
          else if (m.method === "tools/call") { sent.push(m.params?.arguments); reply(m.id, { content: [{ type: "text", text: resultText }] }); }
        }
      },
    };
    return { channel, sent, setResult: (t: string) => { resultText = t; } };
  }

  test("mutating the arguments while the started record is written does not change what the server receives", async () => {
    const { channel, sent } = recorder();
    const args: Record<string, unknown> = { a: "validated" };
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { if (e.payload.phase === "started") args.a = "mutated"; } });
    await client.callTool("t", args, { timeoutMs: 5000, actorId: "t" });
    expect(sent).toEqual([{ a: "validated" }]);
  });

  test("the size bound applies to the scrubbed result: redaction that expands it past the bound is refused with the scrubbed size", async () => {
    const { channel, setResult } = recorder();
    setResult("tok12345".repeat(20_000)); // 160 KB raw, 320 KB once each token becomes the 16-byte mark
    const client = await McpClient.connect(channel as never, { capabilityId: CAP, version: "v", serverId: "f", record: async () => {}, scrub: (t) => t.replaceAll("tok12345", "[REDACTED:TOK]") });
    const outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("result_too_large");
    expect(outcome.message).toMatch(/2[6-9]\d\d\d\d bytes after redaction/);
  });
});
