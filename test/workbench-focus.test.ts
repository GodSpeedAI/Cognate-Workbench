import { test, describe, expect } from "bun:test";
import {
  type FocusRef,
  type HumanAttention,
  type AttentionSnapshot,
  type ReferentResolution,
  ATTENTION_PRECEDENCE,
  REFERENCE_WORDS,
  refKey,
  resolveAttention,
  captureSnapshot,
  resolveReferent,
  referentLine,
  withReferent,
  describeFocusRef,
  FocusAuthorityError,
  emptySharedFocus,
  proposeCandidate,
  canPropose,
  acceptCandidate,
  rejectCandidate,
  pinFocus,
  unpinFocus,
  clearFocus,
} from "../src/workbench/focus";

const makeRef = (kind: string, id: string, label: string): FocusRef => ({
  kind: kind as any,
  id,
  workspaceId: "ws1",
  label,
});

const makeMutRef = (kind: string, id: string, label: string, workspaceId: string): FocusRef => ({
  kind: kind as any,
  id,
  workspaceId,
  label,
});

describe("refKey", () => {
  test("creates consistent key from FocusRef", () => {
    const ref = makeRef("task", "t1", "Task A");
    const key = refKey(ref);
    expect(key).toBe("ws1:task:t1");
  });

  test("different refs produce different keys", () => {
    const ref1 = makeRef("task", "t1", "Task A");
    const ref2 = makeRef("task", "t2", "Task A");
    expect(refKey(ref1)).not.toBe(refKey(ref2));
  });

  test("same id/kind but different workspace produce different keys", () => {
    const ref1 = makeMutRef("task", "t1", "Task A", "ws1");
    const ref2 = makeMutRef("task", "t1", "Task A", "ws2");
    expect(refKey(ref1)).not.toBe(refKey(ref2));
  });

  test("different kinds produce different keys", () => {
    const ref1 = makeRef("task", "t1", "Task A");
    const ref2 = makeRef("evidence", "t1", "Task A");
    expect(refKey(ref1)).not.toBe(refKey(ref2));
  });
});

describe("resolveAttention", () => {
  test("returns explicit-selection when present", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(ref);
    expect(resolved.level).toBe("explicit-selection");
  });

  test("returns keyboard-focus when selection is missing", () => {
    const ref = makeRef("task", "t2", "Task B");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      keyboardFocus: ref,
      pinned: [],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(ref);
    expect(resolved.level).toBe("keyboard-focus");
  });

  test("returns active-run when selection and keyboardFocus are missing", () => {
    const ref = makeRef("automation", "a1", "Run A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      activeRun: ref,
      pinned: [],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(ref);
    expect(resolved.level).toBe("active-run");
  });

  test("returns first pinned when higher precedence are missing", () => {
    const pin1 = makeRef("task", "p1", "Pinned 1");
    const pin2 = makeRef("task", "p2", "Pinned 2");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      pinned: [pin1, pin2],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(pin1);
    expect(resolved.level).toBe("pinned-focus");
  });

  test("returns workspace-fallback when no referent is set", () => {
    const attention: HumanAttention = {
      workspaceId: "ws1",
      pinned: [],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBeUndefined();
    expect(resolved.level).toBe("workspace-fallback");
  });

  test("ignores references from different workspaces (selection)", () => {
    const ref = makeMutRef("task", "t1", "Task A", "ws2");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBeUndefined();
    expect(resolved.level).toBe("workspace-fallback");
  });

  test("ignores cross-workspace references in pinned but uses same-workspace", () => {
    const refDiff = makeMutRef("task", "p1", "Pinned 1", "ws2");
    const refSame = makeRef("task", "p2", "Pinned 2");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      pinned: [refDiff, refSame],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(refSame);
    expect(resolved.level).toBe("pinned-focus");
  });

  test("precedence order: selection > keyboardFocus > activeRun > pinned", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = makeRef("task", "k", "Keyboard");
    const run = makeRef("task", "r", "Run");
    const pin = makeRef("task", "p", "Pinned");

    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      activeRun: run,
      pinned: [pin],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.referent).toBe(sel);
    expect(resolved.level).toBe("explicit-selection");
  });

  test("alternatives includes all distinct candidates from all levels in precedence order", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = makeRef("task", "k", "Keyboard");
    const run = makeRef("task", "r", "Run");
    const pin1 = makeRef("task", "p1", "Pinned 1");
    const pin2 = makeRef("task", "p2", "Pinned 2");

    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      activeRun: run,
      pinned: [pin1, pin2],
    };
    const resolved = resolveAttention(attention);
    expect(resolved.alternatives).toHaveLength(4);
    expect(resolved.alternatives[0]).toBe(kbd);
    expect(resolved.alternatives[1]).toBe(run);
    expect(resolved.alternatives[2]).toBe(pin1);
    expect(resolved.alternatives[3]).toBe(pin2);
  });

  test("alternatives deduplicates by refKey", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = sel; // same object
    const pin = makeRef("task", "p", "Pinned");

    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      pinned: [pin],
    };
    const resolved = resolveAttention(attention);
    // alternatives should only include kbd and pin, since sel is the referent and kbd is same as sel
    expect(resolved.alternatives).toHaveLength(1);
    expect(resolved.alternatives[0]).toBe(pin);
  });
});

