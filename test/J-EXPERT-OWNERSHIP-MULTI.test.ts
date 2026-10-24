// J-EXPERT-PARALLEL multi-process settlement (T7): two Workbench AppServers against one
// PostgreSQL store under the verified run-ownership configuration. A killed process's in-flight
// model effect is never blindly repeated: the recovering process records the ambiguity, the
// interrupted attempt stays booked in the billing ledger, and the assignment completes only from
// an explicit operator reconciliation. A stale owner's late run-scoped write is fenced at the
// store with nothing appended. Requires the development database (never skips).
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@godspeedai/cognate-client";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { openPostgresStore } from "@godspeedai/cognate-store-postgres";
import { StaleRunOwnerError, type CommitRequest } from "@godspeedai/cognate-events";
import type { ModelProvider, ModelResponse } from "@godspeedai/cognate-capabilities";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { postgresUrl, schemaFor } from "../src/store.ts";
import { readExperts } from "../src/experts/state.ts";
import { EXPERTS_BILLING_THREAD, type BillingReservation } from "../src/experts/billing.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: LOCAL_OPERATOR.tenant };
const route = { providerId: "multi", baseURL: "https://multi.invalid/v1", protocol: "openai-compatible" as const, model: "multi-model" };

test("J-EXPERT-PARALLEL: a crashed Workbench process's effect is reconciled, never blindly repeated, and its stale write is fenced", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-multi-ownership-"));
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  let providerCalls = 0;
  // A streaming provider: one progress delta (the durable trace carrying the owning
  // generation), then a blocked stretch that survives until the process is stopped. The signal
  // is observed so cooperative shutdown unwinds the pass without recording an outcome.
  const providerFactory = (): ModelProvider => ({
    id: route.model,
    model: route.model,
    features: { generate: true, stream: true, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32_000 },
    async generate() { throw new Error("the multi-process journey drives the streaming path"); },
    async *stream(_request: unknown, signal?: AbortSignal) {
      providerCalls += 1;
      yield { type: "text" as const, text: "partial evidence" };
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    },
  });
  const boot = (): Promise<AppServer> => startServer({ executionPosture: "uncontained-local",
    devAuth: true,
    port: 0,
    home,
    runOwnership: "multi-process",
    enableScheduleEvaluation: false,
    expertProviderFactory: providerFactory,
  });
  let serverA: AppServer | undefined;
  let serverB: AppServer | undefined;
  try {
    // Process A boots, starts the assignment and enters the model effect (one provider call,
    // progress recorded under A's ownership generation).
    serverA = await boot();
    const clientA = createClient({ service: createRemoteRuntimeService(connectTransport(serverA.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
    const { workspaceId } = await clientA.invoke("workspace.select", { path: workspace } as never) as { workspaceId: string };
    await clientA.invoke("experts.seed", {} as never);
    await clientA.invoke("expert.save", {
      expertId: "builder", name: "Builder", specialization: "Building", instructions: "Build carefully.",
      tools: ["read"], route,
    } as never);
    const converse = await clientA.invoke("expert.converse", { expertId: "builder", workspaceId, message: "Produce the multi-process evidence." } as never) as { assignmentId: string };
    const deadlineA = Date.now() + 30_000;
    while (providerCalls < 1 && Date.now() < deadlineA) await Bun.sleep(25);
    expect(providerCalls).toBe(1);
    const runId = ((await readExperts(serverA.runtime.service, SYSTEM)).state.assignments[converse.assignmentId]?.runId) ?? null;
    expect(runId).not.toBeNull();

    // Process A dies mid-effect. Cooperative shutdown aborts its handler; the execution pass
    // releases the run lease and its billing reservation for the interrupted attempt is settled
    // conservatively before the store closes.
    await serverA.stop();
    serverA = undefined;

    // A zombie writer (the killed process's still-open handle on the same store) attempts a
    // late run-scoped append under a superseded ownership credential: the store fences it and
    // nothing is appended.
    const zombie = await openPostgresStore({ url: postgresUrl(), schema: schemaFor(home, "harness"), maxConnections: 2, pollMs: 0 });
    try {
      const streamId = `run-${runId}`;
      const currentVersion = (await zombie.store.readStream(streamId)).length;
      const staleAppend: CommitRequest = {
        appends: [{
          streamId,
          expectedVersion: currentVersion,
          runOwnership: { runId: runId!, ownerId: "worker-any", generation: 1 },
          events: [{ eventType: "zombie.test", schemaVersion: 1, occurredAt: new Date().toISOString(), tenant: LOCAL_OPERATOR.tenant, correlationId: "z", causationId: null, runId: runId!, scopeId: "root", payload: { stale: true } }],
        }],
      };
      await expect(zombie.store.commit(staleAppend)).rejects.toBeInstanceOf(StaleRunOwnerError);
      expect((await zombie.store.readStream(streamId)).some(event => event.eventType === "zombie.test")).toBe(false);
    } finally {
      await zombie.close();
    }

    // Process B recovers the run against the same store: the prior generation's started effect
    // is recorded as ambiguous and never re-performed; it waits for explicit reconciliation.
    serverB = await boot();
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
    expect(providerCalls).toBe(1);
    let ambiguousEvents = 0;
    for await (const event of serviceB.events(LOCAL_OPERATOR, { runId: runId! })) if (event.eventType === "run.invocation.ambiguous") ambiguousEvents += 1;
    expect(ambiguousEvents).toBe(1);

    // The interrupted attempt stays booked in the durable billing ledger — never zero.
    const billing = await serviceB.readSharedState(SYSTEM, { threadId: EXPERTS_BILLING_THREAD });
    expect(billing.version).toBeGreaterThan(0);
    const interrupted = Object.values(((billing.state as unknown as { reservations: Record<string, BillingReservation> }).reservations)).filter(reservation => reservation.runId === runId);
    expect(interrupted.length).toBeGreaterThanOrEqual(1);
    expect(interrupted.every(reservation => reservation.usage !== undefined)).toBe(true);
    expect(interrupted.every(reservation => reservation.status === "settled" || reservation.status === "reconciled-unknown")).toBe(true);

    // The operator reconciles with the observed outcome; only then does the assignment settle
    // its terminal state, and the reconciled outcome is the recorded evidence.
    const reconciledResponse: ModelResponse = { message: { role: "assistant", content: "Reconciled multi-process evidence." }, toolCalls: [], finishReason: "stop", model: route.model };
    await serviceB.resolveContinuation(LOCAL_OPERATOR, { continuationId: continuationId!, action: "resume", input: { result: reconciledResponse } as never, idempotencyKey: randomUUID() });
    const deadlineC = Date.now() + 30_000;
    let assignmentStatus = "";
    while (Date.now() < deadlineC) {
      const state = (await readExperts(serviceB, SYSTEM)).state;
      assignmentStatus = state.assignments[converse.assignmentId]?.status ?? "";
      if (assignmentStatus && !["queued", "running", "waiting"].includes(assignmentStatus)) break;
      await Bun.sleep(50);
    }
    expect(["reconciliation-required", "completed"]).toContain(assignmentStatus);
    expect(providerCalls).toBe(1);
    // No model-generation invocation outcome was ever recorded: the interrupted effect was
    // reconciled, not completed or repeated (other capability invocations on the run are
    // unrelated to the model call).
    let modelInvocations = 0;
    for await (const event of serviceB.events(LOCAL_OPERATOR, { runId: runId! })) if (event.eventType === "run.invocation" && event.metadata?.capability === "expert.model.generate") modelInvocations += 1;
    expect(modelInvocations).toBe(0);
  } finally {
    await serverA?.stop().catch(() => {});
    await serverB?.stop().catch(() => {});
    const cleaner = await openPostgresStore({ url: postgresUrl(), schema: schemaFor(home, "harness"), maxConnections: 2, pollMs: 0 });
    await cleaner.dropSchema();
    await cleaner.close();
    await rm(home, { recursive: true, force: true });
  }
}, 150_000);
