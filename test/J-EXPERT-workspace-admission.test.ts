// Journey J-EXPERT-WORKSPACE-ADMISSION (tranche T1): conflict-aware workspace-effect admission.
// Canonical per-resource keys are derived from authoritative state (Experts registry assignments,
// workspace records) — never from run-supplied input. Provably disjoint work overlaps at capacity;
// same-resource work serializes; forged or aliased identities are denied and fail closed to the
// global exclusion key. Every journey runs against the actual PostgreSQL store.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import type { RunView } from "@godspeedai/cognate-runtime-api";
import {
  createExpertAdmissionResourceKeys,
  workspaceResourceKey,
  WORKSPACE_EFFECTS_RESOURCE_KEY,
} from "../src/experts/admission.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { invoke, route, waitForAssignment, waitForRun, withExpertApp, type ExpertTestApp, type FakeResponder } from "./expert-helpers.ts";

const done = (model: string) => ({
  message: { role: "assistant" as const, content: `${model}: workspace admission probe complete.` },
  toolCalls: [], finishReason: "stop" as const, model,
});

function gatedResponder() {
  let releaseGate!: () => void;
  let gate = new Promise<void>((resolve) => { releaseGate = resolve; });
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
  return {
    responder,
    entered,
    peak: () => peak,
    release: () => releaseGate(),
    /** Re-arm the gate for later phases; calls after this await the fresh gate. */
    hold: () => { gate = new Promise<void>((resolve) => { releaseGate = resolve; }); },
  };
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
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
    instructions: expert.definition.instructions, tools, route: route(`${expertId}-ws-model`),
  });
}

async function startTurn(app: ExpertTestApp, expertId: "builder" | "critic", requestId: string, workspaceId: string) {
  return await invoke(app, "expert.converse", {
    expertId, workspaceId, message: `Workspace admission probe ${requestId}`, requestId,
  }) as { conversationId: string; assignmentId: string };
}

/** The real admission lookup wired exactly like the server: authoritative Experts registry plus
 * the live projections of this app. */
function lookupFor(app: ExpertTestApp) {
  const service = app.app.runtime.service;
  return createExpertAdmissionResourceKeys({
    ready: async () => new ExpertsService(service, { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant }),
    getService: async () => service,
  });
}

async function runViewFor(app: ExpertTestApp, runId: string): Promise<RunView> {
  return await app.app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
}

