// Product-facing Experts journey: the default roster is inspectable, then a custom Team is assembled
// and activated only after its sole Orchestrator has been designated.
import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { bootAimock, bootApp, seed, withTempHome } from "./wb-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "experts");

describe("E2E Experts and Teams", () => {
  test("shows the default Cognate Team and activates a custom Team with one Orchestrator", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      try {
        await mkdir(SHOTS, { recursive: true });
        await client.invoke("onboarding.dismiss", { step: "notice" });
        await client.invoke("onboarding.dismiss", { step: "apikey" });
        await seed(client, home, aimock.port);
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(app.url);

        await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
        await page.getByRole("heading", { name: "Cognate Team", exact: true }).waitFor();
        await page.screenshot({ path: join(SHOTS, "default-team-desktop.png") });
        const roster = page.getByRole("list", { name: "Experts" });
        await roster.getByText("Product Manager", { exact: true }).waitFor();
        await roster.getByText("Builder", { exact: true }).waitFor();
        await roster.getByText("Critic", { exact: true }).waitFor();
        await roster.getByText("Verifier", { exact: true }).waitFor();
        await roster.getByText("Reviewer", { exact: true }).waitFor();
        expect(await page.getByRole("list", { name: "Team members" }).getByText("Orchestrator", { exact: true }).count()).toBe(1);

        await page.getByRole("button", { name: "New Team" }).click();
        await page.getByLabel("Team name").fill("Quality Review Team");
        await page.getByRole("button", { name: "Create draft Team" }).click();
        await page.getByRole("heading", { name: "Quality Review Team", exact: true }).waitFor({ timeout: 10_000 }).catch(async () => {
          const notice = await page.locator(".experts-notice").allInnerTexts();
          throw new Error(`custom Team did not appear; notices=${notice.join(" | ")}; visible=${(await page.locator(".experts-panel").innerText()).slice(0, 700)}`);
        });
        await page.getByText("Choose exactly one Orchestrator before activating this Team.").waitFor();
        const activate = page.getByRole("button", { name: "Activate Team" });
        expect(await activate.isDisabled()).toBe(true);

        await page.getByLabel("Add Specialist").selectOption("product-manager");
        await page.getByRole("button", { name: "Make Orchestrator" }).waitFor();
        await page.getByRole("button", { name: "Make Orchestrator" }).click();
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Activate Team");
          return button instanceof HTMLButtonElement && !button.disabled;
        });
        await page.getByLabel("Add Specialist").selectOption("builder");
        await page.getByRole("button", { name: "Private conversation" }).last().waitFor();
        await page.getByRole("button", { name: "Activate Team" }).click();
        await page.getByText("Accepts work through its Orchestrator.").waitFor();
        expect(await page.getByRole("list", { name: "Team members" }).getByText("Orchestrator", { exact: true }).count()).toBe(1);
        await page.screenshot({ path: join(SHOTS, "custom-team-active-desktop.png") });

        await page.getByRole("button", { name: "Open Team conversation" }).click();
        await page.getByLabel("Message the Team").fill("hello again");
        await page.getByLabel("Mention a Specialist").selectOption("builder");
        expect(await page.getByLabel("Message the Team").inputValue()).toContain("@Builder");
        await page.getByRole("button", { name: "Send message" }).click();
        await page.getByText(/hello again/).waitFor({ timeout: 15_000 });
        await page.getByText("Needs reconciliation", { exact: true }).waitFor({ timeout: 15_000 });
        await page.getByText("Handoff and evidence", { exact: true }).waitFor();
        expect((await page.locator(".experts-transcript").innerText())).toContain("Here is what I found");
        await page.screenshot({ path: join(SHOTS, "team-conversation-handoff-desktop.png") });

        const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
        mobile.on("pageerror", (error) => errors.push(error.message));
        mobile.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await mobile.goto(app.url);
        await mobile.getByRole("button", { name: "Expand sidebar", exact: true }).click({ timeout: 8_000 });
        await mobile.getByRole("button", { name: "Experts and Teams", exact: true }).click({ timeout: 8_000 });
        await mobile.getByRole("button", { name: "Expand sidebar", exact: true }).waitFor({ timeout: 8_000 });
        await mobile.getByRole("button", { name: /Quality Review Team/ }).click({ timeout: 8_000 });
        await mobile.getByRole("heading", { name: "Quality Review Team", exact: true }).waitFor({ timeout: 8_000 });
        await mobile.getByRole("button", { name: "Jump to selected details" }).click();
        expect(await mobile.getByRole("button", { name: "Open Team conversation", exact: true }).isVisible()).toBe(true);
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        await mobile.screenshot({ path: join(SHOTS, "custom-team-active-mobile.png") });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);

  test("creates, edits and copies a routed Expert, then reopens solo and private history", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      try {
        await client.invoke("onboarding.dismiss", { step: "notice" });
        await client.invoke("onboarding.dismiss", { step: "apikey" });
        await seed(client, home, aimock.port);
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(app.url);
        const openExperts = async () => page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
        await openExperts();
        await page.getByRole("button", { name: "New Expert" }).click();
        await page.getByLabel("Name", { exact: true }).fill("Solo Analyst");
        await page.getByLabel("Specialization").fill("Evidence research");
        await page.getByLabel("Instructions").fill("Compare evidence and report uncertainty.");
        await page.getByLabel("Configured provider").selectOption("mock");
        expect(await page.getByRole("textbox", { name: "Model" }).inputValue()).toBe("mock-model-1");
        await page.getByRole("button", { name: "Create Expert" }).click();
        await page.getByRole("heading", { name: "Solo Analyst", exact: true }).waitFor();

        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.getByLabel("Instructions").fill("Compare evidence, cite sources and report uncertainty.");
        await page.getByRole("button", { name: "Save Expert" }).click();
        await page.getByRole("heading", { name: "Solo Analyst", exact: true }).waitFor();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.waitForFunction(() => (document.querySelector("#expert-instructions") as HTMLTextAreaElement | null)?.value.includes("cite sources"));
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "Copy Expert" }).click();
        expect(await page.getByLabel("Name", { exact: true }).inputValue()).toBe("Solo Analyst copy");
        expect(await page.getByLabel("Instructions").inputValue()).toContain("cite sources");
        expect(await page.getByRole("textbox", { name: "Model" }).inputValue()).toBe("mock-model-1");
        await page.getByLabel("Name", { exact: true }).fill("Solo Analyst Copy");
        await page.getByRole("button", { name: "Copy Expert" }).last().click();
        await page.getByRole("heading", { name: "Solo Analyst Copy", exact: true }).waitFor();

        await page.getByRole("button", { name: "Open solo conversation" }).click();
        await page.getByLabel("Message the Expert").fill("solo-history-marker");
        await page.getByRole("button", { name: "Send message" }).click();
        await page.locator(".experts-transcript").getByText("solo-history-marker", { exact: true }).waitFor();
        await page.getByText("Handoff and evidence", { exact: true }).waitFor({ timeout: 20_000 });
        const soloOption = await page.locator('[aria-label="Conversation history"] option').filter({ hasText: "solo-history-marker" }).getAttribute("value");
        expect(soloOption).toBeTruthy();

        await page.reload();
        await openExperts();
        await page.getByRole("button", { name: /Solo Analyst Copy/ }).click();
        await page.getByRole("button", { name: "Open solo conversation" }).click();
        await page.locator(`[aria-label="Conversation history"] option[value="${soloOption}"]`).waitFor({ state: "attached" });
        await page.getByLabel("Conversation history").selectOption(soloOption!);
        await page.locator(".experts-transcript").getByText("solo-history-marker", { exact: true }).waitFor();

        await page.getByRole("button", { name: /Cognate Team/ }).click();
        const builder = page.getByRole("list", { name: "Team members" }).locator("li").filter({ hasText: "Builder" });
        await builder.getByRole("button", { name: "Private conversation" }).click();
        await page.getByLabel("Message the Expert").fill("private-history-marker");
        await page.getByRole("button", { name: "Send message" }).click();
        await page.locator(".experts-transcript").getByText("private-history-marker", { exact: true }).waitFor();
        await page.getByText("Handoff and evidence", { exact: true }).last().waitFor({ timeout: 20_000 });
        const privateOption = await page.locator('[aria-label="Conversation history"] option').filter({ hasText: "private-history-marker" }).getAttribute("value");
        expect(privateOption).toBeTruthy();

        await page.reload();
        await openExperts();
        await page.getByRole("button", { name: /Cognate Team/ }).click();
        const reopenedBuilder = page.getByRole("list", { name: "Team members" }).locator("li").filter({ hasText: "Builder" });
        await reopenedBuilder.getByRole("button", { name: "Private conversation" }).click();
        await page.locator(`[aria-label="Conversation history"] option[value="${privateOption}"]`).waitFor({ state: "attached" });
        await page.getByLabel("Conversation history").selectOption(privateOption!);
        await page.locator(".experts-transcript").getByText("private-history-marker", { exact: true }).waitFor();
        await page.getByRole("button", { name: /Builder/ }).first().click();
        await page.getByRole("button", { name: "Open solo conversation" }).click();
        const soloHistory = await page.locator('[aria-label="Conversation history"] option').allInnerTexts();
        expect(soloHistory.join(" ")).not.toContain("private-history-marker");
        expect((await page.locator(".experts-transcript").innerText())).not.toContain("private-history-marker");
        await page.getByRole("button", { name: /Cognate Team/ }).click();
        await page.getByRole("button", { name: "Open Team conversation" }).click();
        const teamHistory = await page.locator('[aria-label="Conversation history"] option').allInnerTexts();
        expect(teamHistory.join(" ")).not.toContain("private-history-marker");
        expect((await page.locator(".experts-transcript").innerText())).not.toContain("private-history-marker");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 180_000);
});
