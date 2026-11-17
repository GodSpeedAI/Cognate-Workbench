// Journey J-CAP-suspend (capability-bundles tranche T3, CUJs 5 and 12): the operator yanks a
// capability with an MCP server running, and the delegated-authority revocation variant.
// Stops are initiated in the commit's own turn by the supervisor's commit listener; new calls are
// refused at committed visibility (each recorded); in-flight calls finish under their snapshot
// (graceful) or are cut at once (emergency); the termination outcome is the ledger's `exited`
// record; `resumed` clears exactly one named reason.
import { describe, expect, test } from "bun:test";
import { sweepExpiredGrants } from "../src/capabilities/authorityGrants.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitUntil, withTempHome, allEvents, wbRows, LOCAL_OPERATOR } from "./wb-helpers.ts";
import { LOCAL_POSTURE, alive, authorStub, eventsOfType, sleep, stubManifest } from "./mcp-helpers.ts";

const CAP = "capability.bundle.suspend-stub";
const CAP2 = "capability.bundle.clamped-stub";
type Out = { ok: boolean; code?: string; reasonCode?: string; result?: { content?: { text: string }[] } };
type Booted = Awaited<ReturnType<typeof bootApp>>;
const decisions = async (app: Booted["app"]) => (await eventsOfType(app, "authority.decision.recorded")).map((e) => e.payload as Record<string, unknown>);
const exits = async (app: Booted["app"]) => (await eventsOfType(app, "capability.mcp.exited")).map((e) => e.payload as Record<string, unknown>);
const invoke = (client: Booted["client"], capabilityId: string, tool: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  client.invoke("tool.capability_invoke", { capabilityId, tool, arguments: args, ...extra } as never) as Promise<Out>;

async function boot(home: string) {
  const booted = await bootApp(home, { executionPostureRecords: [LOCAL_POSTURE], mcpSupervisorTimings: { graceMs: 600, killMs: 400 } });
  await enableCapabilityRuntime(booted.app, booted.client);
  return booted;
}
async function installAndStart(booted: Booted, home: string, capabilityId: string, stop: "graceful" | "emergency" = "graceful") {
  const { app, client } = booted;
  const registered = await registerBundle(app, client, { capabilityId, sourceDir: await authorStub(home, capabilityId.split(".").pop()!), manifest: stubManifest([{ id: "stub", command: ["bun", "${bundleDir}/server.mjs"], stop }]) } as never);
  await client.invoke("capability.bundle.activate", { capabilityId });
  const started = (await client.invoke("capability.mcp.start", { capabilityId, serverId: "stub" })) as { pid: number };
  return { ...registered, pid: started.pid };
}
const activationRow = async (app: Booted["app"], capabilityId: string) => (await wbRows(app)).get(`activation/${capabilityId}/user`) as { state: string; suspensionReasons: string[] } | undefined;

describe("J-CAP-suspend: operator yank (CUJ 5)", () => {
  test("graceful: new calls refused and recorded at once, the in-flight call finishes, the stop is recorded, resume clears exactly the named reason and re-spawns", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app, client } = booted;
      try {
        const { pid } = await installAndStart(booted, home, CAP);
        const inflight = invoke(client, CAP, "mcp.stub.slow", { ms: 300 });
        await sleep(100);
        await client.invoke("capability.bundle.suspend", { capabilityId: CAP, reason: "operator-yank" });

        // New calls are refused at committed visibility, and the refusal is recorded.
        const refused = await invoke(client, CAP, "mcp.stub.echo", { text: "late" });
        expect(refused).toMatchObject({ ok: false, code: "refused", reasonCode: "suspended" });
        expect((await decisions(app)).some((d) => d.reasonCode === "suspended" && d.outcome === "refused" && d.capability === CAP && d.operation === "mcp.stub.echo")).toBe(true);

        // In-flight work finishes under its snapshot.
        const finished = await inflight;
        expect(finished.ok).toBe(true);
        expect(finished.result!.content![0]!.text).toBe("slept 300");

        // The stop follows, and its outcome is recorded per the ledger discipline.
        const exited = await waitUntil("exit record", async () => (await exits(app))[0]);
        expect(exited).toMatchObject({ outcome: "stopped", stopReason: "suspended:operator-yank", termination: "group-kill" });
        await waitUntil("process gone", async () => !alive(pid));
        expect((await activationRow(app, CAP))).toMatchObject({ state: "suspended", suspensionReasons: ["operator-yank"] });

        // Resume clears exactly one NAMED reason; a reason not held is refused (and recorded).
        await expect(client.invoke("capability.bundle.resume", { capabilityId: CAP, clearedReason: "grant-revoked" })).rejects.toThrow(/not suspended for .{1,6}grant-revoked/);
        expect((await decisions(app)).some((d) => d.reasonCode === "reason-not-held" && d.operation === "resume")).toBe(true);
        const resumed = (await client.invoke("capability.bundle.resume", { capabilityId: CAP, clearedReason: "operator-yank" })) as { state: string; respawned: { serverId: string; ok: boolean }[] };
        expect(resumed.state).toBe("active");
        expect(resumed.respawned).toEqual([{ serverId: "stub", ok: true }]);
        const after = await invoke(client, CAP, "mcp.stub.pid", {});
        expect(after.ok).toBe(true);
        expect(Number(after.result!.content![0]!.text)).not.toBe(pid);
        expect((await eventsOfType(app, "capability.mcp.spawn.intended")).length).toBe(2);
        await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("a second reason keeps the row suspended: resumed clears exactly the named one", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app, client } = booted;
      try {
        await installAndStart(booted, home, CAP);
        await client.invoke("capability.bundle.suspend", { capabilityId: CAP, reason: "operator-yank" });
        await client.invoke("capability.bundle.suspend", { capabilityId: CAP, reason: "review-hold" });
        await waitUntil("exit", async () => (await exits(app))[0]);
        const one = (await client.invoke("capability.bundle.resume", { capabilityId: CAP, clearedReason: "operator-yank" })) as { state: string; reasons: string[]; respawned: unknown[] };
        expect(one).toMatchObject({ state: "suspended", reasons: ["review-hold"], respawned: [] });
        expect((await invoke(client, CAP, "mcp.stub.echo", { text: "x" })).reasonCode).toBe("suspended");
        const two = (await client.invoke("capability.bundle.resume", { capabilityId: CAP, clearedReason: "review-hold" })) as { state: string; respawned: { ok: boolean }[] };
        expect(two.state).toBe("active");
        expect(two.respawned.every((r) => r.ok)).toBe(true);
        await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("emergency payload: the stop is a kill in the commit's turn and the in-flight call is cut at once", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app, client } = booted;
      try {
        const { pid } = await installAndStart(booted, home, CAP, "emergency");
        const inflight = invoke(client, CAP, "mcp.stub.slow", { ms: 5000 });
        await sleep(150);
        const t0 = Date.now();
        await client.invoke("capability.bundle.suspend", { capabilityId: CAP });
        const cut = await inflight;
        expect(cut.ok).toBe(false);
        expect(Date.now() - t0).toBeLessThan(2500);
        await waitUntil("process gone", async () => !alive(pid));
        expect((await exits(app))[0]).toMatchObject({ outcome: "stopped", stopReason: "suspended:operator-yank" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("suspend is operator-only and recorded when refused: a nonexistent slot", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await boot(home);
      try {
        await expect(client.invoke("capability.bundle.suspend", { capabilityId: "capability.bundle.nothing" })).rejects.toThrow(/no live activation/);
        await expect(client.invoke("capability.bundle.suspend", { capabilityId: CAP, reason: "Not A Reason!" })).rejects.toThrow(/short lowercase identifier/);
        const codes = (await decisions(app)).filter((d) => d.outcome === "refused").map((d) => d.reasonCode);
        expect(codes).toEqual(expect.arrayContaining(["no-activation", "invalid-reason"]));
      } finally {
        await app.stop();
      }
    });
  }, 60000);
});

describe("J-CAP-suspend: revocation of delegated authority (CUJ 12, j_cap_revoke)", () => {
  async function clampedSetup(booted: Booted, home: string, expiresAt?: string) {
    const { app, client } = booted;
    const operatorOwned = await installAndStart(booted, home, CAP);
    await client.invoke("authority.grant.issue", { grantId: "grant-c", principalId: "wb-agent:c", permissions: ["capability.invoke", "bundle.activate", "mcp.server"], ...(expiresAt ? { expiresAt } : {}) });
    const registered = await registerBundle(app, client, { capabilityId: CAP2, sourceDir: await authorStub(home, "clamped"), manifest: stubManifest() } as never);
    // The agent-established activation is committed through the lifecycle recorder (the agent
    // activation path itself is proven by the T2 suites): clamp provenance names exactly grant-c.
    await new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant).commitBatch(CAP2, [{ type: "capability.activated", payload: { capabilityId: CAP2, level: "user", version: registered.version, ceiling: ["capability.invoke", "mcp.server"], clampProvenance: "grant-c" } }], "test-activate-clamped");
    await waitUntil("clamped activation", async () => activationRow(app, CAP2));
    const started = (await client.invoke("capability.mcp.start", { capabilityId: CAP2, serverId: "stub" })) as { pid: number };
    return { operatorPid: operatorOwned.pid, clampedPid: started.pid };
  }

  test("revoking the grant suspends exactly the activations it clamps in ONE batch with the grant record; their servers stop; operator-established ones are untouched; re-granting does not reactivate", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app, client } = booted;
      try {
        const { operatorPid, clampedPid } = await clampedSetup(booted, home);
        await client.invoke("authority.grant.revoke", { grantId: "grant-c" });

        const events = await allEvents(app);
        const suspended = events.find((e) => e.eventType === "capability.suspended" && (e.payload as { capabilityId: string }).capabilityId === CAP2)!;
        const revoked = events.find((e) => e.eventType === "authority.grant.revoked" && (e.payload as { grantId: string }).grantId === "grant-c")!;
        expect((suspended.payload as { reason: string }).reason).toBe("grant-revoked");
        expect(suspended.correlationId).toBe(revoked.correlationId); // one CAS-atomic batch
        expect(suspended.recordedAt).toBe(revoked.recordedAt);
        expect(events.some((e) => e.eventType === "capability.suspended" && (e.payload as { capabilityId: string }).capabilityId === CAP)).toBe(false);

        // The clamped server stops (recorded); the operator's keeps serving.
        const exited = await waitUntil("clamped exit", async () => (await exits(app)).find((e) => e.capabilityId === CAP2));
        expect(exited).toMatchObject({ outcome: "stopped", stopReason: "suspended:grant-revoked" });
        await waitUntil("clamped process gone", async () => !alive(clampedPid));
        expect(alive(operatorPid)).toBe(true);
        expect((await invoke(client, CAP, "mcp.stub.echo", { text: "operator-ok" })).ok).toBe(true);
        expect((await invoke(client, CAP2, "mcp.stub.echo", { text: "x" })).reasonCode).toBe("suspended");

        // The registry record and provenance persist (suspended, not deleted).
        expect((await wbRows(app)).get(`bundle/${CAP2}`)).toBeDefined();
        expect(await activationRow(app, CAP2)).toMatchObject({ state: "suspended", suspensionReasons: ["grant-revoked"] });

        // Re-granting does not silently reactivate; resumption is an explicit act, and the re-spawn
        // fails closed because the CLAMP grant (immutable, revoked) is gone: adjustment is revoke + reissue.
        await client.invoke("authority.grant.issue", { grantId: "grant-c2", principalId: "wb-agent:c", permissions: ["capability.invoke", "mcp.server"] });
        expect((await activationRow(app, CAP2))!.state).toBe("suspended");
        const resumed = (await client.invoke("capability.bundle.resume", { capabilityId: CAP2, clearedReason: "grant-revoked" })) as { state: string; respawned: { serverId: string; ok: boolean; code?: string }[] };
        expect(resumed.state).toBe("active");
        expect(resumed.respawned).toEqual([{ serverId: "stub", ok: false, code: "clamp-revoked" }]);
        expect((await decisions(app)).some((d) => d.operation === "mcp.start" && d.reasonCode === "clamp-revoked")).toBe(true);
        await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("scheduler expiry records grant-expired and stops the server the same way", async () => {
    await withTempHome(async (home) => {
      const booted = await boot(home);
      const { app } = booted;
      try {
        const { clampedPid } = await clampedSetup(booted, home, "2099-01-01T00:00:00.000Z");
        const index = new AuthorityIndex(app.runtime.store, LOCAL_OPERATOR.tenant);
        // The fold keeps only a grant's id and status (not its principal, permissions or expiry), so the
        // sweep's index is rebuilt with the grant rows completed from what this test issued.
        const rows = [...(await wbRows(app)).entries()].map(([key, value]) => ({ key, value }));
        await index.rebuild(rows.map((r) => r.key === "grant/grant-c" ? { key: r.key, value: { ...(r.value as object), principalId: "wb-agent:c", permissions: ["capability.invoke", "bundle.activate", "mcp.server"], expiresAt: "2099-01-01T00:00:00.000Z" } } : r));
        const recorder = new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant);
        expect(await sweepExpiredGrants(recorder, index, new Date("2100-01-01T00:00:00.000Z"))).toBe(1);
        const exited = await waitUntil("expiry exit", async () => (await exits(app)).find((e) => e.capabilityId === CAP2));
        expect(exited).toMatchObject({ outcome: "stopped", stopReason: "suspended:grant-expired" });
        await waitUntil("process gone", async () => !alive(clampedPid));
        expect(await activationRow(app, CAP2)).toMatchObject({ state: "suspended", suspensionReasons: ["grant-expired"] });
        index.stop();
        await booted.client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);
});
