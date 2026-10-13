// Pure review/diff helpers behind the Review panel's Code view, Download patch and Open-patch-in-a-
// new-tab actions (T11). No React, no client — the assertions are about exact bytes.
import { describe, expect, test } from "bun:test";
import { diffHunk, renderFileAfterChange, renderUnifiedPatch, reviewTabKey, type EditSummary } from "../src/reviewPatch.ts";

const SUMMARY: EditSummary = {
  file_path: "src/greet.ts",
  additions: 2,
  deletions: 1,
  diffLines: [" const who = \"world\";", "-export function greet() {", "+export function greet(name: string) {", "+  return `hi ${name}`;", " }"],
};

describe("diffHunk", () => {
  test("numbers old and new gutters independently and reports both counts", () => {
    const { rows, header } = diffHunk(SUMMARY.diffLines);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ kind: "ctx", oldNo: 1, newNo: 1, text: 'const who = "world";' });
    expect(rows[1]).toEqual({ kind: "del", oldNo: 2, text: "export function greet() {" });
    expect(rows[2]).toEqual({ kind: "add", newNo: 2, text: "export function greet(name: string) {" });
    expect(rows[3]).toEqual({ kind: "add", newNo: 3, text: "  return `hi ${name}`;" });
    expect(rows[4]).toEqual({ kind: "ctx", oldNo: 3, newNo: 4, text: "}" });
    expect(header).toBe("@@ -1,3 +1,4 @@");
  });
});

describe("renderFileAfterChange (Code view)", () => {
  test("drops deletions and renumbers the new file from 1", () => {
    const rows = renderFileAfterChange(SUMMARY.diffLines);
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.text)).toEqual([
      'const who = "world";',
      "export function greet(name: string) {",
      "  return `hi ${name}`;",
      "}",
    ]);
    expect(rows.some((r) => r.text.includes("export function greet() {"))).toBe(false);
  });

  test("a pure deletion leaves the surrounding context intact", () => {
    const rows = renderFileAfterChange([" keep", "-gone", " also"]);
    expect(rows.map((r) => r.text)).toEqual(["keep", "also"]);
    expect(rows.map((r) => r.no)).toEqual([1, 2]);
  });
});

describe("renderUnifiedPatch", () => {
  test("emits standard a/ b/ headers, the hunk header and every source line", () => {
    const patch = renderUnifiedPatch(SUMMARY, "@@ -1,3 +1,4 @@");
    const lines = patch.split("\n");
    expect(lines[0]).toBe("--- a/src/greet.ts");
    expect(lines[1]).toBe("+++ b/src/greet.ts");
    expect(lines[2]).toBe("@@ -1,3 +1,4 @@");
    expect(lines[3]).toBe(" const who = \"world\";");
    expect(lines.at(-1)).toBe("");
    expect(patch.endsWith("\n")).toBe(true);
  });
});

describe("reviewTabKey", () => {
  test("keys on turn and path so the same edit is never opened twice", () => {
    const a = reviewTabKey(SUMMARY, 3);
    const b = reviewTabKey(SUMMARY, 3);
    const c = reviewTabKey(SUMMARY, 4);
    expect(a.key).toBe("3:src/greet.ts");
    expect(a.key).toBe(b.key);
    expect(c.key).toBe("4:src/greet.ts");
    expect(a.turnNumber).toBe(3);
    expect(a.summary).toBe(SUMMARY);
  });
});
