#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, totalmem, cpus, release, arch, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { openPostgresStore } from "@godspeedai/cognate-store-postgres";
import { ServiceError, type RuntimeService } from "@godspeedai/cognate-runtime-api";
import { resolvePg0Url } from "@godspeedai/cognate-store-postgres";
import { EXPERT_TOOLS, EXPERTS_THREAD, type Expert, type ExpertMemory, type ExpertState, type Team } from "../src/experts/types.ts";
import { EXPERT_PARTITION_THREAD_PREFIX } from "../src/experts/persistence.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { schemaFor } from "../src/store.ts";

const DEFAULTS = {
  experts: 100,
  teams: 20,
  memories: 500,
  messages: 2_000,
  memoryChars: 25,
  messageChars: 6,
  operations: 8,
  concurrencies: [1, 2, 4, 8],
  partitioned: false,
} as const;

type Config = {
  readonly experts: number;
  readonly teams: number;
  readonly memories: number;
  readonly messages: number;
  readonly memoryChars: number;
  readonly messageChars: number;
  readonly operations: number;
  readonly concurrencies: readonly number[];
  readonly partitioned: boolean;
};
type Service = RuntimeService & {
  readSharedState: RuntimeService["readSharedState"];
  updateSharedState: RuntimeService["updateSharedState"];
};
type Counters = {
  reads: number;
  writes: number;
  writeSuccesses: number;
  casConflicts: number;
  readMs: number[];
  writeMs: number[];
  snapshotBytes: number[];
  committedSnapshotBytes: number[];
  partitionReads: number;
  partitionWrites: number;
  partitionWriteSuccesses: number;
  partitionCasConflicts: number;
  partitionReadMs: number[];
  partitionWriteMs: number[];
  partitionSnapshotBytes: number[];
  committedPartitionSnapshotBytes: number[];
};

const HELP = `Usage: bun scripts/benchmark-experts.ts [options]

Uses COGNATE_POSTGRES_URL when set, otherwise the pg0 instance selected by COGNATE_PG0_NAME.
The script creates a unique Cognate schema, exercises it, and drops that schema on exit. It
never prints a connection URL.

Options:
  --experts=N                 Total active Experts, including the five seeded Experts (100)
  --teams=N                   Total Teams, including Cognate Team (20)
  --memories=N                Synthetic memory records (500)
  --messages=N                Synthetic conversation messages (2000)
  --memory-chars=N            Text size per memory record (25)
  --message-chars=N           Text size per message (6)
  --operations=N              Mutations per concurrency level (8; bounded to 4..32)
  --concurrency=1,2,4,8        Concurrent writers to characterize (1,2,4,8)
  --partitioned                Allow logical state above 900 KiB through native partitions
  --help                      Show this message

The full serialized Expert snapshot is capped at 900 KiB to stay below Cognate's 1 MiB event
envelope limit. No model calls or external vector services are used.`;

