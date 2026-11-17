// Capability-bundles tranche T3 (design §2.1C, §10): the MCP protocol client. The official
// TypeScript SDK does the protocol (handshake, version negotiation, tools/list, tools/call); the
// only integration point is `ChannelTransport`, a custom SDK Transport over a stdio-shaped byte
// channel that the governed spawn wrapper owns (`execSpawn.ts`). The client declares NO client
// capabilities, so server-initiated requests (sampling, roots, elicitation) are refused by the
// SDK itself (§2.1B: unsupported in v1); `ChannelTransport` additionally drops them defensively.
//
// MCP-supplied tool names and schemas are untrusted data (§11): names are pattern-checked, sizes
// are bounded in UTF-8 bytes (never characters or estimates), schemas must compile under ajv, and a
// tool failing any check is excluded from the listing, with the exclusion reported. Every call is
// recorded BEFORE it is sent (`capability.mcp.tool_invoked`, phase started) and after it ends
// (phase finished); arguments are recorded as a digest and a byte count, never as content.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ResultSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ValidateFunction } from "ajv";
import { INGRESS, isPlain, type Inbound, LineFramer, measureJson, parseToolResult, snapshotJson, jsonBytes, unsupportedRequestReply, type RpcId, type Violation } from "./ingress.ts";
import { adoptId, boundText, digestId, mintId, sha256Of, shortSha, text, type CallCode, type MintedId, type RecordCode, type Sha256, type StripClass, type Trusted, type TypedPayload } from "./typedRecord.ts";

/** The wrapper-owned byte channel to a spawned server: what the SDK transport needs, nothing more. */
export interface StdioChannel {
  /** Rejects (or throws) on a write fault such as EPIPE; the transport then closes the whole connection. */
  write(data: string): void | Promise<void>;
  /** A listener may return a promise: the stream is not read again until it settles (backpressure). */
  onData(listener: (chunk: Buffer) => void | Promise<void>): void;
  /** Fires when either pipe closes or the process ends. */
  onClose(listener: () => void): void;
  close(): Promise<void>;
  /** Stop reading the server's stdout until `resume()` (optional: a channel that awaits listeners gets backpressure anyway). */
  pause?(): void;
  resume?(): void;
}

export const MCP_LIMITS = {
  maxTools: 64,
  maxDescriptionBytes: 2048,
  maxSchemaBytes: 16 * 1024,
  /** Largest serialized tool result handed to the model (UTF-8 bytes); larger results are refused, never truncated silently. */
  maxResultBytes: 256 * 1024,
  maxArgumentBytes: 64 * 1024,
} as const;

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const SERVER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const isServerId = (value: string): boolean => SERVER_ID.test(value);
export const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");
/** Cut a string to a UTF-8 byte bound on a character boundary. */
export function boundBytes(value: string, max: number): string {
  if (utf8Bytes(value) <= max) return value;
  // The marker is part of the bound, and the cut falls between code points.
  const marker = max >= 3 ? "..." : "";
  const budget = max - marker.length;
  let used = 0;
  let end = 0;
  for (const ch of value) {
    const size = utf8Bytes(ch);
    if (used + size > budget) break;
    used += size;
    end += ch.length;
  }
  return `${value.slice(0, end)}${marker}`;
}
const MAX_MESSAGE_BYTES = 512;

/** Untrusted schema handling (section 11, input and output schemas alike): the server validates its own input, so our
 *  validation is defence in depth and is reduced to an ALLOWLIST of cheap structural keywords. Anything else (patterns,
 *  formats, uniqueItems, combinators, references, definitions, ...) is stripped, so no server schema can select an
 *  expensive validation algorithm. Depth and node count are bounded. Returns what was stripped (named only from the
 *  standard vocabulary: a server-chosen keyword name is never recorded), or a refusal reason. */
