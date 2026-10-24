// Publishes `model.generate`, forwarding streamed text deltas via `HandlerContext.progress` into
// `run.invocation.progress` events (the durable progress channel; see
// docs/reference/capability-catalog.md).
// Distinct from `@godspeedai/cognate-profile-harness`'s `providerComponent`, which only calls `generate` — this
// reconstruction needs live token deltas in the invoking run, which requires calling `provider.stream`
// from inside the handler.
//
// J-CONTEXT-BUDGET: when billing is wired, every ordinary-session dispatch holds a durable
// reservation on the governed billing ledger, enforced against the operator's ordinary-session
// and global spending ceilings, and is settled from provider-reported usage before returning.
import type { ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import { modelContract } from "@godspeedai/cognate-capabilities";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { estimateRequestTokens } from "../experts/economics.ts";
import { readSpendingCeilings, reserveModelCall, settleModelCall, type BillingPrices } from "../experts/billing.ts";
import { tokenizerForRoute } from "../experts/tokenizer.ts";
import type { StoredEvent } from "@godspeedai/cognate-events";

/** Conservative output reserve when the request names no output limit. */
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;

export interface ModelGenerateBilling {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** Current operator-configured prices for the mounted model, or null when unknown. */
  readonly prices: () => BillingPrices | null;
  /** Current wire protocol of the mounted model, for tokenizer resolution. */
  readonly protocol: () => string | undefined;
}

function reportedUsageOf(response: ModelResponse): { inputTokens: number; outputTokens: number } | undefined {
  const usage = response.usage;
  return usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined;
}

export function streamingProviderComponent(provider: ModelProvider, semanticRef?: SemanticRef, billing?: ModelGenerateBilling): Component {
  const contract = { ...modelContract(provider), semanticRef };
  return {
    id: `model-provider:${provider.id}`,
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput, ctx): Promise<ModelResponse> => {
        const request = rawInput as ModelRequest;
        const generate = async (): Promise<ModelResponse> => {
          if (!provider.features.stream || !ctx.progress) {
            return provider.generate(request, ctx.signal);
          }
          let text = "";
          let final: ModelResponse | undefined;
          for await (const delta of provider.stream(request, ctx.signal)) {
            if (delta.type === "text") {
              text += delta.text;
              await ctx.progress({ kind: "text", text: delta.text });
            } else if (delta.type === "done") {
              final = delta.response;
            }
          }
          return final ?? { message: { role: "assistant", content: text }, toolCalls: [], finishReason: "stop", model: provider.model };
        };
        if (!billing || !ctx.runId) return generate();
        // Ordinary coding sessions (agent.coding runs carry a sessionId) reserve before dispatch.
        const caller: Caller = { actor: billing.systemCaller.actor, tenant: ctx.tenant ?? billing.systemCaller.tenant };
        const service = billing.getService();
        const run = await service.getRun(caller, { runId: ctx.runId });
        const sessionId = (run.input as { sessionId?: unknown } | undefined)?.sessionId;
        if (typeof sessionId !== "string" || !sessionId) return generate();
        const events: StoredEvent[] = [];
        for await (const event of service.events(caller, { runId: ctx.runId })) events.push(event);
        const invocationIndex = events.filter(event => event.eventType === "run.invocation" && event.metadata?.capability === "model.generate").length;
        const reservationId = `${ctx.runId}:session-model:${invocationIndex}`;
        const tokenizer = await tokenizerForRoute(provider.model, billing.protocol());
        const inputTokens = estimateRequestTokens(request, tokenizer);
        const reservedOutputTokens = request.maxTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
        const prices = billing.prices();
        const reservation = await reserveModelCall(service, caller, {
          id: reservationId, kind: "session-model", runId: ctx.runId, assignmentId: null, attempt: null,
          sessionId, model: provider.model, inputTokens, reservedOutputTokens, prices,
        }, await readSpendingCeilings(service, caller));
        const bookedReservationId = reservation.id;
        const settleFrom = (response: ModelResponse) => {
          const reported = reportedUsageOf(response);
          return settleModelCall(service, caller, bookedReservationId,
            reported ? { ...reported, source: "provider" } : { inputTokens, outputTokens: reservedOutputTokens, source: "unreported" },
            reported ? "settled from provider-reported usage" : "settled conservatively; provider usage unreported");
        };
        try {
          const response = await generate();
          await settleFrom(response);
          return response;
        } catch (error) {
          await settleModelCall(service, caller, bookedReservationId,
            { inputTokens, outputTokens: reservedOutputTokens, source: "unreported" },
            "settled conservatively; the provider dispatch failed").catch(() => {});
          throw error;
        }
      });
    },
  };
}
