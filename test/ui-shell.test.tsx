// T1a shell primitives: the shared dialog header (close X is always the last, right-hand control),
// the command palette's fuzzy ranking and the chord hint chips.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DialogHeader } from "../src/ui/shell/DialogHeader.tsx";
import { fuzzyScore, searchPalette, type PaletteItem } from "../src/ui/shell/CommandPalette.tsx";
import { Kbd } from "../src/ui/shell/Kbd.tsx";

const item = (id: string, label: string, group: PaletteItem["group"] = "Actions", extra: Partial<PaletteItem> = {}): PaletteItem => ({ id, group, label, run: () => undefined, ...extra });

describe("DialogHeader", () => {
  test("title first, subtitle under it, close button last and labelled", () => {
    const html = renderToStaticMarkup(<DialogHeader title="Add workspace" titleId="h" subtitle="Pick a folder" onClose={() => undefined} />);
    expect(html.indexOf("Add workspace")).toBeLessThan(html.indexOf("Pick a folder"));
    expect(html.indexOf("Pick a folder")).toBeLessThan(html.indexOf('aria-label="Close add workspace"'));
    expect(html).toContain("modal-header");
    expect(html).toContain('class="icon-btn dialog-close"');
    expect(html.trimEnd().endsWith("</div>")).toBe(true);
    expect(html.lastIndexOf("<button")).toBeGreaterThan(html.indexOf("<h2"));
  });

  test("extra actions sit between the title and the close button", () => {
    const html = renderToStaticMarkup(<DialogHeader title="Settings" onClose={() => undefined} closeLabel="settings" actions={<button type="button">Open configuration file</button>} />);
    expect(html.indexOf("Settings")).toBeLessThan(html.indexOf("Open configuration file"));
    expect(html.indexOf("Open configuration file")).toBeLessThan(html.indexOf("Close settings"));
  });
});

describe("palette fuzzy search", () => {
  test("a non-subsequence does not match; empty query matches everything", () => {
    expect(fuzzyScore("zzz", "New session")).toBeUndefined();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("substring and word-start hits outrank scattered subsequences", () => {
    const sub = fuzzyScore("sess", "New session")!;
    const scattered = fuzzyScore("nsn", "New session")!;
    expect(sub).toBeGreaterThan(scattered);
    expect(fuzzyScore("set", "Settings")!).toBeGreaterThan(fuzzyScore("set", "Reset all")!);
  });

  test("results are filtered and ordered by score; hidden keywords rank below label hits", () => {
    const items = [item("a", "Toggle sidebar", "Actions", { keywords: "settings panel" }), item("b", "Settings", "Settings"), item("c", "Workbench")];
    const hits = searchPalette(items, "sett").map((i) => i.id);
    expect(hits).toEqual(["b", "a"]);
    expect(searchPalette(items, "nothing-here")).toEqual([]);
  });

  test("with no query, sessions are capped so they cannot swamp the list", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => item(`s${i}`, `Session ${i}`, "Sessions"));
    const shown = searchPalette([item("x", "New session"), ...sessions], "");
    expect(shown.filter((i) => i.group === "Sessions").length).toBe(6);
    expect(shown[0]!.id).toBe("x");
  });
});

describe("Kbd", () => {
  test("renders one <kbd> per key and nothing for an unbound action", () => {
    const html = renderToStaticMarkup(<Kbd chord="Ctrl+Alt+N" />);
    expect((html.match(/<kbd>/g) ?? []).length).toBe(3);
    expect(renderToStaticMarkup(<Kbd chord={undefined} />)).toBe("");
  });
});
