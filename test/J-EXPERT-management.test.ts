import { describe, expect, test } from "bun:test";
import { emptyExpertState } from "../src/experts/types.ts";
import { seedExperts, assertTeamInvariant } from "../src/experts/state.ts";

describe("J-EXPERT-CREATE / J-TEAM-ACTIVATE", () => {
  test("Cognate Team seeds five editable identities once without overwriting customization", () => {
    const state = emptyExpertState();
    seedExperts(state);
    expect(Object.values(state.experts)).toHaveLength(5);
    const team = state.teams["cognate-team"]!;
    expect(team.members.filter(m => m.role === "orchestrator").map(m => m.expertId)).toEqual(["product-manager"]);
    state.experts.builder!.name = "My Builder";
    seedExperts(state);
    expect(Object.values(state.experts)).toHaveLength(5);
    expect(state.experts.builder!.name).toBe("My Builder");
    assertTeamInvariant(state, team);
  });
  test("draft may have no Orchestrator; active Team cannot have zero or two", () => {
    const state = emptyExpertState(); seedExperts(state);
    const team = structuredClone(state.teams["cognate-team"]!);
    team.lifecycle = "draft"; team.members = [];
    expect(() => assertTeamInvariant(state,team)).not.toThrow();
    team.lifecycle = "active";
    expect(() => assertTeamInvariant(state,team)).toThrow("exactly one");
    team.members = [
      {expertId:"builder",role:"orchestrator",tools:[]},
      {expertId:"critic",role:"orchestrator",tools:[]},
    ];
    expect(() => assertTeamInvariant(state,team)).toThrow("one Orchestrator");
  });
});
