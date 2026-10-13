import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { EXPERTS_THREAD, type ExpertState } from "../src/experts/types.ts";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { LOCAL_OPERATOR } from "../src/server.ts";
import {
  collaborationResponder, configureDefaultRoutes, invoke, route, waitForAssignment, waitForState,
  withExpertApp, type FakeResponder,
} from "./expert-helpers.ts";

const completion = (model: string, content: string): ModelResponse => ({
  message: { role: "assistant", content }, toolCalls: [], finishReason: "stop", model,
});

test("J-TEAM-DELEGATE / J-TEAM-HANDOFF: Orchestrator delegates to a routed Specialist and recovers one durable return", async () => {
  const responder: FakeResponder = async (route, request) => {
    if (route.model === "builder-model" && !request.messages.some((message) => message.role === "tool")) {
      // Simulate an adversarial model suggesting an unauthorized second coordination branch.
      return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "forged-delegation", name: "team_delegate", arguments: {
          expertId: "critic", purpose: "unapproved nested delegation", acceptance: ["Should be refused"],
        } }],
        finishReason: "tool_calls", model: route.model,
      };
    }
    return collaborationResponder(route, request);
  };

  await withExpertApp(responder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const result = await invoke(testApp, "team.converse", {
      teamId: "cognate-team", workspaceId: testApp.workspaceId,
      message: "Implement a small change and return evidence for the Orchestrator to reconcile.",
      requestId: "J-TEAM-DELEGATE-first-objective",
    }) as { conversationId: string; assignmentId: string };

    const settled = await waitForState(testApp, (state) => {
      const parent = state.assignments[result.assignmentId];
      return !!parent?.handoff && !["queued", "running", "waiting"].includes(parent.status);
    }, "Orchestrator handoff and reconciliation");
    const parent = settled.assignments[result.assignmentId]!;
    const children = Object.values(settled.assignments).filter((assignment) => assignment.parentId === parent.id);
    if (children.length !== 1) throw new Error(`Expected one Builder Assignment; evidence=${JSON.stringify({parent:{status:parent.status,runId:parent.runId,handoff:parent.handoff},assignments:Object.values(settled.assignments).map(a=>({id:a.id,expertId:a.expertId,status:a.status,parentId:a.parentId,runId:a.runId,handoff:a.handoff})),providerCalls:testApp.providerCalls.map(c=>({model:c.model,tools:c.toolNames,roles:c.messages.map(m=>m.role),lastMessage:c.messages.at(-1)?.content}))})}`);
    const child = children[0]!;
    const parentRunId = parent.runId;
    const childRunId = child.runId;
    expect(parentRunId).not.toBeNull();
    expect(childRunId).not.toBeNull();
    if (!parentRunId || !childRunId) throw new Error("settled Assignments must retain Cognate run identities");
    expect(parent.expertId).toBe("product-manager");
    expect(parent.execution.route.model).toBe("pm-model");
    expect(child.expertId).toBe("builder");
    expect(child.execution.route.model).toBe("builder-model");
    expect(child.status).toBe("reconciliation-required");
    expect(child.handoff?.runId).toBe(childRunId);
    expect(child.handoff?.output).toContain("Builder completed the assigned implementation");
    expect(parent.status).toBe("reconciliation-required");
    expect(parent.handoff?.output).toContain("Product Manager reconciled the Builder handoff");
    expect(parent.runId).not.toBe(child.runId);

    const providerModels = testApp.providerCalls.map((call) => call.model);
    expect(providerModels).toContain("pm-model");
    expect(providerModels).toContain("builder-model");
    const builderCalls = testApp.providerCalls.filter((call) => call.model === "builder-model");
    expect(builderCalls[0]?.toolNames).not.toContain("team_delegate");
    const forgedFailure = await testApp.app.runtime.service.events(LOCAL_OPERATOR, { runId: childRunId });
    const failedToolEvent = [];
    for await (const event of forgedFailure) if (event.eventType === "tool.call.failed") failedToolEvent.push(event);
    expect(failedToolEvent.length).toBeGreaterThan(0);

    const returnedMessages = Object.values(settled.messages).filter((message) => message.assignmentId === child.id && message.sender.id === "builder");
    expect(returnedMessages).toHaveLength(1);
    expect(returnedMessages[0]?.recipientId).toBe("product-manager");
    expect(returnedMessages[0]?.correlationId).toBe(`expert:${child.id}:1`);

    const committedMessageCount = Object.keys(settled.messages).length;
    await testApp.restart();
    const afterRestart = await waitForState(testApp, (state) => !!state.assignments[parent.id]?.handoff, "persisted Team handoff after restart");
    expect(afterRestart.assignments[parent.id]?.handoff?.runId).toBe(parentRunId);
    expect(afterRestart.assignments[child.id]?.handoff?.runId).toBe(childRunId);
    expect(Object.keys(afterRestart.messages)).toHaveLength(committedMessageCount);
    expect(Object.values(afterRestart.assignments).filter((assignment) => assignment.parentId === parent.id)).toHaveLength(1);
  });
}, 60_000);

