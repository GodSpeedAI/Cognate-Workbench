// Journey J-C-tool-execution: `[[scenario:multi]]` against the real mock server drives
// read -> bash -> edit -> final answer. Asserts the tool-call event sequence, the final answer, and
// that the workspace file was actually mutated on disk exactly as the `edit` tool call specified.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";
import { makeWorkspace } from "../../fixtures/workspace/make-workspace.ts";

describe("J-C-tool-execution", () => {
  test("read -> bash -> edit -> final answer; the file is actually mutated", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const workspaceDir = join(home, "ws-cap-tools");
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        await makeWorkspace(workspaceDir);
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const sessionId = randomUUID();
        const toolEvents: { readonly tool: string; readonly type: string }[] = [];
        const unsubscribe = client.subscribe({}, (event: StoredEvent) => {
          if (event.eventType === "tool.call.started" || event.eventType === "tool.call.completed" || event.eventType === "tool.call.failed") {
            const payload = event.payload as { readonly tool?: string };
            if (payload.tool) toolEvents.push({ tool: payload.tool, type: event.eventType });
          }
        });

        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:multi]] do the multi-step task now" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const finalRun = await waitForCompletion(app, run.runId);

        expect(finalRun.status).toBe("completed");
        const output = finalRun.output as { readonly text?: string };
        expect(output.text).toContain("Read greet.ts");
        expect(output.text).toContain("Howdy");

        const startedOrder = toolEvents.filter((e) => e.type === "tool.call.started").map((e) => e.tool);
        expect(startedOrder).toEqual(["read", "bash", "edit"]);
        expect(toolEvents.some((e) => e.type === "tool.call.failed")).toBe(false);

        const greetContent = await readFile(join(workspaceDir, "src", "greet.ts"), "utf8");
        expect(greetContent).toContain("Howdy");
        expect(greetContent).not.toContain("Hello");

        unsubscribe();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("a path escape is rejected without touching the filesystem", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const workspaceDir = join(home, "ws-escape");
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        await makeWorkspace(workspaceDir);
        await client.invoke("workspace.select", { path: workspaceDir });

        let threw: unknown;
        try {
          await client.invoke("tool.read", { workspaceRoot: workspaceDir, file_path: "../../../etc/passwd" });
        } catch (error) {
          threw = error;
        }
        expect(threw).toBeDefined();
        expect(String((threw as Error)?.message ?? threw)).toMatch(/escapes the workspace root/);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });
});

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}
