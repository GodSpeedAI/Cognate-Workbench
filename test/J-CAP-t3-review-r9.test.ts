// Journey J-CAP-t3-review-r9: Codex round 9 on PR #39 (head 607ecda). Each test failed against 607ecda.
//
// HANDOFF invariants (restated):
//   I1  every id the MCP path records is MINTED by us or passes the minted-shape check; server text is only ever digested.
//   I2  every call, including a refusal at the host boundary, yields exactly one durable finished record or `record_failed`.
//   I3  schema bytes are counted in OUR compiler; the SDK holds none (ground truth: the SDK's own validator caches).
//   I4  PER-CALL: after call X settles, X's SDK handler and timeout entries are gone; both tables are empty when the client is quiescent.
//   I5  FAIL-CLOSED: a slot is never released while any group member is alive. A stalled ledger write keeps the slot reserved
//       (surfaced as reconcile-incomplete); that is intended, not a leak.
import { describe, expect, test } from "bun:test";
import { createExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { McpClient, type McpRecord, type StdioChannel } from "../src/mcp/client.ts";

function channel(tools: unknown[], onCall: (id: unknown, reply: (r: unknown) => void) => void = () => {}): StdioChannel {
  let listener: (c: Buffer) => void | Promise<void> = () => {};
  const reply = (id: unknown, result: unknown): void => queueMicrotask(() => { void listener(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)); });
  return {
    onData: (l) => { listener = l; }, onClose: () => {}, close: () => Promise.resolve(),
    write: (s: string) => {
      const m = JSON.parse(s) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
      if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "t", version: "1" } });
      else if (m.method === "tools/list") reply(m.id, { tools });
      else if (m.method === "tools/call") onCall(m.id, (r) => reply(m.id, r));
    },
  };
}

describe("J-CAP-t3-review-r9 I1: server text never becomes a recorded id", () => {
  test("a server-returned string reused as the next callId is digested, never recorded verbatim", async () => {
    const recs: McpRecord[] = [];
    const client = await McpClient.connect(channel([{ name: "t", inputSchema: { type: "object" } }], (_id, reply) => reply({ content: [{ type: "text", text: "server-private-0123456789" }] })), { serverId: "t", version: "v", capabilityId: "cap", record: async (e) => { recs.push(e); } });
    await client.refreshTools();
    await client.callTool("t", {}, { timeoutMs: 1000, actorId: "a", callId: "server-private-0123456789" });
    const ids = recs.map((r) => String((r.payload as Record<string, unknown>).callId));
    expect(ids.length).toBeGreaterThan(0);
    expect(JSON.stringify(recs)).not.toContain("server-private-0123456789");
    await client.dispose();
  });
});

describe("J-CAP-t3-review-r9 I3: the SDK holds no schema", () => {
  test("repeated listings of ~12 KB schemas leave the SDK's validator caches at 0 bytes", async () => {
    const big = (i: number) => ({ type: "object", properties: Object.fromEntries(Array.from({ length: 50 }, (_, k) => [`p${k}`, { type: "string", description: `f ${i}-${k} ${"x".repeat(200)}` }])) });
    const client = await McpClient.connect(channel([{ name: "t", inputSchema: big(0), outputSchema: big(1) }]), { serverId: "t", version: "v", capabilityId: "cap", record: async () => {} });
    const sdk = (client as unknown as { sdk: Record<string, unknown> }).sdk;
    const ajvCache = (): Map<unknown, unknown> => ((sdk._jsonSchemaValidator as { _ajv: { _cache: Map<unknown, unknown> } })._ajv._cache);
    const baseline = new Set(ajvCache().keys()); // the validator's own meta-schemas
    for (let i = 0; i < 6; i++) await client.refreshTools();
    const held = [...ajvCache().keys()].filter((k) => !baseline.has(k)).reduce((n: number, k) => n + JSON.stringify(k).length, 0);
    expect(held).toBe(0);
    expect((sdk._cachedToolOutputValidators as Map<unknown, unknown>).size).toBe(0);
    await client.dispose();
  });
});

describe("J-CAP-t3-review-r9 I2: host boundary refusal is recorded", () => {
  const make = (commitBatch: (...a: unknown[]) => Promise<unknown>) => createMcpSupervisor({
    tenant: "local", getRecorder: () => ({ commitBatch }) as never, getIndex: () => ({}) as never, isEnabled: async () => true,
    readRows: async () => [], recordDecision: async () => {}, registry: () => createExecutionWorldRegistry(), resolveSecret: async () => undefined,
    slots: {} as never, getPosture: () => undefined, localHostSpawnAllowed: () => false,
  });
  test("no running server: exactly one durable finished record with code server_not_running", async () => {
    const commits: { type: string; payload: Record<string, unknown> }[] = [];
    const sup = make(async (_s, events) => { commits.push(...(events as typeof commits)); });
    const r = await sup.host.call("cap", "1", undefined, "mcp.t.t", {}, { deadlineMs: 1000, actorId: "a" });
    expect(r.ok === false && r.code).toBe("server_not_running");
    expect(commits.length).toBe(1);
    expect(commits[0]!.payload.phase).toBe("finished");
    expect(commits[0]!.payload.outcome).toBe("server_not_running");
  });
  test("a failing write returns record_failed", async () => {
    const sup = make(async () => { throw new Error("down"); });
    const r = await sup.host.call("cap", "1", undefined, "mcp.t.t", {}, { deadlineMs: 1000, actorId: "a" });
    expect(r.ok === false && r.code).toBe("record_failed");
  });
});
