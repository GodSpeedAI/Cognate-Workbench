// Journey J-CAP-t3-review-r8: Codex round 8 on PR #39 (head ed53cea). Each test failed against ed53cea and is measured at
// ground truth: the SDK's `_responseHandlers` and `_timeoutInfo`, the compiler cache's actual bytes, the reserved-slot table, and
// whether the brand can be constructed. The class: a connection owns its per-connection resources and one `dispose()` frees them.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { spawnGoverned } from "../src/capabilities/execSpawn.ts";
import { McpClient, type StdioChannel } from "../src/mcp/client.ts";
import { text } from "../src/mcp/typedRecord.ts";
import { LOCAL_POSTURE } from "./mcp-helpers.ts";

type Sdk = { _responseHandlers: Map<unknown, unknown>; _timeoutInfo: Map<unknown, unknown> };
const sdkOf = (c: McpClient): Sdk => (c as unknown as { sdk: Sdk }).sdk;
const bigSchema = (i: number) => ({ type: "object", properties: Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`p${k}`, { type: "string", description: `field ${i}-${k} ${"x".repeat(200)}` }])) });
const record = async (): Promise<void> => {};

/** A stub server channel; `onCall` decides what to do with a tools/call write. */
function channel(opts: { tools?: unknown[]; onCall?: (id: unknown) => void | Promise<void>; closeStalls?: boolean; closes?: { n: number } }): StdioChannel & { drop(): void } {
  let listener: (c: Buffer) => void | Promise<void> = () => {};
  let closeListener: () => void = () => {};
  const reply = (id: unknown, result: unknown): void => queueMicrotask(() => { void listener(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)); });
  return {
    onData: (l) => { listener = l; }, onClose: (l) => { closeListener = l; },
    close: () => { if (opts.closes) opts.closes.n++; return opts.closeStalls ? new Promise<void>(() => {}) : Promise.resolve(); },
    drop: () => closeListener(),
    write: (s: string) => {
      const m = JSON.parse(s) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
      if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "t", version: "1" } });
      else if (m.method === "tools/list") reply(m.id, { tools: opts.tools ?? [{ name: "t", inputSchema: { type: "object" } }] });
      else if (m.method === "tools/call") return opts.onCall?.(m.id);
    },
  };
}
const connect = (ch: StdioChannel) => McpClient.connect(ch, { serverId: "t", version: "v", capabilityId: "cap", record });

describe("J-CAP-t3-review-r8 I4: dispose releases every SDK handler, whatever the channel does", () => {
  test("EPIPE on write with a close that never settles: no SDK response handler or timeout is left", async () => {
    const ch = channel({ closeStalls: true, onCall: () => { throw Object.assign(new Error("EPIPE"), { code: "EPIPE" }); } });
    const client = await connect(ch);
    await client.callTool("t", {}, { timeoutMs: 500, actorId: "a" });
    expect(sdkOf(client)._responseHandlers.size).toBe(0);
    expect(sdkOf(client)._timeoutInfo.size).toBe(0);
    expect(client.closed).toBe(true);
    await client.dispose(); // never hangs on the stalled close
  });
  test("a pipe that closes mid-call, and a plain dispose, leave nothing behind; dispose is idempotent and closes the channel", async () => {
    const closes = { n: 0 };
    const ch = channel({ closes, onCall: () => { queueMicrotask(() => ch.drop()); } });
    const client = await connect(ch);
    await client.callTool("t", {}, { timeoutMs: 500, actorId: "a" });
    expect(sdkOf(client)._responseHandlers.size).toBe(0);
    await client.dispose(); await client.dispose();
    expect(client.pendingCount).toBe(0);
    expect(sdkOf(client)._responseHandlers.size + sdkOf(client)._timeoutInfo.size).toBe(0);
  });
});

describe("J-CAP-t3-review-r8 I3: the schema cache is counted and released", () => {
  test("after connect the compiler cache holds no schema bytes, and they count in `retained`", async () => {
    const tools = Array.from({ length: 8 }, (_, i) => ({ name: `t${i}`, inputSchema: bigSchema(i), outputSchema: bigSchema(i + 100) }));
    const client = await connect(channel({ tools }));
    expect(client.tools().length).toBe(8);
    expect(client.schemaCacheBytes).toBe(0);
    expect(client.retained.schemaCache).toBe(0);
    await client.dispose();
    expect(client.schemaCacheBytes).toBe(0);
  });
});

describe("J-CAP-t3-review-r8 I5: a slot reserved before the spawn is released on every exit", () => {
  const exits: [string, () => Promise<unknown>][] = [["the authorizer throws", async () => { throw new Error("authorizer temporarily unavailable"); }], ["the authorizer denies", async () => ({ code: "denied", reason: "no" })]];
  for (const [label, beforeIntent] of exits) {
    test(label, async () => {
      const reserved = new Set<string>();
      let intents = 0;
      const result = await spawnGoverned({
        registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
        ledger: async () => { intents++; }, recordRefusal: async () => {},
        slots: { acquire: async () => { reserved.add("s"); return { slotId: "s" }; }, release: async (id) => { reserved.delete(id); } },
        localHostSpawnAllowed: () => true, beforeIntent: beforeIntent as never,
      }, { capabilityId: "cap", version: "v", serverId: "t", worldId: "local", argv: ["/bin/true"], cwd: "/", bundleDir: "/", secrets: [], restrictions: {}, stop: "graceful" });
      expect(result.ok).toBe(false);
      expect([...reserved]).toEqual([]);
      expect(intents).toBe(0);
    });
  }
});

describe("J-CAP-t3-review-r8 brands: a Trusted value cannot be forged", () => {
  test("text`` refuses a forged template object", () => {
    const forged = Object.assign(["HOSTILE_SERVER_BYTES"], { raw: ["HOSTILE_SERVER_BYTES"] }) as unknown as TemplateStringsArray;
    expect(() => text(forged)).toThrow();
    expect(String(text`ok ${1}`)).toBe("ok 1");
  });
  test("the runtime-authored constructors are imported only by runtime-authored modules", () => {
    const SRC = join(import.meta.dir, "../src");
    const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
    const users = files(SRC).filter((f) => !f.endsWith("typedRecord.ts") && /\b(operatorText|operatorJson|adoptId)\b/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1)).sort();
    expect(users).toEqual(["capabilities/execSpawn.ts", "capabilities/mcpManage.ts", "mcp/client.ts"]);
    expect(readFileSync(join(SRC, "mcp/ingress.ts"), "utf8")).not.toMatch(/\b(operatorText|operatorJson|adoptId)\b/);
  });
});
