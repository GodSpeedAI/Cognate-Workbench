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
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
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
  let out = value.slice(0, max);
  while (utf8Bytes(out) > max) out = out.slice(0, -1);
  return `${out}...`;
}
const MAX_MESSAGE_BYTES = 512;

/** Untrusted schema sanitization (section 11): the server validates its own input, so keywords that run a
 *  backtracking regex engine on the event loop (`pattern`, `patternProperties`, every `format`) are stripped,
 *  and depth and node count are bounded. Returns what was stripped, or a refusal reason. */
const SCHEMA_STRIP = new Set(["pattern", "patternProperties", "format"]);
const SCHEMA_MAX_DEPTH = 16;
const SCHEMA_MAX_NODES = 512;
export function sanitizeSchema(schema: unknown): { ok: true; schema: Record<string, unknown>; stripped: string[] } | { ok: false; reason: string } {
  const stripped = new Set<string>();
  let nodes = 0;
  let problem: string | undefined;
  const walk = (value: unknown, depth: number): unknown => {
    if (problem) return value;
    if (depth > SCHEMA_MAX_DEPTH) { problem = `schema nests deeper than ${SCHEMA_MAX_DEPTH} levels`; return value; }
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    if (value && typeof value === "object") {
      if (++nodes > SCHEMA_MAX_NODES) { problem = `schema has more than ${SCHEMA_MAX_NODES} nodes`; return value; }
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        // A property NAMED "pattern" lives under `properties` and is data, not a keyword.
        if (SCHEMA_STRIP.has(key) && typeof v !== "object") { stripped.add(key); continue; }
        if (key === "patternProperties") { stripped.add(key); continue; }
        out[key] = walk(v, depth + 1);
      }
      return out;
    }
    return value;
  };
  const result = walk(schema, 0);
  return problem ? { ok: false, reason: problem } : { ok: true, schema: result as Record<string, unknown>, stripped: [...stripped] };
}

