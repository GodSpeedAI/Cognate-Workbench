// J-EXPERTS-RESTORE: operator-only recovery of the built-in Experts and the default Team.
// D-minimal-contracts D3 / I-closure-register O5: restore is VERBATIM — it creates baseline ids
// that are absent and, only on explicit request, reactivates baseline ids the operator archived.
// An active baseline id is never modified, no custom id is ever touched, and both an in-Run
// caller and a non-operator actor are refused.
import { describe, expect, test } from "bun:test";
import { emptyExpertState } from "../src/experts/types.ts";
import { assertTeamInvariant, restoreExperts, seedExperts } from "../src/experts/state.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { withExpertApp, type ExpertTestApp } from "./expert-helpers.ts";

const BASELINE_EXPERTS = ["product-manager", "builder", "critic", "verifier", "reviewer"] as const;
const BASELINE_IDS = [...BASELINE_EXPERTS, "cognate-team"];

describe("J-EXPERTS-RESTORE state semantics", () => {
  test("a fresh/empty state restores the five built-ins and the active Cognate Team with exactly one Orchestrator", () => {
    const state = emptyExpertState();
    const result = restoreExperts(state, false);
    expect(result).toEqual({ created: [...BASELINE_IDS], reactivated: [], kept: [] });
    expect(Object.keys(state.experts).sort()).toEqual([...BASELINE_EXPERTS].sort());
    const team = state.teams["cognate-team"]!;
    expect(team.lifecycle).toBe("active");
    expect(team.members.filter(m => m.role === "orchestrator").map(m => m.expertId)).toEqual(["product-manager"]);
    assertTeamInvariant(state, team);
  });

  test("restoring a second time creates nothing and reports every baseline id as kept", () => {
    const state = emptyExpertState();
    restoreExperts(state, false);
    const again = restoreExperts(state, true);
    expect(again).toEqual({ created: [], reactivated: [], kept: [...BASELINE_IDS] });
    expect(Object.keys(state.experts)).toHaveLength(5);
  });

  test("an archived baseline Expert is kept unless includeArchived is requested; actives and custom ids are untouched", () => {
    const state = emptyExpertState();
    seedExperts(state);
    // The operator archived `builder` after removing it from the Team (the archive gate requires it).
    state.teams["cognate-team"]!.members = state.teams["cognate-team"]!.members.filter(m => m.expertId !== "builder");
    state.experts.builder!.lifecycle = "archived";
    // A custom Expert, renamed by the operator.
    state.experts["custom-one"] = structuredClone(state.experts.critic!);
    state.experts["custom-one"]!.id = "custom-one";
    state.experts["custom-one"]!.name = "My Critic";
    const activeBefore = structuredClone(state.experts.verifier!);
    const customBefore = structuredClone(state.experts["custom-one"]!);

    const untouched = restoreExperts(state, false);
    expect(untouched.created).toEqual([]);
    expect(untouched.reactivated).toEqual([]);
    expect(untouched.kept).toContain("builder");
    expect(state.experts.builder!.lifecycle).toBe("archived");
    expect(state.experts.verifier!).toEqual(activeBefore);
    expect(state.experts["custom-one"]!).toEqual(customBefore);

    const restored = restoreExperts(state, true);
    expect(restored.created).toEqual([]);
    expect(restored.reactivated).toEqual(["builder"]);
    expect(`${state.experts.builder!.lifecycle}`).toBe("active");
    expect(state.experts.verifier!).toEqual(activeBefore);
    expect(state.experts["custom-one"]!).toEqual(customBefore);
    assertTeamInvariant(state, state.teams["cognate-team"]!);
  });
});

async function refresh(testApp: ExpertTestApp) {
  return testApp.state();
}

describe("J-EXPERTS-RESTORE capability", () => {
  test("idempotent, preserves active and custom identities, and reactivates only on explicit request", async () => {
    await withExpertApp(async () => ({ message: { role: "assistant", content: "unused" }, toolCalls: [], finishReason: "stop", model: "unused" }), async (app) => {
      const invoke = (capability: string, input: unknown) => app.client.invoke(capability, input as never);

      // The boot seed already placed the built-ins: a restore reports every id as kept and creates none.
      const first = await invoke("experts.restore", {}) as { created: string[]; reactivated: string[]; kept: string[] };
      expect(first).toEqual({ created: [], reactivated: [], kept: [...BASELINE_IDS] });
      const second = await invoke("experts.restore", {}) as { created: string[]; reactivated: string[]; kept: string[] };
      expect(second.created).toEqual([]);
      expect(second.reactivated).toEqual([]);
      expect(second.kept).toEqual([...BASELINE_IDS]);

      // A custom Expert derived from a baseline and renamed by the operator.
      const copy = await invoke("expert.copy", { expertId: "builder" }) as { expertId: string };
      const builder = (await refresh(app)).experts.builder!;
      await invoke("expert.save", {
        expertId: copy.expertId, name: "My Custom Builder",
        specialization: builder.definition.specialization, instructions: builder.definition.instructions,
        tools: builder.definition.tools, route: builder.definition.route,
      });
      const activeBefore = structuredClone((await refresh(app)).experts.verifier!);
      const customBefore = structuredClone((await refresh(app)).experts[copy.expertId]!);

      // Archive a baseline the operator no longer wants (the archive gate requires Team removal first).
      await invoke("team.member", { teamId: "cognate-team", expertId: "critic", remove: true });
      await invoke("expert.archive", { expertId: "critic" });

      const keptOnly = await invoke("experts.restore", {}) as { created: string[]; reactivated: string[]; kept: string[] };
      expect(keptOnly.created).toEqual([]);
      expect(keptOnly.reactivated).toEqual([]);
      expect(keptOnly.kept).toContain("critic");
      expect((await refresh(app)).experts.critic!.lifecycle).toBe("archived");

      const reactivated = await invoke("experts.restore", { includeArchived: true }) as { created: string[]; reactivated: string[]; kept: string[] };
      expect(reactivated.created).toEqual([]);
      expect(reactivated.reactivated).toEqual(["critic"]);

      const after = await refresh(app);
      expect(after.experts.critic!.lifecycle).toBe("active");
      expect(after.experts.verifier!).toEqual(activeBefore);
      expect(after.experts[copy.expertId]!).toEqual(customBefore);
      assertTeamInvariant(after, after.teams["cognate-team"]!);
    });
  }, 30000);

  test("a non-operator actor and an in-Run caller are refused", async () => {
    await withExpertApp(async () => ({ message: { role: "assistant", content: "unused" }, toolCalls: [], finishReason: "stop", model: "unused" }), async (app) => {
      const agent = { actor: { id: "wb-agent:coding", kind: "agent" as const }, tenant: LOCAL_OPERATOR.tenant };
      await expect(app.app.runtime.service.invoke(agent as never, { capability: "experts.restore", input: {} as never })).rejects.toThrow(/human operator/);

      const experts = new ExpertsService(app.app.runtime.service, LOCAL_OPERATOR);
      await expect(experts.command("experts.restore", {}, { actor: { id: "operator", kind: "user" }, tenant: LOCAL_OPERATOR.tenant, runId: "run-1" } as never))
        .rejects.toThrow(/inside a run/);
    });
  }, 30000);
});
