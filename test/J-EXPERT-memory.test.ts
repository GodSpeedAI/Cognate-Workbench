import { expect, test } from "bun:test";
import type { Assignment, Conversation, ExpertState } from "../src/experts/types.ts";
import { publicExperts } from "../src/experts/state.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import {
  collaborationResponder, configureDefaultRoutes, invoke, waitForAssignment, waitForState, withExpertApp,
} from "./expert-helpers.ts";

async function completedAssignment(testApp: Parameters<typeof invoke>[0], input: { expertId: string; teamId?: string; message: string }) {
  const started = await invoke(testApp, "expert.converse", {
    ...input, workspaceId: testApp.workspaceId, requestId: `memory-conversation:${input.expertId}:${input.message}`,
  }) as { conversationId: string; assignmentId: string };
  return waitForAssignment(testApp, started.assignmentId, (assignment: Assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status));
}

test("J-EXPERT-MEMORY: provenance and scope isolate personal, private-Team and shared-Team knowledge", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const solo = await completedAssignment(testApp, { expertId: "builder", message: "Create a provenance source for personal memory." });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:personal:builder", expertId: "builder", scope: "personal", kind: "assertion",
      text: "Builder personal note with provenance.", sources: [solo.id],
    });

    const firstPrivate = await completedAssignment(testApp, {
      expertId: "builder", teamId: "cognate-team", message: "Create a source for private Team context.",
    });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:private:builder:cognate", expertId: "builder", teamId: "cognate-team", scope: "private-team", kind: "observation",
      text: "Builder private Team observation.", sources: [firstPrivate.id],
    });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:shared:cognate", expertId: "builder", teamId: "cognate-team", scope: "team", kind: "assertion",
      text: "Cognate Team shared convention.", sources: [firstPrivate.id],
    });

    const builderPrivate = await completedAssignment(testApp, {
      expertId: "builder", teamId: "cognate-team", message: "Check Builder's scoped context.",
    });
    const criticPrivate = await completedAssignment(testApp, {
      expertId: "critic", teamId: "cognate-team", message: "Check Critic's scoped context.",
    });
    const builderContext = builderPrivate.execution.context.map((message) => message.content).join("\n");
    const criticContext = criticPrivate.execution.context.map((message) => message.content).join("\n");
    expect(builderContext).toContain("Builder private Team observation.");
    expect(builderContext).toContain("Cognate Team shared convention.");
    expect(criticContext).not.toContain("Builder private Team observation.");
    expect(criticContext).toContain("Cognate Team shared convention.");

    const builderPrivateMemory = await invoke(testApp, "expert.memory.read", { expertId: "builder", teamId: "cognate-team", query: "Builder private" }) as unknown as readonly { text: string; sources: string[] }[];
    const criticPrivateMemory = await invoke(testApp, "expert.memory.read", { expertId: "critic", teamId: "cognate-team", query: "Builder private" }) as unknown as readonly unknown[];
    expect(builderPrivateMemory.map((memory) => memory.text)).toContain("Builder private Team observation.");
    expect(builderPrivateMemory[0]?.sources).toContain(firstPrivate.id);
    expect(criticPrivateMemory).toHaveLength(0);

    await invoke(testApp, "team.save", { teamId: "second-team", name: "Second Team" });
    await invoke(testApp, "team.member", { teamId: "second-team", expertId: "builder" });
    await invoke(testApp, "team.replaceOrchestrator", { teamId: "second-team", expertId: "builder" });
    await invoke(testApp, "team.activate", { teamId: "second-team", active: true });
    const secondTeam = await completedAssignment(testApp, { expertId: "builder", teamId: "second-team", message: "Check another Team's context." });
    const secondTeamContext = secondTeam.execution.context.map((message) => message.content).join("\n");
    expect(secondTeamContext).not.toContain("Builder private Team observation.");
    expect(secondTeamContext).not.toContain("Cognate Team shared convention.");

    const personal = await invoke(testApp, "expert.memory.read", { expertId: "builder", query: "personal note" }) as unknown as readonly { text: string; sources: string[] }[];
    expect(personal.map((memory) => memory.text)).toContain("Builder personal note with provenance.");
    const standalone = await completedAssignment(testApp, { expertId: "builder", message: "Check solo context after Team conversations." });
    const soloContext = standalone.execution.context.map((message) => message.content).join("\n");
    expect(soloContext).toContain("Builder personal note with provenance.");
    expect(soloContext).not.toContain("Builder private Team observation.");
    expect(soloContext).not.toContain("Cognate Team shared convention.");
    const privateOrchestrator=await completedAssignment(testApp,{expertId:"product-manager",teamId:"cognate-team",message:"Private discussion must not expose coordinating or addressed-delivery tools."});
    expect(privateOrchestrator.execution.tools).not.toContain("team_delegate");
    expect(privateOrchestrator.execution.tools).not.toContain("team_message");

    const privateState = await waitForState(testApp, (state) => Object.keys(state.memory).length > 0, "memory records");
    const publicView = publicExperts(privateState);
    expect(Object.keys(privateState.memory).length).toBeGreaterThan(0);
    expect(publicView.memory).toEqual({});
    expect(Object.values(publicView.conversations).some((conversation) => conversation.scope === "private-team")).toBe(false);
    expect(Object.values(publicView.assignments).every((assignment) => assignment.execution.context.length === 0)).toBe(true);

    await testApp.restart();
    const deadline = Date.now() + 10_000;
    let projected: ExpertState | undefined;
    while (Date.now() < deadline) {
      const read = await testApp.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" });
      projected = read.rows.find((row) => row.key === "current")?.value as ExpertState | undefined;
      if (projected) break;
      await Bun.sleep(25);
    }
    const checkpoint = await testApp.app.runtime.store.getProjection("experts");
    expect(projected, `experts projection missing after restart (checkpoint=${JSON.stringify(checkpoint)}, rows=${JSON.stringify(await testApp.app.runtime.store.listProjection("experts"))})`).toBeDefined();
    expect(projected?.memory).toEqual({});
    expect(Object.values(projected!.conversations).some((conversation) => conversation.scope === "private-team")).toBe(false);
    expect(Object.values(projected!.assignments).every((assignment) => assignment.execution.context.length === 0)).toBe(true);
    expect(projected?.experts.builder?.name).toBe("Builder");
    const history=await invoke(testApp,"expert.context",{list:true,scope:"private-team",expertId:"builder",teamId:"cognate-team"}) as unknown as {conversations:Conversation[]};
    expect(history.conversations.some(c=>c.id===firstPrivate.conversationId)).toBe(true);
    expect(history.conversations.every(c=>c.scope==="private-team" && c.expertId==="builder" && c.teamId==="cognate-team")).toBe(true);
    const reopened=await invoke(testApp,"expert.context",{conversationId:firstPrivate.conversationId}) as unknown as {conversation:Conversation;messages:{text:string}[]};
    expect(reopened.conversation.workspaceId).toBe(testApp.workspaceId);
    expect(reopened.messages.some(m=>m.text.includes("Create a source for private Team context"))).toBe(true);
  });
}, 60_000);

