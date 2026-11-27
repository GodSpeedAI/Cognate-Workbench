// Store selection for the reconstruction apps (spec §13): PostgreSQL by default, via an explicit
// COGNATE_POSTGRES_URL or the pg0-managed local instance (`just db-setup && just db-up`).
//
// The schema is derived deterministically from the app's data path, so a given data directory always
// maps to the same database (restart persistence) while different directories (e.g. each test's
// mkdtemp directory) map to isolated schemas with no cross-test contamination.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { RuntimeStoreConfig } from "@godspeedai/cognate-runtime-bun";
import { resolvePg0Url } from "@godspeedai/cognate-store-postgres";

const MAX_IDENTIFIER_BYTES = 63; // PostgreSQL's identifier limit
const HASH_CHARS = 10;

const sanitize = (text: string): string => text.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

/**
 * The schema a data directory maps to: `cognate_<app>_<readable tail>_<10 hex of sha256(resolved path)>`.
 * The readable tail is for operators; the hash is what keeps `/tmp/a-b` and `/tmp/a_b` (and two long
 * paths with the same last 40 characters) from sharing one schema. Always <= 63 bytes.
 */
export function schemaFor(dataPath: string, app = "harness"): string {
  const absolute = resolve(dataPath);
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, HASH_CHARS);
  const prefix = `cognate_${sanitize(app).slice(0, 16)}_`;
  const room = MAX_IDENTIFIER_BYTES - prefix.length - HASH_CHARS - 1;
  const tail = sanitize(absolute).slice(-room).replace(/^_+/, "");
  return `${prefix}${tail ? `${tail}_` : ""}${hash}`;
}

/**
 * The name installs used before the hash was added. It collapses punctuation and keeps only the last
 * 40 characters, so distinct homes could share it. Kept only to recognise (and keep using) a schema
 * that already exists under it.
 */
export function legacySchemaFor(dataPath: string, app = "harness"): string {
  const sanitized = dataPath.replace(/[^a-zA-Z0-9]/g, "_").slice(-40).replace(/^_+/, "").toLowerCase();
  return `cognate_${app}_${sanitized}`;
}

/**
 * Schemas are recomputed from the data path at every boot, never stored. An install created before the
 * hash was added already holds its data under the legacy name, so that name wins when the schema
 * exists in the target database; otherwise the hashed name is used.
 */
export async function resolveSchemaFor(dataPath: string, app: string, url: string): Promise<string> {
  const current = schemaFor(dataPath, app);
  const legacy = legacySchemaFor(dataPath, app);
  if (legacy === current) return current;
  const sql = new Bun.SQL(url, { max: 1 });
  try {
    const rows = await sql`SELECT 1 AS found FROM information_schema.schemata WHERE schema_name = ${legacy}`;
    return rows.length > 0 ? legacy : current;
  } finally {
    await sql.close();
  }
}

export function postgresUrl(): string {
  return process.env.COGNATE_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
}

let bundledUrl: string | undefined;

/** Packaged installs resolve their bundled pg0 instance at boot (see `prepareBundledDatabase`) and hand its URL here. */
export function setBundledDatabaseUrl(url: string | undefined): void {
  bundledUrl = url;
}

/**
 * Store config for a data home that is known to be new (tests use fresh temp homes): always the hashed
 * schema. The server uses `storeConfigForHome`, which also honours a legacy schema.
 */
export function storeConfigFor(dataPath: string, app: string): RuntimeStoreConfig {
  const schema = schemaFor(dataPath, app);
  const url = process.env.COGNATE_POSTGRES_URL ?? bundledUrl;
  return url
    ? { postgres: { url, schema } }
    : { postgresPg0: { name: process.env.COGNATE_PG0_NAME ?? "cognate-dev", schema } };
}

/** Like `storeConfigFor`, but an existing legacy-named schema keeps being used (see `resolveSchemaFor`). */
export async function storeConfigForHome(dataPath: string, app: string): Promise<RuntimeStoreConfig> {
  const url = process.env.COGNATE_POSTGRES_URL ?? bundledUrl;
  if (url) return { postgres: { url, schema: await resolveSchemaFor(dataPath, app, url) } };
  const name = process.env.COGNATE_PG0_NAME ?? "cognate-dev";
  // The runtime starts this instance anyway at boot; starting it here lets the schema be looked up first.
  const pg0Url = await resolvePg0Url({ name });
  return { postgresPg0: { name, schema: await resolveSchemaFor(dataPath, app, pg0Url) } };
}
