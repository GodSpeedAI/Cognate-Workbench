// Journey J-CAP-t3-properties: the T3 safety invariants, tested with generated adversarial input (fast-check), with every
// oracle reading GROUND TRUTH at the place the guarantee is consumed (never the code's own counters):
//   I1  no 16-byte substring of server bytes in any STORE row, returned message, exclusion listing or log line
//   I2  every call ends in exactly one finished record IN THE STORE (counted per call), and its result is delivered only
//       after that record is confirmed (else `record_failed`, result withheld); nothing throws
//   I3  retained bytes (partial line, queued chunks, parsed message) measured from the live structures stay bounded
//   I4  the SDK's own pending-handler count is 0 after every call, including after EPIPE and half-closed pipes
//   I5  the slot is released iff nothing of the spawn survives (seam, and a REAL forking process group read from /proc)
// The generator covers batching (several messages in one chunk), EPIPE (sync throw and rejection), half-closed pipes,
// recorder throw / rejection / write-then-reject / stall, malformed results, protocol violations (bad ids, server requests).
// FC_RUNS sets the runs per property (default 200, the CI value; 2000+ locally). FC_STATS=1 prints the outcome tally.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fc from "fast-check";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { createMemoryStore } from "@godspeedai/cognate-store-memory";
import { spawnGoverned, type LedgerEvent, type ProcView } from "../src/capabilities/execSpawn.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { INGRESS } from "../src/mcp/ingress.ts";
import { MCP_LIMITS, McpClient, type McpRecord } from "../src/mcp/client.ts";
import type { TypedPayload } from "../src/mcp/typedRecord.ts";
import { LOCAL_POSTURE, sleep } from "./mcp-helpers.ts";

