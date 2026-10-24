import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import { invoke, route, waitForState, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

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
        message: { role: "assistant", content: `${selectedRoute.model}: cross-workspace review complete.` },
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

test("J-EXPERT-WORKSPACE-ADMISSION: browser-visible tool-bearing Experts on two workspaces overlap at capacity two", async () => {
  const gate = gatedResponder();
  await withExpertApp(gate.responder, async (app) => {
    await invoke(app, "onboarding.dismiss", { step: "notice" });
    await invoke(app, "onboarding.dismiss", { step: "apikey" });
    const current = await app.state();
    for (const [expertId, model] of [["builder", "builder-crossws-model"], ["critic", "critic-crossws-model"]] as const) {
      const expert = current.experts[expertId]!;
      await invoke(app, "expert.save", {
        expertId,
        name: expert.name,
        specialization: expert.definition.specialization,
        instructions: expert.definition.instructions,
        // Tool-bearing: frozen execution carries real workspace-effect tools, so admission keys
        // by canonical workspace instead of the model-only overlap path.
        tools: ["read"],
        route: route(model),
      });
    }
    const secondRoot = join(app.home, "workspace-b");
    await mkdir(secondRoot, { recursive: true });
    const second = (await invoke(app, "workspace.select", { path: secondRoot })) as { workspaceId: string };
    expect(second.workspaceId).not.toBe(app.workspaceId);

    const browser = await chromium.launch();
    const errors: string[] = [];
    try {
      await mkdir(SHOTS, { recursive: true });
      const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      desktop.setDefaultTimeout(15_000);
      desktop.on("pageerror", (error) => errors.push(error.message));
      desktop.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await desktop.goto(app.app.url, { waitUntil: "domcontentloaded" });
      // Bind the Builder conversation to the first workspace through the UI picker.
      await desktop.getByRole("button", { name: "Choose workspace" }).click();
      await desktop.getByRole("menuitem", { name: "workspace", exact: true }).click();
      await desktop.getByRole("button", { name: "Experts and Teams", exact: true }).click();
      await desktop.getByText("Configured capacity: 2 concurrent runs", { exact: true }).waitFor();
      await desktop.getByText(/Tool-bearing work is admitted per canonical workspace/).waitFor();
      await openExpertChat(desktop, "Builder", "Review the first cross-workspace objective.");
      await waitUntil(() => gate.entered.length === 1, "Builder provider request");

      const secondPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      secondPage.setDefaultTimeout(15_000);
      secondPage.on("pageerror", (error) => errors.push(error.message));
      secondPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await secondPage.goto(app.app.url, { waitUntil: "domcontentloaded" });
      // The second conversation binds to the other workspace.
      await secondPage.getByRole("button", { name: "Choose workspace" }).click();
      await secondPage.getByRole("menuitem", { name: "workspace-b", exact: true }).click();
      await openExpertChat(secondPage, "Critic", "Review the second cross-workspace objective.");
      await waitUntil(() => gate.entered.length === 2, "Critic provider request overlapping Builder");
      expect(gate.peak()).toBe(2);
      expect(gate.entered).toEqual(["builder-crossws-model", "critic-crossws-model"]);
      await desktop.screenshot({ path: join(SHOTS, "workspace-admission-desktop.png"), fullPage: true });

      gate.release();
      await Promise.all([
        desktop.locator(".experts-transcript").getByText("builder-crossws-model: cross-workspace review complete.", { exact: true }).waitFor(),
        secondPage.locator(".experts-transcript").getByText("critic-crossws-model: cross-workspace review complete.", { exact: true }).waitFor(),
      ]);

      // The two completed Assignments hold disjoint canonical workspaces in authoritative state.
      const state = await waitForState(app, (snapshot) =>
        Object.values(snapshot.assignments).filter((assignment) => assignment.purpose.startsWith("Review the ")).length === 2 &&
        Object.values(snapshot.assignments).filter((assignment) => assignment.purpose.startsWith("Review the ")).every((assignment) => !!assignment.handoff),
        "both handoffs");
      const crossWorkspaces = Object.values(state.assignments).filter((assignment) => assignment.purpose.startsWith("Review the "));
      expect(new Set(crossWorkspaces.map((assignment) => assignment.workspaceId)).size).toBe(2);
      expect(crossWorkspaces.map((assignment) => assignment.workspaceId).sort()).toEqual([app.workspaceId, second.workspaceId].sort());
      for (const assignment of crossWorkspaces) {
        expect(assignment.execution.tools).toContain("read");
        expect(assignment.execution.tools).toContain("expert_return");
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close().catch(() => {});
      gate.release();
    }
  }, { runCapacity: 2 });
}, 120_000);

