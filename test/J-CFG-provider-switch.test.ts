// Journey J-CFG-provider-switch (and the key-reuse / keyless / delete variants of
// J-CFG-model-provider and J-CFG-provider-delete): several stored providers, one active route,
// switching without re-entering a key. Real app boot; aimock proves which endpoint answered a run,
// a recording fake proves which stored key reached the wire.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { aimockChatRequests, bootAimock, bootApp, withTempHome } from "./helpers.ts";
import { fakeProvider } from "./providerFake.ts";

interface Row {
  readonly providerId: string; readonly displayName: string; readonly protocol: string; readonly baseURL: string;
  readonly model: string; readonly hasKey: boolean; readonly isCurrent: boolean; readonly keyless: boolean;
}
type Client = Awaited<ReturnType<typeof bootApp>>["client"];

const listProviders = async (client: Client) => ((await client.invoke("provider.list", {})) as unknown as { readonly providers: readonly Row[] }).providers;
const generate = (client: Client, text: string) => client.invoke("model.generate", { messages: [{ role: "user", content: text }] });
const projection = async (app: AppServer, name: string) => { await app.runtime.idle(); return (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name })).rows; };

describe("J-CFG-provider-switch", () => {
  test("two stored providers: list shows both, activating one routes the next run to it, no key leaves the server", async () => {
    await withTempHome(async (home) => {
      const a = await bootAimock();
      const b = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const keyA = "sk-secret-AAAA", keyB = "sk-secret-BBBB";
        await client.invoke("model.configure", { providerId: "prov-a", displayName: "Provider A", baseURL: `http://127.0.0.1:${a.port}/v1`, protocol: "openai-compatible", model: "model-a1", apiKey: keyA });
        await client.invoke("model.configure", { providerId: "prov-b", displayName: "Provider B", baseURL: `http://127.0.0.1:${b.port}/v1`, protocol: "openai-compatible", model: "model-b1", apiKey: keyB });
        await app.runtime.idle();

        let rows = await listProviders(client);
        expect(rows.map((r) => r.providerId).sort()).toEqual(["prov-a", "prov-b"]);
        expect(rows.find((r) => r.providerId === "prov-b")).toMatchObject({ displayName: "Provider B", protocol: "openai-compatible", model: "model-b1", hasKey: true, isCurrent: true });
        expect(rows.find((r) => r.providerId === "prov-a")).toMatchObject({ displayName: "Provider A", hasKey: true, isCurrent: false });

        await generate(client, "[[scenario:aim-plain]]");
        expect((await aimockChatRequests(b.port)).length).toBe(1);
        expect((await aimockChatRequests(a.port)).length).toBe(0);

        const activated = (await client.invoke("provider.activate", { providerId: "prov-a" })) as { readonly ok: boolean; readonly providerId: string; readonly model: string };
        expect(activated).toEqual({ ok: true, providerId: "prov-a", model: "model-a1" });
        await generate(client, "[[scenario:aim-plain]]");
        const aReqs = await aimockChatRequests(a.port);
        expect(aReqs.length).toBe(1);
        expect((aReqs[0]!.body as { model?: string }).model).toBe("model-a1");
        expect((await aimockChatRequests(b.port)).length).toBe(1);

        rows = await listProviders(client);
        expect(rows.find((r) => r.providerId === "prov-a")?.isCurrent).toBe(true);
        expect(rows.find((r) => r.providerId === "prov-b")?.isCurrent).toBe(false);
        // The durable current route followed the activation.
        const current = (await projection(app, "model-config")).find((r) => r.key === "current")?.value as { providerId: string; model: string };
        expect(current).toMatchObject({ providerId: "prov-a", model: "model-a1" });

        // Activation can also change the model, without any key.
        await client.invoke("provider.activate", { providerId: "prov-a", model: "model-a2" });
        await generate(client, "[[scenario:aim-plain]]");
        expect(((await aimockChatRequests(a.port)).at(-1)!.body as { model?: string }).model).toBe("model-a2");

        // No secret in the list, the projections, or the activation result.
        const everything = JSON.stringify([rows, await projection(app, "model-config"), await projection(app, "provider-routes"), activated]);
        expect(everything).not.toContain(keyA);
        expect(everything).not.toContain(keyB);
      } finally {
        await app.stop(); await a.stop(); await b.stop();
      }
    });
  });

  test("activation is durable across a restart and refuses unknown or keyless-less providers", async () => {
    await withTempHome(async (home) => {
      const a = await bootAimock();
      const b = await bootAimock();
      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("model.configure", { providerId: "prov-a", baseURL: `http://127.0.0.1:${a.port}/v1`, protocol: "openai-compatible", model: "m1", apiKey: "k1" });
          await client.invoke("model.configure", { providerId: "prov-b", baseURL: `http://127.0.0.1:${b.port}/v1`, protocol: "openai-compatible", model: "m2", apiKey: "k2" });
          await client.invoke("provider.activate", { providerId: "prov-a" });
          await expect(client.invoke("provider.activate", { providerId: "nope" })).rejects.toThrow(/not a stored provider/);
          await expect(client.invoke("provider.activate", { providerId: "" })).rejects.toThrow(/non-empty providerId/);
          // A remote provider saved with no key cannot be activated into a route that would fail every run.
          await client.invoke("model.configure", { providerId: "prov-c", baseURL: "https://remote.example.invalid/v1", protocol: "openai-compatible", model: "m3" });
          await client.invoke("provider.activate", { providerId: "prov-a" });
          await expect(client.invoke("provider.activate", { providerId: "prov-c" })).rejects.toThrow(/no API key is stored/);
          expect((await listProviders(client)).find((r) => r.providerId === "prov-a")?.isCurrent).toBe(true);
        } finally { await app.stop(); }
      }
      {
        const { app, client } = await bootApp(home);
        try {
          const rows = await listProviders(client);
          expect(rows.find((r) => r.isCurrent)?.providerId).toBe("prov-a");
          expect(rows.map((r) => r.providerId).sort()).toEqual(["prov-a", "prov-b", "prov-c"]);
          expect(rows.find((r) => r.providerId === "prov-c")?.hasKey).toBe(false);
          await generate(client, "[[scenario:aim-plain]]");
          expect((await aimockChatRequests(a.port)).length).toBe(1);
        } finally { await app.stop(); await a.stop(); await b.stop(); }
      }
    });
  });

  test("switching model with the key left blank keeps the stored key on the wire; a typed key replaces it", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider({ acceptKey: "sk-first-KEY" });
      const { app, client } = await bootApp(home);
      const base = { providerId: "fake", baseURL: fake.baseURL, protocol: "openai-compatible" as const };
      try {
        await client.invoke("model.configure", { ...base, model: "model-one", apiKey: "sk-first-KEY" });
        await generate(client, "hi");
        // Same provider, other model, key omitted -> still authenticates with the stored key.
        await client.invoke("model.configure", { ...base, model: "model-two" });
        await generate(client, "hi");
        // Blank string behaves like omitted.
        await client.invoke("model.configure", { ...base, model: "model-three", apiKey: "" });
        await generate(client, "hi");
        // Count model calls only: once in a full-suite run a body-less POST reached this ephemeral port
        // before the first call (not from this app's model path; see DEBT "stray POST").
        const posts = fake.seen.filter((r) => r.method === "POST" && r.model !== undefined);
        expect(posts.map((r) => r.model)).toEqual(["model-one", "model-two", "model-three"]);
        expect(posts.every((r) => r.authorization === "Bearer sk-first-KEY")).toBe(true);
        expect((await listProviders(client))[0]?.hasKey).toBe(true);

        // A non-empty key replaces the stored one; the old key no longer authenticates.
        await client.invoke("model.configure", { ...base, model: "model-three", apiKey: "sk-second-KEY" });
        await expect(generate(client, "hi")).rejects.toThrow();
        expect(fake.seen.at(-1)?.authorization).toBe("Bearer sk-second-KEY");
        const stored = JSON.parse(await readFile(join(home, "secrets.json"), "utf8").catch(() => "{}")) as Record<string, string>;
        if (stored["model-provider:fake"] !== undefined) expect(stored["model-provider:fake"]).toBe("sk-second-KEY");
      } finally { await app.stop(); await fake.stop(); }
    });
  });

  test("a local server runs with no key: no Authorization header, on a route marked local or auth none", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider(); // accepts only credential-less requests
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", { providerId: "local-1", baseURL: fake.baseURL, protocol: "openai-compatible", model: "m" });
        await generate(client, "hi");
        await client.invoke("model.configure", { providerId: "local-2", baseURL: fake.baseURL, protocol: "openai-compatible", model: "m", auth: "none" });
        await generate(client, "hi");
        const posts = fake.seen.filter((r) => r.method === "POST");
        expect(posts.length).toBe(2);
        expect(posts.every((r) => r.authorization === undefined && r.xApiKey === undefined)).toBe(true);
        const rows = await listProviders(client);
        expect(rows.every((r) => r.keyless && !r.hasKey)).toBe(true);
      } finally { await app.stop(); await fake.stop(); }
    });
  });

  test("Azure OpenAI: api-key header and api-version query, no Bearer; refused on other protocols", async () => {
    await withTempHome(async (home) => {
      const fake = fakeProvider({ acceptKey: "azure-KEY" });
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("model.configure", { providerId: "az", baseURL: fake.baseURL, protocol: "openai-compatible", model: "gpt", apiKey: "azure-KEY", auth: "api-key" })).rejects.toThrow(/apiVersion/);
        await expect(client.invoke("model.configure", { providerId: "az", baseURL: fake.baseURL, protocol: "anthropic-messages", model: "gpt", apiKey: "azure-KEY", auth: "api-key", apiVersion: "2024-10-21" })).rejects.toThrow(/chat completions/);
        await client.invoke("model.configure", { providerId: "az", baseURL: fake.baseURL, protocol: "openai-compatible", model: "gpt", apiKey: "azure-KEY", auth: "api-key", apiVersion: "2024-10-21" });
        await generate(client, "hi");
        const post = fake.seen.find((r) => r.method === "POST")!;
        expect(post.apiKey).toBe("azure-KEY");
        expect(post.authorization).toBeUndefined();
        expect(post.path).toContain("api-version=2024-10-21");
      } finally { await app.stop(); await fake.stop(); }
    });
  });

  test("J-CFG-provider-delete: deleting a non-active stored provider removes only its secret and route", async () => {
    await withTempHome(async (home) => {
      const a = await bootAimock();
      const b = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", { providerId: "prov-a", baseURL: `http://127.0.0.1:${a.port}/v1`, protocol: "openai-compatible", model: "m1", apiKey: "k1" });
        await client.invoke("model.configure", { providerId: "prov-b", baseURL: `http://127.0.0.1:${b.port}/v1`, protocol: "openai-compatible", model: "m2", apiKey: "k2" });
        // prov-b is active; delete prov-a.
        expect(await client.invoke("provider.delete", { providerId: "prov-a" })).toEqual({ ok: true, providerId: "prov-a" });
        await app.runtime.idle();
        const rows = await listProviders(client);
        expect(rows.map((r) => r.providerId)).toEqual(["prov-b"]);
        expect(rows[0]!.isCurrent).toBe(true);
        expect((await projection(app, "model-config")).find((r) => r.key === "current")?.value).toMatchObject({ providerId: "prov-b" });
        // The active route still answers.
        await generate(client, "[[scenario:aim-plain]]");
        expect((await aimockChatRequests(b.port)).length).toBe(1);
        const secrets = JSON.parse(await readFile(join(home, "secrets.json"), "utf8").catch(() => "{}")) as Record<string, string>;
        expect(Object.keys(secrets)).not.toContain("model-provider:prov-a");
        // Deleting the active one clears the route but leaves nothing else stored behind it.
        await client.invoke("provider.delete", { providerId: "prov-b" });
        await expect(generate(client, "hi")).rejects.toThrow();
        expect(await listProviders(client)).toEqual([]);
      } finally { await app.stop(); await a.stop(); await b.stop(); }
    });
  });
});