test("J-TEAM-RETRY: provider failure remains visible and the root objective can be retried", async () => {
  let recover = false;
  const attempts = new Map<string, number>();
  const responder: FakeResponder = async (route, request) => {
    if (route.model === "flaky-model" && !recover) {
      attempts.set(route.model, (attempts.get(route.model) ?? 0) + 1);
      throw new Error("deterministic provider unavailable");
    }
    return collaborationResponder(route, request);
  };

  await withExpertApp(responder, async (testApp) => {
    const route = (await import("./expert-helpers.ts")).route("flaky-model");
    await configureDefaultRoutes(testApp, { productManager: route });
    const { assignmentId } = await invoke(testApp, "team.converse", {
      teamId: "cognate-team", workspaceId: testApp.workspaceId, message: "Complete this objective without delegation.",
      requestId: "J-TEAM-RETRY-failing-objective",
    }) as { conversationId: string; assignmentId: string };
    const failed = await waitForAssignment(testApp, assignmentId, (assignment) => assignment.status === "failed");
    expect(failed.handoff?.disposition).toBe("failed");
    expect(failed.handoff?.failures.length).toBeGreaterThan(0);
    expect(attempts.get("flaky-model")).toBe(6);

    recover = true;
    await invoke(testApp, "team.retry", { assignmentId, requestId: "J-TEAM-RETRY-second-attempt" });
    const recovered = await waitForAssignment(testApp, assignmentId, (assignment) => assignment.attempt === 2 && assignment.status === "reconciliation-required");
    expect(recovered.runId).not.toBe(failed.runId);
    expect(recovered.handoff?.disposition).toBe("result");
    expect(recovered.handoff?.output).toContain("flaky-model completed");
  });
}, 60_000);