test("J-EXPERT-WORKSPACE-ADMISSION: two tool-bearing Experts on different workspaces overlap at capacity two", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    await saveProfile(app, "critic", ["read"]);
    const secondRoot = join(app.home, "workspace-b");
    await mkdir(secondRoot, { recursive: true });
    const second = await invoke(app, "workspace.select", { path: secondRoot }) as { workspaceId: string };
    expect(second.workspaceId).not.toBe(app.workspaceId);
    try {
      const builder = await startTurn(app, "builder", "disjoint-builder", app.workspaceId);
      await waitUntil(() => gate.entered.length === 1, "first tool-bearing provider call");
      const critic = await startTurn(app, "critic", "disjoint-critic", second.workspaceId);
      await waitUntil(() => gate.entered.length === 2, "second tool-bearing provider call on a different workspace");
      expect(gate.peak()).toBe(2);
      expect(gate.entered).toEqual(["builder-ws-model", "critic-ws-model"]);
      // While both runs are active, the authoritative lookup agrees: disjoint workspaces hold
      // disjoint resource keys.
      const builderBound = await waitForAssignment(app, builder.assignmentId, (assignment) => assignment.runId !== null);
      const criticBound = await waitForAssignment(app, critic.assignmentId, (assignment) => assignment.runId !== null);
      const lookup = lookupFor(app);
      expect(await lookup(await runViewFor(app, builderBound.runId!))).toEqual([workspaceResourceKey(app.workspaceId)]);
      expect(await lookup(await runViewFor(app, criticBound.runId!))).toEqual([workspaceResourceKey(second.workspaceId)]);
      gate.release();
      const [builderDone, criticDone] = await Promise.all([
        waitForAssignment(app, builder.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, critic.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
      expect(builderDone.workspaceId).toBe(app.workspaceId);
      expect(criticDone.workspaceId).toBe(second.workspaceId);
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
}, 30_000);

test("J-EXPERT-WORKSPACE-ADMISSION: aliased spellings of one workspace canonicalize to one key and serialize", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    await saveProfile(app, "critic", ["read"]);
    // A second spelling of the same directory: `workspace-b/../workspace` resolves to the same
    // provider root, so selection canonicalizes it to the existing record and one resource key.
    const aliasSpelling = `${app.home}/workspace-b/../workspace`;
    const aliased = await invoke(app, "workspace.select", { path: aliasSpelling }) as { workspaceId: string };
    expect(aliased.workspaceId).toBe(app.workspaceId);
    try {
      const builder = await startTurn(app, "builder", "alias-builder", app.workspaceId);
      await waitUntil(() => gate.entered.length === 1, "first tool-bearing provider call");
      const critic = await startTurn(app, "critic", "alias-critic", aliased.workspaceId);
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
  }, { runCapacity: 2 });
}, 30_000);


test("J-EXPERT-WORKSPACE-ADMISSION: a forged workspace identity is denied effects and fails closed to exclusion", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    try {
      // The Assignment names a workspace that is absent from authoritative records.
      const forged = await startTurn(app, "builder", "forged-identity", "workspace-does-not-exist");
      const failed = await waitForAssignment(app, forged.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status));
      // The run cannot reach any workspace effect: authoritative path resolution refuses it
      // before a model call, and no provider was ever entered.
      expect(gate.entered).toHaveLength(0);
      expect(failed.handoff?.disposition).toBe("failed");

      // A coding run claiming the same absent identity fails closed to the global exclusion group
      // (never a workspace key that could collide with and deny genuine work), and the real run is
      // denied its effects by authoritative path resolution.
      const sessionId = randomUUID();
      const forgedRun = await app.client.startRun("agent.coding", {
        sessionId, workspaceId: "workspace-does-not-exist", message: "forged identity probe",
      } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
      expect(await lookupFor(app)(await runViewFor(app, forgedRun.runId))).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
      const denied = await waitForRun(app, forgedRun.runId);
      expect(denied.status).toBe("failed");

      // The genuine coding run on the authoritative workspace holds exactly its workspace key.
      const genuineSession = randomUUID();
      const genuineRun = await app.client.startRun("agent.coding", {
        sessionId: genuineSession, workspaceId: app.workspaceId, message: "genuine identity probe",
      } as never, { idempotencyKey: randomUUID(), correlationId: `session:${genuineSession}` });
      expect(await lookupFor(app)(await runViewFor(app, genuineRun.runId))).toEqual([workspaceResourceKey(app.workspaceId)]);
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
}, 30_000);

test("J-EXPERT-WORKSPACE-ADMISSION: per-resource keys survive a restart and still serialize shared work", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await saveProfile(app, "builder", ["read"]);
    await saveProfile(app, "critic", ["read"]);
    await app.restart();
    // The restarted app re-derives both workspaces from durable authoritative records.
    const secondRoot = join(app.home, "workspace-b");
    await mkdir(secondRoot, { recursive: true });
    const second = await invoke(app, "workspace.select", { path: secondRoot }) as { workspaceId: string };
    expect(second.workspaceId).not.toBe(app.workspaceId);
    try {
      // Disjoint workspaces overlap after restart: keys come from durable records.
      const first = await startTurn(app, "builder", "restart-disjoint-a", app.workspaceId);
      await waitUntil(() => gate.entered.length === 1, "first tool-bearing provider call after restart");
      const other = await startTurn(app, "critic", "restart-disjoint-b", second.workspaceId);
      await waitUntil(() => gate.entered.length === 2, "disjoint tool-bearing provider call after restart");
      expect(gate.peak()).toBe(2);
      const firstBound = await waitForAssignment(app, first.assignmentId, (assignment) => assignment.runId !== null);
      const otherBound = await waitForAssignment(app, other.assignmentId, (assignment) => assignment.runId !== null);
      const lookup = lookupFor(app);
      expect(await lookup(await runViewFor(app, firstBound.runId!))).toEqual([workspaceResourceKey(app.workspaceId)]);
      expect(await lookup(await runViewFor(app, otherBound.runId!))).toEqual([workspaceResourceKey(second.workspaceId)]);
      gate.release();
      await Promise.all([
        waitForAssignment(app, first.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, other.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);

      // Shared work still serializes after restart: a second run on the held workspace waits.
      gate.hold();
      const sharedA = await startTurn(app, "builder", "restart-shared-a", app.workspaceId);
      await waitUntil(() => gate.entered.length === 3, "first shared-workspace provider call after restart");
      const sharedB = await startTurn(app, "critic", "restart-shared-b", app.workspaceId);
      await waitForAssignment(app, sharedB.assignmentId, (assignment) => assignment.runId !== null);
      expect(gate.entered).toHaveLength(3);
      gate.release();
      await waitUntil(() => gate.entered.length === 4, "second shared-workspace provider call after serialization");
      expect(gate.peak()).toBe(2);
      await Promise.all([
        waitForAssignment(app, sharedA.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, sharedB.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }
  }, { runCapacity: 2 });
}, 60_000);

