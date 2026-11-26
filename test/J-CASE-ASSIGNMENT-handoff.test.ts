// J-CASE-ASSIGNMENT-handoff (WP-23): the operator hands an approved case assignment to a session
// through the real server, the real capabilities and the real policy, identified by the boot's
// server-issued session (the production posture: no dev token). Invariants, asserted on observable
// evidence (runs, events, projections):
//  H1 a hand-off opens exactly one run, bound to the approved Brief, Budget and link, in the session
//  H2 a repeated hand-off resolves to that same run (one run per assignment id)
//  H3 the session's binding is a recorded event the projection folds
//  H4 the approved inputs come from the host's hand-off source, never from the request
//  H5 with no source the control is unavailable and a hand-off is refused
//  H6 only the operator hands off and drives an assignment; an agent can do neither
//  H7 interrupt keeps the assignment id, and resume continues the same run
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { Json } from "@godspeedai/cognate-events";
import type { AssignmentView, Caller } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { approvedGateG3, approvedSlowGate, GATE_G3_ASSIGNMENT_ID, SLOW_GATE_ASSIGNMENT_ID, standInHandoffSource } from "./handoff-fixture.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { inv, seed, seedWorkspaceOnly, waitUntil } from "./wb-helpers.ts";

type Handed = { readonly runId: string; readonly sessionId: string; readonly assignmentId: string };

/** A client authenticating with the boot's server-issued operator session. */
function sessionClient(app: AppServer) {
  const service = createRemoteRuntimeService(connectTransport(app.url), () => app.operatorSessionToken);
  return createClient({ service, caller: LOCAL_OPERATOR });
}

/** The session agent's runs only: the system's `agent.config` recorder runs are not handed-off work. */
const conversationRuns = <T extends { readonly agent: string }>(runs: readonly T[]): T[] => runs.filter((r) => r.agent === "agent.coding");

/** Cognate's runtime appends an operator's control to the run's own stream and retries a lost race
 *  five times without pausing, so a control issued while the run streams can be refused for
 *  contention (Cognate DEBT-033). A person clicks again; so does this, and only for that refusal:
 *  every other failure propagates. */
