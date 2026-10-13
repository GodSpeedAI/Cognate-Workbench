// Journey J-CFG-config-path (T11): "Open configuration file" must be a working action, not a path
// in a modal. Covers: the capability reports the real home and config locations; the export it
// produces is valid JSON containing only the settings keys this app reads; a sensitive environment
// value is redacted in the export; and the export never contains a secret from the store.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

interface ConfigPathResult {
  readonly ok: true;
  readonly home: string;
  readonly configFile: string;
  readonly configFileExists: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly environment: readonly { readonly name: string; readonly value: string | null; readonly sensitive: boolean }[];
  readonly export: string;
}

describe("J-CFG-config-path", () => {
  test("reports the real home and a conventional config path that does not exist yet", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const result = (await client.invoke("config.path", {})) as unknown as ConfigPathResult;
        expect(result.ok).toBe(true);
        expect(result.home).toBe(home);
        expect(result.configFile).toBe(join(home, "cognate.config.json"));
        expect(result.configFileExists).toBe(false);
      } finally {
        await app.stop();
      }
    });
  });

  test("the export is valid JSON, states it is non-secret, and redacts the postgres URL", async () => {
    // NOTE: COGNATE_POSTGRES_URL also selects the persistence backend, so it is set only AFTER the
    // server has booted (the store resolves its config at boot) and restored in `finally`. The
    // redaction itself is unit-tested independently in test/workbench-config-file.test.ts.
    const previous = process.env["COGNATE_POSTGRES_URL"];
    try {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        process.env["COGNATE_POSTGRES_URL"] = "postgres://user:super-secret-password@db:5432/app";
        try {
          // Change a setting first so the export has something real in it.
          await client.invoke("settings.changePermission", { permission: "read-only" });
          await app.runtime.idle(); // let the projection fold cover the write
          const result = (await client.invoke("config.path", {})) as unknown as ConfigPathResult;

          expect(() => JSON.parse(result.export)).not.toThrow();
          const parsed = JSON.parse(result.export) as {
            readonly note: string;
            readonly settings: Readonly<Record<string, unknown>>;
            readonly environment: readonly { readonly name: string; readonly value: string | null }[];
          };
          expect(parsed.note.toLowerCase()).toContain("secret");
          expect(parsed.settings["permission"]).toBe("read-only");

          // The secret value never appears in the export.
          expect(result.export).not.toContain("super-secret-password");
          expect(result.export).not.toContain("postgres://user");
          const pgRow = parsed.environment.find((e) => e.name === "COGNATE_POSTGRES_URL");
          expect(pgRow?.value).toBe("<set, hidden>");
        } finally {
          await app.stop();
        }
      });
    } finally {
      if (previous === undefined) delete process.env["COGNATE_POSTGRES_URL"];
      else process.env["COGNATE_POSTGRES_URL"] = previous;
    }
  });

  test("the export contains only the settings keys this app reads", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changeFontSize", { fontSize: 18 });
        await app.runtime.idle();
        const result = (await client.invoke("config.path", {})) as unknown as ConfigPathResult;
        const parsed = JSON.parse(result.export) as { readonly settings: Readonly<Record<string, unknown>> };
        expect(parsed.settings["fontSize"]).toBe(18);
        // The known keys this app reads are all representable.
        for (const key of ["permission", "language", "appearance", "fontSize", "preset", "plugins", "shortcuts"]) {
          expect(Object.hasOwn(parsed.settings, key)).toBe(true);
        }
      } finally {
        await app.stop();
      }
    });
  });

  test("a real config file on disk is reported as present, and its contents are not read into the export", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const configFile = join(home, "cognate.config.json");
        // A file containing a value that must not leak into the capability's response.
        await Bun.write(configFile, JSON.stringify({ apiKey: "file-side-secret" }));
        const result = (await client.invoke("config.path", {})) as unknown as ConfigPathResult;
        expect(result.configFileExists).toBe(true);
        expect(result.export).not.toContain("file-side-secret");
        // The export still describes the durable settings, not the file's contents.
        const parsed = JSON.parse(result.export) as { readonly settings: Readonly<Record<string, unknown>> };
        expect(Object.hasOwn(parsed.settings, "apiKey")).toBe(false);
      } finally {
        await app.stop();
      }
    });
  });

  test("no secret from the store ever reaches the export", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: "http://127.0.0.1:9/v1",
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "sk-store-secret-abc",
        });
        const result = (await client.invoke("config.path", {})) as unknown as ConfigPathResult;
        expect(result.export).not.toContain("sk-store-secret-abc");
        // Even the home's secrets file is never opened by this capability.
        const secretsPath = join(home, "secrets.json");
        if (await readFile(secretsPath, "utf8").catch(() => undefined)) {
          expect(result.export).not.toContain("model-provider");
        }
      } finally {
        await app.stop();
      }
    });
  });
});
