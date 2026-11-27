// Unit tests for the contained launch plan, its digest and the pre-spawn refusals (SEA-Forge #114).
// These always run: they never start bubblewrap. The OS-boundary proof is J-RLM-contained-port.test.ts.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { buildLaunchPlan, canonicalJson, launchPlanDigest, type ContainedStdioPortConfig } from "../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort } from "../src/capabilities/containedStdioPort.ts";
import { providerRefusal } from "../src/capabilities/rlmGoverned.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
let root: string;
let workspace: string;
let launcher: string;
let executable: string;
let marker: string;
let config: ContainedStdioPortConfig;

// A stand-in launcher: reports a version, and records any real invocation. `userns` mode fails the way
// bubblewrap does when user namespaces are unavailable.
const FAKE_LAUNCHER = (marker: string, ok: boolean): string => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\necho "$@" >> ${marker}\n${ok ? "exit 0" : "echo 'bwrap: No permissions to create new namespace' >&2; exit 1"}\n`;
const EXE = "#!/bin/sh\necho child\n";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "contained-launch-"));
  workspace = join(root, "workspace");
  await mkdir(join(workspace, "sub"), { recursive: true });
  launcher = join(root, "bin", "bwrap");
  executable = join(root, "bin", "child");
  marker = join(root, "launcher-ran");
  await mkdir(join(root, "bin"));
  await writeFile(launcher, FAKE_LAUNCHER(marker, false));
  await writeFile(executable, EXE);
  await chmod(launcher, 0o755);
  await chmod(executable, 0o755);
  config = { launcher: { path: launcher, sha256: sha(FAKE_LAUNCHER(marker, false)) }, executables: [{ path: executable, sha256: sha(EXE) }], workspaceRoot: workspace, writableRoots: [], envAllowlist: ["FIXTURE_FLAG"] };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const ctx = { intentId: "i", runId: "r" };
const KEY = new Uint8Array(32).fill(7);
const spec = (over: Partial<StdioSpawnSpec> & { restrictions?: StdioSpawnSpec["restrictions"] } = {}): StdioSpawnSpec => ({ argv: [executable, "--serve"], cwd: workspace, env: {}, restrictions: {}, ...over });
const refusal = async (promise: Promise<unknown>): Promise<RlmRefusedError> => {
  try { await promise; } catch (error) { if (error instanceof RlmRefusedError) return error; throw error; }
  throw new Error("expected a typed refusal, but the call succeeded");
};
const plan = async (s: StdioSpawnSpec = spec(), c: ContainedStdioPortConfig = config, c2 = ctx) => (await buildLaunchPlan({ config: c, spec: s, ctx: c2, envKey: KEY, launcherVersion: "0.13.1" })).plan;
const material = async (s: StdioSpawnSpec = spec(), c: ContainedStdioPortConfig = config) => (await buildLaunchPlan({ config: c, spec: s, ctx, envKey: KEY, launcherVersion: "0.13.1" })).material;

describe("launch plan", () => {
  test("is read-only, unshared, capability-free and records every control", async () => {
    const p = await plan();
    expect(p.restrictions).toEqual({ filesystem: "read-only", network: "none", credentials: "none", subprocess: "contained" });
    expect(p.workspace).toMatchObject({ mode: "read-only", sandboxPath: "/workspace", cwd: "/workspace", path: workspace });
    expect(p.workspace.dev).toMatch(/^\d+$/);
    expect(p.workspace.ino).toMatch(/^\d+$/);
    expect(p.binding).toEqual(ctx);
    for (const flag of ["--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session", "--clearenv"]) expect(p.sandboxArgv).toContain(flag);
    expect(p.sandboxArgv.join(" ")).toContain("--cap-drop ALL");
    expect(p.sandboxArgv.join(" ")).toContain("--ro-bind-fd 3 /workspace"); // bound by inherited descriptor, never re-resolved by path
    expect(p.sandboxArgv.join(" ")).toContain("--args 4");
    expect(p.sandboxArgv.join(" ")).toMatch(/--size \d+ --tmpfs \/tmp/);
    expect(p.sandboxArgv).not.toContain("--share-net");
    expect(p.sandboxArgv).not.toContain("--bind"); // no writable bind in the default plan
    expect(p.sandboxArgv).not.toContain("--bind-fd");
    expect(p.sandboxArgv.join(" ")).not.toContain("/home");
    expect(p.sandboxArgv.join(" ")).toContain("--tmpfs /tmp");
    expect(p.sandboxArgv.join(" ")).toMatch(/--as=\d+ --cpu=\d+:\d+ --nofile=\d+ --nproc=\d+ --fsize=\d+ --/);
    expect(p.executable).toMatchObject({ path: executable, sha256: sha(EXE), bound: "fd" });
    expect(p.sandboxArgv.join(" ")).toContain("--ro-bind-fd 6 /opt/cognate/bin/child");
    expect(p.argv.slice(1)).toEqual(["--serve"]);
    expect(Object.keys(p.env).sort()).toEqual(["HOME", "PATH"]);
  });

  test("digest is canonical: key order does not matter, any field change does", async () => {
    const p = await plan();
    const shuffled = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(p).reverse())));
    expect(canonicalJson(shuffled)).toBe(canonicalJson(p));
    const digest = launchPlanDigest(p);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(launchPlanDigest(await plan())).toBe(digest);
    const variants: StdioSpawnSpec[] = [
      spec({ argv: [executable, "--other"] }),
      spec({ cwd: join(workspace, "sub") }),
      spec({ env: { FIXTURE_FLAG: "1" } }),
      spec({ restrictions: { caps: { memoryBytes: 1_000_000 } } }),
      spec({ restrictions: { caps: { cpuSeconds: 3 } } }),
    ];
    for (const variant of variants) expect(launchPlanDigest(await plan(variant))).not.toBe(digest);
    expect(launchPlanDigest(await plan(spec(), { ...config, ceilings: { outputBytes: 2048 } }))).not.toBe(digest);
    expect(launchPlanDigest({ ...p, launcher: { ...p.launcher, version: "0.13.2" } })).not.toBe(digest);
  });

  test("a host socket is one exact bound path and the only network exception", async () => {
    const sock = join(root, "egress.sock");
    const server = Bun.listen({ unix: sock, socket: { data() {} } });
    try {
      const withSocket = { ...config, hostSocket: sock };
      const p = await plan(spec({ restrictions: { network: { outbound: [`host-socket:${sock}`] } } }), withSocket);
      expect(p.restrictions.network).toBe(`host-socket:${sock}`);
      expect(p.sandboxArgv.join(" ")).toContain("--bind-fd 5 /run/egress.sock");
      expect(p.egress).toMatchObject({ path: realpathSync(sock) });
      expect(p.sandboxArgv).toContain("--unshare-all");
      expect(p.env.SEA_EGRESS_SOCKET).toBe("/run/egress.sock");
      expect(launchPlanDigest(p)).not.toBe(launchPlanDigest(await plan(spec(), withSocket)));
    } finally { server.stop(true); }
  });
});

describe("refusals happen before any spawn, with typed Cognate codes", () => {
  test("outbound network other than the host socket is rlm-egress-uncontrolled", async () => {
    for (const outbound of [["*"], ["example.com:443"], ["host-socket:/tmp/other.sock"], ["host-socket:/a", "host-socket:/b"]]) {
      expect((await refusal(plan(spec({ restrictions: { network: { outbound } } })))).code).toBe("rlm-egress-uncontrolled");
    }
    const missing = join(root, "absent.sock");
    expect((await refusal(plan(spec({ restrictions: { network: { outbound: [`host-socket:${missing}`] } } }), { ...config, hostSocket: missing }))).code).toBe("rlm-egress-uncontrolled");
  });

  test("restrictions the port cannot enforce are refused, never narrowed", async () => {
    expect((await refusal(plan(spec({ restrictions: { filesystem: ["workspace:rw"] } })))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec({ restrictions: { subprocess: false } })))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec({ restrictions: { caps: { memoryBytes: 2 ** 40 } } })))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec({ restrictions: { caps: { cpuSeconds: 100_000 } } })))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec({ env: { SECRET_TOKEN: "x" } })))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec({ cwd: root })))).code).toBe("rlm-containment-unavailable");
  });

  test("executables must be pinned, digest-matching and outside writable roots", async () => {
    const other = join(root, "bin", "other");
    await writeFile(other, EXE);
    await chmod(other, 0o755);
    expect((await refusal(plan(spec({ argv: [other] })))).code).toBe("rlm-port-unavailable");
    expect((await refusal(plan(spec({ argv: [join(root, "bin", "nope")] })))).code).toBe("rlm-port-unavailable");
    expect((await refusal(plan(spec(), { ...config, executables: [{ path: executable, sha256: sha("tampered") }] }))).code).toBe("rlm-port-unavailable");
    const inWorkspace = join(workspace, "child");
    await writeFile(inWorkspace, EXE);
    await chmod(inWorkspace, 0o755);
    const pinned = { ...config, executables: [{ path: inWorkspace, sha256: sha(EXE) }] };
    expect((await refusal(plan(spec({ argv: [inWorkspace] }), pinned))).code).toBe("rlm-containment-unavailable");
    // A symlink inside a writable root to a pinned outside binary resolves outside and is allowed; the reverse is refused.
    const writableLink = join(root, "wr");
    await mkdir(writableLink);
    await writeFile(join(writableLink, "child"), EXE);
    await chmod(join(writableLink, "child"), 0o755);
    await symlink(join(writableLink, "child"), join(root, "bin", "via-link"));
    const viaLink = { ...config, writableRoots: [writableLink], executables: [{ path: join(root, "bin", "via-link"), sha256: sha(EXE) }] };
    expect((await refusal(plan(spec({ argv: [join(root, "bin", "via-link")] }), viaLink))).code).toBe("rlm-containment-unavailable");
  });

  test("a launcher that is missing, swapped, unpatched or inside a writable root is refused", async () => {
    const port = (c: ContainedStdioPortConfig) => containedStdioSpawnPort(c);
    const missing = { ...config, launcher: { path: join(root, "bin", "no-bwrap"), sha256: "0".repeat(64) } };
    expect((await refusal(port(missing).spawn(spec(), ctx))).code).toBe("rlm-containment-unavailable");
    const swapped = { ...config, launcher: { ...config.launcher, sha256: sha("something else") } };
    expect((await refusal(port(swapped).spawn(spec(), ctx))).code).toBe("rlm-containment-unavailable");
    expect((await refusal(plan(spec(), { ...config, writableRoots: [join(root, "bin")] }))).code).toBe("rlm-containment-unavailable");
    const old = join(root, "bin", "old-bwrap");
    const text = FAKE_LAUNCHER(marker, true).replace("0.13.1", "0.11.0");
    await writeFile(old, text);
    await chmod(old, 0o755);
    const unpatched = { ...config, launcher: { path: old, sha256: sha(text) } };
    expect((await refusal(port(unpatched).spawn(spec(), ctx))).code).toBe("rlm-containment-unavailable");
    expect(existsSync(marker)).toBe(false); // no launcher invocation beyond --version for any of the above
  });

  test("unavailable user namespaces refuse; the executable never ran and there is no fallback", async () => {
    await expect(refusal(containedStdioSpawnPort(config).spawn(spec(), ctx))).resolves.toMatchObject({ code: "rlm-containment-unavailable" });
    // The only launcher invocation was the namespace preflight, which failed; the child executable has no marker of its own.
    expect((await readFile(marker, "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
    expect((await readFile(marker, "utf8"))).toContain("/usr/bin/true");
  });

  test("drift between authorization and spawn refuses and spawns nothing", async () => {
    const okLauncher = join(root, "bin", "ok-bwrap");
    const okText = FAKE_LAUNCHER(join(root, "ok-ran"), true);
    await writeFile(okLauncher, okText);
    await chmod(okLauncher, 0o755);
    const drifting = { ...config, launcher: { path: okLauncher, sha256: sha(okText) } };
    let authorized: string | undefined;
    const port = containedStdioSpawnPort({
      ...drifting,
      authorize: async (_plan, digest) => { authorized = digest; await writeFile(executable, "#!/bin/sh\necho swapped\n"); },
    });
    const error = await refusal(port.spawn(spec(), ctx));
    expect(authorized).toMatch(/^sha256:/);
    expect(error.code).toBe("rlm-port-unavailable");
    expect(error.reason).toContain("digest");
    await writeFile(executable, EXE); // restore for the remaining tests
    // preflight ran once (before authorize); the real spawn never happened
    expect((await readFile(join(root, "ok-ran"), "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("an authority refusal stops the spawn", async () => {
    const okLauncher = join(root, "bin", "ok-bwrap");
    const okText = FAKE_LAUNCHER(join(root, "ok-ran"), true);
    const port = containedStdioSpawnPort({ ...config, launcher: { path: okLauncher, sha256: sha(okText) }, authorize: async () => { throw new RlmRefusedError("rlm-posture-refused", "no authority decision binds this digest"); } });
    expect((await refusal(port.spawn(spec(), ctx))).code).toBe("rlm-posture-refused");
  });

  test("an unknown contained id is not a process; kill is idempotent", async () => {
    const port = containedStdioSpawnPort(config);
    await port.kill("nope", "x");
    await port.kill("nope", "x");
    await expect(port.write("nope", "x")).rejects.toThrow();
  });
});

describe("provider admission follows the registered port", () => {
  const facts = { capabilities: { isolation: "namespace" }, toolPolicy: "contained", executable: { version: "1", sha256: "a".repeat(64) } } as unknown as Parameters<typeof providerRefusal>[1];
  const entry = { provider: { id: "p" }, portGovernance: { world: "contained-streaming", reach: { filesystem: "workspace-ro", network: "none", process: "group-kill", lifetime: "parent-death" }, evidence: "process-ledger" } } as unknown as Parameters<typeof providerRefusal>[0];
  test("without the port a contained provider is refused (today's behaviour)", () => {
    expect(providerRefusal(entry, facts)?.code).toBe("rlm-containment-unavailable");
  });
  test("with the port a no-network contained provider is admitted; open egress still is not", () => {
    expect(providerRefusal(entry, facts, true)).toBeUndefined();
    const open = { ...entry, portGovernance: { ...entry.portGovernance!, reach: { ...entry.portGovernance!.reach, network: "open" } } } as typeof entry;
    expect(providerRefusal(open, facts, true)?.code).toBe("rlm-egress-uncontrolled");
  });
});

// ── review findings (#114 review pass 1) ─────────────────────────────────────────────────
const okLauncherFor = async (name: string, marker2: string): Promise<{ path: string; sha256: string }> => {
  const path = join(root, "bin", name);
  const text = FAKE_LAUNCHER(marker2, true);
  await writeFile(path, text);
  await chmod(path, 0o755);
  return { path, sha256: sha(text) };
};

describe("H1: the workspace and the egress socket are pinned, not re-resolved", () => {
  test("the plan records resolved path, dev and inode of the workspace; retargeting a symlinked workspace is a different plan", async () => {
    const a = join(root, "wsA"); const b = join(root, "wsB"); const link = join(root, "ws-link");
    await mkdir(a); await mkdir(b); await symlink(a, link);
    const linked = { ...config, workspaceRoot: link };
    const first = await plan(spec({ cwd: a }), linked);
    expect(first.workspace.path).toBe(realpathSync(a));
    await rm(link); await symlink(b, link);
    const second = await plan(spec({ cwd: b }), linked);
    expect(second.workspace.path).toBe(realpathSync(b));
    expect(launchPlanDigest(second)).not.toBe(launchPlanDigest(first));
    expect(second.workspace.ino).not.toBe(first.workspace.ino);
  });

  test("swapping the workspace symlink between authorization and spawn refuses; nothing is spawned", async () => {
    const a = join(root, "swapA"); const b = join(root, "swapB"); const link = join(root, "swap-link");
    await mkdir(a); await mkdir(b); await symlink(a, link);
    const lc = await okLauncherFor("swap-bwrap", join(root, "swap-ran"));
    const port = containedStdioSpawnPort({ ...config, launcher: lc, workspaceRoot: link, authorize: async () => { await rm(link); await symlink(b, link); } });
    const error = await refusal(port.spawn(spec({ cwd: link }), ctx));
    expect(error.code).toBe("rlm-containment-unavailable");
    expect(error.reason).toContain("drifted");
    // Only the namespace preflight ran; the real spawn never happened.
    expect((await readFile(join(root, "swap-ran"), "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("a workspace replaced after planning (new inode at the same path) is refused when opened", async () => {
    const dir = join(root, "replaced"); await mkdir(dir);
    const lc = await okLauncherFor("replace-bwrap", join(root, "replace-ran"));
    const port = containedStdioSpawnPort({ ...config, launcher: lc, workspaceRoot: dir, authorize: async () => { await rename(dir, `${dir}.old`); await mkdir(dir); } });
    const error = await refusal(port.spawn(spec({ cwd: dir }), ctx));
    expect(error.code).toBe("rlm-containment-unavailable");
    expect(error.reason).toMatch(/no longer the object|could not be opened/);
  });

  test("a workspace or socket directory others can write to, or that the host user does not own, is refused", async () => {
    const loose = join(root, "loose-ws"); await mkdir(loose); await chmod(loose, 0o775);
    expect((await refusal(plan(spec({ cwd: loose }), { ...config, workspaceRoot: loose }))).code).toBe("rlm-containment-unavailable");
    const sockDir = join(root, "loose-sock"); await mkdir(sockDir); await chmod(sockDir, 0o777);
    const sock = join(sockDir, "e.sock");
    const server = Bun.listen({ unix: sock, socket: { data() {} } });
    try {
      const e = await refusal(plan(spec({ restrictions: { network: { outbound: [`host-socket:${sock}`] } } }), { ...config, hostSocket: sock }));
      expect(e.code).toBe("rlm-egress-uncontrolled");
    } finally { server.stop(true); }
    expect((await refusal(plan(spec({ cwd: "/" }), { ...config, workspaceRoot: "/usr" }))).code).toBe("rlm-containment-unavailable"); // root-owned but not the dedicated workspace: cwd outside
  });

  test("a symlinked host socket is resolved and recorded; retargeting it changes the plan", async () => {
    const dir = join(root, "sockdir"); await mkdir(dir);
    const real1 = join(dir, "one.sock"); const real2 = join(dir, "two.sock"); const link = join(dir, "link.sock");
    const s1 = Bun.listen({ unix: real1, socket: { data() {} } });
    const s2 = Bun.listen({ unix: real2, socket: { data() {} } });
    try {
      await symlink(real1, link);
      const withSock = { ...config, hostSocket: link };
      const net = spec({ restrictions: { network: { outbound: [`host-socket:${link}`] } } });
      const first = await plan(net, withSock);
      expect(first.egress?.path).toBe(realpathSync(real1));
      await rm(link); await symlink(real2, link);
      const second = await plan(net, withSock);
      expect(second.egress?.path).toBe(realpathSync(real2));
      expect(launchPlanDigest(second)).not.toBe(launchPlanDigest(first));
    } finally { s1.stop(true); s2.stop(true); }
  });
});

describe("M4: a restriction or cap the port does not handle is refused, never dropped", () => {
  test("unknown spec, restriction, network and cap keys", async () => {
    const cases: [string, unknown][] = [
      ["restriction", { credentials: "none" }],
      ["restriction", { wallClockSeconds: 5 }],
      ["network restriction", { network: { outbound: [], inbound: ["*"] } }],
      ["cap", { caps: { memoryBytes: 1000, wallSeconds: 1 } }],
    ];
    for (const [, restrictions] of cases) {
      const e = await refusal(plan(spec({ restrictions: restrictions as StdioSpawnSpec["restrictions"] })));
      expect(e.code).toBe("rlm-containment-unavailable");
      expect(e.reason).toContain("not enforced by this port");
    }
    const extra = { ...spec(), stdin: "inherit" } as unknown as StdioSpawnSpec;
    expect((await refusal(plan(extra))).code).toBe("rlm-containment-unavailable");
  });
});

describe("M6: binaries must be trusted, not merely pinned; writableRoots is explicit", () => {
  test("missing writableRoots is a configuration error", () => {
    const { writableRoots: _omitted, ...bad } = config;
    expect(() => containedStdioSpawnPort(bad as ContainedStdioPortConfig)).toThrow(/writableRoots/);
  });

  test("a group-writable launcher or executable, or one in a world-writable directory, is refused despite a matching digest", async () => {
    const dir = join(root, "bin2"); await mkdir(dir);
    const exe = join(dir, "child"); await writeFile(exe, EXE); await chmod(exe, 0o775);
    const pinned = { ...config, executables: [{ path: exe, sha256: sha(EXE) }] };
    expect((await refusal(plan(spec({ argv: [exe] }), pinned))).code).toBe("rlm-containment-unavailable");
    await chmod(exe, 0o755); await chmod(dir, 0o777);
    const e2 = await refusal(plan(spec({ argv: [exe] }), pinned));
    expect(e2.code).toBe("rlm-containment-unavailable");
    expect(e2.reason).toContain("writable");
    await chmod(dir, 0o755);
    await plan(spec({ argv: [exe] }), pinned); // once trusted, it plans
    const lc = join(dir, "bwrap"); await writeFile(lc, FAKE_LAUNCHER(marker, false)); await chmod(lc, 0o775);
    const looseLauncher = { ...config, launcher: { path: lc, sha256: sha(FAKE_LAUNCHER(marker, false)) } };
    expect((await refusal(plan(spec(), looseLauncher))).code).toBe("rlm-containment-unavailable");
  });
});

describe("L1/L3: probe argv is structural; environment values stay out of the plan and the process table", () => {
  test("an allowlisted value of '--' cannot cut the probe and no value appears in the plan or argv", async () => {
    const withEnv = { ...config, envAllowlist: ["FIXTURE_FLAG", "OTHER"] };
    const s = spec({ env: { FIXTURE_FLAG: "--", OTHER: "s3cret-value-123" } });
    const built = await buildLaunchPlan({ config: withEnv, spec: s, ctx, envKey: KEY, launcherVersion: "0.13.1" });
    expect(built.material.probeArgv.filter((a) => a === "--")).toHaveLength(1);
    expect(built.material.probeArgv.at(-2)).toBe("--");
    expect(JSON.stringify(built.plan)).not.toContain("s3cret-value-123");
    expect(built.plan.sandboxArgv.join("\0")).not.toContain("s3cret-value-123");
    expect(built.plan.userEnvHmac.OTHER).toMatch(/^[0-9a-f]{64}$/);
    expect(built.plan.userEnvHmac.OTHER).not.toBe(sha("s3cret-value-123")); // keyed, not a plain hash;
    expect(built.material.argsFile).toContain("s3cret-value-123");
    // The authorize payload and inspect() carry the plan only.
    let seen = "";
    const lc = await okLauncherFor("env-bwrap", join(root, "env-ran"));
    const port = containedStdioSpawnPort({ ...withEnv, launcher: lc, authorize: async (p, d) => { seen = JSON.stringify({ p, d }); } });
    const { id } = await port.spawn(s, ctx);
    expect(seen).not.toContain("s3cret-value-123");
    expect(JSON.stringify(port.inspect(id).plan)).not.toContain("s3cret-value-123");
    await port.dispose();
  });
});

describe("L2: drift between the two plan computations", () => {
  test("a configuration change between the computations reaches the drift branch", async () => {
    const lc = await okLauncherFor("drift2-bwrap", join(root, "drift2-ran"));
    let widened = false; // flipped by the authorize hook, i.e. between the two plan computations
    const flaky = { ...config, launcher: lc, get ceilings() { return widened ? { outputBytes: 8192 } : { outputBytes: 4096 }; }, authorize: async () => { widened = true; } } as ContainedStdioPortConfig;
    const e = await refusal(containedStdioSpawnPort(flaky).spawn(spec(), ctx));
    expect(e.code).toBe("rlm-containment-unavailable");
    expect(e.reason).toContain("drifted");
  });
});

describe("L4/L5/M1: run binding, retention, unknown namespace", () => {
  test("the digest binds the run and intent", async () => {
    const a = launchPlanDigest(await plan(spec(), config, { intentId: "i", runId: "r1" }));
    const b = launchPlanDigest(await plan(spec(), config, { intentId: "i", runId: "r2" }));
    const c = launchPlanDigest(await plan(spec(), config, { intentId: "i2", runId: "r1" }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test("a run-bound view cannot write to, read from or kill another run's process", async () => {
    const lc = await okLauncherFor("run-bwrap", join(root, "run-ran"));
    const port = containedStdioSpawnPort({ ...config, launcher: lc });
    const { id } = await port.spawn(spec(), ctx);
    const other = port.forRun({ intentId: "i", runId: "someone-else" });
    await expect(other.write(id, "x")).rejects.toThrow(/another run/);
    await expect(other.kill(id, "x")).rejects.toThrow(/another run/);
    await expect(other.readLines(id, () => {})).rejects.toThrow(/another run/);
    await expect(other.spawn(spec(), ctx)).rejects.toThrow(/another run/);
    const mine = port.forRun(ctx);
    await mine.kill(id, "done"); // the owner may
    await port.dispose();
  });

  test("finished processes are pruned to a bounded retention; the oldest exit record is dropped", async () => {
    const lc = await okLauncherFor("prune-bwrap", join(root, "prune-ran"));
    const port = containedStdioSpawnPort({ ...config, launcher: lc });
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) { const { id } = await port.spawn(spec(), { intentId: "i", runId: `r${i}` }); ids.push(id); await port.exited(id); }
    expect(() => port.inspect(ids[0]!)).toThrow(/unknown/);
    expect(port.inspect(ids.at(-1)!).exit?.reason).toBe("exited");
  }, 60_000);

  test("a sandbox whose pid namespace was never identified is not reported as a clean teardown", async () => {
    const lc = await okLauncherFor("ns-bwrap", join(root, "ns-ran"));
    const port = containedStdioSpawnPort({ ...config, launcher: lc });
    const { id } = await port.spawn(spec(), ctx);
    const exit = await port.exited(id);
    expect(exit.nsKnown).toBe(false);
    expect(exit.residualPids).toEqual([]);
  });
});

describe("N2/N4/N5/N6", () => {
  test("N2: the executable is bound by descriptor with its identity recorded; a replacement with the same bytes is a different object", async () => {
    const exe = join(root, "bin", "swap-child"); await writeFile(exe, EXE); await chmod(exe, 0o755);
    const pinned = { ...config, executables: [{ path: exe, sha256: sha(EXE) }] };
    const built = await plan(spec({ argv: [exe] }), pinned);
    expect(built.executable.ino).toMatch(/^\d+$/);
    expect(built.executable.bound).toBe("fd");
    const lc = await okLauncherFor("exe-bwrap", join(root, "exe-ran"));
    const port = containedStdioSpawnPort({ ...pinned, launcher: lc, authorize: async () => { await writeFile(`${exe}.new`, EXE); await chmod(`${exe}.new`, 0o755); await rename(`${exe}.new`, exe); } });
    const e = await refusal(port.spawn(spec({ argv: [exe] }), ctx));
    expect(e.code).toBe("rlm-containment-unavailable");
    expect(e.reason).toMatch(/no longer the object|drifted/);
    expect((await readFile(join(root, "exe-ran"), "utf8")).split("\n").filter(Boolean)).toHaveLength(1); // preflight only
  });

  test("N4: the environment digest is keyed per port: stable within a port, different across ports", async () => {
    const lc = await okLauncherFor("hmac-bwrap", join(root, "hmac-ran"));
    const withEnv = { ...config, launcher: lc, envAllowlist: ["FIXTURE_FLAG"] };
    const s = spec({ env: { FIXTURE_FLAG: "low-entropy" } });
    const a = containedStdioSpawnPort(withEnv); const b = containedStdioSpawnPort(withEnv);
    const a1 = await a.plan(s, ctx); const a2 = await a.plan(s, ctx); const b1 = await b.plan(s, ctx);
    expect(a1.plan.userEnvHmac.FIXTURE_FLAG).toBe(a2.plan.userEnvHmac.FIXTURE_FLAG);
    expect(a1.digest).toBe(a2.digest);
    expect(b1.plan.userEnvHmac.FIXTURE_FLAG).not.toBe(a1.plan.userEnvHmac.FIXTURE_FLAG);
    expect(b1.plan.userEnvHmac.FIXTURE_FLAG).not.toBe(sha("low-entropy"));
  });

  test("N5: malformed specs are typed refusals, not TypeErrors", async () => {
    const bad: unknown[] = [
      null, "spec", { ...spec(), restrictions: undefined }, { ...spec(), restrictions: null }, { ...spec(), restrictions: [] },
      { ...spec(), argv: "not-an-array" }, { ...spec(), argv: [1] }, { ...spec(), cwd: 5 }, { ...spec(), env: undefined }, { ...spec(), env: { A: 1 } },
      spec({ restrictions: { network: { outbound: "host-socket:/x" } } as never }),
      spec({ restrictions: { network: "none" } as never }),
      spec({ restrictions: { filesystem: "read-only" } as never }),
      spec({ restrictions: { caps: { memoryBytes: "big" } } as never }),
      spec({ restrictions: { subprocess: "yes" } as never }),
    ];
    for (const b of bad) {
      const e = await refusal(plan(b as StdioSpawnSpec));
      expect(e.code).toBe("rlm-containment-unavailable");
    }
  });

  test("N6: a launcher in a writable root or a loose directory is never executed, not even for --version", async () => {
    const ran = join(root, "n6-ran");
    const text = `#!/bin/sh\necho ran >> ${ran}\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; fi\nexit 0\n`;
    const writableDir = join(root, "n6-writable"); await mkdir(writableDir);
    const inWritable = join(writableDir, "bwrap"); await writeFile(inWritable, text); await chmod(inWritable, 0o755);
    const pinned = { path: inWritable, sha256: sha(text) };
    expect((await refusal(containedStdioSpawnPort({ ...config, launcher: pinned, writableRoots: [writableDir] }).spawn(spec(), ctx))).code).toBe("rlm-containment-unavailable");
    await chmod(inWritable, 0o775);
    expect((await refusal(containedStdioSpawnPort({ ...config, launcher: pinned }).spawn(spec(), ctx))).code).toBe("rlm-containment-unavailable");
    expect(existsSync(ran)).toBe(false);
  });
});
