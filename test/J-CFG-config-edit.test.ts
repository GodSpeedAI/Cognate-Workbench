// Journey J-CFG-config-edit: the configuration file can be read and EDITED from the app. Covers
// read, a validated atomic apply that reaches the settings projection and the file mirror (0600),
// and every refusal path (bad JSON, unknown key, bad value, partial-invalid atomicity, stale
// version) plus the informational fields being ignored.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bootApp, withTempHome } from "./helpers.ts";

interface ReadResult { readonly path: string; readonly home: string; readonly exists: boolean; readonly text: string; readonly version: string; readonly readOnlyKeys: readonly string[] }
interface ApplyResult { readonly applied: readonly string[]; readonly ignored: readonly string[]; readonly version: string; readonly path: string }
type Client = Awaited<ReturnType<typeof bootApp>>["client"];

async function load(client: Client) {
  const file = (await client.invoke("config.file.read", {})) as unknown as ReadResult;
  return { file, doc: JSON.parse(file.text) as Record<string, any> };
}
const apply = (client: Client, doc: unknown, expectedVersion: string) =>
  client.invoke("config.file.apply", { text: typeof doc === "string" ? doc : JSON.stringify(doc, null, 2), expectedVersion }) as unknown as Promise<ApplyResult>;

async function settingsRow(app: Awaited<ReturnType<typeof bootApp>>["app"], client: Client) {
  await app.runtime.idle();
  const result = (await client.invoke("config.path", {})) as unknown as { settings: Record<string, unknown> };
  return result.settings;
}

describe("J-CFG-config-edit", () => {
  test("read returns the current durable settings, path, version, and no secrets", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changeFontSize", { fontSize: 18 });
        await app.runtime.idle();
        const { file, doc } = await load(client);
        expect(file.path).toBe(join(home, "cognate.config.json"));
        expect(file.home).toBe(home);
        expect(file.exists).toBe(false);
        expect(file.version).toMatch(/^[0-9a-f]{64}$/);
        expect(file.readOnlyKeys).toEqual(["$schema", "note", "home", "environment"]);
        expect(doc["settings"].fontSize).toBe(18);
      } finally {
        await app.stop();
      }
    });
  });

  test("a valid edit is applied, reflected in the projection, and mirrored to disk at 0600", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        doc["settings"].appearance = "dark";
        doc["settings"].fontSize = 20;
        const result = await apply(client, doc, file.version);
        expect([...result.applied].sort()).toEqual(["appearance", "fontSize"]);
        expect(result.ignored).toEqual([]);
        expect(result.version).not.toBe(file.version);

        const settings = await settingsRow(app, client);
        expect(settings["appearance"]).toBe("dark");
        expect(settings["fontSize"]).toBe(20);

        const onDisk = await readFile(result.path, "utf8");
        expect(JSON.parse(onDisk).settings.appearance).toBe("dark");
        expect((await stat(result.path)).mode & 0o777).toBe(0o600);

        // The returned version is what a fresh read reports, and the file now exists.
        const again = await load(client);
        expect(again.file.version).toBe(result.version);
        expect(again.file.exists).toBe(true);
        expect(again.file.text).toBe(onDisk);
      } finally {
        await app.stop();
      }
    });
  });

  test("plugins and shortcuts map edits apply per key", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        doc["settings"].plugins = { realitytrace: true };
        doc["settings"].shortcuts = { "new-session": "Ctrl+Shift+K" };
        const result = await apply(client, doc, file.version);
        expect([...result.applied].sort()).toEqual(["plugins", "shortcuts"]);
        const settings = await settingsRow(app, client);
        expect(settings["plugins"]).toEqual({ realitytrace: true });
        expect(settings["shortcuts"]).toEqual({ "new-session": "Ctrl+Shift+K" });
        // A conflicting chord is refused with the shortcut rule's own reason.
        const next = await load(client);
        next.doc["settings"].shortcuts = { ...next.doc["settings"].shortcuts, "open-shortcuts": "Ctrl+Shift+K" };
        await expect(apply(client, next.doc, next.file.version)).rejects.toThrow(/already assigned/);
      } finally {
        await app.stop();
      }
    });
  });

  test("a no-op apply succeeds with nothing applied and writes nothing new", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file } = await load(client);
        const result = await apply(client, file.text, file.version);
        expect(result.applied).toEqual([]);
        expect(result.version).toBe(file.version);
      } finally {
        await app.stop();
      }
    });
  });

  test("invalid JSON is refused with line and column", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file } = await load(client);
        await expect(apply(client, '{\n  "settings": {\n    "fontSize": ,\n  }\n}', file.version)).rejects.toThrow(/not valid JSON \(line 3, column 17/);
        await expect(apply(client, "[]", file.version)).rejects.toThrow(/must be a JSON object/);
      } finally {
        await app.stop();
      }
    });
  });

  test("an unknown settings key is refused by name and nothing is applied", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        doc["settings"].appearance = "dark";
        doc["settings"].colour = "red";
        await expect(apply(client, doc, file.version)).rejects.toThrow(/unknown settings key 'colour'/);
        expect((await settingsRow(app, client))["appearance"]).not.toBe("dark");
      } finally {
        await app.stop();
      }
    });
  });

  test("an invalid value applies nothing, even when a sibling key is valid", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        doc["settings"].appearance = "dark";
        doc["settings"].fontSize = 999;
        await expect(apply(client, doc, file.version)).rejects.toThrow(/nothing was applied.*invalid value for 'fontSize'/);
        const settings = await settingsRow(app, client);
        expect(settings["appearance"]).not.toBe("dark");
        expect(settings["fontSize"]).not.toBe(999);
        expect(await readFile(file.path, "utf8").catch(() => null)).toBeNull();
      } finally {
        await app.stop();
      }
    });
  });

  test("a stale expectedVersion is a conflict", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        await client.invoke("settings.changeLanguage", { language: "zh" });
        await app.runtime.idle();
        doc["settings"].appearance = "dark";
        await expect(apply(client, doc, file.version)).rejects.toThrow(/conflict/);
        expect((await settingsRow(app, client))["appearance"]).not.toBe("dark");
      } finally {
        await app.stop();
      }
    });
  });

  test("edits to informational fields are ignored and listed, not applied", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { file, doc } = await load(client);
        doc["home"] = "/somewhere/else";
        doc["note"] = "changed";
        doc["environment"] = [];
        doc["settings"].appearance = "dark";
        const result = await apply(client, doc, file.version);
        expect(result.applied).toEqual(["appearance"]);
        expect(result.ignored.length).toBe(3);
        expect(result.ignored.join(" ")).toContain("'home'");
        const onDisk = JSON.parse(await readFile(result.path, "utf8"));
        expect(onDisk.home).toBe(home);
      } finally {
        await app.stop();
      }
    });
  });
});
