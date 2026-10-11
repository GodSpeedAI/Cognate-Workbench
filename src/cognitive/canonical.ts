// Versioned canonical serialization + SHA-256. Identity for worlds, criteria and methods is a hash
// of *consequential* content only; callers choose what to put in, this file only guarantees that
// equal content serializes to equal bytes (sorted keys, no undefined, no non-finite numbers).
import { createHash } from "node:crypto";

export const CANONICAL_VERSION = 1;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${typeof value}`);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashOf(value: unknown): string {
  return sha256(`cognate.canonical.v${CANONICAL_VERSION}\n${canonicalize(value)}`);
}

/** Display form only (`a83f…92c1`); never an identity. */
export function shortHash(hash: string): string {
  return hash.length <= 9 ? hash : `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}
