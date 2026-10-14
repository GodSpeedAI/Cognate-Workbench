/** Opaque, version-bound keyset cursors for bounded Expert read capabilities. */
export const EXPERT_PAGE_DEFAULT = 100;
export const EXPERT_PAGE_MAX = 100;

type Cursor = { readonly v: 1; readonly kind: string; readonly version: number; readonly scope: string; readonly boundary: readonly [string, string] };

function compareKey(a: readonly [string, string], b: readonly [string, string]): number {
  return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]);
}

function encode(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decode(raw: unknown, expected: Omit<Cursor, "boundary" | "v">): Cursor | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid pagination cursor");
  let cursor: Cursor;
  try { cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor; }
  catch { throw new Error("Invalid pagination cursor"); }
  if (!cursor || cursor.v !== 1 || cursor.kind !== expected.kind || cursor.scope !== expected.scope || !Array.isArray(cursor.boundary) || cursor.boundary.length !== 2 || cursor.boundary.some(value => typeof value !== "string")) {
    throw new Error("Pagination cursor does not match this read scope");
  }
  if (Object.keys(cursor).sort().join(",") !== "boundary,kind,scope,v,version") throw new Error("Invalid pagination cursor");
  if (cursor.version !== expected.version) throw new Error("Pagination cursor is stale; restart from the first page");
  return cursor;
}

export function pageExpertRows<T>(input: {
  readonly rows: readonly T[];
  readonly limit: number;
  readonly cursor?: unknown;
  readonly kind: string;
  readonly version: number;
  readonly scope: string;
  readonly key: (row: T) => readonly [string, string];
  /** Descending order returns newest rows first; pages are selected newest-to-oldest. */
  readonly descending?: boolean;
}): { readonly items: T[]; readonly nextCursor?: string } {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > EXPERT_PAGE_MAX) {
    throw new Error(`Page limit must be between 1 and ${EXPERT_PAGE_MAX}`);
  }
  const descending = input.descending ?? false;
  const cursor = decode(input.cursor, { kind: input.kind, version: input.version, scope: input.scope });
  if (cursor && !input.rows.some(row => compareKey(input.key(row), cursor.boundary) === 0)) throw new Error("Invalid pagination cursor boundary");
  const ordered = [...input.rows].sort((a, b) => compareKey(input.key(a), input.key(b)) * (descending ? -1 : 1));
  const eligible = cursor ? ordered.filter(row => compareKey(input.key(row), cursor.boundary) * (descending ? -1 : 1) > 0) : ordered;
  const selected = eligible.slice(0, input.limit);
  const hasMore = eligible.length > selected.length;
  if (!hasMore || selected.length === 0) return { items: selected };
  const boundary = input.key(selected[selected.length - 1]!);
  return { items: selected, nextCursor: encode({ v: 1, kind: input.kind, version: input.version, scope: input.scope, boundary }) };
}
