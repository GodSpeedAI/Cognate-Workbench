// Browser acceptance for the Task-checkout control in the composer (J-CHECKOUT-BIND /
// J-CHECKOUT-LIFECYCLE): a person binds a task, isolates it in a worktree through the form (branch
// suggested from the task name, start point chosen), sees the live facts, and removes the checkout
// through an explicit confirmation. The capability layer remains the truth: every chip state is
// cross-checked against `git.checkout.status` / `task.checkout.resolve`. Screenshots land in
// screenshots/workbench/.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { bootApp, createTask, inv, seedWorkspaceOnly, withTempHome } from "./wb-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "workbench");
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

describe("E2E task checkout", () => {
  test("isolate a bound task in a worktree from the composer, then remove it with confirmation", async () => {
    await mkdir(SHOTS, { recursive: true });
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const browser = await chromium.launch();
      const errors: string[] = [];
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(app.url);

        // A draft conversation is enough: no model turn is needed to isolate a checkout.
        await page.getByRole("button", { name: "New session", exact: true }).click();
        const taskSelect = page.locator("#wb-bind-task");
        await taskSelect.waitFor();

        const taskId = await createTask(app, client, workspaceId, "Tidy the greeting");
        await page.locator(`#wb-bind-task option[value="${taskId}"]`).waitFor({ state: "attached", timeout: 10_000 });
        await taskSelect.selectOption(taskId);

        const isolate = page.getByRole("button", { name: "Isolate in a worktree…" });
        await isolate.waitFor();
        await shot(page, "e2e-checkout-01-unbound");
        await isolate.click();

        // The form proposes a branch from the task name and the repository's default start point.
        // The start point arrives with the async `git.branch.list` result — wait for the value,
        // do not race it (the full-suite run lost this race once; standalone never did).
        const form = page.getByRole("dialog", { name: "Task checkout" });
        const branchInput = page.getByLabel("Branch name");
        await branchInput.waitFor();
        expect(await branchInput.inputValue()).toBe("tidy-the-greeting");
        const startSelect = form.getByLabel("Start from branch");
        await startSelect.waitFor();
        await page.waitForFunction(() => {
          const el = document.querySelector('select[aria-label="Start from branch"]') as HTMLSelectElement | null;
          return el !== null && el.value !== "";
        });
        expect(await startSelect.inputValue()).toBe("main");
        await shot(page, "e2e-checkout-02-form");

        await form.getByRole("button", { name: "Create checkout" }).click();
        const chip = page.locator(".wb-checkout-chip .wb-chip-value");
        await chip.waitFor();
        expect(await chip.innerText()).toBe("workbench/tidy-the-greeting");
        await page.locator(".wb-checkout .wb-muted").filter({ hasText: "clean" }).waitFor();
        await shot(page, "e2e-checkout-03-bound");

        // The UI states are not the truth: the capabilities agree with them.
        const status = (await inv(client, "git.checkout.status", { taskId })) as { readonly exists: boolean; readonly root: string; readonly clean: boolean };
        expect(status.exists).toBe(true);
        expect(status.clean).toBe(true);

        // Removal is a two-step, explicit action; the capability still refuses dirty checkouts.
        await page.getByRole("button", { name: "Remove", exact: true }).click();
        await page.getByText(/Remove this checkout\?/).waitFor();
        await shot(page, "e2e-checkout-04-confirm-remove");
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        await isolate.waitFor();
        await page.getByText(/Checkout removed/).waitFor();

        expect(await inv(client, "task.checkout.resolve", { taskId })).toBeNull();
        expect(existsSync(status.root)).toBe(false);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
      }
    });
  }, 120_000);
});
