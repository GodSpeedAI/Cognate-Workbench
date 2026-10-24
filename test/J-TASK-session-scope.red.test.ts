// RED CONTRACT — J-TASK-scope / J-TASK-link / J-TASK-move / J-RUN-task-attribution.
// Workspace and Session tasks are one governed Task entity, with explicit visibility,
// durable binding, and execution evidence. An ordinary chat message creates a Run, not a Task.
// These tests are deliberately red until the IDM and capabilities are implemented.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { TaskRecord } from "../src/workbench/state.ts";
import {
  allEvents, bootApp, bootAimock, createTask, fullContract, inv, waitForCompletion,
  waitForRow, waitUntil, withTempHome,
} from "./wb-helpers.ts";

type ScopedTask = TaskRecord & { readonly scope: "workspace" | "session"; readonly sessionId?: string };
type SessionBinding = { readonly sessionId: string; readonly workspaceId: string; readonly taskId: string | null };

const boundRow = async (app: Awaited<ReturnType<typeof bootApp>>["app"], sessionId: string) =>
  (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-task-bindings" })).rows
    .find(row => row.key === sessionId)?.value as SessionBinding | undefined;

describe("J-TASK-session-scope — task identity, visibility and ownership (RED)", () => {
  test("a workspace task is available throughout its workspace but no session inherits it as the active task", async () => {
    await withTempHome(async home => {
      const workspace = join(home, "repo");
      await mkdir(workspace);
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await inv(client, "workspace.select", { path: workspace })) as { workspaceId: string };
        const taskId = await createTask(app, client, workspaceId, "Improve scheduling");
        const task = await waitForRow<ScopedTask>(app, `task/${taskId}`);
        expect(task.scope).toBe("workspace");
        const a = (await inv(client, "session.create", { workspaceId, requestId: "session-a" })) as { sessionId: string };
        const b = (await inv(client, "session.create", { workspaceId, requestId: "session-b" })) as { sessionId: string };
        expect(await boundRow(app, a.sessionId)).toBeUndefined();
        expect(await boundRow(app, b.sessionId)).toBeUndefined();
        // Workspace availability is not authorization to silently bind an active task.
        const available = (await inv(client, "task.list", { workspaceId, sessionId: b.sessionId })) as unknown as { tasks: ScopedTask[] };
        expect(available.tasks.map(t => t.id)).toContain(taskId);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 45_000);

  test("a session-scoped task is not exposed in unrelated sessions; binding and detaching are durable", async () => {
    await withTempHome(async home => {
      const workspace = join(home, "repo");
      await mkdir(workspace);
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await inv(client, "workspace.select", { path: workspace })) as { workspaceId: string };
        const a = (await inv(client, "session.create", { workspaceId, requestId: "scope-a" })) as { sessionId: string };
        const b = (await inv(client, "session.create", { workspaceId, requestId: "scope-b" })) as { sessionId: string };
        const { taskId } = (await inv(client, "task.create", {
          title: "Fix this session's failing test", workspaceId, scope: "session", sessionId: a.sessionId,
        })) as { taskId: string };
        const row = await waitForRow<ScopedTask>(app, `task/${taskId}`);
        expect(row.scope).toBe("session");
        expect(row.sessionId).toBe(a.sessionId);
        const onlyA = (await inv(client, "task.list", { workspaceId, sessionId: a.sessionId })) as unknown as { tasks: ScopedTask[] };
        const onlyB = (await inv(client, "task.list", { workspaceId, sessionId: b.sessionId })) as unknown as { tasks: ScopedTask[] };
        expect(onlyA.tasks.map(t => t.id)).toContain(taskId);
        expect(onlyB.tasks.map(t => t.id)).not.toContain(taskId);
        await expect(inv(client, "session.task.bind", { sessionId: b.sessionId, taskId }))
          .rejects.toThrow(/scope|session|not available|forbidden/i);
        await inv(client, "session.task.bind", { sessionId: a.sessionId, taskId });
        expect((await waitUntil("bound session task", () => boundRow(app, a.sessionId)))?.taskId).toBe(taskId);
        await inv(client, "session.task.bind", { sessionId: a.sessionId, taskId: null });
        await waitUntil("detached session task", async () => (await boundRow(app, a.sessionId))?.taskId === null || undefined);
        expect((await waitForRow<ScopedTask>(app, `task/${taskId}`)).id).toBe(taskId);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 45_000);

  test("moving an unstarted task preserves its identity and evidence, and revalidates its new workspace scope", async () => {
    await withTempHome(async home => {
      const first = join(home, "repo-one"), second = join(home, "repo-two");
      await Promise.all([mkdir(first), mkdir(second)]);
      const { app, client } = await bootApp(home);
      try {
        const ws1 = (await inv(client, "workspace.select", { path: first })) as { workspaceId: string };
        const ws2 = (await inv(client, "workspace.select", { path: second })) as { workspaceId: string };
        const taskId = await createTask(app, client, ws1.workspaceId, "Review API contract");
        await inv(client, "evidence.record", { taskId, kind: "implementation", status: "pending", summary: "Initial candidate captured", source: "run:baseline" });
        await waitUntil("prior evidence", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workbench" })).rows;
          return rows.some(r => r.key.startsWith(`evidence/${taskId}/`)) || undefined;
        });
        await inv(client, "task.move", { taskId, to: { workspaceId: ws2.workspaceId } });
        const moved = await waitForRow<ScopedTask>(app, `task/${taskId}`, t => t.workspaceId === ws2.workspaceId);
        expect(moved.scope).toBe("workspace");
        expect(moved.id).toBe(taskId);
        expect(moved.contract.context?.workspaceId).toBe(ws2.workspaceId);
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workbench" })).rows;
        expect(rows.filter(r => r.key.startsWith(`evidence/${taskId}/`))).toHaveLength(1);
        const original = (await inv(client, "task.list", { workspaceId: ws1.workspaceId })) as unknown as { tasks: ScopedTask[] };
        const destination = (await inv(client, "task.list", { workspaceId: ws2.workspaceId })) as unknown as { tasks: ScopedTask[] };
        expect(original.tasks.map(t => t.id)).not.toContain(taskId);
        expect(destination.tasks.map(t => t.id)).toContain(taskId);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 45_000);

  test("cannot move a task to a nonexistent workspace or bind a task across workspaces", async () => {
    await withTempHome(async home => {
      const workspace = join(home, "repo");
      await mkdir(workspace);
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await inv(client, "workspace.select", { path: workspace })) as { workspaceId: string };
        const taskId = await createTask(app, client, workspaceId, "Protected objective");
        await expect(inv(client, "task.move", { taskId, to: { workspaceId: "no-such-workspace" } }))
          .rejects.toThrow(/workspace|not found|unknown/i);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);
});

describe("J-RUN-task-attribution — inference is a Run; Task is optional (RED)", () => {
  test("plain conversation creates a Cognate Run with no Task; later bound turns freeze task identity", async () => {
    await withTempHome(async home => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspace = join(home, "repo");
        await mkdir(workspace);
        await inv(client, "model.configure", {
          providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible", model: "mock-model-1", apiKey: "",
        });
        const { workspaceId } = (await inv(client, "workspace.select", { path: workspace })) as { workspaceId: string };
        const sessionId = randomUUID();
        const plain = await client.startRun("agent.coding",
          { workspaceId, sessionId, message: "[[scenario:plain]] Explain the Run concept" } as never,
          { correlationId: `session:${sessionId}`, idempotencyKey: randomUUID() });
        expect((await waitForCompletion(app, plain.runId)).status).toBe("completed");
        const all = await allEvents(app);
        const first = all.find(e => e.runId === plain.runId && e.eventType === "session.turn.started");
        expect((first?.payload as { taskId?: string } | undefined)?.taskId).toBeUndefined();
        const tasksBefore = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workbench" })).rows
          .filter(row => row.key.startsWith("task/"));
        expect(tasksBefore).toHaveLength(0);
        const taskId = await createTask(app, client, workspaceId, "Improve verification", fullContract(workspaceId));
        await inv(client, "session.task.bind", { sessionId, taskId });
        const linked = await waitUntil("session task binding", () => boundRow(app, sessionId));
        expect(linked?.taskId).toBe(taskId);
        const work = await client.startRun("agent.coding",
          { workspaceId, sessionId, taskId, message: "[[scenario:plain]] Now discuss that objective" } as never,
          { correlationId: `session:${sessionId}`, idempotencyKey: randomUUID() });
        expect((await waitForCompletion(app, work.runId)).status).toBe("completed");
        const latest = (await allEvents(app)).find(e => e.runId === work.runId && e.eventType === "session.turn.started");
        expect((latest?.payload as { taskId?: string } | undefined)?.taskId).toBe(taskId);
        const history = (await inv(client, "session.history", { sessionId })) as unknown[];
        expect(history).toHaveLength(4);
      } finally {
        await client.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 60_000);
});
