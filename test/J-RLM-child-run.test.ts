// Journey J-RLM-CHILD-RUN (ticket #112, Workbench half): the Workbench consumes the published
// Cognate 0.11.0 recursive child-run (`rlm.*`) contract. The real server runs with a deterministic
// in-process test provider (modelled on Cognate's own rlm test provider; no real spawn port exists
// in this slice). Every refusal is asserted to leave no child run and no provider effect.
import { describe, expect, test } from "bun:test";
import type { Json } from "@godspeedai/cognate-events";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import type { InvocationView, ProviderFacts, RlmInvokeRequest, RlmProvider } from "@godspeedai/cognate-runtime-api";
import { RLM_AGENT_ID, RLM_CAPABILITIES, RLM_REFUSAL_CODES } from "@godspeedai/cognate-runtime-api";
import type { RlmProviderRegistration } from "@godspeedai/cognate-runtime-bun";
import type { Component, CapabilityContract, FiberContext } from "@godspeedai/cognate-kernel-api";
import { createRlmRegistry } from "@godspeedai/cognate-runtime-bun";
import { governedRlmComponent } from "../src/capabilities/rlmGoverned.ts";
import type { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { Assignment } from "../src/experts/types.ts";
import {
  collaborationResponder, configureDefaultRoutes, invoke, waitForAssignment, withExpertApp,
  type ExpertTestApp, type FakeResponder,
} from "./expert-helpers.ts";

interface Deferred { readonly promise: Promise<void>; release(): void }
const deferred = (): Deferred => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

interface TestProvider extends RlmProvider {
  readonly invokes: RlmInvokeRequest[];
  readonly cancels: string[];
  probes: number;
}

function testProvider(id: string, options: { gate?: Deferred; facts?: Partial<ProviderFacts>; fail?: boolean; unknown?: boolean } = {}): TestProvider {
  const views = new Map<string, InvocationView>();
  const facts: ProviderFacts = {
    capabilities: { maxDepth: 2, contextDecomposition: true, providerInternalSubagents: false, streaming: false, isolation: "none", resultDelivery: "return", cancellation: "none", paymentMetering: "unreported" },
    toolPolicy: "bridge-only",
    executable: null,
    ...options.facts,
  };
  const view = (status: InvocationView["status"]): InvocationView => ({
    status, evidence: [`test-provider:${id}:${status}`], payment: { currency: "money", spent: "unknown", basis: "unmeasured" }, isolation: "none", lastEventAt: new Date().toISOString(),
    ...(status === "completed" ? { resultRef: `result:${id}` } : {}),
  });
  const state = { invokes: [] as RlmInvokeRequest[], cancels: [] as string[], probes: 0 };
  const provider: RlmProvider = {
    id,
    async probe() { state.probes += 1; return facts; },
    async invoke(req, _spawn, ctx) {
      state.invokes.push(req);
      if (options.gate) {
        await Promise.race([options.gate.promise, new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }))]);
      }
      if (ctx.signal.aborted) throw new Error("cancelled");
      views.set(ctx.runId, view(options.unknown ? "unknown" : options.fail ? "failed" : "completed"));
      return { runId: ctx.runId };
    },
    async inspect(runId) { return views.get(runId) ?? view("failed"); },
    async cancel(runId) { state.cancels.push(runId); },
  };
  Object.defineProperties(provider, {
    invokes: { get: () => state.invokes, enumerable: true },
    cancels: { get: () => state.cancels, enumerable: true },
    probes: { get: () => state.probes, enumerable: true },
  });
  return provider as TestProvider;
}

const registration = (provider: RlmProvider, extra: Partial<RlmProviderRegistration> = {}): RlmProviderRegistration => ({ provider, label: `Test ${provider.id}`, ...extra });

const completion = (model: string, content: string): ModelResponse => ({ message: { role: "assistant", content }, toolCalls: [], finishReason: "stop", model });

/** Cases are keyed by `CASE:<name>` in the human message; each table row is the model's tool call(s). */
type ToolArgs = Record<string, Json>;
const cases: Record<string, readonly { id: string; args: ToolArgs }[]> = {};
const base = (over: ToolArgs = {}): ToolArgs => ({ purpose: "Investigate the failing behavior recursively", acceptance: ["Report the finding"], contextRefs: ["assignment"], tools: ["read"], budget: { limit: 0.5 }, ...over });