describe("captureSnapshot", () => {
  test("creates immutable snapshot", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.alternatives)).toBe(true);
  });

  test("snapshot does not change when attention is mutated afterwards", () => {
    const ref1 = makeRef("task", "t1", "Task A");
    const ref2 = makeRef("task", "t2", "Task B");
    let attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref1,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    expect(snapshot.referent?.id).toBe("t1");

    // Mutate the attention source
    attention = { ...attention, selection: ref2 };

    // Snapshot should still reference t1
    expect(snapshot.referent?.id).toBe("t1");
  });

  test("snapshot has correct metadata", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const timestamp = "2025-01-01T12:34:56Z";
    const snapshot = captureSnapshot("snap1", attention, timestamp);

    expect(snapshot.id).toBe("snap1");
    expect(snapshot.workspaceId).toBe("ws1");
    expect(snapshot.capturedAt).toBe(timestamp);
    expect(snapshot.level).toBe("explicit-selection");
  });
});

describe("resolveReferent", () => {
  test("returns referenced=false when query has no reference words", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("what is your name?", snapshot);
    expect(resolution.referenced).toBe(false);
    expect(resolution.referent).toBeUndefined();
  });

  test("detects 'this' as a whole word", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("why did this fail?", snapshot);
    expect(resolution.referenced).toBe(true);
    expect(resolution.referent).toBe(ref);
  });

  test("does NOT match 'this' in 'thistle'", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("a thistle plant", snapshot);
    expect(resolution.referenced).toBe(false);
  });

  test("detects 'it' as a whole word but not in 'item'", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution1 = resolveReferent("what is it?", snapshot);
    expect(resolution1.referenced).toBe(true);

    const resolution2 = resolveReferent("item list", snapshot);
    expect(resolution2.referenced).toBe(false);
  });

  test("detects multiple reference words", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("what about this and that?", snapshot);
    expect(resolution.referenced).toBe(true);
  });

  test("case-insensitive matching", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("Why did THIS fail?", snapshot);
    expect(resolution.referenced).toBe(true);
  });

  test("ambiguous=true when referenced && alternatives exist && level != explicit-selection", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = makeRef("task", "k", "Keyboard");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("what is this?", snapshot);
    expect(resolution.referenced).toBe(true);
    expect(resolution.ambiguous).toBe(false); // level is explicit-selection
  });

  test("ambiguous=true when referenced && alternatives exist && level is keyboard-focus", () => {
    const kbd = makeRef("task", "k", "Keyboard");
    const run = makeRef("task", "r", "Run");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      keyboardFocus: kbd,
      activeRun: run,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("what is this?", snapshot);
    expect(resolution.referenced).toBe(true);
    expect(resolution.ambiguous).toBe(true);
  });

  test("ambiguous=false when no alternatives", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      keyboardFocus: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const resolution = resolveReferent("what is this?", snapshot);
    expect(resolution.referenced).toBe(true);
    expect(resolution.ambiguous).toBe(false);
  });
});

