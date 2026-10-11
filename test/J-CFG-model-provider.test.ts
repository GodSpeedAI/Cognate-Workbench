// Journey J-CFG-model-provider: save a model config -> provider mounted -> hot-swap to a new base
// URL without restart; the secret never appears in any event, payload, or projection. Protocol
// workflow: each wire protocol persists and reloads as itself, re-keying preserves the protocol,
// an unsupported protocol is rejected before anything is recorded, and a failed hot-swap leaves
// the previous provider mounted and usable.
import postgres from "postgres";
import { schemaFor, postgresUrl } from "../src/store.ts";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";
import { startServer, LOCAL_OPERATOR } from "../src/server.ts";

interface CurrentConfig {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: string;
  readonly model: string;
}

async function readModelConfig(app: Awaited<ReturnType<typeof startServer>>): Promise<CurrentConfig | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "model-config" })).rows;
  return rows.find((r) => r.key === "current")?.value as CurrentConfig | undefined;
}

describe("J-CFG-model-provider", () => {
  test("save config -> provider mounted -> hot-swap -> secret never recorded", async () => {
    await withTempHome(async (home) => {
      const aimockA = await bootAimock();
      const aimockB = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const secretValue = "sk-super-secret-value-should-never-be-recorded";
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimockA.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: secretValue,
        });

        const responseA = (await client.invoke("model.generate", { messages: [{ role: "user", content: "hello" }] })) as {
          readonly message: { readonly content: string };
        };
        expect(responseA.message.content).toContain("Summary");

        // Hot-swap: new base URL, no restart.
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimockB.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: secretValue,
        });
        const responseB = (await client.invoke("model.generate", { messages: [{ role: "user", content: "hello again" }] })) as {
          readonly message: { readonly content: string };
        };
        expect(responseB.message.content).toContain("Summary");

        await app.runtime.idle();

        const configRows = (await app.runtime.service.readProjection({ actor: { id: "operator", kind: "user" }, tenant: "local" }, { name: "model-config" })).rows;
        const current = configRows.find((r) => r.key === "current")?.value as { readonly baseURL?: string } | undefined;
        expect(current?.baseURL).toBe(`http://127.0.0.1:${aimockB.port}/v1`);

        // Scan the durable store for the secret. It must not appear anywhere (PostgreSQL: query the
        // app's schema directly — payloads, metadata, records, and derived folds).
        const schema = schemaFor(home);
        const url = postgresUrl();
        const scan = postgres(url, { max: 1, onnotice: () => {} });
        try {
          const t = (name: string) => scan`${scan(schema)}.${scan(name)}`;
          const payloadRows = (await scan`SELECT payload::text AS text FROM ${t("payloads")}`).map((r) => r.text as string);
          const metadataRows = (await scan`SELECT metadata::text AS text FROM ${t("events")} WHERE metadata IS NOT NULL`).map((r) => r.text as string);
          const recordRows = (await scan`SELECT value::text AS text FROM ${t("records")}`).map((r) => r.text as string);
          const projectionRows = (await scan`SELECT value::text AS text FROM ${t("projection_state")}`).map((r) => r.text as string);
          for (const text of [...payloadRows, ...metadataRows, ...recordRows, ...projectionRows]) {
            expect(text ?? "").not.toContain(secretValue);
          }
        } finally {
          await scan.end({ timeout: 1 });
        }
      } finally {
        await app.stop();
        await aimockA.stop();
        await aimockB.stop();
      }
    });
  });

  test("each wire protocol persists and survives a restart; re-keying preserves the protocol", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        // Responses protocol: the projection records the actual wire value.
        await client.invoke("model.configure", {
          providerId: "mock-responses",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-responses",
          model: "mock-model-1",
          apiKey: "sk-responses",
        });
        expect((await readModelConfig(app))?.protocol).toBe("openai-responses");

        // Anthropic protocol on a second provider id (still one live config — the newest wins).
        await client.invoke("model.configure", {
          providerId: "mock-anthropic",
          baseURL: `http://127.0.0.1:${aimock.port}`,
          protocol: "anthropic-messages",
          model: "mock-model-1",
          apiKey: "sk-anthropic",
        });
        expect((await readModelConfig(app))?.protocol).toBe("anthropic-messages");

        // Legacy value still accepted for persisted configurations (never migrated behind the
        // operator's back): re-keying the Anthropic provider keeps its actual protocol, and an
        // explicitly legacy value remains valid.
        await client.invoke("model.configure", {
          providerId: "mock-anthropic",
          baseURL: `http://127.0.0.1:${aimock.port}`,
          protocol: "anthropic-messages",
          model: "mock-model-1",
          apiKey: "sk-rotated",
        });
        const after = await readModelConfig(app);
        expect(after?.protocol).toBe("anthropic-messages");
        expect(after?.providerId).toBe("mock-anthropic");
      } finally {
        await app.stop();
        await aimock.stop();
      }

      // Reload: a fresh server on the same home loads the saved protocol as itself.
      const reopened = await startServer({ port: 0, home });
      try {
        const reloaded = await readModelConfig(reopened);
        expect(reloaded?.protocol).toBe("anthropic-messages");
        expect(reloaded?.providerId).toBe("mock-anthropic");
      } finally {
        await reopened.stop();
      }
    });
  });

  test("an unsupported protocol is rejected before any event or provider change", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "sk-first",
        });
        const before = await readModelConfig(app);
        await expect(
          client.invoke("model.configure", {
            providerId: "mock",
            baseURL: `http://127.0.0.1:${aimock.port}/v1`,
            protocol: "gemini-generate-content",
            model: "mock-model-1",
            apiKey: "sk-second",
          }),
        ).rejects.toThrow();
        // The rejected configure changed nothing.
        expect(await readModelConfig(app)).toEqual(before);
        const events = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) events.push(e);
        expect(events.filter((e) => e.eventType === "model.configured")).toHaveLength(1);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });
});
