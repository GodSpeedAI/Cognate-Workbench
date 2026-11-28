// Distinct data homes must map to distinct schemas, and an install that already has a schema under
// the legacy (pre-hash) name keeps using it.
import { describe, expect, test } from "bun:test";
import { legacySchemaFor, resolveSchemaFor, schemaFor } from "../src/store.ts";
import { storeUrlForTest } from "./helpers.ts";

describe("schemaFor", () => {
  test("homes that differ only in punctuation map to different schemas", () => {
    expect(schemaFor("/tmp/a-b")).not.toBe(schemaFor("/tmp/a_b"));
    expect(legacySchemaFor("/tmp/a-b")).toBe(legacySchemaFor("/tmp/a_b")); // the defect this fixes
  });
  test("a long path keeps the schema within PostgreSQL's 63-byte limit, for any app name", () => {
    const long = `/tmp/${"very-long-directory-name/".repeat(20)}home`;
    for (const app of ["harness", "migration", "a-much-longer-application-name"]) {
      const name = schemaFor(long, app);
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
    expect(schemaFor(`${long}1`)).not.toBe(schemaFor(`${long}2`));
  });
  test("the name is deterministic and ends in the hash of the resolved absolute path", () => {
    expect(schemaFor("/tmp/x/../a-b")).toBe(schemaFor("/tmp/a-b"));
    expect(schemaFor("/tmp/a-b")).toMatch(/^cognate_harness_.*[0-9a-f]{10}$/);
  });
});

describe("resolveSchemaFor", () => {
  test("uses the new name when no legacy schema exists, and the legacy name when it does", async () => {
    const url = await storeUrlForTest();
    const home = `/tmp/legacy-schema-${process.pid}-${Date.now()}`;
    const legacy = legacySchemaFor(home);
    const sql = new Bun.SQL(url, { max: 1 });
    try {
      expect(await resolveSchemaFor(home, "harness", url)).toBe(schemaFor(home));
      await sql.unsafe(`CREATE SCHEMA "${legacy}"`);
      expect(await resolveSchemaFor(home, "harness", url)).toBe(legacy);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${legacy}" CASCADE`);
      await sql.close();
    }
  });
});
