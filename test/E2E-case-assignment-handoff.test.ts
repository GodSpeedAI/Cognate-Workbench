// Browser acceptance for the Assignment control in the composer (WP-23, J-CASE-ASSIGNMENT-handoff):
// a person hands an approved case assignment to a conversation and watches its bound run settle
// under that assignment, then drives a live one — spend, interrupt, resume — from the same control.
// The server runs its production posture: the browser is the boot's server-issued operator session
// (no dev token), and the host's hand-off source is a test stand-in for Horizon's case keeper. The
// capability layer remains the truth: every chip state is cross-checked against the run, the event
// log and the projection. Screenshots land in screenshots/workbench/.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Locator, type Page } from "playwright-core";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { AssignmentView } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import type { HandoffCandidate } from "../src/assignments/handoffSource.ts";
import { approvedGateG3, approvedSlowGate, GATE_G3_ASSIGNMENT_ID, GATE_G3_INSTRUCTION, SLOW_GATE_ASSIGNMENT_ID, SLOW_GATE_INSTRUCTION, standInHandoffSource } from "./handoff-fixture.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { inv, seed, waitUntil } from "./wb-helpers.ts";

const SHOTS = join(import.meta.dir, "..", "screenshots", "workbench");
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const SETTLED_LABEL = "Assignment: case-0001 · item-03 · 1:1 (completed)";
const LIVE_LABEL = (status: string) => `Assignment: case-0001 · item-03 · 1:2 (${status})`;
/** A third approved assignment (same Brief as the first, so the same stub answers it), handed off while the operator changes session. */
const SWITCHED_ASSIGNMENT_ID = "assign:case-0001:item-03:1:3";
const switchedAssignment = (): HandoffCandidate => {
  const base = approvedGateG3();
  return { ...base, id: "candidate:gate-g3-switched", assignment: { ...base.assignment, assignment_id: SWITCHED_ASSIGNMENT_ID, k: 3 } };
};

/** The session binding the projection folded for one assignment id. */
const bindingFor = (app: AppServer, assignmentId: string) =>
  waitUntil(`the binding of ${assignmentId}`, async () => {
    const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-assignment-bindings" })).rows;
    const row = rows.map((r) => r.value as { sessionId: string; assignmentId: string; runId: string }).find((r) => r.assignmentId === assignmentId);
    return row?.runId ? row : undefined;
  });