test("J-TEAM-RECOVER: process restart resumes a waiting Specialist and returns once without a browser turn", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-expert-crash-test-"));
  const portFile = join(home, "server.port");
  const startedFile = join(home, "builder.started");
  const releaseFile = join(home, "builder.release");
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  const worker = join(process.cwd(), "test", "expert-runtime-worker.ts");
  let processHandle: ReturnType<typeof Bun.spawn> | undefined;
  let client: ReturnType<typeof createClient> | undefined;
  let service: ReturnType<typeof createRemoteRuntimeService> | undefined;
  const boot = async () => {
    await rm(portFile, { force: true });
    processHandle = Bun.spawn([process.execPath, worker], {
      env: { ...process.env, EXPERT_WORKER_HOME: home, EXPERT_WORKER_PORT_FILE: portFile, EXPERT_WORKER_STARTED_FILE: startedFile, EXPERT_WORKER_RELEASE_FILE: releaseFile },
      stdout: "ignore", stderr: "inherit",
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await Bun.file(portFile).exists())) {
      if (processHandle.exitCode !== null) throw new Error(`Expert worker exited during startup: ${processHandle.exitCode}`);
      await Bun.sleep(20);
    }
    if (!(await Bun.file(portFile).exists())) throw new Error("Expert worker did not publish its HTTP port");
    const port = (await readFile(portFile, "utf8")).trim();
    service = createRemoteRuntimeService(connectTransport(`http://127.0.0.1:${port}`), () => devToken(LOCAL_OPERATOR));
    client = createClient({ service, caller: LOCAL_OPERATOR });
  };
  const readState = async () => (await service!.readSharedState(LOCAL_OPERATOR, { threadId: EXPERTS_THREAD })).state as unknown as ExpertState;
  const call = async (capability: string, input: unknown) => client!.invoke(capability, input as never);
  const waitState = async (predicate: (state: ExpertState) => boolean, label: string, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await readState();
      if (predicate(state)) return state;
      await Bun.sleep(20);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  try {
    await boot();
    const selected = await call("workspace.select", { path: workspace }) as { workspaceId: string };
    const initial = await waitState((state) => !!state.experts["product-manager"] && !!state.experts.builder, "seeded Experts");
    for (const [expertId, model] of [["product-manager", "pm-model"], ["builder", "builder-model"]] as const) {
      const expert = initial.experts[expertId]!;
      await call("expert.save", { expertId, name: expert.name, specialization: expert.definition.specialization, instructions: expert.definition.instructions, tools: expert.definition.tools, route: route(model) });
    }
    const request = {
      teamId: "cognate-team", workspaceId: selected.workspaceId,
      message: "Delegate recovery work and reconcile its result after interruption.", requestId: "J-TEAM-RECOVER-same-request",
    };
    const first = await call("team.converse", request) as { conversationId: string; assignmentId: string };
    const duplicate = await call("team.converse", request) as { conversationId: string; assignmentId: string };
    expect(duplicate.assignmentId).toBe(first.assignmentId);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await Bun.file(startedFile).exists())) await Bun.sleep(20);
    expect(await Bun.file(startedFile).exists()).toBe(true);
    const beforeRestart = await waitState((state) => {
      const child = Object.values(state.assignments).find((assignment) => assignment.parentId === first.assignmentId);
      return !!child?.runId && ["waiting", "running"].includes(state.assignments[first.assignmentId]?.status ?? "");
    }, "parent wait and active child");
    const parentBefore = beforeRestart.assignments[first.assignmentId]!;
    const childBefore = Object.values(beforeRestart.assignments).find((assignment) => assignment.parentId === parentBefore.id)!;
    expect(childBefore.status).toBe("running");
    expect(Object.values(beforeRestart.assignments).filter((assignment) => assignment.parentId === parentBefore.id)).toHaveLength(1);

    // Kill only the Workbench process. PostgreSQL/pg0 and its event, commitment, and projection
    // state remain live; release the deterministic provider when the replacement process starts.
    processHandle!.kill(9);
    await processHandle!.exited;
    await client?.close(); client = undefined;
    await writeFile(releaseFile, "resume the provider call after restart", "utf8");
    await boot();
    const recovered = await waitState((state) => !!state.assignments[parentBefore.id]?.handoff && !!state.assignments[childBefore.id]?.handoff, "automatic return and parent reconciliation after process restart", 40_000);
    const parent = recovered.assignments[parentBefore.id]!;
    const child = recovered.assignments[childBefore.id]!;
    expect(parent.handoff?.output).toContain("Product Manager reconciled");
    expect(child.handoff?.output).toContain("Recovered Builder result after process restart");
    expect(child.runId).toBe(childBefore.runId);
    expect(Object.values(recovered.assignments).filter((assignment) => assignment.parentId === parent.id)).toHaveLength(1);
    expect(Object.values(recovered.messages).filter((message) => message.assignmentId === child.id && message.sender.id === "builder")).toHaveLength(1);
  } finally {
    await client?.close().catch(() => {});
    if (processHandle && processHandle.exitCode === null) { processHandle.kill(9); await processHandle.exited; }
    await rm(home, { recursive: true, force: true });
  }
}, 90_000);

