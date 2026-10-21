// J-AMBIGUOUS-RECONCILE: an agent capability call interrupted by a process stop is never silently
// repeated under the DEFAULT posture (no runOwnership / runCapacity options). The recovering
// process records one `run.invocation.ambiguous`, opens an `ambiguous-invocation` continuation and
// waits. Only a direct operator may record the observed outcome through `run.invocation.reconcile`.
// Mechanism mirrors test/J-EXPERT-OWNERSHIP-MULTI.test.ts (a streaming provider blocks mid model
// call; the server is stopped; a second server boots on the same home/store). Requires the
// development database (never skips).
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@godspeedai/cognate-client";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { openPostgresStore } from "@godspeedai/cognate-store-postgres";
import type { ModelProvider } from "@godspeedai/cognate-capabilities";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { postgresUrl, schemaFor } from "../src/store.ts";
import { readExperts } from "../src/experts/state.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: LOCAL_OPERATOR.tenant };
const AGENT = { actor: { id: "builder-agent", kind: "agent" as const }, tenant: LOCAL_OPERATOR.tenant };
const route = { providerId: "ambiguous", baseURL: "https://ambiguous.invalid/v1", protocol: "openai-compatible" as const, model: "ambiguous-model" };
const RECONCILE = "run.invocation.reconcile";

interface Interrupted {
  readonly home: string;
  readonly runId: string;
  readonly continuationId: string;
  readonly serviceB: RuntimeService;
  readonly serverB: AppServer;
  readonly providerCalls: () => number;
}

