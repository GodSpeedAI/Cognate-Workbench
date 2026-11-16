// U5 provider UX in a real browser, against real aimock processes: add providers through the wizard,
// test connections (ok and failing), switch the active provider from the composer's model picker
// without re-entering a key, see the next reply come from the newly active route, delete a
// non-active provider. Keys are typed once, in the wizard.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { aimockChatRequests } from "./helpers.ts";
import { bootAimock, bootApp, inv, waitUntil, withTempHome, type MockModel } from "./wb-helpers.ts";

async function addProvider(page: Page, opts: { preset: string | RegExp; name?: string; baseURL: string; key?: string; model: string }) {
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("radio", { name: opts.preset }).click();
  if (opts.name) await page.getByLabel("Display name").fill(opts.name);
  await page.getByLabel("Base URL").fill(opts.baseURL);
  if (opts.key !== undefined) await page.getByLabel("API key").fill(opts.key);
  await page.getByLabel("Model", { exact: true }).fill(opts.model);
  return page;
}

async function boot(mocks: readonly MockModel[]) {
  const home = await mkdtemp(join(tmpdir(), "u5-prov-home-"));
  const project = await mkdtemp(join(tmpdir(), "u5-prov-ws-"));
  return { home, project, mocks };
}

async function openProviders(page: Page) {
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("tab", { name: "Providers" }).click();
}

