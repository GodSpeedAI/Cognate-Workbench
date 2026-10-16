// J-CONTEXT-BUDGET: durable billing reservations. Real native Expert runs settle reservations
// from provider-reported usage; configured spending ceilings refuse over-ceiling and unpriced
// dispatch before the provider is called; an owner interrupted between reservation and dispatch
// is reconciled on restart without blind repetition; the ledger survives restarts; ordinary coding
// sessions hold their own reservations under the session ceiling.
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { withExpertApp, configureDefaultRoutes, invoke, waitForAssignment } from "./expert-helpers.ts";
import { bootApp, withTempHome } from "./helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { EXPERTS_BILLING_THREAD, isBillingState, markReconciledUnknown, readSpendingCeilings, releaseModelCall, reserveModelCall, settleModelCall, type BillingReservation } from "../src/experts/billing.ts";

const SYSTEM: Caller = { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant };

async function ledger(service: RuntimeService): Promise<BillingReservation[]> {
  const result = await service.readSharedState(SYSTEM, { threadId: EXPERTS_BILLING_THREAD });
  if (result.version === 0) return [];
  if (!isBillingState(result.state)) throw new Error("billing ledger schema is unreadable");
  return Object.values((result.state as { reservations: Record<string, BillingReservation> }).reservations);
}

async function waitForCeilings(service: RuntimeService, predicate: (ceilings: Awaited<ReturnType<typeof readSpendingCeilings>>) => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(await readSpendingCeilings(service, LOCAL_OPERATOR))) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(200);
  }
}

const responderWithUsage = (usage: { inputTokens: number; outputTokens: number }) => async (route: { model: string }) => ({
  message: { role: "assistant" as const, content: "Reserved and settled evidence." }, toolCalls: [], finishReason: "stop" as const, model: route.model, usage,
});

