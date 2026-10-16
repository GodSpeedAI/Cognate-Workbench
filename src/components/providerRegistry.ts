import type { ModelProvider } from "@godspeedai/cognate-capabilities";
import type { ComponentHandle, Kernel, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { openAICompatible } from "@godspeedai/cognate-provider-openai-compatible";
import { openAIResponses } from "@godspeedai/cognate-provider-openai-responses";
import { anthropicCompatible } from "@godspeedai/cognate-provider-anthropic-compatible";
import { apiKeySource } from "@godspeedai/cognate-provider-auth";
import { streamingProviderComponent, type ModelGenerateBilling } from "./modelProvider.ts";
import type { SecretStore } from "../secrets.ts";

/** Legacy openai-compatible remains accepted for persisted configurations. */
export type ModelWireProtocol = "openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages";
export interface ModelConfig {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: ModelWireProtocol;
  readonly model: string;
  /** Operator-declared price estimates per million tokens; absent means cost is unknown. */
  readonly prices?: { inputUsdPerMillion: number; outputUsdPerMillion: number };
}
export function buildProvider(config: ModelConfig, secrets: SecretStore): ModelProvider {
  const key = async () => (await secrets.get("model-provider:" + config.providerId)) ?? "";
  switch (config.protocol) {
    case "openai-compatible":
    case "openai-completions":
      return openAICompatible({id:config.providerId,baseURL:config.baseURL,model:config.model,apiKey:key});
    case "openai-responses":
      return openAIResponses({id:config.providerId,baseURL:config.baseURL,model:config.model,credentials:apiKeySource(key)});
    case "anthropic-messages":
      return anthropicCompatible({id:config.providerId,baseURL:config.baseURL,model:config.model,credentials:apiKeySource(key,"x-api-key")});
    default:
      throw new Error("model.configure: unsupported wire protocol");
  }
}

export class ProviderRegistry {
  #kernel: Kernel;
  #semanticRef: SemanticRef | undefined;
  #handle: ComponentHandle | undefined;
  #current: ModelConfig | undefined;
  #billing: ModelGenerateBilling | undefined;
  constructor(kernel: Kernel, semanticRef?: SemanticRef, billing?: ModelGenerateBilling) {
    this.#kernel = kernel; this.#semanticRef = semanticRef; this.#billing = billing;
  }
  get current(): ModelConfig | undefined { return this.#current; }
  /** T11 (J-CFG-provider-delete): dismounts whatever is mounted and clears the active route, so a
   *  deleted provider can never answer a later generate call. Idempotent — clearing an already
   *  empty registry is a no-op rather than an error. */
  async clear(reason: string): Promise<void> {
    const previous = this.#handle;
    this.#handle = undefined;
    this.#current = undefined;
    if (previous) await previous.dispose(reason).catch(() => {});
  }
  async swap(config: ModelConfig, secrets: SecretStore): Promise<void> {
    const provider = buildProvider(config, secrets);
    const nextHandle = await this.#kernel.mount(streamingProviderComponent(provider, this.#semanticRef, this.#billing));
    try {
      await nextHandle.waitFor("ACTIVE",5000);
    } catch (error) {
      // Roll back cleanly: the replacement never became ACTIVE, so dispose it and leave the
      // previous provider mounted and usable (hot-swap failure must not take the app down).
      await nextHandle.dispose("hot-swap failed before activation").catch(() => {});
      throw error;
    }
    const previous = this.#handle;
    this.#handle = nextHandle;
    this.#current = config;
    if(previous) await previous.dispose("hot-swap to provider " + config.providerId);
  }
}
