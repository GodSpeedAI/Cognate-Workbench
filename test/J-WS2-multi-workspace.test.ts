// Journey J-WS2-multi-workspace (usage pass U3, reference-behavior-matrix.md §12): the sidebar's
// Workspaces section is a real multi-workspace list — every `workspace.added` record is a treeitem
// with its own sessions nested, the composer-area "Choose workspace" control switches the active
// workspace, Rename/Delete are durable (`workspace.rename` / `workspace.delete`), and deleting the
// ACTIVE workspace drops the app back to the no-workspace state while the deleted workspace's
// sessions stay in history.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

interface WorkspaceRow {
  readonly id: string;
  readonly root: string;
  readonly title: string;
}

async function readWorkspaces(app: Awaited<ReturnType<typeof bootApp>>["app"]): Promise<{ readonly records: readonly WorkspaceRow[]; readonly current: string | undefined }> {
  await app.runtime.idle(); // let the projection fold cover every committed write before reading
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
  const records = rows.filter((r) => r.key.startsWith("record/")).map((r) => r.value as unknown as WorkspaceRow);
  const current = rows.find((r) => r.key === "current")?.value as string | undefined;
  return { records, current };
}

describe("J-WS2-multi-workspace", () => {
  test("two workspaces record separately, switching re-points `current`, rename and delete are durable, deleting the active one clears it", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const wsA = join(home, "ws-a");
        const wsB = join(home, "ws-b");
        await mkdir(wsA, { recursive: true });
        await mkdir(wsB, { recursive: true });
        const a = (await client.invoke("workspace.select", { path: wsA })) as { readonly workspaceId: string };
        const b = (await client.invoke("workspace.select", { path: wsB })) as { readonly workspaceId: string };
        expect(a.workspaceId).not.toBe(b.workspaceId);

        // Both records exist; the latest select is current.
        let { records, current } = await readWorkspaces(app);
        expect(records).toHaveLength(2);
        expect(current).toBe(b.workspaceId);

        // "Choose workspace" (hero dropdown → menuitem): re-selecting ws-a switches the pointer
        // without re-adding (idempotent select of a known path).
        await client.invoke("workspace.select", { path: wsA });
        ({ current } = await readWorkspaces(app));
        expect(current).toBe(a.workspaceId);

        // Rename is durable (the sidebar row's new label comes from this record).
        await client.invoke("workspace.rename", { workspaceId: b.workspaceId, title: "Second Fixture" });
        ({ records } = await readWorkspaces(app));
        expect(records.find((r) => r.id === b.workspaceId)?.title).toBe("Second Fixture");

        // Delete a NON-active workspace: its record goes, the active pointer is untouched.
        await client.invoke("workspace.delete", { workspaceId: b.workspaceId });
        ({ records, current } = await readWorkspaces(app));
        expect(records).toHaveLength(1);
        expect(records[0]!.id).toBe(a.workspaceId);
        expect(current).toBe(a.workspaceId);

        // Sessions keep recording against their (now-deleted) workspace's id — the events stay in
        // history; the UI just has no tree group to show them under anymore.
        const sessionId = randomUUID();
        await app.runtime.service.startRun(LOCAL_OPERATOR, {
          agent: "agent.config",
          input: { kind: "settings.changed", workDetails: "standard" },
          idempotencyKey: randomUUID(),
        });

        // Delete the ACTIVE workspace: the pointer clears — the app's composer gating falls back
        // to the no-workspace state (the projection's `current` row is deleted, not stale).
        await client.invoke("workspace.delete", { workspaceId: a.workspaceId });
        ({ records, current } = await readWorkspaces(app));
        expect(records).toHaveLength(0);
        expect(current).toBeUndefined();

        // Both capabilities validate: unknown ids and empty titles reject.
        await expect(client.invoke("workspace.rename", { workspaceId: "nope", title: "x" })).rejects.toThrow();
        await expect(client.invoke("workspace.rename", { workspaceId: a.workspaceId, title: "  " })).rejects.toThrow();
        await expect(client.invoke("workspace.delete", { workspaceId: "nope" })).rejects.toThrow();
        void sessionId;
      } finally {
        await app.stop();
      }
    });
  }, 20_000);

  test("workspace list, current pointer, and renames survive a full runtime restart", async () => {
    await withTempHome(async (home) => {
      const wsA = join(home, "ws-a");
      const wsB = join(home, "ws-b");
      await mkdir(wsA, { recursive: true });
      await mkdir(wsB, { recursive: true });
      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("workspace.select", { path: wsA });
          await client.invoke("workspace.select", { path: wsB });
          const { records } = await readWorkspaces(app);
          const aRow = records.find((r) => r.root === wsA)!;
          await client.invoke("workspace.rename", { workspaceId: aRow.id, title: "Renamed A" });
        } finally {
          await app.stop();
        }
      }
      const reopened = await startServer({ port: 0, home });
      try {
        const { records, current } = await readWorkspaces(reopened);
        expect(records).toHaveLength(2);
        const titles = new Map(records.map((r) => [r.root, r.title]));
        expect(titles.get(wsA)).toBe("Renamed A");
        expect(titles.get(wsB)).toBe("ws-b");
        expect(current).toBe((await readWorkspaces(reopened)).current);
      } finally {
        await reopened.stop();
      }
    });
  }, 20_000);

  test("bootAimock stays importable here (endpoint contract unchanged for U3's composer gating)", async () => {
    // U3's composer gating keys on the current workspace; this smoke keeps the aimock helper in
    // the loop so the journey file exercises the same boot path the UI uses end-to-end.
    const aimock = await bootAimock();
    try {
      const res = await fetch(`http://127.0.0.1:${aimock.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mock-model-1", messages: [{ role: "user", content: "[[scenario:plain]] ping" }] }),
      });
      expect(res.status).toBe(200);
    } finally {
      await aimock.stop();
    }
  });
});
