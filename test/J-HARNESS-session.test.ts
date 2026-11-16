// Journey J-HARNESS-session: bind a Session to an external harness CLI and run turns through it.
// Fake CLIs speak each protocol (Claude stream-json, Codex app-server, ACP); the real app boots and
// the assertions read the recorded domain events, the public projection and the CLI's own argv log.
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { PROTOCOLS, bootHarnessApp, makeFakeHost, newSession, runEvents, startTurn, waitRun } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

describe("J-HARNESS-session", () => {
  for (const proto of PROTOCOLS) {
    test(`${proto.text}: bind, run a turn, events fold into the transcript, a second turn resumes the CLI session`, async () => {
      const host = await makeFakeHost();
      process.env.OPENAI_API_KEY = "sk-workbench-secret-must-not-leak";
      await withTempHome(async (home) => {
        const { app, client } = await bootHarnessApp(home, host);
        try {
          const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
          const bound = (await client.invoke("session.harness.bind", { sessionId, harnessId: proto.id, permissionMode: "ask", model: "fake-model-1" } as never)) as { posture: string; harnessId: string };
          expect(bound.harnessId).toBe(proto.id);
          expect(bound.posture).toBe("harness-bridged-approvals");
          await app.runtime.idle();
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-harness-bindings" })).rows;
          expect(rows.find((r) => r.key === sessionId)?.value).toMatchObject({ harnessId: proto.id, permissionMode: "ask", model: "fake-model-1" });

          const runId = await startTurn(client, sessionId, workspaceId, "please edit hello.txt");
          const run = await waitRun(app, runId);
          expect(run.status).toBe("completed");
          const events = await runEvents(app, runId);
          const types = events.map((e) => e.eventType);
          const turn = events.find((e) => e.eventType === "session.turn.started")!.payload as { harness: { id: string; posture: string } };
          expect(turn.harness).toMatchObject({ id: proto.id, posture: "harness-bridged-approvals" });
          // live text rides the same progress channel the native agent uses
          const streamed = events.filter((e) => e.eventType === "run.invocation.progress").map((e) => (e.payload as { text?: string }).text ?? "").join("");
          expect(streamed).toContain("Looking at it.");
          const started = events.find((e) => e.eventType === "tool.call.started")!.payload as { tool: string; args: { file_path?: string } };
          expect(started.tool).toBe("edit");
          expect(started.args.file_path).toBe("hello.txt");
          const done = events.find((e) => e.eventType === "tool.call.completed")!.payload as { tool: string; result: { diffLines: string[]; additions: number } };
          expect(done.tool).toBe("edit");
          expect(done.result.diffLines.some((l) => l.startsWith("-") && l.includes("hello"))).toBe(true);
          expect(done.result.diffLines.some((l) => l.startsWith("+") && l.includes("world"))).toBe(true);
          expect(types.indexOf("tool.call.started")).toBeLessThan(types.indexOf("tool.call.completed"));
          const message = events.find((e) => e.eventType === "message.completed")!.payload as { text: string };
          expect(message.text).toContain("Looking at it.");
          expect(message.text).toContain("Done.");
          expect(types).toContain("harness.session.recorded");
          if (proto.id !== "opencode") expect(types).toContain("workbench.usage.recorded");

          // CLI process: allowlisted env (no Workbench provider key), cwd = workspace, argv per protocol.
          const log = (await readFile(host.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; cwd: string; env: string[] });
          const first = log[0]!;
          expect(first.cwd).toEndWith("/ws");
          expect(first.env).toContain("PATH");
          expect(first.env).not.toContain("OPENAI_API_KEY");
          if (proto.id === "claude") {
            expect(first.argv).toContain("--permission-prompt-tool");
            expect(first.argv).toContain("--model");
          }
          if (proto.id === "codex") expect(first.argv).toEqual(["app-server"]);
          if (proto.id === "opencode") expect(first.argv).toEqual(["acp"]);

          // Resume: the second turn reuses the CLI's own session id.
          await app.runtime.idle();
          const row = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-harness-bindings" })).rows.find((r) => r.key === sessionId)!.value as { resumeId?: string };
          expect(row.resumeId).toBeString();
          const run2 = await waitRun(app, await startTurn(client, sessionId, workspaceId, "continue"));
          expect(run2.status).toBe("completed");
          if (proto.id === "claude") {
            const second = (await readFile(host.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { argv: string[] })[1]!;
            expect(second.argv).toContain(`--resume=${row.resumeId}`);
          }

          // Back to native is an explicit, durable choice.
          await client.invoke("session.harness.bind", { sessionId, harnessId: null } as never);
          await app.runtime.idle();
          const after = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-harness-bindings" })).rows.find((r) => r.key === sessionId)!.value as { harnessId: string | null };
          expect(after.harnessId).toBeNull();
        } finally {
          delete process.env.OPENAI_API_KEY;
          await app.stop();
        }
      });
    }, 40000);
  }
});
