// Journey J-H-provider-error: aimock's `error` fixture always fails (HTTP 500) — `agent.coding`
// retries `model.generate` up to 5 times, emitting `model.request.retried` before each retry, then
// `turn.failed` and ends the run `failed`. The `retry` scenario fails once, then succeeds (two
// `sequenceIndex` fixture variants over the same match key; the per-test llmock process starts the
// counter at zero, replacing the old mock's `POST /__reset` dance). A restart mid-retry (SQLite
// persistence) must not duplicate the recorded retry events.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

async function waitForCompletion(app: AppServer, runId: string, maxIterations = 400) {
  for (let i = 0; i < maxIterations; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

async function eventsFor(app: AppServer, runId: string): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId })) events.push(e);
  return events;
}

async function retriedCountAtLeast(app: AppServer, runId: string, n: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const events = await eventsFor(app, runId);
    if (events.filter((e) => e.eventType === "model.request.retried").length >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`run ${runId} never reached ${n} model.request.retried events`);
}

describe("J-H-provider-error", () => {
  test("error scenario: exactly 5 retries then turn.failed, run ends failed", async () => {
    process.env.MODEL_RETRY_BACKOFF_MS = "10";
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-error-"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
        const sessionId = randomUUID();

        const view = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:error]] do the thing" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, view.runId);
        expect(finalRun.status).toBe("failed");

        const events = await eventsFor(app, view.runId);
        const retried = events.filter((e) => e.eventType === "model.request.retried");
        expect(retried.length).toBe(5);
        expect(retried.map((e) => (e.payload as { readonly attempt?: number }).attempt)).toEqual([1, 2, 3, 4, 5]);
        for (const e of retried) {
          expect((e.payload as { readonly maxRetries?: number }).maxRetries).toBe(5);
        }

        const failed = events.filter((e) => e.eventType === "turn.failed");
        expect(failed.length).toBe(1);
        const failurePayload = failed[0]!.payload as { readonly code?: string; readonly message?: string };
        // The mock's `error` scenario is an honest HTTP 500, not a timeout — see DEVIATIONS.md
        // ("provider-error code mapping").
        expect(failurePayload.code).toBe("HTTP_500");
        expect(failurePayload.message).toBe("Internal server error");

        await app.runtime.idle();
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const sessionRow = sessionRows.find((r) => r.key === sessionId)?.value as { readonly lastStatus?: string } | undefined;
        expect(sessionRow?.lastStatus).toBe("failed");
      } finally {
        await app.stop();
        await aimock.stop();
        delete process.env.MODEL_RETRY_BACKOFF_MS;
      }
    });
  });

  test("retry scenario: fails once, recovers on the 1st retry", async () => {
    process.env.MODEL_RETRY_BACKOFF_MS = "10";
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-retry-"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
        const sessionId = randomUUID();

        const view = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:retry]] do the thing" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, view.runId);
        expect(finalRun.status).toBe("completed");
        expect((finalRun.output as { readonly text?: string }).text).toContain("Summary");

        const events = await eventsFor(app, view.runId);
        const retried = events.filter((e) => e.eventType === "model.request.retried");
        expect(retried.length).toBe(1);
        expect((retried[0]!.payload as { readonly attempt?: number }).attempt).toBe(1);
        expect(events.some((e) => e.eventType === "turn.failed")).toBe(false);
      } finally {
        await app.stop();
        await aimock.stop();
        delete process.env.MODEL_RETRY_BACKOFF_MS;
      }
    });
  });

  test("replay: restarting the runtime mid-retry does not duplicate retry events", async () => {
    process.env.MODEL_RETRY_BACKOFF_MS = "150";
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-error-replay-"));
      const sessionId = randomUUID();
      let workspaceId!: string;
      let runId!: string;

      try {
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
              { sessionId, workspaceId, message: "[[scenario:error]] do the thing" } as never,
              { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
            );
            runId = view.runId;
            // Let 2 of the 5 retries land, then stop the runtime mid-flight (the run is still
            // "running" in the durable store — not cancelled).
            await retriedCountAtLeast(app, runId, 2);
          } finally {
            await app.stop();
          }
        }

        // Reopen the same SQLite file; the runtime resumes non-terminal runs on boot.
        const reopened = await startServer({ executionPosture: "uncontained-local", port: 0, home });
        try {
          const finalRun = await waitForCompletion(reopened, runId);
          expect(finalRun.status).toBe("failed");

          const events = await eventsFor(reopened, runId);
          const retried = events.filter((e) => e.eventType === "model.request.retried");
          expect(retried.length).toBe(5);
          expect(retried.map((e) => (e.payload as { readonly attempt?: number }).attempt)).toEqual([1, 2, 3, 4, 5]);
          expect(events.filter((e) => e.eventType === "turn.failed").length).toBe(1);
        } finally {
          await reopened.stop();
        }
      } finally {
        await aimock.stop();
        delete process.env.MODEL_RETRY_BACKOFF_MS;
      }
    });
  });
});
