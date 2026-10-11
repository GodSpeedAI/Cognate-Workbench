// Semantic Surface: a closed grammar for JIT representation. Components and mediators return data
// in this grammar; they never return React/JSX/HTML. `validateSurface` is strict — unknown block
// types, unknown keys and non-string leaves are rejected — so representation stays a governed
// capability (`surface.compose`) rather than an injection channel.
export type Intent = "inspect" | "compare" | "decide" | "verify" | "monitor";
export type Lifetime = "while-condition" | "until-settled" | "session" | "persistent-if-human-pinned";
export type KV = { readonly key: string; readonly value: string };

export type Block =
  | { readonly type: "callout"; readonly tone: "info" | "warn" | "fail" | "ok"; readonly title: string; readonly text?: string }
  | { readonly type: "entity"; readonly label: string; readonly fields: readonly KV[] }
  | { readonly type: "table"; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly type: "compare"; readonly left: CompareSide; readonly right: CompareSide }
  | { readonly type: "timeline"; readonly entries: readonly TimelineEntry[] }
  | { readonly type: "preflight"; readonly title: string; readonly target: string; readonly command?: string; readonly impact: readonly KV[]; readonly recovery?: string; readonly authority: "human-approval-required" | "none"; readonly actions: readonly Option[] }
  | { readonly type: "ask"; readonly question: string; readonly options: readonly Option[] };
export interface CompareSide { readonly label: string; readonly hash?: string; readonly items: readonly KV[] }
export interface TimelineEntry { readonly position: number; readonly kind: string; readonly label: string; readonly detail?: string; readonly hash?: string }
export interface Option { readonly id: string; readonly label: string }

export interface Surface {
  readonly id: string;
  readonly title: string;
  readonly intent: Intent;
  readonly purpose: string;
  readonly blocks: readonly Block[];
  readonly provenance: { readonly source: string; readonly eventPositions?: readonly number[] };
  readonly relatedCase?: string;
  readonly lifetime: Lifetime;
}

export class SurfaceError extends Error {
  override readonly name = "SurfaceError";
}

const bad = (path: string, why: string): never => {
  throw new SurfaceError(`${path}: ${why}`);
};
const rec = (v: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) bad(path, "expected object");
  const o = v as Record<string, any>;
  for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k)) bad(path, `unknown key "${k}"`);
  for (const k of keys) if (!(k in o)) bad(path, `missing "${k}"`);
  return o;
};
const str = (v: unknown, path: string): string => (typeof v === "string" ? v : bad(path, "expected string"));
const arr = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : bad(path, "expected array"));
const oneOf = <T extends string>(v: unknown, path: string, set: readonly T[]): T => (set.includes(v as T) ? (v as T) : bad(path, `expected one of ${set.join("|")}`));
const kvs = (v: unknown, path: string): KV[] => arr(v, path).map((x, i) => { const o = rec(x, `${path}[${i}]`, ["key", "value"]); return { key: str(o.key, path), value: str(o.value, path) }; });
const opts = (v: unknown, path: string): Option[] => arr(v, path).map((x, i) => { const o = rec(x, `${path}[${i}]`, ["id", "label"]); return { id: str(o.id, path), label: str(o.label, path) }; });
const side = (v: unknown, path: string): CompareSide => { const o = rec(v, path, ["label", "items"], ["hash"]); return { label: str(o.label, path), items: kvs(o.items, `${path}.items`), ...(o.hash === undefined ? {} : { hash: str(o.hash, path) }) }; };

