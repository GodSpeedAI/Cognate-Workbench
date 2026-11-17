// Journey J-CAP-t3-review-r10: Codex round 10 on PR #39 (head b372155). Each test failed against b372155.
//   I1  the MCP client never adopts a caller-supplied callId: it mints its own; the caller's id is only a sha256 digest.
//   I2  every refusal path of host.call (unknown_tool, invalid reference, ...) writes exactly one finished record, or record_failed.
//   I3  an incoming chunk is checked on arrival: retained bytes never exceed the cap; an oversize chunk closes the connection.
import { describe, expect, test } from "bun:test";
import { createExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { McpClient, ChannelTransport, type McpRecord, type StdioChannel } from "../src/mcp/client.ts";
import { INGRESS } from "../src/mcp/ingress.ts";
import { sha256Of } from "../src/mcp/typedRecord.ts";

function channel(tools: unknown[], onCall: (reply: (r: unknown) => void) => void): StdioChannel {
  let listener: (c: Buffer) => void | Promise<void> = () => {};
  const reply = (id: unknown, result: unknown): void => queueMicrotask(() => { void listener(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)); });
  return {
    onData: (l) => { listener = l; }, onClose: () => {}, close: () => Promise.resolve(),
    write: (s: string) => {
      const m = JSON.parse(s) as { id?: unknown; method?: string; params?: { protocolVersion?: string } };
      if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "t", version: "1" } });
      else if (m.method === "tools/list") reply(m.id, { tools });
      else if (m.method === "tools/call") onCall((r) => reply(m.id, r));
    },
  };
}

describe("J-CAP-t3-review-r10 I1: callId is always minted", () => {
  test("a caller-supplied UUID callId is never recorded as the callId; only its digest may appear", async () => {
    const recs: McpRecord[] = [];
    const supplied = "c99b47e4-f8ae-45cb-9954-682e41409c5b";
    const client = await McpClient.connect(channel([{ name: "t", inputSchema: { type: "object" } }], (reply) => reply({ content: [{ type: "text", text: "x" }] })), { serverId: "t", version: "v", capabilityId: "cap", record: async (e) => { recs.push(e); } });
    await client.refreshTools();
    await client.callTool("t", {}, { timeoutMs: 1000, actorId: "a", callId: supplied });
    expect(JSON.stringify(recs)).not.toContain(supplied);
    const ids = recs.map((r) => String((r.payload as Record<string, unknown>).callId)).filter((x) => x !== "undefined");
    expect(ids.length).toBeGreaterThan(0);
    expect(recs.some((r) => JSON.stringify(r.payload).includes(sha256Of(supplied)))).toBe(true);
    await client.dispose();
  });
});

describe("J-CAP-t3-review-r10 I2: every host.call refusal is one finished record", () => {
  const make = (commitBatch: (...a: unknown[]) => Promise<unknown>) => createMcpSupervisor({
    tenant: "local", getRecorder: () => ({ commitBatch }) as never, getIndex: () => ({}) as never, isEnabled: async () => true,
    readRows: async () => [], recordDecision: async () => {}, registry: () => createExecutionWorldRegistry(), resolveSecret: async () => undefined,
    slots: {} as never, getPosture: () => undefined, localHostSpawnAllowed: () => false,
  });
  test("an invalid tool reference (mcp.bad) writes exactly one finished record with outcome unknown_tool", async () => {
    const commits: { payload: Record<string, unknown> }[] = [];
    const sup = make(async (_s, events) => { commits.push(...(events as typeof commits)); });
    const r = await sup.host.call("cap", "1", undefined, "mcp.bad", {}, { deadlineMs: 1000, actorId: "a" });
    expect(r.ok === false && r.code).toBe("unknown_tool");
    expect(commits.length).toBe(1);
    expect(commits[0]!.payload.phase).toBe("finished");
    expect(commits[0]!.payload.outcome).toBe("unknown_tool");
  });
  test("an invalid reference with a failing store returns record_failed", async () => {
    const sup = make(async () => { throw new Error("down"); });
    const r = await sup.host.call("cap", "1", undefined, "nonsense", {}, { deadlineMs: 1000, actorId: "a" });
    expect(r.ok === false && r.code).toBe("record_failed");
  });
});

describe("J-CAP-t3-review-r10 I3: a hard retention cap, checked on arrival", () => {
  test("one 32 MiB chunk is never queued: retained stays at or under the cap and the connection closes", async () => {
    let push: (c: Buffer) => void | Promise<void> = () => {};
    let closed = 0;
    const ch: StdioChannel = { onData: (l) => { push = l; }, onClose: () => {}, close: () => { closed++; return Promise.resolve(); }, write: () => {} };
    const violations: unknown[] = [];
    const t = new ChannelTransport(ch, undefined, { onViolation: (v) => { violations.push(v); } });
    await t.start();
    let peak = 0;
    const r = t.retained; peak = Math.max(peak, r.queuedChunks + r.partialLine + r.parsedMessage);
    await push(Buffer.alloc(32 * 1024 * 1024, 0x61));
    const a = t.retained; peak = Math.max(peak, a.queuedChunks + a.partialLine + a.parsedMessage);
    expect(peak).toBeLessThanOrEqual(INGRESS.maxRetainedBytes);
    expect(t.peaks.queuedChunks).toBeLessThanOrEqual(INGRESS.maxRetainedBytes);
    expect(violations.length).toBe(1);
    expect(closed).toBeGreaterThan(0);
  });
});
