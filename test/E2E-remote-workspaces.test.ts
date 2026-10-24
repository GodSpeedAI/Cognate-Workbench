// Browser acceptance for Remote Workspaces (real Chromium, real server, aimock model, ssh2 server as
// the remote host). Proves the UX, not just the plumbing: host identity is shown and must be trusted
// explicitly, secrets are never echoed back, errors say what to do, a remote workspace is marked as
// such, saved connections are reusable, and an unreachable world is loud while a healthy one is quiet.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { startSshFixture } from "@godspeedai/cognate-execution-ssh/fixture";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { bootAimock, withTempHome } from "./helpers.ts";

const PASSWORD = "e2e-Secret-pw-9981";

/** A port that is guaranteed closed: bound, read, released. */
const closedPort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

describe("E2E remote workspaces", () => {
  test("verify host -> trust -> connect -> folder -> agent over SSH; saved connection; unreachable banner", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const fixture = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const app = await startServer({ executionPosture: "uncontained-local", devAuth: true, port: 0, home });
      const client = createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
      const browser = await chromium.launch();
      try {
        const remote = join(home, "remote-project");
        await mkdir(join(remote, "src"), { recursive: true });
        await writeFile(join(remote, "src/greet.ts"), 'export const greet = () => "Hello";\n');
        await client.invoke("onboarding.dismiss", { step: "notice" });
        await client.invoke("onboarding.dismiss", { step: "apikey" });
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const local = join(home, "local-project");
        await mkdir(local, { recursive: true });
        await client.invoke("workspace.select", { path: local });

        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(app.url);
        await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
        const dialog = page.getByRole("dialog", { name: "Add workspace" });
        await dialog.waitFor();

        // local stays the default and is unchanged
        expect(await dialog.getByRole("tab", { name: "This computer" }).getAttribute("aria-selected")).toBe("true");
        expect(await dialog.getByLabel("Workspace directory path").count()).toBe(1);

        // keyboard: arrow keys move between the place tabs
        await dialog.getByRole("tab", { name: "This computer" }).focus();
        await page.keyboard.press("ArrowRight");
        expect(await dialog.getByRole("tab", { name: "SSH" }).getAttribute("aria-selected")).toBe("true");

        // nothing can be verified until the form is complete
        const verify = dialog.getByRole("button", { name: "Verify host" });
        expect(await verify.isDisabled()).toBe(true);
        await dialog.getByLabel("SSH host").fill("127.0.0.1");
        await dialog.getByLabel("SSH port").fill(String(fixture.port));
        await dialog.getByLabel("SSH username").fill("dev");
        await dialog.getByText("Password", { exact: true }).click();
        await dialog.getByLabel("SSH password").fill(PASSWORD);
        expect(await verify.isEnabled()).toBe(true);

        // host identity is shown; trusting it is an explicit act; nothing has authenticated yet
        await verify.click();
        const identity = dialog.getByRole("group", { name: "Host identity" });
        await identity.waitFor();
        expect(await identity.innerText()).toContain(fixture.fingerprint);
        expect(await identity.innerText()).toMatch(/not in your known_hosts file/i);
        if (process.env.RW_SHOT) await dialog.screenshot({ path: `${process.env.RW_SHOT}-identity.png` });
        expect(fixture.stats.execs).toBe(0);
        const connect = dialog.getByRole("button", { name: "Trust and connect" });
        expect(await connect.isDisabled()).toBe(true);
        await dialog.getByLabel("I trust this host key").check();
        await connect.click();

        // connected: the folder step opens at the remote home; the password is gone from the page
        await dialog.getByText(/Connected to/).waitFor({ timeout: 15_000 });
        expect(await page.locator("input[type=password]").count()).toBe(0);
        expect(await page.content()).not.toContain(PASSWORD);
        const folder = dialog.getByLabel("Remote folder path");
        expect((await folder.inputValue()).startsWith("/")).toBe(true);
        await folder.fill(remote);
        await dialog.getByRole("button", { name: "Add workspace" }).click();
        await dialog.waitFor({ state: "detached" });

        // the sidebar marks it as remote, with the connection's name
        const row = page.locator(".workspace-row", { hasText: "remote-project" });
        await row.waitFor();
        expect(await row.locator(".workspace-world-badge").innerText()).toMatch(/^SSH · dev@127\.0\.0\.1/);
        // a healthy remote world is quiet
        await page.waitForTimeout(500);
        expect(await page.locator(".world-banner").count()).toBe(0);

        // the agent works in the remote workspace through the same UI as ever
        const composer = page.getByRole("textbox", { name: /Message or run a task/ });
        await composer.fill("[[scenario:multi]] check and change the greeting");
        await composer.press("Enter");
        await page.getByText(/Read greet\.ts, confirmed a clean tree/).waitFor({ timeout: 25_000 });
        expect(await readFile(join(remote, "src/greet.ts"), "utf8")).toContain("Howdy");
        expect(fixture.stats.execs).toBeGreaterThan(0);

        // a saved connection is reusable without retyping credentials
        await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
        const again = page.getByRole("dialog", { name: "Add workspace" });
        await again.getByRole("tab", { name: "SSH" }).click();
        await again.getByRole("group", { name: "Saved connections" }).getByRole("button").first().click();
        await again.getByText(/Connected to/).waitFor({ timeout: 15_000 });
        await again.getByRole("button", { name: "Back" }).click();
        await again.getByRole("button", { name: "Close" }).click();

        // wrong credentials / unreachable host explain what to do (no raw error codes)
        await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
        const bad = page.getByRole("dialog", { name: "Add workspace" });
        await bad.getByRole("tab", { name: "SSH" }).click();
        await bad.getByLabel("SSH host").fill("127.0.0.1");
        const dead = await closedPort();
        await bad.getByLabel("SSH port").fill(String(dead));
        await bad.getByLabel("SSH username").fill("dev");
        await bad.getByRole("button", { name: "Verify host" }).click();
        const alert = bad.getByRole("alert");
        await alert.waitFor();
        expect(await alert.innerText()).toMatch(new RegExp(`Nothing is listening on 127\\.0\\.0\\.1:${dead}`));
        expect(await alert.innerText()).not.toMatch(/ECONNREFUSED/);
        await bad.getByRole("button", { name: "Close" }).click();

        // the WSL tab renders a usable state either way: a distribution picker or a plain explanation
        await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
        const wsl = page.getByRole("dialog", { name: "Add workspace" });
        await wsl.getByRole("tab", { name: "WSL" }).click();
        await wsl.locator('select[aria-label="WSL distribution"], :text("isn\'t available")').first().waitFor({ timeout: 15_000 });
        await wsl.getByRole("button", { name: "Close" }).click();

        // when the remote goes away the failure is loud, explained, and never runs anything locally
        await fixture.close();
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        const banner = page.locator(".world-banner");
        await banner.waitFor({ timeout: 20_000 });
        const text = await banner.innerText();
        expect(text).toMatch(/is unreachable/);
        expect(text).toMatch(/nothing runs on this computer instead/);
        expect(await banner.getByRole("button", { name: "Retry" }).isVisible()).toBe(true);
        if (process.env.RW_SHOT) await page.screenshot({ path: `${process.env.RW_SHOT}-banner.png` });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
        await fixture.close().catch(() => {});
        await aimock.stop();
      }
    });
  }, 180_000);
});
