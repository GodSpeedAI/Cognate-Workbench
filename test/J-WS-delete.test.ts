// Journey J-WS-delete: deleting a workspace removes its record, leaves the folder's files on disk
// untouched, and archives its sessions (they leave the working list; history stays). Sessions of
// other workspaces are unaffected; an unknown workspace is refused.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

describe("J-WS-delete", () => {
  test("deleting a workspace archives its sessions, keeps its files, and leaves other workspaces alone", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const dirA = join(home, "proj-a");
        const dirB = join(home, "proj-b");
        await mkdir(dirA, { recursive: true });
        await mkdir(dirB, { recursive: true });
        await writeFile(join(dirA, "keep.txt"), "still here\n");
        const a = (await client.invoke("workspace.select", { path: dirA })) as { readonly workspaceId: string };
        const b = (await client.invoke("workspace.select", { path: dirB })) as { readonly workspaceId: string };
        const mk = async (workspaceId: string) => ((await client.invoke("session.create", { workspaceId, requestId: randomUUID() } as never)) as { sessionId: string }).sessionId;
        const a1 = await mk(a.workspaceId);
        const a2 = await mk(a.workspaceId);
        const b1 = await mk(b.workspaceId);
        await client.invoke("session.setArchived", { sessionId: a2, archived: true });
        await app.runtime.idle();

        await client.invoke("workspace.delete", { workspaceId: a.workspaceId });
        await app.runtime.idle();

        const records = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows.filter((r) => r.key.includes("record/"));
        expect(records.map((r) => (r.value as { id: string }).id)).toEqual([b.workspaceId]);
        expect(await readFile(join(dirA, "keep.txt"), "utf8")).toBe("still here\n");

        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const flag = (id: string) => (rows.find((r) => (r.key === id || r.key.endsWith(`/${id}`)))?.value as { archived?: boolean } | undefined)?.archived === true;
        expect(flag(a1)).toBe(true);
        expect(flag(a2)).toBe(true);
        expect(flag(b1)).toBe(false);
        // History is intact: the archived rows still exist.
        expect(rows.some((r) => r.key === a1 || r.key.endsWith(`/${a1}`))).toBe(true);

        await expect(client.invoke("workspace.delete", { workspaceId: a.workspaceId })).rejects.toThrow(/unknown workspace/);
      } finally {
        await app.stop();
      }
    });
  }, 30000);
});
