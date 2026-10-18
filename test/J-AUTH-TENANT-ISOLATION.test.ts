// J-AUTH-TENANT-ISOLATION (T8): one shared PostgreSQL store, two tenants, sessions the server
// issued for each. Every caller's tenant is a durable server-side fact — the client can claim any
// tenant string it likes; the authenticated caller never changes. Cross-tenant observation is
// refused by construction AND observed end to end: projections are prefix-partitioned, runs and
// artifacts are tenant-filtered, event streams are per-tenant, and an empty foreign partition is
// indistinguishable from an absent one.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { AGENT_CONFIG } from "../src/agents/agentConfig.ts";
import { randomUUID } from "node:crypto";

type WorkbenchClient = ReturnType<typeof createClient>;
const callerFor = (tenant: string, actorId: string) => ({ tenant, actor: { id: actorId, kind: "user" as const } });
const tokenService = (app: AppServer, token: string): RuntimeService =>
  createRemoteRuntimeService(connectTransport(app.url), () => token);

test("J-AUTH-TENANT-ISOLATION: a second tenant's session sees only its own partition on one shared store", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-auth-tenants-"));
  let app: AppServer | undefined;
  try {
    app = await startServer({ port: 0, home });
    const operatorService = tokenService(app, app.operatorSessionToken);
    const operator = createClient({ service: operatorService, caller: LOCAL_OPERATOR });

    // Durable local-tenant state to isolate against: one committed configuration run folds a
    // settings row under the local prefix, and its run/events belong to the local tenant.
    const localRun = await operatorService.startRun(LOCAL_OPERATOR, {
      agent: AGENT_CONFIG,
      input: { kind: "settings.changed", language: "en" } as never,
      idempotencyKey: `tenant-isolation-${randomUUID()}`,
    });
    for (let i = 0; i < 400; i++) {
      const run = await operatorService.getRun(LOCAL_OPERATOR, { runId: localRun.runId });
      if (run.status === "completed") break;
      await new Promise((r) => setTimeout(r, 15));
    }

    // The operator provisions an identity in a second tenant and issues its session.
    const acme = await operator.invoke("identity.session.issue", { tenant: "acme", actorId: "bob", label: "second tenant" }) as { token: string; tenant: string; sessionId: string };
    expect(acme.tenant).toBe("acme");
    const acmeService = tokenService(app, acme.token);
    const acmeClient = createClient({ service: acmeService, caller: callerFor("acme", "bob") });

    // Projections: the acme caller sees its own (empty) partition; the local row is invisible.
    const localSettings = await operatorService.readProjection(LOCAL_OPERATOR, { name: "settings" });
    expect(localSettings.rows.some(row => row.key === "current" || row.key.endsWith("/current"))).toBe(true);
    const acmeSettings = await acmeService.readProjection(callerFor("acme", "bob"), { name: "settings" });
    expect(acmeSettings.rows.length).toBe(0);

    // Runs: tenant-filtered. The acme caller cannot list or read the local tenant's run.
    const acmeRuns = await acmeService.listRuns(callerFor("acme", "bob"), {});
    expect(acmeRuns.length).toBe(0);
    const localRuns = await operatorService.listRuns(LOCAL_OPERATOR, {});
    expect(localRuns.some(run => run.runId === localRun.runId)).toBe(true);
    await expect(acmeService.getRun(callerFor("acme", "bob"), { runId: localRun.runId })).rejects.toThrow("not found");

    // Events: per-tenant streams. The acme caller's stream does not contain the local run's events.
    let acmeEventCount = 0;
    for await (const _event of acmeService.events(callerFor("acme", "bob"), {})) acmeEventCount += 1;
    expect(acmeEventCount).toBe(0);

    // Thread state: per-tenant streams (the operator's billing ledger is invisible to acme).
    const acmeThread = await acmeService.readSharedState(callerFor("acme", "bob"), { threadId: "experts:billing:v1" });
    expect(acmeThread.version).toBe(0);

    // The tenant cannot be chosen by the client: the acme session claiming "local" still resolves
    // to the acme identity server-side, so it sees acme's empty partition — never local's data.
    const acmeClaimingLocal = await acmeService.readProjection(LOCAL_OPERATOR, { name: "settings" });
    expect(acmeClaimingLocal.rows.length).toBe(0);

    // A client-supplied dev-format tenant claim is refused outright in the production posture.
    const forged = createRemoteRuntimeService(connectTransport(app.url), () => "acme:bob");
    await expect(forged.readProjection(callerFor("acme", "bob"), { name: "settings" })).rejects.toThrow("unauthenticated");

    // The acme session CAN write its own partition (its tenant's projection key space).
    const acmeRun = await acmeService.startRun(callerFor("acme", "bob"), {
      agent: AGENT_CONFIG,
      input: { kind: "settings.changed", language: "zh" } as never,
      idempotencyKey: `acme-own-${randomUUID()}`,
    });
    expect(acmeRun.runId).toBeTruthy();
    for (let i = 0; i < 400; i++) {
      const run = await acmeService.getRun(callerFor("acme", "bob"), { runId: acmeRun.runId });
      if (run.status === "completed") break;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`acme own-partition run ended ${run.status}`);
      await new Promise((r) => setTimeout(r, 15));
    }
    const acmeSettingsAfter = await acmeService.readProjection(callerFor("acme", "bob"), { name: "settings" });
    expect(acmeSettingsAfter.rows.some(row => row.key === "current" || row.key.endsWith("/current"))).toBe(true);
    // ...and the local partition is unchanged by acme's write.
    const localSettingsAfter = await operatorService.readProjection(LOCAL_OPERATOR, { name: "settings" });
    expect(localSettingsAfter.rows.find(row => row.key === "current" || row.key.endsWith("/current"))?.value)
      .not.toHaveProperty("language", "zh");

    // Session administration stays an operator capability: the acme identity cannot issue or
    // revoke sessions, and the local operator's inspect shows both tenants' identities.
    await expect(acmeClient.invoke("identity.session.issue", { tenant: "acme", actorId: "mallory" })).rejects.toThrow();
    // The operator tenant has exactly one human: a session for a second actor inside it would
    // write settings (containment quotas included) into the operator's own partition.
    await expect(operator.invoke("identity.session.issue", { tenant: LOCAL_OPERATOR.tenant, actorId: "intruder" })).rejects.toThrow("exactly one human");
    // A provisioned session cannot write the identity or containment ledgers directly: the
    // threads are system-owned (a forged operator session or a hand-freed slot is refused).
    await expect(acmeService.updateSharedState(callerFor("acme", "bob"), { threadId: "auth:identity:v1", update: { snapshot: { schema: 1, identities: {}, sessions: {} } }, expectedVersion: 0, idempotencyKey: "forge-1" })).rejects.toThrow("system-owned");
    await expect(acmeService.updateSharedState(callerFor("acme", "bob"), { threadId: "containment:aggregate:v1", update: { snapshot: { schema: 1, executions: {} } }, expectedVersion: 0, idempotencyKey: "forge-2" })).rejects.toThrow("system-owned");
    // ...and cannot read the raw identity ledger (token hashes live there); inspect is sanitized.
    await expect(acmeService.readSharedState(callerFor("acme", "bob"), { threadId: "auth:identity:v1" })).rejects.toThrow("system-owned");
    // A settings event with an invalid field never becomes durable, whatever path started the
    // run: the recording agent validates like the capabilities do, so the run fails.
    const invalidRun = await acmeService.startRun(callerFor("acme", "bob"), {
      agent: AGENT_CONFIG,
      input: { kind: "settings.changed", containment: { maxConcurrent: 0.5 } } as never,
      idempotencyKey: `acme-invalid-${randomUUID()}`,
    });
    for (let i = 0; i < 400; i++) {
      const run = await acmeService.getRun(callerFor("acme", "bob"), { runId: invalidRun.runId });
      if (run.status === "failed") break;
      if (run.status === "completed") throw new Error("an invalid settings patch became durable");
      await new Promise((r) => setTimeout(r, 15));
    }
    const acmeSettingsFinal = await acmeService.readProjection(callerFor("acme", "bob"), { name: "settings" });
    const finalRow = acmeSettingsFinal.rows.find(row => row.key === "current" || row.key.endsWith("/current"))?.value as { containment?: unknown } | undefined;
    expect(finalRow?.containment).toBeUndefined();
    await expect(acmeClient.invoke("identity.session.revoke", { sessionId: "session-x" })).rejects.toThrow();
    const overview = await operator.invoke("identity.inspect", {}) as { identities: { tenant: string }[] };
    expect(overview.identities.some((i: { readonly tenant: string }) => i.tenant === "acme")).toBe(true);
  } finally {
    await app?.stop();
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);
