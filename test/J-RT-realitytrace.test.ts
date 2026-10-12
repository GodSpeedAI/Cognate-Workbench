// Journey J-RT-realitytrace (usage pass U6, Option A): the RealityTrace evidence layer enriches
// the event-sourced trace — trace-worthy events are committed to the outbox atomically with the
// event, delivered at-least-once to the pinned SXR CLI (v0.3.0, `just setup-realitytrace`), and
// the inspector reads the receipts (state + ledger position) and the SXR record's CEP correlation
// payload back. Covers: accepted receipts with ledger positions for a tool session's events; the
// record drill-down returning the CEP `extensions.cognate` correlation ids; and — the Option A
// invariant — a boot WITHOUT the SXR binary still runs the full harness (observations stay queued,
// the trace and journeys are unaffected). SXR state is isolated per-test via the boot home's
// sxr-repo/sxr-data directories (the phase-0 fixture's XDG contract).
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

// Phase-0 fixture contract: the pinned binary must exist — this test FAILS (not skips) without it.
const SXR_BIN = process.env.SXR_BIN ?? join(import.meta.dir, "..", ".tmp", "realitytrace", "bin", "realitytrace");

interface ObservationStatus {
  readonly eventId: string;
  readonly state?: string;
  readonly observationId?: string;
  readonly targetRef?: string | null;
  readonly attempts?: number;
}

async function waitForCompletion(app: Awaited<ReturnType<typeof bootApp>>["app"], runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete in time`);
}

describe("J-RT-realitytrace", () => {
  test("tool-session events deliver to SXR: accepted receipts, ledger positions, and the correlation drill-down", async () => {
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
        // Usage pass U7: the RealityTrace plugin gates the drain (default disabled) — this journey
        // exercises the delivery path, so it enables the plugin first (exactly what the console's
        // Plugins-panel switch does; J-PLG-toggle proves the gate itself).
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: true } });
        const ws = join(home, "ws");
        await mkdir(ws, { recursive: true });
        await writeFile(join(ws, "README.md"), "# Fixture project\n\nA tiny fixture workspace with a greet() helper in src/greet.ts.\n");
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-tool]] read the readme please" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const final = await waitForCompletion(app, run.runId);
        expect(final.status).toBe("completed");

        // Collect the session's observed event ids (the tool-call family + the final answer).
        const eventIds: string[] = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { correlationId: `session:${sessionId}` })) {
          if (["tool.call.started", "tool.call.completed", "tool.call.failed", "message.completed"].includes(e.eventType)) {
            eventIds.push(e.eventId);
          }
        }
        expect(eventIds.length).toBeGreaterThanOrEqual(3);

        // Poll observation.status until the background drain has delivered every one of them
        // (each observation is a real SXR plan-create + ingest subprocess pair; deliveries are
        // at-least-once in the background — never awaited by the run itself).
        const deadline = Date.now() + 45_000;
        let statuses: readonly ObservationStatus[] = [];
        for (;;) {
          const res = (await client.invoke("observation.status", { eventIds } as never)) as unknown as { readonly statuses: readonly ObservationStatus[] };
          statuses = res.statuses;
          if (statuses.every((s) => s.state === "accepted" || s.state === "duplicate")) break;
          if (Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(statuses.length).toBe(eventIds.length);
        const accepted = statuses.filter((s) => s.state === "accepted" || s.state === "duplicate");
        expect(accepted.length).toBe(statuses.length);
        for (const status of accepted) {
          expect(status.observationId).toMatch(/^obs-/);
          expect(typeof status.targetRef).toBe("string");
          expect(status.targetRef).toContain(":");
        }

        // The drill-down reads the SXR record's CEP extensions.cognate back — the correlation
        // ids (runId among them) travelled with the observation.
        const withRef = accepted.find((s) => s.targetRef)!;
        const record = (await client.invoke("observation.record", { targetRef: withRef.targetRef } as never)) as unknown as {
          readonly correlation: { readonly runId?: string; readonly eventId?: string } | null;
        };
        expect(record.correlation).not.toBeNull();
        expect(record.correlation?.eventId).toBe(withRef.eventId);
        expect(typeof record.correlation?.runId).toBe("string");
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 90_000);

  test("without the SXR binary the harness still works: observations stay queued, the trace folds normally", async () => {
    // Point the boot at a nonexistent binary (defaultSxrBin honors SXR_BIN): the app must boot,
    // run the full journey, and report honest queued receipts — never fake deliveries.
    const previousSxrBin = process.env.SXR_BIN;
    process.env.SXR_BIN = "/nonexistent/sxr-realitytrace";
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
        await writeFile(join(ws, "README.md"), "# Fixture project\n\ngreet() helper inside.\n");
        const { workspaceId } = (await client.invoke("workspace.select", { path: ws })) as { readonly workspaceId: string };
        const sessionId = randomUUID();
        const run = await client.startRun(
          "agent.coding",
          { sessionId, workspaceId, message: "[[scenario:aim-tool]] read it" } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` },
        );
        const final = await waitForCompletion(app, run.runId);
        expect(final.status).toBe("completed");

        // The trace (the thing dev tools actually read) is event-sourced and unaffected.
        const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-trace" })).rows;
        const trace = rows.find((r) => r.key === `trace/${sessionId}`)?.value as { readonly turns?: readonly { readonly tools?: readonly unknown[] }[] } | undefined;
        expect(trace?.turns?.[0]?.tools).toHaveLength(1);

        // The receipts are honest: still queued (no SXR target), never faked as delivered.
        const eventIds: string[] = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { correlationId: `session:${sessionId}` })) {
          if (e.eventType === "tool.call.completed" || e.eventType === "message.completed") eventIds.push(e.eventId);
        }
        const res = (await client.invoke("observation.status", { eventIds } as never)) as unknown as { readonly statuses: readonly ObservationStatus[] };
        for (const status of res.statuses) {
          expect(["queued", "retrying"]).toContain(status.state ?? "queued");
        }
      } finally {
        await app.stop();
        await aimock.stop();
        if (previousSxrBin === undefined) delete process.env.SXR_BIN;
        else process.env.SXR_BIN = previousSxrBin;
      }
    });
  }, 30_000);
});
