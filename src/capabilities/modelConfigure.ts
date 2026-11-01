// `model.configure`: the capability the UI's Settings -> Models "Save" button invokes (via
// `client.invoke`, so this call is never recorded as an event — the API key argument never touches
// the durable log). It writes the secret through the SecretStore (server-side call, still not a
// recorded event), hot-swaps the mounted `model.generate` provider (dispose old, mount new — no
// restart), and only then starts a deterministic `agent.config` run to durably record the
// non-secret `model.configured` fact.
//
// Stored keys are reused (J-CFG-model-provider): `apiKey` omitted or blank keeps the secret already
// stored for that providerId and never clears it; only a non-empty `apiKey` replaces it. Switching
// model (or base URL) on the same provider therefore needs no key. `auth: "none"` marks a keyless
// route (any protocol) and also removes nothing already stored.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { ModelAuthKind, ModelConfig, ModelWireProtocol, ProviderRegistry } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { recordProviderFact } from "./providerSwitch.ts";
import { parseBillingPrices } from "../experts/billing.ts";

export interface ModelConfigureInput {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: ModelWireProtocol;
  readonly model: string;
  /** Write-only; never echoed, never recorded. Omitted or blank keeps the stored key. */
  readonly apiKey?: string;
  /** Operator-declared price estimates per million tokens. Absent means cost is unknown. */
  readonly prices?: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number };
  /** `none` = keyless route; `api-key` = Azure OpenAI (chat protocol, needs `apiVersion`); default bearer. */
  readonly auth?: ModelAuthKind;
  readonly apiVersion?: string;
  /** Human label for the stored-provider list. */
  readonly displayName?: string;
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
        if (input.auth !== undefined && !["bearer", "none", "api-key"].includes(input.auth)) throw new Error("model.configure: unsupported auth kind");
        if (input.auth === "api-key") {
          if (input.protocol !== "openai-compatible" && input.protocol !== "openai-completions") throw new Error("model.configure: Azure OpenAI (auth api-key) is only supported on the chat completions protocol");
          if (typeof input.apiVersion !== "string" || input.apiVersion.trim().length === 0) throw new Error("model.configure: Azure OpenAI needs an apiVersion");
        }
        const prices = parseBillingPrices(input.prices);
        const config: ModelConfig = {
          providerId: input.providerId, baseURL: input.baseURL, protocol: input.protocol, model: input.model,
          ...(prices ? { prices } : {}),
          ...(input.auth ? { auth: input.auth } : {}),
          ...(input.auth === "api-key" ? { apiVersion: input.apiVersion!.trim() } : {}),
          ...(typeof input.displayName === "string" && input.displayName.trim() ? { displayName: input.displayName.trim().slice(0, 120) } : {}),
        };
        const secretName = `model-provider:${input.providerId}`;
        const typed = typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
        // Never clear: a blank key leaves whatever is stored. A previous value is remembered so a
        // failed hot-swap can restore it (the new key must not survive a configure that failed).
        const previousKey = typed ? await options.secrets.get(secretName) : undefined;
        if (typed) await options.secrets.put(secretName, input.apiKey!);
        try {
          await options.registry.swap(config, options.secrets);
        } catch (error) {
          if (typed) {
            if (previousKey === undefined) await options.secrets.delete(secretName).catch(() => {});
            else await options.secrets.put(secretName, previousKey).catch(() => {});
          }
          throw error;
        }
        const service = options.getService();
        const configured: Record<string, unknown> = { kind: "model.configured", providerId: config.providerId, baseURL: config.baseURL, protocol: config.protocol, model: config.model };
        if (prices) configured.prices = prices;
        if (config.auth) configured.auth = config.auth;
        if (config.apiVersion) configured.apiVersion = config.apiVersion;
        if (config.displayName) configured.displayName = config.displayName;
        await recordProviderFact(service, options.systemCaller, configured);
        return { ok: true, providerId: config.providerId };
      });
    },
  };
}
