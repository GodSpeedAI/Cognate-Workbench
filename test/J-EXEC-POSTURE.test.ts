// J-EXEC-POSTURE: agent effects are contained by default. With no opt-in, a real agent run in a
// local workspace cannot launch a process or write a file: the tools fail with an actionable
// refusal and the workspace on disk is unchanged. The operator's explicit
// COGNATE_EXECUTION_POSTURE=uncontained-local restores host execution (J-C-tool-execution covers
// that path). Teeth: before this posture existed, the same scenario ran `bash` and rewrote
// src/greet.ts on the host (J-C, readiness gate S02/B-04, 2026-10-21).
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { parseExecutionPosture, postureRegistry, UncontainedEffectRefusedError } from "../src/executionPosture.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { makeWorkspace } from "../fixtures/workspace/make-workspace.ts";

describe("J-EXEC-POSTURE", () => {
  test("posture parsing: unset is contained; only the two names are accepted", () => {
    expect(parseExecutionPosture(undefined)).toBe("contained");
    expect(parseExecutionPosture("")).toBe("contained");
    expect(parseExecutionPosture("uncontained-local")).toBe("uncontained-local");
    for (const bad of ["local", "off", "1", "true", "Contained"]) expect(() => parseExecutionPosture(bad)).toThrow("COGNATE_EXECUTION_POSTURE");
  });

  test("the registry guard covers every local-kind world, including ones registered later (forks)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-posture-"));
    try {
      await writeFile(join(dir, "kept.txt"), "original\n");
      const registry = postureRegistry(createExecutionWorldRegistry([localExecutionWorld()]), "contained");
      registry.register(localExecutionWorld({ worldId: "sbx-fork", metadata: { isolation: "directory-copy" } }));
      for (const worldId of ["local", "sbx-fork"]) {
        const world = registry.get(worldId);
        await expect(world.process.exec({ argv: ["sh", "-c", `echo pwned > ${join(dir, "pwned.txt")}`], cwd: dir })).rejects.toBeInstanceOf(UncontainedEffectRefusedError);
        await expect(world.fileSystem.writeText(join(dir, "kept.txt"), "overwritten\n")).rejects.toBeInstanceOf(UncontainedEffectRefusedError);
        expect(await world.fileSystem.readText(join(dir, "kept.txt"))).toBe("original\n");
      }
      // Independent check of the target state, not of the error alone.
      expect(await readFile(join(dir, "kept.txt"), "utf8")).toBe("original\n");
      expect(await Bun.file(join(dir, "pwned.txt")).exists()).toBe(false);
      // The opt-in returns the registry untouched.
      const open = postureRegistry(createExecutionWorldRegistry([localExecutionWorld()]), "uncontained-local");
      expect((await open.get("local").process.exec({ argv: ["sh", "-c", "printf ok"], cwd: dir })).stdout).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("default posture: a real agent run cannot run bash or edit files in a local workspace", async () => {
    const saved = process.env.COGNATE_EXECUTION_POSTURE;
    delete process.env.COGNATE_EXECUTION_POSTURE;
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      let app: AppServer | undefined;
      try {
        app = await startServer({ devAuth: true, port: 0, home });
        expect(app.executionPosture).toBe("contained");
        const health = (await (await fetch(`${app.url}/health`)).json()) as { execution: { posture: string; linuxContainmentConfigured: boolean } };
        expect(health.execution).toEqual({ posture: "contained", linuxContainmentConfigured: false });

        const client = createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const workspaceDir = join(home, "ws-posture");
        await makeWorkspace(workspaceDir);
        const before = await readFile(join(workspaceDir, "src", "greet.ts"), "utf8");
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };

        const failures: { tool: string; error: string }[] = [];
        const completed: string[] = [];
        const unsubscribe = client.subscribe({}, (event: StoredEvent) => {
          const p = event.payload as { tool?: string; error?: unknown; message?: unknown };
          if (event.eventType === "tool.call.failed" && p.tool) failures.push({ tool: p.tool, error: JSON.stringify(p) });
          if (event.eventType === "tool.call.completed" && p.tool) completed.push(p.tool);
        });
        const sessionId = randomUUID();
        const run = await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:multi]] do the multi-step task now" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
        await waitForTerminal(app, run.runId);
        unsubscribe();

        // The effectful tools were refused with the actionable message; reading stayed available.
        const refused = failures.filter((f) => f.error.includes("UncontainedEffectRefused") || f.error.includes("contained workspaces"));
        expect(refused.map((f) => f.tool)).toContain("bash");
        expect(refused.some((f) => f.error.includes("COGNATE_EXECUTION_POSTURE=uncontained-local"))).toBe(true);
        expect(completed).not.toContain("bash");
        expect(completed).not.toContain("edit");
        // Independent check of the workspace: nothing on disk changed.
        expect(await readFile(join(workspaceDir, "src", "greet.ts"), "utf8")).toBe(before);
      } finally {
        await app?.stop();
        await aimock.stop();
        if (saved === undefined) delete process.env.COGNATE_EXECUTION_POSTURE;
        else process.env.COGNATE_EXECUTION_POSTURE = saved;
      }
    });
  }, 60_000);

  test("the operator opt-in is explicit and reported", async () => {
    await withTempHome(async (home) => {
      const app = await startServer({ devAuth: true, port: 0, home, executionPosture: "uncontained-local" });
      try {
        const health = (await (await fetch(`${app.url}/health`)).json()) as { execution: { posture: string } };
        expect(health.execution.posture).toBe("uncontained-local");
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});

async function waitForTerminal(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await Bun.sleep(50);
  }
  throw new Error(`run ${runId} did not finish`);
}
