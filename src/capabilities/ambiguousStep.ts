import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";

/** Operator reconciliation of an interrupted agent capability call. The runtime records
 * `run.invocation.ambiguous` and opens an `ambiguous-invocation` continuation instead of repeating
 * the external effect; only a direct human operator may record what actually happened. */
export const AMBIGUOUS_INVOCATION_CAPABILITY = "run.invocation.reconcile";
export const AMBIGUOUS_INVOCATION_CONTINUATION = "ambiguous-invocation";

export interface AmbiguousInvocationReconcileInput {
  readonly continuationId: string;
  readonly outcome: "succeeded" | "failed";
  readonly reason: string;
}

/** Capabilities that only ask a model for a response (no external effect beyond cost). */
const MODEL_GENERATION = new Set(["model.generate", "expert.model.generate"]);

export function isModelGeneration(capability: string | undefined): boolean {
  return capability !== undefined && MODEL_GENERATION.has(capability);
}

/** The interrupted capability, from the continuation the runtime opened (payload, else condition). */
export function interruptedCapability(continuation: { readonly payload?: unknown; readonly condition?: unknown }): string | undefined {
  for (const source of [continuation.payload, continuation.condition]) {
    const capability = (source as { capability?: unknown } | null | undefined)?.capability;
    if (typeof capability === "string") return capability;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reconciliation requires an object input");
  return value as Record<string, unknown>;
}

function validateInput(raw: unknown): AmbiguousInvocationReconcileInput {
  const value = asRecord(raw);
  if (typeof value.continuationId !== "string" || !value.continuationId.trim() || value.continuationId.length > 300) throw new Error("Reconciliation requires a bounded continuation identity");
  if (value.outcome !== "succeeded" && value.outcome !== "failed") throw new Error("Reconciliation outcome must be succeeded or failed");
  if (typeof value.reason !== "string" || !value.reason.trim() || value.reason.trim().length > 2000) throw new Error("Reconciliation reason must contain 1–2000 characters");
  return { continuationId: value.continuationId, outcome: value.outcome, reason: value.reason.trim() };
}

export function ambiguousStepComponent(options: {
  readonly getService: () => RuntimeService;
  readonly semanticRef?: SemanticRef;
}): Component {
  const contract = { id: AMBIGUOUS_INVOCATION_CAPABILITY, version: "1.0.0", ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  return {
    id: "runs:ambiguous-invocation",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (raw, ctx) => {
        // An agent must never reconcile its own ambiguous effect: only a direct human operator,
        // outside any run, may record what happened.
        if (ctx.actor.kind !== "user" || ctx.runId) throw new Error("Only a direct human operator may reconcile an interrupted run step");
        const input = validateInput(raw);
        const service = options.getService();
        const caller = { actor: ctx.actor, tenant: ctx.tenant };
        const continuation = (await service.listContinuations(caller, {})).find((item) => item.id === input.continuationId);
        if (!continuation) throw new Error("No such continuation for this operator");
        if (continuation.type !== AMBIGUOUS_INVOCATION_CONTINUATION) throw new Error("Continuation is not an interrupted run step awaiting reconciliation");
        if (continuation.status !== "OPEN") throw new Error(`Interrupted run step is already ${continuation.status.toLowerCase()}; it cannot be reconciled again`);
        // A model call has no external effect for the operator to confirm, and its response cannot be
        // reconstructed from an observation: "succeeded" would hand the agent a record where it needs
        // a model response. The honest reconciliation is "failed", which lets the agent retry the call.
        if (input.outcome === "succeeded" && isModelGeneration(interruptedCapability(continuation))) {
          throw new Error("An interrupted model call cannot be confirmed as succeeded: its response cannot be reconstructed. Record \"failed\" to let the agent retry the call.");
        }
        const resolution: Json = input.outcome === "succeeded"
          ? { result: { reconciled: true, outcome: "succeeded", reason: input.reason, reconciledBy: ctx.actor.id } }
          : { failure: { kind: "operator_reconciled_failure", message: input.reason } };
        const resolved = await service.resolveContinuation(caller, {
          continuationId: continuation.id,
          action: "resume",
          input: resolution,
          idempotencyKey: `ambiguous-reconcile:${continuation.id}`,
          expectedVersion: continuation.version,
        });
        if (resolved.outcome === "already_terminal") throw new Error("Interrupted run step was resolved concurrently; it cannot be reconciled again");
        return { runId: continuation.runId, continuationId: continuation.id, outcome: input.outcome };
      });
    },
  };
}
