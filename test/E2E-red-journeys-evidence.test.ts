// UX evidence for the RED-journey release gate (docs/specs/session-workspace-task-red-journeys.md
// §Mandatory UX acceptance checklist). Real Chromium against the real app; every step waits for
// what a person must see before capturing screenshots into screenshots/red-journeys/. These are
// *additional* journeys — the behavioral suites are the five *.red.test.ts files.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { bootApp, inv, waitUntil, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "red-journeys");
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

async function startReady(home: string, repo: string) {
  const { app, client } = await bootApp(home);
  await inv(client, "model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59999/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
  await inv(client, "onboarding.dismiss", { step: "notice" });
  await inv(client, "onboarding.dismiss", { step: "apikey" });
  const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
  await waitUntil("workspace visible in projection", async () => {
    const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
    return rows.some((row) => row.key === `record/${workspaceId}`) || undefined;
  });
  return { app, client, workspaceId };
}

describe("RED journeys — UX evidence", () => {
  test("+ from Experts & Teams, focused composer, reload persistence, obvious task association", async () => {
    await mkdir(SHOTS, { recursive: true });
    await withTempHome(async (home) => {
      const project = join(home, "project");
      await mkdir(project);
      const { app, client } = await startReady(home, project);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
        await shot(page, "01-experts-open-before-plus");
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await page.locator(".session-row-wrap.active").getByRole("button", { name: /^New Session/ }).waitFor();
        await page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).waitFor();
        await page.waitForFunction(() => {
          const el = document.activeElement;
          return el instanceof HTMLTextAreaElement && /Message or run a task|describe your task/.test(el.getAttribute("aria-label") ?? "");
        });
        await shot(page, "02-draft-selected-composer-focused");
        await page.reload();
        await page.locator(".session-row-wrap.active").getByRole("button", { name: /^New Session/ }).waitFor();
        await shot(page, "03-draft-survives-reload");
        // The new draft's task association is immediately understandable: an obvious "No task" state.
        await page.getByRole("combobox", { name: "Task" }).waitFor();
        expect(await page.getByRole("combobox", { name: "Task" }).inputValue()).toBe("");
        await shot(page, "04-no-task-is-obvious");

        // Task visibility choice at creation, then the bound conversation.
        await page.getByRole("button", { name: "Workbench", exact: true }).click();
        await page.getByRole("tabpanel").getByRole("button", { name: /New task/i }).click();
        const form = page.getByRole("form", { name: "New task" });
        await form.getByRole("textbox", { name: "What is the task called" }).fill("Investigate renderer");
        await shot(page, "05-task-visibility-choice");
        await form.getByRole("radiogroup", { name: "Task visibility" }).getByRole("radio", { name: "This session" }).check();
        await form.getByRole("button", { name: "Create task" }).click();
        await page.getByRole("button", { name: "Back to conversation" }).click();
        await page.waitForFunction(() => {
          const el = document.querySelector("select#wb-bind-task") as HTMLSelectElement | null;
          return el !== null && el.value !== "" && el.selectedOptions[0]!.textContent.includes("this session");
        });
        await shot(page, "06-session-task-bound-in-composer");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 120_000);

  test("directory suggestions, keyboard completion, move control with consequences", async () => {
    await mkdir(SHOTS, { recursive: true });
    const browseRoot = await mkdtemp(join(tmpdir(), "cognate-evidence-"));
    await withTempHome(async (home) => {
      await Promise.all([mkdir(join(browseRoot, "projects")), mkdir(join(browseRoot, "prototypes")), mkdir(join(browseRoot, "archives"))]);
      const existing = join(home, "existing");
      await mkdir(existing);
      const { app, client } = await startReady(home, existing);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "Add workspace", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add workspace" });
        const field = dialog.getByRole("textbox", { name: "Workspace directory path" });
        await field.fill(join(browseRoot, "pro"));
        await dialog.getByRole("listbox", { name: "Suggested folders" }).getByRole("option", { name: /projects/i }).waitFor();
        await shot(page, "07-directory-suggestions");
        await field.press("ArrowDown");
        await field.press("Tab");
        expect(await field.inputValue()).toBe(join(browseRoot, "projects"));
        await shot(page, "08-keyboard-completion");
        await dialog.getByRole("button", { name: "Open", exact: true }).click();
        await waitUntil("picked workspace added", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
          return rows.some((r) => r.key.startsWith("record/") && (r.value as { root?: string }).root === join(browseRoot, "projects")) || undefined;
        });
        await shot(page, "09-workspace-opened-exact-destination");

        // The governed move affordance explains itself before committing.
        await page.getByRole("button", { name: "Workbench", exact: true }).click();
        await page.getByRole("tabpanel").getByRole("button", { name: /New task/i }).click();
        const form = page.getByRole("form", { name: "New task" });
        await form.getByRole("textbox", { name: "What is the task called" }).fill("Portable objective");
        await form.getByRole("button", { name: "Create task" }).click();
        await page.getByRole("article", { name: "Task Portable objective" }).waitFor();
        await page.getByRole("button", { name: "Move or promote…" }).click();
        await page.getByRole("group", { name: "Move or promote this task" }).waitFor();
        await shot(page, "10-move-or-promote-control");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
        await import("node:fs/promises").then((fs) => fs.rm(browseRoot, { recursive: true, force: true }));
      }
    });
  }, 120_000);
});
