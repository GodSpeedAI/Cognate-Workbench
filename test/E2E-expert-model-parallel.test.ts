import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { invoke, route, waitForAssignment, waitForState, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "concurrency");

function gatedResponder() {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const entered: string[] = [];
  let active = 0;
  let peak = 0;
  const responder: FakeResponder = async (selectedRoute) => {
    active++;
    peak = Math.max(peak, active);
    entered.push(selectedRoute.model);
    try {
      await gate;
      return {
        message: { role: "assistant", content: `${selectedRoute.model}: parallel review complete.` },
        toolCalls: [], finishReason: "stop", model: selectedRoute.model,
      } satisfies ModelResponse;
    } finally {
      active--;
    }
  };
  return { responder, entered, peak: () => peak, release: () => releaseGate() };
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(15);
  }
}

async function openExpertChat(page: import("playwright-core").Page, name: "Builder" | "Critic", objective: string): Promise<void> {
  const capacityHeading = page.getByRole("heading", { name: "Native execution capacity", exact: true });
  if (!(await capacityHeading.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
    await capacityHeading.waitFor();
  }
  await page.getByRole("list", { name: "Experts", exact: true }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("button", { name: "Open solo conversation", exact: true }).click();
  await page.getByLabel("Message the Expert", { exact: true }).fill(objective);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

test("J-EXPERT-MODEL-PARALLEL: browser-visible capacity matches two real model-only Expert overlaps", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await invoke(app, "onboarding.dismiss", { step: "notice" });
    await invoke(app, "onboarding.dismiss", { step: "apikey" });
    const current = await app.state();
    for (const [expertId, model] of [["builder", "builder-parallel-model"], ["critic", "critic-parallel-model"]] as const) {
      const expert = current.experts[expertId]!;
      await invoke(app, "expert.save", {
        expertId,
        name: expert.name,
        specialization: expert.definition.specialization,
        instructions: expert.definition.instructions,
        tools: [],
        route: route(model),
      });
    }

    const inspection = await invoke(app, "execution.runtime.inspect", {}) as { configuredCapacity: number; admissionPolicy: string };
    expect(inspection).toEqual({ configuredCapacity: 2, admissionPolicy: "model-only-parallel" });

    const browser = await chromium.launch();
    const errors: string[] = [];
    const assignments: { builder?: string; critic?: string } = {};
    try {
      await mkdir(SHOTS, { recursive: true });
      const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      desktop.setDefaultTimeout(15_000);
      desktop.on("pageerror", (error) => errors.push(error.message));
      desktop.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await desktop.goto(app.app.url, { waitUntil: "domcontentloaded" });
      await desktop.getByRole("button", { name: "Experts and Teams", exact: true }).click();
      await desktop.getByText("Configured capacity: 2 concurrent runs", { exact: true }).waitFor();
      await desktop.getByText(/Model-only solo Experts and Team Specialists may overlap/).waitFor();
      await desktop.getByText(/Tool-bearing work is admitted per canonical workspace/).waitFor();
      expect(await desktop.getByRole("button", { name: /capacity|concurrency/i }).count()).toBe(0);

      await openExpertChat(desktop, "Builder", "Review the first independent objective.");
      await waitUntil(() => gate.entered.length === 1, "Builder provider request");
      const builderAssignment = await waitForState(app, (state) => Object.values(state.assignments).some((assignment) => assignment.expertId === "builder" && assignment.purpose === "Review the first independent objective."), "Builder assignment");
      assignments.builder = Object.values(builderAssignment.assignments).find((assignment) => assignment.expertId === "builder" && assignment.purpose === "Review the first independent objective.")!.id;

      const secondPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      secondPage.setDefaultTimeout(15_000);
      secondPage.on("pageerror", (error) => errors.push(error.message));
      secondPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await secondPage.goto(app.app.url, { waitUntil: "domcontentloaded" });
      await openExpertChat(secondPage, "Critic", "Review the second independent objective.");
      await waitUntil(() => gate.entered.length === 2, "Critic provider request overlapping Builder");
      expect(gate.peak()).toBe(2);
      expect(gate.entered).toEqual(["builder-parallel-model", "critic-parallel-model"]);
      const criticAssignment = await waitForState(app, (state) => Object.values(state.assignments).some((assignment) => assignment.expertId === "critic" && assignment.purpose === "Review the second independent objective."), "Critic assignment");
      assignments.critic = Object.values(criticAssignment.assignments).find((assignment) => assignment.expertId === "critic" && assignment.purpose === "Review the second independent objective.")!.id;

      await desktop.screenshot({ path: join(SHOTS, "model-parallel-desktop.png"), fullPage: true });
      gate.release();
      await Promise.all([
        desktop.locator(".experts-transcript").getByText("builder-parallel-model: parallel review complete.", { exact: true }).waitFor(),
        secondPage.locator(".experts-transcript").getByText("critic-parallel-model: parallel review complete.", { exact: true }).waitFor(),
      ]);
      const [builderDone, criticDone] = await Promise.all([
        waitForAssignment(app, assignments.builder!, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
        waitForAssignment(app, assignments.critic!, (assignment) => !!assignment.handoff && !["queued", "running", "waiting"].includes(assignment.status)),
      ]);
      expect(builderDone.execution.tools).toEqual(["expert_return"]);
      expect(criticDone.execution.tools).toEqual(["expert_return"]);
      expect(builderDone.handoff?.output).toContain("builder-parallel-model: parallel review complete.");
      expect(criticDone.handoff?.output).toContain("critic-parallel-model: parallel review complete.");

      const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
      mobile.setDefaultTimeout(15_000);
      mobile.on("pageerror", (error) => errors.push(error.message));
      mobile.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await mobile.goto(app.app.url, { waitUntil: "domcontentloaded" });
      await mobile.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      await mobile.getByRole("button", { name: "Experts and Teams", exact: true }).click();
      const status = mobile.getByRole("heading", { name: "Native execution capacity", exact: true });
      await status.waitFor();
      await mobile.getByText("Configured capacity: 2 concurrent runs", { exact: true }).waitFor();
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await mobile.screenshot({ path: join(SHOTS, "model-parallel-mobile.png"), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      gate.release();
      await browser.close();
    }
  }, { runCapacity: 2 });
}, 120_000);
