import { expect, test } from "bun:test";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { configureDefaultRoutes, invoke, waitForState, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

test("J-TEAM-BOUNDS: repeated delegation is bounded, failures stay visible, and rounds cannot exceed policy", async () => {
  const responder: FakeResponder = async (route, request) => {
    const tools = new Set((request.tools ?? []).map((tool) => tool.name));
    if (route.model === "pm-model" && tools.has("team_delegate")) {
      return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: `delegate-${request.messages.filter((message) => message.role === "tool").length}`, name: "team_delegate", arguments: {
          expertId: "builder", purpose: "Perform the one bounded Specialist assignment", acceptance: ["Return a result"],
        } }],
        finishReason: "tool_calls", model: route.model,
      } satisfies ModelResponse;
    }
    if (route.model === "builder-model") return {
      message: { role: "assistant", content: "Builder completed the bounded assignment." },
      toolCalls: [], finishReason: "stop", model: route.model,
    };
    return {
      message: { role: "assistant", content: "Unexpected route" }, toolCalls: [], finishReason: "stop", model: route.model,
    };
  };

  await withExpertApp(responder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const state = await testApp.state();
    const pm = state.experts["product-manager"]!;
    await testApp.client.invoke("expert.save", {
      expertId: pm.id, name: pm.name, specialization: pm.definition.specialization,
      instructions: pm.definition.instructions, tools: pm.definition.tools, route: pm.definition.route, maxSteps: 3,
    } as never);
    const team = state.teams["cognate-team"]!;
    await invoke(testApp, "team.save", {
      teamId: team.id, name: team.name, tools: team.tools,
      limits: { maxAssignments: 1, maxRounds: 1, maxUnread: 1, maxDepth: 1 },
    });

    const started = await invoke(testApp, "team.converse", {
      teamId: team.id, workspaceId: testApp.workspaceId,
      message: "Coordinate this objective without exceeding the Team's bounded assignment policy.",
      requestId: "J-TEAM-BOUNDS-one-root",
    }) as { conversationId: string; assignmentId: string };
    const finished = await waitForState(testApp, (current) => {
      const parent = current.assignments[started.assignmentId];
      return !!parent?.handoff && !["queued", "running", "waiting"].includes(parent.status);
    }, "bounded Orchestrator run and reconciliation");
    const parent = finished.assignments[started.assignmentId]!;
    const children = Object.values(finished.assignments).filter((assignment) => assignment.parentId === parent.id);
    expect(children).toHaveLength(1);
    const child = children[0]!;
    expect(child.expertId).toBe("builder");
    expect(child.execution.tools).not.toContain("team_delegate");
    expect(child.handoff?.output).toContain("bounded assignment");
    expect(parent.status).toBe("reconciliation-required");
    expect(parent.handoff?.output).toContain("tool-call step limit");
    expect(parent.handoff?.observedFailures?.some((failure) => failure.includes("Assignment budget reached")), JSON.stringify({handoff:parent.handoff,calls:testApp.providerCalls.map((call)=>({tools:call.toolNames,roles:call.messages.map((message)=>message.role),last:call.messages.at(-1)?.content}))})).toBe(true);

    const parentRunId = parent.runId!;
    const failedCalls = testApp.app.runtime.service.events({ actor: { id: "operator", kind: "user" }, tenant: "local" }, { runId: parentRunId });
    const budgetFailures: string[] = [];
    for await (const event of failedCalls) {
      if (event.eventType !== "tool.call.failed") continue;
      const payload = event.payload as { tool?: string; error?: string };
      if (payload.tool === "team_delegate" && payload.error?.includes("Assignment budget reached")) budgetFailures.push(payload.error);
    }
    expect(budgetFailures.length).toBeGreaterThan(0);
    expect(Object.values(finished.assignments).filter((assignment) => assignment.conversationId === parent.conversationId)).toHaveLength(2);

    await expect(invoke(testApp, "team.converse", {
      teamId: team.id, workspaceId: testApp.workspaceId, conversationId: parent.conversationId,
      message: "Attempt to exceed the configured Team conversation-round bound.", requestId: "J-TEAM-BOUNDS-over-round-limit",
    })).rejects.toThrow("Conversation round limit reached");
    expect(Object.values((await testApp.state()).assignments).filter((assignment) => assignment.conversationId === parent.conversationId)).toHaveLength(2);
  });
}, 60_000);
