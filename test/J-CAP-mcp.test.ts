// Journey J-CAP-mcp (capability-bundles tranche T3, CUJ 3): an MCP server declared by a bundle is
// spawned only through the governed spawn boundary — containment matrix, record-before-spawn,
// secrets env-only, long-lease slots — and driven through the dispatcher with recorded invocations.
// The provider-parameterized part (local / SSH / WSL) asserts the matrix and the honest refusal for
// worlds whose framework process port exposes no stream (see execSpawn.ts).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localExecutionWorld, createExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { acquireLongLeaseSlot, releaseLongLeaseSlot, ContainmentQuotaError } from "../src/capabilities/aggregateContainment.ts";
import { decideContainment, reconcileSpawnLedger, spawnGoverned, worldMatrix, type LedgerEvent, type PostureRecord, type SpawnDeps, type SpawnRequest } from "../src/capabilities/execSpawn.ts";
import { createMcpSupervisor } from "../src/capabilities/mcpManage.ts";
import { MCP_LIMITS, utf8Bytes } from "../src/mcp/client.ts";
import { authorizeCapabilityOp } from "../src/workbench/authoritySelection.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, SYSTEM, waitUntil, withTempHome, allEvents, wbRows } from "./wb-helpers.ts";
import { LOCAL_POSTURE, alive, authorStub, eventsOfType, sleep, stubManifest } from "./mcp-helpers.ts";

const CAP = "capability.bundle.mcp-stub";
const FAST = { graceMs: 400, killMs: 400 };
type Invoked = { ok: boolean; code?: string; result?: { content?: { text: string }[]; tools?: unknown[]; mcpTools?: { id: string; source: string }[]; mcpServers?: { serverId: string; state: string }[] }; message?: string };
const decisions = async (app: Parameters<typeof allEvents>[0]) => (await eventsOfType(app, "authority.decision.recorded")).map((e) => e.payload as Record<string, unknown>);

async function boot(home: string, records: PostureRecord[] = [LOCAL_POSTURE]) {
  const booted = await bootApp(home, { executionPostureRecords: records, mcpSupervisorTimings: FAST });
  await enableCapabilityRuntime(booted.app, booted.client);
  return booted;
}
async function install(app: Awaited<ReturnType<typeof boot>>["app"], client: Awaited<ReturnType<typeof boot>>["client"], home: string, servers?: Record<string, unknown>[], capabilityId = CAP) {
  const registered = await registerBundle(app, client, { capabilityId, sourceDir: await authorStub(home, capabilityId.split(".").pop()!), manifest: stubManifest(servers) });
  await client.invoke("capability.bundle.activate", { capabilityId });
  return registered;
}