async function amidStreaming<T>(control: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await control();
    } catch (error) {
      if (attempt >= 20 || !/too much contention/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}

const terminal = (app: AppServer, runId: string) =>
  waitUntil(`run ${runId} to settle`, async () => {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    return run.status === "running" ? undefined : run;
  }, 30_000);

describe("J-CASE-ASSIGNMENT-handoff", () => {
  test("H1 H2 H3 H4 H6 H7: one bound run per approved assignment, a folded session binding, and controls only the operator holds", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const approved = approvedGateG3();
      const slow = approvedSlowGate();
      const app = await startServer({ executionPosture: "uncontained-local", port: 0, home, handoffSource: standInHandoffSource([approved, slow]) });
      const client = sessionClient(app);
      const agent: Caller = { actor: { id: "wb-agent:x", kind: "agent" }, tenant: "local" };
      try {
        const { workspaceId } = await seed(client, home, aimock.port);
        const newSession = async () => (await inv(client, "session.create", { workspaceId, requestId: randomUUID() })) as unknown as { sessionId: string };
        const { sessionId } = await newSession();

        // H4: the read hands the UI the approved Brief and Budget; a request that carries its own is refused.
        expect(await inv(client, "session.caseAssignment.candidates", {})).toEqual({
          available: true,
          candidates: [{ id: approved.id, assignment: approved.assignment }, { id: slow.id, assignment: slow.assignment }],
        } as unknown as Json);
        await expect(inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: approved.id, assignment: approved.assignment })).rejects.toThrow(/the request carries .*assignment/);

        // H1: the hand-off opens the session's run, bound to the approved assignment.
        const handed = (await inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: approved.id })) as unknown as Handed;
        expect(handed).toMatchObject({ sessionId, assignmentId: GATE_G3_ASSIGNMENT_ID });
        const run = await terminal(app, handed.runId);
        expect(run.status).toBe("completed");
        expect(run.agent).toBe("agent.coding");
        // The operator opened it, exactly as the composer's send would have.
        expect(run.startedBy).toBe(LOCAL_OPERATOR.actor.id);
        const view = (await inv(client, "assignment.view", { runId: handed.runId })) as unknown as AssignmentView;
        expect(view.assignment).toEqual(approved.assignment);
        expect(view.linkExpiresAt).toBe(approved.linkExpiresAt);
        expect(view.status).toBe("completed");
        expect(view.events.map((e) => e.event)).toEqual(["issued", "started", "completed"]);

        // H3: the binding is the handed-off run's own start — its `run.started` carries the session,
        // the run and the assignment — folded into one row. Nothing else is recorded for it.
        const binding = await waitUntil("the session's assignment binding", async () => {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "session-assignment-bindings" })).rows;
          // A served row's key is the bare session id (the tenant prefix is not served).
          const row = rows.find((r) => r.key.slice(r.key.indexOf("/") + 1) === sessionId)?.value as { assignmentId: string; runId: string } | undefined;
          return row?.runId === handed.runId ? row : undefined;
        });
        expect(binding.assignmentId).toBe(GATE_G3_ASSIGNMENT_ID);
        const start = await (async () => {
          for await (const event of app.runtime.service.events(LOCAL_OPERATOR, { runId: handed.runId })) {
            if (event.eventType === "run.started") return event;
          }
          throw new Error("the handed-off run has no run.started event");
        })();
        expect(start.correlationId).toBe(`session:${sessionId}`);
        expect((start.metadata as { assignment?: { assignment_id?: string } }).assignment?.assignment_id).toBe(GATE_G3_ASSIGNMENT_ID);

        // H2: handing the same assignment off again is the same run, never a second one.
        const again = (await inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: approved.id })) as unknown as Handed;
        expect(again.runId).toBe(handed.runId);
        expect(conversationRuns(await app.runtime.service.listRuns(LOCAL_OPERATOR, {})).map((r) => r.runId)).toEqual([handed.runId]);

        // A settled assignment is closed: it accepts no further spend.
        await expect(inv(client, "assignment.spend", { runId: handed.runId, currency: "money", amount: 1, token: "too-late" })).rejects.toThrow(/ASSIGNMENT_TRANSITION_INVALID/);

        // H6 + H7: on the slow assignment, the operator reports spend while the run is live (a
        // retried click with the same token is not a second event), interrupt keeps the id, and
        // resume continues the same run.
        const second = await newSession();
        const slowHanded = (await inv(client, "session.caseAssignment.handoff", { sessionId: second.sessionId, candidateId: slow.id })) as unknown as Handed;
        const spend = { runId: slowHanded.runId, currency: "money", amount: 4, token: "spend-once" };
        const spent = await amidStreaming(() => inv(client, "assignment.spend", spend));
        expect((spent as unknown as AssignmentView).spend.find((s) => s.currency === "money")?.spent).toBe(4);
        expect(await inv(client, "assignment.spend", spend)).toEqual(spent);
        // The interrupt lands while the model call is streaming (as the browser journey's does), so the step's
        // outcome is unknown and the resumed run waits for the operator rather than finishing by timing alone.
        await waitUntil("the slow run's model call to start streaming", async () => {
          for await (const event of app.runtime.service.events(LOCAL_OPERATOR, { runId: slowHanded.runId })) {
            if (event.eventType === "run.invocation.progress") return true;
          }
          return undefined;
        });
        const paused = (await amidStreaming(() => inv(client, "assignment.interrupt", { runId: slowHanded.runId, reason: "operator pause", token: "pause-once" }))) as unknown as AssignmentView;
        expect(paused.status).toBe("interrupted");
        const resumed = (await inv(client, "assignment.resume", { runId: slowHanded.runId, token: "resume-once" })) as unknown as AssignmentView;
        expect(resumed.status).toBe("resumed");
        expect(resumed.assignment.assignment_id).toBe(SLOW_GATE_ASSIGNMENT_ID);
        // Only the operator can record what the interrupted step did; a model call cannot be reconstructed, so the
        // one honest outcome is `failed`, which lets the agent retry it (the same resolution the browser records).
        const ambiguous = await waitUntil("the interrupted step to wait for reconciliation", async () =>
          (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: slowHanded.runId })).find((c) => c.type === "ambiguous-invocation" && c.status === "OPEN"));
        await expect(inv(client, "run.invocation.reconcile", { continuationId: ambiguous.id, outcome: "failed", reason: "The answer stopped mid-stream when the operator interrupted; no tool ran." })).resolves.toMatchObject({ runId: slowHanded.runId, outcome: "failed" });
        const settled = await waitUntil(`run ${slowHanded.runId} to complete after reconciliation`, async () => {
          const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: slowHanded.runId });
          return run.status === "running" || run.status === "waiting" ? undefined : run;
        }, 30_000);
        expect(settled.runId).toBe(slowHanded.runId);
        expect(settled.status).toBe("completed");

        // H6: an agent can neither hand off nor drive an assignment, at the capability or the runtime.
        await expect(app.runtime.service.invoke(agent, { capability: "session.caseAssignment.handoff", input: { sessionId, candidateId: approved.id } })).rejects.toThrow();
        await expect(app.runtime.service.invoke(agent, { capability: "assignment.interrupt", input: { runId: handed.runId, reason: "x", token: "t" } })).rejects.toThrow();
        await expect(app.runtime.assignments.interruptAssignment(agent, { runId: handed.runId, reason: "x", idempotencyKey: "agent-attempt" })).rejects.toThrow(/may not assignment\.interrupt/);
        expect(conversationRuns(await app.runtime.service.listRuns(LOCAL_OPERATOR, {})).length).toBe(2);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 90_000);

  test("H5: with no hand-off source the control is unavailable and a hand-off is refused", async () => {
    await withTempHome(async (home) => {
      const app = await startServer({ executionPosture: "uncontained-local", port: 0, home, handoffSource: null });
      const client = sessionClient(app);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const { sessionId } = (await inv(client, "session.create", { workspaceId, requestId: randomUUID() })) as { sessionId: string };
        expect(await inv(client, "session.caseAssignment.candidates", {})).toEqual({ available: false, candidates: [] });
        await expect(inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: "candidate:gate-g3" })).rejects.toThrow(/offers no case assignments/);
        expect(conversationRuns(await app.runtime.service.listRuns(LOCAL_OPERATOR, {}))).toEqual([]);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("a candidate the source no longer offers, and an unknown session, are refused and start nothing", async () => {
    await withTempHome(async (home) => {
      const approved = approvedGateG3();
      const source = standInHandoffSource([approved]);
      const app = await startServer({ executionPosture: "uncontained-local", port: 0, home, handoffSource: source });
      const client = sessionClient(app);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const { sessionId } = (await inv(client, "session.create", { workspaceId, requestId: randomUUID() })) as { sessionId: string };
        await expect(inv(client, "session.caseAssignment.handoff", { sessionId: "session-unknown", candidateId: approved.id })).rejects.toThrow(/unknown session session-unknown/);
        source.withdraw(approved.id);
        await expect(inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: approved.id })).rejects.toThrow(/no longer offered/);
        await expect(inv(client, "session.caseAssignment.handoff", { sessionId, candidateId: "candidate:never-offered" })).rejects.toThrow(/no longer offered/);
        expect(await inv(client, "session.caseAssignment.candidates", {})).toEqual({ available: true, candidates: [] });
        expect(conversationRuns(await app.runtime.service.listRuns(LOCAL_OPERATOR, {}))).toEqual([]);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
