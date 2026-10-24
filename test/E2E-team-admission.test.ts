import { expect, test } from "bun:test";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { collaborationResponder, invoke, waitForState, withExpertApp } from "./expert-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "concurrency");

test("J-TEAM-ADMISSION: browser shows the effective Team admission policy and serialized reasons", async () => {
  await withExpertApp(collaborationResponder, async (app) => {
    await invoke(app, "onboarding.dismiss", { step: "notice" });
    await invoke(app, "onboarding.dismiss", { step: "apikey" });
    const browser = await chromium.launch();
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(app.app.url, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
      await page.getByRole("heading", { name: "Native execution capacity", exact: true }).waitFor();
      // The runtime inspection states the effective Team policy truthfully.
      await page.getByText(/Team runs follow each Team’s authoritative admission policy/).waitFor();
      // The Team editor exposes the authoritative policy fields and the serialized reason.
      await page.getByRole("list", { name: "Teams", exact: true }).getByRole("button", { name: /Cognate Team/ }).click();
      await page.getByRole("button", { name: "Edit Team", exact: true }).click();
      await page.getByLabel("Maximum concurrent runs", { exact: true }).waitFor();
      await page.getByLabel("Admission batch", { exact: true }).waitFor();
      await page.getByText(/Effective admission policy/).waitFor();
      await page.getByText(/Runs beyond the limit are serialized and wait for a free slot even when host capacity is free/).waitFor();

      // Changing the policy in the editor persists to authoritative Team metadata only.
      await page.getByLabel("Maximum concurrent runs", { exact: true }).fill("3");
      await page.getByRole("button", { name: "Save Team", exact: true }).click();
      const state = await waitForState(app, (snapshot) => snapshot.teams["cognate-team"]!.limits.maxConcurrentRuns === 3, "Team policy saved");
      expect(state.teams["cognate-team"]!.limits.admissionBatch).toBe(1);
      await page.screenshot({ path: join(SHOTS, "team-admission-policy.png"), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await browser.close().catch(() => {});
    }
  }, { runCapacity: 2 });
}, 120_000);
