// U5 agent-harness UX in a real browser with the fake CLIs from test/fixtures/harness on PATH:
// Settings -> Agents lists them, a session is bound to the fake `claude` from the composer's Agent
// chip, a turn streams text + a tool call + an approval in the ApprovalBar, approve and deny both
// finish, and an auth failure shows the CLI's sign-in hint.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { bootHarnessApp, makeFakeHost, type FakeHost } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

type Booted = Awaited<ReturnType<typeof bootHarnessApp>>;

async function withHarnessPage(fn: (page: Page, ctx: Booted & { host: FakeHost }) => Promise<void>) {
  const host = await makeFakeHost();
  await withTempHome(async (home) => {
    const booted = await bootHarnessApp(home, host);
    const { app, client } = booted;
    await client.invoke("model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59993/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" } as never);
    await client.invoke("onboarding.dismiss", { step: "notice" } as never);
    await client.invoke("onboarding.dismiss", { step: "apikey" } as never);
    await client.invoke("workspace.select", { path: host.workspace } as never);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(app.url);
      await fn(page, { ...booted, host });
    } finally {
      await browser.close();
      await client.close();
      await app.stop();
    }
  });
  await rm(host.dir, { recursive: true, force: true });
}

async function pickAgent(page: Page, name: string, mode?: string) {
  await page.getByRole("button", { name: /^Agent: / }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
  if (mode) await page.getByRole("menuitemradio", { name: new RegExp(`^${mode}`) }).click();
  await page.keyboard.press("Escape");
}

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
  await composer.fill(text);
  await composer.press("Enter");
}

describe("J-HARNESS-detect E2E Settings -> Agents", () => {
  test("lists the native agent and the CLIs on PATH with version, path and approvals; missing CLIs get an install hint with a copy button", async () => {
    await withHarnessPage(async (page, { host }) => {
      await page.getByRole("button", { name: "Settings" }).first().click();
      await page.getByRole("tab", { name: "Agents" }).click();
      const list = page.getByRole("list", { name: "Agents" });
      await list.locator('[data-harness="native"]').waitFor();
      const claude = list.locator('[data-harness="claude"]');
      await claude.waitFor();
      expect(await claude.textContent()).toContain("Installed");
      expect(await claude.textContent()).toContain("claude 1.2.3 (fake)");
      expect(await claude.textContent()).toContain(join(host.binDir, "claude"));
      expect(await claude.textContent()).toContain("Tool calls ask you in Workbench");
      await list.locator('[data-harness="codex"]').getByText("Installed").waitFor();
      const kimi = list.locator('[data-harness="kimi"]');
      await kimi.getByText("Not installed").waitFor();
      await kimi.getByRole("link", { name: /^Install / }).waitFor();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await list.locator('[data-harness="claude"]').getByText("Installed").waitFor();
    });
  }, 90_000);
});

describe("J-HARNESS-session E2E bind a session to a CLI", () => {
  test("pick Claude Code on the hero composer, send; the sidebar and breadcrumb name it and the posture notice is shown", async () => {
    await withHarnessPage(async (page) => {
      await page.getByRole("button", { name: /^Agent: Cognate \(native\)/ }).waitFor();
      await pickAgent(page, "Claude Code", "Standard");
      const notice = page.getByRole("note").filter({ hasText: "Runs Claude Code on this computer" });
      await notice.waitFor();
      expect(await notice.textContent()).toContain("ask you here for approval");
      expect(await notice.textContent()).toContain("containment and evidence checks don't apply");
      await send(page, "hello there");
      await page.getByText("Looking at it.").first().waitFor({ timeout: 20_000 });
      await page.getByRole("tree", { name: "Sessions" }).getByLabel("Agent: Claude Code").first().waitFor();
      expect(await page.getByRole("navigation", { name: "Session hierarchy" }).textContent()).toContain("Claude Code");
      // Full access is a warning, not a quiet default.
      await pickAgent(page, "Claude Code", "Full access");
      await page.locator('[data-agent-notice="full"]').waitFor();
      expect(await page.locator('[data-agent-notice="full"]').textContent()).toMatch(/without asking you/);
    });
  }, 90_000);
});

describe("J-HARNESS-approval E2E approvals bridged into the ApprovalBar", () => {
  for (const approve of [true, false]) {
    test(`${approve ? "approve" : "deny"}: a tool call asks in the ApprovalBar and the turn completes`, async () => {
      await withHarnessPage(async (page) => {
        await pickAgent(page, "Claude Code", "Standard");
        await send(page, "please ask then edit hello.txt");
        await page.getByText("Looking at it.").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: "Allow once" }).waitFor({ timeout: 20_000 });
        await page.screenshot({ path: join(import.meta.dir, "..", ".agents/reports/ui-production-readiness/evidence/after/u5/e2e-harness-approval.png") }).catch(() => undefined);
        await page.getByRole("button", { name: approve ? "Allow once" : "Reject" }).click();
        await page.getByText(approve ? "Done." : "Understood, not editing.").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: "Allow once" }).waitFor({ state: "detached" });
      });
    }, 90_000);
  }

  test("AUTH_REQUIRED shows the CLI's sign-in hint", async () => {
    await withHarnessPage(async (page) => {
      await pickAgent(page, "Claude Code", "Standard");
      await send(page, "authfail please");
      await page.getByText("This turn failed").waitFor({ timeout: 20_000 });
      await page.locator('[data-harness-hint="sign-in"]').waitFor();
      expect(await page.locator('[data-harness-hint="sign-in"]').textContent()).toContain("Sign in to Claude Code");
      expect(await page.locator(".failure-code").textContent()).toBe("AUTH_REQUIRED");
    });
  }, 90_000);
});
