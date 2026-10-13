import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { rulePolicy } from "@godspeedai/cognate-kernel-api";
import { createRuntime } from "@godspeedai/cognate-runtime-bun";
import type { AgentDefinition, Caller } from "@godspeedai/cognate-runtime-api";
import { storeConfigFor } from "../src/store.ts";

const caller: Caller = { tenant: "experts-runtime-test", actor: { id: "runtime-test", kind: "system" } };

function allowTestRuns() {
  return rulePolicy("experts-runtime-test", [() => ({ allow: true, policyId: "experts-runtime-test", reason: "test runtime capability" })]);
}

async function waitForStatus(runtime: Awaited<ReturnType<typeof createRuntime>>, runId: string, statuses: readonly string[]) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const run = await runtime.service.getRun(caller, { runId });
    if (statuses.includes(run.status)) return run;
    if (Date.now() >= deadline) throw new Error(`run ${runId} did not reach ${statuses.join("/")}; current status: ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("expert scheduling uses serialized durable runs and a resumable correlated handoff", async () => {
  let activeRuns = 0;
  let maxActiveRuns = 0;
  const slowAgent: AgentDefinition = {
    id: "test.expert.slow",
    version: "1.0.0",
    async run(_input, ctx) {
      return ctx.step("observable-work", async () => {
        activeRuns++;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeRuns--;
        return { completedBy: ctx.agent, runId: ctx.runId };
      });
    },
  };
  const parentAgent: AgentDefinition = {
    id: "test.expert.parent",
    version: "1.0.0",
    async run(_input, ctx) {
      const returned = await ctx.waitFor("assignment-return", {
        type: "expert-assignment-return",
        condition: { kind: "run_completion" },
        payload: { assignmentId: "assignment-1" },
      });
      return { assignmentId: "assignment-1", returned };
    },
  };

  const runtime = await createRuntime({
    store: storeConfigFor(`/tmp/experts-runtime-${randomUUID()}`, "scheduling_test"),
    policy: allowTestRuns(),
    actions: { authorize: () => ({ allow: true, reason: "test runtime action" }) },
    agents: [slowAgent, parentAgent],
    tickMs: 1,
  });

  try {
    const first = await runtime.service.startRun(caller, {
      agent: slowAgent.id,
      input: { expertId: "expert-1" },
      idempotencyKey: randomUUID(),
      correlationId: "expert-run:first",
    });
    const second = await runtime.service.startRun(caller, {
      agent: slowAgent.id,
      input: { expertId: "expert-2" },
      idempotencyKey: randomUUID(),
      correlationId: "expert-run:second",
    });
    expect((await waitForStatus(runtime, first.runId, ["completed", "failed"])).status).toBe("completed");
    expect((await waitForStatus(runtime, second.runId, ["completed", "failed"])).status).toBe("completed");
    expect(maxActiveRuns).toBe(1);

    const parent = await runtime.service.startRun(caller, {
      agent: parentAgent.id,
      input: { teamId: "team-1" },
      idempotencyKey: randomUUID(),
      correlationId: "team-conversation:team-1",
    });
    expect((await waitForStatus(runtime, parent.runId, ["waiting", "failed"])).status).toBe("waiting");

    const child = await runtime.service.startRun(caller, {
      agent: slowAgent.id,
      input: { assignmentId: "assignment-1" },
      idempotencyKey: randomUUID(),
      correlationId: `expert-assignment:${parent.runId}:assignment-1`,
    });
    const childResult = await waitForStatus(runtime, child.runId, ["completed", "failed"]);
    expect(childResult.status).toBe("completed");

    const resolution = { assignmentId: "assignment-1", childRunId: child.runId, output: childResult.output };
    const continuationId = `${parent.runId}.wait.assignment-return`;
    const firstDelivery = await runtime.service.resolveContinuation(caller, {
      continuationId,
      action: "resume",
      input: resolution,
      idempotencyKey: `handoff:${child.runId}`,
    });
    const redelivery = await runtime.service.resolveContinuation(caller, {
      continuationId,
      action: "resume",
      input: resolution,
      idempotencyKey: `handoff:${child.runId}`,
    });
    expect(firstDelivery.outcome).toBe("transitioned");
    expect(redelivery.outcome).toBe("duplicate");

    const resumedParent = await waitForStatus(runtime, parent.runId, ["completed", "failed"]);
    expect(resumedParent.status).toBe("completed");
    expect((resumedParent.output as { returned: typeof resolution }).returned).toEqual(resolution);
  } finally {
    await runtime.close();
  }
}, 20_000);