test("J-CONTEXT-BUDGET: expert dispatches hold durable reservations, honor ceilings and reconcile interruptions", async () => {
  await withExpertApp(responderWithUsage({ inputTokens: 120, outputTokens: 30 }), async app => {
    await app.client.invoke("experts.seed", {} as never);
    await configureDefaultRoutes(app);
    const save = async (budget: unknown) => {
      const expert = (await app.state()).experts.builder!;
      await invoke(app, "expert.save", { expertId: expert.id, name: expert.name, specialization: expert.definition.specialization, instructions: expert.definition.instructions, tools: ["read"], route: expert.definition.route, ...(budget ? { budget } : {}) });
    };
    const priced = { contextTokens: 32000, maxOutputTokens: 400, prices: { inputUsdPerMillion: 2, outputUsdPerMillion: 4 } };

    // A real native run settles its reservation from provider-reported usage. A completed run
    // leaves its Assignment awaiting human settlement ("reconciliation-required").
    await save(priced);
    const first = await invoke(app, "expert.converse", { expertId: "builder", workspaceId: app.workspaceId, message: "Produce the reserved evidence." } as never) as { assignmentId: string };
    const firstAssignment = await waitForAssignment(app, first.assignmentId, a => a.status === "reconciliation-required");
    const service = app.app.runtime.service;
    const settled = (await ledger(service)).find(r => r.kind === "expert-model" && r.assignmentId === first.assignmentId);
    expect(settled).toBeDefined();
    expect(settled!.status).toBe("settled");
    expect(settled!.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, source: "provider" });
    expect(settled!.costUsd).not.toBeNull();
    expect(settled!.costUsd!).toBeCloseTo((120 * 2 + 30 * 4) / 1_000_000, 12);
    expect(settled!.model).toBe("builder-model");

    // A configured global ceiling refuses over-ceiling dispatch before the provider is called.
    const providerCallsBefore = app.providerCalls.length;
    await invoke(app, "settings.changeSpending", { spending: { globalUsd: 0.000001 } } as never);
    const blocked = await invoke(app, "expert.converse", { expertId: "builder", workspaceId: app.workspaceId, message: "This must be refused by the ceiling." } as never) as { assignmentId: string };
    const blockedAssignment = await waitForAssignment(app, blocked.assignmentId, a => a.status === "failed");
    expect(app.providerCalls).toHaveLength(providerCallsBefore);
    expect(blockedAssignment.handoff?.failures.join(" ")).toContain("Global spending ceiling exceeded");
    expect((await ledger(service)).some(r => r.assignmentId === blocked.assignmentId)).toBe(false);

    // With ceilings configured, unpriced model activity fails closed: the ceiling cannot be verified.
    await save({ contextTokens: 32000, maxOutputTokens: 400 });
    const unpriced = await invoke(app, "expert.converse", { expertId: "builder", workspaceId: app.workspaceId, message: "Unpriced work must also be refused while ceilings stand." } as never) as { assignmentId: string };
    const unpricedAssignment = await waitForAssignment(app, unpriced.assignmentId, a => a.status === "failed");
    expect(app.providerCalls).toHaveLength(providerCallsBefore);
    expect(unpricedAssignment.handoff?.failures.join(" ")).toContain("cannot be enforced without explicit input and output prices");

    // An owner interrupted between reservation and dispatch is never blindly repeated: the
    // recovery re-execution books the interrupted attempt conservatively as unknown and proceeds
    // under a new, separately booked generation of the same identity.
    const interruptedId = `${firstAssignment.runId}:expert-model:9`;
    const baseEntry = {
      id: interruptedId, kind: "expert-model" as const, runId: firstAssignment.runId!, assignmentId: first.assignmentId, attempt: 1,
      sessionId: null, model: "builder-model", inputTokens: 500, reservedOutputTokens: 100, prices: priced.prices,
    };
    await reserveModelCall(service, SYSTEM, baseEntry, undefined);
    const generationOne = await reserveModelCall(service, SYSTEM, baseEntry, undefined);
    expect(generationOne.id).toBe(`${interruptedId}:r1`);
    expect(generationOne.status).toBe("reserved");
    const interrupted = (await ledger(service)).find(r => r.id === interruptedId);
    expect(interrupted!.status).toBe("reconciled-unknown");
    expect(interrupted!.usage).toMatchObject({ inputTokens: 500, outputTokens: 100, source: "reconciled-conservative" });
    expect(interrupted!.costUsd).toBeCloseTo((500 * 2 + 100 * 4) / 1_000_000, 12);
    const generationTwo = await reserveModelCall(service, SYSTEM, baseEntry, undefined);
    expect(generationTwo.id).toBe(`${interruptedId}:r2`);
    expect((await ledger(service)).filter(r => r.id.startsWith(interruptedId))).toHaveLength(3);
    // Every attempt is booked exactly once: repeating the recovery does not double-count.
    expect((await ledger(service)).find(r => r.id === interruptedId)!.status).toBe("reconciled-unknown");

    // Restart reconciles the still-open generations: the owning run is terminal with no
    // committed invocation at that index, so the outcome is unestablishable and books
    // conservatively as unknown — never zero, never repeated.
    await app.restart();
    for (const id of [`${interruptedId}:r1`, `${interruptedId}:r2`]) {
      const reconciled = (await ledger(app.app.runtime.service)).find(r => r.id === id);
      expect(reconciled).toBeDefined();
      expect(reconciled!.status).toBe("reconciled-unknown");
      expect(reconciled!.costUsd).toBeCloseTo((500 * 2 + 100 * 4) / 1_000_000, 12);
    }
    const generationThree = await reserveModelCall(app.app.runtime.service, SYSTEM, baseEntry, undefined);
    expect(generationThree.id).toBe(`${interruptedId}:r3`);

    // The settled first reservation survived the restart, and clearing the ceilings restores dispatch.
    expect((await ledger(app.app.runtime.service)).find(r => r.assignmentId === first.assignmentId && r.status === "settled")).toBeDefined();
    await invoke(app, "settings.changeSpending", { spending: {} } as never);
    const cleared = await waitForCeilings(app.app.runtime.service, ceilings => ceilings === undefined || ceilings.globalUsd === undefined);
    expect(cleared).toBe(true);

    // A provable no-dispatch release may re-reserve the same identity exactly once more.
    const releasedId = `${firstAssignment.runId}:expert-model:10`;
    await reserveModelCall(app.app.runtime.service, SYSTEM, {
      id: releasedId, kind: "expert-model", runId: firstAssignment.runId!, assignmentId: first.assignmentId, attempt: 1,
      sessionId: null, model: "builder-model", inputTokens: 10, reservedOutputTokens: 5, prices: priced.prices,
    }, undefined);
    await releaseModelCall(app.app.runtime.service, SYSTEM, releasedId, "journey-proven no dispatch");
    const reactivated = await reserveModelCall(app.app.runtime.service, SYSTEM, {
      id: releasedId, kind: "expert-model", runId: firstAssignment.runId!, assignmentId: first.assignmentId, attempt: 1,
      sessionId: null, model: "builder-model", inputTokens: 10, reservedOutputTokens: 5, prices: priced.prices,
    }, undefined);
    expect(reactivated.status).toBe("reserved");
    await settleModelCall(app.app.runtime.service, SYSTEM, releasedId, { inputTokens: 10, outputTokens: 5, source: "unreported" }, "journey cleanup");

    // The public billing projection carries the sanitized ledger view.
    await app.app.runtime.idle();
    const billing = (await app.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts-billing" })).rows;
    const current = billing.find(row => row.key === "current")?.value as { reservations: { id: string }[]; knownCostUsd: number };
    expect(current.reservations.length).toBeGreaterThanOrEqual(2);
    expect(current.knownCostUsd).toBeGreaterThan(0);
  });
}, 120_000);

