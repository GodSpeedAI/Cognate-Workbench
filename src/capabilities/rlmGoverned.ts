// `rlm.providers|invoke|inspect|cancel`: the Workbench consumer of Cognate's published recursive
// child-run contract (J-RLM-CHILD-RUN). Cognate's `createRlmComponent` owns the contract and the
// child run; this wrapper owns the *host* decisions Cognate leaves to the caller, so a caller can
// never attest them:
//
// - the parent lineage (run, Assignment, attempt, depth, maxDepth, grant) is DERIVED from the
//   registered Expert Assignment of `ctx.runId`, never taken from the request;
// - the child's authority is a subset of the parent's frozen tools and mode, refused (never
//   narrowed) otherwise; the child's principal is the parent run's (Cognate derives it);
// - provider selection comes from the Assignment's frozen execution snapshot (`execution.rlm`);
// - the budget reservation is the parent's per-attempt cost ceiling (`economics.ts`), consulted
//   against its real prior spend and earlier child reservations; no verifiable reservation refuses;
// - the context is resolved from the frozen Assignment and pinned by sha256 digest;
// - the invocation identity is derived from the parent run and the request id, so a repeat
//   resolves to the same invocation and Child Run (Cognate re-uses the recorded binding);
// - governed admission is CLOSED: governance is reported off and posture uncontained-local, and a
//   provider that spawns an executable, claims isolation, needs containment or has network reach is
//   refused with the matching typed code, because this host registers no spawn port or containment.
// - `rlm.inspect`/`rlm.cancel` are parent-scoped: the parent run itself, or the operator acting
//   through the parent run's principal. Another run or agent is refused.
//
// Every refusal is thrown before anything is dispatched, so a refusal leaves no Child Run and no
// provider effect. Registry configuration is trusted host configuration, never a request.
import { createHash } from "node:crypto";
import type { Json, StoredEvent } from "@godspeedai/cognate-events";
import type { CapabilityContract, CapabilityHandler, Component, FiberContext, HandlerContext, Principal } from "@godspeedai/cognate-kernel-api";
import { foldState, RLM_CAPABILITIES, type RlmInvokeInput, type RlmProvidersOutput, type RlmRefusalCode } from "@godspeedai/cognate-runtime-api";
import { RlmRefusedError, type RlmProviderRegistration, type RlmRegistry } from "@godspeedai/cognate-runtime-bun";
import { ModelBudgetError, priorModelConsumption } from "../experts/economics.ts";
import type { ExpertsService } from "../experts/service.ts";
import type { Assignment } from "../experts/types.ts";

/** Solo Experts have no Team limit; this is the baseline Team's `maxDepth` (`state.ts` baselineTeam). */
const SOLO_MAX_DEPTH = 2;
const REQUESTABLE_REFS = ["assignment", "conversation"] as const;

const refuse = (code: RlmRefusalCode, reason: string): RlmRefusedError => new RlmRefusedError(code, reason);

/** Why this host cannot run a provider, from its probed facts and operator-declared port governance. */
export function providerRefusal(entry: RlmProviderRegistration, facts: Awaited<ReturnType<RlmProviderRegistration["provider"]["probe"]>>): { code: RlmRefusalCode; reason: string } | undefined {
  if (entry.availability?.status === "unavailable") return { code: "rlm-provider-unavailable", reason: `provider ${entry.provider.id} is ${entry.availability.reason ?? "unavailable"}` };
  const governance = entry.portGovernance;
  if (facts.toolPolicy === "contained" || facts.capabilities.isolation !== "none" || governance?.world === "contained-streaming") {
    return { code: "rlm-containment-unavailable", reason: "this host makes no containment claim and registers no contained port; the provider needs one" };
  }
  if (governance && governance.reach.network !== "none") {
    return { code: "rlm-egress-uncontrolled", reason: `provider declares ${governance.reach.network} network reach and this host has no egress control` };
  }
  if (facts.executable !== null) return { code: "rlm-port-unavailable", reason: "the provider spawns an executable and this host registers no governed spawn port" };
  return undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const asRecord = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const strings = (raw: unknown, what: string): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || item.length === 0 || item.length > 2000)) throw new Error(`${what} must be an array of non-empty strings`);
  return raw as string[];
};

export interface GovernedRlmOptions {
  /** The host's `createRlmComponent(...)` — Cognate's contract implementation. */
  readonly base: Component;
  readonly registry: RlmRegistry;
  readonly getExperts: () => ExpertsService;
  /** The one durable operator identity; the only non-run caller that may inspect or cancel. */
  readonly operator: Principal;
  readonly operatorTenant: string;
}

