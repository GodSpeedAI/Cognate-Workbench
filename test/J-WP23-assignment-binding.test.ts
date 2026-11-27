// WP-23 Workbench half. Invariants (checked over seeded generated assignments, not hand-picked ones):
//  I1 a session opened from an assignment carries exactly that assignment (id, episode, brief, budget) and
//     the id is assign:<case>:<step>:<n>:<k>.
//  I2 one run per assignment id: opening the same assignment twice resolves to the same run.
//  I3 a request with no assignment reaches startRun byte-identical (a Workbench without a case behaves as today).
//  I4 interrupt then resume keeps the id; only the operator drives the lifecycle, an agent never can (real policy).
//  I5 spend is kept per currency; spend above a numeric budget limit stops the run and is recorded, not dropped.
import { afterEach, describe, expect, test } from "bun:test";
import { type AgentDefinition, type Assignment, type Caller, type CaseContext, CURRENCIES, formatAssignmentId, type Currency } from "@godspeedai/cognate-runtime-api";
import { createRuntime, type Runtime } from "@godspeedai/cognate-runtime-bun";
import { assignmentControls, startAssignedRun } from "../src/assignments/assignmentBinding.ts";
import { buildActionPolicy } from "../src/server.ts";

const operator: Caller = { actor: { id: "operator", kind: "user" }, tenant: "local" };
const agent: Caller = { actor: { id: "wb-agent:x", kind: "agent" }, tenant: "local" };
const agents: AgentDefinition[] = [
  { id: "agent.gated", version: "1", run: async (_i, ctx) => { await ctx.step("a", () => 1); await new Promise((r) => setTimeout(r, 400)); return { ok: true }; } },
];
let runtime: Runtime | undefined;
afterEach(async () => { await runtime?.close(); runtime = undefined; });
const boot = async () => (runtime = await createRuntime({ store: ":memory:", agents, policy: { authorize: () => ({ allow: true, policyId: "t", reason: "ok" }) }, actions: buildActionPolicy() }));

// Seeded PRNG (mulberry32): deterministic generated inputs, no dependency.
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const word = (r: () => number) => Array.from({ length: 1 + Math.floor(r() * 8) }, () => "abcdefghijkl0123456789-_"[Math.floor(r() * 24)]).join("");
const UNITS: Record<Currency, string> = { time: "seconds", attention: "operator_minutes", money: "USD", risk: "class", recovery: "revert_steps" };
function generate(seed: number): { assignment: Assignment; context: CaseContext } {
  const r = rng(seed); const caseId = word(r), stepId = word(r), n = 1 + Math.floor(r() * 5), k = 1 + Math.floor(r() * 5);
  const assignment: Assignment = {
    assignment_id: formatAssignmentId({ caseId, stepId, n, k }), case_id: caseId, step_id: stepId, n, k,
    episode_ref: `episode:${caseId}:${stepId}:${n}@sha256:${"b".repeat(64)}`,
    brief: { instruction: word(r), adoptable_problem: word(r), domain_meaning: word(r), context_refs: [] },
    budget: CURRENCIES.map((currency) => ({ currency, limit: currency === "money" ? 10 : "unknown", unit: UNITS[currency] })),
    issued_at: "2026-11-17T00:00:00.000Z",
  };
  return { assignment, context: { worldRef: `world:fde-sop@sha256:${"a".repeat(64)}`, semanticRef: "fde-sop.work::Task", caseId, planItemId: stepId, role: "executor", kind: "evaluated" } };
}
const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);
const open = (rt: Runtime, a: Assignment, c: CaseContext) => startAssignedRun(rt.service, operator, { agent: "agent.gated", input: {}, idempotencyKey: "ignored", caseContext: c, assignment: a });

describe("WP-23 assignment binding", () => {
  test("I1 + I2 generated assignments bind exactly and open one run per id", async () => {
    const rt = await boot();
    for (const seed of SEEDS) {
      const { assignment, context } = generate(seed);
      const run = await open(rt, assignment, context);
      const view = await assignmentControls(rt.assignments, operator).view(run.runId);
      expect(view.assignment).toEqual(assignment);
      expect(view.assignment.assignment_id).toBe(`assign:${assignment.case_id}:${assignment.step_id}:${assignment.n}:${assignment.k}`);
      expect((await open(rt, assignment, context)).runId).toBe(run.runId);
    }
  });
  test("I3 no assignment: the request is forwarded unchanged", async () => {
    const seen: unknown[] = [];
    const req = { agent: "a", input: { x: 1 }, idempotencyKey: "k1", correlationId: "c" };
    await startAssignedRun({ startRun: async (_c, r) => (seen.push(r), {} as never) }, operator, req);
    expect(seen).toEqual([req]);
  });
  test("I4 interrupt/resume keep the id; an agent is refused by the real policy", async () => {
    const rt = await boot();
    for (const seed of SEEDS.slice(0, 4)) {
      const { assignment, context } = generate(seed);
      const run = await open(rt, assignment, context);
      const op = assignmentControls(rt.assignments, operator), ag = assignmentControls(rt.assignments, agent);
      const paused = await op.interrupt(run.runId, "operator pause", "1");
      expect(paused.status).toBe("interrupted");
      await expect(ag.resume(run.runId, "1")).rejects.toThrow();
      await expect(ag.interrupt(run.runId, "x", "2")).rejects.toThrow();
      const resumed = await op.resume(run.runId, "1");
      expect(resumed.status).toBe("resumed");
      expect(resumed.assignment.assignment_id).toBe(assignment.assignment_id);
    }
  });
  test("I5 spend per currency; overrun stops the run and is kept", async () => {
    const rt = await boot();
    const { assignment, context } = generate(SEEDS[0]!);
    const run = await open(rt, assignment, context);
    const op = assignmentControls(rt.assignments, operator);
    const v = await op.spend(run.runId, "money", 4, "a");
    expect(v.spend.find((s) => s.currency === "money")?.spent).toBe(4);
    expect(v.spend.find((s) => s.currency === "time")?.spent).not.toBe(4);
    const over = await op.spend(run.runId, "money", 7, "b");
    expect(over.status).toBe("failed");
    const after = await op.view(run.runId);
    expect(after.spend.find((s) => s.currency === "money")?.spent).toBe(11);
  });
});
