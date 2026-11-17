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
import { deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpError, ResultSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ValidateFunction } from "ajv";
import { createHash, randomUUID } from "node:crypto";

/** The wrapper-owned byte channel to a spawned server: what the SDK transport needs, nothing more. */
export interface StdioChannel {
  write(data: string): void | Promise<void>;
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

export const MCP_LIMITS = {
  /** Largest single JSON-RPC line the transport will buffer (UTF-8 bytes). */
  maxLineBytes: 1024 * 1024,
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

/** Opaque description of server-originated free text: records and messages carry the byte count and a digest, never the text. */
export function opaqueText(text: string): { bytes: number; sha256: string } {
  return { bytes: utf8Bytes(text), sha256: createHash("sha256").update(text).digest("hex") };
}
export const describeOpaque = (what: string, text: string): string => { const o = opaqueText(text); return `${what} (${o.bytes} bytes, sha256 ${o.sha256.slice(0, 16)})`; };

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
const STANDARD_KEYWORDS = new Set(["$ref", "$dynamicRef", "$recursiveRef", "$defs", "definitions", "$id", "$schema", "$anchor", "$comment", "$async", "pattern", "patternProperties", "format", "uniqueItems", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "dependencies", "dependentSchemas", "dependentRequired", "propertyNames", "additionalItems", "unevaluatedItems", "unevaluatedProperties", "contains", "minContains", "maxContains", "prefixItems", "multipleOf", "minProperties", "maxProperties", "contentEncoding", "contentMediaType", "contentSchema", "examples", "readOnly", "writeOnly", "deprecated", "nullable", "discriminator", "items(tuple)", "additionalProperties(invalid)"]);
export function sanitizeSchema(schema: unknown): { ok: true; schema: Record<string, unknown>; stripped: string[] } | { ok: false; reason: string } {
  const stripped = new Set<string>();
  let otherStripped = false;
  let nodes = 0;
  let problem: string | undefined;
  const drop = (key: string): void => { if (STANDARD_KEYWORDS.has(key)) stripped.add(key); else otherStripped = true; };
  const bound = (depth: number): boolean => {
    if (problem) return false;
    if (depth > SCHEMA_MAX_DEPTH) { problem = `schema nests deeper than ${SCHEMA_MAX_DEPTH} levels`; return false; }
    if (++nodes > SCHEMA_MAX_NODES) { problem = `schema has more than ${SCHEMA_MAX_NODES} nodes`; return false; }
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
    if (!value || typeof value !== "object" || Array.isArray(value)) { if (typeof value !== "boolean") problem ??= "a schema position holds neither an object nor a boolean"; return typeof value === "boolean" ? value : {}; }
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
      else drop(key === "items" && Array.isArray(v) ? "items(tuple)" : key);
    }
    return out;
  };
  const result = schemaAt(schema, 0);
  if (otherStripped) stripped.add("(other)");
  return problem ? { ok: false, reason: problem } : { ok: true, schema: result as Record<string, unknown>, stripped: [...stripped] };
}

/** What the transport reports to its client. Nothing here is derived from message text. */
export interface TransportHooks {
  /** Every outbound message: the client correlates a call's request id here and may rewrite the message. */
  readonly onOutbound?: (message: JSONRPCMessage) => JSONRPCMessage;
  /** An inbound line exceeded the cap: a protocol violation for the WHOLE connection. It is never attributed to a request;
   *  the transport closes the connection right after this call. */
  readonly onOversize?: (bytes: number, sha256: string) => void;
}

export class ChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  #closed = false;
  // One inbound line at a time. Under the cap its bytes are COPIED into `#pieces` (never a view of a larger chunk). Over the
  // cap nothing more is kept: only a running byte count and an incremental SHA-256 until the next newline.
  #pieces: Buffer[] = [];
  #held = 0;
  #total = 0;
  #discarding = false;
  #hash: ReturnType<typeof createHash> | undefined;
  /** Transport-level counters (inspection and tests): the most bytes ever buffered at once. */
  peakBufferedBytes = 0;
  /** `filter` sees every message BEFORE the SDK does: nothing server-supplied reaches the SDK unsanitized. */
  constructor(private readonly channel: StdioChannel, private readonly filter?: (message: JSONRPCMessage) => JSONRPCMessage, private readonly hooks: TransportHooks = {}) {}

