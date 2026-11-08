// UI production-readiness journeys in a real browser: a failing provider shows the retry card (not a
// silent hang), deleting a workspace asks first and leaves no raw-id row, and the Config inspector tab
// edits the configuration and the UI follows.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootAimock, bootApp, withTempHome } from "./helpers.ts";
import { inv, waitUntil } from "./wb-helpers.ts";

const SHOTS = join(import.meta.dir, "..", ".agents/reports/ui-production-readiness/evidence/after/t4");
const shot = async (page: Page, name: string) => {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

async function configured(home: string, baseURL: string, names: string[]) {
  const boot = await bootApp(home);
  const root = await mkdtemp(join(tmpdir(), "uiprod-"));
  await inv(boot.client, "model.configure", { providerId: "mock", baseURL, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
  await inv(boot.client, "onboarding.dismiss", { step: "notice" });
  await inv(boot.client, "onboarding.dismiss", { step: "apikey" });
  const ids: string[] = [];
  for (const name of names) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "README.md"), `# ${name}\n`);
    const { workspaceId } = (await inv(boot.client, "workspace.select", { path: dir })) as { workspaceId: string };
    ids.push(workspaceId);
  }
  await waitUntil("workspaces listed", async () => {
    const rows = (await boot.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
    return ids.every((id) => rows.some((r) => r.key === `record/${id}`)) || undefined;
  });
  return { ...boot, root, ids };
}

describe("J-H-provider-error E2E retry card", () => {
  test("an unreachable provider shows 'Can't reach ... retrying' with the error within 10s, then a readable failure with Retry", async () => {
    process.env.MODEL_RETRY_BACKOFF_MS = "1500";
    await withTempHome(async (home) => {
      // A real unreachable endpoint: a listener that drops every connection (this environment hangs on
      // closed loopback ports instead of refusing, so a dropped connection is the deterministic stand-in).
      const dropper = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(sock) { sock.terminate(); }, data() {} } });
      const { app, client, root } = await configured(home, `http://127.0.0.1:${dropper.port}/v1`, ["proj-a"]);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
        await composer.fill("hello");
        await composer.press("Enter");
        const card = page.locator("[data-retry-card].retry-card");
        await card.waitFor({ timeout: 10_000 }).catch(async (e) => { console.log("BODY", (await page.locator("main").innerText()).slice(-600)); throw e; });
        expect(await card.textContent()).toMatch(/Can't reach mock .*127\.0\.0\.1:\d+.* retrying \(\d\/5\)/);
        expect((await card.locator(".retry-card-error").textContent())?.length ?? 0).toBeGreaterThan(5);
        expect(await card.textContent()).toMatch(/Next attempt in \d+s|Trying again now/);
        expect(await card.locator(".retry-card-code").textContent()).toMatch(/CONNECTION_REFUSED|NETWORK_ERROR/);
        await card.getByRole("button", { name: "Stop" }).waitFor();
        await card.getByRole("button", { name: "Open model settings" }).waitFor();
        await shot(page, "t4-retry-card");
        await page.getByText("This turn failed").waitFor({ timeout: 40_000 });
        await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
        await shot(page, "t4-failure-block");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
        await rm(root, { recursive: true, force: true });
        dropper.stop(true);
      }
    });
    delete process.env.MODEL_RETRY_BACKOFF_MS;
  }, 120_000);
});

describe("J-WS-delete E2E workspace delete confirmation", () => {
  test("Cancel keeps the workspace; Confirm removes it, toasts, and leaves no raw-id row", async () => {
    await withTempHome(async (home) => {
      const { app, client, root, ids } = await configured(home, "http://127.0.0.1:59997/v1", ["alpha-proj", "beta-proj"]);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        const tree = page.getByRole("tree", { name: "Sessions" });
        await tree.getByText("alpha-proj").first().waitFor();
        const open = async () => {
          await tree.getByText("alpha-proj").first().hover();
          await page.getByRole("button", { name: "Workspace actions for alpha-proj" }).click();
          await page.getByRole("menuitem", { name: "Delete workspace" }).click();
        };
        await open();
        // D-15: the dialog title uses the app's curly-quote pair — the name matches accordingly.
        const dialog = page.getByRole("dialog", { name: /Delete workspace “alpha-proj”\?/ });
        await dialog.waitFor();
        expect(await dialog.textContent()).toMatch(/Files in .*alpha-proj.* are not touched/);
        await shot(page, "t4-delete-confirm");
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "detached" });
        await tree.getByText("alpha-proj").first().waitFor();

        await open();
        await page.getByRole("dialog").getByRole("button", { name: "Delete workspace", exact: true }).click();
        await page.getByText('Removed workspace "alpha-proj"').waitFor();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await tree.getByText("alpha-proj").first().waitFor({ state: "detached" });
        const treeText = (await tree.textContent()) ?? "";
        expect(treeText).not.toContain(ids[0]!);
        expect(treeText).not.toMatch(/\b[0-9a-f]{16}\b/);
        await tree.getByText("beta-proj").first().waitFor();
        await shot(page, "t4-delete-done");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  }, 90_000);
});

describe("J-CFG-config-edit E2E inspector config editor", () => {
  test("edit appearance in the Config tab, Save, and the UI theme follows", async () => {
    await withTempHome(async (home) => {
      const { app, client, root } = await configured(home, "http://127.0.0.1:59996/v1", ["proj-a"]);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        await page.getByRole("button", { name: "Settings" }).first().click();
        await page.getByRole("button", { name: "Open configuration file" }).click();
        await page.getByRole("tab", { name: "Config" }).waitFor();
        const editor = page.getByLabel("Configuration JSON");
        await editor.waitFor();
        const original = await editor.inputValue();
        expect(original).toContain('"appearance"');
        const shell = page.locator(".app-shell");
        const before = await shell.getAttribute("data-theme");
        const target = before === "dark" ? "light" : "dark";
        await editor.fill(original.replace(/"appearance":\s*"[a-z]+"/, `"appearance": "${target}"`));
        await shot(page, "t4-config-dirty");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.getByText(/Saved\. Applied:.*appearance/).waitFor();
        await page.waitForFunction((t) => document.querySelector(".app-shell")?.getAttribute("data-theme") === t, target);
        await shot(page, "t4-config-saved");
      } finally {
        await browser.close();
        await client.close();
        await app.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  }, 90_000);
});
