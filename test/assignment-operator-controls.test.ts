// WP-23 review hardening: the operator alone drives an assignment. Component-level (no server): the
// capability handlers run against recording fakes, so "refused before X" is observable as "X never ran".
import { describe, expect, test } from "bun:test";
import type { Caller } from "@godspeedai/cognate-runtime-api";
import { authorizeAssignmentAction } from "../src/assignments/assignmentBinding.ts";
import { assignmentControlsComponent } from "../src/capabilities/assignmentControls.ts";
import { sessionCaseAssignmentComponent } from "../src/capabilities/sessionCaseAssignment.ts";
import { approvedGateG3, standInHandoffSource } from "./handoff-fixture.ts";

type Handler = (raw: unknown, ctx: unknown) => Promise<unknown>;
const capture = (component: { activate(f: never): void }) => {
  const handlers = new Map<string, Handler>();
  component.activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h) } as never);
  return handlers;
};

const OPERATOR = { actor: { id: "operator", kind: "user" }, tenant: "local" } as const;
const ctxOf = (caller: { actor: { id: string; kind: string }; tenant: string }, runId?: string) => ({ ...caller, ...(runId ? { runId } : {}) });

describe("assignment controls belong to the operator alone", () => {
  test("the runtime policy refuses the system actor's spend", () => {
    const system: Caller = { actor: { id: "system", kind: "system" }, tenant: "local" } as Caller;
    expect(authorizeAssignmentAction({ action: "assignment.spend", caller: system })?.allow).toBe(false);
    expect(authorizeAssignmentAction({ action: "assignment.spend", caller: OPERATOR as unknown as Caller })?.allow).toBe(true);
  });

  test("interrupt, resume and spend are refused inside a run, and the view stays readable", async () => {
    const calls: string[] = [];
    const assignments = new Proxy({}, { get: (_t, name) => async () => { calls.push(String(name)); return {}; } });
    const handlers = capture(assignmentControlsComponent({ getAssignments: () => assignments as never, refs: {} }));
    const inRun = ctxOf(OPERATOR, "run-1");
    const inputs: Record<string, unknown> = {
      "assignment.interrupt": { runId: "r", reason: "x", token: "t" },
      "assignment.resume": { runId: "r", token: "t" },
      "assignment.spend": { runId: "r", currency: "money", amount: 1, token: "t" },
    };
    for (const [id, input] of Object.entries(inputs)) {
      await expect(handlers.get(id)!(input, inRun)).rejects.toThrow(/human decision|only a direct/);
    }
    expect(calls).toEqual([]);
    await handlers.get("assignment.view")!({ runId: "r" }, inRun);
    expect(calls).toEqual(["getAssignment"]);
    // Outside a run the operator still drives it.
    await handlers.get("assignment.spend")!(inputs["assignment.spend"], ctxOf(OPERATOR));
    expect(calls).toEqual(["getAssignment", "recordSpend"]);
  });
});

describe("case-assignment hand-off identifies the local operator before any lookup", () => {
  const FOREIGN = { actor: { id: "operator", kind: "user" }, tenant: "other" } as const;
  const OTHER_USER = { actor: { id: "someone-else", kind: "user" }, tenant: "local" } as const;
  function build() {
    const reads: string[] = [];
    const source = standInHandoffSource([approvedGateG3()]);
    const service = {
      readProjection: async () => { reads.push("sessions"); return { rows: [{ key: "local/known", value: { workspaceId: "w" } }] }; },
      startRun: async () => { reads.push("startRun"); return { runId: "r" }; },
    };
    const handlers = capture(sessionCaseAssignmentComponent({
      getService: () => service as never, systemCaller: { actor: { id: "system", kind: "system" }, tenant: "local" } as Caller,
      handoffSource: source, candidatesRef: undefined, handoffRef: undefined,
    }));
    return { handlers, reads, id: approvedGateG3().id };
  }

  test("a foreign-tenant or other user is refused with the same error whether or not the session exists", async () => {
    const { handlers, reads, id } = build();
    for (const who of [FOREIGN, OTHER_USER]) {
      const known = await handlers.get("session.caseAssignment.handoff")!({ sessionId: "known", candidateId: id }, ctxOf(who)).catch((e) => String(e));
      const unknown = await handlers.get("session.caseAssignment.handoff")!({ sessionId: "nope", candidateId: id }, ctxOf(who)).catch((e) => String(e));
      expect(known).toMatch(/Error/);
      expect(known).toBe(unknown);
      expect(known).not.toMatch(/unknown session/);
    }
    expect(reads).toEqual([]);
  });

  test("the candidates read requires the same operator identity", async () => {
    const { handlers } = build();
    for (const who of [FOREIGN, OTHER_USER]) {
      await expect(handlers.get("session.caseAssignment.candidates")!({}, ctxOf(who))).rejects.toThrow();
    }
    await expect(handlers.get("session.caseAssignment.candidates")!({}, ctxOf(OPERATOR, "run-1"))).rejects.toThrow();
    expect(await handlers.get("session.caseAssignment.candidates")!({}, ctxOf(OPERATOR))).toMatchObject({ available: true });
  });
});
