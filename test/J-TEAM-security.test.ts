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
