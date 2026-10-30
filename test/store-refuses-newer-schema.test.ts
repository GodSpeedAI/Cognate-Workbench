// Cognate 0.7.1: store-postgres refuses a schema whose `schema_versions` records a version newer than
// this build knows, and the refusal rolls back before writing anything. Workbench must surface that
// refusal from the same open path the server uses (storeConfigFor + createRuntime) and must not start.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller } from "@godspeedai/cognate-runtime-api";
import { allowCapabilities } from "@godspeedai/cognate-kernel-api";
import { createRuntime, type Runtime } from "@godspeedai/cognate-runtime-bun";
import { resolvePg0Url } from "@godspeedai/cognate-store-postgres";
import { postgresUrl, schemaFor, storeConfigFor } from "../src/store.ts";

const SYSTEM: Caller = { actor: { id: "system", kind: "system" }, tenant: "local" };
const FUTURE_VERSION = 999;

async function databaseUrl(): Promise<string> {
  return process.env.COGNATE_POSTGRES_URL ?? await resolvePg0Url({ name: process.env.COGNATE_PG0_NAME ?? "cognate-dev" }).catch(() => postgresUrl());
}

function openRuntime(home: string): Promise<Runtime> {
  return createRuntime({
    store: storeConfigFor(home, "harness"),
    policy: allowCapabilities("store-refuses-newer-schema-test", []),
    actions: { authorize: () => ({ allow: true, reason: "newer-schema refusal fixture" }) },
    agents: [],
    projections: [],
    system: SYSTEM.actor,
  });
}

test("STORE-NEWER-SCHEMA: Workbench refuses to open a store written by a newer schema and leaves it unchanged", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-newer-schema-"));
  const schema = schemaFor(home, "harness");
  const url = await databaseUrl();
  const sql = new Bun.SQL(url);
  try {
    // Let the store create its schema through the server's open path, then close it.
    const first = await openRuntime(home);
    await first.close();

    // Simulate a store written by a newer build.
    await sql.unsafe(`INSERT INTO ${schema}.schema_versions (version, applied_at) VALUES (${FUTURE_VERSION}, '2099-01-01T00:00:00.000Z')`);
    const before = await sql.unsafe<{ version: number; applied_at: string }[]>(`SELECT version, applied_at FROM ${schema}.schema_versions ORDER BY version`);
    expect(before.map((row) => row.version)).toContain(FUTURE_VERSION);

    // Reopening must refuse, and no runtime may come up.
    await expect(openRuntime(home)).rejects.toThrow(/newer than this build supports/);

    // The refusal rolls back: exactly the same version rows, nothing applied or re-stamped.
    const after = await sql.unsafe<{ version: number; applied_at: string }[]>(`SELECT version, applied_at FROM ${schema}.schema_versions ORDER BY version`);
    expect(after).toEqual(before);
    expect(after.map((row) => row.version)).toContain(FUTURE_VERSION);
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await sql.close().catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);