test("J-CONTEXT-BUDGET: ordinary sessions reserve under the session and global ceilings", async () => {
  await withTempHome(async home => {
    // A local endpoint that answers every request with an immediate 500: the provider call fails
    // fast and deterministically, which is exactly the journey's failed-dispatch scenario.
    const failing = Bun.serve({ port: 0, fetch: () => new Response("boom", { status: 500 }) });
    const { app, client } = await bootApp(home);
    try {
      await client.invoke("model.configure", {
        providerId: "billing-mock", baseURL: `http://127.0.0.1:${failing.port}/v1`, protocol: "openai-compatible",
        model: "mock-model-1", apiKey: "", prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
      } as never);
      const { workspaceId } = await client.invoke("workspace.select", { path: home } as never) as { workspaceId: string };
      const poll = async (runId: string) => {
        for (;;) {
          const run = await app.runtime.service.getRun({ actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant }, { runId });
          if (["completed", "failed", "cancelled"].includes(run.status)) return run;
          await Bun.sleep(100);
        }
      };
      const startTurn = (sessionId: string) => client.startRun("agent.coding", { sessionId, workspaceId, message: "one reserved turn" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });

      // A failed provider dispatch still books its conservative session reservation.
      const sessionId = randomUUID();
      const failedRun = await poll((await startTurn(sessionId)).runId);
      expect(failedRun.status).toBe("failed");
      const service = app.runtime.service;
      let sessionReservations = (await ledger(service)).filter(r => r.kind === "session-model" && r.sessionId === sessionId);
      expect(sessionReservations.length).toBeGreaterThanOrEqual(1);
      expect(sessionReservations.every(r => r.status === "settled")).toBe(true);
      expect(sessionReservations.every(r => r.usage?.source === "unreported")).toBe(true);
      expect(sessionReservations.every(r => r.prices !== null)).toBe(true);

      // The session ceiling refuses the next turn before any provider dispatch.
      await client.invoke("settings.changeSpending", { spending: { sessionUsd: 0.000001, globalUsd: 1000 } } as never);
      expect(await waitForCeilings(service, ceilings => ceilings?.sessionUsd === 0.000001 && ceilings.globalUsd === 1000)).toBe(true);
      const ceilingRun = await poll((await startTurn(sessionId)).runId);
      expect(ceilingRun.status).toBe("failed");
      const before = (await ledger(service)).length;
      expect((await ledger(service)).filter(r => r.runId === ceilingRun.runId)).toHaveLength(0);
      expect(before).toBeGreaterThanOrEqual(sessionReservations.length);

      // Clearing the ceiling restores session dispatch.
      await client.invoke("settings.changeSpending", { spending: {} } as never);
      expect(await waitForCeilings(service, ceilings => ceilings === undefined || (ceilings.sessionUsd === undefined && ceilings.globalUsd === undefined))).toBe(true);
      const restoredRun = await poll((await startTurn(randomUUID())).runId);
      expect(restoredRun.status).toBe("failed"); // provider endpoint stays unreachable; the reservation is what must exist
      const restored = (await ledger(service)).filter(r => r.runId === restoredRun.runId);
      expect(restored.length).toBeGreaterThanOrEqual(1);
      expect(restored.every(r => r.status === "settled")).toBe(true);
    } finally {
      await app.stop();
      failing.stop(true);
    }
  });
}, 120_000);

test("J-CONTEXT-BUDGET: unknown ledger states and direct reconciliation transitions fail closed", async () => {
  await withTempHome(async home => {
    const { app } = await bootApp(home);
    try {
      const service = app.runtime.service;
      await expect(settleModelCall(service, LOCAL_OPERATOR, "missing-id", { inputTokens: 1, outputTokens: 1, source: "provider" }, "test")).rejects.toThrow("does not exist");
      await expect(markReconciledUnknown(service, LOCAL_OPERATOR, "missing-id", "test")).rejects.toThrow("does not exist");
      await expect(reserveModelCall(service, LOCAL_OPERATOR, {
        id: "conflicting", kind: "session-model", runId: null, assignmentId: null, attempt: null,
        sessionId: "s", model: "m", inputTokens: 1, reservedOutputTokens: 1, prices: null,
      }, { globalUsd: 5 })).rejects.toThrow("cannot be enforced without explicit input and output prices");
      const prices = { inputUsdPerMillion: 1, outputUsdPerMillion: 1 };
      await reserveModelCall(service, LOCAL_OPERATOR, {
        id: "conflicting", kind: "session-model", runId: null, assignmentId: null, attempt: null,
        sessionId: "s", model: "m", inputTokens: 1, reservedOutputTokens: 1, prices,
      }, { globalUsd: 5 });
      await expect(reserveModelCall(service, LOCAL_OPERATOR, {
        id: "conflicting", kind: "session-model", runId: null, assignmentId: null, attempt: null,
        sessionId: "s", model: "m", inputTokens: 2, reservedOutputTokens: 1, prices,
      }, { globalUsd: 5 })).rejects.toThrow("reused for different work");
      await expect(reserveModelCall(service, LOCAL_OPERATOR, {
        id: "another", kind: "session-model", runId: null, assignmentId: null, attempt: null,
        sessionId: "s", model: "m", inputTokens: 1, reservedOutputTokens: 1, prices,
      }, { globalUsd: 0.000001 })).rejects.toThrow("Global spending ceiling exceeded");
      await expect(readSpendingCeilings(service, LOCAL_OPERATOR)).resolves.toBeUndefined();
    } finally {
      await app.stop();
    }
  });
}, 60_000);
