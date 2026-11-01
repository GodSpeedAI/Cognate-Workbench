// DirectoryField: partial-name suggestions, drill-down completion, empty-state row, recents.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { useState } from "react";

// react-dom must load AFTER the DOM globals exist (it probes `window` at import time), or React's
// input/change event plugin is disabled — so everything DOM-bound is imported dynamically.
let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let fireEvent: typeof import("@testing-library/react/pure").fireEvent;
let render: typeof import("@testing-library/react/pure").render;
let DirectoryField: typeof import("../src/ui/DirectoryField.tsx").DirectoryField;
beforeAll(async () => {
  GlobalRegistrator.register();
  ({ act, cleanup, fireEvent, render } = await import("@testing-library/react/pure"));
  ({ DirectoryField } = await import("../src/ui/DirectoryField.tsx"));
});
afterEach(async () => { await act(async () => { cleanup(); await Promise.resolve(); }); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
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
    await act(async () => { typeInto(input, "pro"); await sleep(250); });
    const option = ui.getByRole("option");
    expect(option.textContent).toContain("projects");
    expect(option.textContent).toContain("~/projects");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { fireEvent.keyDown(input, { key: "ArrowDown" }); });
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    await act(async () => { fireEvent.keyDown(input, { key: "Tab" }); await sleep(250); });
    expect(input.value).toBe("/h/projects/");
    expect(ui.getByRole("option").textContent).toContain("cognate");
  });

  test("no match shows an inline empty row instead of closing", async () => {
    const ui = render(<Harness />);
    const input = ui.getByRole("combobox") as HTMLInputElement;
    await act(async () => { typeInto(input, "/h/projects/zzz"); await sleep(250); });
    expect(ui.getByRole("listbox").textContent).toContain('No folders match "zzz" in ~/projects');
  });

  test("focused empty field lists home folders, with recents above under a Recent label", async () => {
    const ui = render(<Harness recent={["/h/work/alpha"]} />);
    const input = ui.getByRole("combobox") as HTMLInputElement;
    await act(async () => { fireEvent.focus(input); await sleep(250); });
    expect(calls).toContain("~/");
    const text = ui.getByRole("listbox").textContent ?? "";
    expect(text.indexOf("Recent")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("/h/work/alpha")).toBeLessThan(text.indexOf("projects"));
  });
});
