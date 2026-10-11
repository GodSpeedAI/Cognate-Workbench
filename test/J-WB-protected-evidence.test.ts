// Journey J-WB-protected-evidence (V-003): protected evidence is structurally immutable. The agent
// loop is driven for real (aimock model, real tools, real files); a protected write is blocked with an
// attributable reason, the file stays byte-identical, and the block is recorded as integrity evidence.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { BlockedRecord } from "../src/workbench/state.ts";
import type { EvidenceEntry } from "../src/workbench/types.ts";
import { SYSTEM, allEvents, bootApp, bootAimock, createTask, fullContract, rowsWithPrefix, seed, waitForCompletion, waitUntil, withTempHome, type AppServer, type Client, inv } from "./wb-helpers.ts";

async function runTurn(app: AppServer, client: Client, workspaceId: string, taskId: string, scenario: string) {
  const sessionId = randomUUID();
  const run = await client.startRun("agent.coding", { sessionId, workspaceId, taskId, message: `[[scenario:${scenario}]] go` } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
  return { sessionId, run: await waitForCompletion(app, run.runId) };
}

describe("J-WB-protected-evidence", () => {
  test("V-003: a protected edit is blocked, the file is unchanged, the block is evidence; elevation is human-only and exact", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seed(client, home, aimock.port);
        const greet = join(workspaceDir, "src", "greet.ts");
        const before = await readFile(greet, "utf8");
        expect(before).toContain("Hello");

        const taskId = await createTask(app, client, workspaceId, "Protect greet", fullContract(workspaceId, ["src/greet.ts"]));
        await inv(client, "task.contract.update", { taskId, contract: fullContract(workspaceId, ["src/greet.ts"]) });

        // 1. The agent tries to edit the protected file (read, then edit).
        const first = await runTurn(app, client, workspaceId, taskId, "edit");
        expect(first.run.status).toBe("completed");
        expect(await readFile(greet, "utf8")).toBe(before); // byte-identical

        const failed = (await allEvents(app)).filter((e) => e.eventType === "tool.call.failed").map((e) => e.payload as { tool: string; error: string });
        const blockedCall = failed.find((f) => f.tool === "edit");
        expect(blockedCall?.error).toMatch(/blocked by authority \(protected-evidence\)/);
        expect(blockedCall?.error).toContain("src/greet.ts");

        // 2. The block is a durable record and integrity evidence on the owning task.
        const blocked = await waitUntil("blocked row", async () => {
          const rows = await rowsWithPrefix<BlockedRecord>(app, "blocked/");
          return rows.length > 0 ? rows : undefined;
        });
        expect(blocked[0]).toMatchObject({ tool: "edit", path: "src/greet.ts", pattern: "src/greet.ts", taskId });
        const evidence = await waitUntil("integrity evidence", async () => {
          const rows = await rowsWithPrefix<EvidenceEntry>(app, `evidence/${taskId}/`);
          return rows.find((r) => r.kind === "integrity") ?? undefined;
        });
        expect(evidence.status).toBe("pass");
        expect(evidence.summary).toContain("blocked edit");

        // 3. Destructive shell on a protected directory is blocked too (scenario: rm -rf generated).
        const taskB = await createTask(app, client, workspaceId, "Protect generated", fullContract(workspaceId, ["generated/"]));
        await inv(client, "task.contract.update", { taskId: taskB, contract: fullContract(workspaceId, ["generated/"]) });
        await waitUntil("contract protects generated/", async () => (await rowsWithPrefix<{ id: string; contract: { authority?: { protectedPaths: string[] } } }>(app, "task/")).some((t) => t.id === taskB && t.contract.authority?.protectedPaths.includes("generated/")));
        const second = await runTurn(app, client, workspaceId, taskB, "cleanup");
        expect(second.run.status).toBe("completed");
        const shellFailures = (await allEvents(app)).filter((e) => e.eventType === "tool.call.failed").map((e) => e.payload as { tool: string; error: string }).filter((f) => f.tool === "bash");
        expect(shellFailures.some((f) => /protected-evidence/.test(f.error))).toBe(true);

        // 4. An agent (non-user actor) cannot elevate; a user can, per exact path, never by glob.
        await expect(app.runtime.service.invoke(SYSTEM, { capability: "authority.elevate", input: { workspaceId, path: "src/greet.ts" } as never })).rejects.toThrow(/human decision/);
        await expect(inv(client, "authority.elevate", { workspaceId, path: "src/*.ts" })).rejects.toThrow(/globs cannot be elevated/);
        await inv(client, "authority.elevate", { workspaceId, path: "src/greet.ts" });
        await waitUntil("elevation row", async () => (((await app.runtime.service.readProjection({ actor: { id: "operator", kind: "user" }, tenant: "local" }, { name: "workbench" })).rows).some((r) => r.key === `elevation/${workspaceId}`)));

        // Elevation never means "allowed": the check now says approval is required.
        const check = (await inv(client, "authority.check", { workspaceId, taskId, tool: "edit", args: { file_path: "src/greet.ts" } })) as { outcome: string; rule: string };
        expect(check).toMatchObject({ outcome: "approval", rule: "protected-evidence" });
        // A different protected path is still blocked.
        const other = (await inv(client, "authority.check", { workspaceId, taskId: taskB, tool: "bash", args: { command: "rm -rf generated" } })) as { outcome: string };
        expect(other.outcome).toBe("deny");
        // Absolute spelling of the same file does not sidestep protection.
        const abs = (await inv(client, "authority.check", { workspaceId, taskId: taskB, tool: "edit", args: { file_path: join(workspaceDir, "generated", "x.txt") } })) as { outcome: string; rule: string };
        expect(abs).toMatchObject({ outcome: "deny", rule: "protected-evidence" });
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 60_000);
});
