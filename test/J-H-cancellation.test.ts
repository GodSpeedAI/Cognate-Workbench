// Journey J-H-cancellation: while a run is streaming (aimock's `interrupt` fixture — per-fixture
// latency/chunkSize make it a deliberately slow stream), the client cancels the run. The run ends
// `cancelled`, the partial streamed text is retained in the recorded `run.invocation.progress`
// events as a strict prefix of the fixture's full content (streaming demonstrably stopped
// mid-stream, not after completion), llmock's journal shows the request actually reached the
// out-of-process mock endpoint, and a follow-up turn in the same session still completes.
//
// T11 divergence (aimock migration): the old mock-model server exposed `GET /__abort-count` to
// prove the aborted HTTP connection was observed server-side; llmock journals a request entry
// before streaming begins and does not observe client disconnects of an already-served stream, so
// there is no server-side abort counter. The mid-stream cut is proven app-side instead: status
// `cancelled` (a post-completion cancel would have ended `completed`) plus the retained partial
// text being strictly shorter than the fixture's scripted content.
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { aimockChatRequests, bootApp, bootAimock, withTempHome } from "./helpers.ts";

/** The `interrupt` fixture's full scripted content, read from the fixtures file (single source of
 *  truth) so the strict-prefix assertion below tracks the fixture, not a copy. */
const INTERRUPT_CONTENT = (() => {
  const parsed = JSON.parse(
    readFileSync(new URL("../fixtures/aimock/fixtures.json", import.meta.url), "utf8"),
  ) as { readonly fixtures: readonly { readonly match?: { readonly userMessage?: string }; readonly response?: { readonly content?: string } }[] };
  const content = parsed.fixtures.find((f) => f.match?.userMessage === "[[scenario:interrupt]]")?.response?.content;
  if (typeof content !== "string" || content.length === 0) throw new Error("interrupt fixture not found in fixtures/aimock/fixtures.json");
  return content;
})();

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

async function waitForFirstTextDelta(app: AppServer, runId: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const events: StoredEvent[] = [];
    for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId })) events.push(e);
    const hasText = events.some(
      (e) => e.eventType === "run.invocation.progress" && (e.payload as { readonly kind?: string }).kind === "text",
    );
    if (hasText) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} never streamed a text delta`);
}

describe("J-H-cancellation", () => {
  test("Stop mid-stream cancels the run, partial text is retained as a strict prefix, and a follow-up turn completes", async () => {
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-cancel-"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const view = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:interrupt]] please work on this" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );

        // Let a few words stream in before cancelling, matching the reference's "cancellation
        // happened right after the first chunk" (reference-behavior-matrix.md §7).
        await waitForFirstTextDelta(app, view.runId);
        await client.cancelRun(view.runId, "user-cancelled");

        const finalRun = await waitForCompletion(app, view.runId);
        expect(finalRun.status).toBe("cancelled");

        // The interrupted request really went over HTTP to the out-of-process mock endpoint
        // (llmock's journal): it was received, matched the `interrupt` fixture, and was served —
        // not an in-process stub answering the provider.
        const journal = await aimockChatRequests(aimock.port);
        const interruptEntries = journal.filter((e) =>
          (e.body.messages ?? []).some((m) => typeof m.content === "string" && m.content.includes("[[scenario:interrupt]]")),
        );
        expect(interruptEntries.length).toBeGreaterThanOrEqual(1);
        expect(interruptEntries.every((e) => e.response.status === 200)).toBe(true);

        // Partial streamed text was durably recorded (what the UI's `useStreamingTurn` renders as
        // the kept partial reply) — not discarded because the run failed to finish. It is a strict
        // prefix of the fixture's scripted content and strictly shorter than it: the cancel cut
        // the stream mid-flight (a cancel landing after the last chunk would have let the run
        // complete instead — see the header's divergence note).
        const events: StoredEvent[] = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: view.runId })) events.push(e);
        const textDeltas = events
          .filter((e) => e.eventType === "run.invocation.progress" && (e.payload as { readonly kind?: string }).kind === "text")
          .map((e) => String((e.payload as { readonly text?: string }).text ?? ""));
        const partial = textDeltas.join("");
        expect(partial.length).toBeGreaterThan(0);
        expect(INTERRUPT_CONTENT.startsWith(partial)).toBe(true);
        expect(partial.length).toBeLessThan(INTERRUPT_CONTENT.length);
        // No `message.completed`/`turn.failed` for a cancelled run.
        expect(events.some((e) => e.eventType === "message.completed")).toBe(false);

        await app.runtime.idle();
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const sessionRow = sessionRows.find((r) => r.key === sessionId)?.value as { readonly lastStatus?: string } | undefined;
        expect(sessionRow?.lastStatus).toBe("cancelled");

        // A follow-up message in the same session starts a new run and completes normally.
        const view2 = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:plain]] try again" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun2 = await waitForCompletion(app, view2.runId);
        expect(finalRun2.status).toBe("completed");

        const history = (await client.invoke("session.history", { sessionId })) as { readonly role: string; readonly content: string }[];
        // The cancelled turn's user message is still part of history; its (never-completed) assistant
        // reply is not synthesized into it (see DEVIATIONS.md — "cancelled-turn history").
        expect(history.some((m) => m.role === "user" && m.content.includes("please work on this"))).toBe(true);
        expect(history.some((m) => m.role === "user" && m.content.includes("try again"))).toBe(true);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });
});
