// `provider.delete` and `model.catalog` (T11): the two Settings -> Models actions that were inert.
//
// `provider.delete` (J-CFG-provider-delete) removes any stored provider: its secret and its route.
// Deleting the active provider also clears the live route (back to unconfigured); deleting another
// stored provider leaves the active route running. Order matters and is asserted by the journey
// test: the stored secret is removed FIRST, so a failure there aborts with the configuration still
// intact (recoverable) rather than leaving an orphaned secret behind a deleted config (not
// recoverable without file access). Only then is the mounted provider dismounted (active case) and
// the durable `provider.deleted` fact recorded.
//
// `model.catalog` (J-CFG-model-catalog) discovers real model ids from the provider. It is read-only
// and records no event. It never fabricates a list: an empty base URL, an unsupported protocol, a
// transport failure or an unparseable body each return a specific reason the UI shows verbatim.
// The API key is read server-side only and is never echoed, logged, or placed in an event.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { isKeylessRoute, type ModelAuthKind, type ModelWireProtocol, type ProviderRegistry } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { catalogRequest, requestModelList, storedKeyTarget } from "../modelCatalog.ts";
import { readStoredRoutes, recordProviderFact } from "./providerSwitch.ts";

export interface ProviderDeleteInput {
  readonly providerId: string;
}

export interface ModelCatalogInput {
  readonly protocol: ModelWireProtocol;
  readonly baseURL: string;
  /** Optional. When absent the configured provider's stored key is used. Never returned. */
  readonly apiKey?: string;
  /** Route options so an Azure or keyless draft is discovered the way it will run. */
  readonly auth?: ModelAuthKind;
  readonly apiVersion?: string;
  /** Use this stored provider's saved key (only sent to its own saved base URL). Default: the active provider. */
  readonly providerId?: string;
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
        const stored = await readStoredRoutes(options.getService(), options.systemCaller);
        const isActive = options.registry.current?.providerId === input.providerId;
        if (stored.length === 0 && !options.registry.current) throw new Error("provider.delete: no provider is configured");
        if (!stored.some((r) => r.providerId === input.providerId) && !isActive) {
          throw new Error(`provider.delete: ${input.providerId} is not a stored provider`);
        }
        // Secret first: a throw here leaves the configuration intact and the key still present, so
        // the operator can simply retry. The reverse order cannot be undone from the UI.
        await options.secrets.delete(`${SECRET_KEY}${input.providerId}`);
        // Dismount the live provider only when it is the one being deleted, so no later generate call
        // can resolve to a deleted route; another stored provider's deletion leaves the active one.
        if (isActive) await options.registry.clear(`provider.delete: ${input.providerId}`);
        await recordProviderFact(options.getService(), options.systemCaller, { kind: "provider.deleted", providerId: input.providerId });
        return { ok: true, providerId: input.providerId };
      });

      fiber.provide(catalogContract, async (rawInput) => {
        const input = rawInput as ModelCatalogInput;
        const plan = catalogRequest(input.protocol, input.baseURL, { ...(input.auth ? { auth: input.auth } : {}), ...(input.apiVersion ? { apiVersion: input.apiVersion } : {}) });
        if (!plan.ok) return { ok: false as const, reason: plan.reason, models: [] as readonly string[] };
        // Resolve the key server-side. A typed key goes where the caller says; the saved key goes only to
        // the saved provider, so a caller cannot redirect it to a URL of their choosing.
        const typed = typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
        let key = typed ? input.apiKey! : "";
        if (!typed) {
          const saved = typeof input.providerId === "string" && input.providerId
            ? (await readStoredRoutes(options.getService(), options.systemCaller)).find((r) => r.providerId === input.providerId)
            : options.registry.current;
          // A route that can run keyless (local server, auth none) needs no saved key to be listed.
          const target = storedKeyTarget(saved, { baseURL: input.baseURL, protocol: input.protocol });
          if (target.ok && saved) key = (await options.secrets.get(`${SECRET_KEY}${saved.providerId}`)) ?? "";
          else if (!isKeylessRoute({ auth: input.auth, baseURL: input.baseURL })) return { ok: false as const, reason: target.ok ? "No provider is saved yet. Enter an API key to fetch models." : target.reason, models: [] as readonly string[] };
        }
        const outcome = await requestModelList(plan, input.auth === "none" ? "" : key);
        if (!outcome.ok) return { ok: false as const, reason: outcome.reason, models: [] as readonly string[] };
        return { ok: true as const, models: outcome.models };
      });
    },
  };
}
