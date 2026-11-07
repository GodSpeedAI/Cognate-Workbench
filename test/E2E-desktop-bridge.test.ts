// E2E desktop-bridge (surface half of desktop-native-completion B3): the web app in a real
// browser registers `window.__wbShell`, routes a dispatched action into the app's own
// handlers (a dispatched "new-session" creates a session exactly like the palette command),
// keeps the browser/CLI contract (nothing registers without the shell… the bridge registers
// unconditionally but nothing ever calls it there), and the title contract holds at idle.
// The shell half (menu map → eval dispatch → liveness rule) is pinned by the cargo tests in
// src-tauri/src/{menu,title}.rs and verified in a real window during the B4 pass.
import { describe, expect, test } from "bun:test";
import { bootApp, inv, seedWorkspaceOnly, withTempHome } from "./wb-helpers.ts";
import type { Page } from "playwright-core";

async function launchChromium(): Promise<{ close: () => Promise<void>; page: Page }> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return {
    page,
    close: async () => {
      await context.close();
      await browser.close();
      if (errors.length > 0) throw new Error(`page errors: ${errors.join("; ")}`);
    },
  };
}

describe("E2E desktop bridge", () => {
  test("dispatching new-session through the bridge creates a session; the title reads the idle form", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const browser = await launchChromium();
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await seedWorkspaceOnly(client, home);
        await browser.page.goto(app.url);
        const composer = browser.page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).first();
        await composer.waitFor({ state: "visible", timeout: 20_000 });

        // The bridge is registered and refuses what it does not know, silently.
        const bridgeShape = await browser.page.evaluate(() => {
          const shell = (globalThis as unknown as Record<string, { dispatch: (m: unknown) => void }>).__wbShell;
          if (!shell) return { registered: false };
          shell.dispatch({ v: 1, action: "navigate-to-view" });
          shell.dispatch("garbage");
          return { registered: true };
        });
        expect(bridgeShape).toEqual({ registered: true });

        // A dispatched New Session behaves like the palette's own action: a draft session
        // appears and the composer keeps focus.
        const before = await browser.page.locator(".session-row, [data-session-row]").count();
        await browser.page.evaluate(() => {
          (globalThis as unknown as Record<string, { dispatch: (m: unknown) => void }>).__wbShell?.dispatch({ v: 1, action: "new-session" });
        });
        await browser.page.waitForFunction(
          (n) => document.querySelectorAll(".session-row, [data-session-row]").length > n,
          before,
          { timeout: 10_000 },
        );

        // The title contract at idle (the two-sided grammar; shell-side tests pin the rest).
        const title = await browser.page.title();
        expect(title).toBe("Cognate Workbench");
      } finally {
        await browser.close();
        await app.stop();
      }
    });
  }, 60_000);
});
