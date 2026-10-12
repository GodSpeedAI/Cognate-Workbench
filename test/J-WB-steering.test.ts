// Journey J-WB-steering (V-004): steering is a permanent execution primitive. "Steer now" changes the
// ACTIVE trajectory at the next step boundary (the next model request contains it, exactly once);
// it does not merely queue future work.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { Inbox } from "../src/workbench/steering.ts";
import { allEvents, bootApp, bootAimock, seed, waitForCompletion, waitForRow, waitUntil, withTempHome, inv } from "./wb-helpers.ts";

describe("J-WB-steering", () => {
  test("V-004: a steer-now message is injected into the running trajectory once; queue-next stays queued", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seed(client, home, aimock.port);
        const sessionId = randomUUID();

        await expect(inv(client, "steer.enqueue", { sessionId, mode: "steer-now", text: "   " })).rejects.toThrow(/text is required/);
        await expect(inv(client, "steer.enqueue", { sessionId, mode: "later", text: "x" })).rejects.toThrow(/mode must be/);

        const { messageId } = (await inv(client, "steer.enqueue", { sessionId, mode: "steer-now", text: "use Howdy not Hi" })) as { messageId: string };
        await inv(client, "steer.enqueue", { sessionId, mode: "queue-next", text: "then write a changelog" });
        // Idempotent by message id: the same id is a no-op.
        await inv(client, "steer.enqueue", { sessionId, mode: "steer-now", text: "use Howdy not Hi", id: messageId });
        const inbox = await waitForRow<Inbox>(app, `inbox/${sessionId}`, (i) => i.nextStep.length === 1 && i.nextTurn.length === 1);
        expect(inbox.nextStep.map((m) => m.text)).toEqual(["use Howdy not Hi"]);

        // The run takes several steps (read, bash, edit); the steer is read at a step boundary.
        const run = await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:multi]] do the task" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
        const finished = await waitForCompletion(app, run.runId);
        expect(finished.status, JSON.stringify((finished as { error?: unknown; output?: unknown }))).toBe("completed");
        // The scripted model answers the steered request, so the final text reflects the steering.
        expect((finished.output as { text?: string }).text).toContain("Steered");

        const events = await allEvents(app);
        // 1. It was consumed exactly once, by the run itself.
        const consumed = events.filter((e) => e.eventType === "workbench.steer.consumed");
        expect(consumed).toHaveLength(1);
        expect((consumed[0]!.payload as { ids: string[] }).ids).toEqual([messageId]);
        // 2. The recorded model requests prove the trajectory changed: a later request carries the steering text, an earlier one does not.
        const modelInputs = events
          .filter((e) => e.runId === run.runId && e.eventType === "run.invocation")
          .map((e) => e.payload as { input?: { messages?: { role: string; content?: string }[] } })
          .filter((p) => Array.isArray(p.input?.messages)); // model.generate is the only invocation whose input carries messages
        const carries = modelInputs.map((p) => (p.input?.messages ?? []).some((m) => m.role === "user" && (m.content ?? "").startsWith("[user steering]") && (m.content ?? "").includes("use Howdy not Hi")));
        expect(carries.length).toBeGreaterThan(1);
        expect(carries[0]).toBe(false);
        expect(carries.slice(1).some(Boolean)).toBe(true);
        // 3. Queue-next was not consumed; it still waits for the next turn.
        const after = await waitUntil("inbox drained of steer", async () => {
          const rows = (await app.runtime.service.readProjection({ actor: { id: "operator", kind: "user" }, tenant: "local" }, { name: "workbench" })).rows;
          const row = rows.find((r) => r.key === `inbox/${sessionId}`)?.value as Inbox | undefined;
          return row && row.nextStep.length === 0 ? row : undefined;
        });
        expect(after.nextTurn.map((m) => m.text)).toEqual(["then write a changelog"]);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 60_000);

  test("V-004: a steer written to the run's shared state (the live-run channel) is consumed at the next step boundary", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seed(client, home, aimock.port);
        const sessionId = randomUUID();
        // Seeded caller-sourced state is exactly what `updateState` produces for a live run; the agent reads it as a recorded step.
        const run = await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:multi]] do the task" } as never, {
          idempotencyKey: randomUUID(), correlationId: `session:${sessionId}`, state: { steer: [{ id: "live-1", text: "use Howdy not Hi" }] } as never,
        });
        const finished = await waitForCompletion(app, run.runId);
        expect(finished.status).toBe("completed");
        expect((finished.output as { text?: string }).text).toContain("Steered");
        const events = await allEvents(app);
        const consumed = events.filter((e) => e.eventType === "workbench.steer.consumed");
        expect(consumed).toHaveLength(1);
        expect((consumed[0]!.payload as { ids: string[] }).ids).toEqual(["live-1"]);
        const carries = events
          .filter((e) => e.runId === run.runId && e.eventType === "run.invocation")
          .map((e) => e.payload as { input?: { messages?: { role: string; content?: string }[] } })
          .filter((p) => Array.isArray(p.input?.messages))
          .map((p) => (p.input?.messages ?? []).some((m) => (m.content ?? "").startsWith("[user steering]") && (m.content ?? "").includes("use Howdy not Hi")));
        expect(carries[0]).toBe(false); // the first request predates the step boundary
        expect(carries.slice(1).some(Boolean)).toBe(true);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 60_000);
});
