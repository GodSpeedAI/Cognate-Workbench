// Journey J-HARNESS-session, remote variant: a turn sent from the paired phone to a Session bound to
// an external harness CLI starts `agent.harness` (never the native coding agent); a turn already in
// progress is refused with a readable reason rather than steered; a phone may answer the CLI's
// permission request (an ordinary tool-approval decision).
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { MobileRemote, REMOTE_COOKIE, REMOTE_SESSION_TTL_MS } from "../src/remote/mobile.ts";
import { mutateRemoteState, type RemoteDevice } from "../src/remote/state.ts";
import { ensureIdentity, issueSession } from "../src/auth/identity.ts";
import { bootHarnessApp, makeFakeHost, newSession, openApproval, runEvents, waitRun } from "./harness-helpers.ts";
import { withTempHome } from "./helpers.ts";

const SYSTEM = { tenant: "local", actor: { id: "system", kind: "system" } } as const;

describe("J-HARNESS-session remote variant", () => {
  test("a phone turn on a harness-bound session starts agent.harness; a second turn mid-run is refused; the phone approves the CLI's permission request", async () => {
    const host = await makeFakeHost();
    await withTempHome(async (home) => {
      const { app, client } = await bootHarnessApp(home, host);
      const service = app.runtime.service;
      const identity = await ensureIdentity(service, SYSTEM, { tenant: "local", actorId: "operator" });
      const remote = new MobileRemote({ service, system: SYSTEM, operatorIdentityId: identity.id, assets: async () => ({ js: "", css: "" }) } as never, { port: 0 });
      try {
        await remote.start();
        const { sessionId, workspaceId } = await newSession(app, client, host.workspace);
        await client.invoke("session.harness.bind", { sessionId, harnessId: "claude", permissionMode: "ask" } as never);
        await app.runtime.idle();

        const issued = await issueSession(service, SYSTEM, { identityId: identity.id, ttlMs: REMOTE_SESSION_TTL_MS, cause: "test" });
        await mutateRemoteState(service, SYSTEM, (draft) => {
          const record: RemoteDevice = { id: "device-1", label: "Phone", credentialId: "cred", publicKey: "", signCount: 0, generation: remote.pairing.generation, sid: issued.session.sid, pairedAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null };
          draft.devices[record.id] = record;
        });
        const port = (remote as unknown as { port: number }).port;
        const origin = (remote as unknown as { origin: string }).origin;
        const post = (path: string, body: unknown) => remote.handle(new Request(`http://localhost:${port}/m/api/${path}`, {
          method: "POST",
          headers: { host: `localhost:${port}`, origin, "content-type": "application/json", cookie: `${REMOTE_COOKIE}=${issued.token}` },
          body: JSON.stringify(body),
        }));

        const first = await post(`sessions/${sessionId}/turns`, { commandId: randomUUID(), text: "please ask then edit hello.txt" });
        expect(first.status).toBe(200);
        const outcome = (await first.json()) as { kind: string; runId: string };
        expect(outcome.kind).toBe("run");
        const run = await service.getRun(LOCAL_OPERATOR, { runId: outcome.runId });
        expect(run.agent).toBe("agent.harness");
        expect(run.correlationId).toBe(`session:${sessionId}`);

        const approval = await openApproval(app, outcome.runId);
        await waitRun(app, outcome.runId, ["waiting"]);

        const busy = await post(`sessions/${sessionId}/turns`, { commandId: randomUUID(), text: "and also this" });
        expect(busy.status).toBe(409);
        const refusal = (await busy.json()) as { error: string; message: string };
        expect(refusal.error).toBe("harness-busy");
        expect(refusal.message).toMatch(/external harness/);

        const decided = await post(`continuations/${approval.id}/resolve`, { commandId: randomUUID(), approved: true });
        expect(decided.status).toBe(200);
        const finished = await waitRun(app, outcome.runId);
        expect(finished.status).toBe("completed");
        const types = (await runEvents(app, outcome.runId)).map((e) => e.eventType);
        expect(types).toContain("tool.call.completed");
        // No native agent run was started for this session.
        const native = (await service.listRuns(LOCAL_OPERATOR, { agent: "agent.coding" })).filter((r) => r.correlationId === `session:${sessionId}`);
        expect(native.length).toBe(0);
        void workspaceId;
      } finally {
        await remote.stop();
        await app.stop();
      }
    });
  }, 60000);
});
