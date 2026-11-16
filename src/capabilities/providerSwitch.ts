// `provider.list`, `provider.activate`, `provider.test` (J-CFG-provider-switch, J-CFG-provider-test):
// several stored providers, one active route, and a safe connection check.
//
// Stored providers are the rows of the public `provider-routes` projection (one per providerId,
// written by the same durable `model.configured` fact `model.configure` records). The projection
// cannot know whether a key is stored or which route is live, so `provider.list` adds `hasKey` and
// `isCurrent` server-side. Keys live only in the SecretStore: none of these capabilities returns,
// logs or records one. Activation re-mounts a stored route and records `model.configured` again, so
// `model-config` `current` follows and the choice survives a restart.
import { randomUUID } from "node:crypto";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { isKeylessRoute, type ModelAuthKind, type ModelConfig, type ModelWireProtocol, type ProviderRegistry } from "../components/providerRegistry.ts";
import type { SecretStore } from "../secrets.ts";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { catalogRequest, requestModelList, storedKeyTarget } from "../modelCatalog.ts";

export const PROVIDER_SECRET_PREFIX = "model-provider:";

/** Row of `provider.list`. `baseURL` carries no credentials (the app refuses URLs with userinfo). */
export interface StoredProviderRow {
  readonly providerId: string;
  readonly displayName: string;
  readonly protocol: ModelWireProtocol;
  readonly baseURL: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly isCurrent: boolean;
  /** True when the route may run with no key (local host or `auth: "none"`). */
  readonly keyless: boolean;
  readonly auth?: ModelAuthKind;
  readonly apiVersion?: string;
}

export interface ProviderActivateInput {
  readonly providerId: string;
  /** Optional model to switch to; omitted keeps the stored one. */
  readonly model?: string;
}
export interface ProviderTestInput {
  /** A stored provider to test; its stored key is used. With `baseURL` it is a draft that reuses this id's key only if the URL matches. */
  readonly providerId?: string;
  readonly baseURL?: string;
  readonly protocol?: ModelWireProtocol;
  /** Draft key; never returned or recorded. */
  readonly apiKey?: string;
  readonly auth?: ModelAuthKind;
  readonly apiVersion?: string;
}
export interface ProviderTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly modelCount?: number;
  readonly message: string;
}

/** Starts the deterministic `agent.config` run that records a provider fact and waits for it to
 *  complete, so the `provider-routes` / `model-config` projections already reflect it when the
 *  capability returns (a following activate/delete/list must not race the projection). */
