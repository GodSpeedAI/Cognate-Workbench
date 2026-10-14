// Per-Expert `expert.model.generate` routing. The route is captured in the trusted Expert run
// input at assignment/conversation start; this capability verifies that snapshot and delegates
// assignment authorization before constructing an isolated provider. It never mutates the global
// ProviderRegistry, and provider credentials remain behind SecretStore.
import type { ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { buildProvider, type ModelConfig } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { enforceExpertBudget, modelAccounting, priorModelConsumption, type ExpertModelBudget, type ModelAccounting } from "../experts/economics.ts";
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

function isRoute(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<ModelConfig>;
  return typeof route.providerId === "string" && route.providerId.length > 0 &&
    typeof route.baseURL === "string" && route.baseURL.length > 0 &&
    typeof route.model === "string" && route.model.length > 0 &&
    ROUTE_PROTOCOLS.has(route.protocol as ModelConfig["protocol"]);
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
        const run = await options.getService().getRun(caller, { runId: ctx.runId });
        if (run.agent !== "agent.expert") {
          throw new Error("expert.model.generate: only a registered Expert run may select an Expert route");
        }
        // Assignment ownership and the frozen route live in ExpertsService's durable registry,
        // not in the public run input. This callback is the authoritative assignment check.
        const budget = await options.authorize(ctx, input.route) || undefined;

        // A provider belongs only to this call. Reconfiguration for another Expert cannot alter
        // this run's endpoint, model, credentials, or in-flight provider instance.
        const provider = createProvider(input.route, options.secrets);
        let request=input.request;
        if(budget){
          const events:StoredEvent[]=[];
          for await(const event of options.getService().events({tenant:ctx.tenant,actor:ctx.actor},{runId:ctx.runId}))events.push(event);
          request=enforceExpertBudget(request,budget,provider.features.context_limit,priorModelConsumption(events,budget));
        }
        if (!provider.features.stream || !ctx.progress) {
          const response=await provider.generate(request,ctx.signal);
          return {...response,accounting:modelAccounting(request,response,budget)};
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
        return {...response,accounting:modelAccounting(request,response,budget)};
      });
    },
  };
}