export class ChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly #buffer = new ReadBuffer({ maxBufferSize: MCP_LIMITS.maxLineBytes });
  #closed = false;
  /** `filter` sees every message BEFORE the SDK does: nothing server-supplied reaches the SDK unsanitized. */
  constructor(private readonly channel: StdioChannel, private readonly filter?: (message: JSONRPCMessage) => JSONRPCMessage) {}

  async start(): Promise<void> {
    this.channel.onData((chunk) => {
      try {
        this.#buffer.append(chunk);
        for (;;) {
          const message = this.#buffer.readMessage();
          if (message === null) break;
          // Server-initiated REQUESTS are not supported (no sampling/roots in v1): never surfaced.
          if ("method" in message && "id" in message) {
            void this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "server-initiated requests are not supported" } } as JSONRPCMessage).catch(() => {});
            continue;
          }
          this.onmessage?.(this.filter ? this.filter(message) : message);
        }
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
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
    await this.channel.write(serializeMessage(message));
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

export class McpClient {
  #tools = new Map<string, { def: McpToolDef; validate: ValidateFunction }>();
  #excluded: { name: string; reason: string }[] = [];
  #closed = false;
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
  readonly #rec = (event: McpRecord): Promise<void> => this.options.record({ type: event.type, payload: this.#clean(event.payload) });
  /** The SDK validates `structuredContent` against a tool's outputSchema with a backtracking regex engine: so the
   *  schema is sanitized exactly like an input schema BEFORE the SDK sees it (stripped keywords recorded, an
   *  oversize/over-deep schema dropped with a recorded refusal). */
  #sanitizeOutputSchemas(message: JSONRPCMessage): JSONRPCMessage {
    const result = (message as { result?: { tools?: unknown } }).result;
    if (!result || !Array.isArray(result.tools)) return message;
    const base = { point: "mcp-client", capability: this.options.capabilityId, operation: "tools.list", serverId: this.options.serverId, version: this.options.version };
    const tools = result.tools.map((raw: Record<string, unknown>) => {
      if (raw.outputSchema === undefined) return raw;
      const { outputSchema, ...rest } = raw;
      const name = this.#scrub(String(raw.name ?? ""));
      const text = JSON.stringify(outputSchema ?? {});
      const cleaned = this.#clean(JSON.parse(text)) as { $async?: unknown };
      const refuse = (reason: string): Record<string, unknown> => {
        void this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "refused", reasonCode: "schema-refused", tool: name, reason: `outputSchema: ${reason}` } }).catch(() => {});
        return rest;
      };
      if (utf8Bytes(text) > MCP_LIMITS.maxSchemaBytes) return refuse("schema exceeds the byte bound");
      if (cleaned.$async) return refuse("asynchronous schemas are not accepted");
      const safe = sanitizeSchema(cleaned);
      if (!safe.ok) return refuse(safe.reason);
      if (safe.stripped.length > 0) void this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "allowed", reasonCode: "schema-sanitized", tool: name, reason: "outputSchema keywords that run a backtracking regex engine were stripped", stripped: safe.stripped } }).catch(() => {});
      return { ...rest, outputSchema: safe.schema };
    });
    return { ...message, result: { ...result, tools } } as JSONRPCMessage;
  }
  #message(error: unknown): string {
    return boundBytes(this.#scrub(error instanceof Error ? error.message : String(error)), MAX_MESSAGE_BYTES);
  }

  static async connect(channel: StdioChannel, options: McpClientOptions): Promise<McpClient> {
    if (!isServerId(options.serverId)) throw new Error(`invalid MCP server id ${options.serverId}`);
    const holder: { client?: McpClient } = {};
    const transport = new ChannelTransport(channel, (message) => (holder.client ? holder.client.#sanitizeOutputSchemas(message) : stripOutputSchemas(message)));
    // No capabilities declared: sampling, roots and elicitation are refused by construction.
    const sdk = new Client({ name: "cognate-workbench", version: "1" }, { capabilities: {} });
    const client = new McpClient(sdk, transport, options);
    holder.client = client;
    transport.onclose = () => { client.#closed = true; };
    await sdk.connect(transport, { timeout: options.connectTimeoutMs ?? 15_000 });
    await client.refreshTools();
    return client;
  }

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
    const tools = new Map<string, { def: McpToolDef; validate: ValidateFunction }>();
    const excluded: { name: string; reason: string }[] = [];
    const sanitized: { tool: string; keywords: string[] }[] = [];
    const refused: { tool: string; reason: string }[] = [];
    for (const raw of listed.tools.slice(0, MCP_LIMITS.maxTools)) {
      const rawName = String(raw.name);
      const name = this.#scrub(rawName);
      if (name !== rawName) { excluded.push({ name: name.slice(0, 64), reason: "name carried secret material" }); continue; }
      if (!TOOL_NAME.test(name)) { excluded.push({ name: name.slice(0, 64), reason: "name violates the tool-name pattern" }); continue; }
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
        tools.set(name, { def: { id: `mcp.${this.options.serverId}.${name}`, name, description, inputSchema: safe.schema }, validate });
      } catch (error) {
        excluded.push({ name, reason: `input schema does not compile: ${this.#message(error)}` });
      }
    }
    const base = { point: "mcp-client", capability: this.options.capabilityId, operation: "tools.list", serverId: this.options.serverId, version: this.options.version };
    for (const r of refused) await this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "refused", reasonCode: "schema-refused", tool: r.tool, reason: r.reason } }).catch(() => {});
    if (sanitized.length > 0) await this.#rec({ type: "authority.decision.recorded", payload: { ...base, decisionId: randomUUID(), outcome: "allowed", reasonCode: "schema-sanitized", reason: "server-supplied schema keywords that run a backtracking regex engine were stripped", stripped: sanitized } }).catch(() => {});
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
    const base = { capabilityId: this.options.capabilityId, version: this.options.version, serverId: this.options.serverId, ...(this.options.sessionId ? { sessionId: this.options.sessionId } : {}), callId, tool: name, actorId: call.actorId };
    const refuse = async (code: string, message: string): Promise<McpCallOutcome> => {
      await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "refused", code } }).catch(() => {});
      return { ok: false, code, message: boundBytes(this.#scrub(message), MAX_MESSAGE_BYTES) };
    };
    if (this.#closed) return refuse("server_not_running", `MCP server ${this.options.serverId} is not running`);
    const entry = this.#tools.get(name);
    if (!entry) return refuse("unknown_tool", `MCP server ${this.options.serverId} lists no tool ${name}`);
    const argText = JSON.stringify(args ?? {});
    const argBytes = utf8Bytes(argText);
    if (argBytes > MCP_LIMITS.maxArgumentBytes) return refuse("arguments_too_large", `arguments are ${argBytes} bytes; the bound is ${MCP_LIMITS.maxArgumentBytes}`);
    const verdict = entry.validate(args ?? {}) as unknown;
    if (verdict instanceof Promise) { void verdict.catch(() => {}); return refuse("schema_invalid", "the server's schema is asynchronous and cannot be enforced"); }
    if (!verdict) return refuse("schema_invalid", `arguments for ${name} violate the server's schema: ${this.#ajv.errorsText(entry.validate.errors)}`);
    // Record BEFORE the call is sent: an unrecordable invocation is not made.
    try {
      await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "started", argumentsSha256: createHash("sha256").update(argText).digest("hex"), argumentBytes: argBytes } });
    } catch (error) {
      return { ok: false, code: "record_failed", message: `the invocation could not be recorded, so it was not sent: ${this.#message(error)}` };
    }
    let outcome: McpCallOutcome;
    try {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new Error("request timed out before it was sent (the invocation record consumed the deadline)");
      const result = await this.sdk.callTool({ name, arguments: args ?? {} }, undefined, { timeout: remaining, ...(call.signal ? { signal: call.signal } : {}) });
      const bytes = utf8Bytes(JSON.stringify(result));
      outcome = bytes > MCP_LIMITS.maxResultBytes
        ? { ok: false, code: "result_too_large", message: `the tool result is ${bytes} bytes; the bound is ${MCP_LIMITS.maxResultBytes}` }
        : { ok: true, result: this.#clean(result), bytes };
    } catch (error) {
      const message = this.#message(error);
      outcome = { ok: false, code: /timed out|timeout/i.test(message) ? "deadline_exceeded" : this.#closed ? "server_not_running" : "tool_error", message };
    }
    await this.#rec({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "finished", outcome: outcome.ok ? "ok" : outcome.code, ...(outcome.ok ? { resultBytes: outcome.bytes } : {}) } }).catch(() => {});
    return outcome;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.sdk.close().catch(() => {});
  }
}
