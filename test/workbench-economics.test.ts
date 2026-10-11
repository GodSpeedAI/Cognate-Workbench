import { describe, test, expect } from "bun:test";
import {
  rollupUsage,
  budgetState,
  routeExecutor,
  costToVerifiedAcceptance,
  provenanceLine,
  type UsageRecord,
  type ExecutorProfile,
  type BudgetLevel,
} from "../src/workbench/economics.ts";

describe("rollupUsage", () => {
  test("groups executors by (executor, provider, billingRoute) in first-seen order", () => {
    const records: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        provider: "openai-api",
        billingRoute: "api-key",
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        provider: "openai-api",
        billingRoute: "api-key",
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        taskId: "task1",
        kind: "tool",
        executor: "bun-test",
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        taskId: "task1",
        kind: "model",
        executor: "deepseek",
        provider: "deepseek",
        billingRoute: "api-key",
        inputTokens: 200,
        outputTokens: 100,
      },
    ];

    const econ = rollupUsage("task1", records);

    expect(econ.taskId).toBe("task1");
    expect(econ.executors).toHaveLength(3);
    expect(econ.executors[0]).toEqual({
      executor: "openai",
      provider: "openai-api",
      billingRoute: "api-key",
      calls: 2,
    });
    expect(econ.executors[1]).toEqual({
      executor: "bun-test",
      calls: 1,
    });
    expect(econ.executors[2]).toEqual({
      executor: "deepseek",
      provider: "deepseek",
      billingRoute: "api-key",
      calls: 1,
    });
  });

  test("filters to only records with matching taskId", () => {
    const records: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        taskId: "task2",
        kind: "model",
        executor: "deepseek",
        inputTokens: 200,
        outputTokens: 100,
      },
    ];

    const econ = rollupUsage("task1", records);

    expect(econ.modelCalls).toBe(1);
    expect(econ.inputTokens).toBe(100);
    expect(econ.outputTokens).toBe(50);
  });

  test("handles undefined cost: sum when at least one record defines it, undefined otherwise", () => {
    const recordsWithCost: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        costUsd: 0.05,
      },
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        costUsd: 0.03,
      },
    ];

    const econWithCost = rollupUsage("task1", recordsWithCost);
    expect(econWithCost.costUsd).toBe(0.08);

    const recordsNoCost: UsageRecord[] = [
      { taskId: "task1", kind: "model", executor: "openai" },
      { taskId: "task1", kind: "model", executor: "openai" },
    ];

    const econNoCost = rollupUsage("task1", recordsNoCost);
    expect(econNoCost.costUsd).toBeUndefined();

    const recordsMixed: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        costUsd: 0.05,
      },
      { taskId: "task1", kind: "model", executor: "openai" },
    ];

    const econMixed = rollupUsage("task1", recordsMixed);
    expect(econMixed.costUsd).toBe(0.05);
  });

  test("calculates peakConcurrency as max(concurrent ?? 1) or 0 if no records", () => {
    const records: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
        concurrent: 3,
      },
      {
        taskId: "task1",
        kind: "tool",
        executor: "bun-test",
        concurrent: 2,
      },
      { taskId: "task1", kind: "model", executor: "openai" },
    ];

    const econ = rollupUsage("task1", records);
    expect(econ.peakConcurrency).toBe(3);

    const noRecords = rollupUsage("task1", []);
    expect(noRecords.peakConcurrency).toBe(0);
  });

  test("counts by kind", () => {
    const records: UsageRecord[] = [
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
      },
      {
        taskId: "task1",
        kind: "model",
        executor: "openai",
      },
      {
        taskId: "task1",
        kind: "tool",
        executor: "bun-test",
      },
      {
        taskId: "task1",
        kind: "verification",
        executor: "human",
      },
      {
        taskId: "task1",
        kind: "retry",
        executor: "openai",
      },
    ];

    const econ = rollupUsage("task1", records);
    expect(econ.modelCalls).toBe(2);
    expect(econ.toolCalls).toBe(1);
    expect(econ.verificationCalls).toBe(1);
    expect(econ.retries).toBe(1);
  });
});