test("J-EXPERT-MEMORY: review step context excludes the author's memory", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const authored = await completedAssignment(testApp, { expertId: "builder", teamId: "cognate-team", message: "Do the work that will be reviewed." });
    expect(authored.reviews).toBeNull();
    const other = await completedAssignment(testApp, { expertId: "critic", teamId: "cognate-team", message: "Unrelated critic work." });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:shared:by-builder", expertId: "builder", teamId: "cognate-team", scope: "team", kind: "assertion",
      text: "Builder shared claim.", sources: [other.id],
    });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:shared:from-work", expertId: "critic", teamId: "cognate-team", scope: "team", kind: "observation",
      text: "Observation sourced from the reviewed work.", sources: [authored.id],
    });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:shared:neutral", expertId: "critic", teamId: "cognate-team", scope: "team", kind: "assertion",
      text: "Neutral team convention.", sources: [other.id],
    });
    const started = await invoke(testApp, "expert.converse", {
      expertId: "critic", teamId: "cognate-team", workspaceId: testApp.workspaceId, requestId: "review-step-1",
      message: "Review the builder's work.", reviews: authored.id,
    }) as { assignmentId: string };
    const review = await waitForAssignment(testApp, started.assignmentId, (a: Assignment) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
    expect(review.reviews).toBe(authored.id);
    const context = review.execution.context.map((m) => m.content).join("\n");
    expect(context).not.toContain("Builder shared claim.");
    expect(context).not.toContain("Observation sourced from the reviewed work.");
    expect(context).toContain("Neutral team convention.");
  });
}, 60_000);

test("J-EXPERT-MEMORY: critic role still starts clean", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const authored = await completedAssignment(testApp, { expertId: "builder", teamId: "cognate-team", message: "Create private builder context." });
    await invoke(testApp, "expert.memory.write", {
      id: "memory:private:builder:clean", expertId: "builder", teamId: "cognate-team", scope: "private-team", kind: "observation",
      text: "Builder private clean-start note.", sources: [authored.id],
    });
    const critic = await completedAssignment(testApp, { expertId: "critic", teamId: "cognate-team", message: "Ordinary critic turn." });
    expect(critic.reviews).toBeNull();
    expect(critic.execution.context.map((m) => m.content).join("\n")).not.toContain("Builder private clean-start note.");
    const started = await invoke(testApp, "expert.converse", {
      expertId: "critic", teamId: "cognate-team", workspaceId: testApp.workspaceId, requestId: "review-step-clean", message: "Review it.", reviews: authored.id,
    }) as { assignmentId: string };
    const review = await waitForAssignment(testApp, started.assignmentId, (a: Assignment) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
    expect(review.execution.context.map((m) => m.content).join("\n")).not.toContain("Builder private clean-start note.");
  });
}, 60_000);

test("J-EXPERT-MEMORY: an explicit assignment id is deterministic and cannot be reused", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const input = { id: "assign:case_1:step_1", expertId: "builder", workspaceId: testApp.workspaceId, message: "Do step one." };
    const first = await invoke(testApp, "expert.converse", { ...input, requestId: "assign:case_1:step_1" }) as { assignmentId: string };
    expect(first.assignmentId).toBe("assign:case_1:step_1");
    const retry = await invoke(testApp, "expert.converse", { ...input, requestId: "assign:case_1:step_1" }) as { assignmentId: string };
    expect(retry.assignmentId).toBe(first.assignmentId);
    await expect(invoke(testApp, "expert.converse", { ...input, requestId: "other-request" })).rejects.toThrow(/identity already exists/);
  });
}, 60_000);
