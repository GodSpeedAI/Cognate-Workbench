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

export class ChannelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly #buffer = new ReadBuffer({ maxBufferSize: MCP_LIMITS.maxLineBytes });
  #closed = false;
  constructor(private readonly channel: StdioChannel) {}

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
          this.onmessage?.(message);
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
  readonly connectTimeoutMs?: number;
}

export class McpClient {
  #tools = new Map<string, { def: McpToolDef; validate: ValidateFunction }>();
  #excluded: { name: string; reason: string }[] = [];
  #closed = false;
  readonly #ajv = new Ajv({ strict: false });

  private constructor(private readonly sdk: Client, private readonly transport: ChannelTransport, private readonly options: McpClientOptions) {}

  static async connect(channel: StdioChannel, options: McpClientOptions): Promise<McpClient> {
    if (!isServerId(options.serverId)) throw new Error(`invalid MCP server id ${options.serverId}`);
    const transport = new ChannelTransport(channel);
    // No capabilities declared: sampling, roots and elicitation are refused by construction.
    const sdk = new Client({ name: "cognate-workbench", version: "1" }, { capabilities: {} });
    const client = new McpClient(sdk, transport, options);
    transport.onclose = () => { client.#closed = true; };
    await sdk.connect(transport, { timeout: options.connectTimeoutMs ?? 15_000 });
    await client.refreshTools();
    return client;
  }

  get closed(): boolean { return this.#closed; }
  get excluded(): readonly { name: string; reason: string }[] { return this.#excluded; }

  /** Live tools/list, validated as untrusted data. */
  async refreshTools(): Promise<readonly McpToolDef[]> {
    const listed = await this.sdk.listTools(undefined, { timeout: 15_000 });
    const tools = new Map<string, { def: McpToolDef; validate: ValidateFunction }>();
    const excluded: { name: string; reason: string }[] = [];
    for (const raw of listed.tools.slice(0, MCP_LIMITS.maxTools)) {
      const name = String(raw.name);
      if (!TOOL_NAME.test(name)) { excluded.push({ name: name.slice(0, 64), reason: "name violates the tool-name pattern" }); continue; }
      const description = String(raw.description ?? "");
      if (utf8Bytes(description) > MCP_LIMITS.maxDescriptionBytes) { excluded.push({ name, reason: "description exceeds the byte bound" }); continue; }
      const schemaText = JSON.stringify(raw.inputSchema ?? {});
      if (utf8Bytes(schemaText) > MCP_LIMITS.maxSchemaBytes) { excluded.push({ name, reason: "input schema exceeds the byte bound" }); continue; }
      if (tools.has(name)) { excluded.push({ name, reason: "duplicate tool name" }); continue; }
      try {
        const validate = this.#ajv.compile(JSON.parse(schemaText) as object);
        tools.set(name, { def: { id: `mcp.${this.options.serverId}.${name}`, name, description, inputSchema: JSON.parse(schemaText) as Record<string, unknown> }, validate });
      } catch (error) {
        excluded.push({ name, reason: `input schema does not compile: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    if (listed.tools.length > MCP_LIMITS.maxTools) excluded.push({ name: "*", reason: `${listed.tools.length - MCP_LIMITS.maxTools} tools beyond the ${MCP_LIMITS.maxTools}-tool bound` });
    this.#tools = tools;
    this.#excluded = excluded;
    return this.tools();
  }

  tools(): readonly McpToolDef[] { return [...this.#tools.values()].map((t) => t.def); }

  async callTool(name: string, args: Record<string, unknown>, call: { timeoutMs: number; signal?: AbortSignal; callId?: string; actorId: string }): Promise<McpCallOutcome> {
    const callId = call.callId ?? randomUUID();
    const base = { capabilityId: this.options.capabilityId, version: this.options.version, serverId: this.options.serverId, ...(this.options.sessionId ? { sessionId: this.options.sessionId } : {}), callId, tool: name, actorId: call.actorId };
    const refuse = async (code: string, message: string): Promise<McpCallOutcome> => {
      await this.options.record({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "refused", code } }).catch(() => {});
      return { ok: false, code, message };
    };
    if (this.#closed) return refuse("server_not_running", `MCP server ${this.options.serverId} is not running`);
    const entry = this.#tools.get(name);
    if (!entry) return refuse("unknown_tool", `MCP server ${this.options.serverId} lists no tool ${name}`);
    const argText = JSON.stringify(args ?? {});
    const argBytes = utf8Bytes(argText);
    if (argBytes > MCP_LIMITS.maxArgumentBytes) return refuse("arguments_too_large", `arguments are ${argBytes} bytes; the bound is ${MCP_LIMITS.maxArgumentBytes}`);
    if (!entry.validate(args ?? {})) return refuse("schema_invalid", `arguments for ${name} violate the server's schema: ${this.#ajv.errorsText(entry.validate.errors)}`);
    // Record BEFORE the call is sent: an unrecordable invocation is not made.
    try {
      await this.options.record({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "started", argumentsSha256: createHash("sha256").update(argText).digest("hex"), argumentBytes: argBytes } });
    } catch (error) {
      return { ok: false, code: "record_failed", message: `the invocation could not be recorded, so it was not sent: ${error instanceof Error ? error.message : String(error)}` };
    }
    let outcome: McpCallOutcome;
    try {
      const result = await this.sdk.callTool({ name, arguments: args ?? {} }, undefined, { timeout: call.timeoutMs, ...(call.signal ? { signal: call.signal } : {}) });
      const bytes = utf8Bytes(JSON.stringify(result));
      outcome = bytes > MCP_LIMITS.maxResultBytes
        ? { ok: false, code: "result_too_large", message: `the tool result is ${bytes} bytes; the bound is ${MCP_LIMITS.maxResultBytes}` }
        : { ok: true, result, bytes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { ok: false, code: /timed out|timeout/i.test(message) ? "deadline_exceeded" : this.#closed ? "server_not_running" : "tool_error", message };
    }
    await this.options.record({ type: "capability.mcp.tool_invoked", payload: { ...base, phase: "finished", outcome: outcome.ok ? "ok" : outcome.code, ...(outcome.ok ? { resultBytes: outcome.bytes } : {}) } }).catch(() => {});
    return outcome;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.sdk.close().catch(() => {});
  }
}
