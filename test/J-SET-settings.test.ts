// Journey J-SET-settings (usage pass U2, reference-behavior-matrix.md §11): the Settings → General
// inventory is durable event-log state and the Permission setting actually gates approval behavior.
// Covers: every `settings.change*` capability persists through a full runtime restart against the
// same SQLite store (the §11 durability contract); invalid values are rejected per capability;
// the permission DEFAULT changes whether the `[[scenario:approval]]` `run_code` escalation asks
// (read-only ⇒ ask, workspace-write ⇒ no ask); and a per-session `AgentCodingInput.mode` overrides
// the default (the composer dropdown's contract), folded back onto the `sessions` row.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

type SettingsRow = Record<string, unknown>;

async function readSettings(app: AppServer): Promise<SettingsRow | undefined> {
  await app.runtime.idle(); // let the projection fold cover every committed write
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
  return rows.find((r) => r.key === "current")?.value as SettingsRow | undefined;
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
}

async function waitForCompletion(app: AppServer, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-SET-settings", () => {
  test("every General setting survives a full runtime restart against the same store", async () => {
    await withTempHome(async (home) => {
      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("settings.changeWorkDetails", { workDetails: "verbose" });
          await client.invoke("settings.changePermission", { permission: "read-only" });
          await client.invoke("settings.changeLanguage", { language: "zh" });
          await client.invoke("settings.changeAppearance", { appearance: "dark" });
          await client.invoke("settings.changeFontSize", { fontSize: 16 });
          await client.invoke("settings.changePerformanceDetail", { performanceDetail: "compact" });
          await client.invoke("settings.changeCodingTools", { codingTools: false });
          await client.invoke("settings.changeSendBehavior", { sendBehavior: "steer" });

          const current = await readSettings(app);
          expect(current?.workDetails).toBe("verbose");
          expect(current?.permission).toBe("read-only");
          expect(current?.language).toBe("zh");
          expect(current?.appearance).toBe("dark");
          expect(current?.fontSize).toBe(16);
          expect(current?.performanceDetail).toBe("compact");
          expect(current?.codingTools).toBe(false);
          expect(current?.sendBehavior).toBe("steer");
        } finally {
          await app.stop();
        }
      }

      // Fresh server instance on the same SQLite home — the settings row re-resolves from durable
      // events, so every field (not just work details, J-I's original scope) survives the restart.
      const reopened = await startServer({ executionPosture: "uncontained-local", port: 0, home });
      try {
        const current = await readSettings(reopened);
        expect(current?.workDetails).toBe("verbose");
        expect(current?.permission).toBe("read-only");
        expect(current?.language).toBe("zh");
        expect(current?.appearance).toBe("dark");
        expect(current?.fontSize).toBe(16);
        expect(current?.performanceDetail).toBe("compact");
        expect(current?.codingTools).toBe(false);
        expect(current?.sendBehavior).toBe("steer");
      } finally {
        await reopened.stop();
      }
    });
  });

  test("each capability rejects an invalid value without recording an event", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("settings.changePermission", { permission: "sudo" })).rejects.toThrow();
        await expect(client.invoke("settings.changeLanguage", { language: "xx" })).rejects.toThrow();
        await expect(client.invoke("settings.changeAppearance", { appearance: "banana" })).rejects.toThrow();
        // Font size bounds: below the §11 floor (12) and non-integer both reject.
        await expect(client.invoke("settings.changeFontSize", { fontSize: 11 })).rejects.toThrow();
        await expect(client.invoke("settings.changeFontSize", { fontSize: 14.5 })).rejects.toThrow();
        await expect(client.invoke("settings.changePerformanceDetail", { performanceDetail: "verbose" })).rejects.toThrow();
        await expect(client.invoke("settings.changeSendBehavior", { sendBehavior: "interrupt" })).rejects.toThrow();
        await expect(client.invoke("settings.changeCodingTools", { codingTools: "yes" })).rejects.toThrow();
        const events = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) events.push(e);
        expect(events.filter((e) => e.eventType === "settings.changed")).toHaveLength(0);
      } finally {
        await app.stop();
      }
    });
  });

  test("permission mode gates the approval ask: read-only asks, workspace-write does not; the sessions row folds the mode", async () => {
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
        const workspaceDir = join(home, "ws-permission");
        await mkdir(workspaceDir, { recursive: true });
        const { workspaceId } = (await client.invoke("workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
        const message = "[[scenario:approval]] run something risky";

        // The durable permission default is consumed by the composer, which seeds NEW sessions'
        // access-mode dropdown and sends its value as `AgentCodingInput.mode` on every turn — so
        // these runs pass `mode` explicitly, mirroring what the UI sends with the settings default
        // set to each value. (A run with NO mode fails closed to read-only — that contract is
        // J-D-approval's; the Full-access-confirm dialog is UI-level and not asserted here.)
        await client.invoke("settings.changePermission", { permission: "read-only" });
        const sessionIdAsk = randomUUID();
        const askRun = await client.startRun(
          "agent.coding",
          { sessionId: sessionIdAsk, workspaceId, message, mode: "read-only" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionIdAsk}` },
        );
        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: askRun.runId });
          return continuations.some((c) => c.status === "OPEN");
        });
        // The continuation record and the run's `run.waiting` marker commit in separate decisions;
        // poll for the run view to fold the waiting status.
        await waitForCondition(async () => (await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: askRun.runId })).status === "waiting");
        const waiting = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: askRun.runId });
        expect(waiting.status).toBe("waiting");
        // Resolve (deny is enough — the branch is covered by J-D) so the run settles.
        const open = (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: askRun.runId })).find((c) => c.status === "OPEN");
        await client.resolveContinuation(open!.id, "resume", { approved: false });
        const askFinal = await waitForCompletion(app, askRun.runId);
        expect(askFinal.status).toBe("completed");

        // Workspace-write (the §11 reference default, sent by the composer with the settings
        // default at its default value): the same request is no longer an escalation — the run
        // completes with NO approval continuation ever opening.
        await client.invoke("settings.changePermission", { permission: "workspace-write" });
        const sessionIdNoAsk = randomUUID();
        const noAskRun = await client.startRun(
          "agent.coding",
          { sessionId: sessionIdNoAsk, workspaceId, message, mode: "workspace-write" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionIdNoAsk}` },
        );
        const noAskFinal = await waitForCompletion(app, noAskRun.runId);
        expect(noAskFinal.status).toBe("completed");
        const noAskContinuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: noAskRun.runId });
        expect(noAskContinuations).toHaveLength(0);

        // The per-session dropdown overrides the default (default workspace-write, user picks
        // Read Only): the ask happens again.
        const sessionIdOverride = randomUUID();
        const overrideRun = await client.startRun(
          "agent.coding",
          { sessionId: sessionIdOverride, workspaceId, message, mode: "read-only" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionIdOverride}` },
        );
        await waitForCondition(async () => {
          const continuations = await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: overrideRun.runId });
          return continuations.some((c) => c.status === "OPEN");
        });
        const openOverride = (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: overrideRun.runId })).find(
          (c) => c.status === "OPEN",
        );
        await client.resolveContinuation(openOverride!.id, "resume", { approved: false });
        await waitForCompletion(app, overrideRun.runId);

        // The `sessions` projection folds each session's current access mode from its run inputs.
        const sessionRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
        const askRow = sessionRows.find((r) => r.key === sessionIdAsk)?.value as { readonly accessMode?: string } | undefined;
        const overrideRow = sessionRows.find((r) => r.key === sessionIdOverride)?.value as { readonly accessMode?: string } | undefined;
        const noAskRow = sessionRows.find((r) => r.key === sessionIdNoAsk)?.value as { readonly accessMode?: string } | undefined;
        expect(askRow?.accessMode).toBe("read-only");
        expect(overrideRow?.accessMode).toBe("read-only");
        expect(noAskRow?.accessMode).toBe("workspace-write");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 30_000);
});
