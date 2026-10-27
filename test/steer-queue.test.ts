// T04: the composer queue and steering honesty rules.
//
// The interesting assertions are the ones that fail if the UI is optimistic: a steering message must
// never read "applied" before the log says so, and a consumed id must only clear its own attempt.
import { describe, expect, test } from "bun:test";
import {
  enqueue,
  markConsumed,
  queueNotice,
  remove,
  settleRun,
  shift,
  steerStatusLine,
  type QueuedMessage,
  type SteerAttempt,
} from "../src/steerQueue.ts";

function msg(id: string, text: string): QueuedMessage {
  return { id, text, createdAt: 0 };
}

function attempt(id: string, runId = "run-1", status: SteerAttempt["status"] = "pending"): SteerAttempt {
  return { id, text: `text-${id}`, runId, status };
}

describe("queue", () => {
  test("messages come out in the order they went in", () => {
    let q: readonly QueuedMessage[] = [];
    q = enqueue(q, msg("a", "first"));
    q = enqueue(q, msg("b", "second"));
    q = enqueue(q, msg("c", "third"));
    expect(q.map((m) => m.text)).toEqual(["first", "second", "third"]);

    const one = shift(q);
    expect(one.next?.id).toBe("a");
    const two = shift(one.rest);
    expect(two.next?.id).toBe("b");
    const three = shift(two.rest);
    expect(three.next?.id).toBe("c");
    expect(shift(three.rest).next).toBeUndefined();
  });

  test("TEETH: cancelling the first of two sends exactly the second", () => {
    let q: readonly QueuedMessage[] = [];
    q = enqueue(q, msg("a", "first"));
    q = enqueue(q, msg("b", "second"));
    q = remove(q, "a");

    const one = shift(q);
    expect(one.next?.text).toBe("second");
    // The cancelled message cannot resurface: the queue is empty after the single dispatch.
    expect(one.rest).toHaveLength(0);
    expect(shift(one.rest).next).toBeUndefined();
  });

  test("re-enqueueing the same id is a no-op, not a duplicate row", () => {
    const q = enqueue([msg("a", "first")], msg("a", "first"));
    expect(q).toHaveLength(1);
  });

  test("removing an unknown id leaves the queue unchanged", () => {
    const q = [msg("a", "first")];
    expect(remove(q, "nope")).toEqual(q);
  });

  test("shifting an empty queue is safe", () => {
    const empty = shift([]);
    expect(empty.next).toBeUndefined();
    expect(empty.rest).toEqual([]);
  });

  test("the one-message notice keeps the pre-T04 wording verbatim", () => {
    // The single-entry copy must not change: users are used to this exact sentence.
    expect(queueNotice(1)).toBe("Queued — sends when the current run finishes");
  });

  test("the multi-message notice is plural and states the order", () => {
    expect(queueNotice(2)).toContain("2 messages queued");
    expect(queueNotice(2)).toContain("sent in order");
  });
});

describe("steering status", () => {
  test("TEETH: an unconsumed steer never reads as applied, and its text is handed back", () => {
    const attempts = [attempt("s1")];
    // Nothing consumed it, and the run ends.
    const settled = settleRun(attempts, "run-1");
    expect(settled.unapplied.map((a) => a.text)).toEqual(["text-s1"]);
    const [only] = settled.attempts;
    if (only === undefined) throw new Error("expected one attempt");
    expect(only.status).toBe("not-applied");
    // The transcript line must not claim it was taken up.
    expect(steerStatusLine(only.status)).not.toContain("applied at the next step");
    expect(steerStatusLine(only.status)).toContain("not applied");
  });

  test("TEETH: consumption is credited by id, so a sibling attempt stays pending", () => {
    const attempts = [attempt("s1"), attempt("s2")];
    const after = markConsumed(attempts, ["s2"]);
    const [first, second] = [after[0], after[1]];
    if (first === undefined || second === undefined) throw new Error("expected two attempts");
    expect(first.status).toBe("pending");
    expect(second.status).toBe("applied");
  });

  test("a consumed event naming an unknown id changes nothing", () => {
    const attempts = [attempt("s1")];
    expect(markConsumed(attempts, ["other"])).toEqual(attempts);
  });

  test("a consumed event with no ids changes nothing", () => {
    const attempts = [attempt("s1")];
    expect(markConsumed(attempts, [])).toEqual(attempts);
  });

  test("an already-settled attempt is not reopened by a late consumed event", () => {
    // Guards the ordering hazard: the run ends, then a trailing event arrives. A `not-applied` row must
    // not flip to `applied` — the text was already returned to the composer.
    const attempts = [attempt("s1", "run-1", "not-applied")];
    expect(markConsumed(attempts, ["s1"])).toEqual(attempts);
  });

  test("settling one run does not touch another run's pending attempts", () => {
    const attempts = [attempt("s1", "run-1"), attempt("s2", "run-2")];
    const settled = settleRun(attempts, "run-1");
    expect(settled.unapplied.map((a) => a.id)).toEqual(["s1"]);
    const [first, second] = [settled.attempts[0], settled.attempts[1]];
    if (first === undefined || second === undefined) throw new Error("expected two attempts");
    expect(first.status).toBe("not-applied");
    expect(second.status).toBe("pending");
  });

  test("every status has distinct, honest wording", () => {
    const lines = (["pending", "applied", "not-applied", "rejected"] as const).map(steerStatusLine);
    expect(new Set(lines).size).toBe(4);
    // Only the applied line may assert uptake.
    expect(lines.filter((l) => l.includes("applied at the next step"))).toHaveLength(1);
    // The pending line must not promise application.
    expect(steerStatusLine("pending")).not.toContain("applied at the next step");
  });

  test("the rejected line says the text is coming back, not that it was lost", () => {
    expect(steerStatusLine("rejected")).toContain("back in the composer");
    expect(steerStatusLine("not-applied")).toContain("back in the composer");
  });
});
