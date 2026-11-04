// E2E J-BROWSER-session (surface half): the shared browser panel in a real browser. The header
// toggle opens the dock, the canvas paints the managed browser's streamed viewport, the address
// bar navigates through the capability, a canvas click reaches the page (the fixture answers by
// changing its heading, which the snapshot then shows), and the control badge reflects handoffs.
import { describe, expect, test } from "bun:test";
import { bootApp, inv, seedWorkspaceOnly, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";
import type { BrowserRow } from "../src/workbench/state.ts";
import type { Page } from "playwright-core";

const FIXTURE = `<!doctype html><html><head><title>Panel Fixture</title></head><body style="margin:0">
<h1 id="title" style="margin:40vh 0 0 40px">Panel</h1>
<button id="btn" style="position:absolute; left:40px; top:20px; padding:8px 20px" onclick="document.getElementById('title').textContent='Activated'">Press</button>
</body></html>`;

async function launchChromium(): Promise<{ close: () => Promise<void>; page: Page }> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Record what the panel puts on the websocket (frames excluded): the input journey's evidence.
  await page.addInitScript(() => {
    (window as unknown as { __sent: string[] }).__sent = [];
    const original = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data: string | ArrayBuffer) {
      if (typeof data === "string" && !data.includes('"auth"')) {
        (window as unknown as { __sent: string[] }).__sent.push(data.slice(0, 200));
      }
      return original.call(this, data);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return {
    page,
    close: async () => {
      await context.close();
      await browser.close();
      if (errors.length > 0) throw new Error(`page errors: ${errors.join("; ")}`);
    },
  };
}

describe("E2E browser dock", () => {
  test("open panel, see streamed viewport, navigate, click through the canvas", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const fixtureServer = Bun.serve({ port: 0, fetch: () => new Response(FIXTURE, { headers: { "content-type": "text/html" } }) });
      const browser = await launchChromium();
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        await browser.page.goto(app.url);

        await browser.page.getByRole("button", { name: "Show browser" }).click();
        const canvas = browser.page.locator(".browser-canvas");
        await canvas.waitFor({ state: "visible", timeout: 20_000 });

        // The first frame painted: the bitmap takes the streamed viewport's dimensions
        // (a bare canvas element defaults to 300x150, so this waits for a real frame).
        await browser.page.waitForFunction(() => {
          const canvas = document.querySelector(".browser-canvas");
          return canvas instanceof HTMLCanvasElement && canvas.width >= 640;
        }, undefined, { timeout: 25_000 });

        // Navigate through the address bar.
        const address = browser.page.getByRole("textbox", { name: "Browser address" });
        await address.fill(`127.0.0.1:${fixtureServer.port}/`);
        await address.press("Enter");
        await browser.page.waitForFunction(
          (expected) => (document.querySelector(".browser-address input") as HTMLInputElement | null)?.value.includes(expected),
          `127.0.0.1:${fixtureServer.port}`,
          { timeout: 20_000 },
        );

        // The docked panel opened the session; its durable row carries the id the capability needs.
        const row = await waitUntil("a workbench browser row", async () => {
          const rows = await wbRows(app);
          for (const [key, value] of rows) if (key.startsWith("browser/")) return value as BrowserRow;
          return undefined;
        });
        expect(row.status).toBe("running");

        // A person clicks after the page has actually appeared, not when the address bar first
        // moves: the daemon reports the url at navigation start, and a click fired before the
        // fixture document commits lands on the old page. Wait for the fixture to be readable.
        let loaded = false;
        for (let attempt = 0; attempt < 40 && !loaded; attempt++) {
          await Bun.sleep(250);
          const snap = String(await inv(client, "browser.snapshot", { sessionId: row.sessionId }));
          loaded = snap.includes(`button "Press"`);
        }
        expect(loaded).toBe(true);

        // The element box letterboxes the streamed frame with object-fit: contain; convert the
        // fixture button's page position (~(79, 37): absolute at 40,20 with its padding) through
        // the same contained image rect the panel maps clicks with, using the bitmap's real size.
        const box = await canvas.boundingBox();
        const bitmap = await browser.page.evaluate(() => {
          const element = document.querySelector(".browser-canvas");
          return element instanceof HTMLCanvasElement ? { w: element.width, h: element.height } : undefined;
        });
        expect(box).not.toBeNull();
        expect(bitmap).toBeDefined();
        const scale = Math.min(box!.width / bitmap!.w, box!.height / bitmap!.h);
        const offsetX = (box!.width - bitmap!.w * scale) / 2;
        const offsetY = (box!.height - bitmap!.h * scale) / 2;
        await canvas.click({ position: { x: Math.round(offsetX + 79 * scale), y: Math.round(offsetY + 37 * scale) } });
        let activated = false;
        let lastSnap = "";
        for (let attempt = 0; attempt < 16 && !activated; attempt++) {
          await Bun.sleep(500);
          lastSnap = String(await inv(client, "browser.snapshot", { sessionId: row.sessionId }));
          activated = lastSnap.includes("Activated");
        }
        if (!activated) {
          const sent = await browser.page
            .evaluate(() => (window as unknown as { __sent?: string[] }).__sent?.slice(-6))
            .catch(() => undefined);
          throw new Error(`click never reached the fixture; snapshot=${JSON.stringify(lastSnap.slice(0, 200))}; sent=${JSON.stringify(sent)}`);
        }
      } finally {
        void fixtureServer.stop(true);
        await browser.close();
        await app.stop();
      }
    });
  }, 120_000);

  test("inspect mode: click selects without activating; the annotate card records durably", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const fixtureServer = Bun.serve({ port: 0, fetch: () => new Response(FIXTURE, { headers: { "content-type": "text/html" } }) });
      const browser = await launchChromium();
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        await browser.page.goto(app.url);

        await browser.page.getByRole("button", { name: "Show browser" }).click();
        const canvas = browser.page.locator(".browser-canvas");
        await browser.page.waitForFunction(() => {
          const element = document.querySelector(".browser-canvas");
          return element instanceof HTMLCanvasElement && element.width >= 640;
        }, undefined, { timeout: 25_000 });

        // The panel opened the session; its durable row carries the id.
        const row = await waitUntil("a workbench browser row", async () => {
          const rows = await wbRows(app);
          for (const [key, value] of rows) if (key.startsWith("browser/")) return value as BrowserRow;
          return undefined;
        });

        // Navigate the docked panel to the fixture through the address bar (the dock opens on
        // about:blank), and wait for the page to be readable before arming inspect.
        const address = browser.page.getByRole("textbox", { name: "Browser address" });
        await address.fill(`127.0.0.1:${fixtureServer.port}/`);
        await address.press("Enter");
        await browser.page.waitForFunction(
          (expected) => (document.querySelector(".browser-address input") as HTMLInputElement | null)?.value.includes(expected),
          `127.0.0.1:${fixtureServer.port}`,
          { timeout: 20_000 },
        );
        for (let attempt = 0; attempt < 40; attempt++) {
          const snap = String(await inv(client, "browser.snapshot", { sessionId: row.sessionId }));
          if (snap.includes(`button "Press"`)) break;
          await Bun.sleep(250);
        }
        await browser.page.getByRole("button", { name: "Inspect", exact: true }).click();
        await browser.page.getByText("Click an element in the page to select it").waitFor({ state: "visible", timeout: 10_000 });

        // Click the fixture button through the canvas (letterbox-corrected position of the
        // absolute button at (40,20)); in inspect mode this selects instead of activating.
        const box = await canvas.boundingBox();
        const bitmap = await browser.page.evaluate(() => {
          const element = document.querySelector(".browser-canvas");
          return element instanceof HTMLCanvasElement ? { w: element.width, h: element.height } : undefined;
        });
        const scale = Math.min(box!.width / bitmap!.w, box!.height / bitmap!.h);
        const offsetX = (box!.width - bitmap!.w * scale) / 2;
        const offsetY = (box!.height - bitmap!.h * scale) / 2;
        await canvas.click({ position: { x: Math.round(offsetX + 79 * scale), y: Math.round(offsetY + 37 * scale) } });
        await browser.page.locator(".browser-annotate").waitFor({ state: "visible", timeout: 12_000 });
        const headText = await browser.page.locator(".browser-annotate-head").innerText();
        expect(headText).toContain("button");

        // The select-click must not have activated the fixture.
        const snap = String(await inv(client, "browser.snapshot", { sessionId: row.sessionId }));
        expect(snap).toContain("Panel");
        expect(snap).not.toContain("Activated");

        // A note recorded through the panel folds durably; submitting clears the card.
        await browser.page.getByRole("textbox", { name: "Annotation note" }).fill("E2E annotation note");
        await browser.page.getByRole("button", { name: "Record only" }).click();
        await waitUntil("the E2E annotation row", async () => {
          const rows = await wbRows(app);
          const current = rows.get(`browser/${row.sessionId}`) as BrowserRow | undefined;
          return current?.annotations?.some((annotation) => annotation.note === "E2E annotation note") ? current : undefined;
        });
        await browser.page.locator(".browser-annotate").waitFor({ state: "hidden", timeout: 5000 });
      } finally {
        void fixtureServer.stop(true);
        await browser.close();
        await app.stop();
      }
    });
  }, 120_000);
});
