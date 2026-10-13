// T11 (J-PREFS-shortcuts): pure shortcut logic — chord capture, reserved refusal, modifier-less
// refusal, cross-action conflict, default restoration, and the typing-target guard.
import { describe, expect, test } from "bun:test";
import {
  SHORTCUT_ACTIONS,
  actionById,
  chordFromKeyboardEvent,
  describeChord,
  detectConflict,
  effectiveChord,
  isChord,
  isDefault,
  isShortcutOverrides,
  isTypingTarget,
  resolveAll,
  resolveKeypress,
  restoreDefaults,
  validateAssignment,
  validateChord,
} from "../src/shortcuts.ts";

const key = (over: Partial<Parameters<typeof chordFromKeyboardEvent>[0]>): Parameters<typeof chordFromKeyboardEvent>[0] => ({
  key: "K",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

describe("chord capture", () => {
  test("a bare character key produces no chord — binding one is impossible by construction", () => {
    expect(chordFromKeyboardEvent(key({ key: "a" }))).toBeUndefined();
    expect(chordFromKeyboardEvent(key({ key: "Enter" }))).toBeUndefined();
    expect(chordFromKeyboardEvent(key({ key: "/" }))).toBeUndefined();
  });

  test("a lone modifier press produces no chord", () => {
    expect(chordFromKeyboardEvent(key({ key: "Control", ctrlKey: true }))).toBeUndefined();
    expect(chordFromKeyboardEvent(key({ key: "Shift", shiftKey: true }))).toBeUndefined();
  });

  test("Ctrl+K is canonicalised with a stable modifier order regardless of press order", () => {
    expect(chordFromKeyboardEvent(key({ key: "k", ctrlKey: true }))).toBe("Ctrl+K");
    expect(chordFromKeyboardEvent(key({ key: "K", ctrlKey: true }))).toBe("Ctrl+K");
  });

  test("modifier order is always Ctrl, Shift, Alt, Meta", () => {
    // Physical press order differs from canonical order; the canonical form must not.
    const a = chordFromKeyboardEvent(key({ key: "k", metaKey: true, altKey: true, shiftKey: true, ctrlKey: true }));
    expect(a).toBe("Ctrl+Shift+Alt+Meta+K");
  });

  test("a non-character key with a modifier keeps its name", () => {
    expect(chordFromKeyboardEvent(key({ key: "ArrowUp", ctrlKey: true }))).toBe("Ctrl+ArrowUp");
    expect(chordFromKeyboardEvent(key({ key: "/", ctrlKey: true }))).toBe("Ctrl+/");
  });
});

describe("validateChord", () => {
  test("accepts a well-formed chord with a modifier", () => {
    expect(validateChord("Ctrl+K")).toEqual({ ok: true });
    expect(validateChord("Ctrl+Shift+K")).toEqual({ ok: true });
    expect(validateChord("Ctrl+/")).toEqual({ ok: true });
  });

  test("refuses a browser-reserved chord by name", () => {
    const decision = validateChord("Ctrl+W");
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("Ctrl W");
    expect(validateChord("Ctrl+T").ok).toBe(false);
    expect(validateChord("Ctrl+N").ok).toBe(false);
    expect(validateChord("Ctrl+R").ok).toBe(false);
    expect(validateChord("F5").ok).toBe(false);
  });

  test("refuses a modifier-less chord so it can never fire while typing", () => {
    const decision = validateChord("K");
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("never fires while you type");
  });

  test("refuses a malformed chord", () => {
    expect(isChord("")).toBe(false);
    expect(validateChord("").ok).toBe(false);
  });
});

describe("conflict detection", () => {
  test("no conflict when the chord is free", () => {
    expect(detectConflict("new-session", "Ctrl+Shift+K", {})).toEqual({ ok: true });
  });

  test("names the clashing action when the chord is taken by a default", () => {
    const decision = detectConflict("new-session", "Ctrl+/", {});
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.conflictWith).toBe("open-shortcuts");
      expect(decision.reason).toContain("Open keyboard shortcuts");
    }
  });

  test("an override counts as taken", () => {
    const decision = detectConflict("open-settings", "Ctrl+Shift+K", { "new-session": "Ctrl+Shift+K" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.conflictWith).toBe("new-session");
  });

  test("a chord bound to null is free again", () => {
    expect(detectConflict("open-settings", "Ctrl+/", { "open-shortcuts": null })).toEqual({ ok: true });
  });

  test("an action does not conflict with itself", () => {
    expect(detectConflict("open-shortcuts", "Ctrl+/", {})).toEqual({ ok: true });
  });
});

describe("validateAssignment", () => {
  test("rejects an unknown action id", () => {
    const decision = validateAssignment("not-an-action", "Ctrl+K", {});
    expect(decision.ok).toBe(false);
  });
  test("surfaces the chord failure before the conflict failure", () => {
    // Ctrl+W is reserved AND would otherwise conflict; the reserved reason must win.
    const decision = validateAssignment("new-session", "Ctrl+W", { "open-shortcuts": "Ctrl+W" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("reserved by the browser");
  });
});

describe("effective chord and defaults", () => {
  test("an absent override falls back to the shipped default", () => {
    expect(effectiveChord("open-shortcuts", {})).toBe("Ctrl+/");
    expect(effectiveChord("new-session", {})).toBeUndefined();
  });

  test("an explicit null unbinds a defaulted action", () => {
    expect(effectiveChord("open-shortcuts", { "open-shortcuts": null })).toBeUndefined();
  });

  test("an explicit string rebinds an unbound action", () => {
    expect(effectiveChord("new-session", { "new-session": "Ctrl+Shift+N" })).toBe("Ctrl+Shift+N");
  });

  test("isDefault is true for {} and false once anything changed", () => {
    expect(isDefault({})).toBe(true);
    expect(isDefault(restoreDefaults())).toBe(true);
    expect(isDefault({ "new-session": "Ctrl+Shift+K" })).toBe(false);
    expect(isDefault({ "open-shortcuts": null })).toBe(false);
  });

  test("restoreDefaults writes every action explicitly, null when it had no default", () => {
    const restored = restoreDefaults();
    expect(restored["open-shortcuts"]).toBe("Ctrl+/");
    expect(restored["new-session"]).toBeNull();
    expect(Object.keys(restored).sort()).toEqual(SHORTCUT_ACTIONS.map((a) => a.id).sort());
  });

  test("isShortcutOverrides is a structural guard", () => {
    expect(isShortcutOverrides({})).toBe(true);
    expect(isShortcutOverrides({ "new-session": "Ctrl+K" })).toBe(true);
    expect(isShortcutOverrides({ "new-session": null })).toBe(true);
    expect(isShortcutOverrides({ "unknown-action": "Ctrl+K" })).toBe(false);
    expect(isShortcutOverrides({ "new-session": 42 })).toBe(false);
    expect(isShortcutOverrides(null)).toBe(false);
    expect(isShortcutOverrides([])).toBe(false);
  });
});

describe("describeChord", () => {
  test("renders as spaced words for display", () => {
    expect(describeChord("Ctrl+Shift+K")).toBe("Ctrl Shift K");
    expect(describeChord(undefined)).toBe("No shortcut");
    expect(describeChord("")).toBe("No shortcut");
  });
});

describe("typing guard", () => {
  test("text-entry targets are recognised", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  test("non-entry targets are not", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("resolveKeypress", () => {
  test("fires the action whose chord matches, outside a text field", () => {
    expect(resolveKeypress(key({ key: "/", ctrlKey: true }), {}, { tagName: "BODY" })).toBe("open-shortcuts");
  });
  test("never fires from inside a text-entry target", () => {
    expect(resolveKeypress(key({ key: "/", ctrlKey: true }), {}, { tagName: "INPUT" })).toBeUndefined();
    expect(resolveKeypress(key({ key: "/", ctrlKey: true }), {}, { tagName: "TEXTAREA" })).toBeUndefined();
  });
  test("a chord with no bound action fires nothing", () => {
    expect(resolveKeypress(key({ key: "k", ctrlKey: true, shiftKey: true }), {}, { tagName: "BODY" })).toBeUndefined();
  });
  test("a modifier-less keypress fires nothing", () => {
    expect(resolveKeypress(key({ key: "/" }), {}, { tagName: "BODY" })).toBeUndefined();
  });
  test("an override changes which chord fires", () => {
    expect(resolveKeypress(key({ key: "k", ctrlKey: true, shiftKey: true }), { "new-session": "Ctrl+Shift+K" }, { tagName: "BODY" })).toBe("new-session");
    // The default Ctrl+/ no longer fires once its action was unbound.
    expect(resolveKeypress(key({ key: "/", ctrlKey: true }), { "open-shortcuts": null }, { tagName: "BODY" })).toBeUndefined();
  });
  test("actionById resolves the shipped actions", () => {
    expect(actionById("open-shortcuts")?.defaultChord).toBe("Ctrl+/");
    expect(actionById("nope")).toBeUndefined();
  });
});
