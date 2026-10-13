// Journey J-SESSION-archive (T11): archiving is a durable, reversible per-session fact — not
// deletion. Covers: archiving records a fact the `sessions` projection folds; the session's turns,
// events and title all survive; unarchiving reverses it; a full runtime restart against the same
// store keeps the flag; and an unknown session id is refused rather than silently recorded.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

type SessionValue = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof bootApp>>["client"];

async function sessionRow(app: AppServer, sessionId: string): Promise<SessionValue | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
  return rows.find((r) => r.key === sessionId)?.value as SessionValue | undefined;
}

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

/** Creates one real, completed session so there is something to archive. */
async function makeSession(app: AppServer, client: Client, aimockPort: number): Promise<string> {
  await client.invoke("model.configure", {
    providerId: "mock",
    baseURL: `http://127.0.0.1:${aimockPort}/v1`,
    protocol: "openai-compatible",
    model: "mock-model-1",
    apiKey: "",
  });
  const { workspaceId } = (await client.invoke("workspace.select", { path: process.cwd() })) as { readonly workspaceId: string };
  const sessionId = randomUUID();
  const view = await client.startRun(
    "agent.coding",
    { sessionId, workspaceId, message: "[[scenario:plain]] a session to archive" } as never,
    { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
  );
  await waitForCompletion(app, view.runId);
  return sessionId;
}

describe("J-SESSION-archive", () => {
  test("archiving is durable and reversible, and never deletes anything", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const sessionId = await makeSession(app, client, aimock.port);

        const before = await sessionRow(app, sessionId);
        expect(before).toBeDefined();
        expect(before?.title).toContain("a session to archive");
        expect(before?.archived).toBeUndefined();

        // Archive.
        const archived = (await client.invoke("session.setArchived", { sessionId, archived: true })) as { readonly ok: boolean; readonly archived: boolean };
        expect(archived.ok).toBe(true);
        expect(archived.archived).toBe(true);
        expect((await sessionRow(app, sessionId))?.archived).toBe(true);

        // Nothing was deleted: the title, status and run linkage all survive.
        const after = await sessionRow(app, sessionId);
        expect(after?.title).toBe(before?.title);
        expect(after?.lastStatus).toBe(before?.lastStatus);

        // History still works on an archived session — archive hides, it does not destroy.
        const history = (await client.invoke("session.history", { sessionId })) as unknown as readonly { readonly role: string }[];
        expect(history.length).toBeGreaterThan(0);

        // Unarchive reverses the flag exactly.
        const restored = (await client.invoke("session.setArchived", { sessionId, archived: false })) as { readonly ok: boolean; readonly archived: boolean };
        expect(restored.archived).toBe(false);
        expect((await sessionRow(app, sessionId))?.archived).toBe(false);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  });

  test("the archive flag survives a full runtime restart against the same store", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      {
        const { app, client } = await bootApp(home);
        try {
          const sessionId = await makeSession(app, client, aimock.port);
          await client.invoke("session.setArchived", { sessionId, archived: true });
        } finally {
          await app.stop();
        }
      }
      // Second server instance on the same home: the flag re-folds from the durable event log.
      const reopened = await bootApp(home);
      try {
        await reopened.app.runtime.idle();
        const rows = (await reopened.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const archived = rows.filter((r) => (r.value as SessionValue)?.archived === true);
        expect(archived.length).toBe(1);
      } finally {
        await reopened.app.stop();
        await aimock.stop();
      }
    });
  });

  test("an unknown session is refused, and nothing is recorded for it", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("session.setArchived", { sessionId: "no-such-session", archived: true })).rejects.toThrow(/unknown session/);

        await app.runtime.idle();
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        expect(rows.some((r) => r.key === "no-such-session")).toBe(false);
      } finally {
        await app.stop();
      }
    });
  });

  test("a malformed request is refused before any event is recorded", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("session.setArchived", { sessionId: "", archived: true })).rejects.toThrow();
        await expect(client.invoke("session.setArchived", { sessionId: "x" })).rejects.toThrow(/archived must be a boolean/);
      } finally {
        await app.stop();
      }
    });
  });
});
