import { describe, expect, test } from "bun:test";
import { createFocusStore, contextOf, surfaceFor, planInvoke, parseRef, actionsFor, type FocusEnv } from "../src/cognitive/focus.ts";
import { worldHash, worldManifest, WORLD_EVENTS } from "../src/cognitive/world.ts";
import { freezeCriterion } from "../src/cognitive/criterion.ts";
import { CASE_EVENTS } from "../src/cognitive/case.ts";
import { CASE_OPERATIONS } from "../src/capabilities/cognitive.ts";

const base = { semanticModelHash: "s", policyHash: "p", environmentHash: "e", files: { "a.ts": "h1" } };
const m1 = worldManifest(base);
const m2 = worldManifest({ ...base, files: { "a.ts": "h2" } });
const s0 = worldHash(m1);
const c1 = worldHash(m2);
const crit = freezeCriterion({ version: 1, requiredChecks: ["unit", "integration"], observed: ["x"], unobserved: [], guardrails: [], protectedInvariants: [] });
const ev = (position: number, eventType: string, payload: Record<string, unknown>) => ({ position, eventType, payload });
const events = [
  ev(1, CASE_EVENTS.opened, { caseId: "C17", desiredOutcome: "behavior preserved" }),
  ev(2, WORLD_EVENTS.baseline, { worldHash: s0, manifest: m1, caseId: "C17" }),
  ev(3, CASE_EVENTS.criterion, { caseId: "C17", criterion: crit }),
  ev(4, WORLD_EVENTS.candidate, { candidateHash: c1, parentWorldHash: s0, manifest: m2, caseId: "C17" }),
  ev(5, CASE_EVENTS.verification, { caseId: "C17", checkId: "unit", passed: false, exitCode: 1, tail: "expected 2 got 3", criterionHash: crit.criterionHash, candidateHash: c1 }),
  ev(6, CASE_EVENTS.verification, { caseId: "C17", checkId: "integration", passed: false, exitCode: 2, tail: "timeout in guest path", criterionHash: crit.criterionHash, candidateHash: c1 }),
  ev(7, "assistant.message", { text: "all tests passed" }),
];
const env: FocusEnv = { events, caseContext: { operations: CASE_OPERATIONS, facts: { availableCapabilities: new Set(["tool.edit", "tool.bash", "tool.read"]), recoveryAvailable: true, observerAvailable: true } } };

describe("shared attention (FocusContext / WebMCP semantics)", () => {
  test("semantic refs only: CSS selectors and DOM paths are not refs", () => {
    expect(parseRef("evidence:5")).toEqual({ kind: "evidence", id: "5" });
    expect(parseRef("div > .row:nth-child(2)")).toBeUndefined();
    expect(() => createFocusStore().set({ ref: "#row-5" as never })).toThrow();
  });

  test("'why did this fail?' resolves from the focused evidence, with the recorded failure and no narrative", () => {
    const n = contextOf({ ref: "evidence:5", caseId: "C17" }, env)!;
    expect(n.meaning).toBe("unit failed");
    expect(n.recorded).toMatchObject({ checkId: "unit", passed: false, exitCode: 1, tail: "expected 2 got 3" });
    expect(n.case).toBe("case:C17");
    expect(n.related).toContain(`candidate:${c1}`);
    expect(n.world).toMatch(/^candidate [0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(JSON.stringify(n)).not.toContain("all tests passed"); // agent narrative is not context
    expect(n.actions.map((a) => a.id)).toEqual(["inspect", "show_timeline", "compare_to_previous", "retry_verification"]);
  });

  test("focus switching A -> B updates agent-visible context deterministically", () => {
    const store = createFocusStore();
    const seen: string[] = [];
    store.subscribe((f) => seen.push(contextOf(f, env)?.meaning ?? "none"));
    store.set({ ref: "evidence:5", caseId: "C17" });
    store.set({ ref: "evidence:6", caseId: "C17" });
    store.set({ ref: "evidence:5", caseId: "C17" });
    store.set(undefined);
    expect(seen).toEqual(["unit failed", "integration failed", "unit failed", "none"]);
    expect(contextOf({ ref: "evidence:6", caseId: "C17" }, env)!.recorded).toMatchObject({ tail: "timeout in guest path" });
  });

  test("tool exposure follows the focused kind, not a permanent catalog", () => {
    expect(actionsFor("candidate").map((a) => a.id)).toEqual(["inspect_candidate", "compare_to_parent", "show_lineage"]);
    expect(actionsFor("affordance", { blocked: true }).map((a) => a.id)).toEqual(["explain_block", "show_requirements"]);
    expect(actionsFor("affordance", { primary: true }).map((a) => a.id)).toEqual(["inspect", "invoke_next_affordable_move"]);
    const n = contextOf({ ref: "affordance:settle", caseId: "C17" }, env)!;
    expect(n.meaning).toMatch(/Settle candidate is blocked: missing:verification.passed/);
    expect(n.actions.map((a) => a.id)).toEqual(["explain_block", "show_requirements"]);
  });

  test("agent-requested compare/timeline/inspect render Surfaces from recorded facts and mutate nothing", () => {
    const before = JSON.stringify(events);
    const cmp = surfaceFor({ op: "compare", left: `world:${s0}`, right: `candidate:${c1}` }, env, "C17");
    expect(cmp.blocks[0]).toMatchObject({ type: "compare" });
    expect((cmp.blocks[0] as any).left.items).toEqual([{ key: "file:a.ts", value: "h1" }]);
    const tl = surfaceFor({ op: "timeline", ref: "case:C17" }, env, "C17");
    const entries = (tl.blocks[0] as any).entries as { position: number; label: string }[];
    expect(entries.map((e) => e.position)).toEqual([...entries.map((e) => e.position)].sort((a, b) => a - b));
    expect(entries.map((e) => e.label)).toContain("unit FAILED");
    expect(entries.some((e) => e.label.includes("assistant"))).toBe(false);
    expect(surfaceFor({ op: "inspect", ref: "evidence:5" }, env, "C17").blocks[0]).toMatchObject({ type: "entity" });
    expect(JSON.stringify(events)).toBe(before);
  });

  test("view actions stay views; consequential follow-ups become Cognate capability requests, never direct mutation", () => {
    const f = { ref: "evidence:5" as const, caseId: "C17", candidateWorldHash: c1 };
    expect(planInvoke(f, "show_timeline", env)).toMatchObject({ kind: "view", op: { op: "timeline" } });
    const retry = planInvoke(f, "retry_verification", env);
    expect(retry).toEqual({ kind: "capability", request: { via: "cognate", capability: "verification.run", input: { caseId: "C17", candidateHash: c1 } } });
    expect(planInvoke(f, "world_settle", env)).toMatchObject({ kind: "refused" }); // not offered here: visibility != authority
    expect(planInvoke({ ref: `candidate:${c1}`, caseId: "C17" }, "compare_to_parent", env)).toMatchObject({ kind: "view", op: { op: "compare", left: `world:${s0}` } });
  });
});
