// The one ingress boundary for server-originated bytes (root-cause class fix, review-r4). Everything a spawned MCP server
// writes passes through here, in this order, before the SDK client or any consumer sees a value:
//   1. a stream cap: a line is buffered only up to `maxMessageBytes` (a copy of the current partial line, never a view of
//      a larger chunk); the moment a line crosses it the violation is reported (byte count and SHA-256 of what was received
//      so far) and the framer stops, so an unterminated oversize line cannot hold a connection open;
//   2. a depth limit (`maxDepth`), checked on the bytes BEFORE any JSON parse, so a deeply nested document can never
//      overflow a recursive parser, stringifier or validator downstream;
//   3. a strict JSON-RPC envelope, producing typed values (`Inbound`).
// Oversize, too-deep or malformed input is a connection-level protocol violation: the caller closes the connection and
// fails every pending call; nothing is ever attributed to a request by guessing.
// Nothing outside this module parses or stringifies raw server data: sizes, snapshots and digests come from here.
import { newSha256, parseWireId, sha256Of, type Sha256, type WireId } from "./typedRecord.ts";

export const INGRESS = {
  maxMessageBytes: 256 * 1024, maxDepth: 64, maxMethodLength: 256,
  /** Backpressure: when this many received bytes are waiting to be framed, the stream is paused; it resumes below `queueLowBytes`. */
  queueHighBytes: 128 * 1024, queueLowBytes: 32 * 1024,
  /** Hard cap on bytes retained (queued chunks plus the partial line): a chunk that would exceed it is a protocol violation on arrival. */
  maxRetainedBytes: 512 * 1024,
} as const;

export type ViolationReason = "oversize" | "malformed" | "too-deep";
export interface Violation { readonly reason: ViolationReason; readonly bytes: number; readonly sha256: Sha256 }
export type RpcId = WireId;
export type Inbound =
  | { readonly kind: "response"; readonly id: RpcId; readonly result: Record<string, unknown> }
  | { readonly kind: "error"; readonly id: RpcId; readonly code: number; readonly digest: { readonly bytes: number | null; readonly sha256: Sha256 | null } }
  | { readonly kind: "notification"; readonly method: string; readonly params?: Record<string, unknown> }
  | { readonly kind: "request"; readonly id: RpcId };
export type FrameEvent = { readonly kind: "message"; readonly message: Inbound; readonly bytes: number } | { readonly kind: "violation"; readonly violation: Violation };

export const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when the JSON text nests deeper than `max` (counted on bytes outside strings; no parse happens). */
export function nestsDeeperThan(bytes: Uint8Array, max: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (b === 0x5c) escaped = true;
      else if (b === 0x22) inString = false;
    } else if (b === 0x22) inString = true;
    else if (b === 0x7b || b === 0x5b) { if (++depth > max) return true; }
    else if (b === 0x7d || b === 0x5d) depth--;
  }
  return false;
}

/** Size and digest of a (depth-bounded) value; unmeasurable when it cannot be serialized. Never throws. */
export function measureJson(value: unknown): { bytes: number | null; sha256: Sha256 | null } {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return { bytes: null, sha256: null };
    return { bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Of(text) };
  } catch {
    return { bytes: null, sha256: null };
  }
}
/** UTF-8 byte length of a value's JSON form, or undefined when it cannot be serialized. Never throws. */
export const jsonBytes = (value: unknown): number | undefined => measureJson(value).bytes ?? undefined;
/** A deep copy of a value, refused (undefined) when its JSON form exceeds `maxBytes` or cannot be serialized. Never throws. */
export function snapshotJson<T = unknown>(value: unknown, maxBytes: number): { value: T; bytes: number } | undefined {
  try {
    const text = JSON.stringify(value ?? {});
    if (text === undefined) return undefined;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) return undefined;
    return { value: JSON.parse(text) as T, bytes };
  } catch {
    return undefined;
  }
}

const rpcId = parseWireId;

/** The one answer to a server-initiated request we do not support (no sampling, roots or elicitation): a fixed error built
 *  from the typed id, serialized here so no server-chosen value is serialized anywhere else. */
export const unsupportedRequestReply = (id: RpcId): string => `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "server-initiated requests are not supported" } })}\n`;

