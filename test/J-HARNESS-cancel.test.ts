// Journey J-HARNESS-cancel: Stop kills the CLI (and its child tree) and leaves no process behind;
// a CLI that ignores the protocol interrupt is escalated; a process waiting on a permission request
// of a cancelled run is reaped.
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROTOCOLS, alive, bootHarnessApp, makeFakeHost, newSession, openApproval, readPids, startTurn, waitFor, waitRun } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

describe("J-HARNESS-cancel", () => {
  for (const proto of PROTOCOLS) {
    for (const stubborn of [false, true]) {
      test(`${proto.text}: cancel mid-turn kills the process tree${stubborn ? " even when the CLI ignores the interrupt" : ""}`, async () => {
        const host = await makeFakeHost();
        await withTempHome(async (home) => {
          const { app, client } = await bootHarnessApp(home, host);
          try {
            const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
            await client.invoke("session.harness.bind", { sessionId, harnessId: proto.id, permissionMode: "ask" } as never);
            const runId = await startTurn(client, sessionId, workspaceId, stubborn ? "hang stubborn" : "hang");
            const pids = await readPids(host.workspace);
            expect(pids.every(alive)).toBe(true);
            // A second bind while the run is active is refused.
            await expect(client.invoke("session.harness.bind", { sessionId, harnessId: null } as never)).rejects.toThrow(/run is active/);
            await client.cancelRun(runId, "user-cancelled");
            const run = await waitRun(app, runId, ["cancelled", "failed", "completed"], 15000);
            expect(run.status).toBe("cancelled");
            await waitFor(() => (pids.every((p) => !alive(p)) ? true : undefined), 8000);
            expect(pids.some(alive)).toBe(false);
          } finally {
            await app.stop();
          }
        });
      }, 40000);
    }
  }

  test("a CLI waiting on a permission request is reaped when its run is cancelled", async () => {
    const host = await makeFakeHost();
    await withTempHome(async (home) => {
      const { app, client } = await bootHarnessApp(home, host);
      try {
        const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
        await client.invoke("session.harness.bind", { sessionId, harnessId: "claude", permissionMode: "ask" } as never);
        const runId = await startTurn(client, sessionId, workspaceId, "please ask then edit");
        await openApproval(app, runId);
        const pid = Number((await readFile(join(host.workspace, "fake.pid"), "utf8")).trim());
        expect(alive(pid)).toBe(true);
        await client.cancelRun(runId, "user-cancelled");
        await waitFor(() => (alive(pid) ? undefined : true), 15000);
        expect(alive(pid)).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 40000);
});
