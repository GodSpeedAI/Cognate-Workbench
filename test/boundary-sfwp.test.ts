// Teeth: src/ holds no hand-written SEA-Forge socket client. Every gateway call goes through the SDK's SeaForgeAuthority.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RULES = [/\bBun\.connect\s*\(/, /\bunix\s*:/, /\bverb\s*:\s*["'](authority_|system\.)/];

const matches = (text: string): string[] => RULES.filter((rule) => rule.test(text)).map(String);

/** Scans every .ts and .tsx file under `root`, recursively; returns how many files it read and which ones matched. */
async function scan(root: string): Promise<{ scanned: number; offenders: string[] }> {
  let scanned = 0;
  const offenders: string[] = [];
  for (const pattern of ["**/*.ts", "**/*.tsx"]) {
    for await (const file of new Glob(pattern).scan({ cwd: root, absolute: true })) {
      scanned += 1;
      const hit = matches(await Bun.file(file).text());
      if (hit.length) offenders.push(`${file}: ${hit.join(", ")}`);
    }
  }
  return { scanned, offenders };
}

test("src/ contains no raw SFWP socket client", async () => {
  const { scanned, offenders } = await scan(join(import.meta.dir, "..", "src"));
  expect(scanned).toBeGreaterThan(10); // a scan that read nothing would pass vacuously
  expect(offenders).toEqual([]);
});

test("the scanner finds a planted raw call in a nested .ts and .tsx file", async () => {
  expect(matches('await Bun.connect({ unix: "/x.sock", socket: {} });').length).toBeGreaterThanOrEqual(2);
  expect(matches('send({ verb: "authority_settle" })')).toHaveLength(1);
  const dir = mkdtempSync(join(tmpdir(), "sfwp-"));
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "clean.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "a", "b", "planted.ts"), "Bun.connect({ unix: p, socket: {} });\n");
    writeFileSync(join(dir, "a", "view.tsx"), 'export const v = () => send({ verb: "system.get_schema" });\n');
    const { scanned, offenders } = await scan(dir);
    expect(scanned).toBe(3);
    expect(offenders).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
