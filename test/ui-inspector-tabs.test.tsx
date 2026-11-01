// Inspector Files and Config tabs against a fake client.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React from "react";

let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let fireEvent: typeof import("@testing-library/react/pure").fireEvent;
let render: typeof import("@testing-library/react/pure").render;
let Inspector: typeof import("../src/ui/shell/Inspector.tsx").Inspector;
let InspectorProvider: typeof import("../src/ui/shell/Inspector.tsx").InspectorProvider;
let useInspector: typeof import("../src/ui/shell/Inspector.tsx").useInspector;
let FilesTab: typeof import("../src/ui/inspector/FilesTab.tsx").FilesTab;
let ConfigTab: typeof import("../src/ui/inspector/ConfigTab.tsx").ConfigTab;
beforeAll(async () => {
  GlobalRegistrator.register();
  window.innerWidth = 1400;
  ({ act, cleanup, fireEvent, render } = await import("@testing-library/react/pure"));
  ({ Inspector, InspectorProvider, useInspector } = await import("../src/ui/shell/Inspector.tsx"));
  ({ FilesTab } = await import("../src/ui/inspector/FilesTab.tsx"));
  ({ ConfigTab } = await import("../src/ui/inspector/ConfigTab.tsx"));
});
afterEach(async () => { await act(async () => { cleanup(); await Promise.resolve(); }); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = () => act(async () => { await sleep(20); });

function Opener({ tab }: { tab: string }) {
  const { openInspector } = useInspector();
  React.useEffect(() => { openInspector(tab); }, [tab, openInspector]);
  return null;
}
const CFG = { ok: true, path: "/h/.cognate/config.json", home: "/h", exists: true, text: "{}", version: "v0", readOnlyKeys: [] as string[] };
function mount(tab: string, inner: (c: string, i: unknown) => Promise<unknown>, ws: string | null = "w1") {
  // Both tabs are always mounted; give the one under test's sibling harmless defaults.
  const invoke = async (c: string, i: unknown) => {
    if (tab === "files" && c.startsWith("config.")) return CFG;
    if (tab === "config" && c.startsWith("workspace.")) return { entries: [], truncated: false };
    return inner(c, i);
  };
  return render(
    <InspectorProvider>
      <Opener tab={tab} />
      <FilesTab invoke={invoke} workspaceId={ws ?? undefined} workspaceName="proj" />
      <ConfigTab invoke={invoke} />
      <Inspector sidebarWidth={280} />
    </InspectorProvider>,
  );
}

describe("Files tab", () => {
  test("tree expands lazily and opens a file in a viewer with line numbers", async () => {
    const calls: string[] = [];
    const invoke = async (cap: string, input: unknown) => {
      const i = input as { path?: string };
      calls.push(`${cap}:${i.path ?? ""}`);
      if (cap === "workspace.files.list") {
        return i.path === "src"
          ? { entries: [{ name: "a.ts", path: "src/a.ts", kind: "file" }], truncated: false }
          : { entries: [{ name: "src", path: "src", kind: "directory" }, { name: "README.md", path: "README.md", kind: "file" }], truncated: false };
      }
      return { size: 10, text: "one\ntwo\nthree", binary: false, truncated: false, language: "typescript" };
    };
    const ui = mount("files", invoke);
    await flush();
    expect(ui.getByRole("tree")).toBeTruthy();
    await act(async () => { fireEvent.click(ui.getByText("src")); await sleep(20); });
    expect(calls).toContain("workspace.files.list:src");
    await act(async () => { fireEvent.click(ui.getByText("a.ts")); await sleep(20); });
    expect(calls).toContain("workspace.file.read:src/a.ts");
    const region = ui.getByRole("region", { name: "Contents of a.ts" });
    expect(region.textContent).toContain("three");
    expect(region.textContent).toContain("3");
    await act(async () => { fireEvent.click(ui.getByLabelText("Close a.ts")); await sleep(5); });
    expect(ui.queryByRole("region")).toBeNull();
  });

  test("keyboard: ArrowDown then Right expands a folder", async () => {
    const invoke = async (_c: string, input: unknown) =>
      (input as { path?: string }).path === "d"
        ? { entries: [{ name: "x.txt", path: "d/x.txt", kind: "file" }], truncated: false }
        : { entries: [{ name: "d", path: "d", kind: "directory" }], truncated: false };
    const ui = mount("files", invoke);
    await flush();
    const tree = ui.getByRole("tree");
    await act(async () => { fireEvent.keyDown(tree, { key: "ArrowRight" }); await sleep(20); });
    expect(ui.getByText("x.txt")).toBeTruthy();
  });

  test("no workspace shows an empty state", async () => {
    const ui = mount("files", async () => ({}), null);
    await flush();
    expect(ui.getByText("No workspace selected")).toBeTruthy();
  });
});

describe("Config tab", () => {
  const base = { ok: true, path: "/h/.cognate/config.json", home: "/h", exists: true, text: '{\n  "appearance": "dark"\n}', version: "v1", readOnlyKeys: ["$schema"] };
  const edit = async (ui: ReturnType<typeof mount>, value: string) => {
    const ta = ui.getByLabelText("Configuration JSON") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(ta, value); ta.dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(5); });
  };

  test("dirty edit saves via apply with expectedVersion and reports applied keys", async () => {
    const applies: unknown[] = [];
    let text = base.text;
    const invoke = async (cap: string, input: unknown) => {
      if (cap === "config.file.read") return { ...base, text, version: applies.length ? "v2" : "v1" };
      applies.push(input); text = (input as { text: string }).text;
      return { ok: true, applied: ["appearance"], ignored: ["note"], version: "v2", path: base.path };
    };
    const ui = mount("config", invoke);
    await flush();
    expect(ui.getByText("exists")).toBeTruthy();
    await edit(ui, '{ "appearance": "light" }');
    expect(ui.getByText("Unsaved changes")).toBeTruthy();
    await act(async () => { fireEvent.click(ui.getByText("Save")); await sleep(30); });
    expect(applies).toEqual([{ text: '{ "appearance": "light" }', expectedVersion: "v1" }]);
    expect(ui.getByRole("status").textContent).toContain("Applied: appearance");
    expect(ui.getByRole("status").textContent).toContain("Ignored: note");
  });

  test("invalid JSON blocks save with line and column", async () => {
    let applied = 0;
    const invoke = async (cap: string) => { if (cap === "config.file.apply") applied++; return base; };
    const ui = mount("config", invoke);
    await flush();
    await edit(ui, '{\n  "a": 1,\n  "b": }');
    await act(async () => { fireEvent.click(ui.getByText("Save")); await sleep(10); });
    expect(applied).toBe(0);
    expect(ui.getByRole("alert").textContent).toMatch(/line 3, column \d+/);
  });

  test("a server refusal is shown with its message and line", async () => {
    const invoke = async (cap: string) => {
      if (cap === "config.file.read") return base;
      throw new Error('invocation of config.file.apply failed: {"kind":"failed","message":"bad value at line 2, column 5"}');
    };
    const ui = mount("config", invoke);
    await flush();
    await edit(ui, '{\n "appearance": 1\n}');
    await act(async () => { fireEvent.click(ui.getByText("Save")); await sleep(20); });
    expect(ui.getByRole("alert").textContent).toContain("bad value at line 2, column 5");
  });
});
