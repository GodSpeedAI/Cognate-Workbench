// #116 Workbench host half: a contained spawn launches only on a SEA-Forge decision that proves it authorized exactly
// the execution profile about to run. The route is the existing typed SeaForgeAuthority client; the stand-in below is a
// unix-socket SEA-Forge that answers the same NDJSON authority_request exchange with a CEP authority_decision, so the real
// client's decision parsing is part of what these tests exercise. Every refusal leaves the sandbox unspawned.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RlmRefusedError, SeaForgeAuthority } from "@godspeedai/cognate-runtime-bun";
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import type { ContainedStdioPortConfig } from "../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort } from "../src/capabilities/containedStdioPort.ts";
import * as runContext from "../src/capabilities/containedRunContext.ts";
import { runInContainedLease } from "../src/capabilities/containedRunContext.ts";
import { scopedPort } from "./support/scopedPort.ts";
import { ULID, WORLD, seaForge, type Answer } from "./support/seaForgeStandIn.ts";
import { CONTAINED_SPAWN_CAPABILITY, checkProfileDecision, profileAuthorize, type ProfileAuthorization } from "../src/capabilities/containedProfileAuthority.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const ctx = { intentId: "i", runId: "run-116" };
let root: string; let workspace: string; let marker: string; let config: ContainedStdioPortConfig; let spec: StdioSpawnSpec;
let launcherText: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "profile-auth-"));
  workspace = join(root, "ws"); await mkdir(workspace); await mkdir(join(root, "bin"));
  marker = join(root, "launcher-ran");
  launcherText = `#!/bin/sh\necho "$@" >> ${marker}\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\nexit 0\n`; // logs EVERY invocation, --version included
  const exeText = "#!/bin/sh\necho child\n";
  await writeFile(join(root, "bin", "bwrap"), launcherText); await chmod(join(root, "bin", "bwrap"), 0o755);
  await writeFile(join(root, "bin", "child"), exeText); await chmod(join(root, "bin", "child"), 0o755);
  config = { authorize: async () => {}, launcher: { path: join(root, "bin", "bwrap"), sha256: sha(launcherText) }, executables: [{ path: join(root, "bin", "child"), sha256: sha(exeText) }], workspaceRoot: workspace, writableRoots: [] };
  spec = { argv: [join(root, "bin", "child"), "--serve"], cwd: workspace, env: {}, restrictions: {} };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

/** Real spawns recorded by the stand-in launcher: only a spawn line carries the child's arguments (the namespace preflight runs /usr/bin/true). */
/** EVERY launcher invocation the stand-in recorded (the --version probe is not logged): a sandbox started for any reason, the namespace preflight included. */
/** Wait until no launcher is still writing its start record: an earlier test's launch is asynchronous and can land a line late. */
async function quiesce(): Promise<void> {
  let last = -1;
  for (let i = 0; i < 100; i++) { const now = existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0; if (now === last) return; last = now; await Bun.sleep(120); }
}
const everyLaunch = async (): Promise<number> => (existsSync(marker) ? (await readFile(marker, "utf8")).split("\n").filter(Boolean).length : 0);
const lines = async (): Promise<number> => (existsSync(marker) ? (await readFile(marker, "utf8")).split("\n").filter((l) => l.includes("--serve")).length : 0);

