import { describe, expect, test } from "bun:test";
import { emptyExpertState } from "../src/experts/types.ts";
import { seedExperts, assertTeamInvariant } from "../src/experts/state.ts";
import { withExpertApp, collaborationResponder, route } from "./expert-helpers.ts";
import { randomUUID } from "node:crypto";

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
  test("J-TEAM-CREATE / REPLACE-ORCHESTRATOR: mutation gates and concurrent updates preserve the invariant", async () => {
    await withExpertApp(collaborationResponder,async app=>{
      const invoke=(capability:string,input:unknown)=>app.client.invoke(capability,input as never);
      const made=await invoke("team.save",{name:"Custom team",requestId:randomUUID()}) as {teamId:string};
      await expect(invoke("team.activate",{teamId:made.teamId,active:true})).rejects.toThrow("exactly one");
      await invoke("team.member",{teamId:made.teamId,expertId:"builder"});
      await invoke("team.member",{teamId:made.teamId,expertId:"critic"});
      await invoke("team.replaceOrchestrator",{teamId:made.teamId,expertId:"builder"});
      await invoke("team.activate",{teamId:made.teamId,active:true});
      await expect(invoke("team.member",{teamId:made.teamId,expertId:"critic",role:"orchestrator"})).rejects.toThrow("only one Orchestrator");
      await expect(invoke("team.member",{teamId:made.teamId,expertId:"builder",remove:true})).rejects.toThrow("exactly one");
      await Promise.all(Array.from({length:6},(_,i)=>invoke("team.replaceOrchestrator",{teamId:made.teamId,expertId:i%2 ? "builder":"critic",requestId:randomUUID()})));
      const state=await app.state();
      expect(state.teams[made.teamId]!.members.filter(m=>m.role==="orchestrator")).toHaveLength(1);
      assertTeamInvariant(state,state.teams[made.teamId]!);
      const before=state.experts.builder!;
      await invoke("expert.save",{expertId:"builder",name:"Customized Builder",specialization:before.definition.specialization,instructions:before.definition.instructions,route:route("custom-code"),tools:before.definition.tools});
      const copy=await invoke("expert.copy",{expertId:"builder"}) as {expertId:string};
      await app.restart();
      const restored=await app.state();
      expect(restored.experts.builder!.name).toBe("Customized Builder");
      expect(restored.experts[copy.expertId]!.definition.route?.model).toBe("custom-code");
      expect(Object.values(restored.experts)).toHaveLength(6);
      expect(restored.teams[made.teamId]!.members.filter(m=>m.role==="orchestrator")).toHaveLength(1);
    });
  },30000);
});
