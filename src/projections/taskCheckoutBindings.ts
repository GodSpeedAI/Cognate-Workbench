// Public projection `task-checkout-bindings` (J-CHECKOUT): one durable row per Task that names
// the isolated Git checkout the Task's work is bound to — `{ taskId, workspaceId, root, branch,
// kind }`, keyed `${tenant}/task/${taskId}`. The truth is the `workbench.checkout.bound` /
// `workbench.checkout.removed` event log (recorded by the validated `git.checkout.*`
// capabilities through `agent.config`'s `workbench.recorded` command); these rows are derived
// and rebuildable, and survive restart.
//
// The association is never inferred and never rewritten silently: a removal deletes the row
// while the events (and every run's frozen per-turn checkout) keep the history. A Git worktree
// is *where a Task's work happens* — never a second workspace, a second task ledger, or a
// Cognate execution-world / cognitive candidate-world fork.
import type { Projection } from "@godspeedai/cognate-projections";

export interface TaskCheckoutBindingRow {
  readonly taskId: string;
  readonly workspaceId: string;
  /** The checkout root (a provider-owned path in the workspace's execution world). */
  readonly root: string;
  readonly branch: string;
  readonly kind: "worktree";
}

export const taskCheckoutBindingsProjection: Projection = {
  name: "task-checkout-bindings",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType === "workbench.checkout.bound") {
      const payload = event.payload as Partial<TaskCheckoutBindingRow>;
      if (typeof payload.taskId !== "string" || typeof payload.workspaceId !== "string"
        || typeof payload.root !== "string" || typeof payload.branch !== "string") return [];
      const key = `${event.tenant}/task/${payload.taskId}`;
      const existing = state.get(key) as TaskCheckoutBindingRow | undefined;
      // Idempotent fold: replaying the same bound event must not duplicate the row.
      if (existing && existing.root === payload.root && existing.branch === payload.branch) return [];
      const row: TaskCheckoutBindingRow = {
        taskId: payload.taskId,
        workspaceId: payload.workspaceId,
        root: payload.root,
        branch: payload.branch,
        kind: "worktree",
      };
      return [{ key, value: row as unknown as import("@godspeedai/cognate-events").Json }];
    }
    if (event.eventType === "workbench.checkout.removed") {
      const payload = event.payload as { readonly taskId?: unknown };
      if (typeof payload.taskId !== "string") return [];
      const key = `${event.tenant}/task/${payload.taskId}`;
      if (state.get(key) === undefined) return [];
      return [{ key, value: null }];
    }
    return [];
  },
};
