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
        // The Settings page covers sidebar + center only; the inspector column stays beside it.
        const settingsBox = (await settings.boundingBox())!;
        expect(closeBox.x + closeBox.width).toBeGreaterThan(settingsBox.x + settingsBox.width - 80);
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
        await row.getByRole("button", { name: /^Session actions/ }).click();
        await row.getByRole("menuitem", { name: /^Archive/ }).click();
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
  test("main header, inspector (toggle, shortcut, resize, tabs) and the mobile drawer", async () => {
    await withTempHome(async (home) => {
      const repo = join(home, "project");
      await mkdir(repo);
      const { app, client } = await bootApp(home);
      await inv(client, "model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59999/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
      await inv(client, "onboarding.dismiss", { step: "notice" });
      await inv(client, "onboarding.dismiss", { step: "apikey" });
      const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
      await inv(client, "session.create", { workspaceId, requestId: crypto.randomUUID() });
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(app.url);
        await page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).waitFor();

        // Landmarks and one source of truth for the current view.
        await page.getByRole("complementary", { name: "Sidebar" }).waitFor();
        await page.getByRole("main").waitFor();
        const views = page.getByRole("group", { name: "View" });
        expect(await views.getByRole("button", { name: "Conversation" }).getAttribute("aria-pressed")).toBe("true");
        await views.getByRole("button", { name: "Workbench", exact: true }).click();
        expect(await views.getByRole("button", { name: "Workbench", exact: true }).getAttribute("aria-pressed")).toBe("true");
        expect(await views.getByRole("button", { name: "Conversation" }).getAttribute("aria-pressed")).toBe("false");
        await views.getByRole("button", { name: "Experts and Teams", exact: true }).click();
        await page.getByRole("heading", { name: "Experts & Teams", exact: true }).waitFor();
        expect(await views.getByRole("button", { name: "Workbench", exact: true }).getAttribute("aria-pressed")).toBe("false");
        await views.getByRole("button", { name: "Conversation" }).click();
        await page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).waitFor();

        // Inspector: open by default on a wide screen; toggle via button and Ctrl+Shift+B.
        const inspector = page.getByRole("complementary", { name: "Inspector" });
        const toggle = page.getByRole("button", { name: "Toggle inspector" });
        await inspector.waitFor();
        expect(await toggle.getAttribute("aria-pressed")).toBe("true");
        expect(await page.getByRole("tab", { name: "Context" }).getAttribute("aria-selected")).toBe("true");
        await inspector.getByRole("button", { name: "Hide inspector" }).click();
        await inspector.waitFor({ state: "detached" });
        expect(await toggle.getAttribute("aria-pressed")).toBe("false");
        await toggle.click();
        await inspector.waitFor();
        await page.keyboard.press("Control+Shift+B");
        await inspector.waitFor({ state: "detached" });
        await page.keyboard.press("Control+Shift+B");
        await inspector.waitFor();

        // Tabs: Context, Changes (empty state), Details (empty state); the choice survives a reload.
        await page.getByRole("tab", { name: "Changes" }).click();
        await inspector.getByText("No changes yet").waitFor();
        await page.getByRole("tab", { name: "Details" }).click();
        await inspector.getByText("Nothing selected").waitFor();
        await page.reload();
        await inspector.waitFor();
        expect(await page.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
        await page.getByRole("tab", { name: "Context" }).click();

        // Resize with the keyboard: ArrowLeft widens by 8px (Shift: 32px), Home/End hit the limits,
        // double-click restores the default.
        const handle = page.getByRole("separator", { name: "Resize inspector" });
        const startWidth = Number(await handle.getAttribute("aria-valuenow"));
        expect(startWidth).toBe(340);
        await handle.focus();
        await page.keyboard.press("ArrowLeft");
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(startWidth + 8);
        await page.keyboard.press("Shift+ArrowLeft");
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(startWidth + 8 + 32);
        expect(Math.round((await inspector.boundingBox())!.width)).toBe(startWidth + 40);
        await page.keyboard.press("Home");
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(Number(await handle.getAttribute("aria-valuemin")));
        await page.keyboard.press("End");
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(Number(await handle.getAttribute("aria-valuemax")));
        await handle.dblclick();
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(340);
        // Dragging with the pointer resizes too.
        const box = (await handle.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + 200);
        await page.mouse.down();
        await page.mouse.move(box.x - 60, box.y + 200, { steps: 4 });
        await page.mouse.up();
        expect(Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(380);

        // Sidebar resize shares the same handle behaviour.
        const sidebarHandle = page.getByRole("separator", { name: "Resize sidebar" });
        const sidebarStart = Number(await sidebarHandle.getAttribute("aria-valuenow"));
        await sidebarHandle.focus();
        await page.keyboard.press("ArrowRight");
        expect(Number(await sidebarHandle.getAttribute("aria-valuenow"))).toBe(sidebarStart + 8);

        // The context bar replaces the old Task row: one compact row, IDLE is not painted. (on the hero the workspace is the pill above the composer, so the bar carries no duplicate workspace chip)
        const bar = page.locator(".wb-composerbar");
        await bar.locator(".ctx-chip").first().waitFor();
        expect(await bar.locator(".ctx-chip").count()).toBeGreaterThanOrEqual(2);
        expect(await page.getByText("Nothing is in focus").count()).toBe(0);
        expect(await page.getByText("No tasks in this workspace yet.").count()).toBe(0);

        // Narrow: the inspector is an overlay sheet with a scrim that Esc and a scrim click close.
        await page.setViewportSize({ width: 820, height: 800 });
        await inspector.waitFor({ state: "detached" });
        await toggle.click();
        await inspector.waitFor();
        await page.locator(".inspector-scrim").waitFor();
        await page.keyboard.press("Escape");
        await inspector.waitFor({ state: "detached" });
        await toggle.click();
        await inspector.waitFor();
        await page.mouse.click(40, 400);
        await inspector.waitFor({ state: "detached" });

        // Mobile: the sidebar is a drawer opened from the header, with a scrim and Esc; all nav reachable.
        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
        mobile.on("pageerror", (e) => errors.push(e.message));
        await mobile.goto(app.url);
        const sidebar = mobile.getByRole("complementary", { name: "Sidebar" });
        await mobile.getByRole("button", { name: "Toggle inspector" }).waitFor();
        expect(await sidebar.isVisible()).toBe(false);
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await mobile.getByRole("button", { name: "Expand sidebar" }).click();
        await sidebar.waitFor();
        await mobile.locator(".drawer-scrim").waitFor();
        for (const name of ["New session", "Go to Experts & Teams", "Plugins", "Go to Workbench", "Settings", "Add workspace"]) {
          await sidebar.getByRole("button", { name, exact: true }).waitFor();
        }
        await mobile.keyboard.press("Escape");
        await sidebar.waitFor({ state: "hidden" });
        await mobile.getByRole("button", { name: "Expand sidebar" }).click();
        await sidebar.waitFor();
        await mobile.mouse.click(370, 400);
        await sidebar.waitFor({ state: "hidden" });
        // The inspector is a full-screen sheet here.
        await mobile.getByRole("button", { name: "Toggle inspector" }).click();
        const sheet = mobile.getByRole("complementary", { name: "Inspector" });
        await sheet.waitFor();
        expect(Math.round((await sheet.boundingBox())!.width)).toBe(390);
        await mobile.getByRole("button", { name: "Hide inspector" }).click();
        await sheet.waitFor({ state: "detached" });
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);
});
