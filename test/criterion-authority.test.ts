// A criterion REVISION is a human act. `criterion.freeze` freezes the first criterion for a case
// without a restriction (the existing journeys rely on it), but replacing an existing criterion
// applies the rule `reviseCriterion` encodes: the actor must be a user. An agent's attempt is
// refused, records nothing, and the earlier criterion stays the one `case.derive` reports.
//
// The handlers run behind the real component against an in-memory event log. The dev-token door
// of the server always yields a `user` actor, so an agent actor can only be supplied at this level.
import { describe, expect, test } from "bun:test";
import { cognitiveComponent } from "../src/capabilities/cognitive.ts";
import { freezeCriterion } from "../src/cognitive/criterion.ts";

type Ctx = { actor: { id: string; kind: string }; tenant: string; runId?: string };
const USER: Ctx = { actor: { id: "operator", kind: "user" }, tenant: "local" };
const AGENT: Ctx = { actor: { id: "wb-agent:coding", kind: "agent" }, tenant: "local" };

function harness() {
  const log: { position: number; eventType: string; payload: Record<string, unknown> }[] = [];
  const service = {
    startRun: async (_caller: unknown, req: { input: { eventType: string; payload: Record<string, unknown> } }) => {
      log.push({ position: log.length + 1, eventType: req.input.eventType, payload: req.input.payload });
      return { runId: `r${log.length}` };
    },
    getRun: async () => ({ status: "completed" }),
    events: async function* () { for (const e of log) yield e; },
  };
  const handlers = new Map<string, (input: unknown, ctx: Ctx) => Promise<any>>();
  cognitiveComponent({ getService: () => service as never, systemCaller: { actor: { id: "system", kind: "system" }, tenant: "local" } as never, registry: {} as never })
    .activate({ dependencies: {}, provide: (c: { id: string }, h: (input: unknown, ctx: Ctx) => Promise<any>) => handlers.set(c.id, h) } as never);
  const call = (id: string, input: unknown, ctx: Ctx) => handlers.get(id)!(input, ctx);
  const effective = async (caseId: string) => (await call("case.derive", { caseId }, USER)).case.criterionHash as string | null;
  return { call, effective, log };
}

const spec = (requiredChecks: string[]) => ({ version: 1, requiredChecks, observed: ["x"], unobserved: [], guardrails: [], protectedInvariants: [] });

describe("criterion.freeze authority on revision", () => {
  test("an agent cannot replace a frozen criterion; the earlier one stays effective", async () => {
    const h = harness();
    await h.call("case.open", { caseId: "K1", desiredOutcome: "keep the criterion" }, USER);
    const first = await h.call("criterion.freeze", { caseId: "K1", spec: spec(["unit"]) }, USER);
    expect(await h.effective("K1")).toBe(first.criterionHash);
    const before = h.log.length;

    await expect(h.call("criterion.freeze", { caseId: "K1", spec: spec([]) }, AGENT)).rejects.toThrow("criterion revision requires human authority");
    expect(h.log.length).toBe(before);
    expect(await h.effective("K1")).toBe(first.criterionHash);
  });

  test("a user revision succeeds, becomes effective and carries the next version", async () => {
    const h = harness();
    await h.call("case.open", { caseId: "K2", desiredOutcome: "revise the criterion" }, USER);
    const first = await h.call("criterion.freeze", { caseId: "K2", spec: spec(["unit"]) }, USER);
    const second = await h.call("criterion.freeze", { caseId: "K2", spec: spec(["unit", "integration"]) }, USER);
    expect(second.criterionHash).not.toBe(first.criterionHash);
    expect(await h.effective("K2")).toBe(second.criterionHash);
    const frozen = h.log.filter((e) => e.eventType === "criterion.frozen").map((e) => e.payload.criterion as { version: number });
    expect(frozen.map((c) => c.version)).toEqual([1, 2]);
  });

  test("the first criterion of a case is frozen as before, and another case is not a revision", async () => {
    const h = harness();
    await h.call("case.open", { caseId: "K3", desiredOutcome: "first criterion" }, USER);
    await h.call("case.open", { caseId: "K4", desiredOutcome: "other case" }, USER);
    await h.call("criterion.freeze", { caseId: "K3", spec: spec(["unit"]) }, USER);
    const other = await h.call("criterion.freeze", { caseId: "K4", spec: spec(["unit"]) }, AGENT);
    expect(other.criterionHash).toBe(freezeCriterion(spec(["unit"])).criterionHash);
    expect(await h.effective("K4")).toBe(other.criterionHash);
  });
});
