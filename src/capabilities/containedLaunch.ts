// Contained launch plan (SEA-Forge #114). A canonical, digestible record of exactly what the host
// will run inside bubblewrap for a recursive-child provider: the pinned executable and launcher,
// the full sandbox argv, the workspace mount, the enforced restrictions, the kernel ceilings and
// the environment. `launchPlanDigest` is the identity ticket #116 binds a SEA authority decision to;
// the port recomputes it immediately before spawn and refuses on any drift.
//
// Everything here is host-owned and pure of side effects except `hashFile`/`realpath` reads. Nothing
// is taken from a request except the spec the port validates against trusted host configuration.
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import type { RlmRefusalCode, StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";

export interface PinnedBinary {
  readonly path: string;
  /** Lowercase hex sha256 of the binary, pinned by trusted host configuration. */
  readonly sha256: string;
}

export interface ContainedCeilings {
  readonly wallSeconds: number;
  readonly cpuSeconds: number;
  readonly addressSpaceBytes: number;
  readonly nofile: number;
  readonly nproc: number;
  readonly outputBytes: number;
}

/** Trusted host configuration for the contained port. Never a request, never agent-supplied. */
export interface ContainedStdioPortConfig {
  /** The bubblewrap binary. Lives in a possibly user-writable directory, so its digest is pinned and re-verified before every spawn. */
  readonly launcher: PinnedBinary;
  /** The only executables a spec may run (exact realpath), each digest-pinned. */
  readonly executables: readonly PinnedBinary[];
  /** Mounted read-only at /workspace. */
  readonly workspaceRoot: string;
  /** Host directories a process can write to; the launcher and executables must live outside them. The workspace is always one. */
  readonly writableRoots?: readonly string[];
  /** Public runtime directories bound read-only. Default: /usr/bin /usr/lib /lib /lib64. */
  readonly runtimeRoots?: readonly string[];
  /** Environment names a spec may set. Everything else is refused. */
  readonly envAllowlist?: readonly string[];
  /** The one host-owned unix socket the sandbox may reach (the #115 metering proxy); network is otherwise unshared. */
  readonly hostSocket?: string;
  readonly ceilings?: Partial<ContainedCeilings>;
  /** Longest single stdout line accepted before the sandbox is terminated. Default 65536. */
  readonly maxLineBytes?: number;
  /** Stderr bytes retained. Default 65536. */
  readonly stderrBytes?: number;
  /** Operator attestation that the launcher carries the CVE-2026-87766 fix, for a distro build whose version number is below 0.12.0. */
  readonly launcherPatchedAttested?: boolean;
  /** Authority seam (#116): called with the plan and digest before spawn. Throw to refuse. */
  readonly authorize?: (plan: LaunchPlan, digest: string, ctx: { readonly intentId: string; readonly runId: string }) => Promise<void>;
}

export const DEFAULT_CEILINGS: ContainedCeilings = {
  wallSeconds: 300,
  cpuSeconds: 60,
  addressSpaceBytes: 1_073_741_824,
  nofile: 256,
  nproc: 128,
  outputBytes: 1_048_576,
};
export const DEFAULT_RUNTIME_ROOTS = ["/usr/bin", "/usr/lib", "/lib", "/lib64"] as const;
export const SANDBOX_WORKSPACE = "/workspace";
export const SANDBOX_EGRESS_SOCKET = "/run/egress.sock";
export const SANDBOX_EXECUTABLE_DIR = "/opt/cognate/bin";
const PUBLIC_ROOTS = new Set(["/usr/bin", "/usr/lib", "/usr/lib64", "/bin", "/lib", "/lib64"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type NetworkRestriction = "none" | `host-socket:${string}`;

export interface LaunchPlan {
  readonly version: 1;
  readonly executable: PinnedBinary;
  readonly launcher: PinnedBinary & { readonly version: string };
  /** The child's argv exactly as the sandbox will exec it (argv[0] is the sandbox-side executable path). */
  readonly argv: readonly string[];
  /** The complete argv handed to the launcher, derived deterministically from this plan. */
  readonly sandboxArgv: readonly string[];
  readonly workspace: { readonly hostPath: string; readonly sandboxPath: string; readonly mode: "read-only"; readonly cwd: string };
  readonly restrictions: {
    readonly filesystem: "read-only";
    readonly network: NetworkRestriction;
    readonly credentials: "none";
    readonly subprocess: "contained";
  };
  readonly ceilings: ContainedCeilings;
  readonly maxLineBytes: number;
  readonly env: Readonly<Record<string, string>>;
  readonly envAllowlist: readonly string[];
}

/** Canonical JSON: object keys sorted, no insignificant whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `sha256:<hex>` of the canonical plan. Ticket #116 binds a SEA authority decision to exactly this value. */
export function launchPlanDigest(plan: LaunchPlan): string {
  return `sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;
}

export const refuse = (code: RlmRefusalCode, reason: string): RlmRefusedError => new RlmRefusedError(code, reason);

export const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** A rejected host path (missing, unreadable, not a regular file) is a containment failure, never a fallback. */
async function realFile(path: string, what: string, code: RlmRefusalCode): Promise<string> {
  try {
    const real = await realpath(path);
    if (!(await stat(real)).isFile()) throw new Error("not a regular file");
    return real;
  } catch {
    throw refuse(code, `${what} ${path} is missing or not a regular file`);
  }
}

export function validateConfig(config: ContainedStdioPortConfig): void {
  if (!isAbsolute(config.launcher.path) || !SHA256_HEX.test(config.launcher.sha256)) throw new Error("contained port: launcher needs an absolute path and a lowercase hex sha256");
  if (config.executables.length === 0 || config.executables.some((e) => !isAbsolute(e.path) || !SHA256_HEX.test(e.sha256))) throw new Error("contained port: executables need absolute paths and lowercase hex sha256 pins");
  if (!isAbsolute(config.workspaceRoot)) throw new Error("contained port: workspaceRoot must be absolute");
  if (config.hostSocket !== undefined && !isAbsolute(config.hostSocket)) throw new Error("contained port: hostSocket must be an absolute path");
  for (const root of config.runtimeRoots ?? []) if (!PUBLIC_ROOTS.has(root)) throw new Error(`contained port: runtime root ${root} is not a public executable/library directory`);
  const ceilings = { ...DEFAULT_CEILINGS, ...config.ceilings };
  for (const [key, value] of Object.entries(ceilings)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`contained port: ceiling ${key} must be a positive integer`);
}

export function resolveCeilings(config: ContainedStdioPortConfig): ContainedCeilings {
  return { ...DEFAULT_CEILINGS, ...config.ceilings };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV = new Set(["PATH", "HOME", "SEA_EGRESS_SOCKET"]);

function parseNetwork(spec: StdioSpawnSpec, config: ContainedStdioPortConfig): NetworkRestriction {
  const outbound = spec.restrictions.network?.outbound ?? [];
  if (outbound.length === 0) return "none";
  const sockets = outbound.filter((entry) => entry.startsWith("host-socket:"));
  if (outbound.length !== 1 || sockets.length !== 1) {
    throw refuse("rlm-egress-uncontrolled", `outbound network ${JSON.stringify(outbound)} cannot be enforced; only none or exactly one host-socket:<path> is supported`);
  }
  const path = sockets[0]!.slice("host-socket:".length);
  if (!config.hostSocket || path !== config.hostSocket) {
    throw refuse("rlm-egress-uncontrolled", `host-socket ${path} is not the host-configured egress socket`);
  }
  return `host-socket:${path}`;
}

function parseFilesystem(spec: StdioSpawnSpec): void {
  for (const entry of spec.restrictions.filesystem ?? []) {
    if (entry !== "read-only" && entry !== "workspace:ro" && entry !== "workspace-ro") {
      throw refuse("rlm-containment-unavailable", `filesystem restriction ${JSON.stringify(entry)} cannot be enforced; the port only grants a read-only workspace`);
    }
  }
}

export interface BuildPlanInput {
  readonly config: ContainedStdioPortConfig;
  readonly spec: StdioSpawnSpec;
  /** The launcher's self-reported `--version` (measured by the port, never supplied by a request). */
  readonly launcherVersion: string;
}

/**
 * Resolve a spec against trusted host configuration into a launch plan. Hashes the launcher and the
 * executable from disk at call time, so recomputing it detects a swapped binary. Throws the typed
 * Cognate refusal for anything the port cannot enforce; it never narrows silently.
 */
export async function buildLaunchPlan(input: BuildPlanInput): Promise<LaunchPlan> {
  const { config, spec } = input;
  validateConfig(config);
  if (process.platform !== "linux") throw refuse("rlm-containment-unavailable", "the contained port requires Linux namespaces; there is no fallback");
  if (spec.argv.length === 0 || spec.argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw refuse("rlm-port-unavailable", "invalid argv");
  parseFilesystem(spec);
  if (spec.restrictions.subprocess === false) throw refuse("rlm-containment-unavailable", "forbidding subprocesses cannot be enforced; descendants are contained, not forbidden");
  const network = parseNetwork(spec, config);
  const ceilings = resolveCeilings(config);
  const asked = spec.restrictions.caps ?? {};
  if (asked.memoryBytes !== undefined && (!Number.isSafeInteger(asked.memoryBytes) || asked.memoryBytes < 1 || asked.memoryBytes > ceilings.addressSpaceBytes)) {
    throw refuse("rlm-containment-unavailable", `memory cap ${asked.memoryBytes} exceeds the host ceiling ${ceilings.addressSpaceBytes}`);
  }
  if (asked.cpuSeconds !== undefined && (!Number.isSafeInteger(asked.cpuSeconds) || asked.cpuSeconds < 1 || asked.cpuSeconds > ceilings.cpuSeconds)) {
    throw refuse("rlm-containment-unavailable", `cpu cap ${asked.cpuSeconds}s exceeds the host ceiling ${ceilings.cpuSeconds}s`);
  }
  const effective: ContainedCeilings = { ...ceilings, ...(asked.memoryBytes !== undefined ? { addressSpaceBytes: asked.memoryBytes } : {}), ...(asked.cpuSeconds !== undefined ? { cpuSeconds: asked.cpuSeconds } : {}) };

  // Launcher: path exists, outside every writable root, digest matches the pin.
  const launcherPath = await realFile(config.launcher.path, "launcher", "rlm-containment-unavailable");
  let workspace: string;
  try {
    workspace = await realpath(config.workspaceRoot);
    if (workspace === "/" || !(await stat(workspace)).isDirectory()) throw new Error("bad workspace");
  } catch {
    throw refuse("rlm-containment-unavailable", "a dedicated workspace directory is required");
  }
  const writable = [workspace, ...(await Promise.all((config.writableRoots ?? []).map((root) => realpath(root).catch(() => root))))];
  if (writable.some((root) => inside(root, launcherPath))) throw refuse("rlm-containment-unavailable", "the launcher must be outside every writable root");
  if ((await sha256File(launcherPath)) !== config.launcher.sha256) throw refuse("rlm-containment-unavailable", "the launcher digest does not match the host pin");

  // Executable: must be one of the pinned executables, outside writable roots, digest matches.
  const requested = await realFile(spec.argv[0]!, "executable", "rlm-port-unavailable");
  let pinned: PinnedBinary | undefined;
  for (const candidate of config.executables) {
    if ((await realpath(candidate.path).catch(() => undefined)) === requested) pinned = candidate;
  }
  if (!pinned) throw refuse("rlm-port-unavailable", `executable ${requested} is not one of the host-pinned executables`);
  if (writable.some((root) => inside(root, requested))) throw refuse("rlm-containment-unavailable", "the executable must be outside every writable root");
  if ((await sha256File(requested)) !== pinned.sha256) throw refuse("rlm-port-unavailable", "the executable digest does not match the host pin");

  // Workspace and cwd.
  let cwdHost: string;
  try { cwdHost = await realpath(spec.cwd); } catch { throw refuse("rlm-containment-unavailable", `cwd ${spec.cwd} does not exist`); }
  if (!inside(workspace, cwdHost)) throw refuse("rlm-containment-unavailable", "cwd must be inside the workspace");
  const cwd = SANDBOX_WORKSPACE + cwdHost.slice(workspace.length);

  // Runtime roots; the executable is bound at a fixed sandbox path unless it already lives in one.
  const mounts: string[] = [];
  const roots = [...new Set(config.runtimeRoots ?? DEFAULT_RUNTIME_ROOTS)];
  let execInside: string | undefined;
  for (const root of roots) {
    let source: string;
    try { source = await realpath(root); } catch { continue; }
    if (inside(source, workspace) || inside(workspace, source)) throw refuse("rlm-containment-unavailable", "a runtime root and the workspace must not overlap");
    mounts.push("--ro-bind", source, root);
    if (execInside === undefined && inside(source, requested)) execInside = root + requested.slice(source.length);
  }
  if (mounts.length === 0) throw refuse("rlm-containment-unavailable", "no usable runtime roots");
  const base = requested.slice(requested.lastIndexOf("/") + 1);
  const sandboxExecutable = execInside ?? `${SANDBOX_EXECUTABLE_DIR}/${base}`;
  const executableMount = execInside ? [] : ["--dir", SANDBOX_EXECUTABLE_DIR, "--ro-bind", requested, sandboxExecutable];

  // Environment: cleared, plus the allowlist.
  const allowlist = [...new Set(config.envAllowlist ?? [])].sort();
  for (const name of allowlist) if (!ENV_NAME.test(name) || RESERVED_ENV.has(name)) throw new Error(`contained port: envAllowlist name ${name} is invalid or reserved`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(spec.env)) {
    if (!allowlist.includes(name)) throw refuse("rlm-containment-unavailable", `environment variable ${name} is not in the host allowlist`);
    if (typeof value !== "string" || value.includes("\0")) throw refuse("rlm-containment-unavailable", `environment variable ${name} has an invalid value`);
    env[name] = value;
  }
  const fixedEnv: Record<string, string> = { PATH: `${SANDBOX_EXECUTABLE_DIR}:/usr/bin:/bin`, HOME: "/nonexistent", ...(network === "none" ? {} : { SEA_EGRESS_SOCKET: SANDBOX_EGRESS_SOCKET }) };
  const fullEnv = { ...env, ...fixedEnv };

  // Network: unshared always; a host socket is the single bound-in exception.
  const socketMount: string[] = [];
  if (network !== "none") {
    const path = network.slice("host-socket:".length);
    let isSocket = false;
    try { isSocket = (await stat(path)).isSocket(); } catch { /* absent */ }
    if (!isSocket) throw refuse("rlm-egress-uncontrolled", `host socket ${path} is not an existing unix socket`);
    socketMount.push("--dir", "/run", "--bind", path, SANDBOX_EGRESS_SOCKET);
  }

  const argv = [sandboxExecutable, ...spec.argv.slice(1)];
  const prlimit = ["/usr/bin/prlimit", `--as=${effective.addressSpaceBytes}`, `--cpu=${effective.cpuSeconds}:${effective.cpuSeconds + 1}`, `--nofile=${effective.nofile}`, `--nproc=${effective.nproc}`, "--"];
  const sandboxArgv = [
    launcherPath,
    "--unshare-all", "--unshare-user", "--disable-userns", "--assert-userns-disabled", "--new-session", "--die-with-parent", "--cap-drop", "ALL", "--clearenv",
    ...mounts, "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", ...executableMount,
    "--ro-bind", workspace, SANDBOX_WORKSPACE, ...socketMount, "--chdir", cwd,
    ...Object.entries(fullEnv).sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([name, value]) => ["--setenv", name, value]),
    "--", ...prlimit, ...argv,
  ];
  return {
    version: 1,
    executable: { path: requested, sha256: pinned.sha256 },
    launcher: { path: launcherPath, sha256: config.launcher.sha256, version: input.launcherVersion },
    argv,
    sandboxArgv,
    workspace: { hostPath: workspace, sandboxPath: SANDBOX_WORKSPACE, mode: "read-only", cwd },
    restrictions: { filesystem: "read-only", network, credentials: "none", subprocess: "contained" },
    ceilings: effective,
    maxLineBytes: config.maxLineBytes ?? 65_536,
    env: fullEnv,
    envAllowlist: allowlist,
  };
}