describe("J-CFG-provider-switch E2E add providers and switch from the model picker", () => {
  test("two keyed providers plus a keyless local one; picker switches instantly and the next reply comes from the new route", async () => {
    const [a, b, c] = [await bootAimock(), await bootAimock(), await bootAimock()];
    const { home, project } = await boot([a, b, c]);
    try {
      await withTempHome(async (tmpHome) => {
        const { app, client } = await bootApp(tmpHome);
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await inv(client, "workspace.select", { path: project });
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await page.goto(app.url);
          await openProviders(page);
          await page.getByText(/API keys go straight to|API keys are stored in a protected file/).waitFor();

          await addProvider(page, { preset: /^Custom OpenAI-compatible/, name: "Alpha", baseURL: `http://127.0.0.1:${a.port}/v1`, key: "sk-alpha-secret", model: "alpha-model" });
          await page.getByRole("button", { name: "Create provider" }).click();
          await page.locator('[data-provider="alpha"]').waitFor();
          await addProvider(page, { preset: /^Custom OpenAI-compatible/, name: "Beta", baseURL: `http://127.0.0.1:${b.port}/v1`, key: "sk-beta-secret", model: "beta-model" });
          await page.getByRole("button", { name: "Create provider" }).click();
          await page.locator('[data-provider="beta"]').waitFor();
          // The keyless local variant: no key typed, and none required.
          await addProvider(page, { preset: /^Ollama/, baseURL: `http://127.0.0.1:${c.port}/v1`, model: "local-model" });
          await page.getByRole("button", { name: "Create provider" }).click();
          await page.locator('[data-provider="ollama"]').waitFor();

          // Adding activates the newest route; stored secrets are never shown back.
          const list = await inv(client, "provider.list", {});
          const rows = (list as { providers: { providerId: string; hasKey: boolean; keyless: boolean; isCurrent: boolean }[] }).providers;
          expect(rows.map((r) => r.providerId).sort()).toEqual(["alpha", "beta", "ollama"]);
          expect(rows.find((r) => r.providerId === "ollama")!.keyless).toBe(true);
          expect(await page.content()).not.toContain("sk-alpha-secret");

          // Close settings, then switch from the composer's model picker.
          await page.getByRole("button", { name: "Close settings" }).click();
          await page.getByRole("button", { name: /^Model local-model/ }).click();
          const pop = page.getByRole("dialog", { name: "Switch model" });
          await pop.getByRole("group", { name: "Alpha" }).waitFor();
          await pop.getByRole("group", { name: "Beta" }).waitFor();
          await pop.getByRole("option", { name: "local-model", selected: true }).waitFor();
          await pop.getByRole("searchbox", { name: "Search models" }).fill("beta");
          await pop.getByRole("option", { name: "alpha-model" }).waitFor({ state: "detached" });
          await page.screenshot({ path: join(import.meta.dir, "..", ".agents/reports/ui-production-readiness/evidence/after/u5/e2e-model-picker-search.png") }).catch(() => undefined);
          await pop.getByRole("option", { name: "beta-model" }).click();
          await pop.waitFor({ state: "detached" });
          await page.getByRole("button", { name: /^Model beta-model/ }).waitFor();
          const current = await waitUntil("beta active", async () => {
            const r = (await inv(client, "provider.list", {})) as { providers: { providerId: string; isCurrent: boolean }[] };
            return r.providers.find((p) => p.isCurrent)?.providerId === "beta" || undefined;
          });
          expect(current).toBe(true);

          // The next reply comes from beta's route (its aimock sees the request; alpha's does not).
          const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
          await composer.fill("[[scenario:plain]] which route?");
          await composer.press("Enter");
          await page.getByText("Here is what I found").first().waitFor({ timeout: 20_000 });
          expect((await aimockChatRequests(b.port)).length).toBeGreaterThan(0);
          expect((await aimockChatRequests(a.port)).length).toBe(0);
          expect((await aimockChatRequests(c.port)).length).toBe(0);
        } finally {
          await browser.close();
          await client.close();
          await app.stop();
        }
      });
    } finally {
      await Promise.all([a.stop(), b.stop(), c.stop()]);
      await rm(home, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  }, 150_000);
});

describe("J-CFG-provider-test E2E test connection", () => {
  test("a reachable provider reports latency and models, an unreachable one a readable failure, and the wizard tests before saving", async () => {
    const good = await bootAimock();
    try {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await inv(client, "model.configure", { providerId: "good", baseURL: `http://127.0.0.1:${good.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "sk-good", displayName: "Good" });
        await inv(client, "model.configure", { providerId: "bad", baseURL: "http://127.0.0.1:59998/v1", protocol: "openai-compatible", model: "nope", apiKey: "sk-bad", displayName: "Bad" });
        await inv(client, "provider.activate", { providerId: "good" });
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await page.goto(app.url);
          await openProviders(page);
          const good_ = page.locator('[data-provider="good"]');
          await good_.getByRole("button", { name: /Good/ }).first().click();
          await good_.getByRole("button", { name: "Test connection for Good" }).click();
          await good_.locator('[data-test-result="ok"]').waitFor({ timeout: 20_000 });
          expect(await good_.locator('[data-test-result="ok"]').textContent()).toMatch(/Connected to 127\.0\.0\.1:\d+ in \d+ ms/);
          const bad = page.locator('[data-provider="bad"]');
          await bad.getByRole("button", { name: /Bad/ }).first().click();
          await bad.getByRole("button", { name: "Test connection for Bad" }).click();
          await bad.locator('[data-test-result="failed"]').waitFor({ timeout: 20_000 });
          expect((await bad.locator('[data-test-result="failed"]').textContent())!.length).toBeGreaterThan(10);

          // Edit prefilled: the key field says the stored key is kept; testing needs no re-entry.
          await good_.getByRole("button", { name: /Good/ }).first().click();
          await good_.getByRole("button", { name: "Edit Good" }).click();
          const key = page.getByLabel("API key");
          expect(await key.getAttribute("placeholder")).toBe("Stored — leave blank to keep");
          expect(await key.inputValue()).toBe("");
          await page.getByRole("button", { name: "Test connection", exact: true }).click();
          await page.locator('.pw [data-test-result="ok"]').waitFor({ timeout: 20_000 });
          await page.getByRole("button", { name: "Save changes" }).click();
          await page.locator('[data-provider="good"]').waitFor();
          // Blank key saved the config without losing the stored key.
          const rows = ((await inv(client, "provider.list", {})) as { providers: { providerId: string; hasKey: boolean }[] }).providers;
          expect(rows.find((r) => r.providerId === "good")!.hasKey).toBe(true);

          // A wizard draft pointing nowhere fails its test and nothing is saved.
          await page.getByRole("button", { name: "Add provider" }).click();
          await page.getByRole("radio", { name: /^Custom OpenAI-compatible/ }).click();
          await page.getByLabel("Base URL").fill("http://127.0.0.1:59997/v1");
          await page.getByLabel("API key").fill("sk-draft");
          await page.getByRole("button", { name: "Test connection", exact: true }).click();
          await page.locator('.pw [data-test-result="failed"]').waitFor({ timeout: 20_000 });
          const after = ((await inv(client, "provider.list", {})) as { providers: unknown[] }).providers;
          expect(after.length).toBe(2);
        } finally {
          await browser.close();
          await client.close();
          await app.stop();
        }
      });
    } finally {
      await good.stop();
    }
  }, 120_000);
});

describe("J-CFG-model-provider E2E delete a non-active provider and Azure fields", () => {
  test("deleting a non-active provider confirms first and leaves the active route; Azure shows deployment and api-version fields", async () => {
    const a = await bootAimock();
    try {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await inv(client, "model.configure", { providerId: "spare", baseURL: "http://127.0.0.1:59996/v1", protocol: "openai-compatible", model: "spare-model", apiKey: "sk-spare", displayName: "Spare" });
        await inv(client, "model.configure", { providerId: "main", baseURL: `http://127.0.0.1:${a.port}/v1`, protocol: "openai-compatible", model: "main-model", apiKey: "sk-main", displayName: "Main" });
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await page.goto(app.url);
          await openProviders(page);
          const spare = page.locator('[data-provider="spare"]');
          await spare.getByRole("button", { name: /Spare/ }).first().click();
          await spare.getByRole("button", { name: "Delete Spare" }).click();
          await spare.getByText(/Delete Spare and its stored key\?/).waitFor();
          await spare.getByRole("button", { name: "Cancel" }).click();
          expect(await spare.count()).toBe(1);
          await spare.getByRole("button", { name: "Delete Spare" }).click();
          await spare.getByRole("button", { name: "Yes, delete" }).click();
          await spare.waitFor({ state: "detached" });
          const rows = ((await inv(client, "provider.list", {})) as { providers: { providerId: string; isCurrent: boolean }[] }).providers;
          expect(rows.map((r) => r.providerId)).toEqual(["main"]);
          expect(rows[0]!.isCurrent).toBe(true);
          await page.locator('[data-provider="main"] .prov-badge', { hasText: "Active" }).waitFor();

          // Azure: its own preset reveals the deployment URL guidance and an api-version field; chat only.
          await page.getByRole("button", { name: "Add provider" }).click();
          await page.getByRole("radio", { name: /^Azure OpenAI/ }).click();
          const ver = page.getByLabel("API version");
          await ver.waitFor();
          expect(await ver.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}/);
          expect(await page.getByLabel("API protocol").isDisabled()).toBe(true);
          await mkdir(join(import.meta.dir, "..", ".agents/reports/ui-production-readiness/evidence/after/u5"), { recursive: true });
        } finally {
          await browser.close();
          await client.close();
          await app.stop();
        }
      });
    } finally {
      await a.stop();
    }
  }, 120_000);
});