describe("referentLine", () => {
  test("returns undefined when no referent", () => {
    const attention: HumanAttention = {
      workspaceId: "ws1",
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toBeUndefined();
  });

  test("formats basic referent line", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toContain('[focus: task "Task A" (t1)');
    expect(line).toContain("explicit selection");
  });

  test("includes alternatives when they exist", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = makeRef("workflow-node", "k", "Node K");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toContain("also in view:");
    expect(line).toContain('workflow-node "Node K"');
  });

  test("limits alternatives to 3", () => {
    const sel = makeRef("task", "s", "Selection");
    const kbd = makeRef("task", "k", "Keyboard");
    const run = makeRef("task", "r", "Run");
    const pin1 = makeRef("task", "p1", "Pinned 1");
    const pin2 = makeRef("task", "p2", "Pinned 2");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: sel,
      keyboardFocus: kbd,
      activeRun: run,
      pinned: [pin1, pin2],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toContain("also in view:");
    expect(line).toContain("...");
  });

  test("includes level label for keyboard-focus", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      keyboardFocus: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toContain("keyboard focus");
  });

  test("includes level label for active-run", () => {
    const ref = makeRef("automation", "a1", "Run A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      activeRun: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");
    const line = referentLine(snapshot);
    expect(line).toContain("active run");
  });
});

describe("withReferent", () => {
  test("returns message unchanged when snapshot is undefined", () => {
    const msg = "What should I do?";
    const result = withReferent(msg, undefined);
    expect(result).toBe(msg);
  });

  test("returns message unchanged when not referenced", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const msg = "What is your name?";
    const result = withReferent(msg, snapshot);
    expect(result).toBe(msg);
  });

  test("appends referent line when referenced and referent exists", () => {
    const ref = makeRef("task", "t1", "Task A");
    const attention: HumanAttention = {
      workspaceId: "ws1",
      selection: ref,
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const msg = "Why did this fail?";
    const result = withReferent(msg, snapshot);
    expect(result).toContain(msg);
    expect(result).toContain("[focus:");
  });

  test("does not append when no referent exists", () => {
    const attention: HumanAttention = {
      workspaceId: "ws1",
      pinned: [],
    };
    const snapshot = captureSnapshot("snap1", attention, "2025-01-01T00:00:00Z");

    const msg = "What about this?";
    const result = withReferent(msg, snapshot);
    expect(result).toBe(msg);
  });
});

describe("describeFocusRef", () => {
  test("describes task ref", () => {
    const ref = makeRef("task", "t1", "Task A");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Task "Task A"');
  });

  test("describes workflow-node ref", () => {
    const ref = makeRef("workflow-node", "n1", "Node 1");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Workflow node "Node 1"');
  });

  test("describes evidence ref", () => {
    const ref = makeRef("evidence", "e1", "Evidence 1");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Evidence "Evidence 1"');
  });

  test("describes capability ref", () => {
    const ref = makeRef("capability", "c1", "Capability 1");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Capability "Capability 1"');
  });

  test("describes automation ref", () => {
    const ref = makeRef("automation", "a1", "Automation 1");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Automation "Automation 1"');
  });

  test("describes file ref", () => {
    const ref = makeRef("file", "f1", "file.ts");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('File "file.ts"');
  });

  test("describes session ref", () => {
    const ref = makeRef("session", "s1", "Session 1");
    const desc = describeFocusRef(ref);
    expect(desc).toBe('Session "Session 1"');
  });
});

