// Teeth: src/ holds no hand-written SEA-Forge socket client. Every gateway call goes through the SDK's SeaForgeAuthority.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RULES = [/\bBun\.connect\s*\(/, /\bunix\s*:/, /\bverb\s*:\s*["'](authority_|system\.)/];

const matches = (text: string): string[] => RULES.filter((rule) => rule.test(text)).map(String);

test("src/ contains no raw SFWP socket client", async () => {
  const root = join(import.meta.dir, "..", "src");
  const offenders: string[] = [];
  for (const pattern of ["**/*.ts", "**/*.tsx"]) {
    for await (const file of new Glob(pattern).scan({ cwd: root, absolute: true })) {
      const hit = matches(await Bun.file(file).text());
      if (hit.length) offenders.push(`${file}: ${hit.join(", ")}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the detector matches a planted raw call", () => {
  expect(matches('await Bun.connect({ unix: "/x.sock", socket: {} });').length).toBeGreaterThanOrEqual(2);
  expect(matches('send({ verb: "authority_settle" })')).toHaveLength(1);
  const dir = mkdtempSync(join(tmpdir(), "sfwp-"));
  try {
    writeFileSync(join(dir, "planted.ts"), 'Bun.connect({ unix: p, socket: {} });\n');
    expect(matches(require("node:fs").readFileSync(join(dir, "planted.ts"), "utf8")).length).toBeGreaterThan(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
