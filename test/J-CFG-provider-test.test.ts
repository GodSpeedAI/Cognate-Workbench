// Journey J-CFG-provider-test: `provider.test` checks a stored provider or an unsaved draft with the
// cheapest safe request (list models, never a completion) and reports {ok, latencyMs, modelCount?,
// message}. The key is resolved server-side and never returned or recorded.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";
import { fakeProvider } from "./providerFake.ts";

interface TestResult { readonly ok: boolean; readonly latencyMs: number; readonly modelCount?: number; readonly message: string }

describe("J-CFG-provider-test", () => {
  test("stored provider: ok with latency and model count, using the stored key, GET /models only", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider({ acceptKey: "sk-test-STORED", models: ["a", "b", "c"] });
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", { providerId: "p", baseURL: fake.baseURL, protocol: "openai-compatible", model: "a", apiKey: "sk-test-STORED" });
        const result = (await client.invoke("provider.test", { providerId: "p" })) as unknown as TestResult;
        expect(result.ok).toBe(true);
        expect(result.modelCount).toBe(3);
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.message).toMatch(/Connected/);
        expect(JSON.stringify(result)).not.toContain("sk-test-STORED");
        // Cheapest safe check: only GET /models reached the endpoint; no completion was requested.
        expect(fake.seen.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/models"]);
        expect(fake.seen[0]!.authorization).toBe("Bearer sk-test-STORED");
        // Nothing recorded: no event of any run carries the key (the projections are the durable view).
        await app.runtime.idle();
        for (const name of ["model-config", "provider-routes"]) {
          expect(JSON.stringify((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name })).rows)).not.toContain("sk-test-STORED");
        }
      } finally { await app.stop(); await fake.stop(); }
    });
  });

  test("a rejected key reports the status without echoing the key; an unreachable host reports why", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider({ acceptKey: "right-key" });
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", { providerId: "p", baseURL: fake.baseURL, protocol: "openai-compatible", model: "a", apiKey: "wrong-KEY-123" });
        const rejected = (await client.invoke("provider.test", { providerId: "p" })) as unknown as TestResult;
        expect(rejected.ok).toBe(false);
        expect(rejected.message).toMatch(/401/);
        expect(rejected.message).toMatch(/key was rejected/);
        expect(JSON.stringify(rejected)).not.toContain("wrong-KEY-123");

        // Unsaved draft with its own typed key, tested before saving.
        const draft = (await client.invoke("provider.test", { baseURL: fake.baseURL, protocol: "openai-compatible", apiKey: "right-key" })) as unknown as TestResult;
        expect(draft.ok).toBe(true);
        expect(draft.modelCount).toBe(2);

        const port = fake.port;
        await fake.stop();
        const down = (await client.invoke("provider.test", { baseURL: `http://127.0.0.1:${port}/v1`, protocol: "openai-compatible", apiKey: "right-key" })) as unknown as TestResult;
        expect(down.ok).toBe(false);
        expect(down.message).toMatch(/Could not reach/);
        expect(down.message).not.toContain("right-key");
      } finally { await app.stop(); await fake.stop().catch(() => {}); }
    });
  });

  test("missing input, unknown provider, remote draft without a key, and a draft that would receive a stored key elsewhere", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider({ acceptKey: "k" });
      const other = fakeProvider({ acceptKey: "k" });
      const { app, client } = await bootApp(home);
      try {
        expect(((await client.invoke("provider.test", {})) as unknown as TestResult).ok).toBe(false);
        const unknown = (await client.invoke("provider.test", { providerId: "ghost" })) as unknown as TestResult;
        expect(unknown).toMatchObject({ ok: false });
        expect(unknown.message).toMatch(/not a stored provider/);
        const noKey = (await client.invoke("provider.test", { baseURL: "https://remote.example.invalid/v1", protocol: "openai-compatible" })) as unknown as TestResult;
        expect(noKey.ok).toBe(false);
        expect(noKey.message).toMatch(/No API key/);

        await client.invoke("model.configure", { providerId: "p", baseURL: fake.baseURL, protocol: "openai-compatible", model: "a", apiKey: "k" });
        // The stored key is only sent to the stored base URL.
        const redirected = (await client.invoke("provider.test", { providerId: "p", baseURL: other.baseURL, protocol: "openai-compatible" })) as unknown as TestResult;
        expect(redirected.ok).toBe(false);
        expect(redirected.message).toMatch(/only sent to the saved provider/);
        expect(other.seen.length).toBe(0);
      } finally { await app.stop(); await fake.stop(); await other.stop(); }
    });
  });

  test("a keyless local server passes with no key on all three protocols and sees no credential header", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider(); // rejects any credential
      const { app, client } = await bootApp(home);
      try {
        for (const protocol of ["openai-compatible", "openai-responses", "anthropic-messages"] as const) {
          const r = (await client.invoke("provider.test", { baseURL: fake.baseURL, protocol })) as unknown as TestResult;
          expect(r.ok).toBe(true);
        }
        expect(fake.seen.length).toBe(3);
        expect(fake.seen.every((r) => r.authorization === undefined && r.xApiKey === undefined)).toBe(true);
        expect(fake.seen.every((r) => r.path === "/v1/models")).toBe(true);
        // A stored local provider with no key also tests ok.
        await client.invoke("model.configure", { providerId: "loc", baseURL: fake.baseURL, protocol: "anthropic-messages", model: "m" });
        expect(((await client.invoke("provider.test", { providerId: "loc" })) as unknown as TestResult).ok).toBe(true);
      } finally { await app.stop(); await fake.stop(); }
    });
  }, 60_000); // boots an app and makes four provider calls; the default 5s budget is not enough under suite load
});
