// Journey J-E-plan: `/plan <task> [[scenario:plan]]` enters plan mode, the mock model's `plan`
// script calls `todo_write` then `exit_plan_mode`, which opens a `plan-review` continuation
// (distinct from J-D-approval's `tool-approval` continuation — see `src/domain/planGate.ts` and
// `src/agents/agentCoding.ts`). Covers: todos progression (`plan.todos.updated`/`plans` projection),
// the review continuation opening with the plan's heading/markdown, and Approve (plan mode exits,
// the exact reflection text is fed back to the model, run completes, todos persist).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

async function configureAndSelect(client: Awaited<ReturnType<typeof bootApp>>["client"], mockPort: number, workspaceDir: string) {
  await client.invoke("model.configure", {
    providerId: "mock",
    baseURL: `http://127.0.0.1:${mockPort}/v1`,
    protocol: "openai-compatible",
    model: "mock-model-1",
    apiKey: "",
  });
  await mkdir(workspaceDir, { recursive: true });
  return (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
}

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-E-plan", () => {
  test("todos progression, review continuation, approve", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-plan");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "/plan make a plan now [[scenario:plan]]" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        // Plan mode turns on immediately (before the model is even called) — the `plans`
        // projection reflects `plan.mode.changed` as soon as it commits.
        await waitForCondition(async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "plans" })).rows;
          const row = rows.find((r) => r.key === sessionId);
          return Boolean(row && (row.value as { readonly on?: boolean }).on === true);
        });

        // `todo_write` lands next: the To-dos widget's data.
        await waitForCondition(async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "plans" })).rows;
          const row = rows.find((r) => r.key === sessionId);
          const todos = (row?.value as { readonly todos?: readonly { readonly status: string }[] } | undefined)?.todos ?? [];
          return todos.length === 2 && todos.some((t) => t.status === "in_progress") && todos.some((t) => t.status === "pending");
        });

        // `exit_plan_mode` opens a `plan-review` continuation (not `tool-approval`).
        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
          return continuations.some((c) => c.status === "OPEN" && c.type === "plan-review");
        });
        await waitForCondition(async () => (await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId })).status === "waiting");
        const pending = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
        expect(pending.status).toBe("waiting");
        const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
        const review = continuations.find((c) => c.status === "OPEN" && c.type === "plan-review")!;
        const payload = review.payload as { readonly heading?: string; readonly markdown?: string };
        expect(payload.heading).toBe("Update greeting");
        expect(payload.markdown).toContain("Read src/greet.ts");

        // The `plans` projection shows the review as pending before it's resolved.
        const rowsBeforeApprove = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "plans" })).rows;
        const stateBeforeApprove = rowsBeforeApprove.find((r) => r.key === sessionId)!.value as {
          readonly review?: { readonly status: string };
        };
        expect(stateBeforeApprove.review?.status).toBe("pending");

        // Approve: plan mode exits, the exact reflection text is fed back to the model, run completes.
        await client.resolveContinuation(review.id, "resume", { approved: true });
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        expect(output.text).toBe(
          "Tool result: Plan approved — plan mode exited; carry out the plan starting with your next step.",
        );

        const rowsAfter = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "plans" })).rows;
        const stateAfter = rowsAfter.find((r) => r.key === sessionId)!.value as unknown as {
          readonly on: boolean;
          readonly todos: readonly { readonly status: string }[];
          readonly review?: { readonly status: string };
        };
        expect(stateAfter.on).toBe(false);
        expect(stateAfter.todos).toHaveLength(2); // todos persist after plan mode exits
        expect(stateAfter.review?.status).toBe("approved");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("exit_plan_mode outside plan mode fails with the reference's exact error text", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-plan-not-on");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        // No leading "/plan " prefix this time, so plan mode is never entered — the same `plan`
        // script still calls `todo_write` then `exit_plan_mode`, but the latter must fail closed.
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "make a plan now [[scenario:plan]]" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        expect(output.text).toContain("Error: exit_plan_mode is only available in plan mode");

        const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
        expect(continuations.some((c) => c.type === "plan-review")).toBe(false);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });
});
