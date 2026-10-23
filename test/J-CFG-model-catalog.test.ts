// Journey J-CFG-model-catalog (T11): "Fetch available models" discovers the provider's REAL model
// list. Covers: a live discovery request against a local server returns the ids it reports; a
// transport failure, a non-2xx response and an unparseable body each return a specific reason and
// never a fabricated list; an empty base URL is refused without any network call; and the request
// carries auth without the key ever being echoed back to the caller.
import { createServer } from "node:http";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

interface CatalogResult {
  readonly ok: boolean;
  readonly models?: readonly string[];
  readonly reason?: string;
}

/** A local model-discovery endpoint that records the last request's auth header. */
async function serveModels(handler: (path: string, headers: Record<string, string | string[] | undefined>) => { readonly status: number; readonly body: unknown }): Promise<{
  readonly port: number;
  readonly seen: { readonly path?: string; readonly auth?: string };
  stop(): Promise<void>;
}> {
  const seen: { path?: string; auth?: string } = {};
  const server = createServer((req, res) => {
    seen.path = req.url;
    seen.auth = req.headers["authorization"] ?? (req.headers["x-api-key"] as string | undefined);
    const out = handler(req.url ?? "", req.headers);
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    seen,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("J-CFG-model-catalog", () => {
  test("a live discovery request returns the ids the provider actually reports", async () => {
    const provider = await serveModels(() => ({ status: 200, body: { data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "o3" }] } }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${provider.port}/v1`,
          apiKey: "sk-live-key",
        })) as unknown as CatalogResult;
        expect(result.ok).toBe(true);
        expect(result.models).toEqual(["gpt-4o", "gpt-4o-mini", "o3"]);
        // The request really went to /v1/models with the key in an Authorization header.
        expect(provider.seen.path).toBe("/v1/models");
        expect(provider.seen.auth).toBe("Bearer sk-live-key");
        // And the key is never echoed back in the response.
        expect(JSON.stringify(result)).not.toContain("sk-live-key");
      } finally {
        await app.stop();
        await provider.stop();
      }
    });
  });

  test("anthropic-messages uses x-api-key against /v1/models", async () => {
    const provider = await serveModels(() => ({ status: 200, body: { data: [{ id: "claude-3-5-sonnet" }] } }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", {
          protocol: "anthropic-messages",
          baseURL: `http://127.0.0.1:${provider.port}`,
          apiKey: "sk-ant-key",
        })) as unknown as CatalogResult;
        expect(result.ok).toBe(true);
        expect(result.models).toEqual(["claude-3-5-sonnet"]);
        expect(provider.seen.path).toBe("/v1/models");
        expect(provider.seen.auth).toBe("sk-ant-key");
      } finally {
        await app.stop();
        await provider.stop();
      }
    });
  });

  test("an unreachable endpoint returns a specific reason, never a fabricated list", async () => {
    // Bind then close, so the port is guaranteed closed.
    const port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        s.close(() => resolve(p));
      });
    });
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${port}/v1`,
          apiKey: "sk",
        })) as unknown as CatalogResult;
        expect(result.ok).toBe(false);
        expect(result.models ?? []).toEqual([]);
        expect(result.reason).toContain("Could not reach");
      } finally {
        await app.stop();
      }
    });
  });

  test("a non-2xx response surfaces the status, not a guess", async () => {
    const provider = await serveModels(() => ({ status: 401, body: { error: "bad key" } }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${provider.port}/v1`,
          apiKey: "sk-wrong",
        })) as unknown as CatalogResult;
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("401");
      } finally {
        await app.stop();
        await provider.stop();
      }
    });
  });

  test("an unparseable body is an error, never an empty success", async () => {
    const provider = await serveModels(() => ({ status: 200, body: "not json shaped" }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${provider.port}/v1`,
          apiKey: "sk",
        })) as unknown as CatalogResult;
        expect(result.ok).toBe(false);
        expect(result.models ?? []).toEqual([]);
        expect(result.reason && result.reason.length > 0).toBe(true);
      } finally {
        await app.stop();
        await provider.stop();
      }
    });
  });

  test("the saved key goes only to the saved provider, never to a URL the caller names", async () => {
    const saved = await serveModels(() => ({ status: 200, body: { data: [{ id: "m-saved" }] } }));
    const foreign = await serveModels(() => ({ status: 200, body: { data: [{ id: "m-foreign" }] } }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${saved.port}/v1`,
          protocol: "openai-compatible",
          model: "m-saved",
          apiKey: "sk-saved-secret",
        });
        // No key typed, foreign URL: refused before any request, so the foreign server sees nothing.
        const refused = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${foreign.port}/v1`,
        })) as unknown as CatalogResult;
        expect(refused.ok).toBe(false);
        expect(refused.reason).toContain("only sent to the saved provider");
        expect(foreign.seen.path).toBeUndefined();
        expect(foreign.seen.auth).toBeUndefined();
        // Same saved URL with a different protocol is also refused.
        const otherProtocol = (await client.invoke("model.catalog", {
          protocol: "anthropic-messages",
          baseURL: `http://127.0.0.1:${saved.port}/v1`,
        })) as unknown as CatalogResult;
        expect(otherProtocol.ok).toBe(false);
        expect(saved.seen.path).toBeUndefined();
        // Positive control: the saved URL (trailing slash ignored) receives the saved key.
        const ok = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${saved.port}/v1/`,
        })) as unknown as CatalogResult;
        expect(ok.ok).toBe(true);
        expect(ok.models).toEqual(["m-saved"]);
        expect(saved.seen.auth).toBe("Bearer sk-saved-secret");
        // A typed key may still go to any URL: it is the caller's own key.
        const typed = (await client.invoke("model.catalog", {
          protocol: "openai-compatible",
          baseURL: `http://127.0.0.1:${foreign.port}/v1`,
          apiKey: "sk-typed",
        })) as unknown as CatalogResult;
        expect(typed.ok).toBe(true);
        expect(foreign.seen.auth).toBe("Bearer sk-typed");
      } finally {
        await app.stop();
        await saved.stop();
        await foreign.stop();
      }
    });
  });

  test("an empty base URL is refused without any network call", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("model.catalog", { protocol: "openai-compatible", baseURL: "", apiKey: "sk" })) as unknown as CatalogResult;
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("base URL");
      } finally {
        await app.stop();
      }
    });
  });

  test("discovery starts no run and records no durable fact — it is read-only", async () => {
    const provider = await serveModels(() => ({ status: 200, body: { data: [{ id: "m1" }] } }));
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const beforeRuns = (await app.runtime.service.listRuns(LOCAL_OPERATOR, {})).length;
        await client.invoke("model.catalog", { protocol: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "sk" });
        await app.runtime.idle();
        const afterRuns = (await app.runtime.service.listRuns(LOCAL_OPERATOR, {})).length;
        expect(afterRuns).toBe(beforeRuns);
      } finally {
        await app.stop();
        await provider.stop();
      }
    });
  });
});
