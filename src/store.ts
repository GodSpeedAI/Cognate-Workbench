// Store selection for the reconstruction apps (spec §13): PostgreSQL by default, via an explicit
// COGNATE_POSTGRES_URL or the pg0-managed local instance (`just db-setup && just db-up`).
//
// The schema is derived deterministically from the app's data path, so a given data directory always
// maps to the same database (restart persistence) while different directories (e.g. each test's
// mkdtemp directory) map to isolated schemas with no cross-test contamination.
import type { RuntimeStoreConfig } from "@godspeedai/cognate-runtime-bun";

export function schemaFor(dataPath: string, app = "harness"): string {
  const sanitized = dataPath.replace(/[^a-zA-Z0-9]/g, "_").slice(-40).replace(/^_+/, "").toLowerCase();
  return `cognate_${app}_${sanitized}`;
}

export function postgresUrl(): string {
  return process.env.COGNATE_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
}

export function storeConfigFor(dataPath: string, app: string): RuntimeStoreConfig {
  const schema = schemaFor(dataPath, app);
  const url = process.env.COGNATE_POSTGRES_URL;
  return url
    ? { postgres: { url, schema } }
    : { postgresPg0: { name: process.env.COGNATE_PG0_NAME ?? "cognate-dev", schema } };
}