describe("E2E case assignment hand-off", () => {
  test("hand an approved assignment to a conversation and watch its run settle, then drive a live one", async () => {
    await mkdir(SHOTS, { recursive: true });
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const app = await startServer({ executionPosture: "uncontained-local", port: 0, home, handoffSource: standInHandoffSource([approvedGateG3(), approvedSlowGate(), switchedAssignment()]) });
      // The production posture: this client and the browser both present the boot's server-issued session.
      const client = createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => app.operatorSessionToken), caller: LOCAL_OPERATOR });
      const browser = await chromium.launch();
      const errors: string[] = [];
      try {
        await inv(client, "onboarding.dismiss", { step: "notice" });
        await inv(client, "onboarding.dismiss", { step: "apikey" });
        await seed(client, home, aimock.port);
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(app.url);
        const chip = page.locator("button#wb-assignment");
        const menu = () => page.getByRole("menu", { name: "Assignment" });
        /** Cognate's runtime can refuse a control issued while the run streams, for contention (Cognate
         *  DEBT-033). The control shows that refusal and stays open: click again, as a person would,
         *  and only for that refusal — any other alert fails the journey. */
        const controlThroughContention = async (item: Locator, settled: () => Promise<unknown>): Promise<void> => {
          for (let attempt = 0; ; attempt++) {
            // A control is enabled only while its assignment is live: a long wait means it settled first.
            await item.click({ timeout: 10_000 }).catch(async (reason: unknown) => {
              await shot(page, "e2e-wp23-assignment-failure");
              throw new Error(`the control could not be pressed; it reads "${await chip.getAttribute("aria-label")}", menu "${(await menu().innerText().catch(() => "")).replace(/\s+/g, " ")}" (${String(reason).split("\n")[0]})`);
            });
            const alert = menu().locator('[role="alert"]');
            // Exactly two outcomes end an attempt: the control's success shows, or its refusal does. When
            // neither appears, both waits time out and the AggregateError fails the journey.
            const outcome = await Promise.any([
              settled().then(() => "settled" as const),
              alert.waitFor({ state: "visible", timeout: 30_000 }).then(() => "refused" as const),
            ]);
            if (outcome === "settled") return;
            const text = await alert.innerText();
            if (!/too much contention/.test(text)) throw new Error(`the Assignment control refused: ${text}`);
            if (attempt >= 20) throw new Error(`the Assignment control kept refusing for contention: ${text}`);
            // A person does not click again within a millisecond; pause so the run's own appends can interleave.
            await page.waitForTimeout(150);
          }
        };
        /** Waits for the control to read `text`; a timeout reports what it does read and any alert on screen. */
        const waitLabel = async (text: string) => {
          await page
            .waitForFunction((expected) => document.querySelector("button#wb-assignment")?.getAttribute("aria-label") === expected, text, { timeout: 30_000 })
            .catch(async (reason: unknown) => {
              const reads = await chip.getAttribute("aria-label").catch(() => "absent");
              const alerts = JSON.stringify(await page.locator('[role="alert"]').allInnerTexts());
              await shot(page, "e2e-wp23-assignment-failure");
              const runs = (await app.runtime.service.listRuns(LOCAL_OPERATOR, {}))
                .filter((r) => r.agent === "agent.coding")
                .map((r) => `${r.runId.slice(0, 8)} ${r.status}`);
              throw new Error(`the Assignment control never read "${text}": it reads "${reads}", alerts ${alerts}, runs ${JSON.stringify(runs)} (${String(reason).split("\n")[0]})`);
            });
        };

        // ---- An unbound conversation is offered exactly what the host's source approved ----
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await chip.waitFor();
        expect(await chip.getAttribute("aria-label")).toBe("Assignment: None");
        await chip.click();
        await menu().waitFor();
        // The candidates arrive asynchronously; the menu says so (aria-busy) until they do.
        await page.locator('[role="menu"][aria-label="Assignment"][aria-busy="false"]').waitFor();
        const offered = await menu().getByRole("menuitem").allInnerTexts();
        expect(offered).toHaveLength(3);
        expect(offered[0]).toContain(GATE_G3_INSTRUCTION);
        expect(offered[0]).toContain("money 5 USD");
        await shot(page, "e2e-wp23-assignment-01-offer");

        // ---- Hand off: the run opens as a turn whose message is the approved Brief's instruction ----
        await menu().getByRole("menuitem", { name: `Hand off ${GATE_G3_INSTRUCTION}` }).first().click();
        await page.locator(".message-user").filter({ hasText: GATE_G3_INSTRUCTION }).waitFor();
        await page.locator(".message-assistant").filter({ hasText: "Recorded the verifier's observation for gate G3" }).waitFor({ timeout: 30_000 });
        await waitLabel(SETTLED_LABEL);
        await shot(page, "e2e-wp23-assignment-02-settled");

        // ---- A settled assignment shows its budget against its spend, and is closed ----
        await chip.click();
        await menu().getByText("money: 0 of 5 USD").waitFor();
        await menu().getByText("time: 0 of 14400 seconds").waitFor();
        for (const name of ["Interrupt", "Resume", "Report 1 USD of money spent"]) {
          expect(await menu().getByRole("menuitem", { name, exact: true }).isDisabled(), name).toBe(true);
        }
        await shot(page, "e2e-wp23-assignment-03-settled-menu");
        await page.keyboard.press("Escape");

        // ---- What the person saw is what the durable record says ----
        const settledBinding = await bindingFor(app, GATE_G3_ASSIGNMENT_ID);
        const settledRun = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: settledBinding.runId });
        expect(settledRun.status).toBe("completed");
        expect(settledRun.startedBy).toBe(LOCAL_OPERATOR.actor.id);
        expect(settledRun.correlationId).toBe(`session:${settledBinding.sessionId}`);
        const settledView = (await inv(client, "assignment.view", { runId: settledBinding.runId })) as unknown as AssignmentView;
        expect(settledView.assignment.assignment_id).toBe(GATE_G3_ASSIGNMENT_ID);
        expect(settledView.status).toBe("completed");
        expect(settledView.spend.find((s) => s.currency === "money")?.spent).toBe(0);

        // ---- A live assignment is driven from the same control: spend, interrupt, resume ----
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await waitLabel("Assignment: None");
        await chip.click();
        await menu().waitFor();
        await menu().getByRole("menuitem", { name: `Hand off ${SLOW_GATE_INSTRUCTION}` }).click();
        await waitLabel(LIVE_LABEL("started"));
        await chip.click();
        const live = menu();
        await controlThroughContention(live.getByRole("menuitem", { name: "Report 1 USD of money spent" }), () => live.getByText("money: 1 of 5 USD").waitFor());
        await shot(page, "e2e-wp23-assignment-04-live-spend");
        await controlThroughContention(live.getByRole("menuitem", { name: "Interrupt", exact: true }), () => waitLabel(LIVE_LABEL("interrupted")));
        await shot(page, "e2e-wp23-assignment-05-interrupted");
        await controlThroughContention(live.getByRole("menuitem", { name: "Resume", exact: true }), () => waitLabel(LIVE_LABEL("resumed")));

        // ---- The interrupted step's outcome is unknown: the resumed run waits for the operator ----
        // Only the operator can record what happened. A model call has no external effect to confirm
        // and cannot be reconstructed, so the one honest outcome is to let the agent retry it.
        const reconcile = page.getByRole("button", { name: "Record reconciliation", exact: true });
        await reconcile.waitFor();
        await page.getByText("Interrupted step needs reconciliation").waitFor();
        await page.getByLabel("What did you observe?").fill("The answer stopped mid-stream when I interrupted the assignment; no tool ran.");
        await shot(page, "e2e-wp23-assignment-06-reconciliation");
        await reconcile.click();

        // Retried, the same run finishes; the assignment settles with its spend kept.
        await waitLabel(LIVE_LABEL("completed"));
        await page.locator(".message-assistant").filter({ hasText: "streamed deliberately slowly" }).first().waitFor({ timeout: 30_000 });
        await shot(page, "e2e-wp23-assignment-07-resumed-settled");

        const liveBinding = await bindingFor(app, SLOW_GATE_ASSIGNMENT_ID);
        expect(liveBinding.sessionId).not.toBe(settledBinding.sessionId);
        const liveView = (await inv(client, "assignment.view", { runId: liveBinding.runId })) as unknown as AssignmentView;
        expect(liveView.status).toBe("completed");
        expect(liveView.spend.find((s) => s.currency === "money")?.spent).toBe(1);
        expect(liveView.events.map((e) => e.event)).toEqual(["issued", "started", "interrupted", "resumed", "completed"]);
        // ---- A hand-off that resolves after the operator changed session leaves the active session alone ----
        // The request is held in the browser while the operator opens another new session; the run it opened
        // is bound to the originating session, and must not be followed into this one.
        await page.getByRole("button", { name: "New session", exact: true }).click();
        await waitLabel("Assignment: None");
        await chip.click();
        await menu().waitFor();
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route("**/*", async (route) => {
          if (route.request().method() === "POST" && (route.request().postData() ?? "").includes("session.caseAssignment.handoff")) await held;
          await route.fallback();
        });
        await menu().getByRole("menuitem", { name: `Hand off ${GATE_G3_INSTRUCTION}` }).nth(1).click();
        const rowsBefore = await page.locator(".session-row").count();
        await page.getByRole("button", { name: "New session", exact: true }).click();
        // The operator is now in the new session: it is listed and selected while the hand-off is still held.
        await waitUntil("the new session to be opened", async () => (await page.locator(".session-row").count()) > rowsBefore && (await page.locator('[role="treeitem"][aria-selected="true"]').count()) > 0);
        await waitLabel("Assignment: None");
        release();
        const switched = await bindingFor(app, SWITCHED_ASSIGNMENT_ID);
        await page.unroute("**/*");
        await waitUntil("the switched hand-off's run to settle", async () => (await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: switched.runId })).status === "completed", 30_000);
        expect(await chip.getAttribute("aria-label")).toBe("Assignment: None");
        expect(await page.locator(".message-user").count()).toBe(0);
        expect(await page.locator(".message-assistant").count()).toBe(0);
        // The binding is still there when the operator returns to the originating session.
        const rowCount = await page.locator(".session-row").count();
        let returned = false;
        for (let i = 0; i < rowCount && !returned; i++) {
          await page.locator(".session-row").nth(i).click();
          returned = await page.waitForFunction(() => /1:3/.test(document.querySelector("button#wb-assignment")?.getAttribute("aria-label") ?? ""), undefined, { timeout: 2_000 }).then(() => true, () => false);
        }
        expect(returned, "the originating session shows its binding").toBe(true);
        await waitLabel("Assignment: case-0001 · item-03 · 1:3 (completed)");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 180_000);
});