describe("SharedFocus management", () => {
  test("emptySharedFocus creates version 0 with no primary or pinned", () => {
    const focus = emptySharedFocus();
    expect(focus.version).toBe(0);
    expect(focus.primary).toBeUndefined();
    expect(focus.pinned).toHaveLength(0);
  });

  test("proposeCandidate creates a proposed candidate", () => {
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    expect(candidate.status).toBe("proposed");
    expect(candidate.proposed).toBe(ref);
  });

  test("canPropose returns true for new evidence token", () => {
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    const can = canPropose(
      { proposed: ref, evidenceToken: "token2" },
      [{ ...candidate, status: "rejected" as const }]
    );
    expect(can).toBe(true);
  });

  test("canPropose returns false when identical rejected candidate exists", () => {
    const ref = makeRef("task", "t1", "Task A");
    const rejected = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    const can = canPropose({ proposed: ref, evidenceToken: "token1" }, [
      { ...rejected, status: "rejected" as const },
    ]);
    expect(can).toBe(false);
  });

  test("acceptCandidate throws FocusAuthorityError for non-user actor", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    expect(() => acceptCandidate(focus, candidate, "agent", "agent1")).toThrow(FocusAuthorityError);
  });

  test("acceptCandidate succeeds for user actor", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    const { focus: nextFocus, candidate: nextCandidate } = acceptCandidate(
      focus,
      candidate,
      "user",
      "user1"
    );
    expect(nextFocus.primary).toBe(ref);
    expect(nextFocus.version).toBe(1);
    expect(nextCandidate.status).toBe("accepted");
    expect(nextCandidate.resolvedBy).toBe("user1");
  });

  test("rejectCandidate throws FocusAuthorityError for non-user actor", () => {
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    expect(() => rejectCandidate(candidate, "agent", "agent1")).toThrow(FocusAuthorityError);
  });

  test("rejectCandidate succeeds for user actor", () => {
    const ref = makeRef("task", "t1", "Task A");
    const candidate = proposeCandidate({
      id: "cand1",
      proposed: ref,
      reason: "User clicked task",
      evidenceToken: "token1",
      sourceAgent: "agent1",
    });
    const rejected = rejectCandidate(candidate, "user", "user1");
    expect(rejected.status).toBe("rejected");
    expect(rejected.resolvedBy).toBe("user1");
  });

  test("pinFocus throws FocusAuthorityError for non-user actor", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    expect(() => pinFocus(focus, ref, "agent")).toThrow(FocusAuthorityError);
  });

  test("pinFocus adds ref and increments version", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    const nextFocus = pinFocus(focus, ref, "user");
    expect(nextFocus.pinned).toHaveLength(1);
    expect(nextFocus.pinned[0]).toBe(ref);
    expect(nextFocus.version).toBe(1);
  });

  test("pinFocus deduplicates by refKey", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    let nextFocus = pinFocus(focus, ref, "user");
    nextFocus = pinFocus(nextFocus, ref, "user");
    expect(nextFocus.pinned).toHaveLength(1);
  });

  test("unpinFocus throws FocusAuthorityError for non-user actor", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    expect(() => unpinFocus(focus, ref, "agent")).toThrow(FocusAuthorityError);
  });

  test("unpinFocus removes ref and increments version", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    let nextFocus = pinFocus(focus, ref, "user");
    expect(nextFocus.pinned).toHaveLength(1);
    nextFocus = unpinFocus(nextFocus, ref, "user");
    expect(nextFocus.pinned).toHaveLength(0);
    expect(nextFocus.version).toBe(2);
  });

  test("unpinFocus returns same focus if ref not pinned", () => {
    const focus = emptySharedFocus();
    const ref = makeRef("task", "t1", "Task A");
    const nextFocus = unpinFocus(focus, ref, "user");
    expect(nextFocus).toBe(focus);
  });

  test("clearFocus throws FocusAuthorityError for non-user actor", () => {
    const focus = emptySharedFocus();
    expect(() => clearFocus(focus, "agent")).toThrow(FocusAuthorityError);
  });

  test("clearFocus removes primary and pins and increments version", () => {
    let focus = emptySharedFocus();
    const ref1 = makeRef("task", "t1", "Task A");
    const ref2 = makeRef("task", "t2", "Task B");

    focus = { ...focus, primary: ref1, pinned: [ref2] };
    focus = clearFocus(focus, "user");

    expect(focus.primary).toBeUndefined();
    expect(focus.pinned).toHaveLength(0);
    expect(focus.version).toBe(1);
  });

  test("clearFocus returns same focus if nothing to clear", () => {
    const focus = emptySharedFocus();
    const nextFocus = clearFocus(focus, "user");
    expect(nextFocus).toBe(focus);
  });
});
