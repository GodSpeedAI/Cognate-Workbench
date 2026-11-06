// J-CHECKOUT (PandaCode worktree affordance): the governed Task-to-checkout capabilities.
//
// `git.checkout.attach` binds a Task to an isolated Git worktree of its workspace's repository
// (J-CHECKOUT-BIND); `task.checkout.resolve` is the recorded read the agent loop uses so a
// bound Task's turns execute inside the checkout (J-CHECKOUT-EXECUTION); the lifecycle trio
// `git.checkout.status` / `merge` / `remove` / `recreate` gives the operator safe integration
// and cleanup (J-CHECKOUT-LIFECYCLE).
//
// Same shape as `session.task.bind` / `workbench.ts`: each handler validates against the live
// projections, performs the guarded Git operation through the workspace's execution world
// (`src/workbench/gitOps.ts` — argv arrays, bounded output, nothing forced), and records the
// association durably via a deterministic `agent.config` `workbench.recorded` run. The durable
// event log, never component memory, owns the association. Mutating capabilities are
// operator-only (the containedWorkspace precedent): an agent run cannot merge or remove its own
// checkout, and `task.checkout.resolve` — the one an agent run may invoke — is a pure read.
import { randomUUID } from "node:crypto";
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import {
  checkoutBranchName, createWorktree, isRepository, listBranches, mergeWorktree, MergeConflictError,
  recreateWorktree, removeWorktree, worktreeDestination, worktreeExists, worktreeStatus,
  WORKTREE_CAPABLE_WORLD_KINDS,
} from "../workbench/gitOps.ts";
import type { ScopedTaskRecord } from "../workbench/state.ts";
import type { TaskCheckoutBindingRow } from "../projections/taskCheckoutBindings.ts";

export interface TaskCheckoutOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  /** Bound semantic refs; a missing ref means the model binding is absent, never a silent bypass. */
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}

export interface CheckoutAttachInput {
  readonly taskId: string;
  readonly branch: string;
  /** The local branch to start from; omit for the repository's current HEAD. */
  readonly base?: string;
  /** Adopt the existing branch instead of refusing the collision. */
  readonly existing?: boolean;
}

const operatorOnly = (ctx: HandlerContext, capability: string): void => {
  if (ctx.actor.kind !== "user" || ctx.runId) throw new Error(`${capability}: only a direct human operator may ${capability}`);
};

