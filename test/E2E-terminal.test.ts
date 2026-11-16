// E2E J-TERMINAL-session (surface half): the docked terminal in a real browser. The header
// toggle opens the dock, the panel opens a session in the workspace's world automatically,
// keystrokes reach the PTY and the PTY's answer renders in xterm, maximize/restore re-lays the
// dock, and closing the dock detaches without ending the session — reopening replays the
// scrollback, which is how a person knows the process kept running.
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

describe("E2E terminal dock", () => {
  test("open, type, see the answer, maximize, detach and reattach with scrollback", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const browser = await launchChromium();
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        void workspaceId;
        await browser.page.goto(app.url);
        await browser.page.getByRole("button", { name: "Show terminal" }).click();
        const host = browser.page.locator(".term-host .xterm");
        await host.waitFor({ state: "visible", timeout: 15_000 });

        // The panel names what it is bound to: the workspace and its world.
        await browser.page.getByText("Local", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });

        // Wait for the shell to settle (the user's shell init prints banners and takes a
        // moment; a person waits for the prompt before typing). Idle = the rows text has not
        // changed for 1.5 s and is non-empty.
        const rowsText = (): Promise<string> => browser.page.locator(".xterm-rows").innerText().catch(() => "");
        await browser.page.waitForFunction(
          async () => true,
        ).catch(() => {});
        let previous = "";
        let stableFor = 0;
        for (let waited = 0; waited < 30_000; waited += 250) {
          const current = await rowsText();
          if (current.length > 0 && current === previous) {
            stableFor += 250;
            if (stableFor >= 1500) break;
          } else {
            stableFor = 0;
            previous = current;
          }
          await Bun.sleep(250);
        }
        await browser.page.locator(".term-host .xterm").click();
        // The result (E2E_TERM_9_23) differs from the echoed command text, so matching it
        // proves the command actually executed, not merely that it was echoed.
        await browser.page.keyboard.type("echo E2E_TERM_9_$((20+3))");
        await browser.page.keyboard.press("Enter");
        try {
          await browser.page.locator(".xterm-rows", { hasText: "E2E_TERM_9_23" }).first().waitFor({ state: "visible", timeout: 20_000 });
        } catch (error) {
          const rows = await browser.page.locator(".xterm-rows").allInnerTexts().catch(() => ["<none>"]);
          throw new Error(`result never rendered; rows=${JSON.stringify(rows).slice(0, 500)}; source=${(error as Error).message.slice(0, 120)}`);
        }

        // Maximize re-lays the dock as the whole center; restore brings the conversation back.
        await browser.page.getByRole("button", { name: "Maximize" }).click();
        await browser.page.locator(".surface-dock.maximized").waitFor({ state: "visible", timeout: 5000 });
        await browser.page.getByRole("button", { name: "Restore" }).click();
        await browser.page.locator(".surface-dock:not(.maximized)").waitFor({ state: "visible", timeout: 5000 });

        // Detach: closing the dock keeps the session; reopening replays the scrollback.
        await browser.page.getByRole("button", { name: "Close terminal panel" }).click();
        await browser.page.locator(".surface-dock").waitFor({ state: "detached", timeout: 5000 });
        await browser.page.getByRole("button", { name: "Show terminal" }).click();
        try {
          await browser.page.locator(".xterm-rows", { hasText: "E2E_TERM_9_23" }).first().waitFor({ state: "visible", timeout: 20_000 });
        } catch (error) {
          const rows = await browser.page.locator(".xterm-rows").allInnerTexts().catch(() => ["<none>"]);
          throw new Error(`result never rendered; rows=${JSON.stringify(rows).slice(0, 500)}; source=${(error as Error).message.slice(0, 120)}`);
        }
      } finally {
        await browser.close();
        await app.stop();
      }
    });
  }, 60_000);
});
