import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@godspeedai/cognate-client";
import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { ExpertState } from "../src/experts/types.ts";
import { readExperts } from "../src/experts/state.ts";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import type { ModelConfig } from "../src/components/providerRegistry.ts";
import type { Assignment } from "../src/experts/types.ts";

export type FakeResponder = (route: ModelConfig, request: ModelRequest, signal?: AbortSignal) => Promise<ModelResponse>;

export interface ExpertTestApp {
  readonly app: AppServer;
  readonly client: ReturnType<typeof createClient>;
  readonly home: string;
  readonly workspaceId: string;
  readonly providerCalls: { readonly model: string; readonly toolNames: readonly string[]; readonly messages: readonly ModelMessage[] }[];
  state(): Promise<ExpertState>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

const completed = (model: string, content: string): ModelResponse => ({
  message: { role: "assistant", content }, toolCalls: [], finishReason: "stop", model,
});

export function collaborationResponder(route: ModelConfig, request: ModelRequest): Promise<ModelResponse> {
  const toolNames = (request.tools ?? []).map((tool) => tool.name);
  if (route.model === "pm-model" && toolNames.includes("team_delegate") && !request.messages.some((m) => m.role === "tool")) {
    return Promise.resolve({
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: "delegate-builder-1", name: "team_delegate", arguments: {
        expertId: "builder", purpose: "Implement the requested behavior", acceptance: ["Return the implementation result"],
      } }],
      finishReason: "tool_calls", model: route.model,
    });
  }
  if (route.model === "builder-model") return Promise.resolve(completed(route.model, "Builder completed the assigned implementation."));
  if (route.model === "pm-model") return Promise.resolve(completed(route.model, "Product Manager reconciled the Builder handoff."));
  return Promise.resolve(completed(route.model, `${route.model} completed the objective.`));
}

export async function withExpertApp<T>(responder: FakeResponder, fn: (testApp: ExpertTestApp) => Promise<T>, options: { readonly runCapacity?: 1 | 2 | 4 | 8 } = {}): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "cognate-experts-test-"));
  const calls: { model: string; toolNames: readonly string[]; messages: readonly ModelMessage[] }[] = [];
  const providerFactory = (route: ModelConfig): ModelProvider => ({
    id: route.providerId,
    model: route.model,
    features: { generate: true, stream: false, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32_000 },
    async generate(request, signal) {
      calls.push({ model: route.model, toolNames: (request.tools ?? []).map((tool) => tool.name), messages: request.messages });
      return responder(route, request, signal);
    },
    async *stream() {},
  });
  let app: AppServer | undefined;
  let client: ReturnType<typeof createClient> | undefined;
  let closed = false;
  try {
    const launch = async () => {
      app = await startServer({ devAuth: true, port: 0, home, expertProviderFactory: providerFactory, enableScheduleEvaluation: false, ...options, runCapacity: options.runCapacity ?? 1 });
      const caller = LOCAL_OPERATOR;
      const service = createRemoteRuntimeService(connectTransport(app.url), () => devToken(caller));
      client = createClient({ service, caller });
    };
    await launch();
    const workspace = join(home, "workspace");
    await mkdir(workspace, { recursive: true });
    const selected = await client!.invoke("workspace.select", { path: workspace } as never) as { workspaceId: string };
    const testApp: ExpertTestApp = {
      get app() { return app!; }, get client() { return client!; }, home, workspaceId: selected.workspaceId, providerCalls: calls,
      async state() {
        return (await readExperts(app!.runtime.service, { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant })).state;
      },
      async restart() {
        await client?.close(); await app?.stop();
        await launch();
      },
      async close() {
        if (closed) return;
        closed = true;
        await client?.close();
        await app?.stop();
        await rm(home, { recursive: true, force: true });
      },
    };
    return await fn(testApp);
  } finally {
    if (!closed && (client || app)) {
      closed = true;
      await client?.close().catch(() => {});
      await app?.stop().catch(() => {});
    }
    await rm(home, { recursive: true, force: true });
  }
}

export const route = (model: string): ModelConfig => ({
  providerId: `fake-${model}-${randomUUID()}`,
  baseURL: "https://fake-provider.invalid/v1",
  protocol: "openai-compatible",
  model,
});

export async function configureDefaultRoutes(testApp: ExpertTestApp, overrides: { readonly productManager?: ModelConfig; readonly builder?: ModelConfig; readonly critic?: ModelConfig } = {}) {
  const current = await testApp.state();
  await testApp.client.invoke("expert.save", {
    expertId: "product-manager", name: current.experts["product-manager"]!.name,
    specialization: current.experts["product-manager"]!.definition.specialization,
    instructions: current.experts["product-manager"]!.definition.instructions,
    tools: current.experts["product-manager"]!.definition.tools,
    route: overrides.productManager ?? route("pm-model"),
  } as never);
  await testApp.client.invoke("expert.save", {
    expertId: "builder", name: current.experts.builder!.name,
    specialization: current.experts.builder!.definition.specialization,
    instructions: current.experts.builder!.definition.instructions,
    tools: current.experts.builder!.definition.tools,
    route: overrides.builder ?? route("builder-model"),
  } as never);
  await testApp.client.invoke("expert.save", {
    expertId: "critic", name: current.experts.critic!.name,
    specialization: current.experts.critic!.definition.specialization,
    instructions: current.experts.critic!.definition.instructions,
    tools: current.experts.critic!.definition.tools,
    route: overrides.critic ?? route("critic-model"),
  } as never);
}

export async function waitForState(testApp: ExpertTestApp, predicate: (state: ExpertState) => boolean, label: string, timeoutMs = 20_000): Promise<ExpertState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await testApp.state();
    if (predicate(state)) return state;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

export async function waitForAssignment(testApp: ExpertTestApp, assignmentId: string, predicate: (assignment: Assignment) => boolean, timeoutMs = 20_000): Promise<Assignment> {
  const state = await waitForState(testApp, (current) => {
    const assignment = current.assignments[assignmentId];
    return assignment !== undefined && predicate(assignment);
  }, `Assignment ${assignmentId}`, timeoutMs);
  return state.assignments[assignmentId]!;
}

export async function waitForRun(testApp: ExpertTestApp, runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await testApp.app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    if (Date.now() >= deadline) throw new Error(`Run ${runId} did not settle; current status: ${run.status}`);
    await Bun.sleep(20);
  }
}

export const invoke = (testApp: ExpertTestApp, capability: string, input: unknown) =>
  testApp.client.invoke(capability, input as never);
