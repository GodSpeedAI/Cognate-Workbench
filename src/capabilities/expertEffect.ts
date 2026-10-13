import { CommitmentRejectedError, CommitmentService } from "@godspeedai/cognate-continuations";
import { fingerprint, type Json } from "@godspeedai/cognate-events";
import type { Component, HandlerContext, InvocationContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Runtime } from "@godspeedai/cognate-runtime-bun";
import { ExpertsService } from "../experts/service.ts";
import type { Assignment, ExpertTool } from "../experts/types.ts";

export const EXPERT_EFFECT_CAPABILITY = "expert.tool.invoke";
const TARGET_ID = "workbench.expert-tool-effect";
const SIDE_EFFECT_TOOLS = ["edit", "bash", "run_code"] as const;
type SideEffectTool = (typeof SIDE_EFFECT_TOOLS)[number];

export interface ExpertToolInvokeInput {
  readonly assignmentId: string;
  /** Stable `step:call` position from the deterministic Expert loop, never a model supplied call ID. */
  readonly toolCallId: string;
  readonly tool: SideEffectTool;
  readonly input: Record<string, Json>;
}

interface EffectPayload extends ExpertToolInvokeInput {
  readonly runId: string;
  readonly attempt: number;
  readonly tenant: string;
  readonly actor: { readonly id: string; readonly kind: "user" | "agent" | "service" | "system" };
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly scopeId: string;
  readonly effectKey: string;
}