  #take(piece: Buffer): void {
    this.#total += piece.length;
    if (this.#discarding) { this.#hash!.update(piece); return; }
    if (this.#held + piece.length > MCP_LIMITS.maxResultBytes) {
      this.#discarding = true;
      this.#hash = createHash("sha256");
      for (const kept of this.#pieces) this.#hash.update(kept);
      this.#hash.update(piece);
      this.#pieces = [];
      this.#held = 0;
      return;
    }
    this.#pieces.push(Buffer.from(piece));
    this.#held += piece.length;
    this.peakBufferedBytes = Math.max(this.peakBufferedBytes, this.#held);
  }

  #endLine(): void {
    const discarding = this.#discarding;
    const total = this.#total;
    const sha = this.#hash?.digest("hex");
    const line = discarding ? undefined : Buffer.concat(this.#pieces).toString("utf8");
    this.#pieces = [];
    this.#held = 0;
    this.#total = 0;
    this.#discarding = false;
    this.#hash = undefined;
    try {
      if (discarding) {
        this.hooks.onOversize?.(total, sha!);
        void this.close().catch(() => {});
        return;
      }
      if (!line || line.trim() === "") return;
      const message = deserializeMessage(line);
      // Server-initiated REQUESTS are not supported (no sampling/roots in v1): never surfaced.
      if ("method" in message && "id" in message) {
        void this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "server-initiated requests are not supported" } } as JSONRPCMessage).catch(() => {});
        return;
      }
      this.onmessage?.(this.filter ? this.filter(message) : message);
    } catch {
      // The message of a framing/parse error can quote the server's stdout: never forwarded.
      this.onerror?.(new Error("the server wrote a malformed message to stdout"));
    }
  }

  async start(): Promise<void> {
    this.channel.onData((chunk) => {
      let offset = 0;
      while (offset < chunk.length && !this.#closed) {
        const nl = chunk.indexOf(10, offset);
        this.#take(chunk.subarray(offset, nl < 0 ? chunk.length : nl));
        if (nl < 0) break;
        this.#endLine();
        offset = nl + 1;
      }
    });
    this.channel.onClose(() => {
      if (this.#closed) return;
      this.#closed = true;
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.#closed) throw new Error("MCP channel is closed");
    await this.channel.write(serializeMessage(this.hooks.onOutbound ? this.hooks.onOutbound(message) : message));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.channel.close();
    this.onclose?.();
  }
}

/** Before a client exists to sanitize them, output schemas are dropped outright. */
function stripOutputSchemas(message: JSONRPCMessage): JSONRPCMessage {
  const result = (message as { result?: { tools?: unknown } }).result;
  if (!result || !Array.isArray(result.tools)) return message;
  return { ...message, result: { ...result, tools: result.tools.map((t: Record<string, unknown>) => { const { outputSchema: _dropped, ...rest } = t; return rest; }) } } as JSONRPCMessage;
}

export interface McpRecord { readonly type: string; readonly payload: Record<string, unknown> }

export interface McpToolDef {
  /** The namespaced id: `mcp.<serverId>.<toolName>`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type McpCallOutcome =
  | { readonly ok: true; readonly result: unknown; readonly bytes: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface McpClientOptions {
  readonly capabilityId: string;
  readonly version: string;
  readonly serverId: string;
  readonly sessionId?: string;
  /** Record path (the spawn-ledger stream). A failing record refuses the call (record before act). */
  readonly record: (event: McpRecord) => Promise<void>;
  /** Scrubs this server's resolved secrets (and encodings) from every string that leaves the client. */
  readonly scrub?: (text: string) => string;
  readonly connectTimeoutMs?: number;
}

/** Strict hand check of a tools/call result envelope. Anything off-shape is rejected (the caller reports output_invalid). */
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): boolean => typeof v === "string";
function knownContent(item: unknown): boolean {
  if (!isPlain(item)) return false;
  switch (item.type) {
    case "text": return str(item.text);
    case "image": case "audio": return str(item.data) && str(item.mimeType);
    case "resource": return isPlain(item.resource) && str(item.resource.uri);
    case "resource_link": return str(item.uri) && str(item.name);
    default: return false;
  }
}
function parseEnvelope(raw: unknown): { isError?: boolean; content?: unknown[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> } | undefined {
  if (!isPlain(raw)) return undefined;
  if (raw.isError !== undefined && typeof raw.isError !== "boolean") return undefined;
  if (raw.content !== undefined && !(Array.isArray(raw.content) && raw.content.every(knownContent))) return undefined;
  if (raw.structuredContent !== undefined && !isPlain(raw.structuredContent)) return undefined;
  if (raw._meta !== undefined && !isPlain(raw._meta)) return undefined;
  return raw as never;
}
/** Size and digest of a server error's payload; a payload that cannot be serialized is recorded as unmeasurable, never thrown. */
function measureError(error: unknown): { bytes: number | null; sha256: string | null; unmeasurable?: true } {
  try {
    const payload = error instanceof McpError ? JSON.stringify({ code: error.code, message: error.message, data: (error as { data?: unknown }).data ?? null }) : error instanceof Error ? error.message : String(error);
    return { bytes: utf8Bytes(payload), sha256: createHash("sha256").update(payload).digest("hex") };
  } catch {
    return { bytes: null, sha256: null, unmeasurable: true };
  }
}

interface PendingCall {
  id?: string | number;
  deadlineFired: boolean;
  failure: { readonly kind: "result_too_large"; readonly bytes: number; readonly sha256: string; readonly attributed: false } | null;
}
const CORRELATION_META = "io.cognate/correlation";

export class McpClient {
  #tools = new Map<string, { def: McpToolDef; validate: ValidateFunction; validateOut?: ValidateFunction }>();
  #excluded: { name: string; reason: string }[] = [];
  #closed = false;
  /** In-flight tools/call requests: our own state is what classifies a failure, never error text. */
  readonly #byCorrelation = new Map<string, PendingCall>();
  readonly #pendingById = new Map<string | number, PendingCall>();
  readonly #ajv = new Ajv({ strict: false });

  private constructor(private readonly sdk: Client, private readonly transport: ChannelTransport, private readonly options: McpClientOptions) {}

  readonly #scrub = (text: string): string => (this.options.scrub ? this.options.scrub(text) : text);
  #clean<T>(value: T): T {
    if (typeof value === "string") return this.#scrub(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.#clean(v)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [this.#scrub(k), this.#clean(v)])) as T;
    return value;
  }
  /** Records never carry raw MCP-originated text: every payload is scrubbed, messages byte-bounded. */
  readonly #rec = (event: McpRecord): Promise<void> => this.options.record({ type: event.type, payload: this.#bounded(this.#clean(event.payload)) });
  /** Every string in a record is bounded as its FINAL value. */
  #bounded<T>(value: T): T {
    if (typeof value === "string") return boundBytes(value, MAX_MESSAGE_BYTES) as T;
    if (Array.isArray(value)) return value.map((v) => this.#bounded(v)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.#bounded(v)])) as T;
    return value;
  }
  /** The one writer of caller-visible message text: scrubbed, then bounded as the final string (any prefix included). */
  #final(text: string): string { return boundBytes(this.#scrub(text), MAX_MESSAGE_BYTES); }
  /** A tool as it may appear in a record: a validated name, else its digest only. */
  #toolRef(rawName: string): string {
    return TOOL_NAME.test(rawName) && this.#scrub(rawName) === rawName ? rawName : `sha256:${createHash("sha256").update(rawName).digest("hex").slice(0, 16)}`;
  }
  /** The SDK validates `structuredContent` against a tool's outputSchema with a backtracking regex engine: so the
   *  schema is sanitized exactly like an input schema BEFORE the SDK sees it (stripped keywords recorded, an
   *  oversize/over-deep schema dropped with a recorded refusal). */
  #sanitizeOutputSchemas(message: JSONRPCMessage): JSONRPCMessage {
    const result = (message as { result?: { tools?: unknown } }).result;
    if (!result || !Array.isArray(result.tools)) return message;
    const base = { point: "mcp-client", capability: this.options.capabilityId, operation: "tools.list", serverId: this.options.serverId, version: this.options.version };
    // At most one refusal record and one sanitization record per message, however many tools it carries; tools past the
    // bound lose their outputSchema without a record (refreshTools drops them anyway).
    const refusals: { tool: string; reason: string }[] = [];
    const sanitizations: { tool: string; keywords: string[] }[] = [];
    const tools = result.tools.map((raw: Record<string, unknown>, index: number) => {
      if (raw.outputSchema === undefined) return raw;
      const { outputSchema, ...rest } = raw;
      if (index >= MCP_LIMITS.maxTools) return rest;
      const rawName = String(raw.name ?? "");
      const name = this.#toolRef(rawName);
      const refuse = (reason: string): Record<string, unknown> => { refusals.push({ tool: name, reason: `outputSchema: ${reason}` }); return rest; };
      // Names and bounds are validated BEFORE anything is audited or cleaned: a rejected tool is referenced by digest only.
      if (utf8Bytes(rawName) > 256) return rest;
      const text = JSON.stringify(outputSchema ?? {});
      if (utf8Bytes(text) > MCP_LIMITS.maxSchemaBytes) return refuse("schema exceeds the byte bound");
      const cleaned = this.#clean(JSON.parse(text)) as { $async?: unknown };
      if (cleaned.$async) return refuse("asynchronous schemas are not accepted");
      const safe = sanitizeSchema(cleaned);
      if (!safe.ok) return refuse(safe.reason);
      if (safe.stripped.length > 0) sanitizations.push({ tool: name, keywords: safe.stripped });
      return { ...rest, outputSchema: safe.schema };
    });
    if (refusals.length > 0) void this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "refused", reasonCode: "schema-refused", reason: `outputSchema refused for ${refusals.length} tool(s)`, tool: refusals[0]!.tool, tools: refusals } }).catch(() => {});
    if (sanitizations.length > 0) void this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "allowed", reasonCode: "schema-sanitized", reason: "outputSchema keywords outside the structural allowlist were stripped", stripped: [...new Set(sanitizations.flatMap((x) => x.keywords))], tools: sanitizations } }).catch(() => {});
    return { ...message, result: { ...result, tools } } as JSONRPCMessage;
  }
  /** Our own errors (record failures): scrubbed text. Never used for text that came from the server. */
  #message(error: unknown): string {
    return this.#final(error instanceof Error ? error.message : String(error));
  }

  static async connect(channel: StdioChannel, options: McpClientOptions): Promise<McpClient> {
    if (!isServerId(options.serverId)) throw new Error(`invalid MCP server id ${options.serverId}`);
    const holder: { client?: McpClient } = {};
    const transport = new ChannelTransport(channel, (message) => (holder.client ? holder.client.#sanitizeOutputSchemas(message) : stripOutputSchemas(message)), {
      onOutbound: (message) => (holder.client ? holder.client.#correlate(message) : message),
      onOversize: (bytes, sha256) => { if (holder.client) holder.client.#oversize(bytes, sha256); },
    });
    // No capabilities declared: sampling, roots and elicitation are refused by construction.
    const sdk = new Client({ name: "cognate-workbench", version: "1" }, { capabilities: {} });
    const client = new McpClient(sdk, transport, options);
    holder.client = client;
    transport.onclose = () => { client.#closed = true; };
    await sdk.connect(transport, { timeout: options.connectTimeoutMs ?? 15_000 });
    await client.refreshTools();
    return client;
  }

  /** Correlate an outbound tools/call with its pending entry by request id; the correlation key never reaches the server. */
  #correlate(message: JSONRPCMessage): JSONRPCMessage {
    const m = message as { method?: string; id?: string | number; params?: { _meta?: Record<string, unknown> } };
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
  /** An oversize inbound line is a protocol violation for the whole connection: there is no attribution, so EVERY pending
   *  call fails as result_too_large (attributed:false) and the transport closes the connection (the normal stop path). */
  #oversize(bytes: number, sha256: string): void {
    for (const pending of this.#byCorrelation.values()) pending.failure ??= { kind: "result_too_large", bytes, sha256, attributed: false };
    void this.#rec({ type: "authority.decision.recorded", payload: { point: "mcp-client", capability: this.options.capabilityId, operation: "transport", serverId: this.options.serverId, version: this.options.version, decisionId: randomUUID(), outcome: "refused", reasonCode: "oversize-message", reason: "an inbound message exceeded the byte bound; the connection was closed", bytes, sha256, attributed: false } }).catch(() => {});
  }
  /** Inspection: in-flight calls (must return to 0) and the oversize messages dropped with no request pending. */
  get pendingCount(): number { return this.#pendingById.size + this.#byCorrelation.size; }
  /** Inspection: the most bytes the transport ever buffered for one line. */
  get peakBufferedBytes(): number { return this.transport.peakBufferedBytes; }

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
    const listed = { tools: collected };
    const tools = new Map<string, { def: McpToolDef; validate: ValidateFunction; validateOut?: ValidateFunction }>();
    const excluded: { name: string; reason: string }[] = [];
    const sanitized: { tool: string; keywords: string[] }[] = [];
    const refused: { tool: string; reason: string }[] = [];
    for (const raw of listed.tools.slice(0, MCP_LIMITS.maxTools)) {
      const rawName = String(raw.name);
      // Validate the name FIRST; a rejected name is referenced by digest only, never recorded or listed.
      if (!TOOL_NAME.test(rawName)) { excluded.push({ name: this.#toolRef(rawName), reason: "name violates the tool-name pattern" }); continue; }
      const name = this.#scrub(rawName);
      if (name !== rawName) { excluded.push({ name: this.#toolRef(rawName), reason: "name carried secret material" }); continue; }
      const description = this.#scrub(String(raw.description ?? ""));
      if (utf8Bytes(description) > MCP_LIMITS.maxDescriptionBytes) { excluded.push({ name, reason: "description exceeds the byte bound" }); continue; }
      const schemaText = JSON.stringify(raw.inputSchema ?? {});
      if (utf8Bytes(schemaText) > MCP_LIMITS.maxSchemaBytes) { excluded.push({ name, reason: "input schema exceeds the byte bound" }); refused.push({ tool: name, reason: "input schema exceeds the byte bound" }); continue; }
      if (tools.has(name)) { excluded.push({ name, reason: "duplicate tool name" }); continue; }
      const parsed = this.#clean(JSON.parse(schemaText)) as { $async?: unknown };
      // An `$async` schema would make `validate` return a Promise (truthy): never accept one.
      if (parsed.$async) { excluded.push({ name, reason: "asynchronous input schemas are not accepted" }); continue; }
      const safe = sanitizeSchema(parsed);
      if (!safe.ok) { excluded.push({ name, reason: safe.reason }); refused.push({ tool: name, reason: safe.reason }); continue; }
      if (safe.stripped.length > 0) sanitized.push({ tool: name, keywords: safe.stripped });
      try {
        const validate = this.#ajv.compile(safe.schema);
        const outSchema = (raw as { outputSchema?: unknown }).outputSchema;
        const validateOut = outSchema && typeof outSchema === "object" ? this.#ajv.compile(outSchema as Record<string, unknown>) : undefined;
        tools.set(name, { ...(validateOut ? { validateOut } : {}), def: { id: `mcp.${this.options.serverId}.${name}`, name, description, inputSchema: safe.schema }, validate });
      } catch (error) {
        excluded.push({ name, reason: describeOpaque("input schema does not compile", error instanceof Error ? error.message : String(error)) });
      }
    }
    const base = { point: "mcp-client", capability: this.options.capabilityId, operation: "tools.list", serverId: this.options.serverId, version: this.options.version };
    for (const r of refused) await this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "refused", reasonCode: "schema-refused", tool: r.tool, reason: r.reason } }).catch(() => {});
    if (sanitized.length > 0) await this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "allowed", reasonCode: "schema-sanitized", reason: "server-supplied schema keywords outside the structural allowlist were stripped", stripped: sanitized } }).catch(() => {});
    if (truncatedByPages || cursor) excluded.push({ name: "*", reason: "further tools pages were not read (page or tool bound reached)" });
    if (listed.tools.length > MCP_LIMITS.maxTools) excluded.push({ name: "*", reason: `${listed.tools.length - MCP_LIMITS.maxTools} tools beyond the ${MCP_LIMITS.maxTools}-tool bound` });
    this.#tools = tools;
    this.#excluded = excluded;
    return this.tools();
  }

  tools(): readonly McpToolDef[] { return [...this.#tools.values()].map((t) => t.def); }

  async callTool(name: string, args: Record<string, unknown>, call: { timeoutMs: number; signal?: AbortSignal; callId?: string; actorId: string }): Promise<McpCallOutcome> {
    const deadlineAt = Date.now() + call.timeoutMs; // the caller's deadline counts from entry, not from the send
    const callId = call.callId ?? randomUUID();
    const base = { capabilityId: this.options.capabilityId, version: this.options.version, serverId: this.options.serverId, ...(this.options.sessionId ? { sessionId: this.options.sessionId } : {}), callId, tool: this.#toolRef(name), actorId: call.actorId };
    const refuse = async (code: string, message: string): Promise<McpCallOutcome> => {
      await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "refused", code } }).catch(() => {});
      return { ok: false, code, message: this.#final(message) };
    };
    if (this.#closed) return refuse("server_not_running", `MCP server ${this.options.serverId} is not running`);
    const entry = this.#tools.get(name);
    if (!entry) return refuse("unknown_tool", `MCP server ${this.options.serverId} lists no tool ${this.#toolRef(name)}`);
    const argText = JSON.stringify(args ?? {});
    const argBytes = utf8Bytes(argText);
    if (argBytes > MCP_LIMITS.maxArgumentBytes) return refuse("arguments_too_large", `arguments are ${argBytes} bytes; the bound is ${MCP_LIMITS.maxArgumentBytes}`);
    // One snapshot: what is validated, hashed, recorded and sent is exactly this value, whatever the caller does to `args` afterwards.
    const snapshot = JSON.parse(argText) as Record<string, unknown>;
    const verdict = entry.validate(snapshot) as unknown;
    if (verdict instanceof Promise) { void verdict.catch(() => {}); return refuse("schema_invalid", "the server's schema is asynchronous and cannot be enforced"); }
    if (!verdict) return refuse("schema_invalid", `arguments for ${name} violate the server's schema: ${(entry.validate.errors ?? []).slice(0, 5).map((e) => `${e.keyword} at ${e.instancePath || "/"}`).join("; ")}`);
    // Record BEFORE the call is sent: an unrecordable invocation is not made.
    try {
      await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "started", argumentsSha256: createHash("sha256").update(argText).digest("hex"), argumentBytes: argBytes } });
    } catch (error) {
      return { ok: false, code: "record_failed", message: this.#final(`the invocation could not be recorded, so it was not sent: ${error instanceof Error ? error.message : String(error)}`) };
    }
    let outcome: McpCallOutcome;
    // Our own state classifies every failure: the size gate (transport), our deadline timer, and the channel. Error
    // text from the server is never read, only digested.
    const pending: PendingCall = { deadlineFired: false, failure: null };
    const correlation = randomUUID();
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let measured: { bytes: number | null; sha256: string | null; unmeasurable?: true } | undefined;
    try {
      try {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) { pending.deadlineFired = true; throw new Error("deadline consumed before the call was sent"); }
        this.#byCorrelation.set(correlation, pending);
        timer = setTimeout(() => { pending.deadlineFired = true; controller.abort(); }, remaining);
        call.signal?.addEventListener("abort", onAbort, { once: true });
        if (call.signal?.aborted) onAbort();
        // `request`, not `callTool`: the SDK never validates structuredContent (a backtracking validator on server data).
        // The transport has already closed the connection on any oversize message; we validate the envelope strictly, then the
        // structured content with the sanitized schema, then scrub, then re-check the bound.
        const raw = await this.sdk.request({ method: "tools/call", params: { name, arguments: snapshot, _meta: { [CORRELATION_META]: correlation } } }, ResultSchema, { timeout: remaining + 5000, signal: controller.signal });
        const result = parseEnvelope(raw);
        if (!result) outcome = { ok: false, code: "output_invalid", message: this.#final(`the result of ${this.#toolRef(name)} is not a valid tool result`) };
        else if (entry.validateOut && result.isError !== true && !(result.structuredContent !== undefined && (entry.validateOut(result.structuredContent) as unknown) === true)) outcome = { ok: false, code: "output_invalid", message: this.#final(`the result of ${this.#toolRef(name)} does not satisfy its output schema`) };
        else {
          const cleaned = this.#clean(result);
          const bytes = utf8Bytes(JSON.stringify(cleaned));
          outcome = bytes > MCP_LIMITS.maxResultBytes
            ? { ok: false, code: "result_too_large", message: this.#final(`the tool result is ${bytes} bytes after redaction; the bound is ${MCP_LIMITS.maxResultBytes}`) }
            : { ok: true, result: cleaned, bytes };
        }
      } catch (error) {
        if (pending.failure) outcome = { ok: false, code: "result_too_large", message: this.#final(`an inbound message of ${pending.failure.bytes} bytes (sha256 ${pending.failure.sha256.slice(0, 16)}) exceeded the ${MCP_LIMITS.maxResultBytes}-byte bound; not attributable to a request, the connection was closed`) };
        else if (pending.deadlineFired) outcome = { ok: false, code: "deadline_exceeded", message: this.#final("the call did not finish before its deadline") };
        else if (this.#closed) outcome = { ok: false, code: "server_not_running", message: this.#final(`MCP server ${this.options.serverId} is not running`) };
        else if (call.signal?.aborted) outcome = { ok: false, code: "cancelled", message: this.#final("the call was cancelled by the caller") };
        else {
          measured = measureError(error);
          outcome = { ok: false, code: "server_error", message: this.#final(measured.unmeasurable ? "the server reported an error (unmeasurable)" : `the server reported an error (${measured.bytes} bytes, sha256 ${measured.sha256!.slice(0, 16)})`) };
        }
      }
    } catch {
      // Classification itself failed: a fixed outcome, never an exception.
      outcome = { ok: false, code: "server_error", message: "the server reported an error (unclassifiable)" };
    } finally {
      if (timer) clearTimeout(timer);
      call.signal?.removeEventListener("abort", onAbort);
      this.#byCorrelation.delete(correlation);
      if (pending.id !== undefined) this.#pendingById.delete(pending.id);
    }
    // Every call ends with a finished record: the full one, else a minimal fixed one.
    const finished = { ...base, phase: "finished", outcome: outcome.ok ? "ok" : outcome.code };
    try {
      await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...finished, ...(outcome.ok ? { resultBytes: outcome.bytes } : {}), ...(pending.failure ? { oversizeBytes: pending.failure.bytes, oversizeSha256: pending.failure.sha256, attributed: false } : {}), ...(measured ? { serverErrorBytes: measured.bytes, serverErrorSha256: measured.sha256, ...(measured.unmeasurable ? { unmeasurable: true } : {}) } : {}) } });
    } catch {
      await this.options.record({ type: "capability.mcp.tool_invoked", payload: { capabilityId: this.options.capabilityId, serverId: this.options.serverId, callId, phase: "finished", outcome: outcome.ok ? "ok" : outcome.code } }).catch(() => {});
    }
    return outcome;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.sdk.close().catch(() => {});
  }
}
