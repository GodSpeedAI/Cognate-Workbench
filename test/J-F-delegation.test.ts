// Journey J-F-delegation: `[[scenario:delegate]]` calls the `subagent` tool
// (`{description: "Summarize project status", prompt: "... [[scenario:child]]"}`). Fire-and-forget
// delegation (reference-behavior-matrix.md §6.4): `agent.coding` starts a durable child
// `agent.coding` run via this app's own `subagent.start` capability
// (`src/capabilities/subagentStart.ts`), correlated `subagent:<parentRunId>:<toolCallId>`, and
// returns immediately with the reflection text (`Tool result: started subagent ...`) — it does not
// wait on the child. Covers: the child run is actually created and completes independently (visible
// via the `subagents` projection), the parent completes right away with that text,
// the child does NOT show up in the `sessions` projection (top-level session list), the completed
// child's result appears in the parent session's *next* turn history (`session.history`), and a
// restart mid-delegation resumes the child without spawning a duplicate.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

async function configureAndSelect(client: Awaited<ReturnType<typeof bootApp>>["client"], mockPort: number, workspaceDir: string) {
  await client.invoke("model.configure", {
    providerId: "mock",
    baseURL: `http://127.0.0.1:${mockPort}/v1`,
    protocol: "openai-compatible",
    model: "mock-model-1",
    apiKey: "",
  });
  await mkdir(workspaceDir, { recursive: true });
  return (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition not met in time");
}

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

interface SubagentRow {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly title: string;
  readonly status: string;
  readonly output?: string;
}

async function subagentRowsFor(app: AppServer, sessionId: string): Promise<{ readonly key: string; readonly value: SubagentRow }[]> {
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "subagents" })).rows;
  return rows
    .map((r) => ({ key: r.key, value: r.value as unknown as SubagentRow }))
    .filter((r) => r.value.sessionId === sessionId);
}

const CHILD_TEXT = "The fixture workspace is a tiny, clean project with a README, a greet() helper, and no pending changes.";

describe("J-F-delegation", () => {
  test("child is started, parent completes with the reflection text, child completes, result lands in the parent's next turn", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-delegate");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:delegate]] delegate this now" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        // Fire-and-forget: the parent completes right away with the exact "started subagent <uuid>"
        // reflection text, not the child's answer.
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        // aimock divergence: the old mock reflected the tool result verbatim (`Tool result: started
        // subagent <runtime-minted uuid>`); aimock fixtures are static, so the parent's final text
        // carries a stable placeholder instead of the real id. Assert the stable prefix here and
        // derive the child run id from the durable correlation below.
        expect(output.text?.startsWith("Tool result: started subagent ")).toBe(true);

        // The `subagents` projection has one row for this session, initially not yet completed
        // (the child's own model call hasn't finished by the time the parent already has).
        let mine = await subagentRowsFor(app, sessionId);
        expect(mine).toHaveLength(1);
        expect(mine[0]!.value.title).toBe("Summarize project status");

        // The child is a real, separate run, correlated as this app's design requires.
        const toolCallId = mine[0]!.key.split("/").pop()!;
        const childRuns = await app.runtime.service.listRuns(LOCAL_OPERATOR, { correlationId: `subagent:${run.runId}:${toolCallId}` });
        expect(childRuns).toHaveLength(1);
        const childRunId = childRuns[0]!.runId;

        // The child completes independently; the `subagents` projection reflects it directly from
        // the child's own events (no parent-side wait or emission).
        await waitForCondition(async () => {
          const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: childRunId });
          return r.status === "completed";
        });
        await waitForCondition(async () => {
          mine = await subagentRowsFor(app, sessionId);
          return mine[0]?.value.status === "completed";
        });
        expect(mine[0]!.value.output).toBe(CHILD_TEXT);

        // The child must NOT appear in the top-level `sessions` projection.
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        expect(sessionRows.some((r) => r.key === childRunId)).toBe(false);
        expect(sessionRows.map((r) => r.key)).toContain(sessionId);

        // The parent session's NEXT turn history durably includes the completed child's result.
        const history = (await client.invoke("session.history", { sessionId })) as { readonly role: string; readonly content: string }[];
        expect(history.some((m) => m.content.includes(`Subagent "Summarize project status" completed: ${CHILD_TEXT}`))).toBe(true);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test(
    "restart mid-delegation resumes the child without spawning a duplicate run",
    async () => {
      await withTempHome(async (home) => {
        const aimock = await bootAimock();
        const { app, client } = await bootApp(home);
        try {
          const workspaceDir = join(home, "ws-delegate-restart");
          const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
          const sessionId = randomUUID();

          const run = await client.startRun(
            "agent.coding",
            { sessionId, workspaceId, message: "[[scenario:delegate]] delegate this now" } as never,
            { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
          );

          // Stop as soon as the child has been started (the parent itself completes essentially at
          // the same instant, fire-and-forget) — the child is very likely still mid-flight (its own
          // model call not yet finished), making this a genuine restart mid-delegation.
          await waitForCondition(async () => (await subagentRowsFor(app, sessionId)).length > 0);
          const mineBeforeRestart = await subagentRowsFor(app, sessionId);
          const toolCallId = mineBeforeRestart[0]!.key.split("/").pop()!;
          await app.stop();

          const restarted = await startServer({ executionPosture: "uncontained-local", port: 0, home });
          try {
            const childRuns = await restarted.runtime.service.listRuns(LOCAL_OPERATOR, { correlationId: `subagent:${run.runId}:${toolCallId}` });
            expect(childRuns).toHaveLength(1); // no duplicate child from a second `subagent.start`
            const childRunId = childRuns[0]!.runId;

            for (let i = 0; i < 400; i++) {
              const r = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: childRunId });
              if (r.status === "completed" || r.status === "failed") break;
              await new Promise((r2) => setTimeout(r2, 25));
            }
            const finishedChild = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: childRunId });
            expect(finishedChild.status).toBe("completed");

            const rows = await subagentRowsFor(restarted, sessionId);
            expect(rows).toHaveLength(1); // still exactly one row, not duplicated
            expect(rows[0]!.value.status).toBe("completed");
          } finally {
            await restarted.stop();
          }
        } finally {
          await aimock.stop();
        }
      });
    },
    15_000,
  );
});
