// The one ingress boundary for server-originated bytes (root-cause class fix, review-r4). Everything a spawned MCP server
// writes passes through here, in this order, before the SDK client or any consumer sees a value:
//   1. a stream cap: a line is buffered only up to `maxMessageBytes` (a copy of the current partial line, never a view of
//      a larger chunk); beyond it nothing more is kept, only a running byte count and an incremental SHA-256;
//   2. a depth limit (`maxDepth`), checked on the bytes BEFORE any JSON parse, so a deeply nested document can never
//      overflow a recursive parser, stringifier or validator downstream;
//   3. a strict JSON-RPC envelope, producing typed values (`Inbound`).
// Oversize, too-deep or malformed input is a connection-level protocol violation: the caller closes the connection and
// fails every pending call; nothing is ever attributed to a request by guessing.
// Nothing outside this module parses or stringifies raw server data: sizes, snapshots and digests come from here.
import { newSha256, sha256Of, type Sha256 } from "./typedRecord.ts";

export const INGRESS = { maxMessageBytes: 256 * 1024, maxDepth: 64, maxIdLength: 64, maxMethodLength: 256 } as const;

export type ViolationReason = "oversize" | "malformed" | "too-deep";
export interface Violation { readonly reason: ViolationReason; readonly bytes: number; readonly sha256: Sha256 }
export type RpcId = number | string;
export type Inbound =
  | { readonly kind: "response"; readonly id: RpcId; readonly result: Record<string, unknown> }
  | { readonly kind: "error"; readonly id: RpcId; readonly code: number; readonly digest: { readonly bytes: number | null; readonly sha256: Sha256 | null } }
  | { readonly kind: "notification"; readonly method: string; readonly params?: Record<string, unknown> }
  | { readonly kind: "request"; readonly id: RpcId };
export type FrameEvent = { readonly kind: "message"; readonly message: Inbound } | { readonly kind: "violation"; readonly violation: Violation };

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

const rpcId = (v: unknown): RpcId | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.length > 0 && v.length <= INGRESS.maxIdLength ? v : undefined);

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
  #total = 0;
  #discarding = false;
  #hash: ReturnType<typeof newSha256> | undefined;
  #stopped = false;
  /** The most bytes ever buffered for one line (transport-level counter for the cap invariant). */
  peakBufferedBytes = 0;

  get stopped(): boolean { return this.#stopped; }

  push(chunk: Buffer): FrameEvent[] {
    const events: FrameEvent[] = [];
    let offset = 0;
    while (offset < chunk.length && !this.#stopped) {
      const nl = chunk.indexOf(10, offset);
      this.#take(chunk.subarray(offset, nl < 0 ? chunk.length : nl));
      if (nl < 0) break;
      const event = this.#end();
      if (event) events.push(event);
      offset = nl + 1;
    }
    return events;
  }

  #take(piece: Buffer): void {
    this.#total += piece.length;
    if (this.#discarding) { this.#hash!.update(piece); return; }
    if (this.#held + piece.length > INGRESS.maxMessageBytes) {
      this.#discarding = true;
      this.#hash = newSha256();
      for (const kept of this.#pieces) this.#hash.update(kept);
      this.#hash.update(piece);
      this.#pieces = [];
      this.#held = 0;
      return;
    }
    this.#pieces.push(Buffer.from(piece)); // a copy: never a view that would pin a larger chunk
    this.#held += piece.length;
    this.peakBufferedBytes = Math.max(this.peakBufferedBytes, this.#held);
  }

  #end(): FrameEvent | undefined {
    const discarding = this.#discarding;
    const total = this.#total;
    const sha = this.#hash?.digest();
    const line = discarding ? undefined : Buffer.concat(this.#pieces);
    this.#pieces = [];
    this.#held = 0;
    this.#total = 0;
    this.#discarding = false;
    this.#hash = undefined;
    if (discarding) { this.#stopped = true; return { kind: "violation", violation: { reason: "oversize", bytes: total, sha256: sha! } }; }
    if (!line || line.length === 0 || (line.length < 64 && line.toString("utf8").trim() === "")) return undefined;
    const parsed = parseInbound(line, total);
    if ("reason" in parsed) { this.#stopped = true; return { kind: "violation", violation: parsed }; }
    return { kind: "message", message: parsed };
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
