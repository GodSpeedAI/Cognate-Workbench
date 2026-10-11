// Journey J-WB-task-contract (V-001): a task's contract (Context | Goal | Skills | Authority |
// Executors | Budget | Invariants | Acceptance) is explicit and complete before execution begins.
// Real server, durable event log, derived `workbench` projection.
import { describe, expect, test } from "bun:test";
import { contractMissing } from "../src/workbench/contract.ts";
import type { TaskRecord } from "../src/workbench/state.ts";
import { allEvents, bootApp, createTask, fullContract, seedWorkspaceOnly, waitForRow, withTempHome, inv } from "./wb-helpers.ts";

describe("J-WB-task-contract", () => {
  test("V-001: an incomplete contract names what is missing and refuses READY; a complete one runs and then locks", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);

        // Workspace existence is not task scope: a task must bind to a real workspace.
        await expect(inv(client, "task.create", { title: "x", workspaceId: "ws-nope" })).rejects.toThrow(/unknown workspace/);

        const taskId = await createTask(app, client, workspaceId, "Update greeting");
        const created = await waitForRow<TaskRecord>(app, `task/${taskId}`);
        expect(created.status).toBe("BRIEFING");
        expect(created.workspaceId).toBe(workspaceId);
        // Authority starts as "no authority by default": read only.
        expect(created.contract.authority?.filesystem.write).toBe("no");
        expect(contractMissing(created.contract)).toEqual(["goal", "skills", "executors", "budget", "invariants", "acceptance"]);

        // READY is refused while fields are missing, and the error names them.
        await expect(inv(client, "task.status.change", { taskId, to: "READY" })).rejects.toThrow(/incomplete.*goal.*acceptance/s);
        // Readiness is evaluated, acceptance is human: neither can be declared through a status change.
        await expect(inv(client, "task.status.change", { taskId, to: "READY_FOR_REVIEW" })).rejects.toThrow(/evaluated, not declared/);
        await expect(inv(client, "task.status.change", { taskId, to: "ACCEPTED" })).rejects.toThrow(/human decision/);

        // Fill the contract.
        const full = fullContract(workspaceId);
        const result = (await inv(client, "task.contract.update", { taskId, contract: full })) as { missing: string[] };
        expect(result.missing).toEqual([]);
        const updated = await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => (t.contract.acceptance?.length ?? 0) === 3);
        // The workspace binding cannot be rebound by a patch.
        expect(updated.contract.context?.workspaceId).toBe(workspaceId);

        await inv(client, "task.status.change", { taskId, to: "READY" });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "READY");
        await inv(client, "task.status.change", { taskId, to: "RUNNING" });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "RUNNING");

        // The contract is locked while running.
        await expect(inv(client, "task.contract.update", { taskId, contract: { goal: { outcome: "different", nonGoals: [] } } })).rejects.toThrow(/RUNNING/);

        // Evidence of the journey in the durable log: every transition is an event.
        const types = (await allEvents(app)).map((e) => e.eventType).filter((t) => t.startsWith("workbench.task."));
        expect(types).toEqual(["workbench.task.created", "workbench.task.contract.updated", "workbench.task.status.changed", "workbench.task.status.changed"]);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
