// Journey J-SESSION-rename: an operator-chosen session title is durable, survives a restart, is not
// replaced by a later first prompt, and bad input (empty, over-long, unknown session) is refused.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

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

describe("J-SESSION-rename", () => {
  test("renaming a draft is durable across a restart and recorded without deleting anything", async () => {
    await withTempHome(async (home) => {
      let sessionId = "";
      {
        const { app, client } = await bootApp(home);
        try {
          sessionId = await draft(client);
          expect((await sessionValue(app, sessionId))?.title).toBe("New Session");
          const out = (await client.invoke("session.rename", { sessionId, title: "  Quarterly   report  " } as never)) as { ok: boolean; title: string };
          expect(out).toMatchObject({ ok: true, title: "Quarterly report" });
          const row = await sessionValue(app, sessionId);
          expect(row).toMatchObject({ title: "Quarterly report", lastStatus: "draft", renamed: true });
        } finally {
          await client.close();
          await app.stop();
        }
      }
      const { app, client } = await bootApp(home);
      try {
        expect((await sessionValue(app, sessionId))?.title).toBe("Quarterly report");
      } finally {
        await client.close();
        await app.stop();
      }
    });
  });

  test("empty, over-long and unknown-session renames are refused", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const sessionId = await draft(client);
        await expect(client.invoke("session.rename", { sessionId, title: "   " } as never)).rejects.toThrow();
        await expect(client.invoke("session.rename", { sessionId, title: "x".repeat(121) } as never)).rejects.toThrow();
        await expect(client.invoke("session.rename", { sessionId: "nope", title: "Ok" } as never)).rejects.toThrow();
        expect((await sessionValue(app, sessionId))?.title).toBe("New Session");
      } finally {
        await client.close();
        await app.stop();
      }
    });
  });
});
