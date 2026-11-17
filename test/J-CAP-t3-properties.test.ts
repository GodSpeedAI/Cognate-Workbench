// Journey J-CAP-t3-properties: the T3 safety invariants, tested with generated adversarial input (fast-check) instead of
// listed examples. A generated MCP server sends random bytes, split chunks, no newline, nested JSON, huge messages,
// forged errors, delays and early exits; the invariants must hold for every script:
//   I1  no record, returned message or exclusion listing contains any 16-byte substring of server-originated bytes
//   I2  every call ends in exactly one finished record within its deadline + epsilon, and nothing throws
//   I3  buffered bytes per connection stay at or under the cap (transport counter)
//   I4  pending state is empty after every call
//   I5  the slot is released iff nothing of the spawn survives (spawn path, `proc` seam)
// FC_RUNS sets the number of runs per property (default 200, the CI value; run 2000+ locally). A counterexample that was
// ever found is kept below as a fixed example.
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { spawnGoverned, type LedgerEvent, type ProcView } from "../src/capabilities/execSpawn.ts";
import { MCP_LIMITS, McpClient, type McpRecord } from "../src/mcp/client.ts";
import type { TypedPayload } from "../src/mcp/typedRecord.ts";
import { LOCAL_POSTURE, sleep } from "./mcp-helpers.ts";

const RUNS = Number(process.env.FC_RUNS ?? 200);
const CAP_BYTES = MCP_LIMITS.maxResultBytes;
/** FC_INV selects invariants (default all); used to show each one red against an older head independently. */
const ON = new Set((process.env.FC_INV ?? "I1,I2,I3,I4").split(","));

// The compiler rejects a server string as a record field (this is checked by `bun run typecheck`).
export const compileGuard = (serverText: string): TypedPayload =>
  // @ts-expect-error a plain string, such as one a server sent, is not a record field
  ({ message: serverText });

