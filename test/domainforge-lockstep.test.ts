// The live SEA-Forge tests refuse a DomainForge CLI that is not at the lockstep version, with the fix named.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDomainforgeLockstep, DOMAINFORGE_LOCKSTEP } from "./support/domainforge.ts";

function fakeCli(version: string): { bin: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "df-"));
  const bin = join(dir, "domainforge");
  writeFileSync(bin, `#!/bin/sh\necho "domainforge ${version}"\n`);
  chmodSync(bin, 0o755);
  return { bin, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a CLI at the lockstep version passes", () => {
  const cli = fakeCli(DOMAINFORGE_LOCKSTEP);
  try { expect(() => assertDomainforgeLockstep(cli.bin)).not.toThrow(); } finally { cli.done(); }
});

test("another version fails fast and names the fix", () => {
  const cli = fakeCli("0.21.2");
  try { expect(() => assertDomainforgeLockstep(cli.bin)).toThrow(/need domainforge 0\.21\.1.*just setup-domainforge/); } finally { cli.done(); }
});

test("a missing CLI fails fast", () => {
  expect(() => assertDomainforgeLockstep("/nonexistent/domainforge")).toThrow(/unavailable/);
});
