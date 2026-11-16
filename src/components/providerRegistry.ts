import type { ModelProvider } from "@godspeedai/cognate-capabilities";
import type { ComponentHandle, Kernel, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { openAICompatible } from "@godspeedai/cognate-provider-openai-compatible";
import { openAIResponses } from "@godspeedai/cognate-provider-openai-responses";
import { anthropicCompatible } from "@godspeedai/cognate-provider-anthropic-compatible";
import type { CredentialSource } from "@godspeedai/cognate-provider-auth";
import { streamingProviderComponent, type ModelGenerateBilling } from "./modelProvider.ts";
import type { SecretStore } from "../secrets.ts";

/** Legacy openai-compatible remains accepted for persisted configurations. */
export type ModelWireProtocol = "openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages";
/** How the key reaches the provider. `bearer` is the protocol default (Authorization: Bearer, or
 *  x-api-key for Anthropic); `api-key` is Azure OpenAI's header (chat protocol only); `none` marks a
 *  keyless route that never sends credentials. */
export type ModelAuthKind = "bearer" | "none" | "api-key";

export interface ModelConfig {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: ModelWireProtocol;
  readonly model: string;
  /** Operator-declared price estimates per million tokens; absent means cost is unknown. */
  readonly prices?: { inputUsdPerMillion: number; outputUsdPerMillion: number };
  /** Optional; absent means `bearer`, except that a local host with no stored key sends none. */
  readonly auth?: ModelAuthKind;
  /** Azure OpenAI `api-version` query value (required with `auth: "api-key"`). */
  readonly apiVersion?: string;
  /** Human label shown in the stored-provider list; carries no secret. */
  readonly displayName?: string;
}

/** True for loopback hosts (127.0.0.0/8, localhost, ::1): servers the operator runs themselves. */
export function isLocalBaseURL(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

/** A route may run with no key when it is explicitly `auth: "none"` or targets a local server. An
 *  explicit `bearer`/`api-key` always requires a key. */
export function isKeylessRoute(config: Pick<ModelConfig, "auth" | "baseURL">): boolean {
  if (config.auth === "none") return true;
  if (config.auth === undefined) return isLocalBaseURL(config.baseURL);
  return false;
}

/** Applies Azure's `api-key` header and `api-version` query, dropping the Bearer header the chat
 *  adapter always adds. Pure so it is unit-testable; the key is read per request, never retained. */
export function azureFetch(apiVersion: string, key: () => Promise<string>, inner: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    url.searchParams.set("api-version", apiVersion);
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.set("api-key", await key());
    return inner(url.href, { ...init, headers });
  }) as typeof fetch;
}

export function buildProvider(config: ModelConfig, secrets: SecretStore): ModelProvider {
  const stored = async () => (await secrets.get("model-provider:" + config.providerId)) ?? "";
  const baseURL = config.baseURL.trim().replace(/\/+$/, "");
  const keyless = isKeylessRoute(config);
  if (config.auth === "api-key" && config.protocol !== "openai-compatible" && config.protocol !== "openai-completions") {
    throw new Error("model.configure: auth api-key (Azure OpenAI) is only supported on the chat completions protocol");
  }
  // Credential source for the Responses and Anthropic adapters. A keyless route with no stored key
  // sends no credential headers; any other empty key is an error at request time, as before.
  const source = (header: "authorization" | "x-api-key"): CredentialSource => ({
    async acquire() {
      const key = await stored();
      if (!key) {
        if (keyless) return { headers: {} };
        throw new Error("Credential unavailable");
      }
      return { headers: { [header]: header === "authorization" ? `Bearer ${key}` : key } };
    },
  });
  switch (config.protocol) {
    case "openai-compatible":
    case "openai-completions": {
      if (config.auth === "api-key") {
        if (!config.apiVersion?.trim()) throw new Error("model.configure: Azure OpenAI needs an apiVersion");
        return openAICompatible({ id: config.providerId, baseURL, model: config.model, apiKey: stored, fetch: azureFetch(config.apiVersion.trim(), stored) });
      }
      if (config.auth === "none") return openAICompatible({ id: config.providerId, baseURL, model: config.model });
      if (keyless) {
        // Local server: send Authorization only when a key is actually stored (llama.cpp --api-key),
        // never an empty `Bearer `.
        const dropEmptyBearer: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const headers = new Headers(init?.headers);
          if ((headers.get("authorization") ?? "").trim() === "Bearer") headers.delete("authorization");
          return fetch(input, { ...init, headers });
        }) as typeof fetch;
        return openAICompatible({ id: config.providerId, baseURL, model: config.model, apiKey: stored, fetch: dropEmptyBearer });
      }
      return openAICompatible({ id: config.providerId, baseURL, model: config.model, apiKey: stored });
    }
    case "openai-responses":
      return openAIResponses({ id: config.providerId, baseURL, model: config.model, credentials: config.auth === "none" ? { async acquire() { return { headers: {} }; } } : source("authorization") });
    case "anthropic-messages":
      return anthropicCompatible({ id: config.providerId, baseURL, model: config.model, credentials: config.auth === "none" ? { async acquire() { return { headers: {} }; } } : source("x-api-key") });
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
