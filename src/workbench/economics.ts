import type { Budget } from "./types.ts";

export interface UsageRecord {
  readonly taskId: string;
  readonly kind: "model" | "tool" | "verification" | "retry";
  readonly executor: string;
  readonly provider?: string;
  readonly billingRoute?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly concurrent?: number;
}

export interface TaskEconomics {
  readonly taskId: string;
  readonly executors: readonly {
    readonly executor: string;
    readonly provider?: string;
    readonly billingRoute?: string;
    readonly calls: number;
  }[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly verificationCalls: number;
  readonly retries: number;
  readonly costUsd: number | undefined;
  readonly peakConcurrency: number;
}

export function rollupUsage(
  taskId: string,
  records: readonly UsageRecord[]
): TaskEconomics {
  // Filter to only records with matching taskId
  const filtered = records.filter((r) => r.taskId === taskId);

  // Group executors by (executor, provider, billingRoute) in first-seen order
  const executorMap = new Map<
    string,
    { executor: string; provider?: string; billingRoute?: string; calls: number }
  >();
  const executorOrder: string[] = [];

  for (const record of filtered) {
    const key = `${record.executor}|${record.provider ?? ""}|${
      record.billingRoute ?? ""
    }`;
    if (!executorMap.has(key)) {
      executorMap.set(key, {
        executor: record.executor,
        provider: record.provider,
        billingRoute: record.billingRoute,
        calls: 0,
      });
      executorOrder.push(key);
    }
    const entry = executorMap.get(key)!;
    entry.calls += 1;
  }

  // Build executors array in first-seen order
  const executors = executorOrder.map((key) => executorMap.get(key)!);

  // Sum tokens and costs
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined = undefined;
  let hasCost = false;

  for (const record of filtered) {
    if (record.inputTokens !== undefined) {
      inputTokens += record.inputTokens;
    }
    if (record.outputTokens !== undefined) {
      outputTokens += record.outputTokens;
    }
    if (record.costUsd !== undefined) {
      if (costUsd === undefined) {
        costUsd = 0;
      }
      costUsd += record.costUsd;
      hasCost = true;
    }
  }

  // Cost unknown is NOT zero
  if (!hasCost) {
    costUsd = undefined;
  }

  const totalTokens = inputTokens + outputTokens;

  // Count by kind
  let modelCalls = 0;
  let toolCalls = 0;
  let verificationCalls = 0;
  let retries = 0;

  for (const record of filtered) {
    switch (record.kind) {
      case "model":
        modelCalls += 1;
        break;
      case "tool":
        toolCalls += 1;
        break;
      case "verification":
        verificationCalls += 1;
        break;
      case "retry":
        retries += 1;
        break;
    }
  }

  // Peak concurrency: max(concurrent ?? 1) or 0 if no records
  let peakConcurrency = 0;
  for (const record of filtered) {
    const concurrent = record.concurrent ?? 1;
    peakConcurrency = Math.max(peakConcurrency, concurrent);
  }

  return {
    taskId,
    executors,
    inputTokens,
    outputTokens,
    totalTokens,
    modelCalls,
    toolCalls,
    verificationCalls,
    retries,
    costUsd,
    peakConcurrency,
  };
}

export type BudgetLevel = "ok" | "warn" | "exceeded";

export interface BudgetState {
  readonly level: BudgetLevel;
  readonly lines: readonly {
    readonly metric: "tokens" | "cost" | "concurrency" | "time";
    readonly used: number | undefined;
    readonly limit: number;
    readonly level: BudgetLevel;
  }[];
}

export function budgetState(
  budget: Budget | undefined,
  econ: TaskEconomics,
  elapsedMs?: number
): BudgetState {
  const lines: Array<{
    readonly metric: "tokens" | "cost" | "concurrency" | "time";
    readonly used: number | undefined;
    readonly limit: number;
    readonly level: BudgetLevel;
  }> = [];

  let worstLevel: BudgetLevel = "ok";

  if (budget?.maxTokens !== undefined) {
    const used = econ.totalTokens;
    let level: BudgetLevel = "ok";
    if (used > budget.maxTokens) {
      level = "exceeded";
    } else if (used >= budget.maxTokens * 0.8) {
      level = "warn";
    }
    lines.push({ metric: "tokens", used, limit: budget.maxTokens, level });
    if (level !== "ok") {
      worstLevel = level;
    }
  }

  if (budget?.maxCostUsd !== undefined) {
    const used = econ.costUsd;
    let level: BudgetLevel = "ok";
    if (used === undefined) {
      // Unknown cost is "ok" (not zero)
      level = "ok";
    } else if (used > budget.maxCostUsd) {
      level = "exceeded";
    } else if (used >= budget.maxCostUsd * 0.8) {
      level = "warn";
    }
    lines.push({ metric: "cost", used, limit: budget.maxCostUsd, level });
    if (level !== "ok" && level !== "exceeded") {
      if (worstLevel === "ok") {
        worstLevel = level;
      }
    } else if (level === "exceeded") {
      worstLevel = "exceeded";
    }
  }

  if (budget?.maxConcurrency !== undefined) {
    const used = econ.peakConcurrency;
    let level: BudgetLevel = "ok";
    if (used > budget.maxConcurrency) {
      level = "exceeded";
    } else if (used >= budget.maxConcurrency * 0.8) {
      level = "warn";
    }
    lines.push({
      metric: "concurrency",
      used,
      limit: budget.maxConcurrency,
      level,
    });
    if (level !== "ok") {
      worstLevel = level;
    }
  }

  if (budget?.maxMs !== undefined && elapsedMs !== undefined) {
    const used = elapsedMs;
    let level: BudgetLevel = "ok";
    if (used > budget.maxMs) {
      level = "exceeded";
    } else if (used >= budget.maxMs * 0.8) {
      level = "warn";
    }
    lines.push({ metric: "time", used, limit: budget.maxMs, level });
    if (level !== "ok") {
      worstLevel = level;
    }
  }

  return {
    level: worstLevel,
    lines: lines,
  };
}

export interface ExecutorProfile {
  readonly id: string;
  readonly tier: "strong" | "cheap" | "deterministic";
  readonly costPer1kTokens?: number;
}

export type RouteReason = string;

export function routeExecutor(
  task:
    | "architecture"
    | "domain-interpretation"
    | "design-direction"
    | "decomposition"
    | "integration"
    | "review"
    | "bounded-implementation"
    | "repetitive-transformation"
    | "test"
    | "build"
    | "lint"
    | "file-hash"
    | "browser-journey",
  profiles: readonly ExecutorProfile[]
): { readonly executor: ExecutorProfile | undefined; readonly reason: RouteReason } {
  // Determine target tier
  let targetTier: "strong" | "cheap" | "deterministic" | undefined;
  const determinativeTasks = [
    "test",
    "build",
    "lint",
    "file-hash",
    "browser-journey",
  ];
  const strongTasks = [
    "architecture",
    "domain-interpretation",
    "design-direction",
    "decomposition",
    "integration",
    "review",
  ];
  const cheapTasks = [
    "bounded-implementation",
    "repetitive-transformation",
  ];

  if (determinativeTasks.includes(task)) {
    targetTier = "deterministic";
  } else if (strongTasks.includes(task)) {
    targetTier = "strong";
  } else if (cheapTasks.includes(task)) {
    targetTier = "cheap";
  }

  // Filter to target tier
  let candidates = profiles.filter((p) => p.tier === targetTier);

  // If no cheap executors and task is cheap-tier, fall back to strong
  if (candidates.length === 0 && targetTier === "cheap") {
    targetTier = "strong";
    candidates = profiles.filter((p) => p.tier === targetTier);
  }

  // If no deterministic executors, return undefined
  if (candidates.length === 0 && targetTier === "deterministic") {
    return {
      executor: undefined,
      reason: "no deterministic executor available",
    };
  }

  // If still no candidates, return undefined
  if (candidates.length === 0) {
    return {
      executor: undefined,
      reason: `no ${targetTier} executor available`,
    };
  }

  // Sort by cost (undefined last), then by id
  candidates.sort((a, b) => {
    const aCost = a.costPer1kTokens ?? Infinity;
    const bCost = b.costPer1kTokens ?? Infinity;
    if (aCost !== bCost) {
      return aCost - bCost;
    }
    return a.id.localeCompare(b.id);
  });

  return {
    executor: candidates[0],
    reason: `routed to ${targetTier} tier`,
  };
}

export function costToVerifiedAcceptance(
  econ: TaskEconomics,
  extra: { readonly reworkCostUsd?: number; readonly verificationCostUsd?: number }
): number | undefined {
  if (econ.costUsd === undefined) {
    return undefined;
  }

  let total = econ.costUsd;
  if (extra.reworkCostUsd !== undefined) {
    total += extra.reworkCostUsd;
  }
  if (extra.verificationCostUsd !== undefined) {
    total += extra.verificationCostUsd;
  }

  return total;
}

function compactTokens(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  }
  return (tokens / 1000).toFixed(1) + "k";
}

export function provenanceLine(econ: TaskEconomics): string {
  // Build executor string: "executor via provider (route: billingRoute)" joined with " + "
  const executorParts = econ.executors.map((e) => {
    let part = e.executor;
    if (e.provider) {
      part += ` via ${e.provider}`;
    }
    if (e.billingRoute) {
      part += ` (route: ${e.billingRoute})`;
    }
    return part;
  });
  const executorsStr = executorParts.join(" + ");

  // Tokens
  const tokensStr = `${compactTokens(econ.totalTokens)} tok`;

  // Calls
  const callsStr = `${econ.modelCalls} calls`;

  // Peak concurrency
  const concStr = `peak ${econ.peakConcurrency}×`;

  // Cost
  let costStr: string;
  if (econ.costUsd === undefined) {
    costStr = "cost n/a";
  } else {
    costStr = `$${econ.costUsd.toFixed(2)}`;
  }

  return `${executorsStr} · ${tokensStr} · ${callsStr} · ${concStr} · ${costStr}`;
}
