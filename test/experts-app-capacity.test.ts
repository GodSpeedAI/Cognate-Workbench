import { expect, test } from "bun:test";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { invoke, route, waitForAssignment, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

const ASSIGNMENTS_PER_CAPACITY = 8;
const CASE_TIMEOUT_MS = 30_000;
const capacities = [1, 2, 4, 8] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

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
    if (current.arrivals === capacity) {
      setTimeout(() => current.resolve(), 80);
    }
    if (releasedForCleanup) current.resolve();

    try {
      await current.promise;
      const marker = request.messages
        .map(message => typeof message.content === "string" ? message.content : "")
        .flatMap(content => content.match(/capacity-\d+-assignment-\d+/g) ?? [])
        .at(-1);
      const response: ModelResponse = {
        message: { role: "assistant", content: `${selectedRoute.model}: completed ${marker ?? "unattributed"}` },
        toolCalls: [], finishReason: "stop", model: selectedRoute.model,
      };
      return response;
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
    release: () => {
      releasedForCleanup = true;
      cohort.resolve();
    },
  };
}

async function beforeDeadline<T>(promise: Promise<T>, label: string, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remainingMs = Math.max(0, deadline - Date.now());
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded its bounded case deadline`)), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("Experts model-only application capacity characterizes eight concurrent assignment submissions", async () => {
  for (const capacity of capacities) {
    const gate = measuredResponder(capacity);
    await withExpertApp(gate.responder, async app => {
      try {
        const initial = await app.state();
        const builder = initial.experts.builder!;
        await invoke(app, "expert.save", {
          expertId: "builder",
          name: builder.name,
          specialization: builder.definition.specialization,
          instructions: builder.definition.instructions,
          tools: [],
          route: route(`capacity-${capacity}-builder`),
        });

        const start = performance.now();
        const deadline = Date.now() + CASE_TIMEOUT_MS;
        const starts = await beforeDeadline(Promise.all(Array.from({ length: ASSIGNMENTS_PER_CAPACITY }, async (_, index) => {
          const marker = `capacity-${capacity}-assignment-${index}`;
          return await invoke(app, "expert.converse", {
            expertId: "builder",
            workspaceId: app.workspaceId,
            requestId: marker,
            message: `Characterize native run admission for ${marker}`,
          }) as { readonly assignmentId: string; readonly conversationId: string };
        })), `capacity ${capacity} concurrent submissions`, deadline);
        expect(new Set(starts.map(result => result.assignmentId)).size).toBe(ASSIGNMENTS_PER_CAPACITY);
        expect(new Set(starts.map(result => result.conversationId)).size).toBe(ASSIGNMENTS_PER_CAPACITY);

        const terminal = await beforeDeadline(Promise.all(starts.map(result =>
          waitForAssignment(app, result.assignmentId, assignment =>
            !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status), CASE_TIMEOUT_MS),
        )), `capacity ${capacity} assignment handoffs`, deadline);
        const elapsedMs = performance.now() - start;
        expect(gate.peak()).toBe(capacity);
        expect(terminal).toHaveLength(ASSIGNMENTS_PER_CAPACITY);
        expect(new Set(terminal.map(assignment => assignment.runId)).size).toBe(ASSIGNMENTS_PER_CAPACITY);

        for (let index = 0; index < ASSIGNMENTS_PER_CAPACITY; index++) {
          const marker = `capacity-${capacity}-assignment-${index}`;
          const assignment = terminal.find(item => item.id === starts[index]!.assignmentId)!;
          expect(assignment.purpose).toBe(`Characterize native run admission for ${marker}`);
          expect(assignment.execution.tools).toEqual(["expert_return"]);
          expect(assignment.handoff?.disposition).toBe("result");
          expect(assignment.handoff?.output).toContain(marker);
          for (let other = 0; other < ASSIGNMENTS_PER_CAPACITY; other++) {
            if (other !== index) expect(assignment.handoff?.output).not.toContain(`capacity-${capacity}-assignment-${other}`);
          }
        }

        const rssBytes = process.memoryUsage().rss;
        console.log(JSON.stringify({
          kind: "experts-app-capacity-characterization",
          capacity,
          assignments: ASSIGNMENTS_PER_CAPACITY,
          observedProviderPeak: gate.peak(),
          elapsedMs: Number(elapsedMs.toFixed(1)),
          throughputAssignmentsPerSecond: Number((ASSIGNMENTS_PER_CAPACITY / (elapsedMs / 1000)).toFixed(2)),
          processRssBytes: rssBytes,
        }));
      } finally {
        gate.release();
      }
    }, { runCapacity: capacity });
  }
}, 150_000);
