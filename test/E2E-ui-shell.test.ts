// T1a shell journeys in a real browser: global shortcuts, the command palette, the Settings page
// (tablist keyboard model, close on the right, Esc) and archive-with-Undo toast.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { bootApp, inv, waitUntil, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

describe("E2E ui shell", () => {
  test("palette, shortcuts, settings page and archive toast", async () => {
    await withTempHome(async (home) => {
      const repo = join(home, "project");
      await mkdir(repo);
      const { app, client } = await bootApp(home);
      await inv(client, "model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59999/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
      await inv(client, "onboarding.dismiss", { step: "notice" });
      await inv(client, "onboarding.dismiss", { step: "apikey" });
      const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
      await inv(client, "session.create", { workspaceId, requestId: crypto.randomUUID() });
      await waitUntil("session visible", async () => {
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        return rows.length > 0 || undefined;
      });
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(app.url);
        const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
        await composer.waitFor();

        // Ctrl+K works from the focused composer; typing filters; Enter runs the Settings item.
        await composer.focus();
        await page.keyboard.press("Control+k");
        const palette = page.getByRole("dialog", { name: "Command palette" });
        await palette.waitFor();
        await page.keyboard.type("appear");
        await expect(palette.getByRole("option").first().textContent()).resolves.toContain("Appearance");
        await page.keyboard.press("Enter");
        const settings = page.getByRole("region", { name: "Settings" });
        await settings.waitFor();
        await expect(page.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).resolves.toBe("true");

        // The close X is the right-most header control; section switches never move the page.
        const close = settings.getByRole("button", { name: "Close settings" });
        const closeBox = (await close.boundingBox())!;
        expect(closeBox.x).toBeGreaterThan(1440 - 80);
        expect(closeBox.width).toBeGreaterThanOrEqual(28);
        const before = (await settings.locator("h2").first().boundingBox())!;
        await page.getByRole("tab", { name: "Governance & evidence" }).click();
        const after = (await settings.locator("h2").first().boundingBox())!;
        expect(after.y).toBe(before.y);
        expect(after.x).toBe(before.x);

        // Tablist keyboard model: Arrow keys move and activate, Home/End jump.
        await page.getByRole("tab", { name: "Governance & evidence" }).focus();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("tab", { name: "Keyboard shortcuts" }).getAttribute("aria-selected")).resolves.toBe("true");
        await page.keyboard.press("End");
        await expect(page.getByRole("tab", { name: "About" }).getAttribute("aria-selected")).resolves.toBe("true");
        await page.keyboard.press("Home");
        await expect(page.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).resolves.toBe("true");

        // Esc closes Settings; Ctrl+, reopens; Ctrl+/ routes to the shortcuts section.
        await page.keyboard.press("Escape");
        await settings.waitFor({ state: "detached" });
        await page.keyboard.press("Control+,");
        await settings.waitFor();
        await page.keyboard.press("Escape");
        await settings.waitFor({ state: "detached" });
        await page.keyboard.press("Control+/");
        await expect(page.getByRole("tab", { name: "Keyboard shortcuts" }).getAttribute("aria-selected")).resolves.toBe("true");
        await settings.getByRole("button", { name: "Close settings" }).click();
        await settings.waitFor({ state: "detached" });

        // Ctrl+B toggles the sidebar.
        await page.keyboard.press("Control+b");
        await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
        await page.keyboard.press("Control+b");
        await page.getByRole("button", { name: "Collapse sidebar" }).waitFor();

        // Add workspace: the close X sits right of the title.
        await page.getByRole("button", { name: "Add workspace", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add workspace" });
        const title = (await dialog.getByRole("heading", { name: "Add workspace" }).boundingBox())!;
        const x = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
        expect(x.x).toBeGreaterThan(title.x + title.width);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });

        // Archive shows a toast with Undo, and Undo restores the session.
        const row = page.locator(".session-row-wrap").first();
        await row.hover();
        await row.getByRole("button", { name: /^Archive/ }).click();
        const toast = page.getByRole("status").filter({ hasText: "Session archived" });
        await toast.waitFor();
        await toast.getByRole("button", { name: "Undo" }).click();
        await waitUntil("session restored", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
          return rows.every((r) => (r.value as { archived?: boolean }).archived !== true) || undefined;
        });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);
});