// Boots the default posture, starts an expert run whose model call blocks, stops that process
// mid-call and recovers on a second default-posture process over the same store.
async function interruptedRun(home: string, serversOpened: AppServer[]): Promise<Interrupted> {
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  let providerCalls = 0;
  const providerFactory = (): ModelProvider => ({
    id: route.model,
    model: route.model,
    features: { generate: true, stream: true, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32_000 },
    async generate() { throw new Error("the ambiguous-step journey drives the streaming path"); },
    async *stream(_request: unknown, signal?: AbortSignal) {
      providerCalls += 1;
      // Only the first call is the interrupted effect; any later model call answers normally.
      if (providerCalls > 1) {
        yield { type: "done" as const, response: { message: { role: "assistant", content: "Recovered reply." }, toolCalls: [], finishReason: "stop", model: route.model } };
        return;
      }
      yield { type: "text" as const, text: "partial evidence" };
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    },
  });
  const boot = async (): Promise<AppServer> => {
    const server = await startServer({ devAuth: true, port: 0, home, enableScheduleEvaluation: false, expertProviderFactory: providerFactory });
    serversOpened.push(server);
    return server;
  };
  const serverA = await boot();
  const clientA = createClient({ service: createRemoteRuntimeService(connectTransport(serverA.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
  const { workspaceId } = await clientA.invoke("workspace.select", { path: workspace } as never) as { workspaceId: string };
  await clientA.invoke("experts.seed", {} as never);
  await clientA.invoke("expert.save", { expertId: "builder", name: "Builder", specialization: "Building", instructions: "Build carefully.", tools: ["read"], route } as never);
  const converse = await clientA.invoke("expert.converse", { expertId: "builder", workspaceId, message: "Produce the evidence." } as never) as { assignmentId: string };
  const deadlineA = Date.now() + 30_000;
  while (providerCalls < 1 && Date.now() < deadlineA) await Bun.sleep(25);
  expect(providerCalls).toBe(1);
  const runId = (await readExperts(serverA.runtime.service, SYSTEM)).state.assignments[converse.assignmentId]?.runId;
  expect(runId).toBeTruthy();
  await serverA.stop();

  const serverB = await boot();
  const serviceB = serverB.runtime.service;
  let continuationId: string | undefined;
  const deadlineB = Date.now() + 30_000;
  while (Date.now() < deadlineB) {
    const waits = await serviceB.listContinuations(LOCAL_OPERATOR, { runId: runId!, status: "OPEN" });
    continuationId = waits.find(wait => wait.type === "ambiguous-invocation")?.id;
    if (continuationId) break;
    await Bun.sleep(50);
  }
  expect(continuationId).toBeDefined();
  return { home, runId: runId!, continuationId: continuationId!, serviceB, serverB, providerCalls: () => providerCalls };
}

async function cleanup(home: string, servers: AppServer[]): Promise<void> {
  for (const server of servers) await server.stop().catch(() => {});
  const cleaner = await openPostgresStore({ url: postgresUrl(), schema: schemaFor(home, "harness"), maxConnections: 2, pollMs: 0 });
  await cleaner.dropSchema();
  await cleaner.close();
  await rm(home, { recursive: true, force: true });
}

async function countEvents(service: RuntimeService, runId: string, eventType: string): Promise<number> {
  let count = 0;
  for await (const event of service.events(LOCAL_OPERATOR, { runId })) if (event.eventType === eventType) count += 1;
  return count;
}

async function waitForRunLeaving(service: RuntimeService, runId: string, from: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let status = from;
  while (Date.now() < deadline) {
    status = (await service.getRun(LOCAL_OPERATOR, { runId })).status;
    if (status !== from) break;
    await Bun.sleep(50);
  }
  return status;
}

test("J-AMBIGUOUS-RECONCILE: an interrupted step under the default posture waits, is refused for agents and blank reasons, and reconciles once", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-ambiguous-reconcile-"));
  const servers: AppServer[] = [];
  try {
    const run = await interruptedRun(home, servers);
    const { serviceB, runId, continuationId } = run;

    // Exactly one ambiguity, the effect ran once, the run is waiting on the operator.
    expect(run.providerCalls()).toBe(1);
    expect(await countEvents(serviceB, runId, "run.invocation.ambiguous")).toBe(1);
    expect((await serviceB.getRun(LOCAL_OPERATOR, { runId })).status).toBe("waiting");
    const open = await serviceB.listContinuations(LOCAL_OPERATOR, { runId, status: "OPEN" });
    expect(open.find(item => item.id === continuationId)).toMatchObject({ type: "ambiguous-invocation", status: "OPEN" });

    // Refusals: an agent caller, a blank reason, an unknown continuation.
    await expect(serviceB.invoke(AGENT, { capability: RECONCILE, input: { continuationId, outcome: "succeeded", reason: "agent self-approval" } })).rejects.toThrow();
    await expect(serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId, outcome: "succeeded", reason: "   " } })).rejects.toThrow();
    await expect(serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId: "not-a-continuation", outcome: "failed", reason: "wrong id" } })).rejects.toThrow();
    expect((await serviceB.getRun(LOCAL_OPERATOR, { runId })).status).toBe("waiting");

    // The interrupted step is a model call: there is no external effect to confirm and no response to
    // reconstruct, so "succeeded" is refused and the run keeps waiting.
    await expect(serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId, outcome: "succeeded", reason: "Operator says it worked." } })).rejects.toThrow("cannot be confirmed as succeeded");
    expect((await serviceB.getRun(LOCAL_OPERATOR, { runId })).status).toBe("waiting");
    expect((await serviceB.listContinuations(LOCAL_OPERATOR, { runId })).find(item => item.id === continuationId)?.status).toBe("OPEN");

    // "failed" is the honest record for a model call: the agent retries it and the run completes.
    const reconciled = await serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId, outcome: "failed", reason: "The provider never produced a response." } });
    expect(reconciled).toMatchObject({ runId, continuationId, outcome: "failed" });
    const after = await waitForRunLeaving(serviceB, runId, "waiting");
    expect(["running", "completed"]).toContain(after);
    const deadline = Date.now() + 60_000;
    let status = after;
    while (status !== "completed" && Date.now() < deadline) { await Bun.sleep(100); status = (await serviceB.getRun(LOCAL_OPERATOR, { runId })).status; }
    expect(status).toBe("completed");
    expect(run.providerCalls()).toBe(2); // the interrupted attempt once, the operator-sanctioned retry once
    expect(await countEvents(serviceB, runId, "run.invocation.ambiguous")).toBe(1);
    expect((await serviceB.listContinuations(LOCAL_OPERATOR, { runId })).find(item => item.id === continuationId)?.status).toBe("RESUMED");

    // Reconciling the already-resolved continuation is refused.
    await expect(serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId, outcome: "failed", reason: "second attempt" } })).rejects.toThrow();
  } finally {
    await cleanup(home, servers);
  }
}, 150_000);

test("J-AMBIGUOUS-RECONCILE: a failed operator observation is delivered as a failed step, never as a silent repeat of the interrupted effect", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-ambiguous-failed-"));
  const servers: AppServer[] = [];
  try {
    const run = await interruptedRun(home, servers);
    const { serviceB, runId, continuationId } = run;
    expect(await countEvents(serviceB, runId, "run.invocation.ambiguous")).toBe(1);

    await serviceB.invoke(LOCAL_OPERATOR, { capability: RECONCILE, input: { continuationId, outcome: "failed", reason: "The provider never produced a response." } });
    // The observed failure is delivered to the agent as a failed invocation. The expert model step
    // then retries its own model call as a NEW invocation (model.request.retried); the interrupted
    // attempt is not that call. Its original effect stays at exactly one provider call.
    const deadline = Date.now() + 60_000;
    while (run.providerCalls() < 2 && Date.now() < deadline) await Bun.sleep(100);
    expect(run.providerCalls()).toBe(2);
    expect(await countEvents(serviceB, runId, "model.request.retried")).toBe(1);
    expect(await countEvents(serviceB, runId, "run.invocation.ambiguous")).toBe(1);
    expect((await serviceB.listContinuations(LOCAL_OPERATOR, { runId })).find(item => item.id === continuationId)?.status).toBe("RESUMED");
  } finally {
    await cleanup(home, servers);
  }
}, 150_000);
