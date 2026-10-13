// Pure model-discovery logic (T11, J-CFG-model-catalog): how this app asks a provider for its real
// model list, and how it reads the answer. No network here — the capability performs the request —
// so the URL, headers and parse rules are unit-testable (test/workbench-model-catalog.test.ts).
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
      readonly authHeader: "Authorization" | "x-api-key";
      readonly authScheme: "Bearer" | "none";
    }
  | { readonly ok: false; readonly reason: string };

const SUPPORTED: Readonly<Record<ModelWireProtocol, { readonly path: string; readonly authHeader: "Authorization" | "x-api-key"; readonly authScheme: "Bearer" | "none" }>> = {
  // OpenAI-compatible and completions both expose GET /models.
  "openai-compatible": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  "openai-completions": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  "openai-responses": { path: "/models", authHeader: "Authorization", authScheme: "Bearer" },
  // Anthropic's Messages API exposes GET /v1/models with the key in x-api-key.
  "anthropic-messages": { path: "/v1/models", authHeader: "x-api-key", authScheme: "none" },
};

/** Builds the discovery request, or refuses with a reason. Never performs I/O. */
export function catalogRequest(protocol: ModelWireProtocol, baseURL: string): CatalogPlan {
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
  // Join against the origin + existing base path so a baseURL of https://host/v1 keeps the /v1 prefix.
  const base = url.href.replace(/\/+$/, "");
  return { ok: true, url: `${base}${spec.path}`, method: "GET", authHeader: spec.authHeader, authScheme: spec.authScheme };
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

/** Builds the auth header value for a request. The key never leaves this function. */
export function authHeaderValue(plan: Extract<CatalogPlan, { ok: true }>, apiKey: string): string | undefined {
  if (plan.authScheme === "Bearer") return `Bearer ${apiKey}`;
  return apiKey.trim().length > 0 ? apiKey : undefined;
}
