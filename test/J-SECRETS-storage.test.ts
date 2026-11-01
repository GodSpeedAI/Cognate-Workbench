// Journey J-SECRETS-storage: the app reports where API keys are stored (secrets.backend.describe,
// operator only) and secret values never reach events, projections, the configuration export or the
// capability result. The suite preload selects the owner-only file; backend selection and migration
// against native stores are covered with fakes in secrets-store.test.ts.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

const KEY = "sk-journey-secret-storage-123";
const events = async (app: AppServer) => { const out: unknown[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ t: e.eventType, p: e.payload }); return out; };

describe("J-SECRETS-storage", () => {
  test("describe reports the backend, label, reason and location; values never leak", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const before = (await client.invoke("secrets.backend.describe", {})) as unknown as Record<string, unknown>;
        expect(before.backend).toBe("file");
        expect(before.label).toBe("Protected file (owner-only permissions)");
        expect(before.reason).toBe("COGNATE_SECRET_STORE=file");
        expect(before.location).toBe(join(home, "secrets.json"));

        await client.invoke("secret.put", { key: "model-provider:journey", value: KEY });
        await app.runtime.idle();
        expect(await readFile(join(home, "secrets.json"), "utf8")).toContain(KEY); // the file backend holds it

        const after = JSON.stringify(await client.invoke("secrets.backend.describe", {}));
        const exported = JSON.stringify(await client.invoke("config.path", {}));
        const log = JSON.stringify(await events(app));
        const rows = JSON.stringify((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "model-config" })).rows);
        for (const text of [after, exported, log, rows]) expect(text).not.toContain(KEY);
      } finally {
        await app.stop();
      }
    });
  });

  test("describe is refused for a caller that is not the operator", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const { createClient } = await import("@godspeedai/cognate-client");
        const { connectTransport, devToken } = await import("@godspeedai/cognate-protocol-connect-bun");
        const { createRemoteRuntimeService } = await import("@godspeedai/cognate-protocol-connect");
        const stranger = { actor: { id: "stranger", kind: "user" as const }, tenant: "local" };
        const client = createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(stranger)), caller: stranger });
        await expect(client.invoke("secrets.backend.describe", {})).rejects.toThrow();
      } finally {
        await app.stop();
      }
    });
  });
});
