// Browser acceptance for Mobile Remote Control: a real server, the aimock model, real Chromium through
// playwright-core. The desktop starts remote from its sidebar and reads the pairing link. The "phone" is a
// mobile-emulated Chromium context with a CDP VIRTUAL AUTHENTICATOR (a simulated passkey, not a real device).
// Skipped with a stated reason when the Chromium build is not installed.
import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { LOCAL_OPERATOR, bootApp, bootAimock, inv, seed, withTempHome } from "./wb-helpers.ts";

const HAVE_BROWSER = existsSync(chromium.executablePath());
const SKIP_REASON = `Chromium is not installed at ${chromium.executablePath()} (run: bunx playwright install chromium)`;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** A phone: mobile-emulated context plus a CDP virtual authenticator (simulated passkey, user verified). */
async function phoneContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page };
}

/** Poll a probe until it returns a truthy value (bun's expect has no poll). */
async function until<T>(what: string, probe: () => Promise<T | false | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await Bun.sleep(100);
  }
}

const phoneTitle = (page: Page, text: string) => page.locator(".m-top-title", { hasText: text });

describe("E2E mobile remote control", () => {
  (HAVE_BROWSER ? test : test.skip)(
    `pair from the desktop, see and steer sessions from the phone, approve from the phone, re-authenticate, replace and stop (${HAVE_BROWSER ? "chromium" : SKIP_REASON})`,
    async () => {
      await withTempHome(async (home) => {
          const previousPort = process.env.COGNATE_REMOTE_PORT;
          process.env.COGNATE_REMOTE_PORT = "0";
          const aimock = await bootAimock();
          const { app, client } = await bootApp(home);
          const browser = await chromium.launch();
          const errors: string[] = [];
          try {
            await inv(client, "onboarding.dismiss", { step: "notice" });
            await inv(client, "onboarding.dismiss", { step: "apikey" });
            const { workspaceId } = await seed(client, home, aimock.port);

            // ---- Desktop: enable remote from the sidebar and read the pairing link ----
            const desktop = await browser.newPage({ viewport: { width: 1280, height: 860 } });
            desktop.on("pageerror", (e) => errors.push(e.message));
            await desktop.goto(app.url);
            await desktop.getByRole("button", { name: "Mobile remote control" }).click();
            const dialog = desktop.getByRole("dialog", { name: "Control from your phone" });
            await dialog.getByRole("button", { name: "Turn on remote control" }).click();
            const link = dialog.getByLabel("Pairing link", { exact: true });
            const pairing = await until("the pairing link", async () => {
              const value = await link.inputValue().catch(() => "");
              return /^http:\/\/localhost:\d+\/m#p=[A-Za-z0-9_-]{43}$/.test(value) && value;
            }, 10_000);
            expect(await dialog.getByRole("img", { name: "QR code for the phone pairing link" }).count()).toBe(1);
            await dialog.getByRole("button", { name: "Close" }).click();
            expect(await desktop.getByRole("dialog").count()).toBe(0);
            // Closing the dialog does not stop remote: the indicator stays in the sidebar.
            await desktop.getByRole("button", { name: "Mobile remote control" }).click();
            await desktop.getByRole("dialog").getByText("Waiting for phone").waitFor();
            await desktop.getByRole("dialog").getByRole("button", { name: "Close" }).click();

            // ---- Phone 1: pair with the link, register a passkey, land on Home ----
            const phone1 = await phoneContext(browser);
            await phone1.page.goto(pairing);
            await phoneTitle(phone1.page, "Sessions").waitFor({ timeout: 20_000 });
            expect(phone1.page.url()).not.toContain("#p=");
            expect(phone1.page.url()).not.toContain("p=");
            const cookies = await phone1.context.cookies();
            const session = cookies.find((c) => c.name === "__Host-wb_remote");
            expect(session?.httpOnly).toBe(true);
            expect(session?.secure).toBe(true);
            expect(session?.sameSite).toBe("Strict");
            // Reopen the dialog to see the phone connected (closing it never stopped remote).
            await desktop.getByRole("button", { name: "Mobile remote control" }).click();
            const desktopDialog = desktop.getByRole("dialog");
            await desktopDialog.getByText("Phone connected").waitFor({ timeout: 10_000 });

            // The phone is already open on Home: a session created on the desktop reaches it with no reload.
            const before = await phone1.page.locator(".m-session").count();
            const created = (await inv(client, "session.create", { workspaceId, requestId: crypto.randomUUID() })) as { sessionId: string };
            await until("the desktop session on the phone", async () => (await phone1.page.locator(".m-session").count()) > before);

            // ---- Phone: send a turn, see the reply; the desktop has the same turn ----
            await phone1.page.locator(".m-session").first().click();
            await phone1.page.getByLabel("Message").fill("[[scenario:read]]");
            await phone1.page.getByRole("button", { name: "Send" }).click();
            await phone1.page.getByText("Turn sent.").waitFor({ timeout: 10_000 });
            await phone1.page.getByText("The README describes a tiny fixture project").waitFor({ timeout: 30_000 });
            const history = JSON.stringify(await inv(client, "session.history", { sessionId: created.sessionId }));
            expect(history).toContain("[[scenario:read]]");
            expect(history).toContain("The README describes a tiny fixture project");

            // ---- Approve a tool call from the phone (never automatic) ----
            // Read-only mode and the ptc preset (which carries run_code) make the escalated run_code call open
            // a tool-approval continuation, as in J-D-approval. The settings fold must land before the phone's turn.
            await inv(client, "settings.changePermission", { permission: "read-only" });
            await inv(client, "settings.changePreset", { preset: "ptc" });
            await until("the approval settings fold", async () => (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows.some((r) => { const v = r.value as { permission?: unknown; preset?: unknown }; return v.permission === "read-only" && v.preset === "ptc"; }));
            await phone1.page.getByRole("button", { name: "Back to sessions" }).click();
            await phone1.page.locator(".m-session").first().click();
            await phone1.page.getByLabel("Message").fill("[[scenario:approval]]");
            await phone1.page.getByRole("button", { name: "Send" }).click();
            await phone1.page.getByRole("button", { name: "Back to sessions" }).click();
            await phone1.page.getByRole("button", { name: /Decisions \(1\)/ }).waitFor({ timeout: 30_000 });
            await phone1.page.getByRole("button", { name: /Decisions/ }).click();
            await phone1.page.getByRole("button", { name: "Approve" }).click();
            await phone1.page.getByText(/^Approved: /).waitFor({ timeout: 10_000 });
            // The tool result arrives on the session timeline (the desktop approved the same continuation).
            await phone1.page.getByRole("button", { name: "Sessions", exact: true }).click();
            await phone1.page.locator(".m-session").first().click();
            await phone1.page.getByText("run_code completed with no output").waitFor({ timeout: 30_000 });

            // ---- Reload and re-authenticate with the passkey (cookie removed) ----
            await phone1.context.clearCookies();
            await phone1.page.reload();
            await phoneTitle(phone1.page, "Sessions").waitFor({ timeout: 20_000 });

            // ---- Replace the phone: phone 1 is revoked; phone 2 pairs with the new link ----
            await desktopDialog.getByRole("button", { name: "Replace phone" }).click();
            const replacement = await until("the replacement link", async () => {
              const value = await desktopDialog.getByLabel("Pairing link", { exact: true }).inputValue().catch(() => "");
              return /#p=/.test(value) && value;
            });
            expect(await phone1.page.evaluate(() => fetch("/m/api/snapshot").then((r) => r.status))).toBe(401);
            const phone2 = await phoneContext(browser);
            await phone2.page.goto(replacement);
            await phoneTitle(phone2.page, "Sessions").waitFor({ timeout: 20_000 });
            await desktopDialog.getByText("Phone connected").waitFor({ timeout: 10_000 });
            await phone1.page.reload();
            await phone1.page.getByText(/no longer accepted/).waitFor({ timeout: 20_000 });

            // ---- Phone 2 at 320px: no horizontal overflow, the fragment never persisted ----
            await phone2.page.setViewportSize({ width: 320, height: 640 });
            const overflow = await phone2.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow).toBeLessThanOrEqual(0);

            // ---- Stop: immediate revocation, listener closed ----
            await desktopDialog.getByRole("button", { name: "Stop" }).click();
            await desktop.getByRole("dialog").getByRole("button", { name: "Turn on remote control" }).waitFor({ timeout: 10_000 });
            const after = await phone2.page.evaluate(() => fetch("/m/api/snapshot").then(() => "answered", () => "refused"));
            expect(after).toBe("refused");

            await phone1.context.close();
            await phone2.context.close();
            await desktop.close();
            expect(errors).toEqual([]);
          } finally {
            await browser.close();
            await aimock.stop();
            await app.stop();
            if (previousPort === undefined) delete process.env.COGNATE_REMOTE_PORT;
            else process.env.COGNATE_REMOTE_PORT = previousPort;
          }
      });
    },
    240_000,
  );
});
