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

/**
 * On a session view: scrolled to the end, the last message ends above the composer (no overlap), and
 * "Jump to latest" is hittable when the timeline is long enough to need it. Hit-tested, not just measured:
 * a trial click fails if anything else sits on top of the button.
 */
async function expectClearOfComposer(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const geometry = await until("the timeline at its end", async () => {
    const value = await page.evaluate(() => {
      const bubbles = document.querySelectorAll(".m-session-view .m-bubble");
      const last = bubbles[bubbles.length - 1];
      const composer = document.querySelector(".m-composer");
      if (!last || !composer) return null;
      const atEnd = document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 2;
      return { bubbleBottom: last.getBoundingClientRect().bottom, composerTop: composer.getBoundingClientRect().top, atEnd };
    });
    return value?.atEnd ? value : false;
  });
  expect(geometry.bubbleBottom).toBeLessThanOrEqual(geometry.composerTop + 1);
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 100);
  await page.evaluate(() => window.scrollTo(0, 0));
  const jump = page.getByRole("button", { name: "Jump to latest" });
  if (scrollable) {
    await jump.waitFor({ timeout: 5_000 });
    await jump.click({ trial: true });
    await jump.click();
    await until("the jump lands at the end", async () => (await page.evaluate(() => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 2)) || false);
  }
}

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
            // The card says what would run (bounded arguments), not just the decision type.
            expect((await phone1.page.locator(".m-detail").first().innerText()).length).toBeGreaterThan(2);
            await phone1.page.getByRole("button", { name: "Approve" }).click();
            await phone1.page.getByText(/^Approved: /).waitFor({ timeout: 10_000 });
            // The tool result arrives on the session timeline (the desktop approved the same continuation).
            await phone1.page.getByRole("button", { name: "Sessions", exact: true }).click();
            await phone1.page.locator(".m-session").first().click();
            await phone1.page.getByText("run_code completed with no output").waitFor({ timeout: 30_000 });
            // Phone 1 at 390x844: the last message clears the composer, and "Jump to latest" is hittable.
            await expectClearOfComposer(phone1.page);

            // ---- Reload and re-authenticate with the passkey (cookie removed) ----
            await phone1.context.clearCookies();
            await phone1.page.reload();
            await phoneTitle(phone1.page, "Sessions").waitFor({ timeout: 20_000 });

            // ---- Replace the phone: phone 1 is revoked; phone 2 pairs with the new link ----
            // Revocation is itself a change signal, so phone 1 would re-check on its own right away. To prove the
            // tap path, phone 1 is offline while the phone is replaced (it hears nothing), and its stream
            // reconnect is held once it is back online. The first request that finds the revocation is the Send tap.
            await phone1.page.locator(".m-session").first().click();
            await phone1.page.getByLabel("Message").fill("sent after the replacement");
            await phone1.page.route("**/m/api/events", () => undefined);
            await phone1.context.setOffline(true);
            await desktopDialog.getByRole("button", { name: "Replace phone" }).click();
            const replacement = await until("the replacement link", async () => {
              const value = await desktopDialog.getByLabel("Pairing link", { exact: true }).inputValue().catch(() => "");
              return /#p=/.test(value) && value;
            });
            const phone2 = await phoneContext(browser);
            await phone2.page.goto(replacement);
            await phoneTitle(phone2.page, "Sessions").waitFor({ timeout: 20_000 });
            await desktopDialog.getByText("Phone connected").waitFor({ timeout: 10_000 });
            await phone1.context.setOffline(false);
            expect(await phone1.page.evaluate(() => fetch("/m/api/snapshot").then((r) => r.status))).toBe(401);
            // The tap on Send is refused as a revoked session, and the phone lands on the passkey screen.
            await phone1.page.getByRole("button", { name: "Send" }).click();
            await phone1.page.getByText(/no longer accepted/).waitFor({ timeout: 20_000 });
            await phone1.page.reload();
            await phone1.page.getByText(/no longer accepted/).waitFor({ timeout: 20_000 });

            // ---- Phone 2 at 320px: no horizontal overflow, the composer clears the messages, the fragment never persisted ----
            await phone2.page.setViewportSize({ width: 320, height: 640 });
            const overflow = await phone2.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow).toBeLessThanOrEqual(0);
            await phone2.page.locator(".m-session").first().click();
            await phone2.page.locator(".m-session-view .m-composer").waitFor({ timeout: 10_000 });
            await expectClearOfComposer(phone2.page);

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
