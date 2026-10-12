// Journey J-WB-economics (V-013): cost and provenance are visible per task trajectory. Unknown cost
// is shown as unknown, never as zero; deterministic work is never routed to an LLM.
import { describe, expect, test } from "bun:test";
import { budgetState, provenanceLine, rollupUsage, routeExecutor, type UsageRecord, type ExecutorProfile } from "../src/workbench/economics.ts";
import type { UsageRow } from "../src/workbench/state.ts";
import { bootApp, createTask, fullContract, inv, seedWorkspaceOnly, waitForRow, withTempHome } from "./wb-helpers.ts";

describe("J-WB-economics", () => {
  test("V-013: usage recorded per call rolls up to executor, provider, route, tokens, concurrency and budget state", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Costed task", fullContract(workspaceId));
        const rec = (r: Omit<UsageRecord, "taskId">) => inv(client, "usage.record", { record: { taskId, ...r } });
        await rec({ kind: "model", executor: "model:deepseek-chat", provider: "openai-compatible", billingRoute: "api-key", inputTokens: 800, outputTokens: 400, concurrent: 2 });
        await rec({ kind: "model", executor: "model:deepseek-chat", provider: "openai-compatible", billingRoute: "api-key", inputTokens: 40_000, outputTokens: 2_000, concurrent: 1 });
        await rec({ kind: "verification", executor: "tool:bun-test" });
        const row = await waitForRow<UsageRow>(app, `usage/${taskId}`, (u) => u.records.length === 3);

        const econ = rollupUsage(taskId, row.records);
        expect(econ.totalTokens).toBe(43_200);
        expect(econ.modelCalls).toBe(2);
        expect(econ.verificationCalls).toBe(1);
        expect(econ.peakConcurrency).toBe(2);
        expect(econ.costUsd).toBeUndefined(); // the provider reported no cost: unknown, not zero
        const line = provenanceLine(econ);
        for (const part of ["model:deepseek-chat", "openai-compatible", "api-key", "peak 2", "cost n/a"]) expect(line).toContain(part);

        // The contract's budget (50k tokens, concurrency 2) is compared with real usage: 43.2k is 86% => near limit.
        const budget = budgetState({ maxTokens: 50_000, maxConcurrency: 2 }, econ);
        expect(budget.level).toBe("warn");
        expect(budget.lines.find((l) => l.metric === "tokens")?.level).toBe("warn");
        expect(budget.lines.find((l) => l.metric === "concurrency")?.level).toBe("warn"); // 2 of 2 is at 100 percent, not over

        // Routing follows decision leverage and never hands deterministic work to an LLM.
        const profiles: ExecutorProfile[] = [
          { id: "opus", tier: "strong", costPer1kTokens: 0.9 },
          { id: "flash", tier: "cheap", costPer1kTokens: 0.1 },
        ];
        expect(routeExecutor("architecture", profiles).executor?.id).toBe("opus");
        expect(routeExecutor("bounded-implementation", profiles).executor?.id).toBe("flash");
        const det = routeExecutor("test", profiles);
        expect(det.executor).toBeUndefined();
        expect(det.reason).toMatch(/no deterministic executor/);
        expect(routeExecutor("test", [...profiles, { id: "bun-test", tier: "deterministic" }]).executor?.id).toBe("bun-test");
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