export function taskCheckoutComponent(options: TaskCheckoutOptions): Component {
  const service = options.getService;
  const ref = (id: string) => options.semanticRefs[id];

  const taskRow = async (taskId: string): Promise<ScopedTaskRecord> => {
    const rows = (await service().readProjection(options.systemCaller, { name: "workbench" })).rows;
    const task = rows.find(row => row.key === `task/${taskId}`)?.value as ScopedTaskRecord | undefined;
    if (!task) throw new Error(`unknown task ${taskId}`);
    return task;
  };

  const workspaceRoot = async (workspaceId: string): Promise<{ readonly root: string; readonly executionWorldId: string }> => {
    const rows = (await service().readProjection(options.systemCaller, { name: "workspaces" })).rows;
    const row = rows.find(entry => entry.key === `record/${workspaceId}`)?.value as
      | { readonly root: string; readonly executionWorldId: string }
      | undefined;
    if (!row) throw new Error(`unknown workspace ${workspaceId}`);
    return row;
  };

  // Match on the row's own `taskId`, not on a key shape: the projection key embeds the recording
  // event's tenant, which is legitimately empty for local first-party recordings.
  const bindingRow = async (taskId: string): Promise<TaskCheckoutBindingRow | undefined> =>
    ((await service().readProjection(options.systemCaller, { name: "task-checkout-bindings" })).rows
      .find(row => (row.value as unknown as TaskCheckoutBindingRow | undefined)?.taskId === taskId)?.value as unknown as TaskCheckoutBindingRow | undefined);

  const providerFor = async (executionWorldId: string, capability: string) => {
    if (!options.registry.has(executionWorldId)) throw new Error(`${capability}: the workspace's execution world is not connected`);
    const provider = options.registry.get(executionWorldId);
    if (!WORKTREE_CAPABLE_WORLD_KINDS.has(provider.kind)) {
      throw new Error(`${capability}: this workspace runs in a '${provider.kind}' execution world whose sandbox cannot reach a worktree beside the repository — reconnect the workspace on a local, WSL or SSH world to use task checkouts`);
    }
    return provider;
  };

  // `recordAndWait` (workbench.ts precedent): attach/remove are client-invoked and their result
  // is validated immediately against the folded projection, so the deterministic recording run
  // must settle before the capability returns. Never called from an agent-reachable path.
  const recordAndWait = async (events: readonly { readonly type: string; readonly payload: Json }[], correlationId: string): Promise<void> => {
    const { runId } = await service().startRun(options.systemCaller, {
      agent: AGENT_CONFIG,
      input: { kind: "workbench.recorded", events: JSON.parse(JSON.stringify(events)) as Json },
      idempotencyKey: randomUUID(),
      correlationId,
    });
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await service().getRun(options.systemCaller, { runId });
      if (run.status === "completed") return;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`git.checkout: recording failed (${run.status})`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("git.checkout: recording timed out");
  };

  return {
    id: "task:checkout",
    provides: [
      { id: "git.branch.list", version: "1.0.0", semanticRef: ref("git.branch.list") },
      { id: "git.checkout.attach", version: "1.0.0", semanticRef: ref("git.checkout.attach") },
      { id: "git.checkout.status", version: "1.0.0", semanticRef: ref("git.checkout.status") },
      { id: "git.checkout.merge", version: "1.0.0", semanticRef: ref("git.checkout.merge") },
      { id: "git.checkout.remove", version: "1.0.0", semanticRef: ref("git.checkout.remove") },
      { id: "git.checkout.recreate", version: "1.0.0", semanticRef: ref("git.checkout.recreate") },
      { id: "task.checkout.resolve", version: "1.0.0", semanticRef: ref("task.checkout.resolve") },
    ],
    activate(fiber) {
      fiber.provide({ id: "git.branch.list", version: "1.0.0", semanticRef: ref("git.branch.list") }, async (rawInput) => {
        const input = rawInput as { readonly workspaceId?: unknown };
        if (typeof input.workspaceId !== "string" || !input.workspaceId.trim()) throw new Error("git.branch.list: a workspaceId is required");
        const workspace = await workspaceRoot(input.workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.branch.list");
        if (!(await isRepository(provider, workspace.root))) throw new Error("git.branch.list: the workspace root is not a Git repository");
        return listBranches(provider, workspace.root);
      });

      fiber.provide({ id: "git.checkout.attach", version: "1.0.0", semanticRef: ref("git.checkout.attach") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "git.checkout.attach");
        const input = rawInput as CheckoutAttachInput;
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("git.checkout.attach: a taskId is required");
        if (typeof input.branch !== "string" || !input.branch.trim()) throw new Error("git.checkout.attach: a branch name is required");
        if (input.base !== undefined && typeof input.base !== "string") throw new Error("git.checkout.attach: base must be a local branch name");
        const task = await taskRow(input.taskId);
        if (task.status === "RUNNING") throw new Error("git.checkout.attach: the task is RUNNING — stop it before changing its checkout; in-flight work is never silently reassigned");
        const workspaceId = task.workspaceId;
        const workspace = await workspaceRoot(workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.checkout.attach");
        if (!(await isRepository(provider, workspace.root))) throw new Error("git.checkout.attach: the workspace root is not a Git repository");
        // One live checkout per task: rebinding without retiring the old one would leave a
        // registered worktree nothing manages. The UI removes first; an API caller must too.
        const existing = await bindingRow(task.id);
        if (existing && (await worktreeExists(provider, existing.root))) {
          throw new Error(`git.checkout.attach: task ${task.id} already works in ${existing.branch} — remove or recreate that checkout before binding another branch`);
        }
        // One checkout, one task: a destination another task already owns is a collision, and a
        // re-bind moves this task forward without rewriting any run's frozen per-turn checkout.
        // Checked before creation so a refused bind never leaves a worktree behind.
        const branch = checkoutBranchName(input.branch);
        const destination = worktreeDestination(workspace.root, branch);
        const bindings = (await service().readProjection(options.systemCaller, { name: "task-checkout-bindings" })).rows;
        const collision = bindings.find(row => {
          const value = row.value as unknown as TaskCheckoutBindingRow;
          return value.taskId !== task.id && (value.root === destination || value.branch === branch);
        });
        if (collision) throw new Error(`git.checkout.attach: another task already works in that checkout — remove its binding first`);
        const created = await createWorktree(provider, workspace.root, { branch: input.branch, ...(input.base ? { base: input.base } : {}), ...(input.existing !== undefined ? { existing: input.existing } : {}) });
        await recordAndWait(
          [{
            type: "workbench.checkout.bound",
            payload: { taskId: task.id, workspaceId, root: created.path, branch: created.branch } as unknown as Json,
          }],
          `task:${task.id}`,
        );
        return { taskId: task.id, workspaceId, root: created.path, branch: created.branch, kind: "worktree" as const };
      });

      fiber.provide({ id: "git.checkout.status", version: "1.0.0", semanticRef: ref("git.checkout.status") }, async (rawInput) => {
        const input = rawInput as { readonly taskId?: unknown };
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("git.checkout.status: a taskId is required");
        const binding = await bindingRow(input.taskId);
        if (!binding) throw new Error(`git.checkout.status: task ${input.taskId} has no checkout binding`);
        const workspace = await workspaceRoot(binding.workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.checkout.status");
        return { ...(await worktreeStatus(provider, workspace.root, binding.root, binding.branch)), root: binding.root };
      });

      fiber.provide({ id: "git.checkout.merge", version: "1.0.0", semanticRef: ref("git.checkout.merge") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "git.checkout.merge");
        const input = rawInput as { readonly taskId?: unknown; readonly target?: unknown };
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("git.checkout.merge: a taskId is required");
        const task = await taskRow(input.taskId);
        if (task.status === "RUNNING") throw new Error("git.checkout.merge: the task is RUNNING — wait for the agent to finish before merging");
        const binding = await bindingRow(input.taskId);
        if (!binding) throw new Error(`git.checkout.merge: task ${input.taskId} has no checkout binding`);
        const workspace = await workspaceRoot(binding.workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.checkout.merge");
        const branches = await listBranches(provider, workspace.root);
        const target = typeof input.target === "string" && input.target.trim() ? input.target.trim() : branches.default;
        if (!target) throw new Error("git.checkout.merge: the repository has no default branch — name the target branch explicitly");
        if (!branches.branches.includes(target)) throw new Error(`git.checkout.merge: there is no local branch named ${target}`);
        try {
          const merged = await mergeWorktree(provider, workspace.root, binding.root, target);
          return { ...merged, taskId: task.id };
        } catch (error) {
          if (error instanceof MergeConflictError) return { conflicted: true as const, branch: error.branch, target: error.target, conflicts: error.conflicts, message: error.message, taskId: task.id };
          throw error;
        }
      });

      fiber.provide({ id: "git.checkout.remove", version: "1.0.0", semanticRef: ref("git.checkout.remove") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "git.checkout.remove");
        const input = rawInput as { readonly taskId?: unknown; readonly deleteBranch?: unknown };
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("git.checkout.remove: a taskId is required");
        const task = await taskRow(input.taskId);
        if (task.status === "RUNNING") throw new Error("git.checkout.remove: the task is RUNNING — wait for the agent to finish before removing its checkout");
        const binding = await bindingRow(input.taskId);
        if (!binding) throw new Error(`git.checkout.remove: task ${input.taskId} has no checkout binding`);
        const workspace = await workspaceRoot(binding.workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.checkout.remove");
        // Untracked files count as work too: `hasTrackedChanges` is the merge guard, where
        // untracked scratch is harmless — removal must never discard either kind.
        const status = await worktreeStatus(provider, workspace.root, binding.root, binding.branch);
        if (status.changes > 0) {
          throw new Error("git.checkout.remove: the worktree has uncommitted changes — commit them before removing the checkout; work is never discarded");
        }
        const removal = await removeWorktree(provider, workspace.root, binding.root, binding.branch, input.deleteBranch === true);
        await recordAndWait(
          [{ type: "workbench.checkout.removed", payload: { taskId: task.id, root: binding.root, branch: binding.branch } as unknown as Json }],
          `task:${task.id}`,
        );
        return { ...removal, taskId: task.id };
      });

      fiber.provide({ id: "git.checkout.recreate", version: "1.0.0", semanticRef: ref("git.checkout.recreate") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "git.checkout.recreate");
        const input = rawInput as { readonly taskId?: unknown };
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("git.checkout.recreate: a taskId is required");
        const binding = await bindingRow(input.taskId);
        if (!binding) throw new Error(`git.checkout.recreate: task ${input.taskId} has no checkout binding`);
        const workspace = await workspaceRoot(binding.workspaceId);
        const provider = await providerFor(workspace.executionWorldId, "git.checkout.recreate");
        const root = await recreateWorktree(provider, workspace.root, binding.root, binding.branch);
        return { taskId: input.taskId, root, branch: binding.branch };
      });

      fiber.provide({ id: "task.checkout.resolve", version: "1.0.0", semanticRef: ref("task.checkout.resolve") }, async (rawInput) => {
        const input = rawInput as { readonly taskId?: unknown };
        if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("task.checkout.resolve: a taskId is required");
        return (await bindingRow(input.taskId)) ?? null;
      });
    },
  };
}
