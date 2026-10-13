import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { FakeResponder } from "./expert-helpers.ts";
import {
  configureDefaultRoutes, invoke, route, waitForState, withExpertApp,
} from "./expert-helpers.ts";

const done = (model: string, content: string): ModelResponse => ({
  message: { role: "assistant", content }, toolCalls: [], finishReason: "stop", model,
});

test("J-TEAM-REVIEW: Builder, Critic, Verifier and Reviewer preserve unresolved disagreement and block settlement", async () => {
  const reviewerInputs: string[] = [];
  const responder: FakeResponder = async (modelRoute, request) => {
    const model = modelRoute.model;
    const tools = new Set((request.tools ?? []).map((tool) => tool.name));
    const toolMessages = request.messages.filter((message) => message.role === "tool");

    if (model === "pm-model" && tools.has("team_delegate")) {
      const sequence = ["builder", "critic", "verifier", "reviewer"] as const;
      const specialist = sequence[toolMessages.length];
      if (specialist) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: `delegate-${specialist}`, name: "team_delegate", arguments: {
          expertId: specialist,
          purpose: specialist === "builder" ? "Change evaluation-fixture.txt from old to new and report the edit." :
            specialist === "critic" ? "Challenge the Builder result and independently report any unresolved concern." :
              specialist === "verifier" ? "Independently read evaluation-fixture.txt and report the observed contents." :
                "Review the Builder, Critic and Verifier returns together; recommend acceptance or revision and preserve contradictions.",
          acceptance: ["Return attributable findings with uncertainty and evidence clearly separated"],
        } }],
        finishReason: "tool_calls", model,
      };
      return done(model, "The Reviewer recommends revision because the Critic's unresolved concern remains alongside the Verifier's file receipt.");
    }

    if (model === "builder-model" && tools.has("edit")) {
      if (toolMessages.length === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "builder-read", name: "read", arguments: { file_path: "evaluation-fixture.txt" } }],
        finishReason: "tool_calls", model,
      };
      if (toolMessages.length === 1) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "builder-edit", name: "edit", arguments: {
          file_path: "evaluation-fixture.txt", old_string: "old", new_string: "new",
        } }],
        finishReason: "tool_calls", model,
      };
      return done(model, "Builder changed evaluation-fixture.txt from old to new; edit call returned successfully.");
    }

    if (model === "critic-model" && tools.has("expert_return")) {
      if (toolMessages.length === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "critic-return", name: "expert_return", arguments: {
          disposition: "result",
          output: "Critic disagreement: the edit alone does not demonstrate that the requested behavior is correct.",
          uncertainties: ["No behavioral test or acceptance evidence accompanies the file change."],
        } }],
        finishReason: "tool_calls", model,
      };
      return done(model, "Critic preserved one unresolved behavioral concern.");
    }

    if (model === "verifier-model" && tools.has("read")) {
      if (toolMessages.length === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "verifier-read", name: "read", arguments: { file_path: "evaluation-fixture.txt" } }],
        finishReason: "tool_calls", model,
      };
      return done(model, `Verifier independently observed: ${String(toolMessages.at(-1)?.content ?? "missing read result")}`);
    }

    if (model === "reviewer-model") {
      reviewerInputs.push(request.messages.map((message) => String(message.content ?? "")).join("\n"));
      return done(model, "Reviewer recommendation: revision. The Critic's uncertainty is unresolved despite the Verifier's independent read.");
    }
    return done(model, `${model} received no applicable work.`);
  };

  await withExpertApp(responder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    let state = await testApp.state();
    for (const [expertId, model] of [["verifier", "verifier-model"], ["reviewer", "reviewer-model"]] as const) {
      const current = state.experts[expertId]!;
      await invoke(testApp, "expert.save", {
        expertId, name: current.name, specialization: current.definition.specialization,
        instructions: current.definition.instructions, tools: current.definition.tools, route: route(model),
      });
    }
    await writeFile(`${testApp.home}/workspace/evaluation-fixture.txt`, "old", "utf8");
    const started = await invoke(testApp, "team.converse", {
      teamId: "cognate-team", workspaceId: testApp.workspaceId, mode: "workspace-write",
      message: "Change evaluation-fixture.txt, critique the claim, independently verify the file, and review all evidence.",
      requestId: "J-TEAM-REVIEW-evaluation-journey",
    }) as { assignmentId: string };

    state = await waitForState(testApp, (candidate) => {
      const parent = candidate.assignments[started.assignmentId];
      return !!parent?.handoff && !["queued", "running", "waiting"].includes(parent.status);
    }, "all four Expert handoffs and Orchestrator reconciliation", 45_000);

    const parent = state.assignments[started.assignmentId]!;
    const children = Object.values(state.assignments).filter((assignment) => assignment.parentId === parent.id);
    expect(children.map((assignment) => assignment.expertId).sort()).toEqual(["builder", "critic", "reviewer", "verifier"]);
    expect(new Set([parent.runId, ...children.map((assignment) => assignment.runId)]).size).toBe(5);
    expect(parent.execution.route.model).toBe("pm-model");
    expect(parent.status).toBe("reconciliation-required");
    expect(parent.handoff?.output).toContain("Reviewer recommends revision");

    const byExpert = Object.fromEntries(children.map((assignment) => [assignment.expertId, assignment]));
    const builder = byExpert.builder!;
    const critic = byExpert.critic!;
    const verifier = byExpert.verifier!;
    const reviewer = byExpert.reviewer!;
    expect(builder.execution.route.model).toBe("builder-model");
    expect(critic.execution.route.model).toBe("critic-model");
    expect(verifier.execution.route.model).toBe("verifier-model");
    expect(reviewer.execution.route.model).toBe("reviewer-model");
    expect(await readFile(`${testApp.home}/workspace/evaluation-fixture.txt`, "utf8"), JSON.stringify({builder:builder.handoff,effects:builder.effects,reviewer:reviewer.handoff,providerCalls:testApp.providerCalls.map((call)=>({model:call.model,tools:call.toolNames,roles:call.messages.map((message)=>message.role),last:call.messages.at(-1)?.content}))})).toBe("new");
    expect(Object.values(builder.effects ?? {}).some((effect) => effect.tool === "edit" && effect.state === "SUCCEEDED")).toBe(true);
    expect(builder.handoff?.artifacts.length).toBeGreaterThan(0);
    expect(builder.handoff?.observedFailures).toEqual([]);
    expect(critic.handoff?.output).toContain("Critic disagreement");
    expect(critic.handoff?.uncertainties).toContain("No behavioral test or acceptance evidence accompanies the file change.");
    expect(verifier.handoff?.output).toContain("Verifier independently observed");
    expect(reviewer.handoff?.output).toContain("Critic's uncertainty is unresolved");
    expect(reviewerInputs).toHaveLength(1);
    expect(reviewerInputs[0]).toContain("Critic disagreement");
    expect(reviewerInputs[0]).toContain("Verifier independently observed");

    const builderEvents: string[] = [];
    for await (const event of testApp.app.runtime.service.events(LOCAL_OPERATOR, { runId: builder.runId! })) {
      if (event.eventType === "tool.call.completed" || event.eventType === "run.artifact") builderEvents.push(JSON.stringify(event.payload));
    }
    expect(builderEvents.some((event) => event.includes('"tool":"edit"'))).toBe(true);
    expect(builderEvents.some((event) => event.includes("artifactId"))).toBe(true);
    const verifierEvents: string[] = [];
    for await (const event of testApp.app.runtime.service.events(LOCAL_OPERATOR, { runId: verifier.runId! })) {
      if (event.eventType === "tool.call.completed") verifierEvents.push(JSON.stringify(event.payload));
    }
    expect(verifierEvents.some((event) => event.includes('"tool":"read"') && event.includes("new"))).toBe(true);

    // A verifier receipt alone is not the aggregate team's full settlement: unresolved Critic
    // uncertainty must remain visible and prevent human acceptance.
    await expect(invoke(testApp, "team.review", {
      assignmentId: parent.id, verdict: "accept", rationale: "The Orchestrator completed its own reconciliation.", evidence: [parent.runId],
    })).rejects.toThrow("independent Expert's observable checks");
    await invoke(testApp, "team.review", {
      assignmentId: parent.id, verdict: "accept", rationale: "The Verifier independently read the changed file.", evidence: [verifier.id],
    });
    await expect(invoke(testApp, "team.settle", {
      assignmentId: parent.id, decision: "accepted", rationale: "Attempt to accept despite the unresolved Critic concern.",
    })).rejects.toThrow("unresolved failures or uncertainties");
    const finalState = await testApp.state();
    expect(finalState.assignments[parent.id]?.settlement).toBeNull();
    expect(finalState.assignments[critic.id]?.handoff?.uncertainties.length).toBeGreaterThan(0);
  });
}, 90_000);
