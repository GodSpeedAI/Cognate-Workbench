/**
 * The dispositions-ledger guard: after the S1–S9 conversion track, no native <select> may
 * appear in any component again — new pickers use MenuSelect (the a11y gate in
 * test/ui-menu-select.test.tsx pins its contract). A KEEP-NATIVE exception exists only if
 * this ledger records one; the allowlist below is the recorded set.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Directories scanned for native selects (the UI tree). */
const ROOTS = ["src/ui", "src/components"] as const;

/** Files allowed to contain `<select` (the MenuSelect component itself). */
const ALLOWED = new Set(["src/ui/shell/MenuSelect.tsx"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

describe("native select guard", () => {
  test("no component renders a native <select> — pickers go through MenuSelect", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (ALLOWED.has(file.replace(/\\/g, "/"))) continue;
        const text = readFileSync(file, "utf8");
        if (/<select[\s>]/.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
