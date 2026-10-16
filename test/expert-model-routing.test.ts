import { describe, expect, test } from "bun:test";
import type { Component, FiberContext } from "@godspeedai/cognate-kernel-api";
import type { ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import type { HandlerContext } from "@godspeedai/cognate-kernel-api";
import type { ModelConfig } from "../src/components/providerRegistry.ts";
import type { SecretStore } from "../src/secrets.ts";
import { expertModelGenerateComponent } from "../src/capabilities/expertModel.ts";
import { agentCodingAgent, type AgentCodingInput } from "../src/agents/agentCoding.ts";

const route = (providerId: string, model: string): ModelConfig => ({
  providerId,
  baseURL: `https://${providerId}.invalid/v1`,
  protocol: "openai-compatible",
  model,
});

const response = (model: string, content = `answer from ${model}`): ModelResponse => ({
  message: { role: "assistant", content },
  toolCalls: [],
  finishReason: "stop",
  model,
});

function captureHandler(component: Component): (input: unknown, ctx: HandlerContext) => Promise<unknown> {
  let handler: ((input: unknown, ctx: HandlerContext) => unknown) | undefined;
  const fiber = {
    fiberId: "test-fiber",
    componentId: component.id,
    scope: undefined,
    dependencies: {},
    effects: { register: () => ({ label: "test", disposed: false, dispose: async () => {} }) },
    signal: new AbortController().signal,
    provide: (_contract: unknown, provided: (input: unknown, ctx: HandlerContext) => unknown) => { handler = provided; },
  } as unknown as FiberContext;
  component.activate(fiber);
  if (!handler) throw new Error("component did not provide its capability");
  return async (input, ctx) => await handler!(input, ctx);
}

function handlerContext(runId?: string): HandlerContext {
  return {
    actor: { id: "expert-runner", kind: "system" },
    tenant: "local",
    correlationId: "expert-assignment:assignment-1",
    runId,
    scopeId: "root",
    providerId: "test",
    capability: { id: "expert.model.generate", version: "1.0.0" },
    decision: { allow: true, policyId: "test", reason: "test" },
    signal: new AbortController().signal,
  } as HandlerContext;
}

const secrets: SecretStore = {
  async get(name) { return `secret:${name}`; },
  async put() {},
  async delete() {},
};

function serviceFor(routes: Readonly<Record<string, ModelConfig>>) {
  // J-CONTEXT-BUDGET: the capability now reads the run's invocation history, resolves spending
  // ceilings and holds a durable billing reservation, so the fake service carries a small
  // in-memory billing ledger alongside the run snapshots.
  const billing: { version: number; state: unknown } = { version: 0, state: { schema: 1, reservations: {} } };
  return {
    async getRun(_caller: unknown, { runId }: { readonly runId: string }) {
      const selected = routes[runId];
      return selected ? { agent: "agent.expert", input: { expertExecution: {
        expertId: `expert-${runId}`,
        assignmentId: `assignment-${runId}`,
        conversationId: `conversation-${runId}`,
        route: selected,
      } } } : { agent: "agent.expert", input: {} };
    },
    async *events(_caller: unknown, _request: unknown) {},
    async readProjection(_caller: unknown, _request: unknown) { return { rows: [] }; },
    async readSharedState(_caller: unknown, { threadId }: { readonly threadId: string }) {
      return threadId === "experts:billing:v1"
        ? { version: billing.version, state: structuredClone(billing.state) }
        : { version: 0 };
    },
    async updateSharedState(_caller: unknown, request: { readonly threadId: string; readonly expectedVersion: number; readonly update: { readonly snapshot?: unknown } }) {
      if (request.threadId !== "experts:billing:v1") throw new Error(`unexpected billing thread ${request.threadId}`);
      if (request.expectedVersion !== billing.version) throw new Error("billing ledger version conflict");
      billing.version += 1;
      billing.state = structuredClone(request.update.snapshot ?? { schema: 1, reservations: {} });
      return { version: billing.version, state: structuredClone(billing.state) };
    },
  } as never;
}

describe("J-EXPERT-SOLO and J-TEAM-DELEGATE model routing", () => {
  test("two experts use their own route without swapping shared provider state", async () => {
    const generated: string[] = [];
    const authorize = async (_ctx: HandlerContext, selected: ModelConfig) => {
      if (selected.providerId !== "provider-a" && selected.providerId !== "provider-b") throw new Error("route not in the run snapshot");
    };
    const component = expertModelGenerateComponent({
      secrets,
      getService: () => serviceFor({ "run-a": route("provider-a", "model-a"), "run-b": route("provider-b", "model-b") }),
      authorize,
      providerFactory: (selected) => ({
        id: selected.providerId,
        model: selected.model,
        features: { generate: true, stream: false, tool_use: true, structured_output: true, multimodal_input: false, context_limit: 4096 },
        async generate(_request: ModelRequest) {
          generated.push(`${selected.providerId}:${selected.model}`);
          return response(selected.model);
        },
        async *stream() {},
      } satisfies ModelProvider),
    });
    const invoke = captureHandler(component);
    const request = { messages: [{ role: "user" as const, content: "hello" }] };
    const [a, b] = await Promise.all([
      invoke({ route: route("provider-a", "model-a"), request }, handlerContext("run-a")) as Promise<ModelResponse>,
      invoke({ route: route("provider-b", "model-b"), request }, handlerContext("run-b")) as Promise<ModelResponse>,
    ]);
    expect(a.model).toBe("model-a");
    expect(b.model).toBe("model-b");
    expect(generated.sort()).toEqual(["provider-a:model-a", "provider-b:model-b"]);
  });

  test("route selection is checked against the durable run execution and rejected outside it", async () => {
    const authorized: string[] = [];
    const invoke = captureHandler(expertModelGenerateComponent({
      secrets,
      getService: () => serviceFor({ "run-a": route("provider-a", "model-a") }),
      authorize: async (ctx, selected) => {
        if (!ctx.runId) throw new Error("expert model route requires an Expert run");
        if (ctx.runId !== "run-a" || selected.model !== "model-a") throw new Error("route does not match the frozen Expert execution");
        authorized.push(ctx.runId);
      },
      providerFactory: (selected) => ({
        id: selected.providerId,
        model: selected.model,
        features: { generate: true, stream: false, tool_use: true, structured_output: true, multimodal_input: false, context_limit: 4096 },
        async generate() { return response(selected.model); },
        async *stream() {},
      } satisfies ModelProvider),
    }));
    const request = { messages: [{ role: "user" as const, content: "hello" }] };
    await expect(invoke({ route: route("provider-a", "model-a"), request }, handlerContext())).rejects.toThrow("requires an Expert run");
    await expect(invoke({ route: route("provider-b", "model-b"), request }, handlerContext("run-a"))).rejects.toThrow("does not match");
    await invoke({ route: route("provider-a", "model-a"), request }, handlerContext("run-a"));
    expect(authorized).toEqual(["run-a"]);
  });

  test("Expert coding uses its snapshotted route and supplied private context", async () => {
    const invocations: { capability: string; input: any }[] = [];
    const emitted: { type: string; payload: any }[] = [];
    const execution: NonNullable<AgentCodingInput["expertExecution"]> = {
      expertId: "expert-1",
      assignmentId: "assignment-1",
      conversationId: "conversation-1",
      instructions: "Review this narrowly.",
      route: route("critic-provider", "critic-model"),
      tools: ["read"],
      maxSteps: 3,
      context: [{ role: "assistant", content: "Private context for this Expert only." }],
    };
    const ctx = {
      runId: "expert-run-1",
      signal: new AbortController().signal,
      async emit(type: string, payload: unknown) { emitted.push({ type, payload }); },
      async invoke(capability: string, input: any) {
        invocations.push({ capability, input });
        if (capability === "plan.state") return { on: false, todos: [] };
        if (capability === "workspace.path") return { root: "/workspace", executionWorldId: "local" };
        if (capability === "expert.model.generate") return response("critic-model");
        if (capability === "steer.pending") return { steer: [] };
        throw new Error(`unexpected capability ${capability}`);
      },
      async state() { return null; },
      async step(_id: string, fn: () => Promise<unknown>) { return fn(); },
      async waitFor() { throw new Error("unexpected wait"); },
    };
    const result = await agentCodingAgent.run({
      sessionId: "solo-expert-1",
      workspaceId: "workspace-1",
      message: "Assess the change.",
      expertExecution: execution,
    } as never, ctx as never) as { readonly text: string };

    expect(result.text).toBe("answer from critic-model");
    expect(invocations.some((call) => call.capability === "session.history")).toBe(false);
    const modelCall = invocations.find((call) => call.capability === "expert.model.generate");
    expect(modelCall?.input.route).toEqual(execution.route);
    expect(modelCall?.input.request.messages).toEqual([
      ...execution.context,
      { role: "user", content: "Assess the change." },
    ]);
    expect(modelCall?.input.request.instructions).toContain(execution.instructions);
    expect(modelCall?.input.request.tools.map((tool: { name: string }) => tool.name)).toEqual(["read", "expert_return"]);
    expect(emitted.some((entry) => entry.type === "message.completed" && entry.payload.text === result.text)).toBe(true);
  });

  test("Expert tool allowlist rejects a returned tool call that was not offered", async () => {
    const calls: string[] = [];
    const emitted: { type: string; payload: any }[] = [];
    const ctx = {
      runId: "expert-run-1",
      signal: new AbortController().signal,
      async emit(type: string, payload: unknown) { emitted.push({ type, payload }); },
      async invoke(capability: string) {
        calls.push(capability);
        if (capability === "plan.state") return { on: false, todos: [] };
        if (capability === "workspace.path") return { root: "/workspace", executionWorldId: "local" };
        if (capability === "expert.model.generate") return {
          message: { role: "assistant", content: "" },
          toolCalls: [{ id: "tool-1", name: "bash", arguments: { command: "touch /tmp/should-not-run" } }],
          finishReason: "tool_calls",
          model: "model-a",
        };
        if (capability === "steer.pending") return { steer: [] };
        return {};
      },
      async state() { return null; },
      async step(_id: string, fn: () => Promise<unknown>) { return fn(); },
      async waitFor() { throw new Error("unexpected wait"); },
    };
    await agentCodingAgent.run({
      sessionId: "team-1:assignment-1",
      workspaceId: "workspace-1",
      message: "Do the assigned work.",
      expertExecution: {
        expertId: "expert-1",
        assignmentId: "assignment-1",
        conversationId: "team-conversation-1",
        teamId: "team-1",
        instructions: "Implement only.",
        route: route("provider-a", "model-a"),
        tools: ["read"],
        maxSteps: 1,
        context: [],
      },
    } as never, ctx as never);
    expect(calls).not.toContain("tool.bash");
    expect(emitted.some((entry) => entry.type === "tool.call.failed" && entry.payload.tool === "bash")).toBe(true);
  });

  test("Expert side effects cannot override the resolved workspace or execution world", async () => {
    const calls: { capability: string; input: any }[] = [];
    let modelCalls = 0;
    const ctx = {
      runId: "expert-run-1",
      signal: new AbortController().signal,
      async emit() {},
      async invoke(capability: string, input: any) {
        calls.push({ capability, input });
        if (capability === "plan.state") return { on: false, todos: [] };
        if (capability === "workspace.path") return { root: "/workspace", executionWorldId: "local-world" };
        if (capability === "expert.model.generate") {
          modelCalls += 1;
          return modelCalls === 1 ? {
            message: { role: "assistant", content: "Updating the file." },
            toolCalls: [{ id: "tool-1", name: "edit", arguments: { workspaceRoot: "/attacker", executionWorldId: "remote-world", file_path: "NewFile.md", old_string: "old", new_string: "new" } }],
            finishReason: "tool_calls", model: "model-a",
          } : response("model-a", "Updated the file.");
        }
        if (capability === "authority.check") return { outcome: "allow", rule: "test", reason: "allowed" };
        if (capability === "filesystem.resolve") return { path: "/workspace/NewFile.md" };
        if (capability === "filesystem.stat") return { stat: null };
        if (capability === "expert.tool.invoke") return { file_path: "NewFile.md", replacements: 1, diffLines: ["-old", "+new"], additions: 1, deletions: 1 };
        if (capability === "steer.pending") return { steer: [] };
        throw new Error(`unexpected capability ${capability}`);
      },
      async state() { return null; },
      async step(_id: string, fn: () => Promise<unknown>) { return fn(); },
      async waitFor() { throw new Error("unexpected approval wait"); },
    };
    await agentCodingAgent.run({
      sessionId: "expert-write-1", workspaceId: "workspace-1", message: "Create this file.", mode: "workspace-write",
      expertExecution: {
        expertId: "builder-1", assignmentId: "assignment-1", conversationId: "conversation-1",
        instructions: "Create the file.", route: route("provider-a", "model-a"), tools: ["edit"], maxSteps: 2, context: [],
      },
    } as never, ctx as never);
    const effect = calls.find((item) => item.capability === "expert.tool.invoke")?.input;
    expect(effect.input).toMatchObject({ workspaceRoot: "/workspace", executionWorldId: "local-world" });
    expect(effect.input.workspaceRoot).not.toBe("/attacker");
    expect(effect.input.executionWorldId).not.toBe("remote-world");
    expect(calls.some((item) => item.capability === "tool.edit")).toBe(false);
  });

  test("team_delegate keeps the nominated Specialist and waits for its durable correlated handoff", async () => {
    const calls: { capability: string; input: any }[] = [];
    const waits: { id: string; spec: any }[] = [];
    let modelCalls = 0;
    const ctx = {
      runId: "expert-run-1",
      signal: new AbortController().signal,
      async emit() {},
      async invoke(capability: string, input: any) {
        calls.push({ capability, input });
        if (capability === "plan.state") return { on: false, todos: [] };
        if (capability === "workspace.path") return { root: "/workspace", executionWorldId: "local" };
        if (capability === "expert.model.generate") {
          modelCalls += 1;
          return modelCalls === 1 ? {
            message: { role: "assistant", content: "I need a specialist." },
            toolCalls: [{ id: "delegate-1", name: "team_delegate", arguments: { expertId: "specialist-2", purpose: "Check the edge cases", acceptance: ["List cases and evidence"] } }],
            finishReason: "tool_calls",
            model: "model-a",
          } : response("model-a", "The specialist returned three checks.");
        }
        if (capability === "team.delegate") return { assignmentId: "child-assignment", status: "queued" };
        if (capability === "steer.pending") return { steer: [] };
        throw new Error(`unexpected capability ${capability}`);
      },
      async state() { return null; },
      async step(_id: string, fn: () => Promise<unknown>) { return fn(); },
      async waitFor(id: string, spec: unknown) {
        waits.push({ id, spec });
        return { disposition: "result", output: "three checks", evidence: ["artifact:receipt"] };
      },
    };
    const execution: NonNullable<AgentCodingInput["expertExecution"]> = {
      expertId: "orchestrator-1",
      assignmentId: "parent-assignment",
      conversationId: "team-conversation",
      teamId: "team-1",
      instructions: "Coordinate only necessary specialists.",
      route: route("provider-a", "model-a"),
      tools: ["team_delegate"],
      maxSteps: 2,
      context: [],
    };
    await agentCodingAgent.run({ sessionId: "team-1:parent-assignment", workspaceId: "workspace-1", message: "Review this.", expertExecution: execution } as never, ctx as never);
    const delegated = calls.find((item) => item.capability === "team.delegate")?.input;
    expect(delegated).toMatchObject({ expertId: "specialist-2", assignmentId: "parent-assignment", requestId: "expert:0:0" });
    expect(delegated.acceptance).toEqual(["List cases and evidence"]);
    expect(waits).toEqual([{
      id: "expert-assignment:child-assignment",
      spec: { type: "expert-assignment", condition: { kind: "expert_assignment", assignmentId: "child-assignment" }, payload: { assignmentId: "child-assignment" } },
    }]);
    expect(calls.some((item) => item.capability === "subagent.start")).toBe(false);
  });

  test("expert_return persists a typed abstention through the current assignment capability", async () => {
    const calls: { capability: string; input: any }[] = [];
    let modelCalls = 0;
    const ctx = {
      runId: "expert-run-1",
      signal: new AbortController().signal,
      async emit() {},
      async invoke(capability: string, input: any) {
        calls.push({ capability, input });
        if (capability === "plan.state") return { on: false, todos: [] };
        if (capability === "workspace.path") return { root: "/workspace", executionWorldId: "local" };
        if (capability === "expert.model.generate") {
          modelCalls += 1;
          return modelCalls === 1 ? {
            message: { role: "assistant", content: "I cannot verify this claim." },
            toolCalls: [{ id: "return-1", name: "expert_return", arguments: { disposition: "abstained", output: "Insufficient evidence.", uncertainties: ["The referenced artifact is unavailable."], failures: [] } }],
            finishReason: "tool_calls",
            model: "model-a",
          } : response("model-a", "I have abstained pending evidence.");
        }
        if (capability === "team.handoff") return { ok: true };
        if (capability === "steer.pending") return { steer: [] };
        throw new Error(`unexpected capability ${capability}`);
      },
      async state() { return null; },
      async step(_id: string, fn: () => Promise<unknown>) { return fn(); },
      async waitFor() { throw new Error("unexpected wait"); },
    };
    await agentCodingAgent.run({
      sessionId: "solo-expert-1", workspaceId: "workspace-1", message: "Can you verify this?",
      expertExecution: {
        expertId: "verifier-1", assignmentId: "assignment-1", conversationId: "conversation-1",
        instructions: "Verify independently.", route: route("provider-a", "model-a"), tools: [], maxSteps: 2, context: [],
      },
    } as never, ctx as never);
    expect(calls.find((item) => item.capability === "expert.model.generate")?.input.request.tools.map((tool: { name: string }) => tool.name)).toContain("expert_return");
    expect(calls.find((item) => item.capability === "team.handoff")?.input).toMatchObject({
      assignmentId: "assignment-1",
      disposition: "abstained", output: "Insufficient evidence.", uncertainties: ["The referenced artifact is unavailable."],
    });
  });
});
