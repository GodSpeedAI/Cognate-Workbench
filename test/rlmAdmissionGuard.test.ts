// The admission guard binds a child run to the exact input the governed rlm.invoke derived (SEA-Forge #114, N1/N3).
import { describe, expect, test } from "bun:test";
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import { rlmAdmissionGuard } from "../src/capabilities/rlmAdmissionGuard.ts";

const input = (over: Record<string, unknown> = {}) => ({
  invocationId: "p:rlm:r1", providerId: "cp", runId: "p", depth: 1, maxDepth: 2,
  task: { purpose: "look", acceptance: ["report"], contextRefs: ["assignment"], contextDigest: "a".repeat(64) },
  authority: { tools: ["read"], mode: "read-only" }, budget: { currency: "money", limit: 0.5, reservationRef: "expert-budget:a:1" }, ...over,
});

function harness() {
  const guard = rlmAdmissionGuard();
  const runs: string[] = [];
  const agent: AgentDefinition = { id: "agent.rlm", version: "1", async run(_in, ctx) { runs.push(ctx.runId); return { ok: true } as never; } };
  const wrapped = guard.wrap(agent);
  const attempt = (i: unknown, runId: string) => wrapped.run(i as never, { runId } as never);
  const refused = async (i: unknown, runId: string): Promise<RlmRefusedError> => { try { await attempt(i, runId); } catch (e) { if (e instanceof RlmRefusedError) return e; throw e; } throw new Error("expected a refusal"); };
  return { guard, runs, attempt, refused };
}

describe("rlmAdmissionGuard", () => {
  test("the exact admitted input runs; the same run may re-enter (Cognate re-runs a child on resume)", async () => {
    const h = harness();
    h.guard.admit({ invocationId: "p:rlm:r1", input: input() });
    await h.attempt(input(), "child-1");
    await h.attempt(input(), "child-1");
    expect(h.runs).toEqual(["child-1", "child-1"]);
  });

  test("an input that differs in any field is refused and the agent never runs", async () => {
    const h = harness();
    h.guard.admit({ invocationId: "p:rlm:r1", input: input() });
    const variants = [
      input({ authority: { tools: ["read", "bash"], mode: "read-only" } }),
      input({ authority: { tools: ["read"], mode: "read-write" } }),
      input({ budget: { currency: "money", limit: 5, reservationRef: "expert-budget:a:1" } }),
      input({ task: { purpose: "something else", acceptance: [], contextRefs: [], contextDigest: "a".repeat(64) } }),
      input({ depth: 0 }), input({ providerId: "other" }), input({ runId: "elsewhere" }), { ...input(), extra: true },
    ];
    for (const v of variants) expect((await h.refused(v, "forged")).code).toBe("rlm-posture-refused");
    expect(h.runs).toEqual([]);
    await h.attempt(input(), "child-1"); // the genuine admission is still usable afterwards
    expect(h.runs).toEqual(["child-1"]);
  });

  test("an admission is consumed by the first run: a second run with identical input is refused", async () => {
    const h = harness();
    h.guard.admit({ invocationId: "p:rlm:r1", input: input() });
    await h.attempt(input(), "child-1");
    const e = await h.refused(input(), "replay");
    expect(e.reason).toContain("already used");
    expect(h.runs).toEqual(["child-1"]);
  });

  test("an unadmitted invocation is refused and the record is bounded", async () => {
    const h = harness();
    expect((await h.refused(input(), "x")).code).toBe("rlm-posture-refused");
    for (let i = 0; i < 300; i++) h.guard.admit({ invocationId: `p:rlm:${i}`, input: input({ invocationId: `p:rlm:${i}` }) });
    expect((await h.refused(input({ invocationId: "p:rlm:0" }), "old")).code).toBe("rlm-posture-refused"); // pruned
    await h.attempt(input({ invocationId: "p:rlm:299" }), "new");
  });
});
