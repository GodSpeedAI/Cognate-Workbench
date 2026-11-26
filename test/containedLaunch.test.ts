// Unit tests for the contained launch plan, its digest and the pre-spawn refusals (SEA-Forge #114).
// These always run: they never start bubblewrap. The OS-boundary proof is J-RLM-contained-port.test.ts.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  config = { launcher: { path: launcher, sha256: sha(FAKE_LAUNCHER(marker, false)) }, executables: [{ path: executable, sha256: sha(EXE) }], workspaceRoot: workspace, envAllowlist: ["FIXTURE_FLAG"] };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const spec = (over: Partial<StdioSpawnSpec> & { restrictions?: StdioSpawnSpec["restrictions"] } = {}): StdioSpawnSpec => ({ argv: [executable, "--serve"], cwd: workspace, env: {}, restrictions: {}, ...over });
const refusal = async (promise: Promise<unknown>): Promise<RlmRefusedError> => {
  try { await promise; } catch (error) { if (error instanceof RlmRefusedError) return error; throw error; }
  throw new Error("expected a typed refusal, but the call succeeded");
};
const plan = (s: StdioSpawnSpec = spec(), c: ContainedStdioPortConfig = config) => buildLaunchPlan({ config: c, spec: s, launcherVersion: "0.13.1" });
const ctx = { intentId: "i", runId: "r" };

describe("launch plan", () => {
  test("is read-only, unshared, capability-free and records every control", async () => {
    const p = await plan();
    expect(p.restrictions).toEqual({ filesystem: "read-only", network: "none", credentials: "none", subprocess: "contained" });
    expect(p.workspace).toMatchObject({ mode: "read-only", sandboxPath: "/workspace", cwd: "/workspace" });
    for (const flag of ["--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session", "--clearenv"]) expect(p.sandboxArgv).toContain(flag);
    expect(p.sandboxArgv.join(" ")).toContain("--cap-drop ALL");
    expect(p.sandboxArgv.join(" ")).toContain(`--ro-bind ${workspace} /workspace`);
    expect(p.sandboxArgv).not.toContain("--share-net");
    expect(p.sandboxArgv).not.toContain("--bind"); // no writable bind in the default plan
    expect(p.sandboxArgv.join(" ")).not.toContain("/home");
    expect(p.sandboxArgv.join(" ")).toContain("--tmpfs /tmp");
    expect(p.sandboxArgv.join(" ")).toMatch(/--as=\d+ --cpu=\d+:\d+ --nofile=\d+ --nproc=\d+ --/);
    expect(p.executable).toEqual({ path: executable, sha256: sha(EXE) });
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
      expect(p.sandboxArgv.join(" ")).toContain(`--bind ${sock} /run/egress.sock`);
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
