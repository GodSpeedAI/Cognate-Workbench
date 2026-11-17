// The brands of typedRecord.ts (`Trusted`, `Sha256`, `MintedId`, `WireId`, and the record vocabulary) are constructible only
// inside that module. A cast to any of them anywhere else in src would let server-originated text be laundered into a record.
// The two modules that handle server bytes must not call the runtime-authored constructors at all.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
const BRANDS = "Trusted|Sha256|MintedId|WireId|RecordCode|CallCode|StripClass|RecordField|TypedPayload";
const CAST = new RegExp(String.raw`\bas\s+(?:unknown\s+as\s+)?(?:${BRANDS})\b`);

describe("J-CAP-t3-brands: brands are constructible only in typedRecord.ts", () => {
  test("no brand cast outside typedRecord.ts", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      if (f.endsWith("src/mcp/typedRecord.ts")) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (CAST.test(line.replace(/\/\/.*$/, ""))) offenders.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });
  test("the server-byte modules never use the runtime-authored constructors", () => {
    for (const f of ["mcp/client.ts", "mcp/ingress.ts"]) {
      expect(readFileSync(join(SRC, f), "utf8"), f).not.toMatch(/\b(operatorText|operatorJson)\(/);
    }
  });
});