describe("budgetState", () => {
  test("reports lines only for defined limits", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 500,
      outputTokens: 500,
      totalTokens: 1000,
      modelCalls: 1,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.05,
      peakConcurrency: 2,
    };

    const budget = { maxTokens: 5000 };
    const state = budgetState(budget, econ);

    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]!.metric).toBe("tokens");
  });

  test("warn when used >= 80% of limit, exceeded when used > limit", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 8000,
      modelCalls: 0,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: undefined,
      peakConcurrency: 0,
    };

    const budget1 = { maxTokens: 10000 };
    const state1 = budgetState(budget1, econ);
    expect(state1.lines[0]!.level).toBe("warn");

    const econ2 = { ...econ, totalTokens: 11000 };
    const state2 = budgetState(budget1, econ2);
    expect(state2.lines[0]!.level).toBe("exceeded");

    const econ3 = { ...econ, totalTokens: 5000 };
    const state3 = budgetState(budget1, econ3);
    expect(state3.lines[0]!.level).toBe("ok");
  });

  test("cost used undefined => that line level 'ok' (unknown)", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: undefined,
      peakConcurrency: 0,
    };

    const budget = { maxCostUsd: 1.0 };
    const state = budgetState(budget, econ);

    expect(state.lines[0]!.used).toBeUndefined();
    expect(state.lines[0]!.level).toBe("ok");
  });

  test("level = worst line", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 8000,
      modelCalls: 0,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.5,
      peakConcurrency: 0,
    };

    const budget = { maxTokens: 10000, maxCostUsd: 0.4 };
    const state = budgetState(budget, econ);

    expect(state.level).toBe("exceeded");
  });
});

describe("routeExecutor", () => {
  test("architecture/domain-interpretation/design-direction/decomposition/integration/review -> tier strong", () => {
    const profiles: ExecutorProfile[] = [
      { id: "strong1", tier: "strong" },
      { id: "cheap1", tier: "cheap" },
    ];

    const strongTasks = [
      "architecture",
      "domain-interpretation",
      "design-direction",
      "decomposition",
      "integration",
      "review",
    ];

    for (const task of strongTasks) {
      const result = routeExecutor(
        task as Parameters<typeof routeExecutor>[0],
        profiles
      );
      expect(result.executor?.tier).toBe("strong");
    }
  });

  test("bounded-implementation/repetitive-transformation -> cheap, fall back to strong if no cheap", () => {
    const strongOnly: ExecutorProfile[] = [{ id: "strong1", tier: "strong" }];

    const result1 = routeExecutor("bounded-implementation", strongOnly);
    expect(result1.executor?.id).toBe("strong1");

    const bothTiers: ExecutorProfile[] = [
      { id: "cheap1", tier: "cheap" },
      { id: "strong1", tier: "strong" },
    ];

    const result2 = routeExecutor("bounded-implementation", bothTiers);
    expect(result2.executor?.id).toBe("cheap1");
  });

  test("test/build/lint/file-hash/browser-journey -> deterministic, NEVER fall back to LLM", () => {
    const noDetProfiles: ExecutorProfile[] = [
      { id: "strong1", tier: "strong" },
    ];

    const result = routeExecutor("test", noDetProfiles);
    expect(result.executor).toBeUndefined();
    expect(result.reason).toBe("no deterministic executor available");
  });

  test("pick lowest costPer1kTokens (undefined sorts last), ties by id", () => {
    const profiles: ExecutorProfile[] = [
      { id: "expensive", tier: "strong", costPer1kTokens: 0.02 },
      { id: "cheap", tier: "strong", costPer1kTokens: 0.01 },
      { id: "free", tier: "strong" },
    ];

    const result = routeExecutor("architecture", profiles);
    expect(result.executor?.id).toBe("cheap");

    const noUndefProfiles: ExecutorProfile[] = [
      { id: "b", tier: "strong", costPer1kTokens: 0.01 },
      { id: "a", tier: "strong", costPer1kTokens: 0.01 },
    ];

    const result2 = routeExecutor("architecture", noUndefProfiles);
    expect(result2.executor?.id).toBe("a");
  });
});