/** Parse and strictly type one complete line. Returns a `Violation` for anything off-envelope. */
export function parseInbound(line: Uint8Array, bytes = line.length): Inbound | Violation {
  const violation = (reason: ViolationReason): Violation => ({ reason, bytes, sha256: sha256Of(line) });
  if (nestsDeeperThan(line, INGRESS.maxDepth)) return violation("too-deep");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(line).toString("utf8")); } catch { return violation("malformed"); }
  if (!isPlain(value) || value.jsonrpc !== "2.0") return violation("malformed");
  const id = rpcId(value.id);
  const hasMethod = typeof value.method === "string" && value.method.length > 0 && value.method.length <= INGRESS.maxMethodLength;
  if (hasMethod) {
    if (value.params !== undefined && !isPlain(value.params)) return violation("malformed");
    if (value.id !== undefined) return id === undefined ? violation("malformed") : { kind: "request", id };
    return { kind: "notification", method: value.method as string, ...(value.params !== undefined ? { params: value.params as Record<string, unknown> } : {}) };
  }
  if (id === undefined) return violation("malformed");
  if (value.error !== undefined) {
    if (value.result !== undefined || !isPlain(value.error) || typeof value.error.code !== "number" || !Number.isFinite(value.error.code)) return violation("malformed");
    return { kind: "error", id, code: value.error.code, digest: measureJson(value.error) };
  }
  if (!isPlain(value.result)) return violation("malformed");
  if (value.result._meta !== undefined && !isPlain(value.result._meta)) return violation("malformed");
  return { kind: "response", id, result: value.result };
}

/** Splits a byte stream into lines under the stream cap and types each one. After a violation it is inert. */
export class LineFramer {
  #pieces: Buffer[] = [];
  #held = 0;
  #stopped = false;
  /** The most bytes ever buffered for one line (a high-water mark of the partial line). */
  peakBufferedBytes = 0;

  get stopped(): boolean { return this.#stopped; }
  /** Bytes of the partial line held RIGHT NOW (summed from the stored pieces, not a counter). */
  get heldBytes(): number { let n = 0; for (const p of this.#pieces) n += p.length; return n; }

  /** Lazily frame one chunk: each event is produced when the consumer asks for it, so at most one parsed message is retained. */
  *feed(chunk: Buffer): Generator<FrameEvent, void, undefined> {
    let offset = 0;
    while (offset < chunk.length && !this.#stopped) {
      const nl = chunk.indexOf(10, offset);
      const piece = chunk.subarray(offset, nl < 0 ? chunk.length : nl);
      if (this.#held + piece.length > INGRESS.maxMessageBytes) {
        // Crossed the cap: report now (what was received so far) and stop; nothing more is read from this connection.
        const hash = newSha256();
        for (const kept of this.#pieces) hash.update(kept);
        hash.update(piece);
        this.#stopped = true;
        const bytes = this.#held + piece.length;
        this.#pieces = [];
        this.#held = 0;
        yield { kind: "violation", violation: { reason: "oversize", bytes, sha256: hash.digest() } };
        return;
      }
      this.#pieces.push(Buffer.from(piece)); // a copy: never a view that would pin a larger chunk
      this.#held += piece.length;
      this.peakBufferedBytes = Math.max(this.peakBufferedBytes, this.#held);
      if (nl < 0) return;
      offset = nl + 1;
      const event = this.#end();
      if (event) yield event;
    }
  }

  /** Eager form of `feed` (every event of the chunk at once); for callers that hold the whole chunk anyway. */
  push(chunk: Buffer): FrameEvent[] { return [...this.feed(chunk)]; }

  #end(): FrameEvent | undefined {
    const line = Buffer.concat(this.#pieces);
    this.#pieces = [];
    this.#held = 0;
    if (line.length === 0 || (line.length < 64 && line.toString("utf8").trim() === "")) return undefined;
    const parsed = parseInbound(line);
    if ("reason" in parsed) { this.#stopped = true; return { kind: "violation", violation: parsed }; }
    return { kind: "message", message: parsed, bytes: line.length };
  }
}

// ---- the tools/call result envelope ----
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
export interface ToolEnvelope { readonly isError?: boolean; readonly content?: readonly unknown[]; readonly structuredContent?: Record<string, unknown>; readonly _meta?: Record<string, unknown> }
/** Strict check of a tools/call result: `isError` a boolean, `content` an array of the known shapes, `structuredContent` and `_meta` plain objects. */
export function parseToolResult(raw: unknown): ToolEnvelope | undefined {
  if (!isPlain(raw)) return undefined;
  if (raw.isError !== undefined && typeof raw.isError !== "boolean") return undefined;
  if (raw.content !== undefined && !(Array.isArray(raw.content) && raw.content.every(knownContent))) return undefined;
  if (raw.structuredContent !== undefined && !isPlain(raw.structuredContent)) return undefined;
  if (raw._meta !== undefined && !isPlain(raw._meta)) return undefined;
  return raw as ToolEnvelope;
}
