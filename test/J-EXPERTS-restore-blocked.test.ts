// J-EXPERTS-RESTORE (#110): when the default Team is missing and a built-in Expert it requires is
// archived, restore never builds a Team around an archived member. Without the explicit
// `includeArchived` request the Team is reported as a typed prerequisite; with it the Expert is
// reactivated first and the Team created, so no intermediate state violates the Team invariants.
import { describe, expect, test } from "bun:test";
import { emptyExpertState } from "../src/experts/types.ts";
import { assertTeamInvariant, mutateExperts, restoreExperts, seedExperts } from "../src/experts/state.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { withExpertApp } from "./expert-helpers.ts";
import { bootApp, withTempHome } from "./wb-helpers.ts";

type Report = { created: string[]; reactivated: string[]; kept: string[]; blocked?: { teamId: string; reason: string; requires: { reactivate: string[] }; message: string }[] };
const EXPERTS = ["product-manager", "builder", "critic", "verifier", "reviewer"];

function brokenState() {
  const state = emptyExpertState();
  seedExperts(state);
  delete state.teams["cognate-team"];
  state.experts.builder!.lifecycle = "archived";
  delete state.experts.critic; // absent built-in: must still be created
  return state;
}

describe("J-EXPERTS-RESTORE blocked default Team (state)", () => {
  test("without explicit reactivation: no Team, Expert stays archived, prerequisite is typed, others restored", () => {
    const state = brokenState();
    const report = restoreExperts(state, false) as Report;
    expect(state.teams["cognate-team"]).toBeUndefined();
    expect(state.experts.builder!.lifecycle).toBe("archived");
    expect(state.experts.critic!.lifecycle).toBe("active");
    expect(report.created).toEqual(["critic"]);
    expect(report.reactivated).toEqual([]);
    expect(report.kept).toEqual(["product-manager", "builder", "verifier", "reviewer"]);
    expect(report.blocked).toHaveLength(1);
    expect(report.blocked![0]).toMatchObject({ teamId: "cognate-team", reason: "required-expert-archived", requires: { reactivate: ["builder"] } });
    expect(report.blocked![0]!.message).toContain("builder");
    expect(report.blocked![0]!.message).toContain("includeArchived");
  });

  test("with explicit reactivation: Expert reactivated first, Team created with one Team Lead", () => {
    const state = brokenState();
    const report = restoreExperts(state, true) as Report;
    expect(report.created).toEqual(["critic", "cognate-team"]);
    expect(report.reactivated).toEqual(["builder"]);
    expect(report.kept).toEqual(["product-manager", "verifier", "reviewer"]);
    expect(report.blocked).toBeUndefined();
    const team = state.teams["cognate-team"]!;
    expect(team.members.filter(m => m.role === "orchestrator")).toHaveLength(1);
    assertTeamInvariant(state, team);
  });

  test("following the report's prerequisite satisfies it", () => {
    const state = brokenState();
    const first = restoreExperts(state, false) as Report;
    expect(first.blocked![0]!.requires.reactivate).toEqual(["builder"]);
    const second = restoreExperts(state, true) as Report;
    expect(second.created).toEqual(["cognate-team"]);
    expect(second.reactivated).toEqual(["builder"]);
  });
});

// The Team/Expert fixture is written as the system caller: no capability can reach this state.
const SYSTEM = { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant } as never;
const breakDefaultTeam = (service: unknown) => mutateExperts(service as never, SYSTEM, "break-default-team", { k: "break" }, s => { delete s.teams["cognate-team"]; s.experts.builder!.lifecycle = "archived"; });

const idle = { message: { role: "assistant" as const, content: "unused" }, toolCalls: [], finishReason: "stop" as const, model: "unused" };

describe("J-EXPERTS-RESTORE blocked default Team (capability)", () => {
  test("operator restore reports the prerequisite, then reactivates and creates the Team on explicit request; callers refused", async () => {
    await withExpertApp(async () => idle, async (app) => {
      const experts = new ExpertsService(app.app.runtime.service, LOCAL_OPERATOR);
      await breakDefaultTeam(app.app.runtime.service);
      const invoke = (input: unknown) => app.client.invoke("experts.restore", input as never) as Promise<Report>;

      const blocked = await invoke({});
      expect(blocked.created).toEqual([]);
      expect(blocked.blocked![0]).toMatchObject({ teamId: "cognate-team", reason: "required-expert-archived", requires: { reactivate: ["builder"] } });
      const mid = await app.state();
      expect(mid.teams["cognate-team"]).toBeUndefined();
      expect(mid.experts.builder!.lifecycle).toBe("archived");

      const agent = { actor: { id: "wb-agent:coding", kind: "agent" as const }, tenant: LOCAL_OPERATOR.tenant };
      await expect(app.app.runtime.service.invoke(agent as never, { capability: "experts.restore", input: { includeArchived: true } as never })).rejects.toThrow(/human operator/);
      await expect(experts.command("experts.restore", { includeArchived: true }, { actor: { id: "operator", kind: "user" }, tenant: LOCAL_OPERATOR.tenant, runId: "run-1" } as never)).rejects.toThrow(/inside a run/);
      expect((await app.state()).experts.builder!.lifecycle).toBe("archived");

      const done = await invoke({ includeArchived: true });
      expect(done).toEqual({ created: ["cognate-team"], reactivated: ["builder"], kept: EXPERTS.filter(id => id !== "builder") });
      const after = await app.state();
      expect(after.experts.builder!.lifecycle).toBe("active");
      expect(after.teams["cognate-team"]!.members.filter(m => m.role === "orchestrator")).toHaveLength(1);
      assertTeamInvariant(after, after.teams["cognate-team"]!);
    });
  }, 30000);

  test("under safe mode recovery stays operator-only and both variants behave the same", async () => {
    await withTempHome(async (home) => {
      const first = await bootApp(home);
      try {
        await new LifecycleRecorder(first.app.runtime.store, "local").commitBatch("safemode", [{ type: "capability.presentation.faulted", payload: { fragmentKey: "test", capabilityId: "test", faultClass: "core-violation" } }]);
      } finally { await first.app.runtime.idle().catch(() => {}); await first.client.close(); await first.app.stop(); }
      const second = await bootApp(home);
      try {
        expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: true });
        const experts = new ExpertsService(second.app.runtime.service, LOCAL_OPERATOR);
        await breakDefaultTeam(second.app.runtime.service);
        const agent = { actor: { id: "wb-agent:probe", kind: "agent" as const }, tenant: "local" };
        await expect(second.app.runtime.service.invoke(agent, { capability: "experts.restore", input: { includeArchived: true } })).rejects.toThrow(/human operator/);
        await expect(experts.command("experts.restore", { includeArchived: true }, { actor: { id: "operator", kind: "user" }, tenant: LOCAL_OPERATOR.tenant, runId: "run-1" } as never)).rejects.toThrow(/inside a run/);
        const blocked = await second.client.invoke("experts.restore", {}) as Report;
        expect(blocked.blocked![0]).toMatchObject({ teamId: "cognate-team", requires: { reactivate: ["builder"] } });
        const done = await second.client.invoke("experts.restore", { includeArchived: true }) as Report;
        expect(done.created).toEqual(["cognate-team"]);
        expect(done.reactivated).toEqual(["builder"]);
        expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: true });
      } finally { await second.app.runtime.idle().catch(() => {}); await second.client.close(); await second.app.stop(); }
    });
  }, 60000);
});