describe("J-CAP-mcp: provider containment matrix (CUJ 3, parameterized)", () => {
  const probes = { prlimitVerified: false };
  test("each provider kind enforces exactly what the design's matrix says", () => {
    expect(worldMatrix("linux-bubblewrap", { prlimitVerified: true })).toMatchObject({ network: "enforced", caps: "enforced", termination: "enforced", subprocess: "not-enforced" });
    expect(worldMatrix("linux-bubblewrap", probes)?.caps).toBe("not-enforced");
    expect(worldMatrix("local", probes)).toMatchObject({ network: "not-enforced", caps: "not-enforced", termination: "enforced" });
    expect(worldMatrix("ssh", probes)?.termination).toBe("not-enforced");
    expect(worldMatrix("wsl", probes)?.termination).toBe("partial");
    expect(worldMatrix("sandbox-fork", probes)).toBeUndefined();
  });

  test("refusal is the default: no posture record, an inaccurate one, an unexplained one, an unknown kind", () => {
    const world = (kind: string) => ({ kind, worldId: `w-${kind}` });
    const none = decideContainment(world("local"), {}, undefined, probes);
    expect(none).toMatchObject({ ok: false, code: "unenforceable:network" });
    const inaccurate = decideContainment(world("ssh"), {}, { worldId: "w-ssh", authorizes: { network: { level: "enforced", note: "trust me" } } }, probes);
    expect(inaccurate).toMatchObject({ ok: false, code: "posture-inaccurate", coreViolation: true });
    const unexplained = decideContainment(world("local"), {}, { worldId: "w-local", authorizes: { network: { level: "not-enforced", note: " " } } }, probes);
    expect(unexplained).toMatchObject({ ok: false, code: "posture-unexplained" });
    expect(decideContainment(world("sandbox-fork"), {}, undefined, probes)).toMatchObject({ ok: false, code: "posture-unknown" });
    // The contained posture denies the network totally: a declared outbound scope cannot be satisfied there.
    expect(decideContainment(world("linux-bubblewrap"), { network: { outbound: ["api.example.com:443"] } }, undefined, { prlimitVerified: true })).toMatchObject({ ok: false, code: "network-scope-unsatisfiable" });
    // Caps are required only when declared; unverified prlimit refuses them.
    expect(decideContainment(world("linux-bubblewrap"), { caps: { memoryBytes: 1 << 28 }, subprocess: true }, undefined, probes)).toMatchObject({ ok: false, code: "unenforceable:caps" });
  });

  test("an honest posture record admits the weaker posture and names what was relaxed", () => {
    const ok = decideContainment({ kind: "local", worldId: "local" }, {}, LOCAL_POSTURE, probes);
    expect(ok.ok && ok.relaxed.map((r) => r.restriction).sort()).toEqual(["network", "subprocess"]);
    const ssh = decideContainment({ kind: "ssh", worldId: "s" }, {}, { worldId: "s", authorizes: { network: { level: "not-enforced", note: "n" }, subprocess: { level: "not-enforced", note: "s" }, termination: { level: "not-enforced", note: "termination: best-effort channel close" } } }, probes);
    expect(ssh).toMatchObject({ ok: true, termination: "not-enforced" });
  });

  for (const kind of ["ssh", "wsl"] as const) {
    test(`${kind}: matrix passes under an honest record, then the spawn refuses (no stream port) and records it; nothing runs`, async () => {
      const ledger: LedgerEvent[] = [];
      const refusals: string[] = [];
      const base = localExecutionWorld({ worldId: `w-${kind}` });
      const registry = createExecutionWorldRegistry([{ ...base, kind } as never]);
      const posture: PostureRecord = { worldId: `w-${kind}`, authorizes: { network: { level: "not-enforced", note: "n" }, subprocess: { level: "not-enforced", note: "s" }, termination: { level: kind === "wsl" ? "partial" : "not-enforced", note: "t" } } };
      const result = await spawnGoverned(deps({ registry, ledger, refusals, posture }), request({ worldId: `w-${kind}` }));
      expect(result).toMatchObject({ ok: false, code: "stream-port-unavailable" });
      expect(refusals).toEqual(["stream-port-unavailable"]);
      expect(ledger.length).toBe(0);
    });
    test(`${kind}: without a posture record the unenforceable restriction refuses first`, async () => {
      const refusals: string[] = [];
      const registry = createExecutionWorldRegistry([{ ...localExecutionWorld({ worldId: `x-${kind}` }), kind } as never]);
      const result = await spawnGoverned(deps({ registry, ledger: [], refusals, posture: null }), request({ worldId: `x-${kind}` }));
      expect(result).toMatchObject({ ok: false, code: "unenforceable:network" });
      expect(refusals).toEqual(["unenforceable:network"]);
    });
  }

  test("an unavailable world refuses and is recorded", async () => {
    const refusals: string[] = [];
    const result = await spawnGoverned(deps({ registry: createExecutionWorldRegistry([]), ledger: [], refusals }), request({ worldId: "gone" }));
    expect(result).toMatchObject({ ok: false, code: "world-unavailable" });
    expect(refusals).toEqual(["world-unavailable"]);
  });
});

