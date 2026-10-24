import { expect, test } from "bun:test";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import type { Assignment } from "../src/experts/types.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { collaborationResponder, invoke, route, waitForAssignment, waitForRun, withExpertApp, type ExpertTestApp, type FakeResponder } from "./expert-helpers.ts";

const done = (model: string): ModelResponse => ({
  message: { role: "assistant", content: "Model-only answer with no workspace effects." },
  toolCalls: [], finishReason: "stop", model,
});

function gatedResponder() {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let active = 0;
  let peak = 0;
  const entered: string[] = [];
  const responder: FakeResponder = async (selectedRoute) => {
    active++;
    peak = Math.max(peak, active);
    entered.push(selectedRoute.model);
    try {
      await gate;
      return done(selectedRoute.model);
    } finally {
      active--;
    }
  };
  return { responder, entered, peak: () => peak, release: () => releaseGate() };
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(10);
  }
}

async function saveProfile(app: ExpertTestApp, expertId: "builder" | "critic", tools: string[]) {
  const current = await app.state();
  const expert = current.experts[expertId]!;
  await invoke(app, "expert.save", {
    expertId, name: expert.name, specialization: expert.definition.specialization,
    instructions: expert.definition.instructions, tools, route: route(`${expertId}-model`),
  });
}

async function startTurn(app: ExpertTestApp, expertId: "builder" | "critic", requestId: string) {
  return await invoke(app, "expert.converse", {
    expertId, workspaceId: app.workspaceId, message: `Parallel admission probe ${requestId}`, requestId,
  }) as { conversationId: string; assignmentId: string };
}

