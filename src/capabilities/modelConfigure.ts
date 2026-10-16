// `model.configure`: the capability the UI's Settings -> Models "Save" button invokes (via
// `client.invoke`, so this call is never recorded as an event — the API key argument never touches
// the durable log). It writes the secret through `secret.put` (server-side call to the same
// runtime, still not a recorded event), hot-swaps the mounted `model.generate` provider (dispose
// old, mount new — no restart), and only then starts a deterministic `agent.config` run to durably
// record the non-secret `model.configured` fact.
import { randomUUID } from "node:crypto";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { ModelConfig, ModelWireProtocol, ProviderRegistry } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { parseBillingPrices } from "../experts/billing.ts";

export interface ModelConfigureInput {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: ModelWireProtocol;
  readonly model: string;
  /** Write-only; never echoed, never recorded. */
  readonly apiKey: string;
  /** Operator-declared price estimates per million tokens. Absent means cost is unknown. */
  readonly prices?: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number };
}

export function modelConfigureComponent(options: {
  readonly registry: ProviderRegistry;
  readonly secrets: SecretStore;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "model:configure",
    provides: [{ id: "model.configure", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "model.configure", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput) => {
        const input = rawInput as ModelConfigureInput;
        if (!input.providerId || !input.baseURL || !input.model) throw new Error("model.configure: providerId, baseURL, and model are required");
        if (!["openai-compatible","openai-completions","openai-responses","anthropic-messages"].includes(input.protocol)) throw new Error("model.configure: unsupported wire protocol");
        const prices = parseBillingPrices(input.prices);
        await options.secrets.put(`model-provider:${input.providerId}`, input.apiKey ?? "");
        const config: ModelConfig = { providerId: input.providerId, baseURL: input.baseURL, protocol: input.protocol, model: input.model, ...(prices ? { prices } : {}) };
        await options.registry.swap(config, options.secrets);
        const service = options.getService();
        const configured: Record<string, unknown> = { kind: "model.configured", providerId: config.providerId, baseURL: config.baseURL, protocol: config.protocol, model: config.model };
        if (prices) configured.prices = prices;
        await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: configured as unknown as Json,
          idempotencyKey: randomUUID(),
        });
        return { ok: true, providerId: config.providerId };
      });
    },
  };
}
