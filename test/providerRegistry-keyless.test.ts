// J-CFG-model-provider: keyless routes and Azure auth, asserted at the wire through the real
// adapters (global fetch stubbed because the adapters resolve `fetch` when they are built).
import { afterEach, describe, expect, test } from "bun:test";
import { buildProvider, isKeylessRoute, type ModelConfig } from "../src/components/providerRegistry.ts";
import type { SecretStore } from "../src/secrets.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function store(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return { put: async (k, v) => void m.set(k, v), get: async (k) => m.get(k), delete: async (k) => void m.delete(k) };
}

async function wire(config: ModelConfig, secrets: SecretStore): Promise<{ readonly url: string; readonly headers: Headers; readonly error?: string }> {
  let seen: { url: string; headers: Headers } | undefined;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    seen = { url: typeof input === "string" ? input : String((input as URL | Request instanceof URL ? input : (input as Request).url)), headers: new Headers(init?.headers) };
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  let error: string | undefined;
  try { await buildProvider(config, secrets).generate({ messages: [{ role: "user", content: "x" }] }); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  if (!seen) return { url: "", headers: new Headers(), ...(error ? { error } : {}) };
  return { ...seen, ...(error ? { error } : {}) };
}

const local = (protocol: ModelConfig["protocol"]): ModelConfig => ({ providerId: "loc", baseURL: "http://127.0.0.1:9999/v1/", protocol, model: "m" });

describe("J-CFG-model-provider keyless routes", () => {
  test("isKeylessRoute: loopback by default, explicit none, never when bearer/api-key is chosen", () => {
    expect(isKeylessRoute({ baseURL: "http://localhost:11434/v1" })).toBe(true);
    expect(isKeylessRoute({ baseURL: "http://127.0.0.1:1/v1" })).toBe(true);
    expect(isKeylessRoute({ baseURL: "http://[::1]:1/v1" })).toBe(true);
    expect(isKeylessRoute({ baseURL: "https://api.openai.com/v1" })).toBe(false);
    expect(isKeylessRoute({ baseURL: "https://api.openai.com/v1", auth: "none" })).toBe(true);
    expect(isKeylessRoute({ baseURL: "http://127.0.0.1:1/v1", auth: "bearer" })).toBe(false);
  });

  for (const protocol of ["openai-compatible", "openai-responses", "anthropic-messages"] as const) {
    test(`${protocol}: a local route with no stored key sends no credential and does not fail on the empty key`, async () => {
      const r = await wire(local(protocol), store());
      expect(r.error ?? "").not.toMatch(/Credential unavailable/);
      expect(r.headers.get("authorization")).toBeNull();
      expect(r.headers.get("x-api-key")).toBeNull();
      expect(r.url).not.toContain("//v1");
    });

    test(`${protocol}: a stored key on a local route is still sent`, async () => {
      const r = await wire(local(protocol), store({ "model-provider:loc": "sk-local" }));
      const header = protocol === "anthropic-messages" ? r.headers.get("x-api-key") : r.headers.get("authorization");
      expect(header).toBe(protocol === "anthropic-messages" ? "sk-local" : "Bearer sk-local");
    });

    test(`${protocol}: a remote route with no key still fails closed`, async () => {
      const r = await wire({ ...local(protocol), baseURL: "https://remote.example.invalid/v1" }, store());
      if (protocol === "openai-compatible") expect(r.headers.get("authorization")).toBe("Bearer");
      else expect(r.error ?? "").toMatch(/Credential unavailable/);
    });

    test(`${protocol}: auth none sends nothing even to a remote host`, async () => {
      const r = await wire({ ...local(protocol), baseURL: "https://gateway.example.invalid/v1", auth: "none" }, store({ "model-provider:loc": "ignored" }));
      expect(r.headers.get("authorization")).toBeNull();
      expect(r.headers.get("x-api-key")).toBeNull();
    });
  }

  test("Azure OpenAI: api-key header, api-version query, no Authorization", async () => {
    const r = await wire(
      { providerId: "az", baseURL: "https://res.openai.azure.com/openai/deployments/gpt4", protocol: "openai-completions", model: "gpt4", auth: "api-key", apiVersion: "2024-10-21" },
      store({ "model-provider:az": "azure-key" }),
    );
    expect(r.url).toBe("https://res.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-10-21");
    expect(r.headers.get("api-key")).toBe("azure-key");
    expect(r.headers.get("authorization")).toBeNull();
  });
});
