// Journey J-WB-automation (V-012): an accepted workflow becomes an automation; dispatch is not
// completion. A run is COMPLETE only after output exists and every acceptance item is closed.
import { describe, expect, test } from "bun:test";
import type { AutomationRecord, TaskRecord } from "../src/workbench/state.ts";
import { acceptTask, bootApp, createTask, seedWorkspaceOnly, waitForRow, withTempHome, type AppServer, inv } from "./wb-helpers.ts";

const ACCEPTANCE = ["calculations-tests-pass", "report-generated", "net-revenue-present", "evidence-ledger-closed"];
const state = (app: AppServer, id: string, want: string) => waitForRow<AutomationRecord>(app, `automation/${id}`, (a) => a.run.state === want);

describe("J-WB-automation", () => {
  test("V-012: a delivery receipt is DISPATCHED, never COMPLETE; completion needs output and closed acceptance", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const schedule = { kind: "weekly", weekday: 1, hour: 8, minute: 0, timezone: "America/New_York" } as const;
        const base = { name: "Weekly sales report", schedule, substrate: "local-desktop", acceptance: ACCEPTANCE, now: "2026-03-02T13:00:00.000Z" } as const;

        // Only accepted work can be operationalized, and an outcome gate is mandatory.
        const draft = await createTask(app, client, workspaceId, "not accepted");
        await expect(inv(client, "automation.create", { ...base, sourceTaskId: draft })).rejects.toThrow(/only an accepted workflow/);
        const accepted = await acceptTask(app, client, workspaceId, "Sales report");
        await expect(inv(client, "automation.create", { ...base, sourceTaskId: accepted, acceptance: [] })).rejects.toThrow(/outcome gate/);

        const { automationId, nextFire } = (await inv(client, "automation.create", { ...base, sourceTaskId: accepted })) as { automationId: string; nextFire: string };
        // Monday 08:00 EST is 13:00Z on 2026-03-02; strictly after that, the next Monday is after DST began (EDT, 12:00Z).
        expect(nextFire).toBe("2026-03-09T12:00:00.000Z");
        const created = await state(app, automationId, "SCHEDULED");
        expect(created.run.substrate).toBe("local-desktop");
        await waitForRow<TaskRecord>(app, `task/${accepted}`, (t) => t.status === "OPERATIONALIZED");

        // A delivery receipt means DISPATCHED only.
        await inv(client, "automation.advance", { id: automationId, to: "receipt" });
        await state(app, automationId, "DISPATCHED");
        await expect(inv(client, "automation.advance", { id: automationId, to: "receipt" })).rejects.toThrow(/receipt only means DISPATCHED/);
        await expect(inv(client, "automation.advance", { id: automationId, to: "COMPLETE" })).rejects.toThrow(/[Cc]annot skip states: DISPATCHED -> COMPLETE/);
        await expect(inv(client, "automation.advance", { id: automationId, to: "VERIFIED" })).rejects.toThrow(/[Cc]annot skip states: DISPATCHED -> VERIFIED/);

        await inv(client, "automation.advance", { id: automationId, to: "RUNNING" });
        await state(app, automationId, "RUNNING");
        await expect(inv(client, "automation.advance", { id: automationId, to: "PRODUCED" })).rejects.toThrow(/nothing produced/);
        await inv(client, "automation.advance", { id: automationId, to: "PRODUCED", outputs: ["report-2026-03-09.html"] });
        const produced = await state(app, automationId, "PRODUCED");
        expect(produced.run.outputs).toEqual(["report-2026-03-09.html"]);

        // Produced but acceptance open: stays PRODUCED, and the open items are named.
        await expect(inv(client, "automation.advance", { id: automationId, to: "VERIFIED", closedAcceptance: ACCEPTANCE.slice(0, 3) })).rejects.toThrow(/evidence-ledger-closed/);
        await inv(client, "automation.advance", { id: automationId, to: "VERIFIED", closedAcceptance: ACCEPTANCE });
        await state(app, automationId, "VERIFIED");
        await inv(client, "automation.advance", { id: automationId, to: "COMPLETE" });
        const done = await state(app, automationId, "COMPLETE");
        expect(done.run.closedAcceptance).toEqual(ACCEPTANCE);
        // Terminal.
        await expect(inv(client, "automation.advance", { id: automationId, to: "FAILED", failure: "late" })).rejects.toThrow(/terminal|[Cc]annot/);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("a failure at any edge is terminal and attributable", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const accepted = await acceptTask(app, client, workspaceId);
        const schedule = { kind: "daily", hour: 6, minute: 30, timezone: "UTC" } as const;
        const { automationId } = (await inv(client, "automation.create", { name: "nightly", schedule, substrate: "local-service", acceptance: ["ok"], sourceTaskId: accepted, now: "2026-03-02T00:00:00.000Z" })) as { automationId: string };
        await state(app, automationId, "SCHEDULED");
        await inv(client, "automation.advance", { id: automationId, to: "receipt" });
        await inv(client, "automation.advance", { id: automationId, to: "FAILED", failure: "runner offline" });
        const failed = await state(app, automationId, "FAILED");
        expect(failed.run.failure).toBe("runner offline");
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