// ---- helpers for the unit-level spawn tests --------------------------------------------------
function request(over: Partial<SpawnRequest> = {}): SpawnRequest {
  return { capabilityId: CAP, version: "v1", serverId: "stub", worldId: "local", argv: ["true"], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful", ...over };
}
function deps(o: { registry?: SpawnDeps["registry"]; ledger: LedgerEvent[]; refusals?: string[]; posture?: PostureRecord | null; secrets?: Record<string, string>; onIntent?: () => void | Promise<void>; failIntent?: boolean; slots?: SpawnDeps["slots"]; localAllowed?: boolean }): SpawnDeps {
  return {
    registry: o.registry ?? createExecutionWorldRegistry([localExecutionWorld()]),
    getPosture: () => (o.posture === null ? undefined : o.posture ?? LOCAL_POSTURE),
    resolveSecret: async (key) => o.secrets?.[key],
    ledger: async (_id, events) => {
      if (events[0]?.type === "capability.mcp.spawn.intended") {
        await o.onIntent?.();
        if (o.failIntent) throw new Error("ledger unavailable");
      }
      o.ledger.push(...events);
    },
    recordRefusal: async (_req, code) => { o.refusals?.push(code); },
    slots: o.slots ?? { acquire: async () => ({ slotId: "slot-1" }), release: async () => {} },
    localHostSpawnAllowed: () => o.localAllowed ?? true,
    beforeIntent: async () => undefined,
    graceMs: 200, killMs: 200,
  };
}

describe("J-CAP-mcp: record-before-spawn, secrets, slots, sweep (CUJ 3)", () => {
  test("the intent is committed before the process starts; a failing ledger spawns nothing", async () => {
    await withTempHome(async (home) => {
      const marker = join(home, "started");
      const argv = ["sh", "-c", `touch ${marker}; sleep 0.2`];
      const events: LedgerEvent[] = [];
      let markerAtIntent = true;
      const ok = await spawnGoverned(deps({ ledger: events, onIntent: async () => { markerAtIntent = await access(marker).then(() => true, () => false); } }), request({ argv, cwd: home }));
      expect(ok.ok).toBe(true);
      expect(markerAtIntent).toBe(false); // nothing had started when the intent was committed
      if (ok.ok) await ok.handle.exited;
      expect(events.map((e) => e.type)).toEqual(["capability.mcp.spawn.intended", "capability.mcp.spawned", "capability.mcp.exited"]);

      const marker2 = join(home, "started2");
      const refused = await spawnGoverned(deps({ ledger: [], failIntent: true }), request({ argv: ["sh", "-c", `touch ${marker2}`], cwd: home }));
      expect(refused).toMatchObject({ ok: false, code: "record-failed" });
      await sleep(300);
      expect(await access(marker2).then(() => true, () => false)).toBe(false);
    });
  });

  test("a failed spawn is recorded and its slot released", async () => {
    const events: LedgerEvent[] = [];
    const released: string[] = [];
    const result = await spawnGoverned(deps({ ledger: events, slots: { acquire: async () => ({ slotId: "s9" }), release: async (id) => { released.push(id); } } }), request({ argv: ["/nonexistent/binary-xyz"], cwd: "/" }));
    expect(result).toMatchObject({ ok: false, code: "spawn-failed" });
    expect(events.map((e) => e.type)).toEqual(["capability.mcp.spawn.intended", "capability.mcp.exited"]);
    expect(events[1]!.payload.outcome).toBe("spawn-failed");
    expect(released).toEqual(["s9"]);
  });

  test("secrets reach the child's environment only: never argv, never a record; a missing key refuses before any intent", async () => {
    const SECRET = "tok-9f8e7d6c5b4a-SECRET";
    await withTempHome(async (home) => {
      const events: LedgerEvent[] = [];
      const out = join(home, "env.txt");
      const result = await spawnGoverned(deps({ ledger: events, secrets: { "stub-token": SECRET } }), request({ argv: ["sh", "-c", `printf %s "$STUB_TOKEN" > ${out}`], cwd: home, secrets: [{ env: "STUB_TOKEN", key: "stub-token" }] }));
      expect(result.ok).toBe(true);
      if (result.ok) await result.handle.exited;
      expect(readFileSync(out, "utf8")).toBe(SECRET);
      expect(JSON.stringify(events)).not.toContain(SECRET);
      expect(events[0]!.payload.secretRefs).toEqual([{ env: "STUB_TOKEN", key: "stub-token" }]);

      const refusals: string[] = [];
      const intents: LedgerEvent[] = [];
      const missing = await spawnGoverned(deps({ ledger: intents, refusals }), request({ secrets: [{ env: "STUB_TOKEN", key: "absent-key" }] }));
      expect(missing).toMatchObject({ ok: false, code: "missing-secret" });
      expect(refusals).toEqual(["missing-secret"]);
      expect(intents.length).toBe(0);
    });
  });

  test("the contained app posture refuses host-process spawns on the local world", async () => {
    const refusals: string[] = [];
    const events: LedgerEvent[] = [];
    const result = await spawnGoverned(deps({ ledger: events, refusals, localAllowed: false }), request());
    expect(result).toMatchObject({ ok: false, code: "posture-contained" });
    expect(events.length).toBe(0);
  });

  test("long-lease slots: a per-world cap in the same containment ledger; release frees one", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const service = app.runtime.service;
        const a = await acquireLongLeaseSlot(service, SYSTEM, { worldId: "w1", cap: 1 });
        await expect(acquireLongLeaseSlot(service, SYSTEM, { worldId: "w1", cap: 1 })).rejects.toBeInstanceOf(ContainmentQuotaError);
        await acquireLongLeaseSlot(service, SYSTEM, { worldId: "w2", cap: 1 }); // another world is unaffected
        await releaseLongLeaseSlot(service, SYSTEM, a.slotId, "completed", 1);
        await acquireLongLeaseSlot(service, SYSTEM, { worldId: "w1", cap: 1 });
      } finally {
        await app.stop();
      }
    });
  });

  test("boot sweep: confirmed spawns are killed by pid under the version-directory signature; unconfirmed intents reconcile to a recorded outcome", async () => {
    const signature = `/tmp/sweep-sig-${process.pid}-${Date.now()}`;
    const orphan = Bun.spawn(["sleep", "60", signature], { detached: true, stdout: "ignore", stderr: "ignore" });
    const bystander = Bun.spawn(["sleep", "60"], { detached: true, stdout: "ignore", stderr: "ignore" });
    const events: { id: string; event: LedgerEvent }[] = [];
    const released: string[] = [];
    const base = { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", worldKind: "local", bundleDir: signature, argv: ["sleep"] };
    try {
      const outcome = await reconcileSpawnLedger(
        { ledger: async (id, evs) => { for (const event of evs) events.push({ id, event }); }, slots: { acquire: async () => ({ slotId: "" }), release: async (id) => { released.push(id); } } },
        [
          { ...base, spawnId: "c1", status: "confirmed", pid: orphan.pid, slotId: "sl-c1" },
          { ...base, spawnId: "i1", status: "intended", slotId: "sl-i1" },
          { ...base, spawnId: "b1", status: "confirmed", pid: bystander.pid, bundleDir: "/some/other/dir", slotId: "sl-b1" }, // pid reused by another program: never killed
          { ...base, spawnId: "done", status: "exited" },
        ],
      );
      expect(outcome.map((o) => [o.spawnId, o.outcome])).toEqual([["c1", "reconciled-killed"], ["i1", "reconciled-unknown"], ["b1", "reconciled-gone"]]);
      await orphan.exited;
      expect(alive(bystander.pid)).toBe(true);
      expect(events.map((e) => e.id)).toEqual(["c1", "i1", "b1"]);
      expect(events.every((e) => e.event.type === "capability.mcp.exited")).toBe(true);
      expect(released).toEqual(["sl-c1", "sl-i1", "sl-b1"]);
    } finally {
      bystander.kill(9);
      orphan.kill(9);
    }
  });
});

