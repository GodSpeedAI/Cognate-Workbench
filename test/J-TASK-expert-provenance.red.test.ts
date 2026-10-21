// RED CONTRACT — J-TASK-expert-provenance.
// Delegation is an execution mechanism in service of an accountable Task, not a second task store.
// An orchestrator's Assignment and its specialist children inherit the explicitly authorized
// taskId; their Run IDs/handoffs are traceable, but model output cannot grant human acceptance.
import { expect, test } from "bun:test";
import { configureDefaultRoutes, collaborationResponder, invoke, waitForState, withExpertApp } from "./expert-helpers.ts";
import { waitForRow } from "./wb-helpers.ts";
import type { TaskRecord } from "../src/workbench/state.ts";

test("J-TASK-expert-provenance (RED): PM and Specialist assignments retain a Task link, separate Runs, and unresolved settlement", async () => {
  await withExpertApp(collaborationResponder, async app => {
    await configureDefaultRoutes(app);
    const created = (await invoke(app, "task.create", {
      title: "Review scheduler correctness", workspaceId: app.workspaceId, scope: "workspace",
    })) as { taskId: string };
    const taskId = created.taskId;
    await waitForRow<TaskRecord>(app.app, `task/${taskId}`);
    const result = (await invoke(app, "team.converse", {
      teamId: "cognate-team", workspaceId: app.workspaceId, taskId,
      message: "Delegate implementation to Builder and reconcile its evidence.",
      requestId: "task-linked-expert-delegation",
    })) as { assignmentId: string };
    const finished = await waitForState(app, s => !!s.assignments[result.assignmentId]?.handoff,
      "task-related Product Manager handoff");
    const parent = finished.assignments[result.assignmentId]!;
    const child = Object.values(finished.assignments).find(a => a.parentId === parent.id);
    expect(child).toBeDefined();
    // These are proposed model-first additions; today's Assignment type does not expose taskId.
    expect((parent as typeof parent & { taskId?: string }).taskId).toBe(taskId);
    expect((child as typeof child & { taskId?: string }).taskId).toBe(taskId);
    expect(parent.runId).toBeTruthy();
    expect(child?.runId).toBeTruthy();
    expect(parent.runId).not.toBe(child?.runId);
    const task = await waitForRow<TaskRecord>(app.app, `task/${taskId}`);
    expect(task.id).toBe(taskId);
    expect(task.humanApproved).toBe(false);
    expect(task.status).not.toBe("ACCEPTED");
  });
}, 60_000);
