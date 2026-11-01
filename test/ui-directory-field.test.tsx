// DirectoryField: partial-name suggestions, drill-down completion, empty-state row, recents.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerDom, releaseDom } from "./dom-env.ts";
import React, { useState } from "react";

// react-dom must load AFTER the DOM globals exist (it probes `window` at import time), or React's
// input/change event plugin is disabled — so everything DOM-bound is imported dynamically.
let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let fireEvent: typeof import("@testing-library/react/pure").fireEvent;
let render: typeof import("@testing-library/react/pure").render;
let DirectoryField: typeof import("../src/ui/DirectoryField.tsx").DirectoryField;
beforeAll(async () => {
  registerDom();
  ({ act, cleanup, fireEvent, render } = await import("@testing-library/react/pure"));
  ({ DirectoryField } = await import("../src/ui/DirectoryField.tsx"));
});
afterAll(async () => { await releaseDom(); });
afterEach(async () => { await act(async () => { cleanup(); await Promise.resolve(); }); });

// fireEvent.change uses the element's own realm; a hand-picked window.* prototype breaks when several
// ui-* files share one process and each registers its own happy-dom window.
function typeInto(input: HTMLInputElement, value: string) { fireEvent.change(input, { target: { value } }); }
/** Poll (inside act) until `ok()` holds, instead of sleeping a fixed time against the 120ms debounce. */
async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
const calls: string[] = [];
const invoke = async (_cap: string, input: unknown) => {
  const typed = (input as { typedPath: string }).typedPath;
  calls.push(typed);
  if (typed === "~/" || typed === "") return { suggestions: [{ name: "projects", path: "/h/projects", display: "~/projects", matchIndices: [] }], resolvedParentDisplay: "~" };
  if (typed === "pro") return { suggestions: [{ name: "projects", path: "/h/projects", display: "~/projects", matchIndices: [0, 1, 2] }], resolvedParentDisplay: "~" };
  if (typed === "/h/projects/") return { suggestions: [{ name: "cognate", path: "/h/projects/cognate", display: "~/projects/cognate", matchIndices: [] }], resolvedParentDisplay: "~/projects" };
  return { suggestions: [], resolvedParentDisplay: "~/projects" };
};

function Harness({ initial = "", recent }: { initial?: string; recent?: string[] }) {
  const [v, setV] = useState(initial);
  return <DirectoryField worldId="local" label="Path" value={v} onChange={setV} invoke={invoke} recent={recent} />;
}

describe("DirectoryField", () => {
  test("typing a partial name shows options with combobox semantics; Tab completes and drills down", async () => {
    const ui = render(<Harness />);
    const input = ui.getByRole("combobox") as HTMLInputElement;
    await act(async () => { typeInto(input, "pro"); });
    await until(() => ui.queryAllByRole("option").length > 0);
    const option = ui.getByRole("option");
    expect(option.textContent).toContain("projects");
    expect(option.textContent).toContain("~/projects");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { fireEvent.keyDown(input, { key: "ArrowDown" }); });
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    await act(async () => { fireEvent.keyDown(input, { key: "Tab" }); });
    await until(() => (ui.queryByRole("option")?.textContent ?? "").includes("cognate"));
    expect(input.value).toBe("/h/projects/");
    expect(ui.getByRole("option").textContent).toContain("cognate");
  });

  test("no match shows an inline empty row instead of closing", async () => {
    const ui = render(<Harness />);
    const input = ui.getByRole("combobox") as HTMLInputElement;
    await act(async () => { typeInto(input, "/h/projects/zzz"); });
    await until(() => (ui.queryByRole("listbox")?.textContent ?? "").includes("No folders match"));
    expect(ui.getByRole("listbox").textContent).toContain('No folders match "zzz" in ~/projects');
  });

  test("focused empty field lists home folders, with recents above under a Recent label", async () => {
    const ui = render(<Harness recent={["/h/work/alpha"]} />);
    const input = ui.getByRole("combobox") as HTMLInputElement;
    await act(async () => { fireEvent.focus(input); });
    await until(() => (ui.queryByRole("listbox")?.textContent ?? "").includes("projects"));
    expect(calls).toContain("~/");
    const text = ui.getByRole("listbox").textContent ?? "";
    expect(text.indexOf("Recent")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("/h/work/alpha")).toBeLessThan(text.indexOf("projects"));
  });
});