export function governedRlmComponent(options: GovernedRlmOptions): Component {
  const experts = () => options.getExperts();

  const providers = (inner: CapabilityHandler): CapabilityHandler => async (raw, ctx) => {
    const output = (await inner(raw, ctx)) as unknown as RlmProvidersOutput;
    // Add this host's own verdict per provider so the facts explain why a provider can or cannot run here.
    const views = [];
    for (const view of output.providers) {
      const entry = options.registry.get(view.id);
      const refusal = entry ? providerRefusal(entry, await entry.provider.probe()) : undefined;
      views.push({ ...view, workbench: refusal ? { admitted: false, refusalCode: refusal.code, reason: refusal.reason } : { admitted: true } });
    }
    return { ...output, providers: views } as unknown as Json;
  };

  const invoke = (inner: CapabilityHandler): CapabilityHandler => async (raw, ctx) => {
    const input = asRecord(raw);
    if (!ctx.runId) throw refuse("rlm-top-level-invocation", "rlm.invoke runs only inside a parent run");
    const runId = ctx.runId;
    const tenant = ctx.tenant ?? options.operatorTenant;
    const service = experts().service;
    const system = experts().caller(tenant);

    // 1. The parent is a registered, unfinished Expert Assignment — otherwise there is no grant, depth or reservation to derive.
    let parent: Assignment;
    try {
      parent = await experts().invocation(ctx);
    } catch {
      throw refuse("rlm-budget-unverifiable", "the parent run is not a governed Expert Assignment, so no grant, depth or reservation can be verified");
    }
    const selected = parent.execution.rlm?.providerId;
    if (!selected) throw refuse("rlm-provider-unavailable", "no recursive-execution provider is selected for this Assignment");
    const requested = typeof input.providerId === "string" ? input.providerId : undefined;
    if (requested !== undefined && requested !== selected) throw refuse("rlm-provider-unknown", `provider ${requested} is not the provider frozen for this Assignment`);

    // 2. The frozen provider is registered, available, and runnable on this host (no spawn, containment or egress).
    const entry = options.registry.get(selected);
    if (!entry) throw refuse("rlm-provider-unknown", `provider ${selected} is not registered`);
    const refusal = providerRefusal(entry, await entry.provider.probe());
    if (refusal) throw refuse(refusal.code, refusal.reason);

    // 3. Authority: a subset of the parent's frozen grant and mode. Out-of-grant is refused, never narrowed.
    const authority = asRecord(input.authority);
    const grant = new Set<string>(parent.execution.tools);
    const requestedTools = authority.tools === undefined ? ["read"].filter((tool) => grant.has(tool)) : strings(authority.tools, "authority.tools");
    const outside = requestedTools.filter((tool) => !grant.has(tool));
    if (outside.length > 0) throw refuse("rlm-authority-exceeds-parent", `authority ${outside.join(", ")} is not a subset of the parent's grant`);
    const mode = authority.mode === undefined ? "read-only" : authority.mode;
    if (mode !== "read-only" && mode !== "workspace-write") throw new Error("authority.mode must be read-only or workspace-write");
    if (mode === "workspace-write" && parent.mode !== "workspace-write") throw refuse("rlm-authority-exceeds-parent", "the parent runs read-only; a child cannot write the workspace");

    // 4. Depth: the Team's maxDepth semantics (`makeAssignment`: depth > maxDepth refuses); a solo Expert uses the baseline Team limit.
    const state = await experts().state(tenant);
    const maxDepth = parent.teamId ? (state.teams[parent.teamId]?.limits.maxDepth ?? 0) : SOLO_MAX_DEPTH;
    if (parent.depth + 1 > maxDepth) throw refuse("rlm-depth-exceeded", `depth ${parent.depth + 1} exceeds the Team maximum depth ${maxDepth}`);

    // 5. Invocation identity: stable per parent run + request id, so a repeat is the same invocation.
    const requestId = input.requestId;
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 300) throw new Error("requestId is required");
    const invocationId = `${runId}:rlm:${requestId}`;

    // 6. Reservation: the parent's frozen per-attempt cost ceiling, less its real spend and its earlier child reservations.
    const events: StoredEvent[] = [];
    for await (const event of service.events(system, { runId })) events.push(event);
    const budget = parent.execution.budget;
    if (!budget || budget.maxCostUsd === undefined || !budget.prices) throw refuse("rlm-budget-unverifiable", "the parent has no verifiable cost reservation (an Expert budget with a cost ceiling and prices)");
    const asked = asRecord(input.budget).limit;
    if (typeof asked !== "number" || !Number.isFinite(asked) || asked <= 0) throw refuse("rlm-budget-unverifiable", "a child run needs a numeric positive budget limit the host can reserve");
    let spent: number;
    try {
      spent = priorModelConsumption(events, budget).costUsd ?? 0;
    } catch (error) {
      if (error instanceof ModelBudgetError) throw refuse("rlm-budget-unverifiable", error.message);
      throw error;
    }
    const folded = foldState(events);
    const bindings = asRecord(asRecord(asRecord(folded).rlm).invocations);
    const reserved = Object.entries(bindings).reduce((sum, [id, binding]) => {
      const limit = asRecord(binding).budgetLimit;
      return id === invocationId || typeof limit !== "number" ? sum : sum + limit;
    }, 0);
    const remaining = budget.maxCostUsd - spent - reserved;
    if (asked > remaining) throw refuse("rlm-budget-unverifiable", `the parent's remaining cost reservation (${remaining.toFixed(6)} USD) cannot cover ${asked} USD`);

    // 7. Context: resolved from the frozen Assignment and pinned by digest; a caller digest must match.
    const task = asRecord(input.task);
    const purpose = task.purpose;
    if (typeof purpose !== "string" || purpose.length === 0 || purpose.length > 20_000) throw new Error("task.purpose is required");
    const acceptance = strings(task.acceptance, "task.acceptance");
    const refs = task.contextRefs === undefined ? ["assignment"] : strings(task.contextRefs, "task.contextRefs");
    const resolved = refs.map((ref) => {
      if (ref === "assignment") return { ref, id: parent.id, attempt: parent.attempt, purpose: parent.purpose, acceptance: parent.acceptance };
      if (ref === "conversation") return { ref, context: parent.execution.context };
      throw refuse("rlm-context-digest-mismatch", `context ref ${ref} cannot be resolved to a pinned artifact (allowed: ${REQUESTABLE_REFS.join(", ")})`);
    });
    const contextDigest = createHash("sha256").update(canonical(resolved)).digest("hex");
    if (task.contextDigest !== undefined && task.contextDigest !== contextDigest) throw refuse("rlm-context-digest-mismatch", "the supplied context digest does not match the resolved context");

    const parentView = await service.getRun(system, { runId });
    const derived: RlmInvokeInput = {
      invocationId,
      providerId: selected,
      parent: { runId, assignmentId: parent.id, attempt: parent.attempt, depth: parent.depth, maxDepth, authorityTools: [...parent.execution.tools] },
      task: { purpose, acceptance, contextRefs: refs, contextDigest },
      authority: { tools: requestedTools, mode },
      budget: { currency: "money", limit: asked, reservationRef: `expert-budget:${parent.id}:${parent.attempt}` },
      ...(parent.execution.caseContext ? { caseContext: parent.execution.caseContext } : {}),
    };
    const admitted = (await inner(derived as unknown as Json, ctx)) as unknown as { invocationId: string; runId: string; status: string };
    return {
      ...admitted,
      providerId: selected,
      principal: parentView.startedBy,
      authority: { tools: requestedTools, mode },
      contextDigest,
      reservationRef: derived.budget.reservationRef ?? null,
      evidence: [`rlm-invocation:${invocationId}`, `rlm-child-run:${admitted.runId}`, `rlm-context:sha256:${contextDigest}`],
    } as unknown as Json;
  };

  /** Parent-scoped standing: the parent run itself, or the operator acting through the parent run's principal. */
  const scoped = (inner: CapabilityHandler): CapabilityHandler => async (raw, ctx) => {
    const input = asRecord(raw);
    const parentRunId = typeof input.parentRunId === "string" ? input.parentRunId : ctx.runId;
    if (!parentRunId) throw refuse("rlm-invocation-unknown", "the parent run is required");
    if (ctx.runId) {
      // A run may reach only its own invocations; another run, even by the same agent id, is refused.
      if (parentRunId !== ctx.runId) throw refuse("rlm-invocation-unknown", `the caller has no standing on run ${parentRunId}`);
      return inner({ ...input, parentRunId } as unknown as Json, ctx);
    }
    const operator = ctx.actor.kind === "user" && ctx.actor.id === options.operator.id && (ctx.tenant ?? options.operatorTenant) === options.operatorTenant;
    if (!operator) throw refuse("rlm-invocation-unknown", `the caller has no standing on run ${parentRunId}`);
    let startedBy: string;
    try {
      startedBy = (await experts().service.getRun(experts().caller(options.operatorTenant), { runId: parentRunId })).startedBy;
    } catch {
      throw refuse("rlm-invocation-unknown", `parent run ${parentRunId} is not visible`);
    }
    return inner({ ...input, parentRunId } as unknown as Json, { ...ctx, actor: { id: startedBy, kind: "agent" } } as HandlerContext);
  };

  return {
    id: options.base.id,
    ...(options.base.provides ? { provides: options.base.provides } : {}),
    ...(options.base.semanticRef ? { semanticRef: options.base.semanticRef } : {}),
    async activate(fiber: FiberContext) {
      const captured = new Map<string, CapabilityHandler>();
      const capture = Object.assign(Object.create(fiber) as FiberContext, {
        provide: (contract: CapabilityContract, handler: CapabilityHandler) => { captured.set(contract.id, handler); },
      });
      await options.base.activate(capture);
      const wrap: Record<string, (inner: CapabilityHandler) => CapabilityHandler> = {
        [RLM_CAPABILITIES.providers]: providers,
        [RLM_CAPABILITIES.invoke]: invoke,
        [RLM_CAPABILITIES.inspect]: scoped,
        [RLM_CAPABILITIES.cancel]: scoped,
      };
      for (const contract of options.base.provides ?? []) {
        const handler = captured.get(contract.id);
        if (!handler) throw new Error(`rlm: base component did not provide ${contract.id}`);
        fiber.provide(contract, (wrap[contract.id] ?? ((h: CapabilityHandler) => h))(handler));
      }
    },
  };
}