const SCHEMA_MAX_DEPTH = 16;
const SCHEMA_MAX_NODES = 512;
const KEEP_NUMBER = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems"]);
const KEEP_TEXT = new Set(["description", "title"]);
const KEEP_DATA = new Set(["enum", "const", "default"]);
const cls = (c: StripClass, ...keys: string[]): [string, StripClass][] => keys.map((k) => [k, c]);
/** Our own table: standard keyword -> the class recorded for it. The server's spelling of a keyword is never recorded. */
const STRIP_CLASS: ReadonlyMap<string, StripClass> = new Map<string, StripClass>([
  ...cls("strip.reference", "$ref", "$dynamicRef", "$recursiveRef", "$defs", "definitions", "$id", "$anchor"),
  ...cls("strip.pattern", "pattern", "patternProperties", "propertyNames"),
  ...cls("strip.format", "format", "contentEncoding", "contentMediaType", "contentSchema"),
  ...cls("strip.combinator", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependencies", "dependentSchemas", "dependentRequired", "additionalItems", "unevaluatedItems", "unevaluatedProperties", "contains", "minContains", "maxContains", "prefixItems", "discriminator"),
  ...cls("strip.annotation", "$schema", "$comment", "$async", "examples", "readOnly", "writeOnly", "deprecated", "nullable"),
  ...cls("strip.unique", "uniqueItems", "multipleOf", "minProperties", "maxProperties"),
]);
export function sanitizeSchema(schema: unknown): { ok: true; schema: Record<string, unknown>; stripped: StripClass[] } | { ok: false; reason: Trusted } {
  const stripped = new Set<StripClass>();
  let nodes = 0;
  let problem: Trusted | undefined;
  const drop = (key: string): void => { stripped.add(STRIP_CLASS.get(key) ?? "strip.other"); };
  const bound = (depth: number): boolean => {
    if (problem) return false;
    if (depth > SCHEMA_MAX_DEPTH) { problem = text`schema nests deeper than ${SCHEMA_MAX_DEPTH} levels`; return false; }
    if (++nodes > SCHEMA_MAX_NODES) { problem = text`schema has more than ${SCHEMA_MAX_NODES} nodes`; return false; }
    return true;
  };
  /** Literal data (enum, const, default): bounded like the rest, never rewritten. */
  const data = (value: unknown, depth: number): unknown => {
    if (!bound(depth)) return value;
    if (Array.isArray(value)) for (const v of value) data(v, depth + 1);
    else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) data(v, depth + 1);
    return value;
  };
  const schemaAt = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) { if (typeof value !== "boolean") problem ??= text`a schema position holds neither an object nor a boolean`; return typeof value === "boolean" ? value : {}; }
    if (!bound(depth)) return value;
    const node = value as Record<string, unknown>;
    for (const k of ["$ref", "$dynamicRef", "$recursiveRef"]) if (typeof node[k] === "string") { drop(k); return {}; }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(node)) {
      if (key === "type" && (typeof v === "string" || (Array.isArray(v) && v.every((t) => typeof t === "string")))) out.type = v;
      else if (key === "required" && Array.isArray(v) && v.every((t) => typeof t === "string")) out.required = data(v, depth + 1);
      else if (KEEP_NUMBER.has(key) && typeof v === "number") out[key] = v;
      else if (KEEP_TEXT.has(key) && typeof v === "string") out[key] = v;
      else if (KEEP_DATA.has(key)) out[key] = data(v, depth + 1);
      else if (key === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
        bound(depth + 1);
        out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, schemaAt(sub, depth + 2)]));
      } else if (key === "items" && v && typeof v === "object" && !Array.isArray(v)) out.items = schemaAt(v, depth + 1);
      else if (key === "additionalProperties" && (typeof v === "boolean" || (v && typeof v === "object" && !Array.isArray(v)))) out.additionalProperties = typeof v === "boolean" ? v : schemaAt(v, depth + 1);
      else drop(key);
    }
    return out;
  };
  const result = schemaAt(schema, 0);
  return problem ? { ok: false, reason: problem } : { ok: true, schema: result as Record<string, unknown>, stripped: [...stripped] };
}

/** What the transport reports to its client. Nothing here is derived from message text. */
export interface TransportHooks {
  /** Every outbound message: the client correlates a call's request id here and may rewrite the message. */
  readonly onOutbound?: (message: JSONRPCMessage) => JSONRPCMessage;
  /** The size and digest of a server error response (its text never leaves the ingress module). */
  readonly onServerError?: (id: RpcId, code: number, digest: { readonly bytes: number | null; readonly sha256: Sha256 | null }) => void;
  /** Oversize, too-deep or malformed input: a protocol violation for the whole connection (closed right after this call). */
  readonly onViolation?: (violation: Violation) => void;
}

/** What the transport holds right now, summed from the actual structures (never a counter). */
export interface Retained { readonly partialLine: number; readonly queuedChunks: number; readonly parsedMessage: number }

/** The SDK transport over the wrapper's byte channel. Every inbound byte goes through the ingress boundary (`LineFramer`).
 *  Flow control: received chunks wait in a queue that is consumed one parsed message at a time; at `queueHighBytes` the
 *  channel is paused (and an awaited listener holds the stream), and it resumes below `queueLowBytes`.
 *  Any transport fault (a write error, EPIPE, either pipe closing) closes the WHOLE connection, which rejects every
 *  pending SDK handler. */