export class ExpertEffectReconciliationRequired extends Error {
  override readonly name = "ExpertEffectReconciliationRequired";
  constructor(readonly commitmentId: string, readonly state: string, detail?: string) {
    super(`Expert effect ${commitmentId} is ${state}; human reconciliation is required${detail ? `: ${detail}` : ""}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an Expert effect object");
  return value as Record<string, unknown>;
}

// Cognate's canonical fingerprint remains stable across PostgreSQL JSONB key reordering.
const canonical = (value:unknown) => fingerprint(value as Json);

function validateInput(raw: unknown): ExpertToolInvokeInput {
  const value = asRecord(raw);
  if (typeof value.assignmentId !== "string" || !value.assignmentId || value.assignmentId.length > 200 || typeof value.toolCallId !== "string" || !value.toolCallId || value.toolCallId.length > 300) throw new Error("Expert effect requires bounded assignment and stable tool-call identities");
  if (!SIDE_EFFECT_TOOLS.includes(value.tool as SideEffectTool)) throw new Error("Only edit, bash, and run_code use the Expert effect boundary");
  return { assignmentId: value.assignmentId, toolCallId: value.toolCallId, tool: value.tool as SideEffectTool, input: asRecord(value.input) as Record<string, Json> };
}

function idempotencyKey(payload: Pick<EffectPayload, "assignmentId" | "attempt" | "toolCallId">): string {
  return `expert-effect:${payload.assignmentId}:${payload.attempt}:${payload.toolCallId}`;
}

function effectKey(payload: Pick<EffectPayload, "attempt" | "toolCallId">): string {
  return `${payload.attempt}:${payload.toolCallId}`;
}

function effectState(assignment: Assignment, toolCallId: string): { commitmentId: string; state: string; tool: string } | undefined {
  return assignment.effects?.[toolCallId];
}

function requiredText(value: unknown, field: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must contain 1–${max} characters`);
  return value.trim();
}

async function updateEffect(
  experts: ExpertsService,
  tenant: string,
  assignmentId: string,
  key: string,
  commitmentId: string,
  state: string,
  tool: SideEffectTool,
): Promise<void> {
  await experts.mutate(tenant, `effect:${commitmentId}:${state}`, { assignmentId, key, commitmentId, state, tool }, (registry) => {
    const assignment = registry.assignments[assignmentId];
    if (!assignment) throw new Error("Assignment disappeared while recording an Expert effect");
    assignment.effects ??= {};
    const existing = assignment.effects[key];
    if (existing && existing.commitmentId !== commitmentId) throw new Error("Tool-call identity is already bound to another commitment");
    assignment.effects[key] = { commitmentId, state, tool };
    return { ok: true };
  });
}

async function authorizedAssignment(
  experts: ExpertsService,
  payload: EffectPayload,
  commitmentId: string,
  allowDispatching: boolean,
): Promise<Assignment> {
  // Revalidate the run and assignment immediately before the target invokes the native tool.
  const context = { runId: payload.runId, tenant: payload.tenant } as HandlerContext;
  const assignment = await experts.invocation(context, payload.assignmentId, allowDispatching);
  if (assignment.attempt !== payload.attempt || assignment.runId !== payload.runId) throw new CommitmentRejectedError("Effect no longer belongs to the active Assignment attempt");
  if (!assignment.execution.tools.includes(payload.tool as ExpertTool) || !assignment.authorityTools.includes(payload.tool as ExpertTool)) throw new CommitmentRejectedError(`Assignment does not authorize ${payload.tool}`);
  const effect = effectState(assignment, payload.effectKey);
  if (!effect || effect.commitmentId !== commitmentId || effect.tool !== payload.tool) throw new CommitmentRejectedError("Effect intent does not match the authorized Assignment");
  if (allowDispatching && effect.state !== "DISPATCHING") throw new CommitmentRejectedError("Effect dispatch was not durably marked before invocation");
  return assignment;
}

async function createService(runtime: Runtime, experts: ExpertsService, activeContexts: Map<string, HandlerContext>): Promise<CommitmentService> {
  const commitments = new CommitmentService(runtime.store, { backoff: { baseMs: 1, maxMs: 10, maxAttempts: 1 } });
  commitments.registerTarget({
    id: TARGET_ID,
    idempotent: false,
    async dispatch(request, signal) {
      const payload = request.payload as unknown as EffectPayload;
      const activeContext = activeContexts.get(request.commitmentId);
      if (!activeContext) throw new CommitmentRejectedError("No live Cognate run context is available; interrupted intents require replay by their original run");
      await authorizedAssignment(experts, payload, request.commitmentId, false);
      await updateEffect(experts, payload.tenant, payload.assignmentId, payload.effectKey, request.commitmentId, "DISPATCHING", payload.tool);
      await authorizedAssignment(experts, payload, request.commitmentId, true);
      if (signal.aborted) throw new Error("Expert effect dispatch was aborted before invocation");
      const resolved = runtime.kernel.resolve({ capability: `tool.${payload.tool}` });
      if ("unavailable" in resolved) throw new CommitmentRejectedError(`Native capability ${payload.tool} is unavailable: ${resolved.reason}`);
      const invocationContext: InvocationContext = {
        actor: payload.actor,
        tenant: payload.tenant,
        correlationId: payload.correlationId,
        ...(payload.causationId ? { causationId: payload.causationId } : {}),
        runId: payload.runId,
        idempotencyKey: `expert-tool:${request.commitmentId}`,
        signal: AbortSignal.any([activeContext.signal, signal]),
      };
      const outcome = await resolved.invoke(payload.input, invocationContext);
      if (outcome.ok) return { remoteRef: request.commitmentId, result: outcome.value as Json };
      if (outcome.failure.kind === "denied" || outcome.failure.kind === "unavailable") throw new CommitmentRejectedError(`Native capability rejected the effect: ${outcome.failure.kind}`);
      // Deadline, cancellation and handler failure can happen after a partial side effect.
      throw new Error(`Native capability outcome is ambiguous: ${outcome.failure.kind}`);
    },
  });
  return commitments;
}

export function expertEffectComponent(options: {
  readonly getRuntime: () => Runtime;
  readonly getExperts: () => ExpertsService;
  readonly semanticRef?: SemanticRef;
  readonly resolveSemanticRef?: SemanticRef;
}): Component {
  const contract = { id: EXPERT_EFFECT_CAPABILITY, version: "1.0.0", ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  const resolveContract = { id: "expert.effect.resolve", version: "1.0.0", ...(options.resolveSemanticRef ? { semanticRef: options.resolveSemanticRef } : {}) };
  const activeContexts = new Map<string, HandlerContext>();
  let runtimeRef: Runtime | undefined;
  let expertsRef: ExpertsService | undefined;
  let commitmentsRef: Promise<CommitmentService> | undefined;
  return {
    id: "experts:effect-commitment",
    provides: [contract, resolveContract],
    activate(fiber) {
      fiber.provide(contract, async (raw, ctx) => {
        const input = validateInput(raw);
        if (!ctx.runId) throw new Error("Expert effects require a Cognate run");
        const runtime = options.getRuntime();
        const experts = options.getExperts();
        if (runtimeRef !== runtime || expertsRef !== experts || !commitmentsRef) {
          runtimeRef = runtime;
          expertsRef = experts;
          commitmentsRef = createService(runtime, experts, activeContexts);
        }
        const commitments = await commitmentsRef;
        const assignment = await experts.invocation(ctx, input.assignmentId, true);
        const stableKey = effectKey({ attempt: assignment.attempt, toolCallId: input.toolCallId });
        const otherUnresolved = Object.entries(assignment.effects ?? {}).find(([key, effect]) => key !== stableKey && ["DISPATCHING", "UNKNOWN_RECONCILIATION_REQUIRED"].includes(effect.state));
        if (otherUnresolved) throw new ExpertEffectReconciliationRequired(otherUnresolved[1].commitmentId, otherUnresolved[1].state, "another effect on this Assignment is unresolved");
        const payload: EffectPayload = {
          ...input,
          runId: ctx.runId,
          attempt: assignment.attempt,
          tenant: ctx.tenant,
          actor: ctx.actor,
          correlationId: ctx.correlationId,
          // These payload fields participate in the native commitment fingerprint.
          // Keep them stable when the SDK replays this run after a process restart;
          // the causation chain is still represented by the outer commitment event.
          causationId: null,
          scopeId: `expert:${assignment.id}`,
          effectKey: stableKey,
        };
        if (assignment.runId !== ctx.runId || !assignment.execution.tools.includes(input.tool) || !assignment.authorityTools.includes(input.tool)) throw new Error(`Assignment does not authorize ${input.tool}`);

        const existing = effectState(assignment, stableKey);
        if (existing) {
          if (existing.tool !== input.tool) throw new Error("Stable tool-call identity was reused for a different tool");
          const record = await commitments.get(existing.commitmentId);
          if (!record) throw new ExpertEffectReconciliationRequired(existing.commitmentId, "missing commitment record");
          if (record.operation !== `tool.${input.tool}` || record.idempotencyKey !== idempotencyKey(payload)) throw new Error("Stored commitment does not match the current Expert effect identity");
          if (canonical(record.payload) !== canonical(payload)) throw new Error("Stable tool-call identity was reused with different effect input");
          if (record.state === "SUCCEEDED") {
            await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, "SUCCEEDED", input.tool);
            return record.result;
          }
          if (record.state === "FAILED") {
            await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, "FAILED", input.tool);
            throw new Error(record.lastError ?? `Expert effect ${record.id} failed`);
          }
          if (record.state !== "INTENDED") {
            await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, record.state, input.tool);
            throw new ExpertEffectReconciliationRequired(record.id, record.state, record.lastError ?? undefined);
          }
        }

        const record = await commitments.intend({
          targetId: TARGET_ID,
          operation: `tool.${input.tool}`,
          idempotencyKey: idempotencyKey(payload),
          payload: payload as unknown as Json,
          tenant: ctx.tenant,
          scopeId: ctx.scopeId,
          correlationId: ctx.correlationId,
          ...(ctx.causationId ? { causationId: ctx.causationId } : {}),
        });
        const currentRecord = await commitments.get(record.id);
        if (!currentRecord) throw new ExpertEffectReconciliationRequired(record.id, "missing commitment record");
        if (canonical(currentRecord.payload) !== canonical(payload)) throw new Error("Stable tool-call identity was reused with different effect input");
        if (currentRecord.state === "SUCCEEDED") {
          await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, currentRecord.state, input.tool);
          return currentRecord.result;
        }
        if (currentRecord.state === "FAILED") {
          await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, currentRecord.state, input.tool);
          throw new Error(currentRecord.lastError ?? `Expert effect ${record.id} failed`);
        }
        if (currentRecord.state !== "INTENDED") {
          await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, currentRecord.state, input.tool);
          throw new ExpertEffectReconciliationRequired(record.id, currentRecord.state, currentRecord.lastError ?? undefined);
        }
        await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, "INTENDED", input.tool);
        activeContexts.set(record.id, ctx);
        try {
          await commitments.dispatch();
        } finally {
          activeContexts.delete(record.id);
        }
        const completed = await commitments.get(record.id);
        if (completed?.state === "SUCCEEDED") {
          await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, "SUCCEEDED", input.tool);
          return completed.result;
        }
        if (completed?.state === "FAILED") {
          await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, "FAILED", input.tool);
          throw new Error(completed.lastError ?? `Expert effect ${record.id} failed`);
        }
        if (completed) await updateEffect(experts, ctx.tenant, assignment.id, stableKey, record.id, completed.state, input.tool);
        throw new ExpertEffectReconciliationRequired(record.id, completed?.state ?? "missing outcome", completed?.lastError ?? undefined);
      });
      fiber.provide(resolveContract, async (raw, ctx) => {
        if (ctx.actor.kind !== "user" || ctx.runId) throw new Error("Only a direct human operator may reconcile Expert effects");
        const value = asRecord(raw);
        if (typeof value.assignmentId !== "string" || typeof value.toolCallId !== "string" || typeof value.reason !== "string" || !value.reason.trim()) throw new Error("Effect reconciliation requires an assignment, effect key, and reason");
        if (value.outcome !== "succeeded" && value.outcome !== "failed") throw new Error("Effect reconciliation outcome must be succeeded or failed");
        const runtime = options.getRuntime();
        const experts = options.getExperts();
        if (runtimeRef !== runtime || expertsRef !== experts || !commitmentsRef) {
          runtimeRef = runtime;
          expertsRef = experts;
          commitmentsRef = createService(runtime, experts, activeContexts);
        }
        const commitments = await commitmentsRef;
        const state = await experts.state(ctx.tenant);
        const assignment = state.assignments[value.assignmentId];
        const effectKeyValue = requiredText(value.toolCallId, "toolCallId", 300);
        const effect = assignment?.effects?.[effectKeyValue];
        if (!assignment || !effect || !["DISPATCHING", "UNKNOWN_RECONCILIATION_REQUIRED"].includes(effect.state) && !(effect.resolvedBy===ctx.actor.id && effect.state===(value.outcome==="succeeded" ? "SUCCEEDED":"FAILED"))) throw new Error("No ambiguous effect exists for this Assignment");
        const record = await commitments.get(effect.commitmentId);
        if (!record) throw new Error("Native commitment record not found");
        let reconciled = record;
        if (record.state === "DISPATCHING" || record.state === "UNKNOWN_RECONCILIATION_REQUIRED") {
          reconciled = await commitments.resolveManually(record.id, {
            actor: ctx.actor,
            reason: value.reason.trim().slice(0, 4000),
            outcome: value.outcome === "succeeded"
              ? { state: "succeeded", remoteRef: record.remoteRef ?? record.id, result: value.result === undefined ? record.result : value.result as Json }
              : { state: "failed", error: value.reason.trim().slice(0, 4000) },
          });
        } else if (record.state !== (value.outcome === "succeeded" ? "SUCCEEDED" : "FAILED")) {
          throw new Error("The requested resolution conflicts with the native commitment outcome");
        }
        await updateEffect(experts, ctx.tenant, assignment.id, effectKeyValue, reconciled.id, reconciled.state, effect.tool as SideEffectTool);
        await experts.mutate(ctx.tenant,`human-effect:${record.id}:${reconciled.state}`,{by:ctx.actor.id,state:reconciled.state},s=>{
          const current=s.assignments[assignment.id]!;
          current.effects![effectKeyValue]!.resolvedBy=ctx.actor.id;
          const c=s.conversations[current.conversationId]!;const messageId=`effect-resolution:${record.id}`;
          s.messages[messageId]={id:messageId,conversationId:c.id,assignmentId:current.id,sender:{kind:"human",id:ctx.actor.id},recipientId:current.expertId,
            text:`Observed effect ${record.id}: ${reconciled.state}. ${value.reason}. Continue from this observed outcome; do not blindly repeat it.`,correlationId:ctx.correlationId,causationId:null,delivery:"delivered",replyTo:current.runId};
          if(!c.messageIds.includes(messageId))c.messageIds.push(messageId);return {ok:true};
        });
        return { assignmentId: assignment.id, toolCallId: effectKeyValue, commitmentId: reconciled.id, state: reconciled.state };
      });
    },
  };
}
