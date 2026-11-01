// T11 (J-CFG-model-catalog): pure discovery logic — the URL/headers this app would send, and how it
// reads a provider's answer. No network; the capability performs the request.
import { describe, expect, test } from "bun:test";
import { authHeaderValue, catalogRequest, parseModelIds, type CatalogPlan } from "../src/modelCatalog.ts";

const okPlan = (protocol: Parameters<typeof catalogRequest>[0], baseURL: string) => {
  const plan = catalogRequest(protocol, baseURL);
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.reason}`);
  return plan;
};

describe("catalogRequest", () => {
  test("openai-compatible asks /models with a Bearer Authorization header", () => {
    const plan = okPlan("openai-compatible", "https://api.example.com");
    expect(plan.url).toBe("https://api.example.com/models");
    expect(plan.method).toBe("GET");
    expect(plan.authHeader).toBe("Authorization");
    expect(plan.authScheme).toBe("Bearer");
  });

  test("a base URL with an existing path keeps that prefix", () => {
    expect(okPlan("openai-compatible", "https://api.example.com/v1").url).toBe("https://api.example.com/v1/models");
    expect(okPlan("openai-compatible", "https://api.example.com/v1/").url).toBe("https://api.example.com/v1/models");
  });

  test("anthropic-messages asks /v1/models with x-api-key and no Bearer scheme", () => {
    const plan = okPlan("anthropic-messages", "https://api.anthropic.com");
    expect(plan.url).toBe("https://api.anthropic.com/v1/models");
    expect(plan.authHeader).toBe("x-api-key");
    expect(plan.authScheme).toBe("none");
  });

  test("J-CFG-model-catalog: a base URL ending in /v1 or not reaches the same /models endpoint on every protocol", () => {
    // Regression (R5 3.5): the Anthropic preset's https://api.anthropic.com/v1 used to become /v1/v1/models.
    expect(okPlan("anthropic-messages", "https://api.anthropic.com/v1").url).toBe("https://api.anthropic.com/v1/models");
    expect(okPlan("anthropic-messages", "https://api.anthropic.com/v1/").url).toBe("https://api.anthropic.com/v1/models");
    expect(okPlan("anthropic-messages", "https://api.anthropic.com").url).toBe("https://api.anthropic.com/v1/models");
    expect(okPlan("anthropic-messages", "https://api.z.ai/api/anthropic/v1").url).toBe("https://api.z.ai/api/anthropic/v1/models");
    expect(okPlan("anthropic-messages", "https://api.z.ai/api/anthropic").url).toBe("https://api.z.ai/api/anthropic/v1/models");
    for (const protocol of ["openai-compatible", "openai-completions", "openai-responses"] as const) {
      expect(okPlan(protocol, "https://api.openai.com/v1").url).toBe("https://api.openai.com/v1/models");
      expect(okPlan(protocol, "https://api.openai.com/v1/").url).toBe("https://api.openai.com/v1/models");
      expect(okPlan(protocol, "https://api.openai.com/v1?x=1#frag").url).toBe("https://api.openai.com/v1/models");
    }
  });

  test("an empty key never produces an auth header (no 'Bearer ' with nothing after it)", () => {
    const bearer = okPlan("openai-compatible", "http://127.0.0.1:1234/v1");
    expect(authHeaderValue(bearer, "")).toBeUndefined();
    expect(authHeaderValue(bearer, "   ")).toBeUndefined();
    expect(authHeaderValue(bearer, "k")).toBe("Bearer k");
    expect(authHeaderValue(okPlan("anthropic-messages", "http://127.0.0.1:1"), "")).toBeUndefined();
  });

  test("Azure OpenAI lists models one level above the deployment with the api-version and api-key header", () => {
    const plan = catalogRequest("openai-compatible", "https://res.openai.azure.com/openai/deployments/gpt4", { auth: "api-key", apiVersion: "2024-10-21" });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.url).toBe("https://res.openai.azure.com/openai/models?api-version=2024-10-21");
    expect(plan.authHeader).toBe("api-key");
    expect(catalogRequest("openai-compatible", "https://res.openai.azure.com", { auth: "api-key" }).ok).toBe(false);
  });

  test("every OpenAI variant supports discovery", () => {
    for (const protocol of ["openai-compatible", "openai-completions", "openai-responses"] as const) {
      const plan = catalogRequest(protocol, "https://h.example");
      expect(plan.ok).toBe(true);
    }
  });

  test("refuses an empty base URL with a specific reason", () => {
    const plan = catalogRequest("openai-compatible", "   ");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("base URL");
  });

  test("refuses a malformed URL", () => {
    const plan = catalogRequest("openai-compatible", "not a url");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("not a valid URL");
  });

  test("refuses a non-http scheme", () => {
    const plan = catalogRequest("openai-compatible", "ftp://host");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("http or https");
  });
});

describe("parseModelIds", () => {
  test("reads data[].id, the shape both OpenAI and Anthropic use", () => {
    const parsed = parseModelIds({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    expect(parsed).toEqual({ ok: true, models: ["gpt-4o", "gpt-4o-mini"] });
  });

  test("drops entries without a usable id rather than inventing one", () => {
    const parsed = parseModelIds({ data: [{ id: "real" }, { name: "no-id" }, { id: "" }, { id: "  " }, null] });
    expect(parsed).toEqual({ ok: true, models: ["real"] });
  });

  test("a non-object body is an error, never a fabricated list", () => {
    expect(parseModelIds("oops").ok).toBe(false);
    expect(parseModelIds(null).ok).toBe(false);
    expect(parseModelIds([1, 2]).ok).toBe(false);
  });

  test("a body without a data array is an error", () => {
    const parsed = parseModelIds({ models: ["a"] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("model list");
  });

  test("an empty data array is an error, not an empty success", () => {
    const parsed = parseModelIds({ data: [] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("no models");
  });
});

describe("authHeaderValue", () => {
  const bearer = okPlan("openai-compatible", "https://h");
  const raw = okPlan("anthropic-messages", "https://h");

  test("Bearer scheme prefixes the key", () => {
    expect(authHeaderValue(bearer, "sk-123")).toBe("Bearer sk-123");
  });

  test("none scheme passes the key through raw", () => {
    expect(authHeaderValue(raw, "sk-ant-1")).toBe("sk-ant-1");
  });

  test("an empty key on the raw scheme yields undefined rather than a header with nothing in it", () => {
    expect(authHeaderValue(raw, "   ")).toBeUndefined();
    expect(authHeaderValue(bearer, "")).toBeUndefined();
  });

  test("the plan never carries the key", () => {
    const plan: CatalogPlan = bearer;
    expect(JSON.stringify(plan)).not.toContain("sk-");
  });
});
