// Journey J-WB-review-gate (V-008, V-009): produced, tested, ready for review and accepted are
// different facts. A worker claiming "done" is not acceptance; only a person accepts.
import { describe, expect, test } from "bun:test";
import { doneLevel, ledgerRows, openRequired, reviewReadiness } from "../src/workbench/ledger.ts";
import type { TaskRecord } from "../src/workbench/state.ts";
import type { EvidenceEntry, WorkerReturn } from "../src/workbench/types.ts";
import { SYSTEM, bootApp, createTask, fullContract, rowsWithPrefix, seedWorkspaceOnly, waitForRow, waitUntil, withTempHome, type AppServer, inv } from "./wb-helpers.ts";

const evidenceOf = (app: AppServer, taskId: string) => rowsWithPrefix<EvidenceEntry>(app, `evidence/${taskId}/`);

describe("J-WB-review-gate", () => {
  test("V-008 and V-009: readiness needs the whole return contract and independent evidence; acceptance is human-only", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const taskId = await createTask(app, client, workspaceId, "Compute totals", fullContract(workspaceId));
        await inv(client, "task.contract.update", { taskId, contract: fullContract(workspaceId) });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => (t.contract.acceptance?.length ?? 0) === 3);

        // The worker says it is done, but reported nothing: not ready, and the blockers say why.
        await inv(client, "worker.return", { taskId, workerReturn: { changed: [], tested: [], evidence: [], remaining: [], risks: [], readyForReview: true } satisfies WorkerReturn });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.finished);
        await expect(inv(client, "task.review.request", { taskId })).rejects.toThrow(/changed files not reported.*tests not reported.*evidence not attached/s);

        // Passing tests recorded, full return contract: STILL blocked, because an independent check is required (V-009).
        const { evidenceId } = (await inv(client, "evidence.record", { taskId, kind: "test", status: "pass", summary: "4 of 4 unit tests pass", criterionId: "ac-1", source: "bun test" })) as { evidenceId: string };
        await waitUntil("test evidence", async () => (await evidenceOf(app, taskId)).length === 1);
        await inv(client, "worker.return", { taskId, workerReturn: { changed: ["report.html"], tested: ["bun test"], evidence: [evidenceId], remaining: [], risks: [], readyForReview: true } });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.workerReturn?.changed.length === 1);
        await expect(inv(client, "task.review.request", { taskId })).rejects.toThrow(/independent check required but tests alone passed/);

        // The done taxonomy stays separated: finished and produced, but not tested-closed, not accepted.
        const task = await waitForRow<TaskRecord>(app, `task/${taskId}`);
        const rows = ledgerRows(task.contract.acceptance ?? [], await evidenceOf(app, taskId));
        expect(openRequired(rows).filter((r) => r.kind !== "human").map((r) => r.criterionId)).toEqual(["ac-2"]);
        expect(doneLevel({ finished: task.finished, produced: task.produced, readiness: reviewReadiness({ acceptance: task.contract.acceptance ?? [], entries: await evidenceOf(app, taskId), ...(task.workerReturn ? { workerReturn: task.workerReturn } : {}) }), testedClosed: false, accepted: false, operationalized: false })).toBe("produced");

        // The independent check closes the gap.
        await inv(client, "evidence.record", { taskId, kind: "independent-check", status: "pass", summary: "totals match the independent calculation", criterionId: "ac-2" });
        await waitUntil("independent evidence", async () => (await evidenceOf(app, taskId)).length === 2);
        await inv(client, "task.review.request", { taskId });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "READY_FOR_REVIEW");

        // Ready for review is not accepted, and an agent (non-user principal) cannot accept.
        await expect(app.runtime.service.invoke(SYSTEM, { capability: "task.review.decide", input: { taskId, decision: "accept" } as never })).rejects.toThrow(/human decision/);
        expect((await waitForRow<TaskRecord>(app, `task/${taskId}`)).status).toBe("READY_FOR_REVIEW");

        // A reviewer asks for rework: the task goes back, with the decision recorded as failed human evidence.
        await inv(client, "task.review.decide", { taskId, decision: "rework", note: "show the net revenue line" });
        const reworked = await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "REWORK");
        expect(reworked.humanApproved).toBe(false);
        expect((await evidenceOf(app, taskId)).some((e) => e.kind === "human" && e.status === "fail" && e.summary.includes("net revenue"))).toBe(true);

        // Rework, resubmit, then the reviewer accepts.
        await inv(client, "task.review.request", { taskId });
        await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "READY_FOR_REVIEW");
        await inv(client, "task.review.decide", { taskId, decision: "accept", note: "looks right" });
        const accepted = await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "ACCEPTED");
        expect(accepted.humanApproved).toBe(true);
        // The human criterion is now closed by observable evidence, not by assertion.
        const finalRows = ledgerRows(accepted.contract.acceptance ?? [], await evidenceOf(app, taskId));
        expect(finalRows.find((r) => r.criterionId === "ac-3")?.state).toBe("closed");
        expect(doneLevel({ finished: true, produced: true, readiness: { ready: true, blockers: [] }, testedClosed: true, accepted: true, operationalized: false })).toBe("accepted");
        // A decided task cannot be decided again.
        await expect(inv(client, "task.review.decide", { taskId, decision: "accept" })).rejects.toThrow(/not READY_FOR_REVIEW/);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
