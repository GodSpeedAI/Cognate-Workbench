// T0 (capacity attribution). The canonical characterization in `experts-app-capacity.test.ts`
// reports one elapsed sample per capacity and does not isolate where that time goes. This suite
// runs the same eight-assignment model-only workload with the native shared-state seam and the
// Experts registry context rebuild instrumented, so registry CAS contention and full state/context
// materialization are measured separately from provider time. It asserts only structural facts
// (admission peak, distinct identities, terminal handoffs, attached probes) and prints one JSON
// record per case; the timings are observations recorded in docs, never thresholds.
import { expect, test } from "bun:test";
import { performance } from "node:perf_hooks";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ExpertsService } from "../src/experts/service.ts";
import { EXPERTS_THREAD } from "../src/experts/types.ts";
import { invoke, route, waitForAssignment, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

const ASSIGNMENTS = 8;
const CASE_TIMEOUT_MS = 30_000;
/** Capacity 8 first, then capacity 4: the canonical sweep runs 1→2→4→8 in one accumulating
 * process, so an isolated first-in-process capacity 8 separates a real capacity-8 cost from an
 * ordering/GC artifact of that sweep. */
const cases = [8, 4] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Identical gating to the canonical characterization so the two suites stay comparable. */
function measuredResponder(capacity: number) {
  let active = 0;
  let peak = 0;
  let releasedForCleanup = false;
  let cohort = { ...deferred(), arrivals: 0, completed: 0 };

  const responder: FakeResponder = async (selectedRoute, request) => {
    const current = cohort;
    active++;
    peak = Math.max(peak, active);
    current.arrivals++;
    if (current.arrivals === capacity) setTimeout(() => current.resolve(), 80);
    if (releasedForCleanup) current.resolve();

    try {
      await current.promise;
      const marker = request.messages
        .map(message => typeof message.content === "string" ? message.content : "")
        .flatMap(content => content.match(/capacity-\d+-assignment-\d+/g) ?? [])
        .at(-1);
      return {
        message: { role: "assistant" as const, content: `${selectedRoute.model}: completed ${marker ?? "unattributed"}` },
        toolCalls: [], finishReason: "stop" as const, model: selectedRoute.model,
      };
    } finally {
      active--;
      current.completed++;
      if (current.completed === current.arrivals && current.arrivals === capacity) {
        cohort = { ...deferred(), arrivals: 0, completed: 0 };
        if (releasedForCleanup) cohort.resolve();
      }
    }
  };

  return {
    responder,
    peak: () => peak,
    release: () => { releasedForCleanup = true; cohort.resolve(); },
  };
}

async function beforeDeadline<T>(promise: Promise<T>, label: string, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remainingMs = Math.max(0, deadline - Date.now());
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded its bounded case deadline`)), remainingMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Probe {
  rootReads: number;
  rootReadMs: number[];
  rootWrites: number;
  rootWriteMs: number[];
  casConflicts: number;
  committedSnapshotBytes: number[];
  contextCalls: number;
  contextMs: number[];
}

const emptyProbe = (): Probe => ({
  rootReads: 0, rootReadMs: [], rootWrites: 0, rootWriteMs: [], casConflicts: 0,
  committedSnapshotBytes: [], contextCalls: 0, contextMs: [],
});

type Instrumented = RuntimeService & {
  readSharedState: RuntimeService["readSharedState"];
  updateSharedState: RuntimeService["updateSharedState"];
};

/** Same seam-wrapping technique as `scripts/benchmark-experts.ts`: count the Experts thread's
 * shared-state reads, commits, failed CAS attempts and committed payload bytes. */
function instrumentSharedState(service: RuntimeService, probe: Probe): () => void {
  const target = service as Instrumented;
  const originalRead = target.readSharedState.bind(target);
  const originalWrite = target.updateSharedState.bind(target);
  Object.defineProperty(target, "readSharedState", {
    configurable: true,
    writable: true,
    value: async (caller: Caller, request: Parameters<RuntimeService["readSharedState"]>[1]) => {
      const started = performance.now();
      try {
        return await originalRead(caller, request);
      } finally {
        if (request.threadId === EXPERTS_THREAD) {
          probe.rootReads++;
          probe.rootReadMs.push(performance.now() - started);
        }
      }
    },
  });
  Object.defineProperty(target, "updateSharedState", {
    configurable: true,
    writable: true,
    value: async (caller: Caller, request: Parameters<RuntimeService["updateSharedState"]>[1]) => {
      const snapshotBytes = "snapshot" in request.update ? Buffer.byteLength(JSON.stringify(request.update.snapshot)) : 0;
      const started = performance.now();
      try {
        const result = await originalWrite(caller, request);
        if (request.threadId === EXPERTS_THREAD) {
          probe.rootWrites++;
          probe.rootWriteMs.push(performance.now() - started);
          probe.committedSnapshotBytes.push(snapshotBytes);
        }
        return result;
      } catch (error) {
        if (request.threadId === EXPERTS_THREAD && error instanceof Error && /failed_precondition|unavailable/.test(`${(error as { code?: string }).code ?? ""} ${error.message}`)) {
          probe.casConflicts++;
        }
        throw error;
      }
    },
  });
  return () => {
    Object.defineProperty(target, "readSharedState", { configurable: true, writable: true, value: originalRead });
    Object.defineProperty(target, "updateSharedState", { configurable: true, writable: true, value: originalWrite });
  };
}

/** Time the in-memory execution-context rebuild separately from the store-backed read. */
function instrumentContextMaterialization(probe: Probe): () => void {
  const original = ExpertsService.prototype.context;
  ExpertsService.prototype.context = function (this: ExpertsService, ...args: Parameters<ExpertsService["context"]>) {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      probe.contextCalls++;
      probe.contextMs.push(performance.now() - started);
    }
  };
  return () => { ExpertsService.prototype.context = original; };
}

function distribution(samples: readonly number[]) {
  if (samples.length === 0) return { count: 0, total: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    count: sorted.length,
    total: Number(sorted.reduce((sum, value) => sum + value, 0).toFixed(2)),
    p50: Number(at(0.5).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    max: Number(Number(sorted.at(-1)).toFixed(2)),
  };
}

async function attributeCase(capacity: number): Promise<void> {
  const gate = measuredResponder(capacity);
  const probe = emptyProbe();
  const restoreContext = instrumentContextMaterialization(probe);
  try {
    await withExpertApp(gate.responder, async testApp => {
      const restoreShared = instrumentSharedState(testApp.app.runtime.service, probe);
      try {
        const initial = await testApp.state();
        const builder = initial.experts.builder!;
        await invoke(testApp, "expert.save", {
          expertId: "builder",
          name: builder.name,
          specialization: builder.definition.specialization,
          instructions: builder.definition.instructions,
          tools: [],
          route: route(`attribution-${capacity}-builder`),
        });

        const startedAt = performance.now();
        const deadline = Date.now() + CASE_TIMEOUT_MS;
        const starts = await beforeDeadline(Promise.all(Array.from({ length: ASSIGNMENTS }, async (_, index) => {
          const marker = `capacity-${capacity}-assignment-${index}`;
          return await invoke(testApp, "expert.converse", {
            expertId: "builder",
            workspaceId: testApp.workspaceId,
            requestId: marker,
            message: `Attribute native run admission for ${marker}`,
          }) as { readonly assignmentId: string; readonly conversationId: string };
        })), `capacity ${capacity} concurrent submissions`, deadline);
        const submitMs = performance.now() - startedAt;
        // Snapshot after the submission phase: no harness polling has run yet, so this slice is
        // the application's own registry traffic (converse capability + assignment creation).
        const submitPhase = { rootReads: probe.rootReads, rootWrites: probe.rootWrites, casConflicts: probe.casConflicts };

        const terminal = await beforeDeadline(Promise.all(starts.map(result =>
          waitForAssignment(testApp, result.assignmentId, assignment =>
            !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status), CASE_TIMEOUT_MS),
        )), `capacity ${capacity} assignment handoffs`, deadline);
        const elapsedMs = performance.now() - startedAt;

        expect(gate.peak()).toBe(capacity);
        expect(new Set(starts.map(result => result.assignmentId)).size).toBe(ASSIGNMENTS);
        expect(terminal).toHaveLength(ASSIGNMENTS);
        expect(new Set(terminal.map(assignment => assignment.runId)).size).toBe(ASSIGNMENTS);
        // The probes must have been attached and exercised, otherwise the attribution below would
        // silently be measuring nothing.
        expect(probe.rootReads).toBeGreaterThan(0);
        expect(probe.rootWrites).toBeGreaterThan(0);
        expect(probe.contextCalls).toBeGreaterThan(0);

        console.log(JSON.stringify({
          kind: "experts-capacity-attribution",
          capacity,
          assignments: ASSIGNMENTS,
          observedProviderPeak: gate.peak(),
          elapsedMs: Number(elapsedMs.toFixed(1)),
          submitPhaseMs: Number(submitMs.toFixed(1)),
          handoffPhaseMs: Number((elapsedMs - submitMs).toFixed(1)),
          throughputAssignmentsPerSecond: Number((ASSIGNMENTS / (elapsedMs / 1000)).toFixed(2)),
          registryCas: {
            rootReads: probe.rootReads,
            rootWrites: probe.rootWrites,
            casConflictErrors: probe.casConflicts,
            /** Registry traffic of the submission phase alone: application work, before the
             * harness starts polling the aggregate for assignment status. */
            submitPhaseOnly: submitPhase,
            handoffPhaseIncludingPolling: {
              rootReads: probe.rootReads - submitPhase.rootReads,
              rootWrites: probe.rootWrites - submitPhase.rootWrites,
              casConflicts: probe.casConflicts - submitPhase.casConflicts,
            },
            rootReadLatency: distribution(probe.rootReadMs),
            rootWriteLatency: distribution(probe.rootWriteMs),
            committedSnapshotBytes: distribution(probe.committedSnapshotBytes),
          },
          materialization: {
            contextBuilds: probe.contextCalls,
            contextBuild: distribution(probe.contextMs),
            contextBuildShareOfElapsed: Number((distribution(probe.contextMs).total / elapsedMs).toFixed(4)),
          },
          processRssBytes: process.memoryUsage().rss,
        }));
      } finally {
        restoreShared();
      }
    }, { runCapacity: capacity as 1 | 2 | 4 | 8 });
  } finally {
    restoreContext();
    gate.release();
  }
}

test("capacity attribution measures registry CAS and context materialization at capacity 8 and 4", async () => {
  for (const capacity of cases) await attributeCase(capacity);
}, 120_000);

