// The window-title contract (desktop-native-completion B3): the web side of the two-sided,
// test-pinned grammar the shell parses strictly (src-tauri/src/title.rs). Counts and states
// only — a title carrying session content must never parse as a cue, on either side.
import { describe, expect, test } from "bun:test";
import { composeTitle, highestTitleState, parseTitle, titlePrecedence, TITLE_BASE } from "../src/ui/titleStatus.ts";

describe("title status contract", () => {
  test("every state composes into the v1 grammar and parses back exactly", () => {
    const states = [
      { kind: "idle" },
      { kind: "running" },
      { kind: "waiting" },
      { kind: "reconciliation" },
      { kind: "approval", count: 1 },
      { kind: "approval", count: 4 },
    ] as const;
    for (const state of states) {
      const title = composeTitle(state);
      const parsed = parseTitle(title);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.state).toEqual(state);
    }
  });

  test("the composed titles read as operator copy, not machine output", () => {
    expect(composeTitle({ kind: "idle" })).toBe("Cognate Workbench");
    expect(composeTitle({ kind: "approval", count: 1 })).toBe("Cognate Workbench — 1 approval waiting");
    expect(composeTitle({ kind: "approval", count: 2 })).toBe("Cognate Workbench — 2 approvals waiting");
    expect(composeTitle({ kind: "running" })).toBe("Cognate Workbench — running");
  });

  test("the parser is strict: wrong app name, extra text, or a different format is unknown", () => {
    expect(parseTitle("Cognate Console").ok).toBe(false);
    expect(parseTitle("Cognate Workbench ").ok).toBe(false);
    expect(parseTitle("Cognate Workbench — 1 approvals waiting").ok).toBe(false);
    expect(parseTitle("Cognate Workbench — 0 approvals waiting").ok).toBe(false);
    expect(parseTitle(`${TITLE_BASE} — Acme repo · fix the login bug`).ok).toBe(false);
    expect(parseTitle("Cognate Workbench — approval waiting").ok).toBe(false);
  });

  test("precedence: what waits on the operator outranks activity", () => {
    expect(titlePrecedence({ kind: "approval", count: 1 })).toBeGreaterThan(titlePrecedence({ kind: "reconciliation" }));
    expect(titlePrecedence({ kind: "reconciliation" })).toBeGreaterThan(titlePrecedence({ kind: "waiting" }));
    expect(titlePrecedence({ kind: "waiting" })).toBeGreaterThan(titlePrecedence({ kind: "running" }));
    expect(titlePrecedence({ kind: "running" })).toBeGreaterThan(titlePrecedence({ kind: "idle" }));
  });

  test("highestTitleState picks the operator-facing state from overlapping conditions", () => {
    expect(
      highestTitleState([{ kind: "running" }, { kind: "waiting" }, { kind: "idle" }]).kind,
    ).toBe("waiting");
    expect(
      highestTitleState([{ kind: "running" }, { kind: "approval", count: 2 }]).kind,
    ).toBe("approval");
    expect(highestTitleState([{ kind: "idle" }]).kind).toBe("idle");
  });
});