export class ChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  #closed = false;
  readonly #framer = new LineFramer();
  #queue: Buffer[] = [];
  #parsed = 0;
  #draining: Promise<void> | undefined;
  #paused = false;
  /** High-water marks of each retained component, each measured from the live structures when it changed. */
  readonly peaks = { partialLine: 0, queuedChunks: 0, parsedMessage: 0, pauses: 0 };
  /** `filter` sees every typed response BEFORE the SDK does: nothing server-supplied reaches the SDK unsanitized. */
  constructor(private readonly channel: StdioChannel, private readonly filter?: (message: JSONRPCMessage) => JSONRPCMessage, private readonly hooks: TransportHooks = {}) {}

  /** The most bytes buffered for one partial line so far. */
  get peakBufferedBytes(): number { return this.#framer.peakBufferedBytes; }
  /** Retained right now, summed from the structures. */
  get retained(): Retained {
    let queued = 0;
    for (const c of this.#queue) queued += c.length;
    return { partialLine: this.#framer.heldBytes, queuedChunks: queued, parsedMessage: this.#parsed };
  }
  #measure(): void {
    const r = this.retained;
    this.peaks.partialLine = Math.max(this.peaks.partialLine, r.partialLine);
    this.peaks.queuedChunks = Math.max(this.peaks.queuedChunks, r.queuedChunks);
    this.peaks.parsedMessage = Math.max(this.peaks.parsedMessage, r.parsedMessage);
  }

  async start(): Promise<void> {
    this.channel.onData((chunk) => {
      if (this.#closed) return;
      this.#queue.push(chunk);
      this.#measure();
      if (!this.#paused && this.retained.queuedChunks >= INGRESS.queueHighBytes) { this.#paused = true; this.peaks.pauses++; this.channel.pause?.(); }
      this.#draining ??= this.#drain().finally(() => { this.#draining = undefined; });
      return this.#draining;
    });
    this.channel.onClose(() => {
      if (this.#closed) return;
      this.#closed = true;
      this.#queue = [];
      this.onclose?.();
      void this.channel.close().catch(() => {}); // a pipe closed: the server is stopped, not left running half-connected
    });
  }

  async #drain(): Promise<void> {
    while (!this.#closed && this.#queue.length > 0) {
      const chunk = this.#queue[0]!; // stays in the queue (and counted) until fully consumed
      for (const event of this.#framer.feed(chunk)) {
        if (this.#closed) break;
        if (event.kind === "violation") {
          this.hooks.onViolation?.(event.violation);
          await this.close().catch(() => {});
          return;
        }
        this.#parsed = event.bytes;
        this.#measure();
        const ok = await this.#dispatch(event.message);
        this.#parsed = 0;
        if (!ok) return;
        await new Promise((resolve) => setImmediate(resolve)); // let the consumer run before the next message is parsed
      }
      this.#queue.shift();
      if (this.#paused && this.retained.queuedChunks < INGRESS.queueLowBytes) { this.#paused = false; this.channel.resume?.(); }
    }
    if (this.#paused && this.#queue.length === 0) { this.#paused = false; this.channel.resume?.(); }
  }

  /** Returns false when the connection was closed by this message. */
  async #dispatch(m: Inbound): Promise<boolean> {
    // Server-initiated REQUESTS are not supported (no sampling/roots in v1): answered by ingress with a fixed error, never surfaced.
    if (m.kind === "request") { await this.#write(unsupportedRequestReply(m.id)).catch(() => {}); return !this.#closed; }
    if (m.kind === "error") {
      this.hooks.onServerError?.(m.id, m.code, m.digest);
      this.onmessage?.({ jsonrpc: "2.0", id: m.id, error: { code: m.code, message: "server error" } } as JSONRPCMessage);
    } else if (m.kind === "notification") this.onmessage?.({ jsonrpc: "2.0", method: m.method, ...(m.params ? { params: m.params } : {}) } as JSONRPCMessage);
    else {
      const wire = { jsonrpc: "2.0", id: m.id, result: m.result } as JSONRPCMessage;
      let out: JSONRPCMessage;
      try { out = this.filter ? this.filter(wire) : wire; } catch {
        // An entry that is not what the envelope promised: the same connection-level violation as malformed bytes.
        const size = measureJson(m.result);
        this.hooks.onViolation?.({ reason: "malformed", bytes: size.bytes ?? 0, sha256: size.sha256 ?? sha256Of("") });
        await this.close().catch(() => {});
        return false;
      }
      this.onmessage?.(out);
    }
    return true;
  }

  /** The one write path: a failure of any kind closes the whole connection (rejecting every pending SDK handler), then rethrows. */
  async #write(line: string): Promise<void> {
    if (this.#closed) throw new Error("MCP channel is closed");
    try { await this.channel.write(line); } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.#write(serializeMessage(this.hooks.onOutbound ? this.hooks.onOutbound(message) : message));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue = [];
    try { await this.channel.close(); } finally { this.onclose?.(); }
  }
}

/** Before a client exists to sanitize them, output schemas are dropped outright. */
function stripOutputSchemas(message: JSONRPCMessage): JSONRPCMessage {
  const result = (message as { result?: { tools?: unknown } }).result;
  if (!result || !Array.isArray(result.tools)) return message;
  return { ...message, result: { ...result, tools: result.tools.map((t: Record<string, unknown>) => { const { outputSchema: _dropped, ...rest } = t; return rest; }) } } as JSONRPCMessage;
}

/** What a record carries: a type from a closed set and a payload whose fields have a closed type (see typedRecord.ts). */
export interface McpRecord { readonly type: "capability.mcp.tool_invoked" | "authority.decision.recorded"; readonly payload: TypedPayload }

export interface McpToolDef {
  /** The namespaced id: `mcp.<serverId>.<toolName>`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type McpCallOutcome =
  | { readonly ok: true; readonly result: unknown; readonly bytes: number }
  | { readonly ok: false; readonly code: CallCode; readonly message: Trusted };

export interface McpClientOptions {
  readonly capabilityId: string;
  readonly version: string;
  readonly serverId: string;
  readonly sessionId?: string;
  /** Record path (the spawn-ledger stream). A failing record refuses the call (record before act). */
  readonly record: (event: McpRecord, key: MintedId) => Promise<void>;
  /** Scrubs this server's resolved secrets (and encodings) from every result string that leaves the client. */
  readonly scrub?: (text: string) => string;
  readonly connectTimeoutMs?: number;
}

/** A failed connect: carries only the size and digest of the error (the SDK's own text can quote the server). */
export class McpConnectError extends Error {
  constructor(readonly digest: { readonly bytes: number | null; readonly sha256: Sha256 | null }) { super("MCP handshake failed"); }
}

/** How long past its deadline a call may wait for its finished record. */
const FINISH_GRACE_MS = 250;
/** Wait for a promise at most `ms` (the promise itself is left running). */
function settleWithin(promise: Promise<void>, ms: number): Promise<"done" | "failed" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), Math.max(0, ms));
    promise.then(() => { clearTimeout(timer); resolve("done"); }, () => { clearTimeout(timer); resolve("failed"); });
  });
}

/** Per-call state, owned by us: classification of a failure comes from here, never from error text or elapsed time. */
interface PendingCall {
  id?: RpcId;
  deadlineFired: boolean;
  failure: { readonly reason: Violation["reason"]; readonly bytes: number; readonly sha256: Sha256 } | null;
  serverError: { readonly bytes: number | null; readonly sha256: Sha256 | null } | null;
}
const CORRELATION_META = "io.cognate/correlation";
const INTERNAL: McpCallOutcome = { ok: false, code: "internal_error", message: text`the call failed internally` };

export class McpClient {
  #tools = new Map<string, { def: McpToolDef; validate: ValidateFunction; validateOut?: ValidateFunction }>();
  #excluded: { name: string; reason: string }[] = [];
  #closed = false;
  /** In-flight tools/call requests. */
  readonly #byCorrelation = new Map<string, PendingCall>();
  readonly #pendingById = new Map<RpcId, PendingCall>();
  readonly #ajv = new Ajv({ strict: false });
  readonly #ids: { capabilityId: MintedId; version: MintedId; serverId: MintedId; sessionId?: MintedId };

  private constructor(private readonly sdk: Client, private readonly transport: ChannelTransport, private readonly options: McpClientOptions) {
    this.#ids = { capabilityId: adoptId(options.capabilityId), version: adoptId(options.version), serverId: adoptId(options.serverId), ...(options.sessionId ? { sessionId: adoptId(options.sessionId) } : {}) };
  }

  readonly #scrub = (value: string): string => (this.options.scrub ? this.options.scrub(value) : value);
  #clean<T>(value: T): T {
    if (typeof value === "string") return this.#scrub(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.#clean(v)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [this.#scrub(k), this.#clean(v)])) as T;
    return value;
  }
  /** The ONE record writer of this client: typed payloads only (a server string cannot be passed). */
  /** `async`, so a synchronous throw of the writer is a rejection. `key` is the record's minted id: the store deduplicates by it. */
  readonly #rec = async (type: McpRecord["type"], payload: TypedPayload, key: MintedId = mintId()): Promise<void> => this.options.record({ type, payload }, key);
  /** A bounded message built from typed parts only. */
  #msg(message: Trusted): Trusted { return boundText(message, MAX_MESSAGE_BYTES); }
  #decision(outcome: "allowed" | "refused", reasonCode: RecordCode, reason: Trusted, extra: TypedPayload = {}): Promise<void> {
    return this.#rec("authority.decision.recorded", { point: "mcp-client", capability: this.#ids.capabilityId, operation: "tools.list", serverId: this.#ids.serverId, version: this.#ids.version, decisionId: mintId(), outcome, reasonCode, reason, ...extra });
  }

  /** The SDK validates `structuredContent` itself with a backtracking regex engine, so output schemas are sanitized to
   *  the structural allowlist BEFORE the SDK sees them. At most one refusal and one sanitization record per message. */
  #sanitizeOutputSchemas(message: JSONRPCMessage): JSONRPCMessage {
    const result = (message as { result?: { tools?: unknown } }).result;
    if (!result || !Array.isArray(result.tools)) return message;
    const refusals: { tool: MintedId; reason: Trusted }[] = [];
    const sanitizations: { tool: MintedId; keywords: StripClass[] }[] = [];
    // Every entry is checked before any field is read: a non-object entry is malformed input (a protocol violation).
    if (!result.tools.every(isPlain)) throw new Error("malformed tools list");
    const tools = result.tools.map((raw: Record<string, unknown>, index: number) => {
      if (raw.outputSchema === undefined) return raw;
      const { outputSchema, ...rest } = raw;
      if (index >= MCP_LIMITS.maxTools) return rest;
      const rawName = String(raw.name ?? "");
      if (!TOOL_NAME.test(rawName)) return rest; // a rejected name is neither audited nor named
      const tool = digestId(rawName);
      const refuse = (reason: Trusted): Record<string, unknown> => { refusals.push({ tool, reason }); return rest; };
      const snap = snapshotJson<{ $async?: unknown }>(outputSchema, MCP_LIMITS.maxSchemaBytes);
      if (!snap) return refuse(text`outputSchema: schema exceeds the byte bound`);
      const cleaned = this.#clean(snap.value);
      if (cleaned && typeof cleaned === "object" && (cleaned as { $async?: unknown }).$async) return refuse(text`outputSchema: asynchronous schemas are not accepted`);
      const safe = sanitizeSchema(cleaned);
      if (!safe.ok) return refuse(text`outputSchema: ${safe.reason}`);
      if (safe.stripped.length > 0) sanitizations.push({ tool, keywords: safe.stripped });
      return { ...rest, outputSchema: safe.schema };
    });
    if (refusals.length > 0) void this.#decision("refused", "schema-refused", text`outputSchema refused for ${refusals.length} tool(s)`, { tools: refusals }).catch(() => {});
    if (sanitizations.length > 0) void this.#decision("allowed", "schema-sanitized", text`outputSchema keywords outside the structural allowlist were stripped`, { stripped: [...new Set(sanitizations.flatMap((x) => x.keywords))], tools: sanitizations.map((x) => ({ tool: x.tool, stripped: x.keywords })) }).catch(() => {});
    return { ...message, result: { ...result, tools } } as JSONRPCMessage;
  }

  static async connect(channel: StdioChannel, options: McpClientOptions): Promise<McpClient> {
    if (!isServerId(options.serverId)) throw new Error("invalid MCP server id");
    const holder: { client?: McpClient } = {};
    const transport = new ChannelTransport(channel, (message) => (holder.client ? holder.client.#sanitizeOutputSchemas(message) : stripOutputSchemas(message)), {
      onOutbound: (message) => (holder.client ? holder.client.#correlate(message) : message),
      onServerError: (id, _code, digest) => { if (holder.client) holder.client.#serverError(id, digest); },
      onViolation: (violation) => { if (holder.client) holder.client.#violation(violation); },
    });
    // No capabilities declared: sampling, roots and elicitation are refused by construction.
    const sdk = new Client({ name: "cognate-workbench", version: "1" }, { capabilities: {} });
    const client = new McpClient(sdk, transport, options);
    holder.client = client;
    transport.onclose = () => { client.#closed = true; };
    try {
      await sdk.connect(transport, { timeout: options.connectTimeoutMs ?? 15_000 });
      await client.refreshTools();
    } catch (error) {
      void client.close();
      throw new McpConnectError(digestOfError(error));
    }
    return client;
  }

  #serverError(id: RpcId, digest: { bytes: number | null; sha256: Sha256 | null }): void {
    const pending = this.#pendingById.get(id);
    if (pending) pending.serverError = digest;
  }

  /** Correlate an outbound tools/call with its pending entry by request id; the correlation key never reaches the server. */
  #correlate(message: JSONRPCMessage): JSONRPCMessage {
    const m = message as { method?: string; id?: RpcId; params?: { _meta?: Record<string, unknown> } };
    const key = m.method === "tools/call" ? m.params?._meta?.[CORRELATION_META] : undefined;
    if (typeof key !== "string") return message;
    const pending = this.#byCorrelation.get(key);
    if (pending && m.id !== undefined) { pending.id = m.id; this.#pendingById.set(m.id, pending); }
    const { [CORRELATION_META]: _drop, ...meta } = m.params?._meta ?? {};
    void _drop;
    const { _meta: _old, ...params } = m.params ?? {};
    void _old;
    return { ...message, params: { ...params, ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}) } } as JSONRPCMessage;
  }

  /** Oversize, too-deep or malformed input is a protocol violation for the whole connection: there is no attribution, so
   *  EVERY pending call fails (attributed:false) and the transport closes the connection (the normal stop path). */
  #violation(v: Violation): void {
    for (const pending of this.#byCorrelation.values()) pending.failure ??= { reason: v.reason, bytes: v.bytes, sha256: v.sha256 };
    const code: RecordCode = v.reason === "oversize" ? "oversize-message" : v.reason === "too-deep" ? "too-deep-message" : "malformed-message";
    void this.#decision("refused", code, text`an inbound message violated the ingress bounds; the connection was closed`, { operation: "transport", bytes: v.bytes, sha256: v.sha256, attributed: false }).catch(() => {});
  }

  /** Inspection: in-flight calls (must return to 0) and the most bytes the transport ever buffered for one line. */
  get pendingCount(): number { return this.#pendingById.size + this.#byCorrelation.size; }
  get peakBufferedBytes(): number { return this.transport.peakBufferedBytes; }
  /** Ground truth for the buffering cap: what the transport holds now and its high-water marks, summed from its structures. */
  get retained(): Retained { return this.transport.retained; }
  get retainedPeaks(): ChannelTransport["peaks"] { return this.transport.peaks; }

  get closed(): boolean { return this.#closed; }
  get excluded(): readonly { name: string; reason: string }[] { return this.#excluded; }

  /** Live tools/list, validated as untrusted data. */
  async refreshTools(): Promise<readonly McpToolDef[]> {
    // Follow nextCursor (the MCP pagination contract), bounded by pages and by the tool bound.
    const collected: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
    let cursor: string | undefined;
    let truncatedByPages = false;
    for (let page = 0; page < 8; page++) {
      const listed = await this.sdk.listTools(cursor ? { cursor } : undefined, { timeout: 15_000 });
      collected.push(...listed.tools);
      cursor = listed.nextCursor;
      if (!cursor || collected.length > MCP_LIMITS.maxTools) break;
      if (page === 7) truncatedByPages = true;
    }
    const tools = new Map<string, { def: McpToolDef; validate: ValidateFunction; validateOut?: ValidateFunction }>();
    const excluded: { name: string; reason: string }[] = [];
    const sanitized: { tool: MintedId; keywords: StripClass[] }[] = [];
    const refused: { tool: MintedId; reason: Trusted }[] = [];
    for (const raw of collected.slice(0, MCP_LIMITS.maxTools)) {
      const rawName = String(raw.name);
      const ref = digestId(rawName); // a tool is only ever named by digest in a record, a listing of exclusions or a log
      // Validate the name FIRST.
      if (!TOOL_NAME.test(rawName)) { excluded.push({ name: ref, reason: "name violates the tool-name pattern" }); continue; }
      const name = this.#scrub(rawName);
      if (name !== rawName) { excluded.push({ name: ref, reason: "name carried secret material" }); continue; }
      const description = this.#scrub(String(raw.description ?? ""));
      if (utf8Bytes(description) > MCP_LIMITS.maxDescriptionBytes) { excluded.push({ name: ref, reason: "description exceeds the byte bound" }); continue; }
      const snap = snapshotJson<{ $async?: unknown }>(raw.inputSchema, MCP_LIMITS.maxSchemaBytes);
      if (!snap) { excluded.push({ name: ref, reason: "input schema exceeds the byte bound" }); refused.push({ tool: ref, reason: text`input schema exceeds the byte bound` }); continue; }
      if (tools.has(name)) { excluded.push({ name: ref, reason: "duplicate tool name" }); continue; }
      const parsed = this.#clean(snap.value);
      // An `$async` schema would make `validate` return a Promise (truthy): never accept one.
      if (parsed && typeof parsed === "object" && (parsed as { $async?: unknown }).$async) { excluded.push({ name: ref, reason: "asynchronous input schemas are not accepted" }); continue; }
      const safe = sanitizeSchema(parsed);
      if (!safe.ok) { excluded.push({ name: ref, reason: safe.reason }); refused.push({ tool: ref, reason: safe.reason }); continue; }
      if (safe.stripped.length > 0) sanitized.push({ tool: ref, keywords: safe.stripped });
      try {
        const validate = this.#ajv.compile(safe.schema);
        const outSchema = (raw as { outputSchema?: unknown }).outputSchema;
        const validateOut = outSchema && typeof outSchema === "object" ? this.#ajv.compile(outSchema as Record<string, unknown>) : undefined;
        tools.set(name, { ...(validateOut ? { validateOut } : {}), def: { id: `mcp.${this.options.serverId}.${name}`, name, description, inputSchema: safe.schema }, validate });
      } catch (error) {
        excluded.push({ name: ref, reason: `input schema does not compile (${digestOfError(error).bytes ?? "?"} bytes)` });
      }
    }
    for (const r of refused) await this.#decision("refused", "schema-refused", r.reason, { tool: r.tool }).catch(() => {});
    if (sanitized.length > 0) await this.#decision("allowed", "schema-sanitized", text`server-supplied schema keywords outside the structural allowlist were stripped`, { stripped: [...new Set(sanitized.flatMap((x) => x.keywords))], tools: sanitized.map((x) => ({ tool: x.tool, stripped: x.keywords })) }).catch(() => {});
    if (truncatedByPages || cursor) excluded.push({ name: "*", reason: "further tools pages were not read (page or tool bound reached)" });
    if (collected.length > MCP_LIMITS.maxTools) excluded.push({ name: "*", reason: `${collected.length - MCP_LIMITS.maxTools} tools beyond the ${MCP_LIMITS.maxTools}-tool bound` });
    this.#tools = tools;
    this.#excluded = excluded;
    return this.tools();
  }

  tools(): readonly McpToolDef[] { return [...this.#tools.values()].map((t) => t.def); }

  /** One call, one finished record: every path returns through here, and nothing on the failure path can throw. */
  async callTool(name: string, args: Record<string, unknown>, call: { timeoutMs: number; signal?: AbortSignal; callId?: string; actorId: string }): Promise<McpCallOutcome> {
    const deadlineAt = Date.now() + call.timeoutMs; // the caller's deadline counts from entry, not from the send
    const pending: PendingCall = { deadlineFired: false, failure: null, serverError: null };
    const correlation = String(mintId());
    const trace: { started: boolean; resultBytes?: number } = { started: false };
    let base: Record<string, MintedId> = {};
    let outcome: McpCallOutcome = INTERNAL;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      base = { ...this.#ids, callId: adoptId(call.callId ?? String(mintId())), tool: digestId(name), actorId: adoptId(call.actorId) };
      outcome = await this.#execute(name, args, call, deadlineAt, pending, correlation, controller, base, trace, (t) => { timer = t; }, onAbort);
    } catch {
      outcome = INTERNAL;
    } finally {
      if (timer) clearTimeout(timer);
      call.signal?.removeEventListener("abort", onAbort);
      this.#byCorrelation.delete(correlation);
      if (pending.id !== undefined) this.#pendingById.delete(pending.id);
    }
    // The durable finished record is the COMMIT POINT: the result is delivered only after the store confirmed it. The record
    // has a minted id and the store deduplicates by it, so a retry (or write-then-reject) can never produce a second record.
    const recordId = mintId();
    const finished: TypedPayload = {
      ...base, phase: "finished", recordId, outcome: outcome.ok ? "ok" : outcome.code,
      ...(outcome.ok ? { resultBytes: outcome.bytes } : {}),
      ...(pending.failure ? { violation: pending.failure.reason === "oversize" ? "oversize-message" : pending.failure.reason === "too-deep" ? "too-deep-message" : "malformed-message", violationBytes: pending.failure.bytes, violationSha256: pending.failure.sha256, attributed: false } : {}),
      ...(pending.serverError ? { serverErrorBytes: pending.serverError.bytes, serverErrorSha256: pending.serverError.sha256 } : {}),
    };
    const until = deadlineAt + FINISH_GRACE_MS;
    let confirmed = false;
    for (let attempt = 0; attempt < 6 && !confirmed; attempt++) {
      const left = until - Date.now();
      if (left <= 0) break;
      const r = await settleWithin(this.#rec("capability.mcp.tool_invoked", finished, recordId), left);
      if (r === "done") confirmed = true;
      else if (r === "timeout") break; // a stalled write is never raced by a second one
      else await new Promise((resolve) => setTimeout(resolve, Math.min(10 * (attempt + 1), Math.max(0, until - Date.now()))));
    }
    if (!confirmed) return { ok: false, code: "record_failed", message: text`the call's finished record could not be confirmed, so its result is withheld` };
    return outcome;
  }

  async #execute(name: string, args: Record<string, unknown>, call: { timeoutMs: number; signal?: AbortSignal; actorId: string }, deadlineAt: number, pending: PendingCall, correlation: string, controller: AbortController, base: Record<string, MintedId>, trace: { started: boolean }, setTimer: (t: ReturnType<typeof setTimeout>) => void, onAbort: () => void): Promise<McpCallOutcome> {
    const fail = (code: CallCode, message: Trusted): McpCallOutcome => ({ ok: false, code, message: this.#msg(message) });
    const tool = digestId(name);
    if (this.#closed) return fail("server_not_running", text`the MCP server is not running`);
    const entry = this.#tools.get(name);
    if (!entry) return fail("unknown_tool", text`the server lists no tool ${tool}`);
    let argText: string;
    try { argText = JSON.stringify(args ?? {}); } catch { return fail("schema_invalid", text`the arguments cannot be serialized`); }
    const argBytes = utf8Bytes(argText);
    if (argBytes > MCP_LIMITS.maxArgumentBytes) return fail("arguments_too_large", text`arguments are ${argBytes} bytes; the bound is ${MCP_LIMITS.maxArgumentBytes}`);
    // One snapshot: what is validated, hashed, recorded and sent is exactly this value, whatever the caller does to `args` afterwards.
    const snapshot = JSON.parse(argText) as Record<string, unknown>;
    const verdict = entry.validate(snapshot) as unknown;
    if (verdict instanceof Promise) { void verdict.catch(() => {}); return fail("schema_invalid", text`the server's schema is asynchronous and cannot be enforced`); }
    if (!verdict) return fail("schema_invalid", text`arguments for ${tool} violate the server's schema (${entry.validate.errors?.length ?? 0} violation(s))`);
    // Record BEFORE the call is sent: an unrecordable invocation is not made. The wait counts against the call's deadline.
    const wrote = await settleWithin(this.#rec("capability.mcp.tool_invoked", { ...base, phase: "started", argumentsSha256: sha256Of(argText), argumentBytes: argBytes }), deadlineAt - Date.now());
    if (wrote === "failed") return fail("record_failed", text`the invocation could not be recorded, so it was not sent`);
    if (wrote === "timeout") { pending.deadlineFired = true; return fail("deadline_exceeded", text`the invocation record consumed the deadline; nothing was sent`); }
    trace.started = true;
    try {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) { pending.deadlineFired = true; return fail("deadline_exceeded", text`the invocation record consumed the deadline`); }
      this.#byCorrelation.set(correlation, pending);
      setTimer(setTimeout(() => { pending.deadlineFired = true; controller.abort(); }, remaining));
      call.signal?.addEventListener("abort", onAbort, { once: true });
      if (call.signal?.aborted) onAbort();
      // `request`, not `callTool`: the SDK never validates structuredContent (a backtracking validator on server data).
      const raw = await this.sdk.request({ method: "tools/call", params: { name, arguments: snapshot, _meta: { [CORRELATION_META]: correlation } } }, ResultSchema, { timeout: remaining + 5000, signal: controller.signal });
      const result = parseToolResult(raw);
      if (!result) return fail("output_invalid", text`the result of ${tool} is not a valid tool result`);
      if (entry.validateOut && result.isError !== true && !(result.structuredContent !== undefined && (entry.validateOut(result.structuredContent) as unknown) === true)) return fail("output_invalid", text`the result of ${tool} does not satisfy its output schema`);
      const cleaned = this.#clean(result);
      const bytes = jsonBytes(cleaned);
      if (bytes === undefined) return fail("output_invalid", text`the result of ${tool} cannot be measured`);
      if (bytes > MCP_LIMITS.maxResultBytes) return fail("result_too_large", text`the tool result is ${bytes} bytes after redaction; the bound is ${MCP_LIMITS.maxResultBytes}`);
      return { ok: true, result: cleaned, bytes };
    } catch {
      // Facts come only from our own state: the ingress verdict, our deadline timer, the channel, the caller's signal.
      const f = pending.failure;
      if (f) return fail(f.reason === "oversize" ? "result_too_large" : "server_error", f.reason === "oversize" ? text`an inbound message of ${f.bytes} bytes (sha256 ${shortSha(f.sha256)}) exceeded the ${MCP_LIMITS.maxResultBytes}-byte bound; not attributable to a request, the connection was closed` : text`the server violated the message bounds (${f.bytes} bytes, sha256 ${shortSha(f.sha256)}); the connection was closed`);
      if (pending.deadlineFired) return fail("deadline_exceeded", text`the call did not finish before its deadline`);
      if (this.#closed) return fail("server_not_running", text`the MCP server is not running`);
      if (call.signal?.aborted) return fail("cancelled", text`the call was cancelled by the caller`);
      const e = pending.serverError;
      return fail("server_error", e && e.bytes !== null && e.sha256 !== null ? text`the server reported an error (${e.bytes} bytes, sha256 ${shortSha(e.sha256)})` : text`the server reported an error (unmeasurable)`);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.sdk.close().catch(() => {});
  }
}

/** The size and digest of an error whose text may quote a server (the SDK's own messages can). Never throws. */
function digestOfError(error: unknown): { bytes: number | null; sha256: Sha256 | null } {
  return measureJson(error instanceof Error ? error.message : String(error));
}
