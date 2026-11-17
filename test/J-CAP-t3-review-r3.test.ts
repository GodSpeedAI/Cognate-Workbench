// Journey J-CAP-t3-review-r3: independent review round 3 on PR #39 (tranche T3). Each test failed against
// 7a3c63e for the stated reason and guards its fix.
import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import Ajv from "ajv";
import { spawnGoverned, type LedgerEvent, type ProcView } from "../src/capabilities/execSpawn.ts";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { McpClient, sanitizeSchema } from "../src/mcp/client.ts";
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
    expect(safe.stripped).toEqual(expect.arrayContaining(["$ref", "$defs"]));
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
    expect(stripped.every((s) => s.includes("$ref"))).toBe(true);
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
