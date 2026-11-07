// The shell↔web bridge contract (desktop-native-completion B3): one documented entry
// point, host-initiated dispatch only, unknown and malformed messages refused, browser
// contexts untouched. The Rust side pins the same protocol in src-tauri/src/menu.rs tests.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerShellBridge, SHELL_BRIDGE_NAME, type ShellActionHandler } from "../src/ui/shell/desktopBridge.ts";

type Bridge = { dispatch(message: unknown): void };

function bridge(): Bridge {
  const window = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  const entry = window?.[SHELL_BRIDGE_NAME] as Bridge | undefined;
  if (!entry) throw new Error("bridge not registered");
  return entry;
}

describe("desktop bridge", () => {
  beforeEach(() => {
    // bun:test has no window global; the app runs in a webview where it exists. A fresh
    // object per test: the bridge's entry point is defined non-configurable (the production
    // contract — stable once registered), so tests must not share one window object.
    (globalThis as unknown as { window?: unknown }).window = {};
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  test("registers the frozen entry point and routes to the live handler map", () => {
    const calls: string[] = [];
    const handlers: Record<string, ShellActionHandler | undefined> = {
      "new-session": () => calls.push("new-session"),
    };
    registerShellBridge(() => handlers);
    const entry = bridge();
    expect(entry).toBeDefined();
    entry.dispatch({ v: 1, action: "new-session" });
    expect(calls).toEqual(["new-session"]);

    // The map is read on every dispatch: replacing the handler must take effect (App.tsx
    // rebuilds its map every render).
    handlers["new-session"] = () => calls.push("rebound");
    entry.dispatch({ v: 1, action: "new-session" });
    expect(calls).toEqual(["new-session", "rebound"]);
  });

  test("passes args through and refuses unknown actions without throwing", () => {
    const seen: unknown[] = [];
    registerShellBridge(() => ({ "toggle-sidebar": (args) => seen.push(args) }));
    bridge().dispatch({ v: 1, action: "toggle-sidebar", args: { source: "menu" } });
    expect(seen).toEqual([{ source: "menu" }]);
    expect(() => bridge().dispatch({ v: 1, action: "navigate-to-view" })).not.toThrow();
    expect(() => bridge().dispatch({ v: 1, action: "" })).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  test("refuses malformed dispatches: wrong version, missing action, not an object", () => {
    registerShellBridge(() => ({ "new-session": () => {} }));
    expect(() => bridge().dispatch({ v: 2, action: "new-session" })).not.toThrow();
    expect(() => bridge().dispatch({ action: "new-session" })).not.toThrow();
    expect(() => bridge().dispatch("new-session")).not.toThrow();
    expect(() => bridge().dispatch(null)).not.toThrow();
  });

  test("registers at most once; a second registration is a no-op (the shell's entry point is stable)", () => {
    const first: string[] = [];
    const second: string[] = [];
    registerShellBridge(() => ({ "new-session": () => first.push("first") }));
    registerShellBridge(() => ({ "new-session": () => second.push("second") }));
    bridge().dispatch({ v: 1, action: "new-session" });
    expect(first).toEqual(["first"]);
    expect(second).toEqual([]);
  });

  test("browser context (no window global): registration is a no-op, nothing throws", () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(() => registerShellBridge(() => ({}))).not.toThrow();
  });
});
