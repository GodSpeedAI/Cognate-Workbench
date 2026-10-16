// Journey J-TEAM-ADMISSION (tranche T2): Team admission and batching policy. The policy
// (maximum concurrent runs, admission batch) resolves ONLY from authoritative Team metadata;
// client-supplied policy is refused. A Team exceeding its policy waits even when host capacity is
// free; queued roots dispatch in the Team's authoritative batch. Every journey runs against the
// actual PostgreSQL store.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import type { Team } from "../src/experts/types.ts";
import { configureDefaultRoutes, invoke, waitForAssignment, withExpertApp, type ExpertTestApp, type FakeResponder } from "./expert-helpers.ts";

const done = (model: string): ModelResponse => ({
  message: { role: "assistant", content: `${model}: team admission probe complete.` },
  toolCalls: [], finishReason: "stop", model,
});

function gatedResponder() {
  let releaseGate!: () => void;
  let gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const entered: string[] = [];
  let peak = 0;
  let active = 0;
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
    responder, entered, peak: () => peak,
    release: () => releaseGate(),
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

async function setTeamPolicy(app: ExpertTestApp, limits: Partial<Team["limits"]>) {
  const current = await app.state();
  const team = current.teams["cognate-team"]!;
  await invoke(app, "team.save", {
    teamId: "cognate-team", name: team.name, tools: [],
    limits: { ...team.limits, ...limits },
  });
}

async function startTeamTurn(app: ExpertTestApp, requestId: string, workspaceId: string) {
  return await invoke(app, "team.converse", {
    teamId: "cognate-team", workspaceId, message: `Team admission probe ${requestId}`, requestId,
  }) as { conversationId: string; assignmentId: string };
}

test("J-TEAM-ADMISSION: a Team exceeding its authoritative policy waits even when process capacity is free", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await configureDefaultRoutes(app);
    // Authoritative policy: one concurrent run; both queued roots still dispatch (batch two).
    await setTeamPolicy(app, { maxConcurrentRuns: 1, admissionBatch: 2 });
    const secondRoot = join(app.home, "workspace-b");
    await mkdir(secondRoot, { recursive: true });
    const second = await invoke(app, "workspace.select", { path: secondRoot }) as { workspaceId: string };
    try {
      // Disjoint workspaces: only the Team lane can serialize these runs at capacity four.
      const first = await startTeamTurn(app, "policy-one", app.workspaceId);
      await waitUntil(() => gate.entered.length === 1, "first Team provider call");
      const other = await startTeamTurn(app, "policy-two", second.workspaceId);
      await waitForAssignment(app, other.assignmentId, (assignment) => assignment.runId !== null);
      // Both runs were dispatched (the batch admits two) but the second is serialized by the
      // Team's single admission lane even though three of four host slots are free.
      expect(gate.entered).toHaveLength(1);
      gate.release();
      await waitUntil(() => gate.entered.length === 2, "second Team provider call after the lane frees");
      expect(gate.peak()).toBe(1);
      await Promise.all([
        waitForAssignment(app, first.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, other.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);

      // Raising the authoritative policy to two lets disjoint Team runs overlap at the same
      // capacity — the policy, not the process, decided the earlier serialization.
      await setTeamPolicy(app, { maxConcurrentRuns: 2, admissionBatch: 2 });
      gate.hold();
      const third = await startTeamTurn(app, "policy-three", app.workspaceId);
      await waitUntil(() => gate.entered.length === 3, "first provider call under policy two");
      const fourth = await startTeamTurn(app, "policy-four", second.workspaceId);
      await waitUntil(() => gate.entered.length === 4, "second provider call overlapping under policy two");
      expect(gate.peak()).toBe(2);
      gate.release();
      await Promise.all([
        waitForAssignment(app, third.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, fourth.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }
  }, { runCapacity: 4 });
}, 60_000);

test("J-TEAM-ADMISSION: queued roots dispatch in the authoritative batch and client policy is refused", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await configureDefaultRoutes(app);
    // Authoritative policy: two concurrent runs allowed, but dispatch in batches of one.
    await setTeamPolicy(app, { maxConcurrentRuns: 2, admissionBatch: 1 });
    try {
      const first = await startTeamTurn(app, "batch-one", app.workspaceId);
      await waitUntil(() => gate.entered.length === 1, "first Team provider call");
      const second = await startTeamTurn(app, "batch-two", app.workspaceId);
      await Bun.sleep(150);
      // The batch policy keeps the second root undispatched while the first is unfinished, even
      // though the Team's concurrency limit would allow two.
      expect((await app.state()).assignments[second.assignmentId]!.runId).toBeNull();
      expect(gate.entered).toHaveLength(1);
      gate.release();
      await waitForAssignment(app, second.assignmentId, (assignment) => assignment.runId !== null);
      await Promise.all([
        waitForAssignment(app, first.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, second.assignmentId, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
    } finally {
      gate.release();
    }

    // T2 tooth: stale or unauthorized client-supplied Team policy is refused — only authoritative
    // Team metadata (team.save) decides admission.
    for (const capability of ["team.converse", "expert.converse"] as const) {
      const input = capability === "team.converse"
        ? { teamId: "cognate-team", workspaceId: app.workspaceId, message: "forged policy", requestId: `forged-${capability}` }
        : { expertId: "builder", workspaceId: app.workspaceId, message: "forged policy", requestId: `forged-${capability}` };
      await expect(invoke(app, capability, { ...input, maxConcurrentRuns: 8 })).rejects.toThrow("Client-supplied Team policy is refused");
      await expect(invoke(app, capability, { ...input, admissionBatch: 8 })).rejects.toThrow("Client-supplied Team policy is refused");
      await expect(invoke(app, capability, { ...input, policy: { maxConcurrentRuns: 8 } })).rejects.toThrow("Client-supplied Team policy is refused");
    }
  }, { runCapacity: 4 });
}, 60_000);