const responderFor = (model: string): FakeResponder => async (route, request) => {
  if (route.model !== model) return collaborationResponder(route, request);
  const text = JSON.stringify(request.messages);
  const name = /CASE:([a-z0-9-]+)/.exec(text)?.[1];
  const planned = name ? cases[name] : undefined;
  if (planned && !request.messages.some((m) => m.role === "tool")) {
    return { message: { role: "assistant", content: "" }, toolCalls: planned.map((c) => ({ id: c.id, name: "rlm_delegate", arguments: c.args })), finishReason: "tool_calls", model: route.model };
  }
  return completion(route.model, name ? `Reconciled after child run (${name}).` : "done");
};

async function runCase(t: ExpertTestApp, name: string, rlmProvider?: string, planned?: readonly { id: string; args: ToolArgs }[]): Promise<Assignment> {
  cases[name] = planned ?? [{ id: `call-${name}`, args: base() }];
  const started = await invoke(t, "team.converse", {
    teamId: "cognate-team", workspaceId: t.workspaceId, message: `CASE:${name}`, requestId: `rlm-case-${name}`,
    ...(rlmProvider ? { rlmProvider } : {}),
  }) as { assignmentId: string };
  return waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
}

async function runEvents(t: ExpertTestApp, runId: string) {
  const out: { eventType: string; payload: Record<string, unknown> }[] = [];
  for await (const event of t.app.runtime.service.events(LOCAL_OPERATOR, { runId })) out.push({ eventType: event.eventType, payload: event.payload as Record<string, unknown> });
  return out;
}

const toolFailures = async (t: ExpertTestApp, a: Assignment) => (await runEvents(t, a.runId!)).filter((e) => e.eventType === "tool.call.failed").map((e) => String(e.payload.error));
const childRuns = (t: ExpertTestApp) => t.app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: RLM_AGENT_ID });

async function saveExpertBudget(t: ExpertTestApp, expertId: string, _model: string, maxCostUsd = 5) {
  const current = (await t.state()).experts[expertId]!;
  await invoke(t, "expert.save", {
    expertId, name: current.name, specialization: current.definition.specialization, instructions: current.definition.instructions,
    tools: current.definition.tools, route: current.definition.route,
    budget: { contextTokens: 32000, maxOutputTokens: 400, maxCostUsd, prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 } },
  });
}

