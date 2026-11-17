// Typed records (root-cause class fix, review-r4): everything the MCP and spawn paths RECORD has a closed field type.
// A record field is an enum code, a finite number, a boolean, a `Sha256` that only our hash function produces, an id we
// mint or adopt from our own runtime, or `Trusted` text authored by us. There is NO plain `string` field, so a string
// that came from a server (or from anything unvetted) cannot be passed to a record: the compiler rejects it. Server text
// reaches a record only as a byte count and a digest.
import { createHash, randomUUID } from "node:crypto";

declare const tag: unique symbol;
/** A SHA-256 hex digest; only `sha256Of` produces one. */
export type Sha256 = string & { readonly [tag]: "sha256" };
/** An identifier minted here or adopted from our own runtime (validated shape, bounded length). */
export type MintedId = string & { readonly [tag]: "id" };
/** Text authored by this codebase or by the operator's verified registry, never by a server. */
export type Trusted = string & { readonly [tag]: "trusted" };

/** The closed vocabulary of enum codes a record may carry. */
export type RecordCode =
  | "started" | "finished"
  | "allowed" | "refused"
  | "mcp-client" | "tools.list" | "transport"
  | "schema-refused" | "schema-sanitized" | "oversize-message" | "malformed-message" | "too-deep-message"
  | "capability.mcp.tool_invoked" | "authority.decision.recorded"
  | CallCode;
/** How a tool call can end. */
export type CallCode =
  | "ok" | "server_not_running" | "unknown_tool" | "arguments_too_large" | "schema_invalid" | "record_failed"
  | "result_too_large" | "output_invalid" | "deadline_exceeded" | "cancelled" | "server_error" | "internal_error";

export type RecordField = RecordCode | number | boolean | null | Sha256 | MintedId | Trusted | readonly RecordField[] | { readonly [key: string]: RecordField | undefined };
export type TypedPayload = { readonly [key: string]: RecordField | undefined };

export const sha256Of = (data: string | Uint8Array): Sha256 => createHash("sha256").update(data).digest("hex") as Sha256;
export const newSha256 = (): { update(data: Uint8Array): void; digest(): Sha256 } => {
  const hash = createHash("sha256");
  return { update: (data) => { hash.update(data); }, digest: () => hash.digest("hex") as Sha256 };
};
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,127}$/;
/** Mint a fresh id (a random UUID). */
export const mintId = (): MintedId => randomUUID() as MintedId;
/** Adopt an id that comes from our own runtime (manifest, registry, dispatcher). A value of the wrong shape is replaced by a digest, never recorded. */
export const adoptId = (value: string): MintedId => (ID_SHAPE.test(value) ? value : `sha256:${sha256Of(value).slice(0, 32)}`) as MintedId;
/** A digest of a possibly hostile name, in the shape of an id: the only way a tool or other server-chosen name appears in a record. */
export const digestId = (value: string): MintedId => `sha256:${sha256Of(value).slice(0, 32)}` as MintedId;
/** Assert that text is authored by us or the operator's verified registry. Audited by grep: it is never applied to server-originated data. */
export const trusted = (value: string): Trusted => value as Trusted;
/** Build trusted text; interpolations must themselves be typed (codes, numbers, ids, digests, trusted text). */
export const text = (parts: TemplateStringsArray, ...values: readonly (RecordCode | number | boolean | Sha256 | MintedId | Trusted)[]): Trusted =>
  parts.reduce((out, part, i) => `${out}${part}${i < values.length ? String(values[i]) : ""}`, "") as Trusted;
/** Size and digest of a value serialized by the ingress boundary; the only trace of server text. */
export const describeDigest = (what: Trusted, bytes: number | null, sha256: Sha256 | null): Trusted =>
  (bytes === null || sha256 === null ? `${what} (unmeasurable)` : `${what} (${bytes} bytes, sha256 ${sha256.slice(0, 16)})`) as Trusted;

/** Deep-copy operator-authored JSON (a verified manifest, a posture record) into record fields: strings become `Trusted`, numbers must be finite. */
export function operatorJson(value: unknown): RecordField {
  if (typeof value === "string") return value as Trusted;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(operatorJson);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, operatorJson(v)]));
  return null;
}
/** Size and digest of arbitrary text (an error message that may quote untrusted data): what a record keeps of it. */
export const digestText = (value: string): { readonly bytes: number; readonly sha256: Sha256 } => ({ bytes: Buffer.byteLength(value, "utf8"), sha256: sha256Of(value) });