async function rig(answerFor: (digest: string | undefined, resource: string) => Answer, extra: Partial<ContainedStdioPortConfig> = {}, timeoutMs = 1500) {
  const socket = join(root, `sea-${Math.random().toString(36).slice(2)}.sock`);
  const seen = { claims: [] as unknown[], resources: [] as string[] };
  const server = await seaForge(socket, answerFor, seen);
  const records: ProfileAuthorization[] = [];
  const client = new SeaForgeAuthority({ socketPath: socket, timeoutMs, requestIdPrefix: "workbench" });
  const authorize = profileAuthorize({ authority: client, worldRef: WORLD, actor: { id: "system", kind: "system" }, tenant: "local", record: (r) => records.push(r) });
  const port = scopedPort({ ...config, authorize, ...extra });
  return { port, records, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const refused = async (promise: Promise<unknown>): Promise<RlmRefusedError> => {
  try { await promise; } catch (error) { if (error instanceof RlmRefusedError) return error; throw error; }
  throw new Error("expected a typed refusal, but the spawn went ahead");
};

describe("#116: the host asks SEA-Forge and launches only on the exact boundary allow", () => {
  test("a boundary allow carrying exactly the profile digest spawns, and the evidence holds digests and the decision id only", async () => {
    const policy = (await scopedPort(config).executionProfile(spec)).digest; // what an operator wrote into policy
    const r = await rig((claimed) => ({ kind: "boundary", digests: claimed === policy ? [policy] : [] }));
    try {
      const before = await lines();
      const { id } = await r.port.spawn(spec, ctx);
      expect(r.seen.claims).toEqual([{ execution_profile_digest: policy }]);     // the claim key SEA-Forge reads
      for (let i = 0; i < 100 && (await lines()) < before + 1; i++) await Bun.sleep(20); // the stand-in launcher writes after spawn returns
      expect(await lines()).toBe(before + 1);
      expect(r.records).toHaveLength(1);
      expect(Object.keys(r.records[0]!).sort()).toEqual(["at", "decisionId", "executionProfileDigest", "launchPlanDigest", "runId"]);
      expect(r.records[0]!.executionProfileDigest).toBe(policy);
      expect(r.records[0]!.launchPlanDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(r.records[0]!.decisionId).toBe(ULID);                              // the decision id, from the ledger entry
      expect(JSON.stringify(r.records)).not.toContain("envelope");                  // no raw packets
      expect(r.port.inspect(id).plan.executionProfileDigest).toBe(policy);
    } finally { await r.port.dispose(); await r.close(); }
  });

  const cases: [string, (claimed: string | undefined, resource: string) => Answer, RegExp][] = [
    ["deny", () => ({ kind: "plain", decision: "deny" }), /answered deny/],
    ["escalate", () => ({ kind: "plain", decision: "escalate" }), /answered escalate|answered unknown/],
    ["a plain allow with no constraint", () => ({ kind: "plain", decision: "allow" }), /answered allow/],
    ["a constrained allow", () => ({ kind: "plain", decision: "constrained_allow" }), /answered|without constraints/],
    ["a boundary allow for a different digest", () => ({ kind: "boundary", digests: [`sha256:${"b".repeat(64)}`] }), /different execution profile/],
    ["a boundary allow with two profile constraints", (claimed) => ({ kind: "boundary", digests: [claimed!, claimed!] }), /more than one/],
    ["a boundary allow with the right digest and a wrong one", (claimed) => ({ kind: "boundary", digests: [claimed!, `sha256:${"c".repeat(64)}`] }), /different execution profile/],
    ["a boundary allow with only another constraint type", () => ({ kind: "boundary", digests: [], extraConstraints: [{ constraint_type: "timeout_secs", description: "30" }] }), /timeout_secs/],
    ["a boundary allow with the right digest and an unenforceable timeout_secs constraint (H3)", (claimed) => ({ kind: "boundary", digests: [claimed!], extraConstraints: [{ constraint_type: "timeout_secs", description: "30" }] }), /timeout_secs/],
    ["a boundary allow with a decision_id but no ledger entry (H1)", (claimed) => ({ kind: "boundary", digests: [claimed!], decisionIdOnly: true }), /carries no ledger entry/],
    ["a boundary allow with no constraints at all", () => ({ kind: "boundary", digests: [] }), /without constraints|answered unknown/],
    ["a boundary allow with no ledger entry", (claimed) => ({ kind: "boundary", digests: [claimed!], noLedger: true }), /carries no ledger entry/],
    ["a malformed reply", () => ({ kind: "malformed" }), /answered unknown|could not decide/],
    ["an authority error", () => ({ kind: "error" }), /answered unknown/],
    ["a SEA-Forge that never answers", () => ({ kind: "silent" }), /answered unknown|could not decide/],
  ];
  for (const [name, answer, why] of cases) {
    test(`refuses before spawn on ${name}`, async () => {
      const r = await rig(answer, {}, 600);
      try {
        const before = await lines();
        const e = await refused(r.port.spawn(spec, ctx));
        expect(e.code).toBe("rlm-containment-unavailable");
        expect(e.reason).toContain("rlm-profile-unauthorized");
        expect(e.reason).toMatch(why);
        expect(await lines()).toBe(before);                                           // no sandbox was launched
        expect(r.records).toEqual([]);
      } finally { await r.port.dispose(); await r.close(); }
    });
  }

  test("a port built without an authorize hook fails at construction, so no spawn can happen", async () => {
    const before = await lines();
    for (const bad of [undefined, null, "yes", {}]) {
      expect(() => scopedPort({ ...config, authorize: bad } as unknown as ContainedStdioPortConfig)).toThrow(/authorize/);
    }
    expect(await lines()).toBe(before);
  });

  test("an unreachable SEA-Forge (no socket at all) refuses", async () => {
    const client = new SeaForgeAuthority({ socketPath: join(root, "absent.sock"), timeoutMs: 300 });
    const port = scopedPort({ ...config, authorize: profileAuthorize({ authority: client, worldRef: WORLD, actor: { id: "system", kind: "system" }, tenant: "local" }) });
    const e = await refused(port.spawn(spec, ctx));
    expect(e.reason).toContain("rlm-profile-unauthorized");
    await port.dispose();
  });

  test("changing the profile after policy was written refuses: a different ceiling is a different digest", async () => {
    const written = (await scopedPort(config).executionProfile(spec)).digest;
    const r = await rig((claimed) => ({ kind: "boundary", digests: claimed === written ? [written] : [`sha256:${"d".repeat(64)}`] }), { ceilings: { outputBytes: 2048 } });
    try {
      const e = await refused(r.port.spawn(spec, ctx));
      expect(e.reason).toContain("different execution profile");
      expect(r.seen.claims).toHaveLength(1);
      expect((r.seen.claims[0] as { execution_profile_digest: string }).execution_profile_digest).not.toBe(written);
    } finally { await r.port.dispose(); await r.close(); }
  });
});

describe("#116: the hook's own checks (no socket needed)", () => {
  const D = `sha256:${"e".repeat(64)}`;
  const plan = (digest: string) => ({ executionProfileDigest: digest }) as never;
  const stub = (decision: unknown) => profileAuthorize({ authority: { decide: async () => decision as never }, worldRef: WORLD, actor: { id: "s", kind: "system" }, tenant: "t" });
  const run = (hook: ReturnType<typeof profileAuthorize>, planDigest: string, claimed: string) => hook(plan(planDigest), "sha256:" + "0".repeat(64), ctx, claimed);

  test("a plan that does not embed the digest being authorized refuses without asking SEA-Forge", async () => {
    let asked = 0;
    const hook = profileAuthorize({ authority: { decide: async () => { asked += 1; return { disposition: "boundary", reason: "", decisionRef: ULID, constraints: [{ type: "execution_profile", value: D }] }; } }, worldRef: WORLD, actor: { id: "s", kind: "system" }, tenant: "t" });
    expect((await refused(run(hook, `sha256:${"f".repeat(64)}`, D))).reason).toContain("does not embed");
    expect(asked).toBe(0);
  });

  test("malformed digests, a missing world reference and malformed decisions refuse", async () => {
    expect((await refused(run(stub(null), "bad", "bad"))).reason).toContain("malformed");
    const noWorld = profileAuthorize({ authority: { decide: async () => ({ disposition: "boundary", reason: "", decisionRef: ULID, constraints: [{ type: "execution_profile", value: D }] }) }, worldRef: undefined, actor: { id: "s", kind: "system" }, tenant: "t" });
    expect((await refused(run(noWorld, D, D))).reason).toContain("world reference");
    for (const bad of [null, "boundary", 7, {}, { disposition: 5 }, { disposition: "boundary" }, { disposition: "boundary", constraints: "x" }, { disposition: "boundary", constraints: [null] }, { disposition: "boundary", constraints: [{ type: "execution_profile" }] }]) {
      await refused(run(stub(bad), D, D));
    }
    expect(() => checkProfileDecision({ disposition: "boundary", constraints: [{ type: "execution_profile", value: D }] }, D)).toThrow(/no ledger entry/);
    expect(() => checkProfileDecision({ disposition: "boundary", decisionRef: "auth_01", constraints: [{ type: "execution_profile", value: D }] }, D)).toThrow(/no ledger entry/); // a decision id is not a ULID ledger entry (H1)
    expect(() => checkProfileDecision({ disposition: "boundary", decisionRef: "", authority: { decisionEnvelopeId: "env-1" }, constraints: [{ type: "execution_profile", value: D }] }, D)).toThrow(/no ledger entry/);
    expect(checkProfileDecision({ disposition: "boundary", decisionRef: ULID, constraints: [{ type: "execution_profile", value: D }] }, D)).toBe(ULID);
  });

  test("a thrown client error refuses", async () => {
    const hook = profileAuthorize({ authority: { decide: async () => { throw new Error("socket closed"); } }, worldRef: WORLD, actor: { id: "s", kind: "system" }, tenant: "t" });
    expect((await refused(run(hook, D, D))).reason).toContain("socket closed");
  });
});

const boundaryFor = (claimed: string | undefined): Answer => ({ kind: "boundary", digests: claimed ? [claimed] : [] });

describe("#116 delta-1: the launch is its own policy target, started only after authority, never after disposal", () => {
  test("M8: the port asks about its own capability, so an admission-only rule on rlm.invoke and a profile rule on the launch target both apply", async () => {
    // The stand-in models per-target rules: rlm.invoke has a plain allow (the parent's admission), the launch target a profile rule.
    const r = await rig((claimed, resource) => (resource === "rlm.invoke" ? { kind: "plain", decision: "allow" } : resource === CONTAINED_SPAWN_CAPABILITY ? boundaryFor(claimed) : { kind: "plain", decision: "deny" }));
    try {
      const before = await lines();
      await r.port.spawn(spec, ctx);
      expect(r.seen.resources).toEqual([CONTAINED_SPAWN_CAPABILITY]);
      expect(CONTAINED_SPAWN_CAPABILITY).not.toBe("rlm.invoke");
      for (let i = 0; i < 100 && (await lines()) < before + 1; i++) await Bun.sleep(20);
      expect(await lines()).toBe(before + 1);
    } finally { await r.port.dispose(); await r.close(); }
  });

  test("M5: a denied cold launch starts no bubblewrap of any kind (the namespace preflight runs only after SEA allows)", async () => {
    const r = await rig(() => ({ kind: "plain", decision: "deny" }), {}, 600);
    try {
      await quiesce();
      const before = await everyLaunch();
      await refused(r.port.spawn(spec, ctx));
      expect(await everyLaunch()).toBe(before);
    } finally { await r.port.dispose(); await r.close(); }
  });

  test("M7: disposal while the authority reply is pending launches nothing", async () => {
    let release!: () => void; let asked!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const askedAt = new Promise<void>((resolve) => { asked = resolve; });
    const profile = (await scopedPort(config).executionProfile(spec)).digest;   // measured first: building a port runs the launcher once for its version
    const authority = { decide: async () => { asked(); await held; return { disposition: "boundary" as const, reason: "ok", decisionRef: ULID, constraints: [{ type: "execution_profile", value: profile }] }; } };
    const port = scopedPort({ ...config, authorize: profileAuthorize({ authority, worldRef: WORLD, actor: { id: "s", kind: "system" }, tenant: "t" }) });
    await quiesce();
    const before = await everyLaunch();
    const pending = port.spawn(spec, ctx).then(() => "spawned", (e) => (e instanceof RlmRefusedError ? "refused" : "error"));
    await askedAt;
    await port.dispose();
    release();
    expect(await pending).toBe("refused");
    await Bun.sleep(150);
    expect(await everyLaunch()).toBe(before);
    expect(await refused(port.spawn(spec, ctx)).then((e) => e.reason)).toMatch(/disposed|closed/); // a closed port stays closed
  });
});

describe("#114 delta-2: the run identity and reach come from the runtime, and pinned descriptors never leak", () => {
  let sockDir: string; let sockPath: string; let listener: Server;
  beforeAll(async () => {
    sockDir = await mkdtemp(join(tmpdir(), "profile-sock-"));
    sockPath = join(sockDir, "egress.sock");
    listener = createServer(() => {});
    await new Promise<void>((resolve) => listener.listen(sockPath, resolve));
  });
  afterAll(async () => { await new Promise<void>((resolve) => listener.close(() => resolve())); await rm(sockDir, { recursive: true, force: true }); });
  const egressSpec = (): StdioSpawnSpec => ({ ...spec, restrictions: { network: { outbound: [`host-socket:${sockPath}`] } } });

  test("M9: the reach comes from the run store, not from arguments the provider passes; a provider naming another run is refused before authority", async () => {
    let asked = 0;
    const authorize = async () => { asked += 1; throw new RlmRefusedError("rlm-containment-unavailable", "rlm-profile-unauthorized: test stop"); };
    const port = containedStdioSpawnPort({ ...config, hostSocket: sockPath, authorize });
    try {
      const inRun = <T>(runId: string, reach: "none" | "host-socket", fn: () => T): T => runInContainedLease({ runId, reach }, fn) as unknown as T;
      // No run context at all: refused.
      expect((await refused(port.spawn(egressSpec(), { intentId: "i", runId: "run-sock" }))).reason).toMatch(/context/);
      // A no-network provider that names the run id of a (retained) host-socket run: the runtime says it is run-none.
      const spoof = await refused(inRun("run-none", "none", () => port.spawn(egressSpec(), { intentId: "i", runId: "run-sock" })));
      expect(spoof.reason).toMatch(/not the run|disagrees|another run/);
      // A no-network run asking for the host socket under its own id.
      const own = await refused(inRun("run-none", "none", () => port.spawn(egressSpec(), { intentId: "i", runId: "run-none" })));
      expect(own.reason).toMatch(/declared/);
      expect(asked).toBe(0);                                                          // every refusal came BEFORE any authority request
      // Positive control: a host-socket run asking for it under its own id reaches the authority.
      const allowed = await refused(inRun("run-sock", "host-socket", () => port.spawn(egressSpec(), { intentId: "i", runId: "run-sock" })));
      expect(allowed.reason).toContain("test stop");
      expect(asked).toBe(1);
    } finally { await port.dispose(); }
  });

  test("L11: an egress socket that vanishes while authority is pending leaks no descriptor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "profile-leak-"));
    const sock = join(dir, "e.sock");
    // Descriptors on THIS test's pinned objects only: other files' sandboxes and pipes come and go in the same process, so a raw
    // fd total is not stable, but a leaked workspace or socket descriptor is exactly one more link to these paths.
    const count = (): number => readdirSync("/proc/self/fd").filter((fd) => { try { const link = readlinkSync(`/proc/self/fd/${fd}`); return link === workspace || link === sock; } catch { return false; } }).length;
    try {
      const sp = { ...spec, restrictions: { network: { outbound: [`host-socket:${sock}`] } } };
      const before = count();
      for (let i = 0; i < 3; i++) {
        const again = createServer(() => {}); await new Promise<void>((resolve) => again.listen(sock, resolve));
        const p2 = scopedPort({ ...config, hostSocket: sock, authorize: async () => { await new Promise<void>((resolve) => again.close(() => resolve())); await rm(sock, { force: true }); } });
        const e = await refused(p2.spawn(sp, { intentId: "i", runId: "run-leak" }));
        expect(e.reason).toMatch(/could not be opened|no longer/);
        await p2.dispose();
      }
      expect(count()).toBe(before);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("#114 delta-2: disposal during the launch path, and the version probe", () => {
  test("M7: a disposal that lands while the launch is between its allow and its preflight begins no launcher", async () => {
    // What is asserted is when a launch BEGINS, not when the launcher's log line lands: the real launch is an asynchronous Bun.spawn, so a
    // launch begun just before dispose() can still write its line after it (observed under load: 8 of 780 cases, with the begin count
    // unchanged). `__debug().launcherCalls` is incremented synchronously at each Bun.spawnSync / Bun.spawn call site; any increase after
    // dispose() ran, is a launch that started after the port closed.
    const iterations = Number(process.env.M7_SWEEP_ITERATIONS ?? 1);
    const cases: ["micro" | "immediate" | "timer", number][] = [];
    for (const hop of [0, 1, 2, 3, 4, 6, 8, 12]) { cases.push(["micro", hop]); }
    cases.push(["immediate", 0]);
    for (let ms = 0; ms <= 14; ms++) cases.push(["timer", ms]);
    let reachedAllow = 0;
    for (let it = 0; it < iterations; it++) for (const [mode, hop] of cases) {
      let callsAtDispose = -1;
      const port = scopedPort({ ...config, authorize: async () => {
        const dispose = (): void => { callsAtDispose = port.__debug().launcherCalls; void port.dispose(); };
        if (mode === "timer") setTimeout(dispose, hop);
        else if (mode === "immediate") setImmediate(dispose);
        else { let p: Promise<void> = Promise.resolve(); for (let i = 0; i < hop; i++) p = p.then(() => {}); void p.then(dispose); }
        reachedAllow += 1;
      } });
      await port.spawn(spec, ctx).catch(() => {});
      await Bun.sleep(30);
      await port.dispose();
      const debug = port.__debug();
      if (callsAtDispose >= 0) expect([mode, hop, debug.launcherCalls - callsAtDispose]).toEqual([mode, hop, 0]);   // no launch began after dispose()
    }
    expect(reachedAllow).toBe(cases.length * iterations);                                                              // every case really reached the allow
  });

  test("M7: the begin counter is exact: a launch that completes before dispose is counted, and a refused one is not", async () => {
    const port = scopedPort({ ...config, authorize: async () => {} });
    const base = port.__debug().launcherCalls;
    await port.spawn(spec, ctx);
    expect(port.__debug().launcherCalls - base).toBe(2);      // the namespace preflight and the launch itself
    await port.dispose();
    await refused(port.spawn(spec, { intentId: "i2", runId: "r2" }));
    expect(port.__debug().launcherCalls - base).toBe(2);      // a disposed port begins nothing
  });

  test("M7: dispose awaits every in-flight spawn, and a spawn it cancelled does not launch when authority later answers", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void; const startedP = new Promise<void>((resolve) => { started = resolve; });
    const port = scopedPort({ ...config, authorize: async () => { started(); await held; } });
    await quiesce();
    const before = await everyLaunch();
    const pending = port.spawn(spec, ctx).then(() => "spawned", () => "refused");
    await startedP;
    await port.dispose();                                    // returns although the authority has not answered
    release();
    expect(await pending).toBe("refused");
    await Bun.sleep(100);
    expect(await everyLaunch()).toBe(before);
  });

  test("F9: the launcher version is measured once, when the port is built; a cold denied spawn invokes nothing", async () => {
    await quiesce();
    const before = await everyLaunch();
    const r = await rig(() => ({ kind: "plain", decision: "deny" }), {}, 600);
    try {
      const afterBuild = await everyLaunch();
      expect(afterBuild - before).toBe(1);                   // exactly one invocation: the version probe at construction
      await refused(r.port.spawn(spec, ctx));
      await refused(r.port.spawn(spec, ctx));
      expect(await everyLaunch()).toBe(afterBuild);          // --version included: zero further invocations per denied spawn
    } finally { await r.port.dispose(); await r.close(); }
  });
});

function readLaunchCount(): number { return existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0; }

describe("#114 delta-3: the run lease is host-owned and revoked, the binding is immutable, and the port owns its descriptors", () => {
  const egress = async (): Promise<{ sock: string; close: () => Promise<void> }> => {
    const dir = await mkdtemp(join(tmpdir(), "profile-lease-"));
    const sock = join(dir, "e.sock");
    const one = createServer(() => {});
    await new Promise<void>((resolve) => one.listen(sock, resolve));
    return { sock, close: async () => { await new Promise<void>((resolve) => one.close(() => resolve())); await rm(dir, { recursive: true, force: true }); } };
  };

  test("1: the context module exports no writable store; only the server-facing runner and the port's reader", () => {
    expect(Object.keys(runContext).sort()).toEqual(["currentLease", "runInContainedLease"]);
  });

  test("1: a callback that outlives its run cannot spawn: the lease is revoked when the run returns, before any authority request", async () => {
    const e = await egress();
    let asked = 0;
    const port = containedStdioSpawnPort({ ...config, hostSocket: e.sock, authorize: async () => { asked += 1; throw new RlmRefusedError("rlm-containment-unavailable", "rlm-profile-unauthorized: test stop"); } });
    try {
      const sp: StdioSpawnSpec = { ...spec, restrictions: { network: { outbound: [`host-socket:${e.sock}`] } } };
      let later: Promise<unknown> = Promise.resolve();
      // Positive control inside the run: the same spawn reaches the authority.
      await runInContainedLease({ runId: "r-live", reach: "host-socket" }, async () => {
        setTimeout(() => { later = port.spawn(sp, { intentId: "i", runId: "r-live" }).then(() => "spawned", (error) => error); }, 30);
        const inside = await refused(port.spawn(sp, { intentId: "i", runId: "r-live" }));
        expect(inside.reason).toContain("test stop");
      });
      expect(asked).toBe(1);
      await Bun.sleep(100);                                              // the timer fires after the run has returned
      const outcome = await later as RlmRefusedError;
      expect(outcome).toBeInstanceOf(RlmRefusedError);
      expect(outcome.reason).toMatch(/lease|ended|revoked/);
      expect(asked).toBe(1);                                             // no further authority request
    } finally { await port.dispose(); await e.close(); }
  });

  test("2: a provider that changes ctx.runId or ctx.intentId after entry changes nothing: the authority sees the binding snapshotted at entry", async () => {
    const seenByAuthority: { runId: string; intentId: string }[] = [];
    const port = containedStdioSpawnPort({ ...config, authorize: async (_plan, _digest, ctxSeen) => { seenByAuthority.push({ runId: ctxSeen.runId, intentId: ctxSeen.intentId }); throw new RlmRefusedError("rlm-containment-unavailable", "rlm-profile-unauthorized: test stop"); } });
    try {
      let runReads = 0; let intentReads = 0;
      const shifty = { get runId() { return runReads++ === 0 ? "run-a" : "run-b"; }, get intentId() { return intentReads++ === 0 ? "intent-a" : "intent-b"; } };
      await refused(runInContainedLease({ runId: "run-a", reach: "none" }, () => port.spawn(spec, shifty)));
      expect(seenByAuthority).toEqual([{ runId: "run-a", intentId: "intent-a" }]);
      expect(runReads).toBe(1);                                          // read exactly once: the rest of the path uses the immutable binding
      expect(intentReads).toBe(1);
    } finally { await port.dispose(); }
  });

  test("3: disposal while the launcher handle is being acquired leaves no launcher descriptor and starts no launcher", async () => {
    const launcherReal = join(root, "bin", "bwrap");
    const launcherFds = (): number => readdirSync("/proc/self/fd").filter((fd) => { try { return readlinkSync(`/proc/self/fd/${fd}`) === launcherReal; } catch { return false; } }).length;
    const port = scopedPort({ ...config, authorize: async () => {} });
    const debug = port.__debug();
    let reached!: () => void; const reachedP = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    debug.barrier = async () => { reached(); await held; };
    await quiesce();
    const launches = readLaunchCount(); const fds = launcherFds();
    const pending = port.spawn(spec, ctx).then(() => "spawned", () => "refused");
    await reachedP;                                                      // the handle is being acquired: verified, not yet opened
    await port.dispose();
    release();
    expect(await pending).toBe("refused");
    await Bun.sleep(80);
    expect(readLaunchCount()).toBe(launches);
    expect(launcherFds()).toBe(fds);
  });

  test("4: cancellation registrations are removed as operations settle: none remain after completed and refused spawns", async () => {
    const r = await rig(() => ({ kind: "plain", decision: "deny" }), {}, 600);
    try {
      for (let i = 0; i < 5; i++) await refused(r.port.spawn(spec, ctx));
      expect(r.port.__debug().registrations).toBe(0);
    } finally { await r.port.dispose(); await r.close(); }
    const ok = scopedPort({ ...config, authorize: async () => {} });
    try {
      for (let i = 0; i < 3; i++) await ok.spawn(spec, { intentId: `i${i}`, runId: `run-${i}` });
      expect(ok.__debug().registrations).toBe(0);
    } finally { await ok.dispose(); }
  });

  test("5: the launcher pin and its measured version are snapshotted at construction; mutating the config later changes nothing", async () => {
    const live = { ...config, launcher: { ...config.launcher } } as ContainedStdioPortConfig & { launcher: { path: string; sha256: string } };
    const port = scopedPort(live);
    const before = await port.plan(spec, ctx);
    live.launcher.sha256 = "0".repeat(64);                               // an in-place re-pin
    (live as { launcher: unknown }).launcher = { path: "/nonexistent/bwrap", sha256: "1".repeat(64) }; // and a replaced one
    (live as { launcherPatchedAttested?: boolean }).launcherPatchedAttested = true;
    const after = await port.plan(spec, ctx);
    expect(after.plan.launcher).toEqual(before.plan.launcher);
    expect(after.executionProfileDigest).toBe(before.executionProfileDigest);
    await port.dispose();
  });
});
