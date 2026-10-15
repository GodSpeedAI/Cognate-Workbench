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

for (const capacity of [1, 2, 4] as const) {
  test(`published runtime admits four independent Expert runs at capacity ${capacity}`, async () => {
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const experts: AgentDefinition[] = Array.from({ length: 4 }, (_, index) => ({
      id: `test.expert.worker-${index + 1}`,
      version: "1.0.0",
      async run(_input, ctx) {
        return ctx.step("observable-work", async () => {
          activeRuns++;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
          try {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return { expertId: ctx.agent, runId: ctx.runId };
          } finally {
            activeRuns--;
          }
        });
      },
    }));

    const runtime = await createRuntime({
      store: storeConfigFor(`/tmp/experts-runtime-${randomUUID()}`, "scheduling_test"),
      policy: allowTestRuns(),
      actions: { authorize: () => ({ allow: true, reason: "test runtime action" }) },
      agents: experts,
      tickMs: 1,
      ...(capacity === 1 ? {} : {
        execution: {
          maxConcurrentRuns: capacity,
          resourceKeys: (run) => [`expert:${run.agent}`],
        },
      }),
    });

    try {
      const started = await Promise.all(experts.map((expert) => runtime.service.startRun(caller, {
        agent: expert.id,
        input: { expertId: expert.id },
        idempotencyKey: randomUUID(),
        correlationId: `expert-run:${expert.id}`,
      })));

      await runtime.idle();
      expect(maxActiveRuns).toBe(capacity);

      for (let index = 0; index < started.length; index++) {
        const result = await runtime.service.getRun(caller, { runId: started[index]!.runId });
        expect(result.status).toBe("completed");
        expect(result.output).toEqual({ expertId: experts[index]!.id, runId: started[index]!.runId });
      }
    } finally {
      await runtime.close();
    }
  }, 20_000);
}

test("Expert scheduling retains a resumable correlated handoff with idempotent redelivery", async () => {
  const slowAgent: AgentDefinition = {
    id: "test.expert.slow",
    version: "1.0.0",
    async run(_input, ctx) {
      return ctx.step("observable-work", async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
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
    store: storeConfigFor(`/tmp/experts-runtime-${randomUUID()}`, "scheduling_handoff_test"),
    policy: allowTestRuns(),
    actions: { authorize: () => ({ allow: true, reason: "test runtime action" }) },
    agents: [slowAgent, parentAgent],
    tickMs: 1,
  });

  try {
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
