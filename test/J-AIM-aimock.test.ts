// Journey J-AIM (U1, deepseek-harness-usage-features.md): proves the app's model-provider stack
// runs against the real `@copilotkit/aimock` (`llmock`) OpenAI-shaped endpoint — the same server
// `bootAimock()` (test/helpers.ts) spawns for every other journey, screenshot captures, and
// `just harness-up`. Covers: (a) a fixture-matched plain completion streams through the provider
// stack (chunked SSE -> `run.invocation.progress` text deltas), (b) a tool-call fixture
// round-trips (tool executes, its result is fed back as a `role:"tool"` message and the follow-up
// fixture answers), and (c) an UNMATCHED message surfaces as a visible failure (llmock's honest
// HTTP 404 "No fixture matched" -> 5 retries -> `turn.failed` HTTP_404, run `failed`) — never a
// silent success.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { aimockChatRequests, bootApp, bootAimock, withTempHome } from "./helpers.ts";
import { makeWorkspace } from "../fixtures/workspace/make-workspace.ts";

const AIM_PLAIN_TEXT = "Hello from aimock. This completion was served by a fixture match.";
const AIM_TOOL_FINAL_TEXT = "I read README.md and saw the fixture project's greeting.";

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-AIM-aimock", () => {
  test("a fixture-matched plain completion streams through the real provider stack", async () => {
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-aim-"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-plain]] say the fixture thing" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("completed");
        expect((finalRun.output as { readonly text?: string }).text).toBe(AIM_PLAIN_TEXT);

        // Streaming really happened through `provider.stream` (SSE chunks are forwarded one
        // `run.invocation.progress` text delta each; llmock's default 20-char chunking splits this
        // content into several chunks, so >= 2 deltas proves the chunked path, not one blob).
        const events = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: run.runId })) events.push(e);
        const textDeltas = events.filter(
          (e) => e.eventType === "run.invocation.progress" && (e.payload as { readonly kind?: string }).kind === "text",
        );
        expect(textDeltas.length).toBeGreaterThanOrEqual(2);
        expect(textDeltas.map((e) => String((e.payload as { readonly text?: string }).text ?? "")).join("")).toBe(AIM_PLAIN_TEXT);

        // Out-of-process evidence: llmock's journal shows the request arrived over HTTP and was
        // served by the fixture (status 200), not answered by an in-process stub.
        const journal = await aimockChatRequests(aimock.port);
        const mine = journal.filter((e) =>
          (e.body.messages ?? []).some((m) => typeof m.content === "string" && m.content.includes("[[scenario:aim-plain]]")),
        );
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine.every((e) => e.response.status === 200)).toBe(true);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("a tool-call fixture round-trips: tool executes, result is fed back, follow-up fixture answers", async () => {
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
        const workspaceDir = join(home, "ws-aim-tool");
        await makeWorkspace(workspaceDir);
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const toolEvents: { readonly toolCallId: string; readonly tool: string; readonly type: string }[] = [];
        const unsubscribe = client.subscribe({}, (event) => {
          if (event.eventType === "tool.call.started" || event.eventType === "tool.call.completed" || event.eventType === "tool.call.failed") {
            const payload = event.payload as { readonly toolCallId?: string; readonly tool?: string };
            if (payload.toolCallId) toolEvents.push({ toolCallId: payload.toolCallId, tool: String(payload.tool), type: event.eventType });
          }
        });

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-tool]] read the readme please" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, run.runId);
        unsubscribe();

        // The fixture's tool call (stable authored id) executed against the real workspace.
        expect(finalRun.status).toBe("completed");
        expect((finalRun.output as { readonly text?: string }).text).toBe(AIM_TOOL_FINAL_TEXT);
        const started = toolEvents.filter((e) => e.type === "tool.call.started");
        expect(started).toHaveLength(1);
        expect(started[0]!.tool).toBe("read");
        expect(started[0]!.toolCallId).toBe("call_aim_read_1");
        expect(toolEvents.some((e) => e.type === "tool.call.failed")).toBe(false);

        // Protocol-level round trip: llmock's journal shows the SECOND request of the loop carried
        // the tool result back as its trailing `role:"tool"` message (anchored by tool_call_id),
        // and the follow-up fixture answered it.
        const journal = await aimockChatRequests(aimock.port);
        const mine = journal.filter((e) =>
          (e.body.messages ?? []).some((m) => typeof m.content === "string" && m.content.includes("[[scenario:aim-tool]]")),
        );
        expect(mine.length).toBe(2);
        const followUp = mine[1]!.body.messages ?? [];
        const last = followUp[followUp.length - 1];
        expect(last?.role).toBe("tool");
        expect((last as { readonly tool_call_id?: string }).tool_call_id).toBe("call_aim_read_1");
        expect(String((last as { readonly content?: unknown }).content)).toContain("fixture-workspace");
        expect(mine[1]!.response.status).toBe(200);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("an unmatched message surfaces as a failed run (llmock 404), never a silent success", async () => {
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
        const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-aim-no"));
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-nomatch]] nothing matches this message" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, run.runId);
        expect(finalRun.status).toBe("failed");

        // The failure is visible in the durable event log: the app's full retry budget, then a
        // terminal turn.failed carrying llmock's honest 404 classification.
        const events = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: run.runId })) events.push(e);
        const retried = events.filter((e) => e.eventType === "model.request.retried");
        expect(retried.length).toBe(5);
        const failed = events.filter((e) => e.eventType === "turn.failed");
        expect(failed).toHaveLength(1);
        const failurePayload = failed[0]!.payload as { readonly code?: string; readonly message?: string };
        expect(failurePayload.code).toBe("HTTP_404");
        expect(failurePayload.message).toBe("Request failed (HTTP 404).");
        expect(events.some((e) => e.eventType === "message.completed")).toBe(false);

        await app.runtime.idle();
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const sessionRow = sessionRows.find((r) => r.key === sessionId)?.value as { readonly lastStatus?: string } | undefined;
        expect(sessionRow?.lastStatus).toBe("failed");

        // Out-of-process evidence: every attempt reached llmock and was answered with its
        // no-match 404 (not a network error, not a fabricated answer).
        const journal = await aimockChatRequests(aimock.port);
        const mine = journal.filter((e) =>
          (e.body.messages ?? []).some((m) => typeof m.content === "string" && m.content.includes("[[scenario:aim-nomatch]]")),
        );
        expect(mine.length).toBe(6);
        expect(mine.every((e) => e.response.status === 404)).toBe(true);
      } finally {
        await app.stop();
        await aimock.stop();
        delete process.env.MODEL_RETRY_BACKOFF_MS;
      }
    });
  });
});
