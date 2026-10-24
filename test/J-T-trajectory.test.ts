// Journey J-T-trajectory (usage pass U5, reference-behavior-matrix.md §13): the session-trace
// projection folds a tool session's durable events into the developer-tools execution trace —
// USER row from the turn's message, one ASSISTANT "Request #N" per recorded `model.generate`
// invocation (with the preset-scoped tool catalog in its options), TOOL rows with args/results and
// event-derived durations — and it is durable: re-folding from the same SQLite store after a full
// runtime restart reproduces the identical trace (the trace is Cognate's event log, not a second
// recording path).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

async function waitForCompletion(app: Awaited<ReturnType<typeof bootApp>>["app"], runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

async function readTrace(app: Awaited<ReturnType<typeof bootApp>>["app"], sessionId: string) {
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-trace" })).rows;
  const row = rows.find((r) => r.key === `trace/${sessionId}`)?.value as
    | { readonly sessionId: string; readonly turns: readonly { readonly index: number; readonly userText: string; readonly requests: readonly { readonly requestNumber: number; readonly status: string; readonly toolNames: readonly string[]; readonly responseText?: string; readonly responseToolCalls?: readonly { readonly name: string }[]; readonly startedAt: string }[]; readonly tools: readonly { readonly toolCallId: string; readonly tool: string; readonly args: string; readonly status: string; readonly result?: string; readonly startedAt: string; readonly completedAt?: string }[] }[] }
    | undefined;
  return row;
}

describe("J-T-trajectory", () => {
  test("a tool session folds into a trace: user row, per-invocation requests, tool rows with durations", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        const ws = join(home, "ws");
        await mkdir(ws, { recursive: true });
        await writeFile(join(ws, "README.md"), "# Fixture project\n\nA tiny fixture workspace with a greet() helper in src/greet.ts.\n");
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-tool]] read the readme please" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const final = await waitForCompletion(app, run.runId);
        expect(final.status).toBe("completed");
        await app.runtime.idle();

        const trace = await readTrace(app, sessionId);
        expect(trace).toBeDefined();
        expect(trace!.turns).toHaveLength(1);
        const turn = trace!.turns[0]!;
        expect(turn.userText).toContain("[[scenario:aim-tool]]");

        // Two ASSISTANT request rows: the leg-1 tool-call round and the leg-2 final-answer round.
        expect(turn.requests).toHaveLength(2);
        expect(turn.requests[0]!.requestNumber).toBe(1);
        expect(turn.requests[0]!.responseToolCalls?.[0]?.name).toBe("read");
        expect(turn.requests[0]!.toolNames.length).toBeGreaterThan(0);
        expect(turn.requests[1]!.responseText).toContain("read README.md");

        // The TOOL row: the read executed, has args + a result + event-derived timestamps.
        expect(turn.tools).toHaveLength(1);
        const tool = turn.tools[0]!;
        expect(tool.tool).toBe("read");
        expect(tool.status).toBe("success");
        expect(JSON.parse(tool.args)).toMatchObject({ file_path: "README.md" });
        expect(tool.result).toContain("greet");
        expect(tool.startedAt).toBeTruthy();
        expect(tool.completedAt).toBeTruthy();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 30_000);

  test("the trace survives a full runtime restart against the same store (event-sourced, not a UI artifact)", async () => {
    await withTempHome(async (home) => {
      const sessionId = randomUUID();
      const aimock = await bootAimock();
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
          const ws = join(home, "ws");
          await mkdir(ws, { recursive: true });
          await writeFile(join(ws, "README.md"), "# Fixture project\n\nA tiny fixture workspace with a greet() helper in src/greet.ts.\n");
          const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };
          const run = await client.startRun(
            "agent.coding",
            { sessionId, workspaceId, message: "[[scenario:aim-tool]] trace persistence probe" } as never,
            { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
          );
          await waitForCompletion(app, run.runId);
          await app.runtime.idle();
        } finally {
          await app.stop();
          await aimock.stop();
        }
      }
      const reopened = await startServer({ executionPosture: "uncontained-local", port: 0, home });
      try {
        const trace = await readTrace(reopened, sessionId);
        expect(trace).toBeDefined();
        expect(trace!.turns).toHaveLength(1);
        expect(trace!.turns[0]!.requests).toHaveLength(2);
        expect(trace!.turns[0]!.tools).toHaveLength(1);
        expect(trace!.turns[0]!.tools[0]!.result).toContain("greet");
      } finally {
        await reopened.stop();
      }
    });
  }, 30_000);
});
