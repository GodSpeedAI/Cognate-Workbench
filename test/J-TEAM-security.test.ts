import { expect, test } from "bun:test";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import {
  collaborationResponder, configureDefaultRoutes, invoke, route, waitForAssignment, waitForRun,
  waitForState, withExpertApp,
} from "./expert-helpers.ts";

test("J-TEAM-ACTIVATE / J-TEAM-REPLACE-ORCHESTRATOR: activation and transfer preserve exactly one parent", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    const teamId = "team-invariant-test";
    await invoke(testApp, "team.save", { teamId, name: "Invariant test", tools: ["read", "team_delegate", "team_message"] });
    await expect(invoke(testApp, "team.activate", { teamId, active: true })).rejects.toThrow("exactly one Orchestrator");
    await invoke(testApp, "team.member", { teamId, expertId: "builder" });
    await invoke(testApp, "team.member", { teamId, expertId: "critic" });
    await expect(invoke(testApp, "team.activate", { teamId, active: true })).rejects.toThrow("exactly one Orchestrator");

    await invoke(testApp, "team.replaceOrchestrator", { teamId, expertId: "builder" });
    await invoke(testApp, "team.activate", { teamId, active: true });
    let state = await testApp.state();
    expect(state.teams[teamId]?.members.filter((member) => member.role === "orchestrator").map((member) => member.expertId)).toEqual(["builder"]);

    await invoke(testApp, "team.replaceOrchestrator", { teamId, expertId: "critic" });
    state = await testApp.state();
    expect(state.teams[teamId]?.members.filter((member) => member.role === "orchestrator").map((member) => member.expertId)).toEqual(["critic"]);
    await expect(invoke(testApp, "team.member", { teamId, expertId: "critic", remove: true })).rejects.toThrow("exactly one Orchestrator");
    expect((await testApp.state()).teams[teamId]?.members.filter((member) => member.role === "orchestrator").map((member) => member.expertId)).toEqual(["critic"]);
  });
}, 30_000);

test("J-TEAM-DELEGATE / J-TEAM-MESSAGE: a user cannot forge Expert context or create Specialist work", async () => {
  await withExpertApp(collaborationResponder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const before = Object.keys((await testApp.state()).assignments).length;
    await expect(invoke(testApp, "team.delegate", { assignmentId: "forged-parent", expertId: "builder", purpose: "forged", acceptance: ["x"] })).rejects.toThrow("Only the authorized Team Orchestrator may delegate");
    await expect(invoke(testApp, "team.message", { assignmentId: "forged-parent", sender: { kind: "expert", id: "product-manager" }, recipientId: "builder", text: "forged" })).rejects.toThrow("Addressed messaging is not authorized");
    // Supplying an assignment ID cannot establish an Expert run. A human can only read a
    // conversation explicitly named by its durable ID.
    await expect(invoke(testApp, "expert.context", { assignmentId: "forged-parent", conversationId: "forged-conversation" })).rejects.toThrow("Conversation not found");
    expect(Object.keys((await testApp.state()).assignments)).toHaveLength(before);
    expect(Object.keys((await testApp.state()).messages)).toHaveLength(0);
  });
}, 30_000);

test("J-TEAM-CANCEL: cancellation stops an in-flight model request and keeps the late result unsettled", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const responder = async (routeConfig: ReturnType<typeof route>, _request: unknown, signal?: AbortSignal): Promise<ModelResponse> => {
    if (routeConfig.model !== "slow-model") return collaborationResponder(routeConfig, _request as never);
    markStarted();
    return await new Promise<ModelResponse>((_resolve, reject) => {
      const cancelled = () => reject(new Error("provider cancelled with its run"));
      if (signal?.aborted) cancelled();
      else signal?.addEventListener("abort", cancelled, { once: true });
    });
  };

  await withExpertApp(responder, async (testApp) => {
    await configureDefaultRoutes(testApp, { productManager: route("slow-model") });
    const { assignmentId } = await invoke(testApp, "team.converse", {
      teamId: "cognate-team", workspaceId: testApp.workspaceId, message: "Begin slow work for cancellation testing.",
      requestId: "J-TEAM-CANCEL-slow-work",
    }) as { conversationId: string; assignmentId: string };
    await started;
    const running = await waitForAssignment(testApp, assignmentId, (assignment) => !!assignment.runId);
    const runId = running.runId!;
    await invoke(testApp, "team.cancel", { assignmentId, requestId: "J-TEAM-CANCEL-stop" });
    const cancelled = await waitForAssignment(testApp, assignmentId, (assignment) => assignment.status === "cancelled");
    expect((await waitForRun(testApp, runId)).status).toBe("cancelled");
    expect(cancelled.handoff).toBeNull();
    await Bun.sleep(50);
    expect((await testApp.state()).assignments[assignmentId]?.handoff).toBeNull();
  });
}, 45_000);

