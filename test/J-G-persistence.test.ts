// Journey J-G-persistence: close the runtime, reopen the same SQLite file, and confirm the
// workspace, session, and message history are all restored from the durable event log.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 800; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-G-persistence", () => {
  test("session + messages survive a runtime restart against the same store", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      try {
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-persist-"));
        const sessionId = randomUUID();
        let workspaceId!: string;

        {
          const { app, client } = await bootApp(home);
          try {
            await client.invoke("model.configure", {
              providerId: "mock",
              baseURL: `http://127.0.0.1:${aimock.port}/v1`,
              protocol: "openai-compatible",
              model: "mock-model-1",
              apiKey: "",
            });
            const selectResult = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
            workspaceId = selectResult.workspaceId;
            const view = await client.startRun(
              "agent.coding",
              { sessionId, workspaceId, message: "[[scenario:plain]] remember this" } as never,
              { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
            );
            await waitForCompletion(app, view.runId);
          } finally {
            await app.stop();
          }
        }

        // Reopen the same SQLite file in a fresh process-equivalent server instance.
        const reopened = await startServer({ port: 0, home });
        try {
          const rows = (await reopened.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
          const sessionRow = rows.find((r) => r.key === sessionId)?.value as { readonly title?: string; readonly lastStatus?: string } | undefined;
          expect(sessionRow?.lastStatus).toBe("completed");
          // Title is derived from the literal first human message text, verbatim — matches the
          // reference (reference-behavior-matrix.md §4).
          expect(sessionRow?.title).toContain("remember this");

          const workspaceRows = (await reopened.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
          const record = workspaceRows.find((r) => r.key === `record/${workspaceId}`);
          expect(record).toBeDefined();

          const history = (await reopened.runtime.service.invoke(LOCAL_OPERATOR, { capability: "session.history", input: { sessionId } })) as {
            readonly role: string;
            readonly content: string;
          }[];
          expect(history.length).toBe(2);
          expect(history[0]?.content).toContain("remember this");
        } finally {
          await reopened.stop();
        }
      } finally {
        await aimock.stop();
      }
    });
  });
});
