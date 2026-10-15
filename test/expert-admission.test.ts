import { describe, expect, test } from "bun:test";
import type { RunView } from "@godspeedai/cognate-runtime-api";
import { assertModelOnlyExpertRun, createExpertAdmissionResourceKeys, parseExpertAdmissionCapacity, WORKSPACE_EFFECTS_RESOURCE_KEY } from "../src/experts/admission.ts";
import { emptyExpertState, type Assignment } from "../src/experts/types.ts";
import { seedExperts } from "../src/experts/state.ts";

const system = { actor: { id: "system", kind: "system" as const }, tenant: "tenant-a" };

function fixture() {
  const state = emptyExpertState();
  seedExperts(state);
  const assignment: Assignment = {
    id: "assignment-a", expertId: "builder", conversationId: "conversation-a", teamId: null, parentId: null,
    purpose: "Answer the question", acceptance: ["Return evidence"], depth: 0, attempt: 2, status: "running",
    workspaceId: "workspace-a", mode: "read-only", authorityTools: ["expert_return"],
    execution: {
      expertId: "builder", assignmentId: "assignment-a", conversationId: "conversation-a", instructions: "Answer",
      route: { providerId: "provider", model: "model", baseURL: "https://example.test", protocol: "openai-compatible" },
      tools: ["expert_return"], maxSteps: 4, context: [],
    },
    runId: "run-a", handoff: null, reconciled: false, review: null, settlement: null, effects: {},
  };
  state.assignments[assignment.id] = assignment;
  const run: RunView = {
    runId: "run-a", agent: "agent.expert", tenant: "tenant-a", status: "running",
    input: { assignmentId: assignment.id, attempt: assignment.attempt }, output: {}, error: null,
    correlationId: "corr-a", startedBy: system.actor.id, waitingOn: [],
  };
  return { state, assignment, run };
}

describe("J-EXPERT-MODEL-PARALLEL admission", () => {
  test("admits a genuine model-only run using the frozen execution tool list", () => {
    const { state, run } = fixture();
    assertModelOnlyExpertRun(run, state, system.actor.id);
  });

  test("denies forged sender, wrong agent, mismatched run, stale attempt and inactive Expert", () => {
    const { state, assignment, run } = fixture();
    expect(() => assertModelOnlyExpertRun({ ...run, startedBy: "operator" }, state, system.actor.id)).toThrow("system-started");
    expect(() => assertModelOnlyExpertRun({ ...run, agent: "agent.coding" }, state, system.actor.id)).toThrow("system-started");
    expect(() => assertModelOnlyExpertRun({ ...run, runId: "forged-run" }, state, system.actor.id)).toThrow("another run");
    expect(() => assertModelOnlyExpertRun({ ...run, input: { assignmentId: assignment.id, attempt: 1 } }, state, system.actor.id)).toThrow("stale or terminal");
    state.experts.builder!.lifecycle = "archived";
    expect(() => assertModelOnlyExpertRun(run, state, system.actor.id)).toThrow("no longer active");
  });

  test("uses the frozen tool allowlist despite profile edits and denies tool-bearing or changed authority", () => {
    const { state, assignment, run } = fixture();
    state.experts.builder!.definition.tools = ["read", "edit", "bash", "expert_return"];
    assertModelOnlyExpertRun(run, state, system.actor.id);
    state.experts.builder!.definition.tools = [];
    assignment.authorityTools = [];
    assertModelOnlyExpertRun(run, state, system.actor.id);
    assignment.execution.tools = ["expert_return", "bash"];
    expect(assertModelOnlyExpertRun(run, state, system.actor.id)).toBe(false);
    assignment.execution.tools = [];
    expect(() => assertModelOnlyExpertRun(run, state, system.actor.id)).toThrow("missing intrinsic");
    assignment.execution.tools = ["expert_return"];
  });

  test("denies stale Team membership and unresolved effects", () => {
    const { state, assignment, run } = fixture();
    assignment.teamId = "cognate-team";
    state.experts.builder!.definition.tools = [];
    state.teams["cognate-team"]!.tools = [];
    const member = state.teams["cognate-team"]!.members.find((item) => item.expertId === assignment.expertId)!;
    member.tools = [];
    expect(assertModelOnlyExpertRun(run, state, system.actor.id)).toBe(true);
    Reflect.set(member, "role", "unrecognized");
    expect(() => assertModelOnlyExpertRun(run, state, system.actor.id)).toThrow("role is invalid");
    Reflect.set(member, "role", "specialist");
    state.teams["cognate-team"]!.members = state.teams["cognate-team"]!.members.filter((member) => member.expertId !== assignment.expertId);
    expect(() => assertModelOnlyExpertRun(run, state, system.actor.id)).toThrow("Team member");
    assignment.teamId = null;
    assignment.effects = { effect: { commitmentId: "commitment-a", state: "UNKNOWN_RECONCILIATION_REQUIRED", tool: "bash" } };
    expect(() => assertModelOnlyExpertRun(run, state, system.actor.id)).toThrow("unresolved external effects");
  });

  test("keeps Team Orchestrators serialized while Team Specialists and solo model-only runs can overlap", () => {
    const { state, assignment, run } = fixture();
    expect(assertModelOnlyExpertRun(run, state, system.actor.id)).toBe(true);
    assignment.teamId = "cognate-team";
    expect(assertModelOnlyExpertRun(run, state, system.actor.id)).toBe(true);
    state.teams["cognate-team"]!.members.find((member) => member.expertId === assignment.expertId)!.role = "orchestrator";
    expect(assertModelOnlyExpertRun(run, state, system.actor.id)).toBe(false);
  });

  test("returns before readiness for boot config and serializes coding or unknown agents", async () => {
    let readyCalls = 0;
    const resourceKeys = createExpertAdmissionResourceKeys(async () => {
      readyCalls++;
      throw new Error("registry is not ready");
    });
    const { run } = fixture();
    expect(await resourceKeys({ ...run, agent: "agent.config" })).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    expect(readyCalls).toBe(0);
    expect(await resourceKeys({ ...run, agent: "agent.coding" })).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    expect(await resourceKeys({ ...run, agent: "agent.future" })).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    expect(readyCalls).toBe(0);
  });

  test("fails closed on expert readiness failure and accepts only the startup capacity set", async () => {
    const resourceKeys = createExpertAdmissionResourceKeys(async () => { throw new Error("not ready"); });
    const { run } = fixture();
    await expect(resourceKeys(run)).rejects.toThrow("not ready");
    expect([undefined, "", "1", "2", "4", "8"].map(parseExpertAdmissionCapacity)).toEqual([1, 1, 1, 2, 4, 8]);
    for (const invalid of ["3", "0", "2.5", "NaN"]) expect(() => parseExpertAdmissionCapacity(invalid)).toThrow(RangeError);
  });
});
