// RED PRODUCT JOURNEYS — actual pointer + keyboard interactions; no DOM-static test substitutes.
// UX is a release gate: obvious folder completion, working + action, visible selected draft,
// composer focus, task visibility understandable at creation, and no silent task carryover.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { bootApp, inv, waitUntil, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

async function startReady(home: string, repo: string) {
  const { app, client } = await bootApp(home);
  await inv(client, "onboarding.dismiss", { step: "notice" });
  await inv(client, "onboarding.dismiss", { step: "apikey" });
  const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
  await waitUntil("workspace visible in projection", async () => {
    const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
    return rows.some(row => row.key === `record/${workspaceId}`) || undefined;
  });
  return { app, client, workspaceId };
}

describe("E2E J-SESSION-draft — + must visibly do something without a model call (RED)", () => {
  test("clicking + from Experts & Teams creates a selected draft and focuses the composer; survives reload", async () => {
    await withTempHome(async home => {
      const project = join(home, "project");
      await mkdir(project);
      const { app, client, workspaceId } = await startReady(home, project);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(app.url);
        await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await page.locator(".session-row-wrap.active").getByRole("button", { name: /New Session/i }).waitFor();
        const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
        await composer.waitFor({ state: "visible" });
        await expect(composer.isEnabled()).resolves.toBe(true);
        await expect(composer.evaluate(el => el === document.activeElement)).resolves.toBe(true);
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const draft = rows.filter(row => (row.value as { workspaceId?: string; lastStatus?: string }).workspaceId === workspaceId &&
          (row.value as { lastStatus?: string }).lastStatus === "draft");
        expect(draft).toHaveLength(1);
        await page.reload();
        await page.locator(".session-row-wrap.active").getByRole("button", { name: /New Session/i }).waitFor();
        await page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).waitFor();
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);

  test("new session in another workspace changes current selection, not just its label; no stale task binding", async () => {
    await withTempHome(async home => {
      const a = join(home, "project-a"), b = join(home, "project-b");
      await Promise.all([mkdir(a), mkdir(b)]);
      const { app, client } = await startReady(home, a);
      const second = (await inv(client, "workspace.select", { path: b })) as { workspaceId: string };
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "New session in project-a" }).click();
        await page.locator(".session-row-wrap.active").getByText("New Session").waitFor();
        await waitUntil("workspace A selected", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
          return rows.find(r => r.key === "current")?.value !== second.workspaceId || undefined;
        });
        const active = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows
          .find(r => (r.value as { lastStatus?: string }).lastStatus === "draft");
        expect(active).toBeDefined();
        expect((active?.value as { workspaceId?: string }).workspaceId).not.toBe(second.workspaceId);
        expect(await page.getByRole("combobox", { name: "Task" }).inputValue()).toBe("");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);
});

describe("E2E J-WS-directory-discovery — usable picker, not a raw full-path demand (RED)", () => {
  test("type a partial path, see directory options, choose by keyboard, and open without manual full-path entry", async () => {
    await withTempHome(async home => {
      const root = await mkdtemp(join(tmpdir(), "cognate-picker-ux-"));
      const existing = join(home, "existing");
      await Promise.all([mkdir(existing), mkdir(join(root, "projects")), mkdir(join(root, "prototypes"))]);
      const { app, client } = await startReady(home, existing);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "Add workspace", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add workspace" });
        const field = dialog.getByRole("textbox", { name: "Workspace directory path" });
        await field.fill(join(root, "pro"));
        const list = dialog.getByRole("listbox", { name: "Suggested folders" });
        await list.getByRole("option", { name: /projects/i }).waitFor();
        await list.getByRole("option", { name: /prototypes/i }).waitFor();
        await field.press("ArrowDown");
        await field.press("Tab");
        expect(await field.inputValue()).toBe(join(root, "projects"));
        await dialog.getByRole("button", { name: "Open", exact: true }).click();
        await waitUntil("picked workspace added", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
          return rows.some(r => r.key.startsWith("record/") && (r.value as { root?: string }).root === join(root, "projects")) || undefined;
        });
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  }, 120_000);

  test("session task scope must be obvious at creation, without requiring knowledge of internal Run IDs", async () => {
    await withTempHome(async home => {
      const project = join(home, "project");
      await mkdir(project);
      const { app, client } = await startReady(home, project);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await page.locator(".session-row-wrap.active").getByText("New Session").waitFor();
        await page.getByRole("button", { name: "Workbench", exact: true }).click();
        await page.getByRole("tabpanel").getByRole("button", { name: /New task/i }).click();
        const form = page.getByRole("form", { name: "New task" });
        await form.getByRole("textbox", { name: "What is the task called" }).fill("Investigate renderer");
        const visibility = form.getByRole("radiogroup", { name: "Task visibility" });
        await visibility.getByRole("radio", { name: "This session" }).check();
        await form.getByRole("button", { name: "Create task" }).click();
        await page.getByRole("button", { name: "Back to conversation" }).click();
        const binding = page.getByRole("combobox", { name: "Task" });
        await binding.waitFor();
        expect(await binding.inputValue()).not.toBe("");
        await page.getByRole("button", { name: "New session", exact: true }).click();
        expect(await page.getByRole("combobox", { name: "Task" }).inputValue()).toBe("");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);
});