describe("J-CAP-mcp: the lifecycle through the app (CUJ 3, local world)", () => {
  test("register, activate, start, list, invoke, deadline, bounds, stop — every step recorded, server-supplied data untrusted", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await boot(home);
      try {
        await install(app, client, home);
        const started = (await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })) as { pid: number; tools: number; state: string };
        expect(started.state).toBe("running");
        expect(alive(started.pid)).toBe(true);
        expect(started.tools).toBe(5); // the hostile name and the uncompilable schema were excluded

        // Ledger: intent before confirmation, secret REFERENCES only, the world's relaxations named.
        const ledger = await eventsOfType(app, "capability.mcp.spawn.intended", "capability.mcp.spawned");
        expect(ledger.map((e) => e.eventType)).toEqual(["capability.mcp.spawn.intended", "capability.mcp.spawned"]);
        expect(ledger[0]!.payload).toMatchObject({ worldId: "local", worldKind: "local", serverId: "stub" });
        expect(JSON.stringify(ledger[0]!.payload)).toContain("network");
        const row = await waitUntil("spawn row", async () => [...(await wbRows(app)).entries()].find(([k, v]) => k.startsWith("spawn/") && (v as { status?: string }).status === "confirmed")?.[1] as { pid: number } | undefined);
        expect(row.pid).toBe(started.pid);

        const listed = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, op: "tools.list" })) as Invoked;
        const ids = listed.result!.mcpTools!.map((t) => t.id).sort();
        expect(ids).toEqual(["mcp.stub.big", "mcp.stub.echo", "mcp.stub.pid", "mcp.stub.slow", "mcp.stub.token_state"]);
        expect(listed.result!.mcpTools!.every((t) => t.source === "mcp-server-supplied")).toBe(true);
        expect(listed.result!.mcpServers).toEqual([{ serverId: "stub", state: "running" }]);

        const echo = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.echo", arguments: { text: "hello-mcp" } })) as Invoked;
        expect(echo.ok).toBe(true);
        expect(echo.result!.content![0]!.text).toBe("hello-mcp");
        const invoked = await eventsOfType(app, "capability.mcp.tool_invoked");
        expect(invoked.map((e) => (e.payload as { phase: string }).phase)).toEqual(["started", "finished"]);
        expect(JSON.stringify(invoked)).not.toContain("hello-mcp"); // arguments are a digest and a byte count, never content
        expect(invoked[0]!.payload).toMatchObject({ argumentBytes: 20 });
        const allowed = (await decisions(app)).find((d) => d.operation === "mcp.stub.echo" && d.outcome === "allowed");
        expect(allowed).toBeDefined();

        // Server-side schema is enforced before anything is sent.
        const bad = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.echo", arguments: { text: 5 } })) as Invoked;
        expect(bad).toMatchObject({ ok: false, code: "schema_invalid" });
        const unknown = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.bad name!", arguments: {} })) as Invoked;
        expect(unknown).toMatchObject({ ok: false, code: "unknown_tool" });

        // Deadline expiry: the call returns the structured envelope and the server stays usable.
        const t0 = Date.now();
        const slow = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.slow", arguments: { ms: 4000 }, deadlineMs: 300 })) as Invoked;
        expect(slow).toMatchObject({ ok: false, code: "deadline_exceeded" });
        expect(Date.now() - t0).toBeLessThan(3000);
        const again = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.echo", arguments: { text: "still-up" } })) as Invoked;
        expect(again.ok).toBe(true);

        // Result bound: measured in UTF-8 bytes; an oversized result is refused, never truncated.
        const big = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.big", arguments: {} })) as Invoked;
        expect(big).toMatchObject({ ok: false, code: "result_too_large" });
        expect(utf8Bytes("é".repeat(10))).toBe(20);
        expect(MCP_LIMITS.maxResultBytes).toBe(256 * 1024);

        // Stop: termination outcome recorded, process gone, calls refused.
        await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
        const exited = await waitUntil("exited record", async () => (await eventsOfType(app, "capability.mcp.exited"))[0]);
        expect(exited.payload).toMatchObject({ outcome: "stopped", stopReason: "operator-stop", termination: "group-kill" });
        await waitUntil("process gone", async () => !alive(started.pid));
        const after = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.echo", arguments: { text: "x" } })) as Invoked;
        expect(after).toMatchObject({ ok: false, code: "server_not_running" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("secrets resolve env-only through the store: the child sees the value, no event and no argv does", async () => {
    const SECRET = "tok-1a2b3c4d5e6f-NEVER-RECORD";
    await withTempHome(async (home) => {
      const { app, client } = await boot(home);
      try {
        await client.invoke("secret.put", { key: "stub-token", value: SECRET });
        await install(app, client, home, [
          { id: "stub", command: ["bun", "${bundleDir}/server.mjs"], secrets: [{ env: "STUB_TOKEN", key: "stub-token" }] },
          { id: "nokey", command: ["bun", "${bundleDir}/server.mjs"], secrets: [{ env: "STUB_TOKEN", key: "absent-key" }] },
        ]);
        await client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" });
        const state = (await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "mcp.stub.token_state", arguments: {} })) as Invoked;
        expect(state.result!.content![0]!.text).toBe(`STUB_TOKEN:set:${SECRET.length}`);

        // Missing key: refused with a decision record, no intent, no process.
        const before = (await eventsOfType(app, "capability.mcp.spawn.intended")).length;
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "nokey" })).rejects.toThrow(/absent-key/);
        expect((await decisions(app)).some((d) => d.reasonCode === "missing-secret" && d.point === "spawn" && d.outcome === "refused")).toBe(true);
        expect((await eventsOfType(app, "capability.mcp.spawn.intended")).length).toBe(before);

        const everything = JSON.stringify(await allEvents(app));
        expect(everything).not.toContain(SECRET);
        expect(everything).toContain("stub-token"); // the reference is recorded, never the value
        await client.invoke("capability.mcp.stop", { capabilityId: CAP, serverId: "stub" });
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("refusals are recorded: no posture record, an inaccurate record, no activation, runtime disabled", async () => {
    await withTempHome(async (home) => {
      // Not enabled yet: the start refuses at the decision point and says why.
      const { app, client } = await bootApp(home, { mcpSupervisorTimings: FAST });
      try {
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })).rejects.toThrow(/not enabled/);
        expect((await decisions(app)).some((d) => d.reasonCode === "runtime-disabled" && d.operation === "mcp.start")).toBe(true);
        expect((await eventsOfType(app, "capability.mcp.spawn.intended")).length).toBe(0);
        await enableCapabilityRuntime(app, client);
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })).rejects.toThrow(/no activation/);
        await install(app, client, home);
        // No posture record on this boot: the local world cannot enforce the network denial.
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })).rejects.toThrow(/cannot enforce network/);
        const codes = (await decisions(app)).filter((d) => d.outcome === "refused").map((d) => d.reasonCode);
        expect(codes).toContain("no-activation");
        expect(codes).toContain("unenforceable:network");
        expect((await eventsOfType(app, "capability.mcp.spawn.intended")).length).toBe(0);
      } finally {
        await app.stop();
      }
    });
    await withTempHome(async (home) => {
      const lying: PostureRecord = { worldId: "local", authorizes: { network: { level: "enforced", note: "claimed" }, subprocess: LOCAL_POSTURE.authorizes.subprocess! } };
      const { app, client } = await boot(home, [lying]);
      try {
        await install(app, client, home);
        await expect(client.invoke("capability.mcp.start", { capabilityId: CAP, serverId: "stub" })).rejects.toThrow(/inaccurate/);
        expect((await decisions(app)).some((d) => d.reasonCode === "posture-inaccurate" && d.coreViolation === true)).toBe(true);
      } finally {
        await app.stop();
      }
    });
  }, 120000);

  test("a server declaration without the mcp.server requirement is refused at registration", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await boot(home);
      try {
        await expect(client.invoke("capability.bundle.register", { capabilityId: CAP, sourceDir: await authorStub(home, "norequirement"), manifest: stubManifest(undefined, { requirements: ["capability.invoke"] }) } as never)).rejects.toThrow(/mcp\.server/);
        await expect(client.invoke("capability.bundle.register", { capabilityId: CAP, sourceDir: await authorStub(home, "badenv"), manifest: stubManifest([{ id: "stub", command: ["bun"], secrets: [{ env: "LD_PRELOAD", key: "k" }] }]) } as never)).rejects.toThrow(/reserved environment name/);
      } finally {
        await app.stop();
      }
    });
  }, 60000);
});