describe("costToVerifiedAcceptance", () => {
  test("undefined if econ.costUsd undefined", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: undefined,
      peakConcurrency: 0,
    };

    const result = costToVerifiedAcceptance(econ, {});
    expect(result).toBeUndefined();
  });

  test("sum econ.costUsd + rework + verification", () => {
    const econ = {
      taskId: "task1",
      executors: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.5,
      peakConcurrency: 0,
    };

    const result = costToVerifiedAcceptance(econ, {
      reworkCostUsd: 0.2,
      verificationCostUsd: 0.1,
    });
    expect(result).toBeCloseTo(0.8, 5);
  });
});

describe("provenanceLine", () => {
  test("contains executor, provider, route, usage, concurrency", () => {
    const econ = {
      taskId: "task1",
      executors: [
        {
          executor: "mock-model",
          provider: "openai-compatible",
          billingRoute: "api-key",
          calls: 3,
        },
      ],
      inputTokens: 1200,
      outputTokens: 100,
      totalTokens: 1300,
      modelCalls: 3,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.04,
      peakConcurrency: 2,
    };

    const line = provenanceLine(econ);
    expect(line).toContain("mock-model");
    expect(line).toContain("openai-compatible");
    expect(line).toContain("api-key");
    expect(line).toContain("1.3k tok");
    expect(line).toContain("3 calls");
    expect(line).toContain("peak 2×");
    expect(line).toContain("$0.04");
  });

  test("V-013 format: 'executor via provider (route) · tokens · calls · peak · cost'", () => {
    const econ = {
      taskId: "task1",
      executors: [
        {
          executor: "deepseek",
          provider: "deepseek-api",
          billingRoute: "key",
          calls: 1,
        },
      ],
      inputTokens: 500,
      outputTokens: 500,
      totalTokens: 1000,
      modelCalls: 1,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.05,
      peakConcurrency: 1,
    };

    const line = provenanceLine(econ);
    expect(line).toMatch(
      /deepseek via deepseek-api \(route: key\) · \d+(\.\d)?k tok · 1 calls · peak 1× · \$0\.05/
    );
  });

  test("cost n/a when cost undefined", () => {
    const econ = {
      taskId: "task1",
      executors: [
        { executor: "mock-model", provider: "custom", calls: 1 },
      ],
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      modelCalls: 1,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: undefined,
      peakConcurrency: 1,
    };

    const line = provenanceLine(econ);
    expect(line).toContain("cost n/a");
  });

  test("missing provider/route omitted", () => {
    const econ = {
      taskId: "task1",
      executors: [{ executor: "local-executor", calls: 1 }],
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      modelCalls: 1,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: undefined,
      peakConcurrency: 1,
    };

    const line = provenanceLine(econ);
    expect(line).toContain("local-executor");
    expect(line).not.toContain("via");
    expect(line).not.toContain("route:");
  });

  test("multiple executors joined with ' + '", () => {
    const econ = {
      taskId: "task1",
      executors: [
        {
          executor: "openai",
          provider: "openai-api",
          billingRoute: "key",
          calls: 1,
        },
        { executor: "deepseek", provider: "deepseek-api", calls: 1 },
      ],
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      modelCalls: 2,
      toolCalls: 0,
      verificationCalls: 0,
      retries: 0,
      costUsd: 0.08,
      peakConcurrency: 1,
    };

    const line = provenanceLine(econ);
    expect(line).toContain(
      "openai via openai-api (route: key) + deepseek via deepseek-api"
    );
  });
});
