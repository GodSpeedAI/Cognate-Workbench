// Opt-in browser journey for the real Linux child-containment world. It needs a running pg0
// instance and a host-owned attestation for the reviewed Bubblewrap binary; default runs skip it.
// Run with COGNATE_BWRAP_TESTS=1 COGNATE_BWRAP_TEST_ATTESTATION=/path/to/reviewed.json bun test test/E2E-contained-workspace.test.ts.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";
import { bootAimock } from "./helpers.ts";

const enabled = process.env.COGNATE_BWRAP_TESTS === "1" && process.platform === "linux";
const integrationTest = enabled ? test : test.skip;
const clientFor = (app: AppServer) => createClient({
  service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)),
  caller: LOCAL_OPERATOR,
});

async function containmentConfig(): Promise<ContainmentConfig> {
  const proofPath = process.env.COGNATE_BWRAP_TEST_ATTESTATION;
  if (!proofPath) throw new Error("COGNATE_BWRAP_TESTS=1 requires COGNATE_BWRAP_TEST_ATTESTATION pointing to a reviewed host attestation JSON");
  const supplied = JSON.parse(await readFile(proofPath, "utf8")) as ContainmentConfig;
  expect(supplied.executablePath).toBeTruthy();
  expect(supplied.provenance.operatorVerified).toBe(true);
  expect(supplied.provenance.patchedCve202687766).toBe(true);
  expect(supplied.provenance.binarySha256).toBe(createHash("sha256").update(await readFile(supplied.executablePath)).digest("hex"));
  expect(supplied.provenance.version).toContain("bubblewrap 0.12.0");
  expect(supplied.provenance.source).toContain("v0.12.0");
  expect(supplied.runtimeRoots).toEqual(["/usr/bin", "/usr/lib", "/lib", "/lib64"]);
  expect(supplied.bunExecutable).toBe(process.execPath);
  return supplied;
}

async function stop(app: AppServer | undefined): Promise<void> {
  if (app) await app.stop();
}

integrationTest("Add Workspace explains unavailable containment, then opens and codes in an explicitly contained workspace", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "workbench-contained-ui-"));
  const screenshotDir = join(process.cwd(), "screenshots", "containment");
  const workspace = join(fixtureRoot, "workspace");
  const mock = await bootAimock();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let appWithoutConfig: AppServer | undefined;
  let appWithConfig: AppServer | undefined;
  const pageErrors: string[] = [];
  try {
    await mkdir(screenshotDir, { recursive: true });

    // The same UI with no host-supplied containment configuration must expose the reason and
    // leave the ordinary local selection available.
    appWithoutConfig = await startServer({ devAuth: true, port: 0, home: join(fixtureRoot, "app-no-config") });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const noConfigClient = clientFor(appWithoutConfig);
    await noConfigClient.invoke("onboarding.dismiss", { step: "notice" });
    await noConfigClient.invoke("onboarding.dismiss", { step: "apikey" });
    await page.goto(appWithoutConfig.url);
    await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
    let dialog = page.getByRole("dialog", { name: "Add workspace" });
    const unavailable = dialog.getByLabel("Linux child containment");
    await unavailable.waitFor();
    expect(await unavailable.isDisabled()).toBe(true);
    expect(await dialog.getByRole("status").innerText()).toMatch(/not configured|unavailable/i);
    expect(await dialog.getByLabel("Local · read-only to agents — commands and writes need a contained workspace").isChecked()).toBe(true);
    await dialog.screenshot({ path: join(screenshotDir, "no-config-desktop.png") });
    await dialog.getByRole("button", { name: "Close" }).click();
    await stop(appWithoutConfig);
    appWithoutConfig = undefined;

    // Configure a mock model and select a real contained workspace only through the visible UI.
    const config = await containmentConfig();
    appWithConfig = await startServer({ devAuth: true, port: 0, home: join(fixtureRoot, "app-configured"), containmentConfig: config });
    const client = clientFor(appWithConfig);
    await client.invoke("onboarding.dismiss", { step: "notice" });
    await client.invoke("onboarding.dismiss", { step: "apikey" });
    await client.invoke("model.configure", {
      providerId: "mock",
      baseURL: `http://127.0.0.1:${mock.port}/v1`,
      protocol: "openai-compatible",
      model: "mock-model-1",
      apiKey: "",
    });
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "# Contained fixture\n");
    await writeFile(join(workspace, "src", "greet.ts"), 'export const greet = () => "Hello";\n');

    await page.goto(appWithConfig.url);
    await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
    dialog = page.getByRole("dialog", { name: "Add workspace" });
    const path = dialog.getByLabel("Workspace directory path");
    const contained = dialog.getByLabel("Linux child containment");
    await expectEnabled(contained);
    const status = await dialog.getByRole("status").innerText();
    expect(status).toContain("preflighted when opened");
    expect(status).toContain("network access is denied");
    expect(status).toContain("Workbench host application is not isolated");

    // Contained posture (the default): containment is preselected once the host reports it. Tab
    // enters the radio group at the checked option; arrow keys still move between both options.
    for (let i = 0; i < 50 && !(await contained.isChecked()); i++) await page.waitForTimeout(50);
    expect(await contained.isChecked()).toBe(true);
    await path.focus();
    await page.keyboard.press("Tab");
    expect(await contained.evaluate((element) => element === document.activeElement)).toBe(true);
    const localChoice = dialog.getByLabel("Local · read-only to agents — commands and writes need a contained workspace");
    await page.keyboard.press("ArrowLeft");
    expect(await localChoice.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await localChoice.isChecked()).toBe(true);
    await page.keyboard.press("ArrowRight");
    expect(await contained.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await contained.isChecked()).toBe(true);
    await path.fill(workspace);
    await dialog.screenshot({ path: join(screenshotDir, "contained-choice-desktop.png") });

    // Keep the modal within a phone-sized viewport, including its explanation and controls.
    await page.setViewportSize({ width: 360, height: 800 });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    await dialog.screenshot({ path: join(screenshotDir, "contained-choice-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 900 });

    await dialog.getByRole("button", { name: "Open" }).click();
    await dialog.waitFor({ state: "detached", timeout: 30_000 });
    const workspaceRow = page.locator(".workspace-row", { hasText: "workspace" });
    await workspaceRow.waitFor();
    expect(await workspaceRow.locator(".workspace-world-badge").innerText()).toMatch(/LINUX CHILD CONTAINMENT/);

    // Exercise the normal coding-session UI. The mock plan reads, runs and edits greet.ts via the
    // selected ExecutionWorld; the final host file is the durable side effect of the contained run.
    const composer = page.getByRole("textbox", { name: /Message or run a task/ });
    await composer.fill("[[scenario:multi]] check and change the greeting");
    await composer.press("Enter");
    await page.getByText(/Read greet\.ts, confirmed a clean tree/).waitFor({ timeout: 30_000 });
    const changed = await readFile(join(workspace, "src", "greet.ts"), "utf8");
    expect(changed).toContain("Howdy");
    expect(changed).not.toContain("Hello");
    await page.screenshot({ path: join(screenshotDir, "contained-coding-result-desktop.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await browser?.close();
    await stop(appWithConfig);
    await stop(appWithoutConfig);
    await mock.stop();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}, 180_000);

async function expectEnabled(locator: { isEnabled(): Promise<boolean> }): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Linux child containment did not become enabled after host inspection");
}
