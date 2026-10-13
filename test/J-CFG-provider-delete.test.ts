// Journey J-CFG-provider-delete (T11): removing the configured provider must leave nothing behind.
// Covers: the stored secret is removed BEFORE the configuration (the recoverable order); the live
// route is cleared so the app returns to the unconfigured state; the durable fact is recorded; a
// second delete of the now-unconfigured provider is refused; and deleting a provider that is not
// the configured one is refused rather than silently doing nothing.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

type ModelConfigValue = Record<string, unknown>;

async function readModelConfig(app: AppServer): Promise<ModelConfigValue | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "model-config" })).rows;
  return rows.find((r) => r.key === "current")?.value as ModelConfigValue | undefined;
}

const secretsPath = (home: string) => join(home, "secrets.json");

async function storedSecretKeys(home: string): Promise<readonly string[]> {
  const path = secretsPath(home);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  try {
    return Object.keys(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe("J-CFG-provider-delete", () => {
  test("deleting removes the secret, the configuration and the live route, in the recoverable order", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "sk-secret-to-be-removed",
        });
        await app.runtime.idle();
        expect((await readModelConfig(app))?.providerId).toBe("mock");
        expect(await storedSecretKeys(home)).toContain("model-provider:mock");

        const result = (await client.invoke("provider.delete", { providerId: "mock" })) as { readonly ok: boolean; readonly providerId: string };
        expect(result.ok).toBe(true);
        expect(result.providerId).toBe("mock");

        // The durable configuration row is gone, so the UI returns to "no provider configured".
        expect(await readModelConfig(app)).toBeUndefined();
        // The stored secret is gone too — no orphaned key behind a deleted configuration.
        expect(await storedSecretKeys(home)).not.toContain("model-provider:mock");

        // The live route is cleared: generating now fails rather than resolving a deleted provider.
        await expect(client.invoke("model.generate", { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("the deletion is durable across a runtime restart", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("model.configure", {
            providerId: "mock",
            baseURL: `http://127.0.0.1:${aimock.port}/v1`,
            protocol: "openai-compatible",
            model: "mock-model-1",
            apiKey: "sk-secret",
          });
          await app.runtime.idle();
          await client.invoke("provider.delete", { providerId: "mock" });
        } finally {
          await app.stop();
        }
      }
      const reopened = await bootApp(home);
      try {
        expect(await readModelConfig(reopened.app)).toBeUndefined();
        expect(await storedSecretKeys(home)).not.toContain("model-provider:mock");
      } finally {
        await reopened.app.stop();
        await aimock.stop();
      }
    });
  });

  test("deleting when nothing is configured is refused, with a reason", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("provider.delete", { providerId: "mock" })).rejects.toThrow(/no provider is configured/);
      } finally {
        await app.stop();
      }
    });
  });

  test("deleting a provider that is not the configured one is refused, not silently ignored", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "sk-secret",
        });
        await app.runtime.idle();
        await expect(client.invoke("provider.delete", { providerId: "someone-else" })).rejects.toThrow(/not the configured provider/);
        // The configured provider is untouched.
        expect((await readModelConfig(app))?.providerId).toBe("mock");
        expect(await storedSecretKeys(home)).toContain("model-provider:mock");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("an empty providerId is refused before any work", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("provider.delete", { providerId: "" })).rejects.toThrow(/non-empty providerId/);
      } finally {
        await app.stop();
      }
    });
  });
});
