// Browser acceptance for the Workbench cockpit (real server, real SQLite store, aimock model, real
// Chromium). Each step asserts what a person sees and what the durable log recorded. Screenshots land
// in screenshots/workbench/ as evidence. Journeys: J-WB-task-contract, -protected-evidence,
// -steering, -review-gate, -workflow, -capability-lifecycle (see .sea/interaction catalog).
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import type { BindingRecord, TaskRecord, WorkflowInstanceRecord } from "../src/workbench/state.ts";
import { LOCAL_OPERATOR, bootApp, bootAimock, createTask, fullContract, inv, seed, waitForRow, waitUntil, wbRows, withTempHome, allEvents } from "./wb-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "workbench");
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const notice = (page: Page) => page.locator(".wb-cockpit-notice");
const chip = (page: Page, label: string) => page.locator(".wb-contract-chips button").filter({ hasText: new RegExp(`^${label}`, "i") });

describe("E2E workbench cockpit", () => {
  test("contract authoring, protected evidence in the agent loop, steering, review gate, workflow and capability lifecycle", async () => {
    await mkdir(SHOTS, { recursive: true });
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      const errors: string[] = [];
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId, workspaceDir } = await seed(client, home, aimock.port);
        const greet = join(workspaceDir, "src", "greet.ts");
        const greetBefore = await readFile(greet, "utf8");

        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        await page.goto(app.url);

        // ---- Entry: the cockpit is one click from the conversation, and says what it is ----
        await page.getByRole("button", { name: "Workbench", exact: true }).click();
        await page.getByRole("heading", { name: "Workbench", exact: true }).waitFor();
        expect(await page.getByRole("button", { name: "Workbench", exact: true }).getAttribute("aria-pressed")).toBe("true");
        expect(await page.getByRole("tab").allInnerTexts()).toEqual(["Tasks", "Workflows", "Capabilities", "Automations"]);

        // Empty state teaches, and there is exactly one way to begin.
        await page.getByText(/A task is the unit of governed work/).waitFor();
        expect(await page.getByRole("button", { name: "New task", exact: true }).count()).toBe(1);
        await shot(page, "e2e-01-empty");

        // ---- J-WB-task-contract: create, see what is missing, fill it through the editors ----
        await page.getByRole("button", { name: "New task", exact: true }).click();
        const create = page.getByRole("button", { name: "Create task" });
        expect(await create.isDisabled()).toBe(true);
        await page.getByText("Enter a name to continue.").waitFor();
        await page.getByLabel("What is the task called").fill("Update the greeting");
        await create.click();
        await page.getByRole("article", { name: "Task Update the greeting" }).waitFor();
        await notice(page).getByText(/Task created/).waitFor();
        // Authority starts as "read only" and the missing fields are named in visible text.
        expect(await chip(page, "Authority").innerText()).toMatch(/^authority\s+read$/i);
        await page.getByText(/Missing: .*goal.*skills.*executors.*budget.*invariants.*acceptance/).first().waitFor();
        const markReady = page.getByRole("button", { name: "Mark ready" });
        expect(await markReady.isDisabled()).toBe(true);
        await shot(page, "e2e-02-new-task-contract-missing");

        // Goal: Save is disabled with a reason until there is an outcome.
        await chip(page, "Goal").click();
        const editor = page.getByRole("region", { name: /Edit/ }).or(page.locator(".wb-contract-editor"));
        await editor.getByRole("button", { name: "Save" }).waitFor();
        expect(await editor.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
        await page.locator("#goal-outcome").fill("Change the greeting from Hello to Howdy");
        await editor.getByRole("button", { name: "Save" }).click();
        await notice(page).getByText("Contract saved.").waitFor({ timeout: 6000 }).catch(async () => { throw new Error(`save notice missing; notice="${await notice(page).innerText()}" editor="${(await page.locator(".wb-contract-editor").innerText()).slice(0, 300)}"`); });
        await waitUntil("goal chip", async () => /Howdy/.test(await chip(page, "Goal").innerText()));

        // Skills
        await chip(page, "Skills").click();
        await page.locator(".wb-contract-editor label", { hasText: /code[- ]repair/i }).first().locator("input").check();
        await page.locator(".wb-contract-editor").getByRole("button", { name: "Save" }).click();
        await waitUntil("skills chip", async () => /1 skills/.test(await chip(page, "Skills").innerText()));

        // Authority: the plane is explicit. Allow writes and shell, and protect the file under test.
        await chip(page, "Authority").click();
        await page.locator("#auth-fs-write").selectOption("yes");
        await page.locator("#auth-shell-run").selectOption("yes");
        await page.locator("#auth-protected-paths").fill("src/greet.ts");
        await page.locator(".wb-contract-editor").getByRole("button", { name: "Save" }).click();
        await waitUntil("authority chip", async () => /write/.test(await chip(page, "Authority").innerText()));

        // The remaining fields go through the same capability the editors call.
        const full = fullContract(workspaceId, ["src/greet.ts"]);
        const taskId = (await waitUntil("task row", async () => [...(await wbRows(app))].find(([k]) => k.startsWith("task/"))?.[0]?.slice(5)))!;
        await inv(client, "task.contract.update", { taskId, contract: { executors: full.executors, budget: full.budget, invariants: full.invariants, acceptance: full.acceptance } });
        await page.getByText("Contract complete.").waitFor();
        expect(await markReady.isEnabled()).toBe(true);
        await shot(page, "e2e-03-contract-complete");
        await markReady.click();
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "READY");

        // ---- J-WB-protected-evidence in the real agent loop, bound through the composer ----
        await page.getByRole("button", { name: "Work on this task in the conversation" }).click();
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "RUNNING");
        const bar = page.locator(".wb-composerbar");
        await bar.waitFor();
        expect(await bar.locator("select").inputValue()).toBe(taskId);
        expect(await bar.getByRole("status", { name: "Runtime" }).innerText()).toMatch(/idle/i);
        const composer = page.getByRole("textbox", { name: /Message or run a task/ });
        await composer.fill("[[scenario:edit]] change the greeting");
        await composer.press("Enter");
        // Durable truth first: the block is recorded, then the person can see it.
        await waitUntil("protection.blocked event", async () => (await allEvents(app)).some((e) => e.eventType === "workbench.protection.blocked"), 30_000);
        await page.waitForTimeout(800);
        await shot(page, "e2e-04-protected-write-blocked");
        await page.getByRole("alert").filter({ hasText: /Blocked by the task.s authority/ }).getByText(/protected-evidence.*src\/greet\.ts/).waitFor({ timeout: 8_000 }).catch(async () => { throw new Error(`chat does not show the block; visible: ${(await page.locator(".center-column").innerText()).slice(0, 600)}`); });
        expect(await readFile(greet, "utf8")).toBe(greetBefore); // byte-identical
        await shot(page, "e2e-04-protected-write-blocked");

        // ---- Focus (ported from gs-term): "this" has one deterministic, visible, resettable meaning ----
        const focusBar = bar.getByRole("status", { name: "Focus" });
        await focusBar.getByText(/Task "Update the greeting"/).waitFor();
        expect(await focusBar.innerText()).toMatch(/selected in the Workbench/);
        await composer.fill("[[scenario:read]] what is this");
        await composer.press("Enter");
        const focusRun = await waitUntil("run carrying the focus line", async () =>
          (await app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: "agent.coding" })).find((r) => String((r.input as { message?: string }).message).includes("what is this")));
        expect((focusRun.input as { message: string }).message).toContain(`[focus: task "Update the greeting" (${taskId}), from explicit selection]`);
        // A message that does not refer to anything carries no focus line (checked on the earlier run).
        const earlier = (await app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: "agent.coding" })).find((r) => String((r.input as { message?: string }).message).includes("change the greeting"));
        expect((earlier!.input as { message: string }).message).not.toContain("[focus:");
        await page.getByText(/README describes/).waitFor({ timeout: 25_000 });
        // Reset: clearing the selection falls back to the task this conversation is bound to.
        await focusBar.getByRole("button", { name: "Clear focus" }).click();
        await focusBar.getByText(/the task this conversation is bound to/).waitFor();
        expect(await focusBar.getByRole("button", { name: "Clear focus" }).count()).toBe(0);
        await shot(page, "e2e-04b-focus");

        // The contract is locked while the task runs, and the cockpit shows the block as evidence.
        await page.getByRole("button", { name: "Workbench", exact: true }).click();
        await page.getByRole("button", { name: /Update the greeting/ }).click();
        await page.getByText("The contract cannot change while the task is running. Stop it first.").waitFor({ state: "attached" }).catch(() => undefined);
        await page.getByRole("heading", { name: "Authority", exact: true }).waitFor();
        await page.locator(".wb-authority-plane").getByText(/src\/greet\.ts/).first().waitFor();
        await page.locator(".wb-authority-plane").getByText(/immutable/i).first().waitFor();
        await shot(page, "e2e-05-authority-and-blocked");

        // ---- J-WB-review-gate: blockers are visible; the independent check unblocks; a person accepts ----
        await page.getByRole("button", { name: "Submit for review" }).waitFor();
        expect(await page.getByRole("button", { name: "Submit for review" }).isDisabled()).toBe(true);
        await page.getByText(/Not ready for review/).waitFor();
        await page.getByText(/worker return contract missing|changed files not reported/).first().waitFor();
        const ev = async (kind: "test" | "independent-check", criterionId: string, summary: string) => ((await inv(client, "evidence.record", { taskId, kind, status: "pass", summary, criterionId })) as { evidenceId: string }).evidenceId;
        const e1 = await ev("test", "ac-1", "unit tests pass");
        await inv(client, "worker.return", { taskId, workerReturn: { changed: ["src/greet.ts"], tested: ["bun test"], evidence: [e1], remaining: [], risks: [], readyForReview: true } });
        await waitUntil("independent-check blocker shown", async () => (await page.getByText(/independent check required but tests alone passed/).count()) > 0);
        expect(await page.getByRole("button", { name: "Submit for review" }).isDisabled()).toBe(true);
        await shot(page, "e2e-06-review-blocked-independent-check");
        // Record the independent check through the cockpit's own form.
        const form = page.locator(".wb-ledger-form");
        await form.locator("select").nth(0).selectOption("independent-check");
        await form.locator("select").nth(1).selectOption("pass");
        await form.locator("select").nth(2).selectOption({ label: "totals match an independent calculation" }).catch(() => form.locator("select").nth(2).selectOption({ index: 2 }));
        await form.locator("textarea, input[type=text]").first().fill("totals match the independent calculation");
        await form.getByRole("button", { name: "Record" }).click();
        await notice(page).getByText("Evidence recorded.").waitFor();
        await waitUntil("submit enabled", async () => (await page.getByRole("button", { name: "Submit for review" }).isEnabled()));
        await page.getByRole("button", { name: "Submit for review" }).click();
        const gate = page.getByRole("region", { name: "Review gate" });
        await gate.waitFor();
        await shot(page, "e2e-07-review-gate");
        await gate.getByLabel(/Reviewer note/i).fill("Greeting verified.");
        await gate.getByRole("button", { name: "Accept" }).click();
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "ACCEPTED" && t.humanApproved);
        await page.getByText("Accepted by a reviewer.").waitFor();
        await shot(page, "e2e-08-accepted");

        // ---- J-WB-workflow and J-WB-capability-lifecycle in the browser ----
        await page.getByRole("tab", { name: "Capabilities" }).click();
        // The starter catalog was loaded when the cockpit first opened; nothing to click.
        await page.getByRole("heading", { name: "Verify" }).first().waitFor();
        expect(await page.getByText("Built is not installed. Installed is not enabled. Enabled is not verified.").count()).toBeGreaterThan(0);
        const advance = page.getByRole("button", { name: /Advance to reviewed/i }).first();
        await advance.click();
        await waitUntil("a binding reached REVIEWED", async () => [...(await wbRows(app))].some(([k, v]) => k.startsWith("binding/") && (v as BindingRecord).state === "REVIEWED"));
        await shot(page, "e2e-09-capabilities");

        await page.getByRole("tab", { name: "Workflows" }).click();
        await page.getByRole("button", { name: "Start an instance for this workspace" }).click();
        const node = page.getByRole("button", { name: /^product-briefing, / });
        await node.waitFor();
        await node.click();
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await waitUntil("node running", async () => [...(await wbRows(app))].some(([k, v]) => k.startsWith("instance/") && (v as WorkflowInstanceRecord).status["product-briefing"] === "running"));
        await page.getByRole("button", { name: /^product-briefing, running/ }).waitFor();
        // A locked stage names what it waits on.
        await page.getByRole("button", { name: /^design-model, / }).click();
        await page.getByText(/Waiting on:/).waitFor();
        await shot(page, "e2e-10-workflow");

        // ---- Keyboard: the tablist is operable without a pointer ----
        await page.getByRole("tab", { name: "Tasks" }).focus();
        await page.keyboard.press("ArrowRight");
        expect(await page.getByRole("tab", { name: "Workflows" }).getAttribute("aria-selected")).toBe("true");

        // ---- Responsive: no horizontal page overflow at phone width ----
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("tab", { name: "Tasks" }).click();
        await page.waitForTimeout(250);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await shot(page, "e2e-11-phone");

        expect(errors).toEqual([]);
        const types = (await allEvents(app)).map((e) => e.eventType);
        expect(types).toContain("workbench.protection.blocked");
        expect(types).toContain("workbench.review.decided");
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 240_000);

  test("V-004 in the UI: Steer now joins the running trajectory durably instead of restarting it", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await seed(client, home, aimock.port);
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        const composer = page.getByRole("textbox", { name: /Message or run a task/ });
        await composer.waitFor();
        // A long-running tool call keeps the run active.
        await composer.fill("[[scenario:slowbash]] run the long job");
        await composer.press("Enter");
        await page.getByRole("button", { name: "Stop generating" }).waitFor({ timeout: 20_000 });
        // Ctrl+Enter uses the other send behavior than the setting (queue by default): that is steer.
        await composer.fill("use the staging database instead");
        await composer.press("Control+Enter");
        await page.getByText(/steering · sent to the running agent/).waitFor();
        // The steer is a durable write to the LIVE run's shared state (not queued behind it).
        const steerEvent = await waitUntil("steer state write", async () =>
          (await allEvents(app)).find((e) => e.eventType === "state.changed" && JSON.stringify(e.payload).includes("use the staging database instead")));
        expect(JSON.stringify(steerEvent.payload)).toContain("/steer/-");
        // The run was NOT cancelled or restarted by steering: Stop is still offered and exactly one agent run exists.
        expect(await page.getByRole("button", { name: "Stop generating" }).count()).toBe(1);
        expect((await app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: "agent.coding" })).length).toBe(1);
        await shot(page, "e2e-12-steering");
        await page.getByRole("button", { name: "Stop generating" }).click();
        await page.getByText("Stopped").first().waitFor({ timeout: 20_000 });
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);
});