// ---- the generated adversarial server ----
const text = fc.string({ minLength: 16, maxLength: 48 });
const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  tree: fc.oneof({ depthSize: "small" }, fc.string({ maxLength: 40 }), fc.integer(), fc.boolean(), fc.constant(null), fc.array(tie("tree"), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 12 }), tie("tree"), { maxKeys: 3 })),
})).tree;
const validName = fc.stringMatching(/^[A-Za-z0-9_.-]{16,40}$/);
const tool = fc.record({ name: fc.oneof(validName, validName, fc.string({ minLength: 1, maxLength: 300 })), description: text, extra: json, extraKey: fc.string({ minLength: 1, maxLength: 24 }), withOutput: fc.boolean(), quirk: fc.constantFrom("none" as const, "none" as const, "async" as const, "bigDescription" as const, "hugeSchema" as const) });
const behavior = fc.oneof(
  fc.record({ kind: fc.constant("ok" as const), text, delay: fc.nat(25), structured: fc.boolean() }),
  fc.record({ kind: fc.constant("error" as const), message: text, data: json }),
  fc.record({ kind: fc.constant("deepError" as const), depth: fc.integer({ min: 60, max: 20_000 }) }),
  fc.record({ kind: fc.constant("hang" as const) }),
  fc.record({ kind: fc.constant("oversize" as const), size: fc.integer({ min: CAP_BYTES + 200, max: CAP_BYTES + 150_000 }), newline: fc.boolean(), as: fc.constantFrom("result" as const, "notification" as const) }),
  fc.record({ kind: fc.constant("garbage" as const), bytes: fc.uint8Array({ minLength: 1, maxLength: 4096 }), newline: fc.boolean() }),
  fc.record({ kind: fc.constant("earlyExit" as const) }),
);
const scenario = fc.record({
  tools: fc.array(tool, { minLength: 1, maxLength: 4 }),
  calls: fc.array(fc.record({ pick: fc.nat(8), unknownName: fc.string({ minLength: 16, maxLength: 60 }), args: json, timeoutMs: fc.integer({ min: 40, max: 140 }), behavior }), { minLength: 1, maxLength: 3 }),
  parallel: fc.boolean(),
  splits: fc.array(fc.integer({ min: 1, max: 6000 }), { maxLength: 5 }),
  handshake: fc.constantFrom("ok" as const, "ok" as const, "ok" as const, "ok" as const, "error" as const, "garbage" as const),
  handshakeText: text,
  duplicateFirstTool: fc.boolean(),
  recorder: fc.constantFrom("fast" as const, "fast" as const, "slow" as const, "stuck-finished" as const),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

/** Outcome tally across runs (printed with FC_STATS=1): evidence the generator reaches every failure class. */
const tally = new Map<string, number>();
const count = (key: string): void => { tally.set(key, (tally.get(key) ?? 0) + 1); };

const windows = (buffers: Buffer[]): Set<string> => {
  const out = new Set<string>();
  for (const b of buffers) { const s = b.toString("latin1"); for (let i = 0; i + 16 <= s.length; i++) out.add(s.slice(i, i + 16)); }
  return out;
};

async function runScenario(sc: Scenario): Promise<void> {
  const emitted: Buffer[] = [];
  const listeners: { data: ((chunk: Buffer) => void)[]; close: (() => void)[] } = { data: [], close: [] };
  let closed = false;
  const closeChannel = (): void => { if (closed) return; closed = true; for (const l of listeners.close) l(); };
  let queue: Promise<void> = Promise.resolve();
  const emit = (bytes: Buffer, delay = 0): void => {
    emitted.push(bytes);
    queue = queue.then(async () => {
      if (delay) await sleep(delay);
      let offset = 0;
      for (const at of [...sc.splits, bytes.length]) {
        const end = Math.min(bytes.length, offset + Math.max(1, at));
        if (end > offset && !closed) for (const l of listeners.data) l(Buffer.from(bytes.subarray(offset, end)));
        offset = end;
        if (offset >= bytes.length) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
    });
  };
  const frame = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`);
  let arrivals = 0;
  const channel = {
    write(data: string) {
      for (const line of data.split("\n").filter(Boolean)) {
        const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string } };
        if (m.method === "initialize") {
          if (sc.handshake === "error") emit(frame({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: sc.handshakeText } }));
          else if (sc.handshake === "garbage") emit(Buffer.from(`${sc.handshakeText} {{not json\n`));
          else emit(frame({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } } }));
        } else if (m.method === "tools/list") {
          const listed = sc.duplicateFirstTool ? [sc.tools[0]!, ...sc.tools] : sc.tools;
          emit(frame({ jsonrpc: "2.0", id: m.id, result: { tools: listed.map((t) => ({ name: t.name, description: t.quirk === "bigDescription" ? t.description.repeat(200) : t.description, inputSchema: { type: "object", additionalProperties: true, [t.extraKey]: t.extra, ...(t.quirk === "async" ? { $async: true } : {}), ...(t.quirk === "hugeSchema" ? { blob: "y".repeat(20_000) } : {}) }, ...(t.withOutput ? { outputSchema: { type: "object", [t.extraKey]: t.extra } } : {}) })) } }));
        } else if (m.method === "tools/call") {
          const b = sc.calls[arrivals++ % sc.calls.length]!.behavior;
          if (b.kind === "ok") emit(frame({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: b.text }], ...(b.structured ? { structuredContent: { v: b.text } } : {}) } }), b.delay);
          else if (b.kind === "error") emit(frame({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: b.message, data: b.data } }));
          else if (b.kind === "deepError") emit(Buffer.from(`{"jsonrpc":"2.0","id":${m.id},"error":{"code":-32000,"message":"x","data":${"[".repeat(b.depth)}${"]".repeat(b.depth)}}}\n`));
          else if (b.kind === "oversize") {
            const pad = "A".repeat(b.size);
            emit(Buffer.from(b.as === "result" ? `{"jsonrpc":"2.0","id":${m.id},"result":{"content":[{"type":"text","text":"${pad}"}]}}${b.newline ? "\n" : ""}` : `{"jsonrpc":"2.0","method":"notifications/message","params":{"pad":"${pad}"}}${b.newline ? "\n" : ""}`));
          } else if (b.kind === "garbage") emit(Buffer.concat([Buffer.from(b.bytes), Buffer.from(b.newline ? "\n" : "")]));
          else if (b.kind === "earlyExit") queue = queue.then(() => closeChannel());
        }
      }
    },
    onData(l: (chunk: Buffer) => void) { listeners.data.push(l); },
    onClose(l: () => void) { listeners.close.push(l); },
    async close() { closeChannel(); },
  };

  const records: McpRecord[] = [];
  let client: McpClient;
  try {
    client = await McpClient.connect(channel as never, { capabilityId: "capability.bundle.props", version: "v", serverId: "gen", record: async (e) => { if (sc.recorder === "slow") await sleep(30); if (sc.recorder === "stuck-finished" && e.payload.phase === "finished") return new Promise<void>(() => {}); records.push(e); }, connectTimeoutMs: 400 });
  } catch (error) {
    // A failed handshake is a defined outcome; it must carry no server text.
    expect(String((error as Error).message), "a failed handshake must not carry server text").toBe("MCP handshake failed");
    count(`connect-failed:${sc.handshake}`);
    assertNoLeak(emitted, records, [], []);
    return;
  }
  const names = client.tools().map((t) => t.name);
  const timings: { started: number; ended: number; timeoutMs: number }[] = [];
  const messages: string[] = [];
  const outcomes: Array<Awaited<ReturnType<McpClient["callTool"]>> | "threw"> = [];
  const run = async (i: number): Promise<void> => {
    const c = sc.calls[i]!;
    const name = names.length > 0 && c.pick % 5 !== 4 ? names[c.pick % names.length]! : c.unknownName;
    const started = performance.now();
    try {
      const o = await client.callTool(name, c.args && typeof c.args === "object" && !Array.isArray(c.args) ? c.args as Record<string, unknown> : {}, { timeoutMs: c.timeoutMs, actorId: "gen", callId: `call-${i}` });
      outcomes[i] = o;
      count(o.ok ? "ok" : o.code);
      if (!o.ok) messages.push(o.message);
    } catch {
      outcomes[i] = "threw";
    }
    timings[i] = { started, ended: performance.now(), timeoutMs: c.timeoutMs };
  };
  if (sc.parallel) await Promise.all(sc.calls.map((_, i) => run(i)));
  else for (let i = 0; i < sc.calls.length; i++) await run(i);
  await sleep(15);

  // I2: nothing throws; exactly one finished record per call, within deadline + epsilon
  if (ON.has("I2")) for (let i = 0; i < sc.calls.length; i++) {
    expect(outcomes[i], `call ${i} threw`).not.toBe("threw");
    const finished = records.filter((r) => r.type === "capability.mcp.tool_invoked" && r.payload.phase === "finished" && r.payload.callId === `call-${i}`);
    if (sc.recorder === "stuck-finished") expect(finished.length, `call ${i}: finished records`).toBeLessThanOrEqual(1);
    else expect(finished.length, `call ${i}: finished records`).toBe(1);
    const t = timings[i]!;
    expect(t.ended - t.started, `call ${i}: elapsed`).toBeLessThan(t.timeoutMs + 400);
  }
  // I3: buffered bytes stay at or under the cap
  if (ON.has("I3")) expect(client.peakBufferedBytes, "I3 buffered bytes").toBeLessThanOrEqual(CAP_BYTES);
  // I4: nothing pending
  if (ON.has("I4")) expect(client.pendingCount, "I4 pending").toBe(0);
  // I1: no 16-byte substring of server bytes anywhere we wrote
  if (ON.has("I1")) assertNoLeak(emitted, records, messages, client.excluded.map((e) => `${e.name} ${e.reason}`));
  await client.close();
}

function assertNoLeak(emitted: Buffer[], records: McpRecord[], messages: string[], extra: string[]): void {
  if (!ON.has("I1")) return;
  const server = windows(emitted);
  for (const where of [JSON.stringify(records), ...messages, ...extra]) {
    const s = where;
    for (let i = 0; i + 16 <= s.length; i++) if (server.has(s.slice(i, i + 16))) throw new Error(`I1: server bytes "${s.slice(i, i + 16)}" appear in a record, message or listing`);
  }
}

// Counterexamples found against 1d84225 (seeds 1605260349 I1, -187584161 I2, 666881820 I3, 1997416318 handshake), kept as
// fixed examples. Each is the shrunk shape of the generated failure.
const base = { tools: [{ name: "_A-0A-a.a.A.000.", description: "                ", extra: [] as unknown, extraKey: " ", withOutput: false, quirk: "none" as const }], splits: [] as number[], parallel: false, handshake: "ok" as const, handshakeText: "                ", duplicateFirstTool: false, recorder: "fast" as const };
const call = (behavior: Scenario["calls"][number]["behavior"], pick = 0) => ({ pick, unknownName: "                ", args: {} as unknown, timeoutMs: 40, behavior });
const FIXED: Scenario[] = [
  { ...base, calls: [call({ kind: "earlyExit" })] }, // I1: a 16-byte tool name was recorded verbatim
  { ...base, calls: [call({ kind: "ok", text: "                ", delay: 0, structured: false }, 4)] }, // I2: an unknown-tool refusal had no finished record
  { ...base, calls: [call({ kind: "oversize", size: CAP_BYTES + 150_000, newline: false, as: "result" })] }, // I3: an unterminated oversize line
  { ...base, calls: [call({ kind: "error", message: "                ", data: {} })], handshake: "garbage" }, // handshake error text
  { ...base, calls: [call({ kind: "deepError", depth: 20_000 })] }, // a deeply nested error payload
  { ...base, tools: [{ ...base.tools[0]!, quirk: "async" as const }], calls: [call({ kind: "hang" })] }, // an excluded tool must not be listed by name (review thread)
  { ...base, recorder: "stuck-finished" as const, calls: [call({ kind: "ok", text: "                ", delay: 0, structured: false })] }, // a recorder that never settles
];

describe("J-CAP-t3-properties: the MCP client against a generated adversarial server", () => {
  test(`I1-I4 hold for ${RUNS} generated scripts and the saved counterexamples`, async () => {
    await fc.assert(fc.asyncProperty(scenario, async (sc) => { await runScenario(sc); }), { numRuns: RUNS, endOnFailure: false, examples: FIXED.map((e) => [e] as [Scenario]) });
    if (process.env.FC_STATS) console.log("outcome tally", Object.fromEntries(tally));
  }, 30 * 60_000);
});

// ---- I5: the slot is released iff nothing of the spawn survives (the `proc` seam stands in for /proc) ----
describe("J-CAP-t3-properties: slot release in the spawn path", () => {
  const spawnScript = fc.record({ survivor: fc.constantFrom("none" as const, "dies-early" as const, "dies-late" as const, "never" as const), argv: fc.constantFrom(["sh", "-c", "exit 0"], ["sh", "-c", "exit 3"], ["sleep", "5"]), stopFirst: fc.boolean() });
  test(`I5 holds for ${RUNS} generated spawns`, async () => {
    await fc.assert(fc.asyncProperty(spawnScript, async (sc) => {
      const t0 = Date.now();
      const aliveNow = (): boolean => sc.survivor === "never" || (sc.survivor === "dies-late" && Date.now() - t0 < 700) || (sc.survivor === "dies-early" && Date.now() - t0 < 10);
      const proc: ProcView = { readCmdline: async () => undefined, readCwd: async () => undefined, listPids: async () => [], pidsWithSpawnId: async () => (aliveNow() ? [99_999_999] : []) };
      const events: LedgerEvent[] = [];
      let aliveAtLedger: boolean | undefined;
      let aliveAtRelease: boolean | undefined;
      const released: string[] = [];
      const result = await spawnGoverned({
        registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
        ledger: async (_id, evs) => { for (const e of evs) if (e.type === "capability.mcp.exited") aliveAtLedger = aliveNow(); events.push(...evs); }, recordRefusal: async () => {},
        slots: { acquire: async () => ({ slotId: "s" }), release: async (id) => { aliveAtRelease = aliveNow(); released.push(id); } },
        localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 30, killMs: 30, reapWaitMs: 30, proc,
      }, { capabilityId: "capability.bundle.props", version: "v", serverId: "gen", worldId: "local", argv: sc.argv, cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (sc.argv[0] === "sleep" || sc.stopFirst) result.handle.stop("test", "emergency");
      await result.handle.exited;
      const exited = events.find((e) => e.type === "capability.mcp.exited")!;
      const survivors = exited.payload.survivors === true;
      // released iff nothing survives: a release implies nothing was alive at that moment; a survivor means it was alive when decided
      expect(released.length === 1, "released iff no survivors").toBe(!survivors);
      if (released.length === 1) expect(aliveAtRelease, "alive at release").toBe(false);
      if (survivors) expect(aliveAtLedger, "survivor alive when recorded").toBe(true);
      if (survivors) expect((exited.payload as Record<string, unknown>).outcome).toBe("reconcile-incomplete");
    }), { numRuns: RUNS });
  }, 30 * 60_000);
});
