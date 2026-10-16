import { describe, expect, test } from "bun:test";
import type { Caller, RunView, RuntimeService } from "@godspeedai/cognate-runtime-api";
import {
  assertModelOnlyExpertRun,
  createExpertAdmissionResourceKeys,
  parseExpertAdmissionCapacity,
  teamAdmissionKeys,
  teamAdmissionKey,
  workspaceResourceKey,
  worldResourceKey,
  CONFIGURATION_RESOURCE_KEY,
  WORKSPACE_EFFECTS_RESOURCE_KEY,
} from "../src/experts/admission.ts";
import type { ExpertsService } from "../src/experts/service.ts";
import { emptyExpertState, type Assignment, type ExpertState } from "../src/experts/types.ts";
import { seedExperts } from "../src/experts/state.ts";

const system = { actor: { id: "system", kind: "system" as const }, tenant: "tenant-a" };

/** Minimal projection source: the authoritative `workspaces` records these tests reason over. */
function fakeService(workspaceIds: readonly string[]): RuntimeService {
  return {
    async readProjection(_caller: Caller, request: { name: string }) {
      if (request.name !== "workspaces") return { rows: [] };
      return {
        rows: workspaceIds.map((id) => ({
          key: `record/${id}`,
          value: { id, root: `/srv/${id}`, title: id, executionWorldId: "local" },
        })),
      };
    },
  } as unknown as RuntimeService;
}

