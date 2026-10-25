/**
 * The remote dialog keeps focus where the operator put it. A parent re-render hands the dialog a new
 * onClose on every pass; the focus effect must not re-run because of that, or focus jumps back to the
 * dialog container while the operator is working inside it (the app re-renders each second while streaming).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react/pure";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { useState } from "react";
import { RemoteDialog } from "../src/ui/RemotePanel.tsx";

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

/** A parent that re-renders on demand and passes a new inline onClose each time, as App does. */
function Parent() {
  const [ticks, setTicks] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTicks((n) => n + 1)}>Tick {ticks}</button>
      <RemoteDialog onClose={() => setTicks((n) => n)} />
    </>
  );
}

describe("remote dialog focus", () => {
  test("a parent re-render does not move focus away from a control inside the dialog", async () => {
    const ui = render(<Parent />);
    const close = ui.getByRole("button", { name: "Close" });
    await act(async () => {
      close.focus();
    });
    expect(document.activeElement).toBe(close);

    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: /^Tick/ }));
    });
    expect(document.activeElement).toBe(close);
  });
});