describe("J-CAP-mcp: every entry point decides through authorizeCapabilityOp", () => {
  const index = () => {
    const i = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local");
    i.grants.set("grant:root", { grantId: "root", principalId: "wb-operator:root", permissions: ["*"], status: "active", recordedAt: "" } as never);
    i.activations.set(i.activationKey(CAP, "user"), { capabilityId: CAP, level: "user", version: "v", ceiling: ["capability.invoke", "mcp.server"], clampProvenance: "operator", state: "active", suspensionReasons: [] });
    return i;
  };
  const args = (over: Record<string, unknown> = {}) => ({ enabled: true, deploymentOk: true, index: index(), actor: { id: "operator", kind: "user" }, capabilityId: CAP, nowMs: Date.now(), ...over }) as never;

  test("mcp.start: operator-only, enabled, deployment-ok, an active unsuspended slot under a live clamp", () => {
    expect(authorizeCapabilityOp("mcp.start", args()).ok).toBe(true);
    expect(authorizeCapabilityOp("mcp.start", args({ actor: { id: "wb-agent:coding", kind: "agent" } }))).toMatchObject({ ok: false, code: "operator-only" });
    expect(authorizeCapabilityOp("mcp.start", args({ runId: "run-1" }))).toMatchObject({ ok: false, code: "operator-only" });
    expect(authorizeCapabilityOp("mcp.start", args({ enabled: false }))).toMatchObject({ ok: false, code: "runtime-disabled" });
    expect(authorizeCapabilityOp("mcp.start", args({ deploymentOk: false }))).toMatchObject({ ok: false, code: "deployment-invariant" });
    expect(authorizeCapabilityOp("mcp.start", args({ index: undefined }))).toMatchObject({ ok: false, code: "index-unavailable" });
    const suspended = index();
    suspended.activations.set(suspended.activationKey(CAP, "user"), { ...suspended.activations.get(suspended.activationKey(CAP, "user"))!, state: "suspended", suspensionReasons: ["operator-yank"] });
    expect(authorizeCapabilityOp("mcp.start", args({ index: suspended }))).toMatchObject({ ok: false, code: "suspended" });
    const noCeiling = index();
    noCeiling.activations.set(noCeiling.activationKey(CAP, "user"), { ...noCeiling.activations.get(noCeiling.activationKey(CAP, "user"))!, ceiling: ["capability.invoke"] });
    expect(authorizeCapabilityOp("mcp.start", args({ index: noCeiling }))).toMatchObject({ ok: false, code: "beyond-ceiling" });
    expect(authorizeCapabilityOp("mcp.start", args({ capabilityId: "capability.bundle.other" }))).toMatchObject({ ok: false, code: "no-activation" });
  });

  test("suspend / resume / mcp.stop are operator acts; an agent or an in-run caller is refused", () => {
    for (const op of ["suspend", "resume", "mcp.stop"] as const) {
      expect(authorizeCapabilityOp(op, args()).ok).toBe(true);
      expect(authorizeCapabilityOp(op, args({ actor: { id: "wb-agent:coding", kind: "agent" } }))).toMatchObject({ ok: false, code: "operator-only" });
      expect(authorizeCapabilityOp(op, args({ runId: "run-1" }))).toMatchObject({ ok: false, code: "operator-only" });
    }
  });

  test("the supervisor's handler set is pinned and each handler decides through check() -> authorizeCapabilityOp as its last step", () => {
    const supervisor = createMcpSupervisor({ tenant: "local", getRecorder: () => ({}) as never, getIndex: () => ({}) as never, isEnabled: async () => true, readRows: async () => [], recordDecision: async () => {}, registry: () => ({}) as never, resolveSecret: async () => undefined, slots: { acquire: async () => ({ slotId: "" }), release: async () => {} }, getPosture: () => undefined, localHostSpawnAllowed: () => false });
    const handlers: string[] = [];
    supervisor.component().activate({ provide: (c: { id: string }) => handlers.push(c.id), effects: { register() {} } } as never);
    expect(handlers.sort()).toEqual(["capability.bundle.resume", "capability.bundle.suspend", "capability.mcp.start", "capability.mcp.stop"]);
    const source = readFileSync(join(import.meta.dir, "../src/capabilities/mcpManage.ts"), "utf8");
    expect(source.slice(source.indexOf("const check = ("), source.indexOf("const check = (") + 700)).toContain("authorizeCapabilityOp(");
    const blockOf = (id: string): string => { const start = source.indexOf(`provide("${id}"`); expect(start).toBeGreaterThan(-1); const next = source.indexOf("provide(\"", start + 10); return source.slice(start, next === -1 ? undefined : next); };
    expect(blockOf("capability.mcp.start")).toContain("startServer(");
    expect(blockOf("capability.mcp.stop")).toContain("check(\"mcp.stop\"");
    expect(blockOf("capability.bundle.suspend")).toContain("check(\"suspend\"");
    expect(blockOf("capability.bundle.resume")).toContain("check(\"resume\"");
    // Every mutating act runs in the shared mutex.
    for (const id of handlers) expect(blockOf(id)).toContain("mutex.run(");
    // startServer authorizes at its first step, again as the last step before the intent commit, and again after the spawn.
    const start = source.slice(source.indexOf("const startServer"), source.indexOf("const host: McpHost"));
    expect((start.match(/check\("mcp\.start"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The session of a CALL comes from the run (the dispatcher), never from input: the MCP host takes it from the activation entry.
    expect(source).not.toContain("input.sessionId, ctx");
  });
});

// keep the unused fixtures referenced so the file documents its helpers
void mkdir; void writeFile;
