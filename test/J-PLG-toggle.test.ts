// Journey J-PLG-toggle (usage pass U7): the RealityTrace plugin toggle is REAL. The switch writes
// durable per-plugin state (`settings.changePlugin` → `settings.changed` → the `settings`
// projection's `plugins` map, merged per key), the observation drain gate reads that same fold per
// cycle (server.ts), and the state survives a full runtime restart. With the plugin off,
// observations stay queued (at-least-once — nothing is lost); enabling drains the backlog to the
// pinned SXR CLI. Validation fails closed for unknown plugin ids and non-boolean values.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

// Phase-0 fixture contract: the pinned binary must exist — this test FAILS (not skips) without it.
const SXR_BIN = process.env.SXR_BIN ?? join(import.meta.dir, "../../../../..", ".tmp", "realitytrace", "bin", "realitytrace");

interface ObservationStatus {
  readonly eventId: string;
  readonly state?: string;
  readonly observationId?: string;
  readonly targetRef?: string | null;
}

async function readPluginState(app: Awaited<ReturnType<typeof bootApp>>["app"]): Promise<Record<string, boolean> | undefined> {
  await app.runtime.idle(); // let the projection fold cover every committed write before reading
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
  const current = rows.find((row) => row.key === "current")?.value as { plugins?: Record<string, boolean> } | undefined;
  return current?.plugins;
}

async function waitForCompletion(app: Awaited<ReturnType<typeof bootApp>>["app"], runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-PLG-toggle", () => {
  test("the toggle writes durable per-plugin state: validation, fold, and full-restart survival", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        // A fresh home has no plugins row at all: absence means disabled.
        expect(readPluginState(app)).resolves.toBeUndefined();

        // Validation fails closed: unknown plugin ids and non-boolean values never reach the log.
        await expect(client.invoke("settings.changePlugin", { plugins: { notaplugin: true } })).rejects.toThrow();
        await expect(client.invoke("settings.changePlugin", { plugins: { realitytrace: "yes" } })).rejects.toThrow();
        await expect(client.invoke("settings.changePlugin", { plugins: {} })).rejects.toThrow();
        const eventsBefore = await Array.fromAsync(app.runtime.service.events(LOCAL_OPERATOR, {}));
        expect(eventsBefore.filter((e) => e.eventType === "settings.changed")).toHaveLength(0);

        // The real toggle: on, then off, then on again — each a durable event the fold merges per key.
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: true } });
        expect((await readPluginState(app))?.realitytrace).toBe(true);
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: false } });
        expect((await readPluginState(app))?.realitytrace).toBe(false);
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: true } });
        expect((await readPluginState(app))?.realitytrace).toBe(true);
      } finally {
        await app.stop();
      }

      // Full runtime restart against the same home: the projection re-folds from the event log,
      // so the enabled state (and every other durable setting) survives.
      const { app: restarted, client: restartedClient } = await bootApp(home);
      try {
        expect((await readPluginState(restarted))?.realitytrace).toBe(true);
        // And the toggle keeps working on the restarted runtime.
        await restartedClient.invoke("settings.changePlugin", { plugins: { realitytrace: false } });
        expect((await readPluginState(restarted))?.realitytrace).toBe(false);
      } finally {
        await restarted.stop();
      }
    });
  });

  test("the drain gate honors the plugin state: off queues, on delivers the backlog", async () => {
    if (!existsSync(SXR_BIN)) {
      throw new Error(`RealityTrace CLI not found at ${SXR_BIN}. Install the pinned release with \`just setup-realitytrace\` or set SXR_BIN. This test intentionally FAILS (not skips) when the binary is unavailable, per the Phase 0 fixture contract.`);
    }
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
        await writeFile(join(ws, "README.md"), "# Fixture project\n\nA tiny fixture workspace with a greet() helper in src/greet.ts.\n");
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };

        // The plugin is OFF (fresh home, nothing toggled). Run the tool session and let the drain
        // cycle pass repeatedly — the gate must skip every one of them.
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-tool]] read the readme please" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const final = await waitForCompletion(app, run.runId);
        expect(final.status).toBe("completed");

        const eventIds: string[] = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { correlationId: `session:${sessionId}` })) {
          if (["tool.call.started", "tool.call.completed", "tool.call.failed", "message.completed"].includes(e.eventType)) {
            eventIds.push(e.eventId);
          }
        }
        expect(eventIds.length).toBeGreaterThanOrEqual(3);

        // Several drain intervals pass while the plugin is off: every status stays queued.
        const statusNow = async () => (await client.invoke("observation.status", { eventIds } as never)) as unknown as { readonly statuses: readonly ObservationStatus[] };
        await new Promise((r) => setTimeout(r, 3_500));
        const whileOff = await statusNow();
        expect(whileOff.statuses.length).toBe(eventIds.length);
        for (const status of whileOff.statuses) {
          expect(status.state).toBe("queued");
          expect(status.targetRef ?? null).toBeNull();
        }

        // Enable the plugin: the next drain cycle delivers the whole backlog (at-least-once),
        // each observation a real SXR plan-create + ingest subprocess pair.
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: true } });
        const deadline = Date.now() + 45_000;
        let statuses: readonly ObservationStatus[] = [];
        for (;;) {
          statuses = (await statusNow()).statuses;
          if (statuses.every((s) => s.state === "accepted" || s.state === "duplicate")) break;
          if (Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(statuses.length).toBe(eventIds.length);
        for (const status of statuses) {
          expect(status.state === "accepted" || status.state === "duplicate").toBe(true);
          expect(status.observationId).toMatch(/^obs-/);
          expect(typeof status.targetRef).toBe("string");
          expect(status.targetRef).toContain(":");
        }
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);
});
