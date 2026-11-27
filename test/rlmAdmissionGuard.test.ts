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

const PARENT = "wb-agent:product-manager";
const admission = (over: Record<string, unknown> = {}) => ({ invocationId: "p:rlm:r1", input: input(), principal: PARENT, ...over });

function harness(options: Parameters<typeof rlmAdmissionGuard>[0] = {}) {
  const guard = rlmAdmissionGuard(options);
  const runs: string[] = [];
  const agent: AgentDefinition = { id: "agent.rlm", version: "1", async run(_in, ctx) { runs.push(ctx.runId); return { ok: true } as never; } };
  const wrapped = guard.wrap(agent);
  const attempt = (i: unknown, runId: string, actor: { id: string; kind: string } = { id: PARENT, kind: "agent" }) => wrapped.run(i as never, { runId, actor } as never);
  const refused = async (i: unknown, runId: string, actor?: { id: string; kind: string }): Promise<RlmRefusedError> => { try { await attempt(i, runId, actor); } catch (e) { if (e instanceof RlmRefusedError) return e; throw e; } throw new Error("expected a refusal"); };
  return { guard, runs, attempt, refused };
}

describe("rlmAdmissionGuard", () => {
  test("the exact admitted input runs; the same run may re-enter (Cognate re-runs a child on resume)", async () => {
    const h = harness();
    h.guard.admit(admission());
    await h.attempt(input(), "child-1");
    await h.attempt(input(), "child-1");
    expect(h.runs).toEqual(["child-1", "child-1"]);
  });

  test("an input that differs in any field is refused and the agent never runs", async () => {
    const h = harness();
    h.guard.admit(admission());
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
    h.guard.admit(admission());
    await h.attempt(input(), "child-1");
    const e = await h.refused(input(), "replay");
    expect(e.reason).toContain("already used");
    expect(h.runs).toEqual(["child-1"]);
  });

  test("an unadmitted invocation is refused and the record is bounded", async () => {
    const h = harness();
    expect((await h.refused(input(), "x")).code).toBe("rlm-posture-refused");
    for (let i = 0; i < 300; i++) h.guard.admit(admission({ invocationId: `p:rlm:${i}`, input: input({ invocationId: `p:rlm:${i}` }) }));
    expect((await h.refused(input({ invocationId: "p:rlm:0" }), "old")).code).toBe("rlm-posture-refused"); // pruned
    await h.attempt(input({ invocationId: "p:rlm:299" }), "new");
  });

  test("A1: a repeat admission does not re-arm a spent one; a different input does", async () => {
    const h = harness();
    h.guard.admit(admission());
    await h.attempt(input(), "child-1");
    h.guard.admit(admission());                                  // rlm.invoke repeated for the same invocation
    expect((await h.refused(input(), "thief")).reason).toContain("already used");
    await h.attempt(input(), "child-1");                          // the legitimate child may still re-enter on resume
    expect(h.runs).toEqual(["child-1", "child-1"]);
  });

  test("A1: a dispatch that fails disarms what it armed, but never a spent or pre-existing admission", async () => {
    const h = harness();
    const disarm = h.guard.admit(admission());
    disarm();                                                     // inner threw
    expect((await h.refused(input(), "late")).code).toBe("rlm-posture-refused");
    h.guard.admit(admission());
    await h.attempt(input(), "child-1");
    const noop = h.guard.admit(admission());                      // a repeat that then fails
    noop();
    await h.attempt(input(), "child-1");                          // the real child's admission survives
    expect(h.runs).toEqual(["child-1", "child-1"]);
    const fresh = harness();
    const armed = fresh.guard.admit(admission());
    await fresh.attempt(input(), "c");
    armed();                                                      // too late: consumed entries are never disarmed
    await fresh.attempt(input(), "c");
  });

  test("A1: an identical-input run started as another principal, or not as an agent, is refused and the legitimate child still runs", async () => {
    const h = harness();
    h.guard.admit(admission());
    expect((await h.refused(input(), "other-principal", { id: "wb-agent:builder", kind: "agent" })).reason).toContain("parent run's principal");
    expect((await h.refused(input(), "operator", { id: "local-operator", kind: "user" })).code).toBe("rlm-posture-refused");
    expect((await h.refused(input(), "spoof-kind", { id: PARENT, kind: "user" })).code).toBe("rlm-posture-refused");
    expect(h.runs).toEqual([]);
    await h.attempt(input(), "child-1");
    expect(h.runs).toEqual(["child-1"]);
  });

  test("A1: an unclaimed admission expires; a claimed one keeps working for its run", async () => {
    let clock = 1_000;
    const h = harness({ ttlMs: 60_000, now: () => clock });
    h.guard.admit(admission());
    h.guard.admit(admission({ invocationId: "p:rlm:r2", input: input({ invocationId: "p:rlm:r2" }) }));
    await h.attempt(input({ invocationId: "p:rlm:r2" }), "child-2");
    clock += 61_000;
    expect((await h.refused(input(), "late")).reason).toContain("expired");
    await h.attempt(input({ invocationId: "p:rlm:r2" }), "child-2"); // consumed entries do not expire (a resume may be hours later)
    h.guard.admit(admission());                                       // an expired entry may be re-admitted by a real dispatch
    await h.attempt(input(), "child-3");
  });
});
