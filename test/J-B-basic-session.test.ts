// Journey J-B-basic-session: two turns in one session, against the deterministic mock model server
// (`[[scenario:plain]]`). Asserts >=2 run.invocation.progress events, the run completes, the
// message text is right, the sessions projection lists it, and history includes turn 1 for turn 2.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

describe("J-B-basic-session", () => {
  test("one turn streams, completes, and appears in the sessions projection", async () => {
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-session-"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const progressEvents: StoredEvent[] = [];
        const seenTypes: string[] = [];
        const unsubscribe = client.subscribe({}, (event) => {
          seenTypes.push(event.eventType);
          if (event.eventType === "run.invocation.progress") progressEvents.push(event);
        });

        const view1 = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:plain]] please summarize" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        // Wait for the run to complete (poll getRun through the service used by the client's transport).
        const finalRun = await waitForCompletion(app, view1.runId);
        expect(finalRun.status).toBe("completed");
        expect((finalRun.output as { readonly text?: string }).text).toContain("Summary");
        expect(progressEvents.length).toBeGreaterThanOrEqual(2);

        await app.runtime.idle();
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const sessionRow = sessionRows.find((r) => r.key === sessionId)?.value as { readonly title?: string; readonly lastStatus?: string } | undefined;
        expect(sessionRow?.lastStatus).toBe("completed");
        // Title is derived from the literal first human message text, verbatim, not the assistant's
        // answer — matches the reference (reference-behavior-matrix.md §4;
        // reference/observations/aria/06-user-message.desktop.txt shows this title already in-flight).
        expect(sessionRow?.title).toContain("please summarize");

        // Second turn: history must include the first turn.
        const view2 = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:plain]] one more time" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        await waitForCompletion(app, view2.runId);

        const history = (await client.invoke("session.history", { sessionId })) as { readonly role: string; readonly content: string }[];
        expect(history.length).toBe(4);
        expect(history[0]?.role).toBe("user");
        expect(history[0]?.content).toContain("please summarize");
        expect(history[1]?.role).toBe("assistant");
        expect(history[2]?.content).toContain("one more time");

        unsubscribe();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });
});

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 800; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}
