// First-run onboarding in a real browser: Welcome -> full provider form -> folder -> a working
// conversation, plus Configure later -> friendly empty state, and the composer model picker.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { bootAimock, bootApp, withTempHome } from "./helpers.ts";

const SHOTS = join(import.meta.dir, "..", ".agents/reports/ui-production-readiness/evidence/after/t2");
const shot = async (page: Page, name: string) => {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

describe("J-A-first-use E2E first-run onboarding", () => {
  test("Welcome -> provider form -> folder -> working conversation; reload shows no onboarding", async () => {
    const mock = await bootAimock();
    try {
      await withTempHome(async (home) => {
        // The home itself is the app's protected folder; the project lives beside it.
        const root = await mkdtemp(join(tmpdir(), "onb-"));
        await mkdir(join(root, "projects-demo"));
        const { app, client } = await bootApp(home);
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(app.url);
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("heading", { name: "Welcome to Cognate Console" }).waitFor();
          expect(await page.getByText(/Unable to create default workspace/).count()).toBe(0);
          await shot(page, "01-welcome");
          await dialog.getByRole("button", { name: "Continue" }).click();

          await dialog.getByRole("heading", { name: "Connect a model provider" }).waitFor();
          await dialog.getByRole("radiogroup", { name: "Provider" }).waitFor();
          // "API protocol" is a MenuSelect whose announced name carries the value, so no exact match.
          for (const label of ["Base URL", "API protocol", "API key", "Model"]) await dialog.getByLabel(label).waitFor();
          // Not a lone API key field: the primary action is disabled until the form is valid.
          expect(await dialog.getByRole("button", { name: "Save and continue" }).isDisabled()).toBe(true);
          await shot(page, "02-provider-step");

          await dialog.getByRole("radio", { name: /Custom OpenAI-compatible/ }).click();
          await dialog.getByLabel("Display name").fill("Mock gateway");
          await dialog.getByLabel("Base URL", { exact: true }).fill("not a url");
          await dialog.getByLabel("Base URL", { exact: true }).blur();
          await dialog.getByText(/Enter a full URL/).waitFor();
          await shot(page, "03-provider-validation");
          await dialog.getByLabel("Base URL", { exact: true }).fill(`http://127.0.0.1:${mock.port}/v1`);
          await dialog.getByLabel("API key", { exact: true }).fill("sk-test-key");
          await dialog.getByRole("button", { name: "Show key" }).click();
          expect(await dialog.getByLabel("API key", { exact: true }).getAttribute("type")).toBe("text");
          await dialog.getByRole("button", { name: "Fetch models" }).click();
          // aimock may or may not serve /models; either way a manual model id stays possible.
          await page.waitForTimeout(800);
          const model = dialog.getByLabel("Model", { exact: true });
          await model.fill("mock-model-1");
          await shot(page, "04-provider-filled");
          await dialog.getByRole("button", { name: "Save and continue" }).click();

          await dialog.getByRole("heading", { name: "Choose a folder to work in" }).waitFor();
          await shot(page, "05-folder-step");
          const field = dialog.getByRole("combobox", { name: "Workspace directory path" });
          await field.fill(join(root, "proj"));
          await dialog.getByRole("listbox", { name: "Suggested folders" }).getByRole("option", { name: /projects-demo/ }).waitFor();
          await shot(page, "06-folder-suggestions");
          await field.press("ArrowDown");
          await field.press("Tab");
          await dialog.getByRole("button", { name: "Open folder" }).click();
          await page.getByRole("dialog").waitFor({ state: "detached" });

          const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
          await composer.waitFor();
          await expect(composer.evaluate((el) => el === document.activeElement)).resolves.toBe(true);
          await shot(page, "07-ready-composer");
          await composer.fill("[[scenario:plain]]");
          await composer.press("Enter");
          await page.getByText("Here is what I found").first().waitFor({ timeout: 30_000 });
          await shot(page, "08-first-reply");

          await page.reload();
          await page.getByRole("textbox", { name: /Message or run a task|describe your task/i }).waitFor();
          await page.waitForTimeout(500);
          expect(await page.getByRole("dialog").count()).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await browser.close();
          await client.close();
          await app.stop();
          await rm(root, { recursive: true, force: true });
        }
      });
    } finally {
      await mock.stop();
    }
  }, 150_000);

  test("Configure later lands on a friendly empty state that opens the provider form", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "Continue" }).click();
        // Back returns to Welcome without losing the flow.
        await page.getByRole("button", { name: "← Back" }).click();
        await page.getByRole("heading", { name: "Welcome to Cognate Console" }).waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Configure later" }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        expect(await page.getByText(/Unable to create default workspace/).count()).toBe(0);
        await page.getByText("No model provider connected").waitFor();
        await shot(page, "09-empty-state");
        await page.getByRole("button", { name: "Connect a model provider" }).click();
        await page.getByRole("heading", { name: "Add model provider" }).waitFor();
        await page.getByRole("radiogroup", { name: "Provider" }).waitFor();
        await shot(page, "10-settings-wizard");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 90_000);

  test("Esc on the Welcome step closes the flow without a dead end", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("dialog").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByText("No model provider connected").waitFor();
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
      }
    });
  }, 60_000);

  test("composer model picker lists the model and Manage providers opens Settings", async () => {
    const mock = await bootAimock();
    try {
      await withTempHome(async (home) => {
        const project = join(home, "p");
        await mkdir(project);
        const { app, client } = await bootApp(home);
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${mock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" } as never);
        await client.invoke("onboarding.dismiss", { step: "notice" });
        await client.invoke("onboarding.dismiss", { step: "apikey" });
        await client.invoke("workspace.select", { path: project });
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await page.goto(app.url);
          await page.getByRole("button", { name: /^Model mock-model-1/ }).click();
          const pop = page.getByRole("dialog", { name: "Switch model" });
          await pop.getByRole("option", { name: "mock-model-1", selected: true }).waitFor();
          await shot(page, "11-model-picker");
          await page.keyboard.press("Escape");
          await pop.waitFor({ state: "detached" });
          // palette action "Switch model" opens the same popover
          await page.keyboard.press("Control+k");
          await page.keyboard.type("Switch model");
          await page.keyboard.press("Enter");
          await pop.waitFor();
          await page.keyboard.press("Escape");
          await pop.waitFor({ state: "detached" });
          await page.getByRole("button", { name: /^Model mock-model-1/ }).click();
          await pop.getByRole("button", { name: "Manage providers…" }).click();
          await page.getByRole("tab", { name: "Providers", selected: true }).waitFor();
        } finally {
          await browser.close();
          await client.close();
          await app.stop();
        }
      });
    } finally {
      await mock.stop();
    }
  }, 90_000);
});