const RUNS = Number(process.env.FC_RUNS ?? 200);
const CAP_BYTES = MCP_LIMITS.maxResultBytes;
/** FC_INV selects invariants (default all); used to show each one red against an older head independently. */
const callIdOf = (i: number): string => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
const ON = new Set((process.env.FC_INV ?? "I1,I2,I3,I4").split(","));
const STREAM = "calls:gen";

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
const KEYWORDS = ["patternProperties", "uniqueItems", "dependentRequired", "unevaluatedProperties", "additionalItems", "contentMediaType"];
const tool = fc.record({ name: fc.oneof(validName, validName, fc.string({ minLength: 1, maxLength: 300 })), description: text, extra: json, extraKey: fc.oneof(fc.string({ minLength: 1, maxLength: 24 }), fc.constantFrom(...KEYWORDS)), withOutput: fc.boolean(), quirk: fc.constantFrom("none" as const, "none" as const, "async" as const, "bigDescription" as const, "hugeSchema" as const) });
const behavior = fc.oneof(
  fc.record({ kind: fc.constant("ok" as const), text, delay: fc.nat(25), structured: fc.boolean() }),
  fc.record({ kind: fc.constant("error" as const), message: text, data: json }),
  fc.record({ kind: fc.constant("deepError" as const), depth: fc.integer({ min: 60, max: 20_000 }) }),
  fc.record({ kind: fc.constant("hang" as const) }),
  fc.record({ kind: fc.constant("oversize" as const), size: fc.integer({ min: CAP_BYTES + 200, max: CAP_BYTES + 150_000 }), newline: fc.boolean(), as: fc.constantFrom("result" as const, "notification" as const) }),
  fc.record({ kind: fc.constant("garbage" as const), bytes: fc.uint8Array({ minLength: 1, maxLength: 4096 }), newline: fc.boolean() }),
  fc.record({ kind: fc.constant("earlyExit" as const) }),
  // batching: several large (each under the cap) notifications and the result delivered as ONE chunk
  fc.record({ kind: fc.constant("batch" as const), count: fc.integer({ min: 2, max: 4 }), size: fc.integer({ min: 100_000, max: 220_000 }), text }),
  // malformed results and protocol violations
  fc.record({ kind: fc.constant("badResult" as const), variant: fc.constantFrom("content-string" as const, "iserror-string" as const, "bad-item" as const, "no-result" as const) }),
  fc.record({ kind: fc.constant("badId" as const), id: fc.oneof(fc.constant({ a: 1 }), fc.constant([1]), fc.string({ minLength: 65, maxLength: 90 }), fc.constant("has space and ünï") ) }),
  fc.record({ kind: fc.constant("serverRequest" as const), id: fc.oneof(fc.integer(), fc.stringMatching(/^[A-Za-z0-9_.:-]{1,64}$/), fc.string({ minLength: 65, maxLength: 80 })) }),
);
const scenario = fc.record({
  tools: fc.array(tool, { minLength: 1, maxLength: 4 }),
  calls: fc.array(fc.record({ pick: fc.nat(8), unknownName: fc.string({ minLength: 16, maxLength: 60 }), args: json, timeoutMs: fc.integer({ min: 40, max: 140 }), behavior }), { minLength: 1, maxLength: 3 }),
  parallel: fc.boolean(),
  splits: fc.array(fc.integer({ min: 1, max: 6000 }), { maxLength: 5 }),
  handshake: fc.constantFrom("ok" as const, "ok" as const, "ok" as const, "ok" as const, "error" as const, "garbage" as const),
  handshakeText: text,
  duplicateFirstTool: fc.boolean(),
  recorder: fc.constantFrom("fast" as const, "fast" as const, "slow" as const, "throw-sync-once" as const, "reject-once" as const, "wtr-once" as const, "wtr-always" as const, "reject-always" as const, "stall" as const, "write-then-stall" as const),
  fault: fc.constantFrom("none" as const, "none" as const, "none" as const, "epipe-throw" as const, "epipe-reject" as const, "half-closed" as const, "stdout-closed" as const),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;
const RECOVERABLE = new Set(["fast", "slow", "throw-sync-once", "reject-once", "wtr-once"]);

/** Outcome tally across runs (printed with FC_STATS=1): evidence the generator reaches every failure class. */
const tally = new Map<string, number>();
const count = (key: string): void => { tally.set(key, (tally.get(key) ?? 0) + 1); };
const maxima = { retainedPartial: 0, retainedQueued: 0, retainedParsed: 0, sdkPendingSeenDuringCall: 0 };

const windows = (buffers: Buffer[]): Set<string> => {
  const out = new Set<string>();
  for (const b of buffers) { const s = b.toString("latin1"); for (let i = 0; i + 16 <= s.length; i++) out.add(s.slice(i, i + 16)); }
  return out;
};
const sdkPending = (client: McpClient): number => ((client as unknown as { sdk: { _responseHandlers: Map<unknown, unknown> } }).sdk._responseHandlers).size;

async function runScenario(sc: Scenario): Promise<void> {
  const emitted: Buffer[] = [];
  const logs: string[] = [];
  const realLog = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ["log", "warn", "error"] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try { await runInner(sc, emitted, logs); } finally { console.log = realLog.log; console.warn = realLog.warn; console.error = realLog.error; }
}

async function runInner(sc: Scenario, emitted: Buffer[], logs: string[]): Promise<void> {
  const listeners: { data: ((chunk: Buffer) => void | Promise<void>)[]; close: (() => void)[] } = { data: [], close: [] };
  let closed = false;
  let paused = false;
  const closeChannel = (): void => { if (closed) return; closed = true; for (const l of listeners.close) l(); };
  let queue: Promise<void> = Promise.resolve();
  // The pipe model: honours pause(), and awaits the listener (as the real pump does) before the next chunk.
  const emit = (bytes: Buffer, delay = 0): void => {
    emitted.push(bytes);
    queue = queue.then(async () => {
      if (delay) await sleep(delay);
      let offset = 0;
      for (const at of [...sc.splits, bytes.length]) {
        const end = Math.min(bytes.length, offset + Math.max(1, at));
        while (paused && !closed) await sleep(1);
        if (end > offset && !closed) await Promise.all(listeners.data.map((l) => l(Buffer.from(bytes.subarray(offset, end)))));
        offset = end;
        if (offset >= bytes.length) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
    });
  };
  const frame = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`);
  let arrivals = 0;
  const epipe = (): Error => Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  const handle = (m: { id?: number; method?: string; params?: { protocolVersion?: string } }): void => {
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
      else if (b.kind === "batch") emit(Buffer.concat([...Array.from({ length: b.count }, (_, i) => frame({ jsonrpc: "2.0", method: "notifications/message", params: { i, pad: "B".repeat(b.size) } })), frame({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: b.text }] } })]));
      else if (b.kind === "badResult") emit(frame(b.variant === "no-result" ? { jsonrpc: "2.0", id: m.id } : { jsonrpc: "2.0", id: m.id, result: b.variant === "content-string" ? { content: "nope" } : b.variant === "iserror-string" ? { isError: "yes", content: [] } : { content: [{ type: "weird" }] } }));
      else if (b.kind === "badId") emit(frame({ jsonrpc: "2.0", id: b.id, result: { content: [] } }));
      else if (b.kind === "serverRequest") emit(Buffer.concat([frame({ jsonrpc: "2.0", id: b.id, method: "sampling/createMessage", params: {} }), frame({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "after-request" }] } })]));
    }
  };
  const channel = {
    write(data: string): void | Promise<void> {
      const lines = data.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id?: number; method?: string; params?: { protocolVersion?: string } });
      if (lines.some((m) => m.method === "tools/call") && sc.fault !== "none") {
        count(`fault:${sc.fault}`);
        if (sc.fault === "epipe-throw") throw epipe();
        if (sc.fault === "epipe-reject" || sc.fault === "half-closed") return Promise.reject(epipe()); // half-closed: stdout stays open and silent
        if (sc.fault === "stdout-closed") { queue = queue.then(() => closeChannel()); return; }
      }
      for (const m of lines) handle(m);
    },
    onData(l: (chunk: Buffer) => void | Promise<void>) { listeners.data.push(l); },
    onClose(l: () => void) { listeners.close.push(l); },
    pause() { paused = true; count("pause()"); },
    resume() { paused = false; },
    async close() { closeChannel(); },
  };

  const store = createMemoryStore();
  const recorder = new LifecycleRecorder(store, "t");
  const records: McpRecord[] = [];
  const attempts = new Map<string, number>();
  const commit = async (e: McpRecord, key?: string): Promise<void> => { records.push(e); await recorder.commitBatch(STREAM, [e], key ?? randomUUID()); };
  const record = (e: McpRecord, key?: string): Promise<void> => {
    if (e.payload.phase !== "finished") return sc.recorder === "slow" ? sleep(30).then(() => commit(e, key)) : commit(e, key);
    const n = (attempts.get(String(key)) ?? 0) + 1;
    attempts.set(String(key), n);
    const fail = (): Error => new Error("recorder down");
    switch (sc.recorder) {
      case "throw-sync-once": if (n === 1) throw fail(); break; // a SYNCHRONOUS throw
      case "reject-once": if (n === 1) return Promise.reject(fail()); break;
      case "wtr-once": if (n === 1) return commit(e, key).then(() => { throw fail(); }); break;
      case "wtr-always": return commit(e, key).then(() => { throw fail(); });
      case "reject-always": return Promise.reject(fail());
      case "stall": return new Promise<void>(() => {});
      case "write-then-stall": return commit(e, key).then(() => new Promise<void>(() => {}));
      case "slow": return sleep(30).then(() => commit(e, key));
      default: break;
    }
    return commit(e, key);
  };
  let client: McpClient;
  try {
    client = await McpClient.connect(channel as never, { capabilityId: "capability.bundle.props", version: "v", serverId: "gen", record: record as never, connectTimeoutMs: 400 });
  } catch (error) {
    // A failed handshake is a defined outcome; it must carry no server text.
    expect(String((error as Error).message), "a failed handshake must not carry server text").toBe("MCP handshake failed");
    count(`connect-failed:${sc.handshake}`);
    await assertNoLeak(emitted, store, [], [], logs);
    return;
  }
  const names = client.tools().map((t) => t.name);
  const timings: { started: number; ended: number; timeoutMs: number }[] = [];
  const messages: string[] = [];
  const outcomes: Array<Awaited<ReturnType<McpClient["callTool"]>> | "threw"> = [];
  const sampler = setInterval(() => { maxima.sdkPendingSeenDuringCall = Math.max(maxima.sdkPendingSeenDuringCall, sdkPending(client)); }, 2);
  const run = async (i: number): Promise<void> => {
    const c = sc.calls[i]!;
    const name = names.length > 0 && c.pick % 5 !== 4 ? names[c.pick % names.length]! : c.unknownName;
    const started = performance.now();
    try {
      const o = await client.callTool(name, c.args && typeof c.args === "object" && !Array.isArray(c.args) ? c.args as Record<string, unknown> : {}, { timeoutMs: c.timeoutMs, actorId: "gen", callId: callIdOf(i) });
      outcomes[i] = o;
      count(o.ok ? "ok" : o.code);
      count(`kind:${c.behavior.kind}`);
      if (!o.ok) messages.push(o.message);
    } catch {
      outcomes[i] = "threw";
    }
    timings[i] = { started, ended: performance.now(), timeoutMs: c.timeoutMs };
  };
  if (sc.parallel) await Promise.all(sc.calls.map((_, i) => run(i)));
  else for (let i = 0; i < sc.calls.length; i++) await run(i);
  clearInterval(sampler);
  await sleep(15);
  count(`recorder:${sc.recorder}`);

  // I2 (ground truth: the STORE): nothing throws; per call at most one finished record, exactly one unless the call said record_failed
  const stored = (await store.readStream(`wb-lifecycle:${STREAM}`)).map((e) => e.payload as Record<string, unknown>);
  if (ON.has("I2")) for (let i = 0; i < sc.calls.length; i++) {
    expect(outcomes[i], `call ${i} threw`).not.toBe("threw");
    const o = outcomes[i] as Exclude<(typeof outcomes)[number], "threw">;
    const finished = stored.filter((p) => p.phase === "finished" && p.callId === callIdOf(i));
    expect(finished.length, `call ${i}: finished records in the store (${sc.recorder})`).toBeLessThanOrEqual(1);
    if (!(!o.ok && o.code === "record_failed")) expect(finished.length, `call ${i}: result delivered without a confirmed finished record (${sc.recorder})`).toBe(1);
    else expect("result" in o, "record_failed withholds the result").toBe(false);
    if (!RECOVERABLE.has(sc.recorder)) expect(!o.ok && o.code === "record_failed", `call ${i}: an unconfirmable record must give record_failed (${sc.recorder})`).toBe(true);
    const t = timings[i]!;
    expect(t.ended - t.started, `call ${i}: elapsed`).toBeLessThan(t.timeoutMs + 400);
  }
  // I3 (ground truth: live structures, high-water marks measured when they changed)
  const peaks = (client as unknown as { retainedPeaks?: { partialLine: number; queuedChunks: number; parsedMessage: number } }).retainedPeaks ?? { partialLine: client.peakBufferedBytes, queuedChunks: 0, parsedMessage: 0 };
  maxima.retainedPartial = Math.max(maxima.retainedPartial, peaks.partialLine);
  maxima.retainedQueued = Math.max(maxima.retainedQueued, peaks.queuedChunks);
  maxima.retainedParsed = Math.max(maxima.retainedParsed, peaks.parsedMessage);
  if (ON.has("I3")) {
    expect(peaks.partialLine, "I3 partial line").toBeLessThanOrEqual(CAP_BYTES);
    expect(peaks.parsedMessage, "I3 parsed messages held at once").toBeLessThanOrEqual(CAP_BYTES);
    const biggestChunk = Math.max(0, ...emitted.map((b) => b.length));
    expect(peaks.queuedChunks, "I3 queued chunks").toBeLessThanOrEqual(INGRESS.queueHighBytes + biggestChunk);
  }
  // I4 (ground truth: the SDK's own handler table; the wrapper map proves nothing)
  if (ON.has("I4")) {
    expect(sdkPending(client), "I4 SDK pending handlers").toBe(0);
    expect(client.pendingCount, "I4 wrapper pending").toBe(0);
  }
  if (ON.has("I1")) await assertNoLeak(emitted, store, records, messages, logs, client.excluded.map((e) => `${e.name} ${e.reason}`));
  await client.close();
}

async function assertNoLeak(emitted: Buffer[], store: ReturnType<typeof createMemoryStore>, records: McpRecord[], messages: string[], logs: string[], extra: string[] = []): Promise<void> {
  if (!ON.has("I1")) return;
  const server = windows(emitted);
  const rows = JSON.stringify((await store.readStream(`wb-lifecycle:${STREAM}`)).map((e) => e.payload));
  for (const where of [rows, JSON.stringify(records), ...messages, ...extra, ...logs]) {
    for (let i = 0; i + 16 <= where.length; i++) if (server.has(where.slice(i, i + 16))) throw new Error(`I1: server bytes "${where.slice(i, i + 16)}" appear in a store row, record, message, listing or log`);
  }
}

// Counterexamples, kept as fixed examples. The first seven were found against 1d84225; the last group was shrunk against
// 4c11d46 (I1 patternProperties as a keyword; I2 write-then-reject and a stalled writer; I3 batched notifications; I4 EPIPE).
const base = { tools: [{ name: "_A-0A-a.a.A.000.", description: "                ", extra: [] as unknown, extraKey: " ", withOutput: false, quirk: "none" as const }], splits: [] as number[], parallel: false, handshake: "ok" as const, handshakeText: "                ", duplicateFirstTool: false, recorder: "fast" as const, fault: "none" as const };
const call = (behavior: Scenario["calls"][number]["behavior"], pick = 0) => ({ pick, unknownName: "                ", args: {} as unknown, timeoutMs: 40, behavior });
const okCall = call({ kind: "ok", text: "                ", delay: 0, structured: false });
const FIXED: Scenario[] = [
  { ...base, calls: [call({ kind: "earlyExit" })] },
  { ...base, calls: [call({ kind: "ok", text: "                ", delay: 0, structured: false }, 4)] },
  { ...base, calls: [call({ kind: "oversize", size: CAP_BYTES + 150_000, newline: false, as: "result" })] },
  { ...base, calls: [call({ kind: "error", message: "                ", data: {} })], handshake: "garbage" },
  { ...base, calls: [call({ kind: "deepError", depth: 20_000 })] },
  { ...base, tools: [{ ...base.tools[0]!, quirk: "async" as const }], calls: [call({ kind: "hang" })] },
  // 4c11d46 counterexamples
  { ...base, tools: [{ ...base.tools[0]!, extraKey: "patternProperties", extra: {} }], calls: [okCall] }, // I1: the keyword name was recorded as Trusted text
  { ...base, tools: [{ ...base.tools[0]!, extraKey: "patternProperties", extra: {}, withOutput: true }], calls: [okCall] },
  { ...base, recorder: "stall" as const, calls: [okCall] }, // I2: a stalled finished-record writer: result delivered, no record
  { ...base, recorder: "throw-sync-once" as const, calls: [okCall] }, // I2: a synchronous writer throw escaped
  { ...base, recorder: "wtr-once" as const, calls: [okCall] }, // I2: write-then-reject produced two records
  { ...base, calls: [call({ kind: "batch", count: 2, size: 200_000, text: "                " })] }, // I3: two notifications retained 400,000 bytes
  { ...base, fault: "epipe-throw" as const, calls: [okCall] }, // I4: the SDK handler stayed pending after EPIPE
  { ...base, fault: "half-closed" as const, calls: [okCall] },
  { ...base, calls: [call({ kind: "serverRequest", id: "ab" })] },
  { ...base, calls: [call({ kind: "badId", id: { a: 1 } })] },
];

describe("J-CAP-t3-properties: the MCP client against a generated adversarial server", () => {
  test(`I1-I4 hold for ${RUNS} generated scripts and the saved counterexamples`, async () => {
    await fc.assert(fc.asyncProperty(scenario, async (sc) => { await runScenario(sc); }), { numRuns: RUNS, endOnFailure: false, examples: FIXED.map((e) => [e] as [Scenario]) });
    if (process.env.FC_STATS) console.log("outcome tally", JSON.stringify(Object.fromEntries([...tally].sort()), null, 1), JSON.stringify(maxima));
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

// ---- I5 on a REAL process group: a spawned server forks; the oracle is the process table (/proc), not a seam ----
const procsWithMarker = (spawnId: string): number[] => {
  const out: number[] = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try { if (readFileSync(`/proc/${d}/environ`).includes(`COGNATE_SPAWN_ID=${spawnId}`)) out.push(Number(d)); } catch { /* gone or not ours */ }
  }
  return out;
};
describe("J-CAP-t3-properties: slot release with a real forking process group", () => {
  const shape = fc.record({ fork: fc.constantFrom("group" as const, "setsid" as const, "nested" as const), stopFirst: fc.boolean() });
  const argvFor = (fork: "group" | "setsid" | "nested"): string[] => fork === "group" ? ["sh", "-c", "sleep 30 & sleep 30 & wait"] : fork === "setsid" ? ["sh", "-c", "setsid sleep 30 & sleep 30 & wait"] : ["sh", "-c", "sh -c 'sleep 30 & wait' & wait"];
  test(`a released slot means the process table holds no member of the group (${Math.min(RUNS, 12)} runs)`, async () => {
    await fc.assert(fc.asyncProperty(shape, async (sc) => {
      const events: LedgerEvent[] = [];
      const released: string[] = [];
      const result = await spawnGoverned({
        registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
        ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async () => {},
        slots: { acquire: async () => ({ slotId: "s" }), release: async (id) => { released.push(id); } },
        localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 100, killMs: 100, reapWaitMs: 300,
      }, { capabilityId: "capability.bundle.props", version: "v", serverId: "gen", worldId: "local", argv: argvFor(sc.fork), cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { spawnId, pgid } = result.handle;
      await sleep(sc.stopFirst ? 20 : 80);
      result.handle.stop("test", "emergency");
      await result.handle.exited;
      const survivors = procsWithMarker(spawnId);
      let groupAlive = true;
      try { process.kill(-pgid, 0); } catch { groupAlive = false; }
      count(`i5-real:${sc.fork}:${released.length === 1 ? "released" : "kept"}`);
      for (const pid of survivors) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
      // the slot is released iff nothing of the spawn survives, read from the process table
      expect(released.length === 1, "released iff the process table is clean").toBe(survivors.length === 0 && !groupAlive);
      expect(survivors.length === 0 && !groupAlive, "nothing of the group survives").toBe(true);
    }), { numRuns: Math.min(RUNS, 12) });
    if (process.env.FC_STATS) console.log("i5 real", JSON.stringify(Object.fromEntries([...tally].filter(([k]) => k.startsWith("i5-real")))));
  }, 5 * 60_000);
});