describe("J-RLM-CHILD-RUN", () => {
  test("empty registry: ordinary Team delegation is unchanged, providers are empty, and an unselected or unknown provider leaves no child run", async () => {
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      const providers = await invoke(t, RLM_CAPABILITIES.providers, {}) as { providers: unknown[]; admission: { governance: string; posture: string; externalProvider: string } };
      expect(providers.providers).toEqual([]);
      // Governed admission stays closed: no SEA authority and no containment claim.
      expect(providers.admission).toMatchObject({ governance: "off", posture: "uncontained-local" });

      // Ordinary Team delegation (Orchestrator -> Builder) behaves exactly as before.
      const ordinary = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "ordinary delegation", requestId: "rlm-empty-ordinary" }) as { assignmentId: string };
      const settled = await waitForAssignment(t, ordinary.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
      expect(settled.execution.rlm).toBeUndefined();
      expect(settled.handoff?.rlmChildren).toBeUndefined();
      expect(t.providerCalls.filter((c) => c.model === "pm-model").every((c) => !c.toolNames.includes("rlm_delegate"))).toBe(true);

      // An explicitly selected provider that is not registered: typed refusal, no child run.
      const ghost = await runCase(t, "ghost", "ghost");
      expect((await toolFailures(t, ghost)).join("\n")).toContain("rlm-provider-unknown");
      expect(await childRuns(t)).toHaveLength(0);
    });
  }, 60_000);

  test("configured provider: derived principal and grant, pinned context, stable child run id, the parent waits and the handoff carries the child outcome", async () => {
    const gate = deferred();
    const provider = testProvider("det", { gate });
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      await saveExpertBudget(t, "product-manager", "pm-model");
      const inspectBeforeAny = await invoke(t, RLM_CAPABILITIES.providers, {}) as { providers: { id: string; capabilities: { isolation: string }; executable: unknown; status: string; toolPolicy: string }[] };
      // providers reports probed facts, not claims.
      expect(inspectBeforeAny.providers).toHaveLength(1);
      expect(inspectBeforeAny.providers[0]).toMatchObject({ id: "det", status: "available", toolPolicy: "bridge-only", executable: null });
      expect(inspectBeforeAny.providers[0]!.capabilities.isolation).toBe("none");
      expect(provider.probes).toBeGreaterThan(0);

      cases.happy = [{ id: "call-happy", args: base({ principal: "system", actor: "wb-agent:builder", grant: ["bash"], authority: { tools: ["bash"] } }) }];
      const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "CASE:happy", requestId: "rlm-case-happy", rlmProvider: "det" }) as { assignmentId: string };

      // Provider selection is frozen in the Assignment's execution snapshot.
      const queued = (await t.state()).assignments[started.assignmentId]!;
      expect(queued.execution.rlm).toEqual({ providerId: "det" });

      const deadline = Date.now() + 20_000;
      while (provider.invokes.length === 0) {
        if (Date.now() > deadline) throw new Error("provider was never invoked");
        await Bun.sleep(20);
      }
      const running = await waitForAssignment(t, started.assignmentId, (a) => !!a.runId);
      const parentRunId = running.runId!;
      // The parent is waiting for the linked child run: no handoff yet.
      await Bun.sleep(300);
      const midway = (await t.state()).assignments[started.assignmentId]!;
      expect(midway.handoff).toBeNull();
      expect(["running", "waiting"]).toContain(midway.status);

      const [child] = await childRuns(t);
      expect(child).toBeDefined();
      expect(child!.agent).toBe(RLM_AGENT_ID);
      // Principal derived from the parent run; the model-supplied principal/actor/grant fields were ignored.
      expect(child!.startedBy).toBe("wb-agent:product-manager");
      const request = provider.invokes[0]!;
      expect(request.runId).toBe(parentRunId);
      expect(request.depth).toBe(1);
      expect(request.maxDepth).toBe(2);
      expect(request.authority.tools).toEqual(["read"]);
      expect(request.authority.mode).toBe("read-only");
      expect(request.task.contextDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(request.budget.currency).toBe("money");
      expect(request.budget.limit).toBe(0.5);
      expect(request.budget.reservationRef).toBe(`expert-budget:${started.assignmentId}:1`);
      expect(running.execution.tools).toEqual(expect.arrayContaining(request.authority.tools as string[]));

      const startedEvent = (await runEvents(t, parentRunId)).find((e) => e.eventType === "rlm.child.started")!;
      const invocationId = String(startedEvent.payload.invocationId);
      expect(startedEvent.payload.childRunId).toBe(child!.runId);
      expect(startedEvent.payload.contextDigest).toBe(request.task.contextDigest);

      // The operator inspects through the parent principal (parent-scoped).
      const open = await invoke(t, RLM_CAPABILITIES.inspect, { invocationId, parentRunId }) as { status: string; providerId: string };
      expect(["admitted", "running"]).toContain(open.status);
      expect(open.providerId).toBe("det");

      gate.release();
      const settled = await waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
      expect(settled.handoff?.rlmChildren).toEqual([expect.objectContaining({ invocationId, runId: child!.runId, status: "completed", providerId: "det" })]);
      expect(settled.handoff?.evidence).toContain(`rlm-child:${child!.runId}:completed`);
      // The child outcome is recorded before the parent composed its handoff, and review is retained.
      const events = await runEvents(t, parentRunId);
      const idx = (type: string) => events.findIndex((e) => e.eventType === type);
      expect(idx("rlm.child.completed")).toBeGreaterThan(-1);
      expect(idx("rlm.child.completed")).toBeLessThan(idx("message.completed"));
      expect(settled.status).toBe("reconciliation-required");
      expect(settled.review).toBeNull();
      expect(settled.settlement).toBeNull();

      const done = await invoke(t, RLM_CAPABILITIES.inspect, { invocationId, parentRunId }) as { status: string; resultRef?: string; evidence: string[] };
      expect(done.status).toBe("completed");
      expect(done.evidence).toContain("test-provider:det:completed");
      expect(done.resultRef).toBe("result:det");
      // Terminal states are stable and cancel is a no-op.
      expect(await invoke(t, RLM_CAPABILITIES.cancel, { invocationId, parentRunId, reason: "late" })).toEqual({ status: "already-terminal" });
      expect(provider.cancels).toHaveLength(0);
    }, { rlmProviders: [registration(provider)] });
  }, 90_000);

  test("duplicate requests resolve to the same invocation and child run; a failed child ends the wait with its failure", async () => {
    const provider = testProvider("det");
    const failing = testProvider("bad", { fail: true });
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      await saveExpertBudget(t, "product-manager", "pm-model");
      const a = await runCase(t, "dup", "det", [
        { id: "dup-1", args: base({ key: "same-identity" }) },
        { id: "dup-2", args: base({ key: "same-identity" }) },
      ]);
      expect(provider.invokes).toHaveLength(1);
      expect(await childRuns(t)).toHaveLength(1);
      const started = (await runEvents(t, a.runId!)).filter((e) => e.eventType === "rlm.child.started");
      expect(started).toHaveLength(2);
      expect(started[0]!.payload.invocationId).toBe(started[1]!.payload.invocationId);
      expect(started[0]!.payload.childRunId).toBe(started[1]!.payload.childRunId);
      expect(a.handoff?.rlmChildren).toHaveLength(1);

      const failed = await runCase(t, "failing", "bad");
      expect(failed.handoff?.rlmChildren).toEqual([expect.objectContaining({ status: "failed", providerId: "bad" })]);
      expect(failing.invokes).toHaveLength(1);
    }, { rlmProviders: [registration(provider), registration(failing)] });
  }, 90_000);

  test("operator cancel acts through the parent principal and the parent resumes with the cancelled outcome", async () => {
    const gate = deferred();
    const provider = testProvider("det", { gate });
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      await saveExpertBudget(t, "product-manager", "pm-model");
      cases.cancel = [{ id: "call-cancel", args: base() }];
      const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "CASE:cancel", requestId: "rlm-case-cancel", rlmProvider: "det" }) as { assignmentId: string };
      const running = await waitForAssignment(t, started.assignmentId, (a) => !!a.runId);
      const parentRunId = running.runId!;
      let invocationId = "";
      const deadline = Date.now() + 20_000;
      while (!invocationId) {
        const e = (await runEvents(t, parentRunId)).find((ev) => ev.eventType === "rlm.child.started");
        if (e) invocationId = String(e.payload.invocationId);
        else if (Date.now() > deadline) throw new Error("no child started");
        else await Bun.sleep(20);
      }

      // Standing: another agent, the right agent id outside the parent run, and a mismatching parent are refused.
      const asAgent = (id: string) => ({ actor: { id, kind: "agent" as const }, tenant: LOCAL_OPERATOR.tenant });
      const service = t.app.runtime.service;
      for (const caller of [asAgent("wb-agent:builder"), asAgent("wb-agent:product-manager")]) {
        for (const capability of [RLM_CAPABILITIES.inspect, RLM_CAPABILITIES.cancel]) {
          const error = await service.invoke(caller, { capability, input: { invocationId, parentRunId, reason: "forged" } }).then(() => "", (e: Error) => e.message);
          expect(error).toContain("rlm-invocation-unknown");
        }
      }
      expect(provider.cancels).toHaveLength(0);
      expect((await childRuns(t))[0]!.status).not.toBe("cancelled");

      const cancelled = await invoke(t, RLM_CAPABILITIES.cancel, { invocationId, parentRunId, reason: "operator stop" }) as { status: string };
      expect(cancelled.status).toBe("cancelled");
      expect(provider.cancels).toHaveLength(1);
      const settled = await waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
      expect(settled.handoff?.rlmChildren).toEqual([expect.objectContaining({ invocationId, status: "cancelled" })]);
    }, { rlmProviders: [registration(provider)] });
  }, 90_000);

  test("refusals happen before dispatch: top-level, no selection, out-of-grant, unverifiable reservation, unavailable and containment-requiring providers", async () => {
    const det = testProvider("det");
    const down = testProvider("down");
    const spawns = testProvider("spawns", { facts: { executable: { version: "1.0.0", sha256: "a".repeat(64) } } });
    const boxed = testProvider("boxed", { facts: { toolPolicy: "contained" } });
    const egress = testProvider("egress");
    const all = [det, down, spawns, boxed, egress];
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      const refusedWith = async (a: Assignment, code: string) => {
        expect(RLM_REFUSAL_CODES as readonly string[]).toContain(code);
        expect((await toolFailures(t, a)).join("\n")).toContain(code);
      };
      const nothingDispatched = async () => {
        expect(all.flatMap((p) => p.invokes)).toHaveLength(0);
        expect(await childRuns(t)).toHaveLength(0);
      };

      // Top-level (no parent run): the operator cannot invoke directly, however the request is shaped.
      for (const input of [{}, { parent: { runId: "run-forged", depth: 0, maxDepth: 5, authorityTools: ["read", "bash"] }, providerId: "det" }]) {
        const error = await invoke(t, RLM_CAPABILITIES.invoke, input).then(() => "", (e: Error) => e.message);
        expect(error).toContain("rlm-top-level-invocation");
      }

      // Unverifiable reservation: the parent Expert has no cost budget.
      await refusedWith(await runCase(t, "nobudget", "det"), "rlm-budget-unverifiable");
      await nothingDispatched();

      await saveExpertBudget(t, "product-manager", "pm-model", 1);
      // A reservation larger than the parent's remaining budget is equally unverifiable.
      await refusedWith(await runCase(t, "overbudget", "det", [{ id: "c1", args: base({ budget: { limit: 50 } }) }]), "rlm-budget-unverifiable");
      await refusedWith(await runCase(t, "unboundedbudget", "det", [{ id: "c1", args: base({ budget: null }) }]), "rlm-budget-unverifiable");
      // Out-of-grant authority is refused, never narrowed.
      await refusedWith(await runCase(t, "exceeds", "det", [{ id: "c1", args: base({ tools: ["read", "bash"] }) }]), "rlm-authority-exceeds-parent");
      await refusedWith(await runCase(t, "writes", "det", [{ id: "c1", args: base({ mode: "workspace-write" }) }]), "rlm-authority-exceeds-parent");
      // Providers: unknown, unavailable, spawning, contained, egress.
      await refusedWith(await runCase(t, "unavailable", "down"), "rlm-provider-unavailable");
      await refusedWith(await runCase(t, "spawns", "spawns"), "rlm-port-unavailable");
      await refusedWith(await runCase(t, "boxed", "boxed"), "rlm-containment-unavailable");
      await refusedWith(await runCase(t, "egress", "egress"), "rlm-egress-uncontrolled");
      // A request for a provider other than the frozen selection is refused.
      await refusedWith(await runCase(t, "other", "det", [{ id: "c1", args: base({ providerId: "egress" }) }]), "rlm-provider-unknown");
      // An unresolvable pinned context is refused.
      await refusedWith(await runCase(t, "context", "det", [{ id: "c1", args: base({ contextRefs: ["file:/etc/passwd"] }) }]), "rlm-context-digest-mismatch");
      // No selection frozen: the tool is not offered and a hallucinated call is refused (old snapshots behave as no RLM).
      const unselected = await runCase(t, "noselect");
      expect(unselected.execution.rlm).toBeUndefined();
      expect((await toolFailures(t, unselected)).length).toBeGreaterThan(0);
      expect(t.providerCalls.filter((c) => c.model === "pm-model" && JSON.stringify(c.messages).includes("CASE:noselect")).every((c) => !c.toolNames.includes("rlm_delegate"))).toBe(true);
      await nothingDispatched();
    }, {
      rlmProviders: [
        registration(det),
        registration(down, { availability: { status: "unavailable", reason: "operator disabled" } }),
        registration(spawns),
        registration(boxed, { portGovernance: { world: "contained-streaming", reach: { filesystem: "workspace-ro", network: "none", process: "group-kill", lifetime: "parent-death" }, evidence: "process-ledger" } }),
        registration(egress, { portGovernance: { world: "local", reach: { filesystem: "none", network: "proxied", process: "group-kill", lifetime: "parent-death" }, evidence: "none", egress: { via: "loopback-proxy", destinations: ["example.invalid"] } } }),
      ],
    });
  }, 180_000);

  test("depth reuses the Team maxDepth semantics: a Specialist at the Team limit cannot recurse", async () => {
    const det = testProvider("det");
    const responder: FakeResponder = async (route, request) => {
      const text = JSON.stringify(request.messages);
      if (route.model === "pm-model" && text.includes("CASE:depth") && !request.messages.some((m) => m.role === "tool")) {
        return { message: { role: "assistant", content: "" }, toolCalls: [{ id: "delegate-depth", name: "team_delegate", arguments: { expertId: "builder", purpose: "CASE:depth-builder work", acceptance: ["Report"] } }], finishReason: "tool_calls", model: route.model };
      }
      if (route.model === "builder-model" && !request.messages.some((m) => m.role === "tool")) {
        return { message: { role: "assistant", content: "" }, toolCalls: [{ id: "builder-rlm", name: "rlm_delegate", arguments: base() }], finishReason: "tool_calls", model: route.model };
      }
      return collaborationResponder(route, request);
    };
    await withExpertApp(responder, async (t) => {
      await configureDefaultRoutes(t);
      await saveExpertBudget(t, "builder", "builder-model", 1);
      const team = (await t.state()).teams["cognate-team"]!;
      await invoke(t, "team.save", { teamId: team.id, name: team.name, tools: team.tools, limits: { maxDepth: 1 } });
      const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "CASE:depth", requestId: "rlm-case-depth", rlmProvider: "det" }) as { assignmentId: string };
      const parent = await waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
      const state = await t.state();
      const builder = Object.values(state.assignments).find((a) => a.parentId === parent.id)!;
      // The frozen selection is inherited from the Orchestrator's snapshot, never taken from the model.
      expect(builder.execution.rlm).toEqual({ providerId: "det" });
      expect(builder.depth).toBe(1);
      expect((await toolFailures(t, builder)).join("\n")).toContain("rlm-depth-exceeded");
      expect(det.invokes).toHaveLength(0);
      expect(await childRuns(t)).toHaveLength(0);
    }, { rlmProviders: [registration(det)] });
  }, 90_000);

  test("unknown outcome: the child parks, the parent keeps waiting, operator reconciliation resolves it once, and an unconfirmed outcome is never plain success", async () => {
    const provider = testProvider("amb", { unknown: true });
    await withExpertApp(responderFor("pm-model"), async (t) => {
      await configureDefaultRoutes(t);
      await saveExpertBudget(t, "product-manager", "pm-model");
      const service = t.app.runtime.service;
      let expectedInvokes = 0;
      for (const [name, outcome, status] of [["amb-ok", "succeeded", "completed"], ["amb-bad", "failed", "failed"]] as const) {
        cases[name] = [{ id: `call-${name}`, args: base() }];
        const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: `CASE:${name}`, requestId: `rlm-case-${name}`, rlmProvider: "amb" }) as { assignmentId: string };
        expectedInvokes += 1;
        const parent = await waitForAssignment(t, started.assignmentId, (a) => !!a.runId);
        let wait: Awaited<ReturnType<typeof service.listContinuations>>[number] | undefined;
        const deadline = Date.now() + 20_000;
        while (!wait) {
          wait = (await service.listContinuations(LOCAL_OPERATOR, { status: "OPEN" })).find((c) => c.type === "ambiguous-invocation");
          if (!wait) { if (Date.now() > deadline) throw new Error("child never parked on an ambiguous invocation"); await Bun.sleep(25); }
        }
        // The parent keeps waiting: no handoff, and the child is parked, not terminal.
        await Bun.sleep(400);
        expect((await t.state()).assignments[parent.id]!.handoff).toBeNull();
        const child = (await service.getRun(LOCAL_OPERATOR, { runId: wait.runId }));
        expect(child.status).toBe("waiting");
        const started0 = (await runEvents(t, parent.runId!)).find((e) => e.eventType === "rlm.child.started")!;
        const inspected = await invoke(t, RLM_CAPABILITIES.inspect, { invocationId: String(started0.payload.invocationId), parentRunId: parent.runId }) as { status: string };
        expect(inspected.status).toBe("unknown");
        expect(new Set(provider.invokes.map((r) => r.invocationId)).size).toBe(expectedInvokes);

        const reconciled = await invoke(t, "run.invocation.reconcile", { continuationId: wait.id, outcome, reason: `operator observed ${outcome}` }) as { outcome: string };
        expect(reconciled.outcome).toBe(outcome);
        const settled = await waitForAssignment(t, parent.id, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status));
        const children = settled.handoff!.rlmChildren!;
        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({ runId: child.runId, status });
        if (outcome === "succeeded") {
          // Reconciled, not confirmed by the provider: surfaced as an uncertainty, never plain success.
          expect(children[0]!.reconciled).toBe(true);
          expect(settled.handoff!.uncertainties.join("\n")).toContain("recorded by an operator");
        }
        // No second child run or invocation identity is created by the wait or the reconciliation. (Cognate 0.11.0
        // re-executes the child agent body on resume, so the provider's `invoke` may be re-entered for the SAME
        // invocation; that is pinned by the identity check here and reported upstream, not hidden.)
        expect(await childRuns(t)).toHaveLength(expectedInvokes);
        expect(new Set(provider.invokes.map((r) => r.invocationId)).size).toBe(expectedInvokes);
        expect(provider.invokes.every((r) => r.runId === provider.invokes.find((q) => q.invocationId === r.invocationId)!.runId)).toBe(true);
      }
    }, { rlmProviders: [registration(provider)] });
  }, 120_000);

  test("parent-scoped standing at the wrapper: the parent run reaches its own invocation, a sibling run cannot, and the operator acts through the parent principal", async () => {
    const seen: { id: string; actor: string; kind: string; input: Record<string, unknown> }[] = [];
    const contracts: CapabilityContract[] = Object.values(RLM_CAPABILITIES).map((id) => ({ id, version: "1.0.0" }) as CapabilityContract);
    const base: Component = {
      id: "rlm", provides: contracts,
      activate(fiber) { for (const c of contracts) fiber.provide(c, async (input, ctx) => { seen.push({ id: c.id, actor: ctx.actor.id, kind: ctx.actor.kind, input: input as Record<string, unknown> }); return { status: "cancelled" }; }); },
    };
    const handlers = new Map<string, (input: unknown, ctx: never) => Promise<unknown>>();
    const experts = { caller: () => LOCAL_OPERATOR, service: { getRun: async (_c: unknown, r: { runId: string }) => { if (r.runId !== "run-parent") throw new Error("missing"); return { startedBy: "wb-agent:product-manager" }; } } } as unknown as ExpertsService;
    await governedRlmComponent({ base, registry: createRlmRegistry(), getExperts: () => experts, operator: LOCAL_OPERATOR.actor, operatorTenant: LOCAL_OPERATOR.tenant })
      .activate({ provide: (c: CapabilityContract, h: never) => handlers.set(c.id, h) } as unknown as FiberContext);
    const inRun = (runId: string, id = "wb-agent:product-manager") => ({ runId, actor: { id, kind: "agent" }, tenant: LOCAL_OPERATOR.tenant }) as never;
    for (const capability of [RLM_CAPABILITIES.inspect, RLM_CAPABILITIES.cancel]) {
      const handler = handlers.get(capability)!;
      seen.length = 0;
      // The parent run itself: its own invocation is reached, scoped to its own run id.
      await handler({ invocationId: "inv-1", reason: "own child" }, inRun("run-parent"));
      expect(seen).toEqual([expect.objectContaining({ id: capability, actor: "wb-agent:product-manager", input: expect.objectContaining({ parentRunId: "run-parent" }) })]);
      // A sibling run, even of the same agent id, or an explicit foreign parent, is refused before Cognate sees it.
      await expect(handler({ invocationId: "inv-1", parentRunId: "run-parent" }, inRun("run-sibling"))).rejects.toThrow("rlm-invocation-unknown");
      await expect(handler({ invocationId: "inv-1", parentRunId: "run-parent" }, inRun("run-sibling", "wb-agent:builder"))).rejects.toThrow("rlm-invocation-unknown");
      expect(seen).toHaveLength(1);
      // Without naming a parent, a sibling is scoped to its OWN run (where Cognate finds no such invocation); it never reaches run-parent.
      await handler({ invocationId: "inv-1" }, inRun("run-sibling"));
      expect(seen.pop()).toMatchObject({ input: expect.objectContaining({ parentRunId: "run-sibling" }) });
      // The operator acts through the parent run's principal; an agent outside any run is refused.
      await handler({ invocationId: "inv-1", parentRunId: "run-parent", reason: "operator" }, { actor: LOCAL_OPERATOR.actor, tenant: LOCAL_OPERATOR.tenant } as never);
      expect(seen[1]).toMatchObject({ actor: "wb-agent:product-manager", kind: "agent" });
      await expect(handler({ invocationId: "inv-1", parentRunId: "run-parent" }, { actor: { id: "wb-agent:product-manager", kind: "agent" }, tenant: LOCAL_OPERATOR.tenant } as never)).rejects.toThrow("rlm-invocation-unknown");
      expect(seen).toHaveLength(2);
    }
  });
});
