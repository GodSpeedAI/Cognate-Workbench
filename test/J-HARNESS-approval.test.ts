// Journey J-HARNESS-approval: a CLI's own permission request becomes a Workbench approval; approve
// and deny both resume the CLI. Per protocol (Claude can_use_tool, Codex requestApproval, ACP
// request_permission).
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { PROTOCOLS, bootHarnessApp, makeFakeHost, newSession, openApproval, runEvents, startTurn, waitRun } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

describe("J-HARNESS-approval", () => {
  for (const proto of PROTOCOLS) {
    for (const approved of [true, false]) {
      test(`${proto.text}: ${approved ? "approve" : "deny"} resumes the CLI`, async () => {
        const host = await makeFakeHost();
        await withTempHome(async (home) => {
          const { app, client } = await bootHarnessApp(home, host);
          try {
            const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
            await client.invoke("session.harness.bind", { sessionId, harnessId: proto.id, permissionMode: "ask" } as never);
            const runId = await startTurn(client, sessionId, workspaceId, "please ask then edit hello.txt");
            const approval = await openApproval(app, runId);
            expect((approval.payload as { permission: string; tool: string }).permission).toBe("workspace-write");
            expect((approval.payload as { tool: string }).tool).toBe("edit");
            // The run is waiting, the CLI still alive.
            await waitRun(app, runId, ["waiting"]);
            await app.runtime.service.resolveContinuation(LOCAL_OPERATOR, { continuationId: approval.id, action: "resume", input: { approved }, idempotencyKey: randomUUID() });
            const run = await waitRun(app, runId);
            expect(run.status).toBe("completed");
            const events = await runEvents(app, runId);
            const requested = events.find((e) => e.eventType === "tool.approval.requested")!.payload as { toolCallId: string; permission: string };
            const decided = events.find((e) => e.eventType === "tool.approval.decided")!.payload as { toolCallId: string; approved: boolean };
            expect(decided.toolCallId).toBe(requested.toolCallId);
            expect(decided.approved).toBe(approved);
            const types = events.map((e) => e.eventType);
            if (approved) {
              expect(types).toContain("tool.call.completed");
              expect(types).not.toContain("tool.call.failed");
              expect((events.find((e) => e.eventType === "message.completed")!.payload as { text: string }).text).toContain("Done.");
            } else {
              expect(types).toContain("tool.call.failed");
              expect(types).not.toContain("tool.call.completed");
              expect((events.find((e) => e.eventType === "message.completed")!.payload as { text: string }).text).toContain("not editing");
            }
          } finally {
            await app.stop();
          }
        });
      }, 40000);
    }
  }
});
