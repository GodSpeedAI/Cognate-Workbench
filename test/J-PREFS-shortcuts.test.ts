// Journey J-PREFS-shortcuts (T11): keyboard shortcuts are durable operator preferences, edited via
// `settings.changeShortcuts`. Covers: a binding survives a full runtime restart; a reserved browser
// chord and a cross-action conflict are both refused; unbinding is expressible and reversible; and
// "restore all defaults" writes an explicit reset rather than deleting state.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";
import { effectiveChord, isDefault, restoreDefaults } from "../src/shortcuts.ts";

type SettingsValue = Record<string, unknown>;

async function readShortcuts(app: AppServer): Promise<Record<string, unknown> | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
  return (rows.find((r) => r.key === "current")?.value as SettingsValue | undefined)?.["shortcuts"] as Record<string, unknown> | undefined;
}

describe("J-PREFS-shortcuts", () => {
  test("a binding survives a full runtime restart against the same store", async () => {
    await withTempHome(async (home) => {
      {
        const { app, client } = await bootApp(home);
        try {
          const result = (await client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "Ctrl+Shift+K" } })) as { readonly ok?: boolean };
          expect(result).toBeDefined();
          await app.runtime.idle();
          const shortcuts = await readShortcuts(app);
          expect(shortcuts?.["new-session"]).toBe("Ctrl+Shift+K");
          // An unmentioned action is untouched.
          expect(shortcuts?.["open-shortcuts"]).toBeUndefined();
        } finally {
          await app.stop();
        }
      }
      const reopened = await bootApp(home);
      try {
        const shortcuts = await readShortcuts(reopened.app);
        expect(shortcuts?.["new-session"]).toBe("Ctrl+Shift+K");
      } finally {
        await reopened.app.stop();
      }
    });
  });

  test("a reserved browser chord is refused by name", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "Ctrl+W" } })).rejects.toThrow(/reserved by the browser/);
        // Nothing was recorded.
        expect(await readShortcuts(app)).toBeUndefined();
      } finally {
        await app.stop();
      }
    });
  });

  test("a cross-action conflict is refused and names the clashing action", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changeShortcuts", { shortcuts: { "open-shortcuts": "Ctrl+Shift+K" } });
        await app.runtime.idle();
        await expect(client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "Ctrl+Shift+K" } })).rejects.toThrow(/already assigned/);
      } finally {
        await app.stop();
      }
    });
  });

  test("a modifier-less chord is refused so it can never fire while typing", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "K" } })).rejects.toThrow(/never fires while you type/);
      } finally {
        await app.stop();
      }
    });
  });

  test("an unknown action id is refused structurally", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("settings.changeShortcuts", { shortcuts: { "not-an-action": "Ctrl+K" } })).rejects.toThrow();
      } finally {
        await app.stop();
      }
    });
  });

  test("unbinding is expressible and frees the chord for another action", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changeShortcuts", { shortcuts: { "open-shortcuts": null } });
        await app.runtime.idle();
        const shortcuts = await readShortcuts(app);
        expect(shortcuts?.["open-shortcuts"]).toBeNull();
        expect(effectiveChord("open-shortcuts", shortcuts as never)).toBeUndefined();

        // The freed chord is now bindable by a different action.
        await client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "Ctrl+/" } });
        expect((await readShortcuts(app))?.["new-session"]).toBe("Ctrl+/");
      } finally {
        await app.stop();
      }
    });
  });

  test("restore all defaults writes an explicit reset the projection records", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changeShortcuts", { shortcuts: { "new-session": "Ctrl+Shift+K" } });
        await app.runtime.idle();
        await client.invoke("settings.changeShortcuts", { shortcuts: restoreDefaults() });
        await app.runtime.idle();
        const shortcuts = (await readShortcuts(app)) ?? {};
        expect(isDefault(shortcuts as never)).toBe(true);
        expect(shortcuts["open-shortcuts"]).toBe("Ctrl+/");
        expect(shortcuts["new-session"]).toBeNull();
      } finally {
        await app.stop();
      }
    });
  });
});
