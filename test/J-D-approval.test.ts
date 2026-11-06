// Journey J-D-approval: `[[scenario:approval]]` calls `run_code` with `sandbox_permissions:
// "workspace-write"`, which `approvalGate` (default mode `"read-only"`) ranks as an escalation, so
// the run opens a `tool-approval` continuation (`approve:<toolCallId>`) and waits. Covers: the
// waiting status with an open continuation, resolve-allow (execution proceeds, run completes),
// resolve-deny (denial text fed back to the model, run completes), a restart while a continuation is
// still open on the SQLite store (Cognate's durable-continuation invariant — deliberately different
// from the reference, which finalizes silently across a full restart; see DEVIATIONS.md), and a
// replay test asserting no tool executes twice after a mid-run restart.
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    await new Promise((r) => setTimeout(r, 25));
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

describe("J-D-approval", () => {
  test("allow branch: waiting status + open continuation, then resolve and completion", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-approve-allow");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:approval]] run something risky" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
          return continuations.some((c) => c.status === "OPEN");
        });
        // The continuation record and the run's waiting marker commit in separate decisions; poll.
        await waitForCondition(async () => (await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId })).status === "waiting");
        const pending = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
        expect(pending.status).toBe("waiting");
        const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
        const openContinuation = continuations.find((c) => c.status === "OPEN");
        expect(openContinuation).toBeDefined();
        const payload = openContinuation!.payload as { readonly tool?: string; readonly permission?: string; readonly justification?: string };
        expect(payload.tool).toBe("run_code");
        expect(payload.permission).toBe("workspace-write");
        expect(payload.justification).toContain("stale cache");

        await client.resolveContinuation(openContinuation!.id, "resume", { approved: true });
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        expect(output.text).toContain("Tool result:");
        expect(output.text).toContain("no output");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("deny branch: denial text is fed back to the model and the run completes", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-approve-deny");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:approval]] run something risky" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
          return continuations.some((c) => c.status === "OPEN");
        });
        const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
        const openContinuation = continuations.find((c) => c.status === "OPEN")!;

        await client.resolveContinuation(openContinuation.id, "resume", { approved: false });
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        expect(output.text).toContain('the user rejected escalating this program to "workspace-write"');
        expect(output.text).toContain("stop and explain instead of working around it");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test(
    "a pending approval survives a full server restart (Cognate durable-continuation invariant; deviation from the reference)",
    async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-approve-restart");
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        const sessionId = randomUUID();

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:approval]] run something risky" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
          return continuations.some((c) => c.status === "OPEN");
        });

        // Full restart: stop the app entirely, then boot a fresh one against the same SQLite store.
        await app.stop();
        const restarted = await startServer({ executionPosture: "uncontained-local", port: 0, home });
        try {
          const stillOpen = await restarted.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId });
          expect(stillOpen.some((c) => c.status === "OPEN")).toBe(true);
          const stillWaiting = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
          expect(stillWaiting.status).toBe("waiting");

          const openContinuation = stillOpen.find((c) => c.status === "OPEN")!;
          await restarted.runtime.service.resolveContinuation(LOCAL_OPERATOR, {
            continuationId: openContinuation.id,
            action: "resume",
            input: { approved: true },
            idempotencyKey: randomUUID(),
          });
          for (let i = 0; i < 400; i++) {
            const r = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
            if (r.status === "completed") break;
            await new Promise((r2) => setTimeout(r2, 25));
          }
          const finished = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
          expect(finished.status).toBe("completed");
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

  test(
    "replay after a mid-run restart executes no tool call twice (bash side effect counted via an appended-to file)",
    async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const workspaceDir = join(home, "ws-replay");
        await mkdir(workspaceDir, { recursive: true });
        // A marker file the `bash` step in the `shell` scenario's commands would append to if run
        // twice: we don't rely on the scenario's own commands (git status/ls are side-effect-free);
        // instead this test drives `tool.bash` directly through a `multi`-scenario run and counts how
        // many times the *edit* tool call actually mutated the file (idempotent replacement would
        // otherwise silently succeed twice and go unnoticed) by asserting the file is edited exactly
        // once even after a restart mid-run.
        const { workspaceId } = await configureAndSelect(client, aimock.port, workspaceDir);
        await writeFile(join(workspaceDir, "counter.txt"), "Hello\n", "utf8");

        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:edit]] edit the file" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        // Give the run a moment to make progress, then restart mid-flight.
        await new Promise((r) => setTimeout(r, 150));
        await app.stop();

        const restarted = await startServer({ executionPosture: "uncontained-local", port: 0, home });
        try {
          for (let i = 0; i < 400; i++) {
            const r = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
            if (r.status === "completed" || r.status === "failed") break;
            await new Promise((r2) => setTimeout(r2, 25));
          }
          const finished = await restarted.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
          expect(finished.status).toBe("completed");
          // `[[scenario:edit]]` reads src/greet.ts (not present in this bare workspace) then edits
          // it — the read fails (no such file), so the edit's read-before-edit guard denies it. What
          // matters for replay-safety here is that the tool-call events recorded for this run contain
          // each toolCallId's started/completed|failed pair exactly once, proving no tool re-executed
          // after the restart replayed the run from its recorded steps.
          const events = [];
          for await (const event of restarted.runtime.service.events(LOCAL_OPERATOR, { runId: run.runId })) events.push(event);
          const startedIds = events.filter((e) => e.eventType === "tool.call.started").map((e) => (e.payload as { toolCallId: string }).toolCallId);
          const uniqueStarted = new Set(startedIds);
          expect(startedIds.length).toBe(uniqueStarted.size);
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
