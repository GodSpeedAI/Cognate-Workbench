// Journey J-PLG-panels (usage pass U4, reference-behavior-matrix.md Â§14â15): agent presets are a
// durable default for new sessions and a real per-turn tool-catalog scope. Covers: the
// `settings.changePreset` capability's durability across a full runtime restart and validation;
// the preset's tool-catalog effect (the recorded `model.generate` invocation carries exactly the
// preset's tools â minimal â [bash], ptc â includes run_code); the fail-closed "unknown tool"
// path when a fixture calls a tool outside the preset (the reference's Standard-mode run_code
// behavior, Â§6.2); and the `sessions` projection folding the preset into the row's mode badge.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

describe("J-PLG-panels", () => {
  test("the default preset is durable across a restart, validated, and scopes the turn's tool catalog", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        const ws = join(home, "ws");
        await mkdir(ws, { recursive: true });
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };
        await client.invoke("settings.changePreset", { preset: "ptc" });

        // The default preset rides the composer's sends: a run WITH the preset gets exactly the
        // ptc catalog (read/edit/bash/todo_write/exit_plan_mode/subagent/run_code) â verified
        // structurally off the recorded `model.generate` invocation's input.
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-plain]] preset probe", preset: "ptc" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        for (let i = 0; i < 400; i++) {
          const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
          if (r.status === "completed" || r.status === "failed") break;
          await new Promise((res) => setTimeout(res, 25));
        }
        let invocation: StoredEvent | undefined;
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: run.runId })) {
          if (e.eventType === "run.invocation" && (e.payload as { input?: { tools?: { name?: string }[] } }).input?.tools) {
            invocation = e;
          }
        }
        const tools = (invocation!.payload as { input: { tools: { name: string }[] } }).input.tools.map((t) => t.name).sort();
        expect(tools).toContain("run_code");
        // Capability-bundles tranche P (Â§2.4): the dispatcher ids are standing catalog members.
        expect(tools).toHaveLength(9);
        expect(tools).toContain("capability_invoke");
        expect(tools).toContain("skill_load");

        // minimal scopes to bash only â the same fixture message gets a bash-only catalog.
        const sessionIdMin = randomUUID();
        const runMin = await client.startRun(
          "agent.coding",
          { sessionId: sessionIdMin, workspaceId, message: "[[scenario:aim-plain]] minimal probe", preset: "minimal" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionIdMin}` },
        );
        for (let i = 0; i < 400; i++) {
          const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: runMin.runId });
          if (r.status === "completed" || r.status === "failed") break;
          await new Promise((res) => setTimeout(res, 25));
        }
        let invocationMin: StoredEvent | undefined;
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: runMin.runId })) {
          if (e.eventType === "run.invocation" && (e.payload as { input?: { tools?: { name?: string }[] } }).input?.tools) {
            invocationMin = e;
          }
        }
        const toolsMin = (invocationMin!.payload as { input: { tools: { name: string }[] } }).input.tools.map((t) => t.name).sort();
        // Capability-bundles tranche P (§2.4): the dispatcher ids are standing members of the
        // minimal preset too — bash remains the only direct workspace tool.
        expect(toolsMin).toEqual(["bash", "capability_invoke", "skill_load"]);

        // The sessions rows fold each session's preset into the mode-badge field.
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        expect((sessionRows.find((r) => r.key === sessionId)?.value as { mode?: string }).mode).toBe("ptc");
        expect((sessionRows.find((r) => r.key === sessionIdMin)?.value as { mode?: string }).mode).toBe("minimal");

        // Validation: an unknown preset rejects.
        await expect(client.invoke("settings.changePreset", { preset: "creator" })).rejects.toThrow();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 30_000);

  test("a tool call outside the session's preset fails closed with the reference's wording", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        const ws = join(home, "ws-std");
        await mkdir(ws, { recursive: true });
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };

        // The approval fixture's first tool call is run_code; under `standard` it is not in the
        // catalog â the call fails closed with `Error: unknown tool "run_code"` (Â§6.2's observed
        // Standard-mode wording), the text feeds back, and the run still completes.
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:approval]] run something risky", preset: "standard" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        for (let i = 0; i < 400; i++) {
          const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
          if (r.status === "completed" || r.status === "failed") break;
          await new Promise((res) => setTimeout(res, 25));
        }
        const final = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId });
        expect(final.status).toBe("completed");
        // No approval continuation may open â run_code never reached the gate.
        expect(await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run.runId })).toHaveLength(0);
        // The fail-closed wording rides the tool.call.failed event (the model's own final text is
        // the follow-up fixture's reply, not the error).
        let unknownToolError: string | undefined;
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId: run.runId })) {
          if (e.eventType === "tool.call.failed" && (e.payload as { tool?: string }).tool === "run_code") {
            unknownToolError = (e.payload as { error?: string }).error;
          }
        }
        expect(unknownToolError).toBe('Error: unknown tool "run_code"');
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 30_000);

  test("the default-preset setting survives a full runtime restart", async () => {
    await withTempHome(async (home) => {
      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("settings.changePreset", { preset: "minimal" });
          await app.runtime.idle();
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
          expect((rows.find((r) => r.key === "current")?.value as { preset?: string }).preset).toBe("minimal");
        } finally {
          await app.stop();
        }
      }
      const reopened = await startServer({ executionPosture: "uncontained-local", port: 0, home });
      try {
        const rows = (await reopened.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
        expect((rows.find((r) => r.key === "current")?.value as { preset?: string }).preset).toBe("minimal");
      } finally {
        await reopened.stop();
      }
    });
  });
});
