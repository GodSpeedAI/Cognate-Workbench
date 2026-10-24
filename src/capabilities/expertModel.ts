// Per-Expert `expert.model.generate` routing. The route is captured in the trusted Expert run
// input at assignment/conversation start; this capability verifies that snapshot and delegates
// assignment authorization before constructing an isolated provider. It never mutates the global
// ProviderRegistry, and provider credentials remain behind SecretStore.
//
// Economics (J-CONTEXT-BUDGET): the request is tokenized with the route's model-specific
// tokenizer, the frozen attempt budget is enforced, and every dispatch holds a durable billing
// reservation that is settled from provider-reported usage (or the conservative reservation when
// unreported) before the capability returns. A crash between reservation and outcome leaves the
// reservation blocking: reconciliation — never a blind repeat — resolves it.
import type { ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { buildProvider, type ModelConfig } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { enforceExpertBudget, estimateRequestTokens, modelAccounting, priorModelConsumption, type ExpertModelBudget, type ModelAccounting } from "../experts/economics.ts";
import { readSpendingCeilings, reserveModelCall, settleModelCall, type BillingPrices } from "../experts/billing.ts";
import { tokenizerForRoute } from "../experts/tokenizer.ts";
import type { StoredEvent } from "@godspeedai/cognate-events";

export interface ExpertModelGenerateInput {
  readonly route: ModelConfig;
  readonly request: ModelRequest;
}

export interface ExpertModelGenerateOptions {
  readonly secrets: SecretStore;
  readonly getService: () => RuntimeService;
  /** Must confirm run/assignment ownership, active membership, and route against authoritative state. */
  readonly authorize: (ctx: HandlerContext, route: ModelConfig) => Promise<ExpertModelBudget|undefined|void>;
  readonly semanticRef?: SemanticRef;
  /** Deterministic provider seam for tests; production defaults to Workbench's published provider adapters. */
  readonly providerFactory?: (route: ModelConfig, secrets: SecretStore) => ModelProvider;
}

const ROUTE_PROTOCOLS = new Set<ModelConfig["protocol"]>([
  "openai-compatible", "openai-completions", "openai-responses", "anthropic-messages",
]);

/** Conservative output reserve when neither the request nor a frozen budget names one. */
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;

function isRoute(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<ModelConfig>;
  return typeof route.providerId === "string" && route.providerId.length > 0 &&
    typeof route.baseURL === "string" && route.baseURL.length > 0 &&
    typeof route.model === "string" && route.model.length > 0 &&
    ROUTE_PROTOCOLS.has(route.protocol as ModelConfig["protocol"]);
}

async function invocationEvents(service: RuntimeService, caller: Caller, runId: string): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  for await (const event of service.events(caller, { runId })) events.push(event);
  return events;
}

function reportedUsageOf(response: ModelResponse): { inputTokens: number; outputTokens: number } | undefined {
  const usage = response.usage;
  return usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined;
}

export function expertModelGenerateComponent(options: ExpertModelGenerateOptions): Component {
  const contract = { id: "expert.model.generate", version: "1.0.0", semanticRef: options.semanticRef };
  const createProvider = options.providerFactory ?? ((route, secrets) => buildProvider(route, secrets));
  return {
    id: "expert:model-generate",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput, ctx): Promise<ModelResponse & {accounting:ModelAccounting}> => {
        const input = rawInput as ExpertModelGenerateInput;
        if (!ctx.runId) throw new Error("expert.model.generate: requires an Expert run");
        if (!input || !isRoute(input.route) || !input.request || !Array.isArray(input.request.messages)) {
          throw new Error("expert.model.generate: invalid route or model request");
        }
        const caller: Caller = { actor: ctx.actor, tenant: ctx.tenant ?? "local" };
        const service = options.getService();
        const run = await service.getRun(caller, { runId: ctx.runId });
        if (run.agent !== "agent.expert") {
          throw new Error("expert.model.generate: only a registered Expert run may select an Expert route");
        }
        // Assignment ownership and the frozen route live in ExpertsService's durable registry,
        // not in the public run input. This callback is the authoritative assignment check.
        const budget = await options.authorize(ctx, input.route) || undefined;

        // A provider belongs only to this call. Reconfiguration for another Expert cannot alter
        // this run's endpoint, model, credentials, or in-flight provider instance.
        const provider = createProvider(input.route, options.secrets);
        const tokenizer = await tokenizerForRoute(input.route.model, input.route.protocol);
        const events = await invocationEvents(service, caller, ctx.runId);
        let request=input.request;
        if(budget){
          request=enforceExpertBudget(request,budget,provider.features.context_limit,priorModelConsumption(events,budget,tokenizer),tokenizer);
        }
        // The durable pre-dispatch reservation. The invocation index keeps the id deterministic
        // across crash recovery, so a replayed attempt collides with its own interrupted
        // reservation and fails closed instead of double-dispatching.
        const invocationIndex = events.filter(event => event.eventType === "run.invocation" && event.metadata?.capability === "expert.model.generate").length;
        const reservationId = `${ctx.runId}:expert-model:${invocationIndex}`;
        const inputTokens = estimateRequestTokens(request, tokenizer);
        const reservedOutputTokens = request.maxTokens ?? budget?.maxOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
        const prices: BillingPrices | null = budget?.prices ?? null;
        const runInput = run.input as { assignmentId?: string; attempt?: number };
        const reservation = await reserveModelCall(service, caller, {
          id: reservationId, kind: "expert-model", runId: ctx.runId, assignmentId: runInput.assignmentId ?? null,
          attempt: runInput.attempt ?? null, sessionId: null, model: input.route.model,
          inputTokens, reservedOutputTokens, prices,
        }, await readSpendingCeilings(service, caller));
        const bookedReservationId = reservation.id;
        const settleFrom = (response: ModelResponse) => {
          const reported = reportedUsageOf(response);
          return settleModelCall(service, caller, bookedReservationId,
            reported ? { ...reported, source: "provider" } : { inputTokens, outputTokens: reservedOutputTokens, source: "unreported" },
            reported ? "settled from provider-reported usage" : "settled conservatively; provider usage unreported");
        };
        try {
          if (!provider.features.stream || !ctx.progress) {
            const response=await provider.generate(request,ctx.signal);
            await settleFrom(response);
            return {...response,accounting:modelAccounting(request,response,budget,tokenizer)};
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
          const response = final ?? {
            message: { role: "assistant", content: text },
            toolCalls: [],
            finishReason: "stop" as const,
            model: provider.model,
          };
          await settleFrom(response);
          return {...response,accounting:modelAccounting(request,response,budget,tokenizer)};
        } catch (error) {
          // A failed dispatch still consumes its pessimistic reservation; a crash does not,
          // leaving the reservation blocking until reconciliation resolves it.
          await settleModelCall(service, caller, bookedReservationId,
            { inputTokens, outputTokens: reservedOutputTokens, source: "unreported" },
            "settled conservatively; the provider dispatch failed").catch(() => {});
          throw error;
        }
      });
    },
  };
}
