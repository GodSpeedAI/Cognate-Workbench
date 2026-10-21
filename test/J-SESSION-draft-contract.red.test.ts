// RED CONTRACT — J-SESSION-draft (proposed journey).
// A Session is a durable conversation identity, not an in-memory UUID created by the sidebar.
// This suite intentionally fails until session.create is bound through the validated Cognate IDM.
// No model is needed just to create and resume an empty conversation.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { allEvents, bootApp, inv, waitUntil, withTempHome } from "./wb-helpers.ts";

type SessionDraft = {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly lastStatus: string;
};

async function draftRow(app: Awaited<ReturnType<typeof bootApp>>["app"], sessionId: string) {
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
  return rows.find((row) => row.key === sessionId)?.value as SessionDraft | undefined;
}

describe("J-SESSION-draft — durable creation before first turn (RED)", () => {
  test("plus-button backing capability creates an inspectable draft without inference; reload/restart preserves it", async () => {
    await withTempHome(async (home) => {
      const workspace = join(home, "project");
      await mkdir(workspace);
      const first = await bootApp(home);
      let sessionId: string;
      let workspaceId: string;
      try {
        ({ workspaceId } = (await inv(first.client, "workspace.select", { path: workspace })) as { workspaceId: string });
        const result = (await inv(first.client, "session.create", { workspaceId, requestId: "new-session-draft-1" })) as { sessionId: string };
        sessionId = result.sessionId;
        expect(sessionId).toBeTruthy();
        const draft = await waitUntil("durable draft in sessions projection", () => draftRow(first.app, sessionId));
        expect(draft).toMatchObject({ id: sessionId, workspaceId, title: "New Session", lastStatus: "draft" });
        const sessionEvents = (await allEvents(first.app)).filter(e => e.eventType === "session.created");
        expect(sessionEvents).toHaveLength(1);
        expect((await inv(first.client, "session.history", { sessionId })) as unknown[]).toEqual([]);
      } finally {
        await first.client.close();
        await first.app.stop();
      }
      const reopened = await bootApp(home);
      try {
        const draft = await waitUntil("draft after full restart", () => draftRow(reopened.app, sessionId));
        expect(draft).toMatchObject({ id: sessionId, workspaceId, lastStatus: "draft" });
      } finally {
        await reopened.client.close();
        await reopened.app.stop();
      }
    });
  }, 45_000);

  test("creation binds to the explicitly chosen workspace even when another workspace is current", async () => {
    await withTempHome(async home => {
      const wsA = join(home, "repo-a"), wsB = join(home, "repo-b");
      await Promise.all([mkdir(wsA), mkdir(wsB)]);
      const { app, client } = await bootApp(home);
      try {
        const a = (await inv(client, "workspace.select", { path: wsA })) as { workspaceId: string };
        const b = (await inv(client, "workspace.select", { path: wsB })) as { workspaceId: string };
        const { sessionId } = (await inv(client, "session.create", {
          workspaceId: a.workspaceId, requestId: "create-in-a-while-b-selected",
        })) as { sessionId: string };
        const row = await waitUntil("explicit workspace association", () => draftRow(app, sessionId));
        expect(row.workspaceId).toBe(a.workspaceId);
        const current = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows
          .find(r => r.key === "current")?.value;
        expect(current).toBe(b.workspaceId);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);

  test("repeating the same creation request returns the same identity and emits only one session.created", async () => {
    await withTempHome(async home => {
      const workspace = join(home, "repo");
      await mkdir(workspace);
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await inv(client, "workspace.select", { path: workspace })) as { workspaceId: string };
        const input = { workspaceId, requestId: "idempotent-session-create" };
        const a = (await inv(client, "session.create", input)) as { sessionId: string };
        const b = (await inv(client, "session.create", input)) as { sessionId: string };
        expect(a.sessionId).toBe(b.sessionId);
        const events = (await allEvents(app)).filter(e => e.eventType === "session.created" &&
          (e.payload as { sessionId?: string }).sessionId === a.sessionId);
        expect(events).toHaveLength(1);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);

  test("an unknown workspace cannot own a session", async () => {
    await withTempHome(async home => {
      const { app, client } = await bootApp(home);
      try {
        await expect(inv(client, "session.create", { workspaceId: "missing-workspace", requestId: "invalid" }))
          .rejects.toThrow(/workspace/i);
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        expect(rows).toHaveLength(0);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);
});
