// `provider.delete` and `model.catalog` (T11): the two Settings -> Models actions that were inert.
//
// `provider.delete` (J-CFG-provider-delete) removes the single live provider configuration this
// build supports. Order matters and is asserted by the journey test: the stored secret is removed
// FIRST, so a failure there aborts with the configuration still intact (recoverable) rather than
// leaving an orphaned secret behind a deleted config (not recoverable without file access). Only
// then is the mounted provider dismounted and the durable `provider.deleted` fact recorded.
//
// `model.catalog` (J-CFG-model-catalog) discovers real model ids from the provider. It is read-only
// and records no event. It never fabricates a list: an empty base URL, an unsupported protocol, a
// transport failure or an unparseable body each return a specific reason the UI shows verbatim.
// The API key is read server-side only and is never echoed, logged, or placed in an event.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { ModelWireProtocol, ProviderRegistry } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { authHeaderValue, catalogRequest, parseModelIds } from "../modelCatalog.ts";

export interface ProviderDeleteInput {
  readonly providerId: string;
}

export interface ModelCatalogInput {
  readonly protocol: ModelWireProtocol;
  readonly baseURL: string;
  /** Optional. When absent the configured provider's stored key is used. Never returned. */
  readonly apiKey?: string;
}

const SECRET_KEY = "model-provider:";

export function providerManageComponent(options: {
  readonly registry: ProviderRegistry;
  readonly secrets: SecretStore;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly deleteSemanticRef?: SemanticRef;
  readonly catalogSemanticRef?: SemanticRef;
}): Component {
  const deleteContract = { id: "provider.delete", version: "1.0.0", semanticRef: options.deleteSemanticRef };
  const catalogContract = { id: "model.catalog", version: "1.0.0", semanticRef: options.catalogSemanticRef };
  return {
    id: "provider:manage",
    provides: [deleteContract, catalogContract],
    activate(fiber) {
      fiber.provide(deleteContract, async (rawInput) => {
        const input = rawInput as ProviderDeleteInput;
        if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) {
          throw new Error("provider.delete: a non-empty providerId is required");
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "model-config" })).rows;
        // `readProjection` returns tenant-relative keys ("current", "record/x"), so match both the
        // bare and the qualified form rather than assuming a prefix.
        const current = rows.find((r) => r.key === "current" || r.key.endsWith("/current"))?.value as { readonly providerId?: string } | undefined;
        // This build holds exactly one live configuration; deleting a provider that is not the
        // configured one would silently do nothing, which is exactly the no-op the product forbids.
        if (!current?.providerId) throw new Error("provider.delete: no provider is configured");
        if (current.providerId !== input.providerId) {
          throw new Error(`provider.delete: ${input.providerId} is not the configured provider`);
        }
        // Secret first: a throw here leaves the configuration intact and the key still present, so
        // the operator can simply retry. The reverse order cannot be undone from the UI.
        await options.secrets.delete(`${SECRET_KEY}${input.providerId}`);
        // Dismount the live provider so no later generate call can resolve to a deleted route.
        await options.registry.clear(`provider.delete: ${input.providerId}`);
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "provider.deleted", providerId: input.providerId },
          idempotencyKey: randomUUID(),
        });
        return { ok: true, providerId: input.providerId };
      });

      fiber.provide(catalogContract, async (rawInput) => {
        const input = rawInput as ModelCatalogInput;
        const plan = catalogRequest(input.protocol, input.baseURL);
        if (!plan.ok) return { ok: false as const, reason: plan.reason, models: [] as readonly string[] };
        // Resolve the key server-side. `ctx` is used only to scope the read to this caller's tenant.
        const key = typeof input.apiKey === "string" && input.apiKey.trim().length > 0
          ? input.apiKey
          : await options.secrets.get(`${SECRET_KEY}${options.registry.current?.providerId ?? ""}`);
        const headers: Record<string, string> = { accept: "application/json" };
        const auth = authHeaderValue(plan, key ?? "");
        if (auth) headers[plan.authHeader] = auth;
        let response: Response;
        try {
          response = await fetch(plan.url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return { ok: false as const, reason: `Could not reach ${plan.url}: ${detail}`, models: [] as readonly string[] };
        }
        if (!response.ok) {
          return {
            ok: false as const,
            reason: `${plan.url} responded ${response.status} ${response.statusText}. Check the base URL and API key.`,
            models: [] as readonly string[],
          };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false as const, reason: "The provider returned a body this app could not read as JSON.", models: [] as readonly string[] };
        }
        const parsed = parseModelIds(body);
        if (!parsed.ok) {
          return { ok: false as const, reason: parsed.error, models: [] as readonly string[] };
        }
        return { ok: true as const, models: parsed.models };
      });
    },
  };
}
