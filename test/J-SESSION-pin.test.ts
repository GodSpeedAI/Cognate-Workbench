// Journey J-SESSION-pin: an operator-chosen pin floats the session to the top of its sidebar list
// independent of the active sort order, is durable across a restart, is reversible, and an unknown
// session id is refused. Pure view-ordering: no turn, run or event of the session is touched.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";
import { orderSessions, type SessionRow } from "../src/sidebarView.ts";

type Client = Awaited<ReturnType<typeof bootApp>>["client"];

async function sessionValue(app: AppServer, sessionId: string): Promise<Record<string, unknown> | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
  return rows.find((r) => r.key.endsWith(`/${sessionId}`) || r.key === sessionId)?.value as Record<string, unknown> | undefined;
}

async function draft(client: Client): Promise<string> {
  const { workspaceId } = (await client.invoke("workspace.select", { path: process.cwd() })) as { readonly workspaceId: string };
  const made = (await client.invoke("session.create", { workspaceId, requestId: crypto.randomUUID() } as never)) as { sessionId: string };
  return made.sessionId;
}

describe("J-SESSION-pin", () => {
  test("pinning is durable across a restart and reversible, with no history deleted", async () => {
    await withTempHome(async (home) => {
      let sessionId = "";
      {
        const { app, client } = await bootApp(home);
        try {
          sessionId = await draft(client);
          expect((await sessionValue(app, sessionId))?.pinned).toBeUndefined();
          const out = (await client.invoke("session.setPinned", { sessionId, pinned: true } as never)) as { ok: boolean; pinned: boolean };
          expect(out).toMatchObject({ ok: true, pinned: true });
          expect(await sessionValue(app, sessionId)).toMatchObject({ pinned: true, lastStatus: "draft" });
          // Unpin reverses it in the same boot.
          const off = (await client.invoke("session.setPinned", { sessionId, pinned: false } as never)) as { ok: boolean; pinned: boolean };
          expect(off).toMatchObject({ ok: true, pinned: false });
          expect((await sessionValue(app, sessionId))?.pinned).toBe(false);
          // Pin again: the restart half of the journey needs the flag set.
          await client.invoke("session.setPinned", { sessionId, pinned: true } as never);
        } finally {
          await client.close();
          await app.stop();
        }
      }
      {
        const { app, client } = await bootApp(home);
        try {
          expect((await sessionValue(app, sessionId))?.pinned).toBe(true);
        } finally {
          await client.close();
          await app.stop();
        }
      }
    });
  });

  test("pinned sessions float to the top of the list under both sort orders, recency-ordered within the pinned block", () => {
    const rows: SessionRow[] = [
      { id: "a", workspaceId: "w", title: "A", lastStatus: "completed", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", workspaceId: "w", title: "B", lastStatus: "completed", updatedAt: "2026-03-01T00:00:00Z", pinned: true },
      { id: "c", workspaceId: "w", title: "C", lastStatus: "completed", updatedAt: "2026-02-01T00:00:00Z", pinned: true },
      { id: "d", workspaceId: "w", title: "D", lastStatus: "completed", updatedAt: "2026-04-01T00:00:00Z" },
    ];
    // Pinned first (b before c: their relative recency holds), then the rest in the sort's own order.
    expect(orderSessions(rows, "manual").map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(orderSessions(rows, "last-updated").map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
  });

  test("pinning an unknown session id is refused", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("session.setPinned", { sessionId: "nope", pinned: true } as never)).rejects.toThrow();
      } finally {
        await client.close();
        await app.stop();
      }
    });
  });
});