function parseConfig(args: readonly string[]): Config {
  const values: Record<string, string> = {};
  let partitioned = false;
  for (const arg of args) {
    if (arg === "--help") {
      console.log(HELP);
      process.exit(0);
    }
    if (arg === "--partitioned") { partitioned = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Invalid option: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`--${key} must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  const concurrencies = values.concurrency === undefined
    ? [...DEFAULTS.concurrencies]
    : values.concurrency.split(",").map((part) => {
        const value = Number(part);
        if (![1, 2, 4, 8].includes(value)) throw new Error("--concurrency accepts only 1, 2, 4, or 8");
        return value;
      });
  if (concurrencies.length === 0 || new Set(concurrencies).size !== concurrencies.length) {
    throw new Error("--concurrency needs one or more unique values");
  }
  const config = {
    experts: int("experts", DEFAULTS.experts, 5, 250),
    teams: int("teams", DEFAULTS.teams, 1, 100),
    memories: int("memories", DEFAULTS.memories, 0, 2_000),
    messages: int("messages", DEFAULTS.messages, 0, 5_000),
    memoryChars: int("memory-chars", DEFAULTS.memoryChars, 8, 8_000),
    messageChars: int("message-chars", DEFAULTS.messageChars, 4, 20_000),
    operations: int("operations", DEFAULTS.operations, 4, 32),
    concurrencies,
    partitioned,
  };
  if (config.teams > config.experts) throw new Error("--teams cannot exceed --experts");
  const syntheticTextBytes = config.memories * config.memoryChars + config.messages * config.messageChars;
  if (syntheticTextBytes > 24 * 1024 * 1024) throw new Error("Synthetic text exceeds the 24 MiB input safety cap");
  return config;
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function distribution(samples: readonly number[]) {
  return {
    samples: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(Math.max(0, ...samples).toFixed(2)),
  };
}

function byteDistribution(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const valueAt = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    samples: samples.length,
    totalBytes: samples.reduce((total, value) => total + value, 0),
    p50Bytes: valueAt(0.5),
    p95Bytes: valueAt(0.95),
    maxBytes: Math.max(0, ...samples),
  };
}

function padded(prefix: string, size: number): string {
  return `${prefix}${"x".repeat(Math.max(0, size - prefix.length))}`;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted connection URL]");
}

function createTeam(id: string, name: string, expertIds: readonly string[]): Team {
  return {
    id,
    name,
    lifecycle: "active",
    members: expertIds.map((expertId, index) => ({
      expertId,
      role: index === 0 ? "orchestrator" : "specialist",
      tools: [...EXPERT_TOOLS],
    })),
    tools: [...EXPERT_TOOLS],
    limits: { maxDepth: 2, maxAssignments: 12, maxUnread: 20, maxRounds: 8 },
  };
}

async function populate(experts: ExpertsService, config: Config): Promise<number> {
  return experts.mutate(LOCAL_OPERATOR.tenant, "scale-baseline:populate", {
    version: 1,
    config: {
      experts: config.experts,
      teams: config.teams,
      memories: config.memories,
      messages: config.messages,
      memoryChars: config.memoryChars,
      messageChars: config.messageChars,
    },
  }, (state) => {
    for (let index = 0; index < config.experts; index++) {
      const id = index < 5 ? ["product-manager", "builder", "critic", "verifier", "reviewer"][index]! : `bench-expert-${String(index - 5).padStart(3, "0")}`;
      const existing = state.experts[id];
      if (existing) continue;
      const expert: Expert = {
        id,
        name: `Benchmark Expert ${String(index).padStart(3, "0")}`,
        lifecycle: "active",
        definition: {
          id: `definition:${id}`,
          specialization: `Synthetic specialization ${index}`,
          instructions: `Synthetic benchmark identity ${index}. No model is invoked.`,
          route: null,
          tools: ["read", "expert_memory_read", "expert_memory_write", "expert_return"],
          contextBudget: 16_000,
          maxSteps: 12,
        },
      };
      state.experts[id] = expert;
    }
    const activeExpertIds = Object.keys(state.experts).filter((id) => state.experts[id]?.lifecycle === "active").slice(0, config.experts);
    for (let index = 1; index < config.teams; index++) {
      const id = `benchmark-team-${String(index - 1).padStart(3, "0")}`;
      const memberStart = ((index - 1) * 5) % activeExpertIds.length;
      const members = Array.from({ length: Math.min(5, activeExpertIds.length) }, (_, memberIndex) => activeExpertIds[(memberStart + memberIndex) % activeExpertIds.length]!);
      state.teams[id] = createTeam(id, `Benchmark Team ${String(index).padStart(3, "0")}`, members);
    }
    for (let index = 0; index < config.memories; index++) {
      const id = `benchmark-memory-${String(index).padStart(5, "0")}`;
      const isFocusNote = index < 10;
      const expertIndex = isFocusNote ? 5 : 5 + (index % Math.max(1, config.experts - 5));
      const expertId = expertIndex < 5 ? activeExpertIds[expertIndex]! : `bench-expert-${String(expertIndex - 5).padStart(3, "0")}`;
      const isPinned = index < 2;
      const isPersonal = isFocusNote || index % 3 === 0;
      const teamIndex = config.teams > 1 ? index % (config.teams - 1) : 0;
      const teamId = isPersonal || config.teams === 1 ? null : `benchmark-team-${String(teamIndex).padStart(3, "0")}`;
      const scope: ExpertMemory["scope"] = teamId === null ? "personal" : index % 5 === 0 ? "private-team" : "team";
      const marker = isFocusNote ? `pinned-search-target-${index}` : index === 10 ? "scope-boundary-signal" : `memory-index-${index}`;
      const memory: ExpertMemory = {
        id,
        expertId,
        teamId,
        scope,
        kind: "observation",
        text: padded(`${marker} `, config.memoryChars),
        sources: [`benchmark-assignment-${index}`],
        pinned: isPinned,
        by: "benchmark-operator",
      };
      state.memory[id] = memory;
    }
    const conversationId = "benchmark-conversation";
    const messageIds: string[] = [];
    for (let index = 0; index < config.messages; index++) {
      const id = `benchmark-message-${String(index).padStart(5, "0")}`;
      messageIds.push(id);
      state.messages[id] = {
        id,
        conversationId,
        assignmentId: null,
        sender: index % 2 === 0 ? { kind: "human", id: "benchmark-operator" } : { kind: "expert", id: "bench-expert-000" },
        recipientId: "bench-expert-000",
        text: padded(`m${String(index).padStart(5, "0")}`, config.messageChars),
        correlationId: `benchmark:${conversationId}:${index}`,
        causationId: null,
        delivery: "delivered",
        replyTo: null,
      };
    }
    state.conversations[conversationId] = {
      id: conversationId,
      scope: "solo",
      expertId: "bench-expert-000",
      teamId: null,
      workspaceId: "benchmark-workspace",
      title: "Synthetic scale baseline",
      messageIds,
      assignmentIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const snapshotBytes = Buffer.byteLength(JSON.stringify(state));
    if (!config.partitioned && snapshotBytes > 900 * 1024) {
      throw new Error(`Synthetic Expert snapshot would be ${snapshotBytes} bytes; use --partitioned to characterize larger logical state through native bounded partitions (Cognate events remain limited to 1 MiB).`);
    }
    return snapshotBytes;
  });
}

function instrument(service: RuntimeService) {
  const target = service as Service;
  const originalRead = target.readSharedState.bind(target);
  const originalWrite = target.updateSharedState.bind(target);
  let active: Counters | undefined;
  Object.defineProperty(target, "readSharedState", {
    configurable: true,
    writable: true,
    value: async (...args: Parameters<RuntimeService["readSharedState"]>) => {
      const [caller, request] = args;
      const isRoot = request.threadId === EXPERTS_THREAD;
      const isPartition = request.threadId.startsWith(EXPERT_PARTITION_THREAD_PREFIX);
      const counters = isRoot || isPartition ? active : undefined;
      const started = performance.now();
      try {
        return await originalRead(caller, request);
      } finally {
        if (counters) {
          if (isRoot) {
            counters.reads++;
            counters.readMs.push(performance.now() - started);
          } else {
            counters.partitionReads++;
            counters.partitionReadMs.push(performance.now() - started);
          }
        }
      }
    },
  });
  Object.defineProperty(target, "updateSharedState", {
    configurable: true,
    writable: true,
    value: async (...args: Parameters<RuntimeService["updateSharedState"]>) => {
      const [caller, request] = args;
      const isRoot = request.threadId === EXPERTS_THREAD;
      const isPartition = request.threadId.startsWith(EXPERT_PARTITION_THREAD_PREFIX);
      const counters = isRoot || isPartition ? active : undefined;
      const snapshotBytes = request.update.snapshot === undefined ? 0 : Buffer.byteLength(JSON.stringify(request.update.snapshot));
      const started = performance.now();
      try {
        const result = await originalWrite(caller, request);
        if (counters && isRoot) {
          counters.writeSuccesses++;
          counters.committedSnapshotBytes.push(snapshotBytes);
        }
        if (counters && isPartition) {
          counters.partitionWriteSuccesses++;
          counters.committedPartitionSnapshotBytes.push(snapshotBytes);
        }
        return result;
      } catch (error) {
        const code = error instanceof ServiceError ? error.code : (error as { code?: string } | null)?.code;
        if (counters && (code === "failed_precondition" || code === "unavailable")) {
          if (isRoot) counters.casConflicts++;
          else counters.partitionCasConflicts++;
        }
        throw error;
      } finally {
        if (counters) {
          if (isRoot) {
            counters.writes++;
            counters.writeMs.push(performance.now() - started);
            counters.snapshotBytes.push(snapshotBytes);
          } else {
            counters.partitionWrites++;
            counters.partitionWriteMs.push(performance.now() - started);
            counters.partitionSnapshotBytes.push(snapshotBytes);
          }
        }
      }
    },
  });
  return {
    begin() {
      active = {
        reads: 0, writes: 0, writeSuccesses: 0, casConflicts: 0, readMs: [], writeMs: [], snapshotBytes: [],
        partitionReads: 0, partitionWrites: 0, partitionWriteSuccesses: 0, partitionCasConflicts: 0,
        partitionReadMs: [], partitionWriteMs: [], partitionSnapshotBytes: [],
        committedSnapshotBytes: [], committedPartitionSnapshotBytes: [],
      };
      return active;
    },
    end() { active = undefined; },
    restore() {
      Object.defineProperty(target, "readSharedState", { configurable: true, writable: true, value: originalRead });
      Object.defineProperty(target, "updateSharedState", { configurable: true, writable: true, value: originalWrite });
      active = undefined;
    },
  };
}

async function invoke(service: RuntimeService, capability: string, input: unknown): Promise<unknown> {
  return service.invoke(LOCAL_OPERATOR, { capability, input: input as never });
}

async function serverVersion(url: string): Promise<string> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`SELECT current_setting('server_version') AS version`;
    return String(rows[0]?.version ?? "unknown");
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function runWriters(service: RuntimeService, concurrency: number, operationCount: number) {
  let next = 0;
  const latencies: number[] = [];
  const benchmarkExpertId = "bench-expert-000";
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= operationCount) return;
      const started = performance.now();
      await invoke(service, "expert.save", {
        expertId: benchmarkExpertId,
        name: "Benchmark Expert 005",
        specialization: `Synthetic specialization ${index % 7}`,
        instructions: "Synthetic benchmark identity. No model is invoked.",
        route: null,
        tools: ["read", "expert_memory_read", "expert_memory_write", "expert_return"],
        contextBudget: 16_000,
        maxSteps: 12,
        requestId: `benchmark-writer-${concurrency}-${index}`,
      });
      latencies.push(performance.now() - started);
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = performance.now() - started;
  return {
    concurrency,
    operations: operationCount,
    wallMs: Number(wallMs.toFixed(2)),
    throughputPerSecond: Number((operationCount * 1_000 / wallMs).toFixed(2)),
    latency: distribution(latencies),
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const pg0Name = process.env.COGNATE_PG0_NAME ?? "cognate-dev";
  const databaseUrl = process.env.COGNATE_POSTGRES_URL ?? await resolvePg0Url({ name: pg0Name });
  const postgresVersion = await serverVersion(databaseUrl);

  const home = await mkdtemp(join(tmpdir(), "cognate-experts-scale-"));
  const schema = schemaFor(home, "harness");
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  let initialBootMs = 0;
  let restartMs = 0;
  const rssStart = process.memoryUsage.rss();
  let peakRss = rssStart;
  const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); }, 100);
  const start = async () => {
    const started = performance.now();
    const instance = await startServer({ port: 0, home });
    return { instance, elapsedMs: performance.now() - started };
  };

  try {
    const first = await start();
    app = first.instance;
    initialBootMs = first.elapsedMs;
    const experts = new ExpertsService(app.runtime.service, { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant });
    const metrics = instrument(app.runtime.service);
    const populationCounters = metrics.begin();
    const preCommitSnapshotBytes = await populate(experts, config);
    metrics.end();
    console.error(`[benchmark] populated ${config.experts} Experts, ${config.teams} Teams, ${config.memories} memories, ${config.messages} messages (${preCommitSnapshotBytes} serialized bytes)`);
    const state = await experts.state(LOCAL_OPERATOR.tenant);
    const aggregateBytes = Buffer.byteLength(JSON.stringify(state));
    if (!config.partitioned && aggregateBytes > 900 * 1024) throw new Error(`Committed aggregate is ${aggregateBytes} bytes, above the 900 KiB safety boundary`);
    const projection = await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" });
    const projectionBytes = Buffer.byteLength(JSON.stringify(projection.rows.filter((row) => row.key === "current").map((row) => row.value)));

    const focusExpert = state.experts["bench-expert-000"]!;
    const focusConversation = state.conversations["benchmark-conversation"]!;
    const contextStarted = performance.now();
    const context = experts.context(state, focusExpert, focusConversation);
    const contextMs = performance.now() - contextStarted;
    const pinnedIncluded = [0, 1].every((index) => context.some((message) => message.content.includes(`pinned-search-target-${index}`)));
    const contextLeaksScope = context.some((message) => message.content.includes("scope-boundary-signal"));
    const exactSearchStarted = performance.now();
    const exactSearch = await invoke(app.runtime.service, "expert.memory.read", { expertId: "bench-expert-000", query: "pinned-search-target-1" }) as readonly ExpertMemory[];
    const exactSearchMs = performance.now() - exactSearchStarted;
    const boundarySearch = await invoke(app.runtime.service, "expert.memory.read", { expertId: "bench-expert-000", query: "scope-boundary-signal" }) as readonly ExpertMemory[];
    const quality = {
      pinnedNotesRetained: pinnedIncluded,
      lexicalExactMatchCount: exactSearch.length,
      lexicalExactMatchCorrect: exactSearch.length === 1 && exactSearch[0]?.id === "benchmark-memory-00001",
      crossExpertPersonalScopeLeakCount: boundarySearch.length,
      contextScopeLeak: contextLeaksScope,
      contextMessages: context.length,
      contextBuildMs: Number(contextMs.toFixed(2)),
      exactMemorySearchMs: Number(exactSearchMs.toFixed(2)),
    };
    if (!quality.pinnedNotesRetained || !quality.lexicalExactMatchCorrect || quality.crossExpertPersonalScopeLeakCount !== 0 || quality.contextScopeLeak) {
      throw new Error(`Synthetic memory quality/scope checks failed: ${JSON.stringify(quality)}`);
    }
    console.error("[benchmark] memory retention, exact-search, and scope checks passed");

    const concurrencyResults = [];
    const operationMetrics = [];
    for (const concurrency of config.concurrencies) {
      console.error(`[benchmark] writer sweep concurrency=${concurrency}, operations=${config.operations}`);
      const counters = metrics.begin();
      const result = await runWriters(app.runtime.service, concurrency, config.operations);
      metrics.end();
      concurrencyResults.push(result);
      operationMetrics.push({
        concurrency,
        serviceReads: counters.reads,
        serviceWrites: counters.writes,
        committedWrites: counters.writeSuccesses,
        casConflictErrors: counters.casConflicts,
        partitionReads: counters.partitionReads,
        partitionWrites: counters.partitionWrites,
        partitionCommittedWrites: counters.partitionWriteSuccesses,
        partitionCasConflictErrors: counters.partitionCasConflicts,
        conflictRate: counters.writes === 0 ? 0 : Number((counters.casConflicts / counters.writes).toFixed(4)),
        readLatency: distribution(counters.readMs),
        compareAndSwapLatency: distribution(counters.writeMs),
        snapshotPayloadBytes: byteDistribution(counters.snapshotBytes),
        committedSnapshotPayloadBytes: byteDistribution(counters.committedSnapshotBytes),
        partitionReadLatency: distribution(counters.partitionReadMs),
        partitionWriteLatency: distribution(counters.partitionWriteMs),
        partitionSnapshotPayloadBytes: byteDistribution(counters.partitionSnapshotBytes),
        committedPartitionSnapshotPayloadBytes: byteDistribution(counters.committedPartitionSnapshotBytes),
      });
      console.error(`[benchmark] completed concurrency=${concurrency} in ${result.wallMs} ms; ${counters.casConflicts} CAS conflict errors`);
    }
    metrics.restore();

    const finalState = await experts.state(LOCAL_OPERATOR.tenant);
    const finalAggregateBytes = Buffer.byteLength(JSON.stringify(finalState));
    await app.stop();
    app = undefined;
    const reopened = await start();
    app = reopened.instance;
    restartMs = reopened.elapsedMs;
    const recovered = await new ExpertsService(app.runtime.service, { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant }).state(LOCAL_OPERATOR.tenant);
    const recovery = {
      experts: Object.keys(recovered.experts).length,
      teams: Object.keys(recovered.teams).length,
      memories: Object.keys(recovered.memory).length,
      messages: Object.keys(recovered.messages).length,
      stateRecovered: Object.keys(recovered.memory).length === config.memories && Object.keys(recovered.messages).length === config.messages,
    };
    console.error(`[benchmark] restart/recovery ${restartMs.toFixed(2)} ms; recovered ${recovery.experts} Experts, ${recovery.teams} Teams, ${recovery.memories} memories, ${recovery.messages} messages`);

    console.log(JSON.stringify({
      benchmark: "cognate-experts-postgres-aggregate-scale",
      measuredAt: new Date().toISOString(),
      runtime: {
        bun: Bun.version,
        appDependencies: "@godspeedai/cognate-* 0.2.0",
        os: `${platform()} ${release()} ${arch()}`,
        cpuCount: cpus().length,
        cpuModel: cpus()[0]?.model ?? "unknown",
        totalMemoryBytes: totalmem(),
        postgres: `${postgresVersion}; ${process.env.COGNATE_POSTGRES_URL ? "COGNATE_POSTGRES_URL" : `pg0 ${pg0Name}`} (connection value withheld)`,
      },
      dataset: {
        ...config,
        actualExperts: Object.keys(finalState.experts).length,
        actualTeams: Object.keys(finalState.teams).length,
        preCommitSnapshotBytes,
        aggregateSerializedBytesBeforeWriters: aggregateBytes,
        aggregateSerializedBytesAfterWriters: finalAggregateBytes,
        publicProjectionSerializedBytes: projectionBytes,
        syntheticTextBytes: config.memories * config.memoryChars + config.messages * config.messageChars,
      },
      memoryQualityAndScope: quality,
      runtimeCosts: {
        initialServerStartupMs: Number(initialBootMs.toFixed(2)),
        serverRestartAndProjectionRecoveryMs: Number(restartMs.toFixed(2)),
        note: "Startup/recovery includes server, store, and projection work; it is not an isolated projection rebuild measurement.",
        rssStartBytes: rssStart,
        rssPeakBytes: peakRss,
        rssEndBytes: process.memoryUsage.rss(),
      },
      concurrentWriters: concurrencyResults,
      sharedStateInstrumentation: operationMetrics,
      initialPopulationStorageOperations: {
        rootReads: populationCounters.reads,
        rootWrites: populationCounters.writes,
        rootCommittedWrites: populationCounters.writeSuccesses,
        rootSnapshotPayloadBytes: byteDistribution(populationCounters.snapshotBytes),
        rootCommittedSnapshotPayloadBytes: byteDistribution(populationCounters.committedSnapshotBytes),
        partitionReads: populationCounters.partitionReads,
        partitionWrites: populationCounters.partitionWrites,
        partitionCommittedWrites: populationCounters.partitionWriteSuccesses,
        partitionSnapshotPayloadBytes: byteDistribution(populationCounters.partitionSnapshotBytes),
        partitionCommittedSnapshotPayloadBytes: byteDistribution(populationCounters.committedPartitionSnapshotBytes),
      },
      recovery,
    }, null, 2));
    if (!recovery.stateRecovered) throw new Error("PostgreSQL restart did not recover the complete synthetic state");
  } finally {
    clearInterval(rssTimer);
    await app?.stop().catch(() => {});
    const cleanup = await openPostgresStore({ url: databaseUrl, schema }).catch(() => undefined);
    if (cleanup) {
      await cleanup.close().catch(() => {});
      await cleanup.dropSchema().catch((error) => {
        console.error(`Could not drop benchmark schema ${schema}: ${safeError(error)}`);
      });
    }
    await rm(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