function fakeExperts(state: ExpertState, run: RunView): ExpertsService {
  return {
    systemCaller: system,
    caller: (tenant: string) => ({ actor: system.actor, tenant }),
    service: { getRun: async () => run },
    state: async () => state,
  } as unknown as ExpertsService;
}

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

  test("classifies boot config, coding and unknown agents without Expert readiness", async () => {
    let readyCalls = 0;
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => {
        readyCalls++;
        throw new Error("registry is not ready");
      },
      getService: async () => fakeService([]),
    });
    const { run } = fixture();
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "settings.changed" } })).toEqual([CONFIGURATION_RESOURCE_KEY]);
    expect(await resourceKeys({ ...run, agent: "agent.coding", input: { workspaceId: "workspace-a" } })).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    expect(await resourceKeys({ ...run, agent: "agent.future" })).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    expect(readyCalls).toBe(0);
  });

  test("fails closed on expert readiness failure and accepts only the startup capacity set", async () => {
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => { throw new Error("not ready"); },
      getService: async () => fakeService([]),
    });
    const { run } = fixture();
    await expect(resourceKeys(run)).rejects.toThrow("not ready");
    expect([undefined, "", "1", "2", "4", "8"].map(parseExpertAdmissionCapacity)).toEqual([1, 1, 1, 2, 4, 8]);
    for (const invalid of ["3", "0", "2.5", "NaN"]) expect(() => parseExpertAdmissionCapacity(invalid)).toThrow(RangeError);
  });

  test("keys tool-bearing work by its authoritative Assignment workspace, never by run input", async () => {
    const { run, state } = fixture();
    state.assignments["assignment-a"]!.execution.tools = ["expert_return", "read"];
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => fakeExperts(state, run),
      getService: async () => fakeService(["workspace-a"]),
    });
    expect(await resourceKeys(run)).toEqual([workspaceResourceKey("workspace-a")]);
    // A forged run input claiming another workspace cannot move the key off the registry record.
    expect(await resourceKeys({ ...run, input: { assignmentId: "assignment-a", attempt: 2, workspaceId: "workspace-forged" } }))
      .toEqual([workspaceResourceKey("workspace-a")]);
  });

  test("denies forged or aliased workspace identities and fails closed to the global exclusion key", async () => {
    const { run, state } = fixture();
    state.assignments["assignment-a"]!.execution.tools = ["expert_return", "read"];
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => fakeExperts(state, run),
      getService: async () => fakeService(["workspace-a"]),
    });
    // The Assignment names a workspace that is absent from authoritative records.
    state.assignments["assignment-a"]!.workspaceId = "workspace-forged";
    expect(await resourceKeys(run)).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    // A coding run that claims an absent workspace identity is excluded as well.
    expect(await resourceKeys({ ...run, agent: "agent.coding", input: { workspaceId: "workspace-forged" } }))
      .toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
    // Unresolvable configuration records fail closed; only the established record keys the work.
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "workspace.deleted", workspaceId: "workspace-forged" } }))
      .toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
  });

  test("configuration runs key the exact records they name, and world mutators enumerate their workspaces", async () => {
    const { run } = fixture();
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => { throw new Error("configuration must not wait on Expert boot"); },
      getService: async () => fakeService(["workspace-a", "workspace-b"]),
    });
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "workspace.renamed", workspaceId: "workspace-a", title: "Renamed" } }))
      .toEqual([CONFIGURATION_RESOURCE_KEY, workspaceResourceKey("workspace-a")]);
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "workspace.added", workspaceId: "workspace-c", executionWorldId: "world-c" } }))
      .toEqual([CONFIGURATION_RESOURCE_KEY, workspaceResourceKey("workspace-c"), worldResourceKey("world-c")]);
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "execution.world.disconnected", worldId: "local" } }))
      .toEqual([CONFIGURATION_RESOURCE_KEY, worldResourceKey("local"), workspaceResourceKey("workspace-a"), workspaceResourceKey("workspace-b")]);
    expect(await resourceKeys({ ...run, agent: "agent.config", input: { kind: "execution.world.disconnected", worldId: "world-unknown" } }))
      .toEqual([CONFIGURATION_RESOURCE_KEY, worldResourceKey("world-unknown")]);
    expect(await resourceKeys({ ...run, agent: "agent.cognitive", input: { eventType: "world.settled", payload: { worldId: "local" } } }))
      .toEqual([CONFIGURATION_RESOURCE_KEY, worldResourceKey("local")]);
    expect(await resourceKeys({ ...run, agent: "agent.cognitive", input: { eventType: "forged.event", payload: {} } }))
      .toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);
  });

  test("Team admission policy resolves from authoritative Team metadata and bounds concurrency by lanes", async () => {
    const { run, state, assignment } = fixture();
    // Solo model-only work holds no key at all (unchanged overlap semantics).
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([]);

    // A Team run holds exactly one admission lane from the Team's authoritative policy.
    assignment.teamId = "cognate-team";
    state.teams["cognate-team"]!.limits.maxConcurrentRuns = 2;
    state.teams["cognate-team"]!.limits.admissionBatch = 1;
    const laneOf = (keys: readonly string[]) => keys[0];
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([teamAdmissionKey("cognate-team", 0)]);
    // A second active Team run occupies the first lane, so a third takes the next one.
    state.assignments["assignment-b"] = { ...assignment, id: "assignment-b", runId: "run-b", teamId: "cognate-team" };
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([teamAdmissionKey("cognate-team", 1)]);
    // Policy one serializes every run on one lane even when the process is free.
    state.teams["cognate-team"]!.limits.maxConcurrentRuns = 1;
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([teamAdmissionKey("cognate-team", 0)]);
    expect(laneOf(teamAdmissionKeys(state, "assignment-b"))).toBe(teamAdmissionKey("cognate-team", 0));

    // Invalid policy fails closed to one lane; an unknown Team fails closed to exclusion.
    state.teams["cognate-team"]!.limits.maxConcurrentRuns = 99;
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([teamAdmissionKey("cognate-team", 0)]);
    assignment.teamId = "team-missing";
    expect(teamAdmissionKeys(state, assignment.id)).toEqual([WORKSPACE_EFFECTS_RESOURCE_KEY]);

    // The lookup composes the Team lane with workspace keys for tool-bearing Team work.
    assignment.teamId = "cognate-team";
    state.teams["cognate-team"]!.limits.maxConcurrentRuns = 2;
    assignment.execution.tools = ["expert_return", "read"];
    const resourceKeys = createExpertAdmissionResourceKeys({
      ready: async () => fakeExperts(state, run),
      getService: async () => fakeService(["workspace-a"]),
    });
    expect([...(await resourceKeys(run))].sort()).toEqual([teamAdmissionKey("cognate-team", 1), workspaceResourceKey("workspace-a")].sort());
    // A model-only Team run holds only its lane — never a workspace key.
    assignment.execution.tools = ["expert_return"];
    expect(await resourceKeys(run)).toEqual([teamAdmissionKey("cognate-team", 1)]);
  });
});
