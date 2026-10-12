// Journey J-WS-select: choose a workspace directory -> a WorkspaceRecord persists -> selecting it
// again (re-select) does not create a duplicate record.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

describe("J-WS-select", () => {
  test("choose a directory -> workspace record persists and becomes current", async () => {
    await withTempHome(async (home) => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "deepseek-harness-ws-"));
      const { app, client } = await bootApp(home);
      try {
        const first = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string; readonly root: string };
        expect(first.workspaceId).toBeTruthy();

        await app.runtime.idle();
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
        const record = rows.find((r) => r.key === `record/${first.workspaceId}`)?.value as { readonly id: string; readonly root: string } | undefined;
        expect(record?.root).toBe(first.root);
        const current = rows.find((r) => r.key === "current")?.value;
        expect(current).toBe(first.workspaceId);

        // Re-select the same directory: same workspace id, no duplicate record.
        const second = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
        expect(second.workspaceId).toBe(first.workspaceId);
        await app.runtime.idle();
        const rowsAfter = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
        const recordCount = rowsAfter.filter((r) => r.key.startsWith("record/")).length;
        expect(recordCount).toBe(1);
      } finally {
        await app.stop();
      }
    });
  });

  test("selecting a non-existent path fails closed", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("workspace.select", { path: "/definitely/not/a/real/path/xyz" })).rejects.toThrow();
      } finally {
        await app.stop();
      }
    });
  });
});
