// Model-discovery logic (T11, J-CFG-model-catalog): how this app asks a provider for its real
// model list, and how it reads the answer. URL, header and parse rules are pure and unit-testable
// (test/workbench-model-catalog.test.ts); `requestModelList` is the single place that performs the
// GET, shared by `model.catalog` and `provider.test` so both report the same specific reasons.
//
// The governing rule: never invent a model list. A discovery failure or a protocol with no
// discovery endpoint returns a specific reason the UI shows verbatim, not a guessed list.

import type { ModelWireProtocol } from "./components/providerRegistry.ts";

export type CatalogPlan =
  | {
      readonly ok: true;
      readonly url: string;
      readonly method: "GET";
      /** Header names only carry the auth scheme; the key itself is added by the caller and never
       *  returned to a client, logged, or placed in an event. */
      readonly authHeader: "Authorization" | "x-api-key" | "api-key";
      readonly authScheme: "Bearer" | "none";
    }
  | { readonly ok: false; readonly reason: string };

export interface CatalogRouteOptions {
  /** `api-key` is Azure OpenAI's header scheme; `none` marks a keyless route. */
  readonly auth?: "bearer" | "none" | "api-key";
  readonly apiVersion?: string;
}

const SUPPORTED: Readonly<Record<ModelWireProtocol, { readonly path: string; readonly authHeader: "Authorization" | "x-api-key"; readonly authScheme: "Bearer" | "none" }>> = {
  // OpenAI-compatible and completions both expose GET /models.
  "openai-compatible": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  "openai-completions": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  "openai-responses": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  // Anthropic's Messages API exposes GET /v1/models with the key in x-api-key.
  "anthropic-messages": { path: "/v1/models", authHeader: "x-api-key", authScheme: "none" },
};

/** Strips trailing slashes, query and fragment so a base URL joins the same way the SDK adapters do
 *  (`${baseURL}/chat/completions`, `${baseURL}/responses`, `${baseURL}/messages`). */
export function normaliseBaseURL(url: URL): string {
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** Builds the discovery request, or refuses with a reason. Never performs I/O.
 *
 *  Join rule: every adapter treats the base URL as including the API version segment (`/v1`), so
 *  discovery appends `/models` to it. Anthropic's list endpoint is `/v1/models`; an origin-only
 *  Anthropic base gets `/v1` added, a base already ending in `/v1` does not (it used to produce
 *  `/v1/v1/models`). */
export function catalogRequest(protocol: ModelWireProtocol, baseURL: string, route: CatalogRouteOptions = {}): CatalogPlan {
  const trimmed = baseURL.trim();
  if (!trimmed) return { ok: false, reason: "Enter a base URL before fetching models." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "The base URL is not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "The base URL must be http or https." };
  }
  const spec = SUPPORTED[protocol];
  if (!spec) {
    return { ok: false, reason: `${protocol} does not support model discovery. Enter a model name manually.` };
  }
  const base = normaliseBaseURL(url);
  if (route.auth === "api-key") {
    // Azure OpenAI: GET {resource}/openai/models?api-version=... with an `api-key` header. The base URL
    // names a deployment (.../openai/deployments/<name>); the model list lives one level up.
    const resource = base.replace(/\/openai(\/.*)?$/, "");
    const version = route.apiVersion?.trim();
    if (!version) return { ok: false, reason: "Azure OpenAI needs an API version (api-version) before models can be listed." };
    return { ok: true, url: `${resource}/openai/models?api-version=${encodeURIComponent(version)}`, method: "GET", authHeader: "api-key", authScheme: "none" };
  }
  const path = protocol === "anthropic-messages" && /\/v1$/.test(base) ? "/models" : spec.path;
  return { ok: true, url: `${base}${path}`, method: "GET", authHeader: spec.authHeader, authScheme: spec.authScheme };
}

/** A saved provider key may only be sent to the provider it was saved for. Without this, any caller of
 *  `model.catalog` could name its own URL and receive the saved key in the request headers. The URLs are
 *  compared after parsing, ignoring trailing slashes; the protocol must match too. */
export function storedKeyTarget(
  saved: { readonly baseURL: string; readonly protocol: ModelWireProtocol } | undefined,
  requested: { readonly baseURL: string; readonly protocol: ModelWireProtocol },
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!saved) return { ok: false, reason: "No provider is saved yet. Enter an API key to fetch models." };
  const norm = (value: string): string | undefined => {
    try { return new URL(value.trim()).href.replace(/\/+$/, ""); } catch { return undefined; }
  };
  const savedURL = norm(saved.baseURL);
  if (savedURL === undefined || savedURL !== norm(requested.baseURL) || saved.protocol !== requested.protocol) {
    return { ok: false, reason: `The saved API key is only sent to the saved provider (${saved.baseURL}). Enter an API key to fetch models from a different URL.` };
  }
  return { ok: true };
}

/** What `model.catalog` returns to the caller: either the discovered ids, or a specific reason the
 *  UI shows verbatim. Never contains the API key. */
export type ModelCatalogResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly models: readonly string[] };

/** Reads model ids out of a discovery response body. OpenAI and Anthropic both use `data[].id`.
 *  Never fabricates a list: a non-object body, a missing `data` array, or an empty one each
 *  produce a specific, displayable reason. */
export type ModelIdsResult = { readonly ok: true; readonly models: readonly string[] } | { readonly ok: false; readonly error: string };

export function parseModelIds(body: unknown): ModelIdsResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "The provider returned an unrecognised response." };
  }
  const data = (body as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return { ok: false, error: "The provider response did not contain a model list." };
  const ids = data
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { readonly id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (ids.length === 0) return { ok: false, error: "The provider reported no models for this key." };
  return { ok: true, models: ids };
}

/** Builds the auth header value for a request, or undefined when there is nothing to send: an empty
 *  key never produces an `Authorization: Bearer ` header. The key never leaves this function. */
export function authHeaderValue(plan: Extract<CatalogPlan, { ok: true }>, apiKey: string): string | undefined {
  if (apiKey.trim().length === 0) return undefined;
  if (plan.authScheme === "Bearer") return `Bearer ${apiKey}`;
  return apiKey;
}

export type ModelListOutcome =
  | { readonly ok: true; readonly models: readonly string[]; readonly latencyMs: number }
  | { readonly ok: false; readonly reason: string; readonly latencyMs: number };

/** Performs the discovery GET and maps every failure to a specific, displayable reason. Read-only:
 *  never a completion, so it cannot spend tokens. The key is placed in the request header only. */
export async function requestModelList(
  plan: Extract<CatalogPlan, { ok: true }>,
  apiKey: string,
  timeoutMs = 15_000,
): Promise<ModelListOutcome> {
  const started = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));
  const headers: Record<string, string> = { accept: "application/json" };
  const auth = authHeaderValue(plan, apiKey);
  if (auth) headers[plan.authHeader] = auth;
  let response: Response;
  try {
    response = await fetch(plan.url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Could not reach ${plan.url}: ${detail}`, latencyMs: elapsed() };
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? "The API key was rejected." : "Check the base URL and API key.";
    return { ok: false, reason: `${plan.url} responded ${response.status} ${response.statusText}. ${hint}`, latencyMs: elapsed() };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "The provider returned a body this app could not read as JSON.", latencyMs: elapsed() };
  }
  const parsed = parseModelIds(body);
  if (!parsed.ok) return { ok: false, reason: parsed.error, latencyMs: elapsed() };
  return { ok: true, models: parsed.models, latencyMs: elapsed() };
}