function block(v: unknown, path: string): Block {
  const type = (v as { type?: unknown } | null)?.type;
  switch (type) {
    case "callout": { const o = rec(v, path, ["type", "tone", "title"], ["text"]); return { type, tone: oneOf(o.tone, path, ["info", "warn", "fail", "ok"] as const), title: str(o.title, path), ...(o.text === undefined ? {} : { text: str(o.text, path) }) }; }
    case "entity": { const o = rec(v, path, ["type", "label", "fields"]); return { type, label: str(o.label, path), fields: kvs(o.fields, path) }; }
    case "table": {
      const o = rec(v, path, ["type", "columns", "rows"]);
      const columns = arr(o.columns, path).map((c) => str(c, path));
      const rows = arr(o.rows, path).map((r) => arr(r, path).map((c) => str(c, path)));
      if (rows.some((r) => r.length !== columns.length)) bad(path, "row width differs from columns");
      return { type, columns, rows };
    }
    case "compare": { const o = rec(v, path, ["type", "left", "right"]); return { type, left: side(o.left, `${path}.left`), right: side(o.right, `${path}.right`) }; }
    case "timeline": {
      const o = rec(v, path, ["type", "entries"]);
      const entries = arr(o.entries, path).map((x, i) => {
        const e = rec(x, `${path}.entries[${i}]`, ["position", "kind", "label"], ["detail", "hash"]);
        if (typeof e.position !== "number") bad(path, "position must be a number");
        return { position: e.position as number, kind: str(e.kind, path), label: str(e.label, path), ...(e.detail === undefined ? {} : { detail: str(e.detail, path) }), ...(e.hash === undefined ? {} : { hash: str(e.hash, path) }) };
      });
      for (let i = 1; i < entries.length; i++) if (entries[i]!.position < entries[i - 1]!.position) bad(path, "timeline entries must be in consequential order");
      return { type, entries };
    }
    case "preflight": {
      const o = rec(v, path, ["type", "title", "target", "impact", "authority", "actions"], ["command", "recovery"]);
      return { type, title: str(o.title, path), target: str(o.target, path), impact: kvs(o.impact, path), authority: oneOf(o.authority, path, ["human-approval-required", "none"] as const), actions: opts(o.actions, path), ...(o.command === undefined ? {} : { command: str(o.command, path) }), ...(o.recovery === undefined ? {} : { recovery: str(o.recovery, path) }) };
    }
    case "ask": { const o = rec(v, path, ["type", "question", "options"]); return { type, question: str(o.question, path), options: opts(o.options, path) }; }
    default: return bad(path, `unknown block type ${JSON.stringify(type)}`);
  }
}

export function validateSurface(v: unknown): Surface {
  const o = rec(v, "surface", ["id", "title", "intent", "purpose", "blocks", "provenance", "lifetime"], ["relatedCase"]);
  const p = rec(o.provenance, "surface.provenance", ["source"], ["eventPositions"]);
  return {
    id: str(o.id, "surface.id"),
    title: str(o.title, "surface.title"),
    intent: oneOf(o.intent, "surface.intent", ["inspect", "compare", "decide", "verify", "monitor"] as const),
    purpose: str(o.purpose, "surface.purpose"),
    blocks: arr(o.blocks, "surface.blocks").map((b, i) => block(b, `surface.blocks[${i}]`)),
    provenance: { source: str(p.source, "surface.provenance.source"), ...(p.eventPositions === undefined ? {} : { eventPositions: arr(p.eventPositions, "surface.provenance").map((n) => (typeof n === "number" ? n : bad("surface.provenance", "positions are numbers"))) }) },
    ...(o.relatedCase === undefined ? {} : { relatedCase: str(o.relatedCase, "surface.relatedCase") }),
    lifetime: oneOf(o.lifetime, "surface.lifetime", ["while-condition", "until-settled", "session", "persistent-if-human-pinned"] as const),
  };
}

/** A Surface lives while its distinction is live; `settled` is derived by the caller from the Case. */
export function surfaceVisible(surface: Surface, state: { readonly conditionLive: boolean; readonly settled: boolean; readonly pinned?: boolean }): boolean {
  switch (surface.lifetime) {
    case "while-condition": return state.conditionLive;
    case "until-settled": return !state.settled;
    case "persistent-if-human-pinned": return state.pinned === true;
    default: return true;
  }
}