test("J-TEAM-EVIDENCE: Builder edits through the durable effect boundary and Verifier reads the changed file", async () => {
  const responder: FakeResponder = async (route, request) => {
    const tools = new Set((request.tools ?? []).map((tool) => tool.name));
    const toolMessages = request.messages.filter((message) => message.role === "tool");
    if (route.model === "pm-model" && tools.has("team_delegate")) {
      const handoffCount = toolMessages.length;
      if (handoffCount === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "delegate-builder-effect", name: "team_delegate", arguments: { expertId: "builder", purpose: "Read and update proof.txt from old to new", acceptance: ["Changed file is observable"] } }],
        finishReason: "tool_calls", model: route.model,
      };
      if (handoffCount === 1) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "delegate-verifier-effect", name: "team_delegate", arguments: { expertId: "verifier", purpose: "Independently read proof.txt and report its exact contents", acceptance: ["Provide observed file contents"] } }],
        finishReason: "tool_calls", model: route.model,
      };
      return completion(route.model, "Builder's effect and Verifier's independent read reconcile to the persisted file.");
    }
    if (route.model === "builder-model" && tools.has("edit")) {
      if (toolMessages.length === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "builder-read-proof", name: "read", arguments: { file_path: "proof.txt" } }],
        finishReason: "tool_calls", model: route.model,
      };
      if (toolMessages.length === 1) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "builder-edit-proof", name: "edit", arguments: { file_path: "proof.txt", old_string: "old", new_string: "new" } }],
        finishReason: "tool_calls", model: route.model,
      };
      return completion(route.model, "Updated proof.txt after reading its prior contents.");
    }
    if (route.model === "verifier-model" && tools.has("read")) {
      if (toolMessages.length === 0) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "verifier-read-proof", name: "read", arguments: { file_path: "proof.txt" } }],
        finishReason: "tool_calls", model: route.model,
      };
      const observed = toolMessages.at(-1)?.content ?? "no read result";
      return completion(route.model, `Independent read receipt: ${String(observed)}`);
    }
    return completion(route.model, `${route.model} returned no applicable tool.`);
  };

  await withExpertApp(responder, async (testApp) => {
    await configureDefaultRoutes(testApp);
    const current = await testApp.state();
    await testApp.client.invoke("expert.save", {
      expertId: "verifier", name: current.experts.verifier!.name,
      specialization: current.experts.verifier!.definition.specialization,
      instructions: current.experts.verifier!.definition.instructions,
      tools: current.experts.verifier!.definition.tools, route: route("verifier-model"),
    } as never);
    await writeFile(join(testApp.home, "workspace", "proof.txt"), "old", "utf8");
    const result = await invoke(testApp, "team.converse", {
      teamId: "cognate-team", workspaceId: testApp.workspaceId, mode: "workspace-write",
      message: "Update proof.txt from old to new, then have the Verifier independently read it.",
      requestId: "J-TEAM-EVIDENCE-real-tool-effects",
    }) as { assignmentId: string };
    const state = await waitForState(testApp, (candidate) => !!candidate.assignments[result.assignmentId]?.handoff, "Builder effect and Verifier return");
    const parent = state.assignments[result.assignmentId]!;
    const children = Object.values(state.assignments).filter((assignment) => assignment.parentId === parent.id);
    const builder = children.find((assignment) => assignment.expertId === "builder")!;
    const verifier = children.find((assignment) => assignment.expertId === "verifier")!;
    expect(children).toHaveLength(2);
    expect(await readFile(join(testApp.home, "workspace", "proof.txt"), "utf8"), JSON.stringify({effects:builder.effects, builder:builder.handoff, verifier:verifier.handoff})).toBe("new");
    expect(Object.values(builder.effects ?? {}).some((effect) => effect.tool === "edit" && effect.state === "SUCCEEDED")).toBe(true);
    expect(builder.handoff?.output).toContain("Updated proof.txt");
    expect(verifier.handoff?.output).toContain("new");
    expect(testApp.providerCalls.filter((call) => call.model === "verifier-model").length).toBeGreaterThan(0);

    const verifierEvents = testApp.app.runtime.service.events(LOCAL_OPERATOR, { runId: verifier.runId! });
    const readReceipts: unknown[] = [];
    for await (const event of verifierEvents) {
      if (event.eventType === "tool.call.completed" && (event.payload as { tool?: string }).tool === "read") readReceipts.push(event.payload);
    }
    expect(readReceipts).toHaveLength(1);
    expect(JSON.stringify(readReceipts[0])).toContain("new");
    expect(parent.handoff?.output).toContain("independent read");
  });
}, 60_000);