export async function recordProviderFact(service: RuntimeService, caller: Caller, input: Record<string, unknown>): Promise<void> {
  const { runId } = await service.startRun(caller, { agent: AGENT_CONFIG, input: input as unknown as Json, idempotencyKey: randomUUID() });
  for (let i = 0; i < 400; i++) {
    const run = await service.getRun(caller, { runId });
    if (run.status === "completed") {
      await awaitRoutesReflect(service, caller, input);
      return;
    }
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`provider: recording failed (${run.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("provider: recording timed out");
}

/** A completed run is not yet a folded projection. Wait until `provider-routes` shows the fact, so the
 *  caller's next read (provider.test, provider.activate, provider.list) sees its own write. */
async function awaitRoutesReflect(service: RuntimeService, caller: Caller, fact: Record<string, unknown>): Promise<void> {
  const providerId = typeof fact.providerId === "string" ? fact.providerId : undefined;
  if (!providerId) return;
  const reflected = (routes: readonly ModelConfig[]): boolean => {
    const row = routes.find((r) => r.providerId === providerId);
    if (fact.kind === "provider.deleted") return row === undefined;
    if (fact.kind === "model.configured") return row !== undefined && row.baseURL === fact.baseURL && row.model === fact.model && row.protocol === fact.protocol;
    return true;
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (reflected(await readStoredRoutes(service, caller))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Stored routes from the `provider-routes` projection (tenant-relative keys `provider:<id>`). */
export async function readStoredRoutes(service: RuntimeService, caller: Caller): Promise<readonly ModelConfig[]> {
  const rows = (await service.readProjection(caller, { name: "provider-routes" })).rows;
  return rows
    .filter((r) => (r.key.startsWith("provider:") || r.key.includes("/provider:")) && r.value && typeof r.value === "object")
    .map((r) => r.value as unknown as ModelConfig);
}

async function hasStoredKey(secrets: SecretStore, providerId: string): Promise<boolean> {
  return ((await secrets.get(`${PROVIDER_SECRET_PREFIX}${providerId}`)) ?? "").length > 0;
}

export function providerSwitchComponent(options: {
  readonly registry: ProviderRegistry;
  readonly secrets: SecretStore;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly listSemanticRef?: SemanticRef;
  readonly activateSemanticRef?: SemanticRef;
  readonly testSemanticRef?: SemanticRef;
}): Component {
  const listContract = { id: "provider.list", version: "1.0.0", semanticRef: options.listSemanticRef };
  const activateContract = { id: "provider.activate", version: "1.0.0", semanticRef: options.activateSemanticRef };
  const testContract = { id: "provider.test", version: "1.0.0", semanticRef: options.testSemanticRef };
  return {
    id: "provider:switch",
    provides: [listContract, activateContract, testContract],
    activate(fiber) {
      fiber.provide(listContract, async () => {
        const routes = await readStoredRoutes(options.getService(), options.systemCaller);
        const currentId = options.registry.current?.providerId;
        const providers: StoredProviderRow[] = [];
        for (const r of routes) {
          providers.push({
            providerId: r.providerId,
            displayName: r.displayName ?? r.providerId,
            protocol: r.protocol,
            baseURL: r.baseURL,
            model: r.model,
            hasKey: await hasStoredKey(options.secrets, r.providerId),
            isCurrent: r.providerId === currentId,
            keyless: isKeylessRoute(r),
            ...(r.auth ? { auth: r.auth } : {}),
            ...(r.apiVersion ? { apiVersion: r.apiVersion } : {}),
          });
        }
        providers.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.displayName.localeCompare(b.displayName));
        return { providers };
      });

      fiber.provide(activateContract, async (rawInput) => {
        const input = rawInput as ProviderActivateInput;
        if (typeof input?.providerId !== "string" || input.providerId.trim().length === 0) throw new Error("provider.activate: a non-empty providerId is required");
        if (input.model !== undefined && (typeof input.model !== "string" || input.model.trim().length === 0)) throw new Error("provider.activate: model must be a non-empty string when given");
        const routes = await readStoredRoutes(options.getService(), options.systemCaller);
        const stored = routes.find((r) => r.providerId === input.providerId);
        if (!stored) throw new Error(`provider.activate: ${input.providerId} is not a stored provider`);
        if (!isKeylessRoute(stored) && !(await hasStoredKey(options.secrets, stored.providerId))) {
          throw new Error(`provider.activate: no API key is stored for ${stored.providerId}; save it with its key first`);
        }
        const config: ModelConfig = { ...stored, model: input.model?.trim() || stored.model };
        await options.registry.swap(config, options.secrets);
        const configured: Record<string, unknown> = { kind: "model.configured", providerId: config.providerId, baseURL: config.baseURL, protocol: config.protocol, model: config.model };
        if (config.prices) configured.prices = config.prices;
        if (config.auth) configured.auth = config.auth;
        if (config.apiVersion) configured.apiVersion = config.apiVersion;
        if (config.displayName) configured.displayName = config.displayName;
        await recordProviderFact(options.getService(), options.systemCaller, configured);
        return { ok: true, providerId: config.providerId, model: config.model };
      });

      fiber.provide(testContract, async (rawInput): Promise<ProviderTestResult> => {
        const input = (rawInput ?? {}) as ProviderTestInput;
        const fail = (message: string, latencyMs = 0): ProviderTestResult => ({ ok: false, latencyMs, message });
        const routes = await readStoredRoutes(options.getService(), options.systemCaller);
        const stored = typeof input.providerId === "string" ? routes.find((r) => r.providerId === input.providerId) : undefined;
        if (typeof input.providerId === "string" && input.providerId && !stored && !input.baseURL) return fail(`${input.providerId} is not a stored provider.`);
        const draft = typeof input.baseURL === "string" && input.baseURL.trim().length > 0;
        const protocol = (draft ? input.protocol : stored?.protocol) as ModelWireProtocol | undefined;
        const baseURL = draft ? input.baseURL! : stored?.baseURL;
        if (!protocol || !baseURL) return fail("Give a stored providerId, or a base URL and protocol to test.");
        const auth = (draft ? input.auth : stored?.auth) as ModelAuthKind | undefined;
        const apiVersion = draft ? input.apiVersion : stored?.apiVersion;
        const plan = catalogRequest(protocol, baseURL, { ...(auth ? { auth } : {}), ...(apiVersion ? { apiVersion } : {}) });
        if (!plan.ok) return fail(plan.reason);
        const typed = typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
        let key = "";
        if (typed) key = input.apiKey!;
        else if (stored) {
          // The stored key goes only to the stored base URL; a draft pointing elsewhere must type its own.
          const target = storedKeyTarget(stored, { baseURL, protocol });
          if (!target.ok) return fail(target.reason);
          key = (await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${stored.providerId}`)) ?? "";
        }
        if (!key && auth !== "none" && !isKeylessRoute({ auth, baseURL })) return fail("No API key is stored for this provider. Enter one to test the connection.");
        const outcome = await requestModelList(plan, auth === "none" ? "" : key);
        if (!outcome.ok) return fail(outcome.reason, outcome.latencyMs);
        const host = new URL(baseURL).host;
        return { ok: true, latencyMs: outcome.latencyMs, modelCount: outcome.models.length, message: `Connected to ${host} in ${outcome.latencyMs} ms; ${outcome.models.length} model${outcome.models.length === 1 ? "" : "s"} listed.` };
      });
    },
  };
}
