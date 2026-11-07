/**
 * The MenuSelect accessibility gate (dispositions-ledger global gate): no native <select>
 * converts to MenuSelect unless this contract holds — the trigger's accessible name carries
 * the current value, and the full keyboard contract works (arrows open, arrows/Home/End move,
 * Enter/Space pick, Esc/Tab close and return focus, click-outside closes).
 *
 * Interactive DOM via the established idiom (test/remote-dialog-focus.test.tsx): happy-dom
 * global registrator + Testing Library.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react/pure";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useState } from "react";
import { MenuSelect } from "../src/ui/shell/MenuSelect.tsx";

beforeAll(() => GlobalRegistrator.register());
afterEach(async () => {
  await act(async () => {
    cleanup();
    await Promise.resolve();
  });
});
afterAll(async () => {
  await act(async () => {
    cleanup();
    await Promise.resolve();
  });
  await GlobalRegistrator.unregister();
});

const OPTIONS = [
  { value: "fs", label: "fs-write" },
  { value: "sh", label: "shell-run" },
  { value: "net", label: "net-fetch" },
] as const;

/** Harness with real state, so a pick actually changes the announced value. */
function Harness({ onPicked }: { readonly onPicked?: (v: string) => void }) {
  const [value, setValue] = useState<"fs" | "sh" | "net">("sh");
  return (
    <div>
      <MenuSelect
        value={value}
        options={OPTIONS}
        ariaLabel="Auth profile"
        onPick={(v) => {
          setValue(v);
          onPicked?.(v);
        }}
      />
      <button type="button" data-testid="after">after</button>
    </div>
  );
}

function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(".menu-select-btn");
  if (!trigger) throw new Error("trigger not found");
  return trigger;
}

describe("MenuSelect accessibility gate", () => {
  test("the trigger's accessible name carries the current value, select-like", () => {
    const { container } = render(<Harness />);
    const trigger = openMenu(container);
    expect(trigger.getAttribute("aria-label")).toBe("Auth profile: shell-run");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("after a pick the announcement follows the new value", async () => {
    const { container } = render(<Harness />);
    const trigger = openMenu(container);
    // open → focus checked item → ArrowDown to the next item → Enter picks it
    await act(async () => fireEvent.click(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Enter" }));
    expect(trigger.getAttribute("aria-label")).toBe("Auth profile: net-fetch");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("ArrowDown opens the closed menu and focuses the checked item", async () => {
    const { container } = render(<Harness />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.keyDown(trigger, { key: "ArrowDown" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement?.textContent).toContain("shell-run");
  });

  test("ArrowUp also opens, focusing the checked item", async () => {
    const { container } = render(<Harness />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.keyDown(trigger, { key: "ArrowUp" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  });

  test("a disabled trigger ignores the open keys", async () => {
    const { container } = render(
      <MenuSelect value="fs" options={OPTIONS} ariaLabel="Auth profile" disabled onPick={() => {}} />,
    );
    const trigger = openMenu(container);
    expect(trigger.disabled).toBe(true);
    await act(async () => fireEvent.keyDown(trigger, { key: "ArrowDown" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("arrows move, Home and End jump, without picking", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.click(trigger));
    expect(document.activeElement?.textContent).toContain("shell-run"); // checked item focused
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    expect(document.activeElement?.textContent).toContain("net-fetch");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "End" }));
    expect(document.activeElement?.textContent).toContain("net-fetch");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Home" }));
    expect(document.activeElement?.textContent).toContain("fs-write");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }));
    expect(document.activeElement?.textContent).toContain("net-fetch");
    expect(picked).toEqual([]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  test("Enter picks the focused option and returns focus to the trigger", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Home" })); // fs-write
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Enter" }));
    expect(picked).toEqual(["fs"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  test("Escape closes without picking and returns focus to the trigger", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(picked).toEqual([]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  test("Tab closes without picking and focus continues after the control", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Tab" }));
    expect(picked).toEqual([]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  test("click-outside closes without picking", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.click(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent(document.body, new MouseEvent("mousedown", { bubbles: true })));
    expect(picked).toEqual([]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("Space on the trigger opens; Space on a focused option picks it", async () => {
    const picked: string[] = [];
    const { container } = render(<Harness onPicked={(v) => picked.push(v)} />);
    const trigger = openMenu(container);
    await act(async () => fireEvent.keyDown(trigger, { key: " " })); // button activation opens
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Home" })); // fs-write
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: " " }));
    expect(picked).toEqual(["fs"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("the field variant renders the same contract", async () => {
    const { container } = render(
      <MenuSelect value="net" options={OPTIONS} ariaLabel="Route" variant="field" onPick={() => {}} />,
    );
    const trigger = openMenu(container);
    expect(trigger.getAttribute("aria-label")).toBe("Route: net-fetch");
    await act(async () => fireEvent.keyDown(trigger, { key: "ArrowDown" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".menu-select-field")).toBeTruthy();
  });
});
