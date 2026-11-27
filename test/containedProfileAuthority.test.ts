// #116 Workbench host half: a contained spawn launches only on a SEA-Forge decision that proves it authorized exactly
// the execution profile about to run. The route is the existing typed SeaForgeAuthority client; the stand-in below is a
// unix-socket SEA-Forge that answers the same NDJSON authority_request exchange with a CEP authority_decision, so the real
// client's decision parsing is part of what these tests exercise. Every refusal leaves the sandbox unspawned.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RlmRefusedError, SeaForgeAuthority } from "@godspeedai/cognate-runtime-bun";
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import type { ContainedStdioPortConfig } from "../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort } from "../src/capabilities/containedStdioPort.ts";
import { CONTAINED_SPAWN_CAPABILITY, checkProfileDecision, profileAuthorize, type ProfileAuthorization } from "../src/capabilities/containedProfileAuthority.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const ULID = "01HZX3Q7M9K2N4P6R8T0VWXYZ1"; // a SEA ledger entry (entry_ulid)
const WORLD = `world:test@sha256:${"a".repeat(64)}`;
const ctx = { intentId: "i", runId: "run-116" };
let root: string; let workspace: string; let marker: string; let config: ContainedStdioPortConfig; let spec: StdioSpawnSpec;
let launcherText: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "profile-auth-"));
  workspace = join(root, "ws"); await mkdir(workspace); await mkdir(join(root, "bin"));
  marker = join(root, "launcher-ran");
  launcherText = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\necho "$@" >> ${marker}\nexit 0\n`;
  const exeText = "#!/bin/sh\necho child\n";
  await writeFile(join(root, "bin", "bwrap"), launcherText); await chmod(join(root, "bin", "bwrap"), 0o755);
  await writeFile(join(root, "bin", "child"), exeText); await chmod(join(root, "bin", "child"), 0o755);
  config = { authorize: async () => {}, launcher: { path: join(root, "bin", "bwrap"), sha256: sha(launcherText) }, executables: [{ path: join(root, "bin", "child"), sha256: sha(exeText) }], workspaceRoot: workspace, writableRoots: [] };
  spec = { argv: [join(root, "bin", "child"), "--serve"], cwd: workspace, env: {}, restrictions: {} };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

/** Real spawns recorded by the stand-in launcher: only a spawn line carries the child's arguments (the namespace preflight runs /usr/bin/true). */
/** EVERY launcher invocation the stand-in recorded (the --version probe is not logged): a sandbox started for any reason, the namespace preflight included. */
const everyLaunch = async (): Promise<number> => (existsSync(marker) ? (await readFile(marker, "utf8")).split("\n").filter(Boolean).length : 0);
const lines = async (): Promise<number> => (existsSync(marker) ? (await readFile(marker, "utf8")).split("\n").filter((l) => l.includes("--serve")).length : 0);

/** What the stand-in SEA-Forge answers for one request. */
type Answer =
  | { kind: "boundary"; digests: string[]; extraConstraints?: { constraint_type: string; description: string }[]; noLedger?: boolean; decisionIdOnly?: boolean }
  | { kind: "plain"; decision: "allow" | "deny" | "escalate" | "constrained_allow" }
  | { kind: "malformed" } | { kind: "error" } | { kind: "silent" };

/** A unix-socket SEA-Forge: the CEP authority_decision for the request it received, or a defect. */
async function seaForge(path: string, answerFor: (digest: string | undefined, resource: string) => Answer, seen: { claims: unknown[]; resources: string[] }): Promise<Server> {
  const server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += String(chunk);
      if (!buffered.includes("\n")) return;
      const request = JSON.parse(buffered.slice(0, buffered.indexOf("\n")));
      const ext = request.envelope.extensions["godspeed.authority_request"];
      seen.claims.push(ext.claims);
      seen.resources.push(ext.resource_id);
      const answer = answerFor(ext.claims?.execution_profile_digest, ext.resource_id);
      if (answer.kind === "silent") return; // never answers: the client times out
      if (answer.kind === "malformed") { socket.end("this is not json\n"); return; }
      if (answer.kind === "error") { socket.end(JSON.stringify({ ok: false, error_class: "policy_unavailable", error: "no bundle" }) + "\n"); return; }
      const decision = answer.kind === "boundary" ? "boundary" : answer.decision;
      const constraints = answer.kind === "boundary"
        ? [...answer.digests.map((d) => ({ constraint_type: "execution_profile", description: d })), ...(answer.extraConstraints ?? [])]
        : [];
      socket.end(JSON.stringify({
        ok: true, final: true,
        envelope: {
          envelope_kind: "authority_decision", envelope_id: `dec-${request.request_id}`, lineage_refs: [request.envelope.envelope_id],
          scope: { world_ref: WORLD }, constraints,
          extensions: {
            "cep.profile": { profile_id: "godspeed.authority_decision", profile_version: "1.0.0" },
            "godspeed.authority_decision": { request_ref: request.envelope.envelope_id, operation_id: request.request_id, decision, ...(answer.kind === "boundary" && answer.noLedger ? {} : answer.kind === "boundary" && answer.decisionIdOnly ? { decision_id: "auth_01" } : { decision_id: `D-${request.request_id}`, ledger_entry: ULID }), ...(decision === "boundary" ? { policy_basis: ["rule:profile"] } : {}) },
          },
        },
      }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return server;
}

async function rig(answerFor: (digest: string | undefined, resource: string) => Answer, extra: Partial<ContainedStdioPortConfig> = {}, timeoutMs = 1500) {
  const socket = join(root, `sea-${Math.random().toString(36).slice(2)}.sock`);
  const seen = { claims: [] as unknown[], resources: [] as string[] };
  const server = await seaForge(socket, answerFor, seen);
  const records: ProfileAuthorization[] = [];
  const client = new SeaForgeAuthority({ socketPath: socket, timeoutMs, requestIdPrefix: "workbench" });
  const authorize = profileAuthorize({ authority: client, worldRef: WORLD, actor: { id: "system", kind: "system" }, tenant: "local", record: (r) => records.push(r) });
  const port = containedStdioSpawnPort({ ...config, authorize, ...extra });
  return { port, records, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const refused = async (promise: Promise<unknown>): Promise<RlmRefusedError> => {
  try { await promise; } catch (error) { if (error instanceof RlmRefusedError) return error; throw error; }
  throw new Error("expected a typed refusal, but the spawn went ahead");
};

describe("#116: the host asks SEA-Forge and launches only on the exact boundary allow", () => {
  test("a boundary allow carrying exactly the profile digest spawns, and the evidence holds digests and the decision id only", async () => {
    const policy = (await containedStdioSpawnPort(config).executionProfile(spec)).digest; // what an operator wrote into policy
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
      expect(() => containedStdioSpawnPort({ ...config, authorize: bad } as unknown as ContainedStdioPortConfig)).toThrow(/authorize/);
    }
    expect(await lines()).toBe(before);
  });

  test("an unreachable SEA-Forge (no socket at all) refuses", async () => {
    const client = new SeaForgeAuthority({ socketPath: join(root, "absent.sock"), timeoutMs: 300 });
    const port = containedStdioSpawnPort({ ...config, authorize: profileAuthorize({ authority: client, worldRef: WORLD, actor: { id: "system", kind: "system" }, tenant: "local" }) });
    const e = await refused(port.spawn(spec, ctx));
    expect(e.reason).toContain("rlm-profile-unauthorized");
    await port.dispose();
  });

  test("changing the profile after policy was written refuses: a different ceiling is a different digest", async () => {
    const written = (await containedStdioSpawnPort(config).executionProfile(spec)).digest;
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
      const before = await everyLaunch();
      await refused(r.port.spawn(spec, ctx));
      expect(await everyLaunch()).toBe(before);
    } finally { await r.port.dispose(); await r.close(); }
  });

  test("M7: disposal while the authority reply is pending launches nothing", async () => {
    let release!: () => void; let asked!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const askedAt = new Promise<void>((resolve) => { asked = resolve; });
    const authority = { decide: async () => { asked(); await held; return { disposition: "boundary" as const, reason: "ok", decisionRef: ULID, constraints: [{ type: "execution_profile", value: (await containedStdioSpawnPort(config).executionProfile(spec)).digest }] }; } };
    const port = containedStdioSpawnPort({ ...config, authorize: profileAuthorize({ authority, worldRef: WORLD, actor: { id: "s", kind: "system" }, tenant: "t" }) });
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

describe("#114 delta-1: the port is bound to the provider's declared reach, and pinned descriptors never leak", () => {
  let sockDir: string; let sockPath: string; let listener: Server;
  beforeAll(async () => {
    sockDir = await mkdtemp(join(tmpdir(), "profile-sock-"));
    sockPath = join(sockDir, "egress.sock");
    listener = createServer(() => {});
    await new Promise<void>((resolve) => listener.listen(sockPath, resolve));
  });
  afterAll(async () => { await new Promise<void>((resolve) => listener.close(() => resolve())); await rm(sockDir, { recursive: true, force: true }); });
  const egressSpec = (): StdioSpawnSpec => ({ ...spec, restrictions: { network: { outbound: [`host-socket:${sockPath}`] } } });
  const declare = (port: unknown, runId: string, reach: "none" | "host-socket") => (port as { declareReach?: (r: string, v: string) => void }).declareReach?.(runId, reach);

  test("M9: a provider that declared no network cannot launch with the host socket; one that declared it reaches the authority", async () => {
    let asked = 0;
    const authorize = async () => { asked += 1; throw new RlmRefusedError("rlm-containment-unavailable", "rlm-profile-unauthorized: test stop"); };
    const port = containedStdioSpawnPort({ ...config, hostSocket: sockPath, authorize });
    try {
      declare(port, "run-none", "none");
      const denied = await refused(port.spawn(egressSpec(), { intentId: "i", runId: "run-none" }));
      expect(denied.reason).toMatch(/declared/);
      expect(asked).toBe(0);                                                          // refused BEFORE any authority request
      const undeclared = await refused(port.spawn(egressSpec(), { intentId: "i", runId: "run-undeclared" }));
      expect(undeclared.reason).toMatch(/declared/);                                  // no declaration is the most restrictive one
      expect(asked).toBe(0);
      declare(port, "run-sock", "host-socket");                                       // positive control: the same spec, declared, reaches the authority
      const allowed = await refused(port.spawn(egressSpec(), { intentId: "i", runId: "run-sock" }));
      expect(allowed.reason).toContain("test stop");
      expect(asked).toBe(1);
    } finally { await port.dispose(); }
  });

  test("L11: an egress socket that vanishes while authority is pending leaks no descriptor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "profile-leak-"));
    const sock = join(dir, "e.sock");
    const one = createServer(() => {});
    await new Promise<void>((resolve) => one.listen(sock, resolve));
    // Descriptors on THIS test's pinned objects only: other files' sandboxes and pipes come and go in the same process, so a raw
    // fd total is not stable, but a leaked workspace or socket descriptor is exactly one more link to these paths.
    const count = (): number => readdirSync("/proc/self/fd").filter((fd) => { try { const link = readlinkSync(`/proc/self/fd/${fd}`); return link === workspace || link === sock; } catch { return false; } }).length;
    try {
      const port = containedStdioSpawnPort({ ...config, hostSocket: sock, authorize: async () => { await new Promise<void>((resolve) => one.close(() => resolve())); await rm(sock, { force: true }); } });
      declare(port, "run-leak", "host-socket");
      const sp = { ...spec, restrictions: { network: { outbound: [`host-socket:${sock}`] } } };
      await refused(port.spawn(sp, { intentId: "i", runId: "run-leak" }));            // warm anything lazily opened, then measure
      const before = count();
      for (let i = 0; i < 3; i++) {
        const again = createServer(() => {}); await new Promise<void>((resolve) => again.listen(sock, resolve));
        const p2 = containedStdioSpawnPort({ ...config, hostSocket: sock, authorize: async () => { await new Promise<void>((resolve) => again.close(() => resolve())); await rm(sock, { force: true }); } });
        declare(p2, "run-leak", "host-socket");
        const e = await refused(p2.spawn(sp, { intentId: "i", runId: "run-leak" }));
        expect(e.reason).toMatch(/could not be opened|no longer/);
        await p2.dispose();
      }
      expect(count()).toBe(before);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