test("J-EXPERT-MODEL-PARALLEL: two model-only Experts overlap at configured capacity two", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", []);
    await saveProfile(app, "critic", []);
    try {
      const builder = await startTurn(app, "builder", "parallel-builder");
      await waitUntil(() => gate.entered.length === 1, "first model provider call");
      const critic = await startTurn(app, "critic", "parallel-critic");
      await waitUntil(() => gate.entered.length === 2, "second independent model provider call");
      expect(gate.peak()).toBe(2);
      expect(gate.entered).toEqual(["builder-model", "critic-model"]);
      gate.release();
      await Promise.all([
        waitForAssignment(app, builder.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, critic.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
});

test("J-EXPERT-MODEL-PARALLEL: default host capacity keeps independent runs serialized", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", []);
    await saveProfile(app, "critic", []);
    let first: { assignmentId: string } | undefined;
    let second: { assignmentId: string } | undefined;
    try {
      first = await startTurn(app, "builder", "serial-builder");
      await waitUntil(() => gate.entered.length === 1, "first model provider call");
      second = await startTurn(app, "critic", "serial-critic");
      await waitForAssignment(app, second.assignmentId, (assignment) => assignment.runId !== null);
      expect(gate.entered).toHaveLength(1);
      gate.release();
      await waitUntil(() => gate.entered.length === 2, "second model provider call after first settles");
      expect(gate.peak()).toBe(1);
      await Promise.all([
        waitForAssignment(app, first.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, second.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }
  });
});

test("J-EXPERT-MODEL-PARALLEL: host inspection reports configured capacity and policy only", async () => {
  await withExpertApp(collaborationResponder, async (app) => {
    const inspection = await invoke(app, "execution.runtime.inspect", {}) as { configuredCapacity: number; admissionPolicy: string };
    expect(inspection).toEqual({ configuredCapacity: 2, admissionPolicy: "model-only-parallel" });
    expect(Object.keys(inspection).sort()).toEqual(["admissionPolicy", "configuredCapacity"]);
  }, { runCapacity: 2 });
});

test("J-EXPERT-MODEL-PARALLEL: two tool-bearing Experts share the serialized admission group", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    await saveProfile(app, "critic", ["read"]);
    let builder: { assignmentId: string } | undefined;
    let critic: { assignmentId: string } | undefined;
    try {
      builder = await startTurn(app, "builder", "mixed-builder");
      await waitUntil(() => gate.entered.length === 1, "first tool-bearing provider call");
      critic = await startTurn(app, "critic", "mixed-critic");
      await waitForAssignment(app, critic.assignmentId, (assignment) => assignment.runId !== null);
      expect(gate.entered).toHaveLength(1);
      gate.release();
      await waitUntil(() => gate.entered.length === 2, "second tool-bearing provider call after serialization");
      expect(gate.peak()).toBe(1);
      await Promise.all([
        waitForAssignment(app, builder.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, critic.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }
    expect((await app.state()).assignments[critic!.assignmentId]!.execution.tools).toContain("read");
  }, { runCapacity: 2 });
});

test("J-EXPERT-MODEL-PARALLEL: profile edits preserve current snapshots and affect only later assignments", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", []);
    let assignment: { assignmentId: string } | undefined;
    try {
      assignment = await startTurn(app, "builder", "frozen-profile");
      await waitUntil(() => gate.entered.length === 1, "model provider call");
      await saveProfile(app, "builder", ["read"]);
      expect((await app.state()).assignments[assignment.assignmentId]!.execution.tools).toEqual(["expert_return"]);
      gate.release();
      await waitForAssignment(app, assignment.assignmentId, (current) => !!current.handoff && !["queued", "running", "waiting"].includes(current.status));
      const next = await startTurn(app, "builder", "updated-profile");
      const later = await waitForAssignment(app, next.assignmentId, (current) => !!current.handoff && !["queued", "running", "waiting"].includes(current.status));
      expect(later.execution.tools).toEqual(["read", "expert_return"]);
      expect(app.providerCalls.at(-1)?.toolNames).toContain("read");
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
});

test("J-EXPERT-MODEL-PARALLEL: forged workspace and collaboration calls fail before effects", async () => {
  const attacks = ["bash", "read", "team_delegate", "expert_memory_write"] as const;
  let attackIndex = 0;
  const responder: FakeResponder = async (selectedRoute, request) => {
    if (request.messages.some((message) => message.role === "tool")) return done(selectedRoute.model);
    const tool = attacks[attackIndex++]!;
    const arguments_: Record<string, string> = tool === "bash"
      ? { command: "touch MUST_NOT_EXIST" }
      : { expertId: "critic", purpose: "forged", text: "forged memory" };
    return {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: `forged-${tool}`, name: tool, arguments: arguments_ }],
      finishReason: "tool_calls", model: selectedRoute.model,
    };
  };
  await withExpertApp(responder, async (app) => {
    await saveProfile(app, "builder", []);
    for (const tool of attacks) {
      const started = await startTurn(app, "builder", `forged-${tool}`);
      const assignment = await waitForAssignment(app, started.assignmentId, (current: Assignment) => !!current.handoff && !["queued", "running", "waiting"].includes(current.status));
      expect(assignment.execution.tools).toEqual(["expert_return"]);
      expect(assignment.effects).toEqual({});
      expect(Object.keys((await app.state()).memory)).toHaveLength(0);
      const events: { eventType: string; payload: unknown }[] = [];
      for await (const event of app.app.runtime.service.events(LOCAL_OPERATOR, { runId: assignment.runId! })) events.push(event);
      expect(events.some((event) => event.eventType === "tool.call.failed" && (event.payload as { tool?: string }).tool === tool)).toBe(true);
      expect(events.some((event) => event.eventType === "tool.call.completed" && (event.payload as { tool?: string }).tool === tool)).toBe(false);
    }
    expect(Object.values((await app.state()).assignments).filter((assignment) => assignment.parentId)).toHaveLength(0);
  }, { runCapacity: 2 });
});

test("J-EXPERT-MODEL-PARALLEL: workspace rename waits behind an active tool-bearing Expert", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    const started = await startTurn(app, "builder", "rename-admission");
    try {
      await waitUntil(() => gate.entered.length === 1, "tool-bearing Expert provider call");
      const beforeRows = (await app.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
      const beforeTitle = (beforeRows.find((row) => row.key.endsWith(`record/${app.workspaceId}`))?.value as { title?: string } | undefined)?.title;
      const rename = invoke(app, "workspace.rename", { workspaceId: app.workspaceId, title: "Serialized Rename" });

      let renameRun: Awaited<ReturnType<typeof app.app.runtime.service.getRun>> | undefined;
      const deadline = Date.now() + 5_000;
      while (!renameRun) {
        const runs = await app.app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: "agent.config" });
        renameRun = runs.find((run) => {
          const input = run.input as { kind?: string; workspaceId?: string; title?: string };
          return input.kind === "workspace.renamed" && input.workspaceId === app.workspaceId && input.title === "Serialized Rename";
        });
        if (renameRun) break;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the workspace rename run to be admitted");
        await Bun.sleep(10);
      }

      // The RuntimeService may expose the durable execution intent as `running` before the
      // executor acquires its serialized resource key. The projection/event must remain untouched
      // until the active workspace-effect reader releases that key.
      expect(["queued", "running"]).toContain(renameRun.status);
      let observedRenameRun = renameRun;
      const holdUntil = Date.now() + 750;
      while (Date.now() < holdUntil && observedRenameRun.status !== "completed") {
        observedRenameRun = await app.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: renameRun.runId });
        if (observedRenameRun.status !== "completed") await Bun.sleep(10);
      }
      expect(observedRenameRun.status).not.toBe("completed");
      const whileHeld = (await app.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
      expect((whileHeld.find((row) => row.key.endsWith(`record/${app.workspaceId}`))?.value as { title?: string } | undefined)?.title).toBe(beforeTitle);
      expect(gate.entered).toHaveLength(1);

      gate.release();
      await rename;
      const renamedRun = await waitForRun(app, renameRun.runId);
      expect(renamedRun.status).toBe("completed");
      await app.app.runtime.idle();
      const afterRows = (await app.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
      expect((afterRows.find((row) => row.key.endsWith(`record/${app.workspaceId}`))?.value as { title?: string } | undefined)?.title).toBe("Serialized Rename");
      const renameEvents = [];
      for await (const event of app.app.runtime.service.events(LOCAL_OPERATOR, { runId: renameRun.runId })) {
        if (event.eventType === "workspace.renamed") renameEvents.push(event);
      }
      expect(renameEvents).toHaveLength(1);
      const assignment = await waitForAssignment(app, started.assignmentId, (current) => !!current.handoff && !["queued", "running", "waiting"].includes(current.status));
      expect(assignment.runId).not.toBeNull();
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
}, 20_000);

