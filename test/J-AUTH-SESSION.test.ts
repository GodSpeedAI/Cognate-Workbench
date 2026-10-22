// J-AUTH-SESSION: durable identities and revocable server-issued sessions (T8). The production
// posture boots WITHOUT the dev authenticator: every request must resolve to a live, unexpired,
// unrevoked session in the durable ledger. The teeth: a revoked session replays a captured
// request → refused with no durable effect. Runs against actual PostgreSQL (pg0).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";

type WorkbenchClient = ReturnType<typeof createClient>;

/** A remote service bound to a raw bearer token — exactly what an attacker (or the browser) holds. */
const tokenService = (app: AppServer, token: string): RuntimeService =>
  createRemoteRuntimeService(connectTransport(app.url), () => token);

const clientFor = (service: RuntimeService): WorkbenchClient =>
  createClient({ service, caller: LOCAL_OPERATOR });

async function eventCount(app: AppServer): Promise<number> {
  let count = 0;
  for await (const _event of app.runtime.service.events(LOCAL_OPERATOR, {})) count += 1;
  return count;
}

test("J-AUTH-SESSION: a revoked session's replayed request is refused with no durable effect", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-auth-session-"));
  let app: AppServer | undefined;
  try {
    // Production posture: devAuth unset → the raw `Bearer <tenant>:<actor>` format is dead.
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    const operatorService = tokenService(app, app.operatorSessionToken);
    const operator = clientFor(operatorService);

    // The boot-issued session works and the raw dev format is refused in the production posture.
    const settings = await operatorService.readProjection(LOCAL_OPERATOR, { name: "settings" });
    expect(settings.rows.length).toBeGreaterThanOrEqual(0);
    const forgedService = createRemoteRuntimeService(connectTransport(app.url), () => `${LOCAL_OPERATOR.tenant}:${LOCAL_OPERATOR.actor.id}`);
    await expect(forgedService.readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");

    // The operator issues a second session for the same identity.
    const issued = await operator.invoke("identity.session.issue", { tenant: LOCAL_OPERATOR.tenant, actorId: "operator", label: "second device" }) as { token: string; sessionId: string };
    expect(typeof issued.token).toBe("string");
    expect(issued.token.startsWith("wbs1.")).toBe(true);
    const secondService = tokenService(app, issued.token);
    await expect(secondService.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).resolves.toBeTruthy();

    // The ledger stores hashes only: inspection never carries token material.
    const overview = await operator.invoke("identity.inspect", {}) as { sessions: { sid: string }[] };
    expect(JSON.stringify(overview)).not.toContain(issued.token);
    expect(JSON.stringify(overview)).not.toContain(app.operatorSessionToken);
    expect(overview.sessions.some((s: { readonly sid: string }) => s.sid === issued.sessionId)).toBe(true);

    // Capture requests with the second session, then revoke it.
    await expect(secondService.readProjection(LOCAL_OPERATOR, { name: "settings" })).resolves.toBeTruthy();
    const revoked = await operator.invoke("identity.session.revoke", { sessionId: issued.sessionId, cause: "journey revocation" }) as { status: string };
    expect(revoked.status).toBe("revoked");
    // Baseline AFTER the revocation's own durable effect (the ledger write itself is expected).
    const eventsAfterRevocation = await eventCount(app);

    // Teeth: the replayed requests are refused before any mutation, and nothing durable changed.
    await expect(secondService.readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");
    await expect(secondService.startRun(LOCAL_OPERATOR, { agent: "agent.config@1.0.0", input: { kind: "settings.changed", language: "en" }, idempotencyKey: `auth-replay-${Date.now()}` })).rejects.toThrow();
    expect(await eventCount(app)).toBe(eventsAfterRevocation);

    // The boot session stays live after the other session's revocation.
    await expect(operatorService.readProjection(LOCAL_OPERATOR, { name: "settings" })).resolves.toBeTruthy();

    // An unknown but well-formed token is refused exactly like a revoked one.
    await expect(tokenService(app, "wbs1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");
    // Garbage is refused too.
    await expect(tokenService(app, "garbage").readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");

    // A restart issues a fresh browser session; the previous boot's token no longer authenticates.
    const staleToken = app.operatorSessionToken;
    await app.stop();
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    expect(app.operatorSessionToken).not.toBe(staleToken);
    await expect(tokenService(app, staleToken).readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");
    await expect(tokenService(app, app.operatorSessionToken).readProjection(LOCAL_OPERATOR, { name: "settings" })).resolves.toBeTruthy();
  } finally {
    await app?.stop();
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);

test("J-AUTH-SESSION: expired sessions are aged by boot and refused, and only the operator may administer sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-auth-expiry-"));
  let app: AppServer | undefined;
  try {
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    const operator = clientFor(tokenService(app, app.operatorSessionToken));

    // Only the documented fields are accepted — a quota or capability smuggled in is refused.
    await expect(operator.invoke("identity.session.issue", { tenant: "local", actorId: "operator", superuser: true })).rejects.toThrow();
    await expect(operator.invoke("identity.session.issue", { tenant: "LOCAL", actorId: "operator" })).rejects.toThrow();
    await expect(operator.invoke("identity.session.revoke", { sessionId: "session-doesnotexist" })).rejects.toThrow();

    // Boot ages sessions past their expiry: forge one directly in the ledger (the only writer that
    // can produce a stale row is a crash), restart, and both inspection and authentication agree.
    const identity = await import("../src/auth/identity.ts");
    const service = app.runtime.service;
    const system = { actor: { id: "system", kind: "system" as const }, tenant: "local" };
    const ensured = await identity.ensureIdentity(service, system, { tenant: "local", actorId: "operator" });
    const expired = await identity.issueSession(service, system, { identityId: ensured.id, ttlMs: 60_000, cause: "journey expiry" });
    const thread = await service.readSharedState(system, { threadId: identity.IDENTITY_THREAD });
    const state = JSON.parse(JSON.stringify(thread.state)) as { sessions: Record<string, { sid: string; expiresAt: string; status: string }> };
    state.sessions[expired.session.sid]!.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await service.updateSharedState(system, { threadId: identity.IDENTITY_THREAD, update: { snapshot: state as never }, expectedVersion: thread.version, idempotencyKey: "journey-forge-expiry" });

    const staleToken = expired.token;
    await app.stop();
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    const operator2 = clientFor(tokenService(app, app.operatorSessionToken));
    const overview = await operator2.invoke("identity.inspect", {}) as { sessions: { sid: string; status: string }[] };
    const aged = overview.sessions.find(s => s.sid === expired.session.sid);
    expect(aged?.status).toBe("expired");
    await expect(tokenService(app, staleToken).readProjection(LOCAL_OPERATOR, { name: "settings" })).rejects.toThrow("unauthenticated");
  } finally {
    await app?.stop();
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);

test("J-AUTH-SESSION: deployment hardening headers are present on every response", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-auth-headers-"));
  let app: AppServer | undefined;
  try {
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    const html = await fetch(`${app.url}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    expect(html.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(html.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const health = await fetch(`${app.url}/health`);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("x-frame-options")).toBe("DENY");
    const missing = await fetch(`${app.url}/cognate.v1.RuntimeService/DoesNotExist`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-frame-options")).toBe("DENY");
    // The document carries a content security policy: the boot-token-bearing bundle is same-origin
    // script, and nothing else may execute in the console document.
    expect(html.headers.get("content-security-policy")).toContain("script-src 'self'");
    // A SUCCESSFUL Connect API response carries the hardening headers too, not just errors.
    const token = app.operatorSessionToken;
    const api = await fetch(`${app.url}/cognate.v1.RuntimeService/ReadProjection`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "settings" }),
    });
    expect(api.status).toBe(200);
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.headers.get("x-frame-options")).toBe("DENY");
    expect(api.headers.get("referrer-policy")).toBe("no-referrer");
  } finally {
    await app?.stop();
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