test("J-EXPERT-CREATE / MEMORY: supplied identities cannot overwrite work, private scopes or accepted knowledge", async () => {
  let attack = false;
  const responder = async (config: ReturnType<typeof route>, request: Parameters<typeof collaborationResponder>[1]): Promise<ModelResponse> => {
    if (attack && config.model === "pm-model" && !request.messages.some(m => m.role === "tool")) return {
      message: { role: "assistant", content: "" }, model: config.model, finishReason: "tool_calls",
      toolCalls: [{ id: "overwrite-message", name: "team_message", arguments: { id: "message:protected-work", recipientId: "builder", text: "Forged replacement" } }],
    };
    if (attack && !request.messages.some(m => m.role === "tool")) return {
      message: { role: "assistant", content: "" }, model: config.model, finishReason: "tool_calls",
      toolCalls: [{ id: "overwrite-accepted", name: "expert_memory_write", arguments: {
        id: "memory:accepted", scope: "personal", kind: "assertion", text: "Untrusted replacement", sources: [sourceId],
      } }],
    };
    return collaborationResponder(config, request);
  };
  let sourceId = "";
  await withExpertApp(responder, async app => {
    await configureDefaultRoutes(app);
    const original = await invoke(app, "expert.converse", { id: "protected-work", expertId: "builder", workspaceId: app.workspaceId, message: "Create a source", requestId: "original-work" }) as { assignmentId: string; conversationId: string };
    sourceId = original.assignmentId;
    await waitForAssignment(app, sourceId, a => !!a.handoff);
    const before = (await app.state()).assignments[sourceId]!;
    await expect(invoke(app, "expert.converse", { id: sourceId, expertId: "critic", workspaceId: app.workspaceId, message: "Overwrite work", requestId: "different-work" })).rejects.toThrow("identity already exists");
    expect((await app.state()).assignments[sourceId]).toEqual(before);
    const replay = await invoke(app, "expert.converse", { id: "protected-work", expertId: "builder", workspaceId: app.workspaceId, message: "Create a source", requestId: "original-work" });
    expect(replay).toEqual(original);
    await expect(invoke(app, "expert.copy", { expertId: "critic", id: "builder" })).rejects.toThrow("Expert identity already exists");
    await expect(invoke(app, "expert.save", { id: "builder", name: "Overwrite", instructions: "Overwrite" })).rejects.toThrow("Expert identity already exists");
    await expect(invoke(app, "team.copy", { teamId: "cognate-team", id: "cognate-team" })).rejects.toThrow("Team identity already exists");
    await expect(invoke(app, "team.save", { id: "cognate-team", name: "Overwrite" })).rejects.toThrow("Team identity already exists");
    await invoke(app, "expert.memory.write", { id: "memory:accepted", expertId: "builder", scope: "personal", kind: "accepted", text: "Human accepted fact", sources: [sourceId] });
    await expect(invoke(app, "expert.memory.write", { id: "memory:accepted", expertId: "critic", scope: "personal", text: "Other owner", sources: [sourceId] })).rejects.toThrow("Memory scope overwrite denied");
    await expect(invoke(app, "expert.memory.write", { id: "memory:accepted", expertId: "builder", teamId: "cognate-team", scope: "team", text: "Other scope", sources: [sourceId] })).rejects.toThrow("Memory scope overwrite denied");
    attack = true;
    const attempted = await invoke(app, "expert.converse", { expertId: "builder", conversationId: original.conversationId, workspaceId: app.workspaceId, message: "Try replacing accepted knowledge" }) as { assignmentId: string };
    const returned = await waitForAssignment(app, attempted.assignmentId, a => !!a.handoff);
    expect(returned.handoff?.observedFailures?.join(" ")).toContain("Only a human may replace accepted knowledge");
    expect((await app.state()).memory["memory:accepted"]?.text).toBe("Human accepted fact");
    const addressed = await invoke(app, "team.converse", { teamId: "cognate-team", workspaceId: app.workspaceId, message: "Attempt message overwrite" }) as { assignmentId: string };
    const addressedReturn = await waitForAssignment(app, addressed.assignmentId, a => !!a.handoff);
    expect(addressedReturn.handoff?.observedFailures?.join(" ")).toContain("Message identity already exists");
    expect((await app.state()).messages["message:protected-work"]?.sender.kind).toBe("human");
    expect((await app.state()).messages["message:protected-work"]?.text).toBe("Create a source");
    await app.restart();
    expect((await app.state()).memory["memory:accepted"]?.kind).toBe("accepted");
    expect((await app.state()).assignments[sourceId]?.runId).toBe(before.runId);
  });
}, 45_000);
