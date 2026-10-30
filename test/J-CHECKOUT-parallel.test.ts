// Journey J-CHECKOUT-BIND + J-CHECKOUT-EXECUTION: two Tasks bound to sibling Git worktrees of one
// workspace edit the SAME relative filename at the same time. Both writes must land, each only in
// its own checkout, the repository's main checkout must never see either write, and the turn's
// durable evidence must freeze which checkout (root + branch) actually served it. A restart on the
// same home must restore the association from the event log — never from process memory — and the
// restored checkout must still execute.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { bootApp, bootAimock, fullContract, inv, seed, waitForCompletion, withTempHome } from "./wb-helpers.ts";
import { allEvents, createTask, gitIn } from "./wb-helpers.ts";

interface CheckoutAttachResult {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly root: string;
  readonly branch: string;
  readonly kind: string;
}

interface CheckoutBindingRow {
  readonly taskId: string;
  readonly root: string;
  readonly branch: string;
}

interface TurnPayload {
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly checkoutRoot?: string;
  readonly checkoutBranch?: string;
}

const waitForBinding = async (client: Awaited<ReturnType<typeof bootApp>>["client"], taskId: string): Promise<CheckoutBindingRow> => {
  for (let attempt = 0; attempt < 400; attempt++) {
    const resolved = (await client.invoke("task.checkout.resolve", { taskId } as never)) as unknown as CheckoutBindingRow | null;
    if (resolved && typeof resolved.root === "string" && typeof resolved.branch === "string") return resolved;
    await Bun.sleep(25);
  }
  throw new Error(`task ${taskId} never regained its checkout binding after restart`);
};

describe("J-CHECKOUT-parallel", () => {
  test("two tasks edit the same relative filename in sibling worktrees; the main checkout is untouched", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seed(client, home, aimock.port);
        const taskA = await createTask(app, client, workspaceId, "Task A", fullContract(workspaceId));
        const taskB = await createTask(app, client, workspaceId, "Task B", fullContract(workspaceId));

        const wantA = (await inv(client, "git.checkout.attach", { taskId: taskA, branch: "feature-a" })) as unknown as CheckoutAttachResult;
        const wantB = (await inv(client, "git.checkout.attach", { taskId: taskB, branch: "feature-b" })) as unknown as CheckoutAttachResult;
        expect(wantA.kind).toBe("worktree");
        expect(wantA.branch).toBe("workbench/feature-a");
        expect(wantB.branch).toBe("workbench/feature-b");
        expect(wantA.root).not.toBe(wantB.root);
        expect(existsSync(join(wantA.root, "src", "greet.ts"))).toBe(true);
        expect(existsSync(join(wantB.root, "src", "greet.ts"))).toBe(true);

        const sessionA = randomUUID();
        const sessionB = randomUUID();
        const runA = await client.startRun(
          "agent.coding",
          { sessionId: sessionA, workspaceId, taskId: taskA, message: "[[scenario:checkout-a]] write your note" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionA}` },
        );
        const runB = await client.startRun(
          "agent.coding",
          { sessionId: sessionB, workspaceId, taskId: taskB, message: "[[scenario:checkout-b]] write your note" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionB}` },
        );
        const [doneA, doneB] = await Promise.all([waitForCompletion(app, runA.runId), waitForCompletion(app, runB.runId)]);
        expect(doneA.status).toBe("completed");
        expect(doneB.status).toBe("completed");

        // The same relative path, two different contents, each in its own checkout.
        expect(await readFile(join(wantA.root, "shared.txt"), "utf8")).toBe("task-a\n");
        expect(await readFile(join(wantB.root, "shared.txt"), "utf8")).toBe("task-b\n");

        // The main checkout never saw either write and stays exactly as committed.
        expect(existsSync(join(workspaceDir, "shared.txt"))).toBe(false);
        expect(await readFile(join(workspaceDir, "src", "greet.ts"), "utf8")).toContain("Hello");
        expect((await gitIn(workspaceDir, ["status", "--porcelain"])).trim()).toBe("");

        // Durable turn evidence freezes the checkout that served each turn.
        const turns = (await allEvents(app))
          .filter((event) => event.eventType === "session.turn.started")
          .map((event) => event.payload as TurnPayload);
        const turnA = turns.find((payload) => payload.sessionId === sessionA);
        const turnB = turns.find((payload) => payload.sessionId === sessionB);
        expect(turnA?.taskId).toBe(taskA);
        expect(turnA?.checkoutRoot).toBe(wantA.root);
        expect(turnA?.checkoutBranch).toBe("workbench/feature-a");
        expect(turnB?.taskId).toBe(taskB);
        expect(turnB?.checkoutRoot).toBe(wantB.root);
        expect(turnB?.checkoutBranch).toBe("workbench/feature-b");

        // Status is read from the real worktree, not from the binding.
        const statusA = (await inv(client, "git.checkout.status", { taskId: taskA })) as {
          readonly exists: boolean;
          readonly branch: string;
          readonly changes: number;
          readonly root: string;
        };
        expect(statusA.exists).toBe(true);
        expect(statusA.branch).toBe("workbench/feature-a");
        expect(statusA.root).toBe(wantA.root);
        expect(statusA.changes).toBeGreaterThanOrEqual(1);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);

  test("a restart restores the binding from the event log and the restored checkout still executes", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const first = await bootApp(home);
      let workspaceId: string;
      let workspaceDir: string;
      let taskId: string;
      let root: string;
      try {
        const seeded = await seed(first.client, home, aimock.port);
        workspaceId = seeded.workspaceId;
        workspaceDir = seeded.workspaceDir;
        taskId = await createTask(first.app, first.client, workspaceId, "Restart task", fullContract(workspaceId));
        const attached = (await inv(first.client, "git.checkout.attach", { taskId, branch: "feature-restart" })) as unknown as CheckoutAttachResult;
        root = attached.root;
        expect(existsSync(root)).toBe(true);
      } finally {
        await first.app.stop();
      }

      const second = await bootApp(home);
      try {
        await inv(second.client, "workspace.select", { path: workspaceDir });
        const restored = await waitForBinding(second.client, taskId);
        expect(restored.root).toBe(root);
        expect(restored.branch).toBe("workbench/feature-restart");

        const status = (await inv(second.client, "git.checkout.status", { taskId })) as unknown as { readonly exists: boolean; readonly branch: string };
        expect(status.exists).toBe(true);
        expect(status.branch).toBe("workbench/feature-restart");

        // The restored checkout is still the execution site, not just a remembered row.
        const sessionId = randomUUID();
        const run = await second.client.startRun(
          "agent.coding",
          { sessionId, workspaceId, taskId, message: "[[scenario:checkout-a]] write after restart" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const done = await waitForCompletion(second.app, run.runId);
        expect(done.status).toBe("completed");
        expect(await readFile(join(root, "shared.txt"), "utf8")).toBe("task-a\n");
        expect(existsSync(join(workspaceDir, "shared.txt"))).toBe(false);
      } finally {
        await second.app.stop();
        await aimock.stop();
      }
    });
  }, 180_000);
});
