// Journey J-HARNESS-unavailable: a missing, signed-out, limited or crashing CLI fails closed with a
// readable reason; non-local workspaces and SEA-Forge-style refusals say why; nothing falls back.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PROTOCOLS, bootHarnessApp, makeFakeHost, newSession, runEvents, startTurn, waitRun } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

describe("J-HARNESS-unavailable", () => {
  test("binding a CLI that is not installed is refused with its install hint; bad mode and bad model are refused", async () => {
    const host = await makeFakeHost();
    await withTempHome(async (home) => {
      const { app, client } = await bootHarnessApp(home, host);
      try {
        const { sessionId } = await newSession(app, client, host.workspace);
        await expect(client.invoke("session.harness.bind", { sessionId, harnessId: "kimi" } as never)).rejects.toThrow(/not installed.*(kimi|https)/is);
        await expect(client.invoke("session.harness.bind", { sessionId, harnessId: "nope" } as never)).rejects.toThrow(/unknown harness/);
        await expect(client.invoke("session.harness.bind", { sessionId, harnessId: "codex", permissionMode: "review" } as never)).rejects.toThrow(/permission mode/);
        await expect(client.invoke("session.harness.bind", { sessionId, harnessId: "claude", model: "--dangerously" } as never)).rejects.toThrow(/model must be/);
      } finally {
        await app.stop();
      }
    });
  });

  test("a workspace outside the local world is refused with the reason", async () => {
    const host = await makeFakeHost();
    await withTempHome(async (home) => {
      const { app, client } = await bootHarnessApp(home, host);
      try {
        const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
        // Re-home the workspace to a world that is not the local one (a remote/contained world would
        // be refused the same way: kind !== "local").
        await app.runtime.service.startRun({ actor: { id: "system", kind: "system" }, tenant: "local" }, {
          agent: "agent.config",
          input: { kind: "workspace.added", workspaceId, root: "/srv/remote", title: "remote", executionWorldId: "ssh-elsewhere" } as never,
          idempotencyKey: randomUUID(),
        });
        await app.runtime.idle();
        await expect(client.invoke("session.harness.bind", { sessionId, harnessId: "claude" } as never)).rejects.toThrow(/local world/);
      } finally {
        await app.stop();
      }
    });
  });

  for (const proto of PROTOCOLS) {
    test(`${proto.text}: not signed in fails the turn with the CLI's sign-in hint`, async () => {
      const host = await makeFakeHost();
      await withTempHome(async (home) => {
        const { app, client } = await bootHarnessApp(home, host);
        try {
          const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
          await client.invoke("session.harness.bind", { sessionId, harnessId: proto.id } as never);
          const runId = await startTurn(client, sessionId, workspaceId, "authfail please");
          expect((await waitRun(app, runId)).status).toBe("failed");
          const failed = (await runEvents(app, runId)).find((e) => e.eventType === "turn.failed")!.payload as { code: string; message: string };
          expect(failed.code).toBe("AUTH_REQUIRED");
          expect(failed.message).toMatch(/is not signed in/);
          expect(failed.message).toMatch(/login|\/login|auth/i);
        } finally {
          await app.stop();
        }
      });
    }, 30000);

    test(`${proto.text}: a crash ends the turn as failed with the exit code and stderr`, async () => {
      const host = await makeFakeHost();
      await withTempHome(async (home) => {
        const { app, client } = await bootHarnessApp(home, host);
        try {
          const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
          await client.invoke("session.harness.bind", { sessionId, harnessId: proto.id } as never);
          const runId = await startTurn(client, sessionId, workspaceId, "crash please");
          expect((await waitRun(app, runId)).status).toBe("failed");
          const failed = (await runEvents(app, runId)).find((e) => e.eventType === "turn.failed")!.payload as { code: string; message: string };
          expect(failed.code).toBe("FAILED");
          expect(failed.message).toContain("exited with code 3");
        } finally {
          await app.stop();
        }
      });
    }, 30000);
  }

  for (const id of ["claude", "codex"] as const) {
    test(`${id}: a usage limit is reported readably`, async () => {
      const host = await makeFakeHost();
      await withTempHome(async (home) => {
        const { app, client } = await bootHarnessApp(home, host);
        try {
          const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
          await client.invoke("session.harness.bind", { sessionId, harnessId: id } as never);
          const runId = await startTurn(client, sessionId, workspaceId, "limit please");
          expect((await waitRun(app, runId)).status).toBe("failed");
          const failed = (await runEvents(app, runId)).find((e) => e.eventType === "turn.failed")!.payload as { code: string; message: string };
          expect(failed.code).toBe("RATE_LIMITED");
        } finally {
          await app.stop();
        }
      });
    }, 30000);
  }
});
