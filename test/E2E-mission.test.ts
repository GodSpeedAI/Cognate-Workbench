// T12 mission journey, end to end in one real process pair: an agent builds and serves a web
// app through governed bash execution; the preview is registered governed and readiness-probed;
// the operator opens it in the shared browser dock, arms inspect mode, selects the heading with
// a click that cannot activate anything, annotates it, and the annotation message reaches the
// model (real aimock journal); the agent's edit lands in the served file; an explicit refresh in
// the SAME browser workspace shows the change. This is the original success criterion.
import { describe, expect, test } from "bun:test";
import { bootApp, bootAimock, inv, aimockChatRequests, LOCAL_OPERATOR, seedWorkspaceOnly, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";
import { randomUUID } from "node:crypto";
import { annotationIsStale, type BrowserRow, type PreviewRow } from "../src/workbench/state.ts";
import type { Page } from "playwright-core";

/** The mission port is fixed in the static aimock fixture (the fixture authors the bash). */
const MISSION_PORT = 47190;
const MISSION_URL = `http://127.0.0.1:${MISSION_PORT}/`;

/** Kill any listener on the mission port left by an earlier attempt (the agent's bash-spawned
 *  server is detached on purpose — the Workbench does not own that pid). */
function reclaimMissionPort(): void {
  Bun.spawnSync(["fuser", "-k", `${MISSION_PORT}/tcp`], { stdout: "ignore", stderr: "ignore" });
}

async function launchChromium(): Promise<{ close: () => Promise<void>; page: Page }> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

describe("E2E mission", () => {
  test("agent builds → preview registered → operator inspects and annotates → agent fixes → same browser shows it", async () => {
    await withTempHome(async (home) => {
      reclaimMissionPort();
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const browser = await launchChromium();
      try {
        // One workspace, one configured model: everything downstream flows through them.
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });

        // --- 1. the agent builds and serves the app (governed bash execution)
        const sessionId = randomUUID();
        const build = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "Build a tiny web app and serve it locally. [[scenario:mission-build]]" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const settled = await waitUntil("run completion", async () => {
          const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: build.runId });
          return ["completed", "failed", "cancelled"].includes(run.status) ? run : undefined;
        }, 90_000).catch(async (error) => {
          const stuck = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: build.runId });
          const requests = await aimockChatRequests(aimock.port).catch(() => []);
          throw new Error(`build run never settled (status ${stuck.status}); journal=${JSON.stringify(requests.map((q) => ({ status: q.response.status, turns: q.body.messages?.length })))}; source=${error.message}`);
        });
        expect(settled.status).toBe("completed");
        let serving = "";
        for (let attempt = 0; attempt < 40 && !serving; attempt++) {
          try {
            serving = await fetch(MISSION_URL, { signal: AbortSignal.timeout(1000) }).then((r) => r.text());
          } catch {
            await Bun.sleep(300);
          }
        }
        expect(serving).toContain("Mission Draft");
        const stillServing = async (label: string): Promise<void> => {
          try {
            const text = await fetch(MISSION_URL, { signal: AbortSignal.timeout(1000) }).then((r) => r.text());
            if (!text.includes("Mission")) throw new Error(`${label}: serving stale content`);
          } catch (error) {
            throw new Error(`${label}: the mission server died — ${(error as Error).message}`);
          }
        };

        // --- 2. the preview is registered governed; readiness is probed before "ready"
        await stillServing("before register");
        const preview = (await inv(client, "preview.register", { url: MISSION_URL, workspaceId, ownerSessionId: sessionId })) as unknown as { previewId: string; status: string; viewUrl: string };
        expect(preview.status).toBe("ready");
        await stillServing("after register");
        const previewRow = await waitUntil("preview row", async () => {
          const rows = await wbRows(app);
          return rows.get(`preview/${preview.previewId}`) as PreviewRow | undefined;
        });
        expect(previewRow.viewUrl).toBe(MISSION_URL);

        // --- 3. the operator opens the preview in the shared browser dock
        await browser.page.goto(app.url);
        await browser.page.getByRole("button", { name: "Show browser" }).click();
        const canvas = browser.page.locator(".browser-canvas");
        await browser.page.waitForFunction(() => {
          const element = document.querySelector(".browser-canvas");
          return element instanceof HTMLCanvasElement && element.width >= 640;
        }, undefined, { timeout: 25_000 });
        const browserRow = await waitUntil("browser row", async () => {
          const rows = await wbRows(app);
          for (const [key, value] of rows) if (key.startsWith("browser/")) return value as BrowserRow;
          return undefined;
        });

        await stillServing("before dock nav");
        // Navigate the dock to the preview through the address bar; wait for the app to render.
        const address = browser.page.getByRole("textbox", { name: "Browser address" });
        await address.fill(`127.0.0.1:${MISSION_PORT}`);
        await address.press("Enter");
        let readable = false;
        let lastSnap = "";
        for (let attempt = 0; attempt < 40 && !readable; attempt++) {
          await Bun.sleep(250);
          lastSnap = String(await inv(client, "browser.snapshot", { sessionId: browserRow.sessionId }));
          readable = lastSnap.includes("Mission Draft");
        }
        if (!readable) {
          const addressValue = await browser.page.evaluate(() => (document.querySelector(".browser-address input") as HTMLInputElement | null)?.value);
          let missionState = "fetch failed";
          try { missionState = (await fetch(MISSION_URL, { signal: AbortSignal.timeout(1000) }).then((r) => r.text())).slice(0, 80); } catch (error) { missionState = `dead: ${(error as Error).message.slice(0, 60)}`; }
          throw new Error(`the dock never showed the mission app; mission=${JSON.stringify(missionState)}; address=${JSON.stringify(addressValue)}; snapshot=${JSON.stringify(lastSnap.slice(0, 200))}`);
        }

        // --- 4. inspect: select the heading without activating anything
        await browser.page.getByRole("button", { name: "Inspect", exact: true }).click();
        await browser.page.getByText("Click an element in the page to select it").waitFor({ state: "visible", timeout: 10_000 });
        const box = await canvas.boundingBox();
        const bitmap = await browser.page.evaluate(() => {
          const element = document.querySelector(".browser-canvas");
          return element instanceof HTMLCanvasElement ? { w: element.width, h: element.height } : undefined;
        });
        const scale = Math.min(box!.width / bitmap!.w, box!.height / bitmap!.h);
        const offsetX = (box!.width - bitmap!.w * scale) / 2;
        const offsetY = (box!.height - bitmap!.h * scale) / 2;
        // The heading sits at the top-left of the page (~(8, 29) center for default margins).
        await canvas.click({ position: { x: Math.round(offsetX + 70 * scale), y: Math.round(offsetY + 29 * scale) } });
        await browser.page.locator(".browser-annotate").waitFor({ state: "visible", timeout: 12_000 });
        const headText = await browser.page.locator(".browser-annotate-head").innerText();
        expect(headText).toContain("heading");

        // --- 5. annotate and send into the active conversation
        await browser.page.getByRole("textbox", { name: "Annotation note" }).fill("Change the heading to MISSION FIXED [[scenario:mission-fix]]");
        await browser.page.getByRole("button", { name: "Send to conversation" }).click();
        const annotatedRow = await waitUntil("annotation row", async () => {
          const rows = await wbRows(app);
          const current = rows.get(`browser/${browserRow.sessionId}`) as BrowserRow | undefined;
          return current?.annotations?.length ? current : undefined;
        });
        expect(annotatedRow.annotations![0]!.note).toContain("MISSION FIXED");
        expect(annotationIsStale(annotatedRow.annotations![0]!, annotatedRow)).toBe(false);

        // The model received the annotation payload (the model's own journal).
        let received = "";
        for (let attempt = 0; attempt < 120 && !received; attempt++) {
          await Bun.sleep(500);
          const requests = await aimockChatRequests(aimock.port);
          for (const request of requests) {
            const userMessage = request.body.messages?.find((m) => m.role === "user");
            const content = userMessage?.content;
            const text = typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content.map((part) => (typeof part === "object" && part !== null && "text" in part) ? String((part as { text: unknown }).text) : "").join(" ")
                : "";
            if (text.includes("Browser annotation")) received = text;
          }
        }
        expect(received).toContain("[[scenario:mission-fix]]");

        // --- 6. the agent's edit lands in the served file
        let fixed = false;
        for (let attempt = 0; attempt < 60 && !fixed; attempt++) {
          await Bun.sleep(500);
          try {
            fixed = (await fetch(MISSION_URL, { signal: AbortSignal.timeout(1000) }).then((r) => r.text())).includes("MISSION FIXED");
          } catch { /* still serving the old bytes */ }
        }
        expect(fixed).toBe(true);

        // --- 7. explicit refresh in the SAME browser workspace shows the change
        await address.fill(`127.0.0.1:${MISSION_PORT}`);
        await address.press("Enter");
        let shown = false;
        for (let attempt = 0; attempt < 40 && !shown; attempt++) {
          await Bun.sleep(250);
          shown = String(await inv(client, "browser.snapshot", { sessionId: browserRow.sessionId })).includes("MISSION FIXED");
        }
        expect(shown).toBe(true);

        // The durable mission record: preview ready (or stopped), annotation attached, url trails.
        const rows = await wbRows(app);
        expect([...rows.keys()].some((key) => key.startsWith("preview/"))).toBe(true);
        expect([...rows.keys()].some((key) => key.startsWith("browser/"))).toBe(true);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
        reclaimMissionPort();
      }
    });
  }, 240_000);
});