test("J-EXPERT-MODEL-PARALLEL: cooperative provider shutdown resumes the same assignment and run", async () => {
  let calls = 0;
  let firstCallAborted = false;
  const responder: FakeResponder = async (selectedRoute, _request, signal) => {
    calls++;
    if (calls === 1) {
      await new Promise<never>((_resolve, reject) => {
        const abort = () => {
          firstCallAborted = true;
          reject(signal?.reason ?? new DOMException("Provider call aborted during shutdown", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return done(selectedRoute.model);
  };

  await withExpertApp(responder, async (app) => {
    await saveProfile(app, "builder", []);
    const started = await startTurn(app, "builder", "shutdown-recovery");
    const initial = await waitForAssignment(app, started.assignmentId, (assignment) => assignment.runId !== null);
    const runId = initial.runId!;
    await waitUntil(() => calls === 1, "first provider call before restart");

    await app.restart();
    await waitUntil(() => calls === 2, "recovered provider call after restart", 10_000);
    expect(firstCallAborted).toBe(true);
    const recovered = await waitForAssignment(app, started.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status));
    expect(recovered.runId).toBe(runId);
    expect(recovered.handoff?.runId).toBe(runId);
    expect(recovered.handoff?.disposition).toBe("result");
    expect(calls).toBe(2);
    const run = await waitForRun(app, runId);
    expect(run.status).toBe("completed");
    const runs = await app.app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: "agent.expert" });
    expect(runs.filter((item) => item.runId === runId)).toHaveLength(1);
  });
}, 20_000);
