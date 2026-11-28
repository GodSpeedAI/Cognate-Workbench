// Contained launch plan (SEA-Forge #114). A canonical, digestible record of exactly what the host
// will run inside bubblewrap for a recursive-child provider: the pinned executable and launcher,
// the full sandbox argv, the workspace mount, the enforced restrictions, the kernel ceilings and
// the environment. `launchPlanDigest` is the identity ticket #116 binds a SEA authority decision to;
// the port recomputes it immediately before spawn and refuses on any drift.
//
// Everything here is host-owned and pure of side effects except `hashFile`/`realpath` reads. Nothing
// is taken from a request except the spec the port validates against trusted host configuration.
import { createHash, createHmac } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { noUnixSocketFilter } from "./containedSeccomp.ts";
import { compileEnvPattern, matchEnvPattern, type CompiledEnvPattern } from "./envPattern.ts";
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
  /** Size of the /tmp tmpfs (host RAM); a process cannot fill more. */
  readonly tmpBytes: number;
  /** RLIMIT_FSIZE: the largest single file a process may write. */
  readonly fsizeBytes: number;
}

/** Trusted host configuration for the contained port. Never a request, never agent-supplied. */
export interface ContainedStdioPortConfig {
  /** The bubblewrap binary. Lives in a possibly user-writable directory, so its digest is pinned and re-verified before every spawn. */
  readonly launcher: PinnedBinary;
  /** The only executables a spec may run (exact realpath), each digest-pinned. */
  readonly executables: readonly PinnedBinary[];
  /** Mounted read-only at /workspace. */
  readonly workspaceRoot: string;
  /** Host directories a process can write to; the launcher and executables must live outside them. The workspace is always one.
   *  Required and explicit (an empty list is a deliberate statement). Independently of this list the launcher and executables
   *  must be owned by root or the host user, not group/other-writable, with a trusted directory chain. */
  readonly writableRoots: readonly string[];
  /** Public runtime directories bound read-only. Default: /usr/bin /usr/lib /lib /lib64. */
  readonly runtimeRoots?: readonly string[];
  /** Environment names a spec may set. Everything else is refused. Each name must have a value pattern in `envValuePatterns`. */
  readonly envAllowlist?: readonly string[];
  /** Per allowlisted name, the pattern its value must match, in the restricted grammar of envPattern.ts (implicitly anchored,
   *  no groups or alternation, matched in linear time); values are also capped at 256 characters. The pattern is part of the execution profile, so an operator approves WHICH values may be set, not
   *  only which names. A name that selects code (an agent path, a config file) can then only ever name what was approved. */
  readonly envValuePatterns?: Readonly<Record<string, string>>;
  /** The one host-owned unix socket the sandbox may reach (the #115 metering proxy); network is otherwise unshared. */
  readonly hostSocket?: string;
  readonly ceilings?: Partial<ContainedCeilings>;
  /** Longest single stdout line accepted before the sandbox is terminated. Default 65536. */
  readonly maxLineBytes?: number;
  /** Stderr bytes retained. Default 65536. */
  readonly stderrBytes?: number;
  /** Operator attestation that the launcher carries the CVE-2026-87766 fix, for a distro build whose version number is below 0.12.0. */
  readonly launcherPatchedAttested?: boolean;
  /** Authority seam (#116), REQUIRED: called with the plan and digest before every spawn. Throw to refuse. A port cannot be built without it. */
  readonly authorize: (plan: LaunchPlan, digest: string, ctx: { readonly intentId: string; readonly runId: string }, executionProfileDigest: string) => Promise<void>;
}

export const DEFAULT_CEILINGS: ContainedCeilings = {
  wallSeconds: 300,
  cpuSeconds: 60,
  addressSpaceBytes: 1_073_741_824,
  nofile: 256,
  nproc: 128,
  outputBytes: 1_048_576,
  tmpBytes: 67_108_864,
  fsizeBytes: 16_777_216,
};
export const DEFAULT_RUNTIME_ROOTS = ["/usr/bin", "/usr/lib", "/lib", "/lib64"] as const;
export const SANDBOX_WORKSPACE = "/workspace";
export const SANDBOX_EGRESS_SOCKET = "/run/egress.sock";
/** Inherited descriptor numbers: 3 workspace, 4 argument file, 5 egress socket, 6 executable, 7 seccomp program. */
export const SECCOMP_FD = 7;
export const SANDBOX_EXECUTABLE_DIR = "/opt/cognate/bin";
const PUBLIC_ROOTS = new Set(["/usr/bin", "/usr/lib", "/usr/lib64", "/bin", "/lib", "/lib64"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type NetworkRestriction = "none" | `host-socket:${string}`;

/** dev/inode of a pinned host object, as decimal strings (inode numbers can exceed 2^53). */
export interface HostIdentity {
  readonly path: string;
  readonly dev: string;
  readonly ino: string;
}

/**
 * What an operator approves, independent of any one launch: stable across runs, workspaces, port instances and host
 * restarts for the same configuration, so a fixed list of its digests can live in policy (ticket #116). It holds the
 * pinned launcher and executable, the restrictions, ceilings, mount roles, the bubblewrap flag template (every flag
 * except the launcher path; host objects appear only as inherited-descriptor roles), the fixed environment and the
 * allowlisted environment NAMES. It never holds run or intent ids, dev/inode, per-case host paths, or env values.
 */
export interface ExecutionProfile {
  readonly version: 1;
  readonly launcher: PinnedBinary & { readonly version: string };
  /** The pinned executable by its configured (logical) path. */
  readonly executable: PinnedBinary;
  readonly sandboxExecutable: string;
  /** The child's arguments after argv[0], as sandbox-side strings. */
  readonly args: readonly string[];
  /** The network policy by role: the host socket path is a per-deployment host path and stays out. */
  readonly restrictions: Omit<LaunchPlan["restrictions"], "network"> & { readonly network: "none" | "host-socket" };
  readonly ceilings: ContainedCeilings;
  readonly maxLineBytes: number;
  readonly mounts: {
    readonly workspace: { readonly sandboxPath: string; readonly mode: "read-only" };
    /** The egress socket is fixed deployment configuration, so its resolved host path is part of the approval. The
     *  workspace is per case and stays out: SEA authorizes it as the governed request's case resource, and the plan
     *  digest pins the exact directory by dev/inode. */
    readonly egress: { readonly sandboxPath: string; readonly hostPath: string } | null;
  };
  /** `sandboxArgv` without the launcher path. */
  readonly flagTemplate: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly envAllowlist: readonly string[];
  /** The value pattern of each allowlisted environment name (grammar: envPattern.ts, linear-time matching). */
  readonly envPatterns: Readonly<Record<string, string>>;
  readonly envPatternGrammar: "linear-v1";
  /** The seccomp filter loaded into the sandbox (id and digest of its bytes), or null when none applies (egress profiles). */
  readonly seccomp: { readonly id: string; readonly sha256: string } | null;
}

export interface LaunchPlan {
  readonly version: 2;
  /** Digest of the operator-approved profile this launch instantiates; confirmed unchanged immediately before spawn. */
  readonly executionProfileDigest: string;
  /** The run and intent this launch is for; a digest authorizes this launch, not any launch of the same command. */
  readonly binding: { readonly intentId: string; readonly runId: string };
  /** The pinned executable with the identity of the file that was hashed. `fd` means it is bound by descriptor
   *  (fd 6); `runtime-root` means it is reached through a public runtime directory that is bound by path. */
  readonly executable: PinnedBinary & { readonly dev: string; readonly ino: string; readonly bound: "fd" | "runtime-root" };
  readonly launcher: PinnedBinary & { readonly version: string };
  /** The child's argv exactly as the sandbox will exec it (argv[0] is the sandbox-side executable path). */
  readonly argv: readonly string[];
  /**
   * The complete argv handed to the launcher, derived deterministically from this plan. The workspace, the egress
   * socket and an executable outside the runtime roots are bound by inherited file descriptor (3 workspace, 4
   * argument file, 5 egress socket, 6 executable), not re-resolved by path, and allowlisted environment values
   * travel in fd 4 so they are not visible in the process table. Residual path resolution: the public runtime roots
   * (root-owned directories) and an executable inside them are bound by path; the launcher itself is executed
   * through the descriptor it was hashed from (see containedStdioPort).
   */
  readonly sandboxArgv: readonly string[];
  readonly workspace: HostIdentity & { readonly sandboxPath: string; readonly mode: "read-only"; readonly cwd: string };
  readonly restrictions: {
    readonly filesystem: "read-only";
    readonly network: NetworkRestriction;
    readonly credentials: "none";
    readonly subprocess: "contained";
  };
  /** The one bound-in host socket (resolved), when network is a host socket. */
  readonly egress?: HostIdentity;
  readonly ceilings: ContainedCeilings;
  readonly maxLineBytes: number;
  /** Fixed, non-secret environment. */
  readonly env: Readonly<Record<string, string>>;
  /** Allowlisted caller environment: names with a keyed digest (HMAC under a per-port random key, so a low-entropy
   *  value cannot be guessed offline); the values never enter the plan. */
  readonly userEnvHmac: Readonly<Record<string, string>>;
  readonly envAllowlist: readonly string[];
}

/** What the port needs to launch that must not be part of the digestible record. */
export interface LaunchMaterial {
  /** NUL-joined `--setenv NAME VALUE` for the allowlisted caller environment (fd 4). */
  readonly argsFile: string;
  /** The seccomp program for `--seccomp 7`, when the profile has no network (the digest is in the execution profile). */
  readonly seccomp?: Buffer;
  /** Namespace and mount probe built structurally, so no spec value can cut it. */
  readonly probeArgv: readonly string[];
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

/** `sha256:<hex>` of the canonical execution profile: the value an operator writes into policy. */
export function executionProfileDigest(profile: ExecutionProfile): string {
  return `sha256:${createHash("sha256").update(canonicalJson(profile)).digest("hex")}`;
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

const hostUid = (): number => (typeof process.getuid === "function" ? process.getuid() : 0);

/**
 * A path whose trust does not depend on a digest alone: owned by root or the host user, not group/other-writable,
 * and every ancestor directory the same (a world-writable ancestor is accepted only when sticky, which stops others
 * renaming entries they do not own). `leafStrict` also refuses a sticky world-writable leaf.
 */
export function assertTrustedPath(real: string, what: string, code: RlmRefusalCode, leafStrict: boolean): void {
  const me = hostUid();
  let current = real;
  for (let first = true; ; first = false) {
    let info;
    try { info = lstatSync(current); } catch { throw refuse(code, `${what}: cannot inspect ${current}`); }
    if (info.uid !== 0 && info.uid !== me) throw refuse(code, `${what}: ${current} is owned by uid ${info.uid}, not root or the host user`);
    const loose = (info.mode & 0o022) !== 0;
    const sticky = (info.mode & 0o1000) !== 0 && info.isDirectory();
    if (loose && !(sticky && !(first && leafStrict))) throw refuse(code, `${what}: ${current} is group- or other-writable`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function validateConfig(config: ContainedStdioPortConfig): void {
  if (!isAbsolute(config.launcher.path) || !SHA256_HEX.test(config.launcher.sha256)) throw new Error("contained port: launcher needs an absolute path and a lowercase hex sha256");
  if (config.executables.length === 0 || config.executables.some((e) => !isAbsolute(e.path) || !SHA256_HEX.test(e.sha256))) throw new Error("contained port: executables need absolute paths and lowercase hex sha256 pins");
  if (!isAbsolute(config.workspaceRoot)) throw new Error("contained port: workspaceRoot must be absolute");
  if (!Array.isArray(config.writableRoots) || config.writableRoots.some((root) => typeof root !== "string" || !isAbsolute(root))) throw new Error("contained port: writableRoots must be an explicit array of absolute paths");
  if (config.hostSocket !== undefined && !isAbsolute(config.hostSocket)) throw new Error("contained port: hostSocket must be an absolute path");
  for (const root of config.runtimeRoots ?? []) if (!PUBLIC_ROOTS.has(root)) throw new Error(`contained port: runtime root ${root} is not a public executable/library directory`);
  for (const name of config.envAllowlist ?? []) if (typeof name !== "string" || isForbiddenEnvName(name)) throw new Error(`contained port: envAllowlist name ${String(name)} controls code loading or interpretation and cannot be allowlisted`);
  validateEnvPatterns(config);
  const ceilings = { ...DEFAULT_CEILINGS, ...config.ceilings };
  for (const [key, value] of Object.entries(ceilings)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`contained port: ceiling ${key} must be a positive integer`);
}

/** Longest env value the port accepts (patterns have their own grammar and limits: envPattern.ts). */
const MAX_ENV_VALUE = 256;
const compiledPatterns = new Map<string, CompiledEnvPattern>();
const patternFor = (source: string): CompiledEnvPattern => {
  let compiled = compiledPatterns.get(source);
  if (!compiled) { compiled = compileEnvPattern(source); if (compiledPatterns.size > 256) compiledPatterns.clear(); compiledPatterns.set(source, compiled); }
  return compiled;
};

function validateEnvPatterns(config: ContainedStdioPortConfig): void {
  const allowed = new Set(config.envAllowlist ?? []);
  const patterns = config.envValuePatterns ?? {};
  for (const name of allowed) {
    const pattern = patterns[name];
    if (typeof pattern !== "string") throw new Error(`contained port: envAllowlist name ${name} needs a value pattern in envValuePatterns`);
    try { patternFor(pattern); } catch (error) { throw new Error(`contained port: the value pattern of ${name} is refused: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const name of Object.keys(patterns)) if (!allowed.has(name)) throw new Error(`contained port: envValuePatterns names ${name}, which is not allowlisted`);
}

/**
 * Run the pinned launcher's `--version` once, after the same path and digest checks the port applies before it executes the launcher
 * for any reason (review F9: the version is measured when the port is built, never per spawn). The launcher is executed through the
 * descriptor it was hashed from. Synchronous so a port can measure at construction.
 */
export function measureLauncherVersionSync(config: ContainedStdioPortConfig): string {
  const code = "rlm-containment-unavailable" as const;
  validateConfig(config);
  let path: string;
  try { path = realpathSync(config.launcher.path); if (!statSync(path).isFile()) throw new Error("not a regular file"); } catch { throw refuse(code, `launcher ${config.launcher.path} is missing or not a regular file`); }
  let workspace = config.workspaceRoot;
  try { workspace = realpathSync(config.workspaceRoot); } catch { /* reported by the planner */ }
  const writable = [workspace, ...config.writableRoots.map((root) => { try { return realpathSync(root); } catch { return root; } })];
  if (writable.some((root) => inside(root, path))) throw refuse(code, "the launcher must be outside every writable root");
  assertTrustedPath(path, "launcher", code, false);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { throw refuse(code, `bubblewrap launcher ${config.launcher.path} is missing`); }
  try {
    const info = fstatSync(fd); const at = lstatSync(path);
    if (info.dev !== at.dev || info.ino !== at.ino) throw refuse(code, "the launcher changed while it was being opened");
    if (createHash("sha256").update(readFileSync(fd)).digest("hex") !== config.launcher.sha256) throw refuse(code, "the launcher digest does not match the host pin");
    const result = Bun.spawnSync([`/proc/${process.pid}/fd/${fd}`, "--version"], { stdout: "pipe", stderr: "pipe", env: {} });
    const version = result.stdout.toString().trim().replace(/^bubblewrap\s+/, "");
    if (result.exitCode !== 0 || !/^\d+\.\d+\.\d+/.test(version)) throw refuse(code, "the launcher did not report a bubblewrap version");
    const parts = version.split(".").map((p) => Number.parseInt(p, 10));
    if (!(config.launcherPatchedAttested === true || parts[0]! > 0 || parts[1]! >= 12)) throw refuse(code, `bubblewrap ${version} predates the CVE-2026-87766 fix and is not attested as patched`);
    return version;
  } finally { try { closeSync(fd); } catch { /* closed */ } }
}

export function resolveCeilings(config: ContainedStdioPortConfig): ContainedCeilings {
  return { ...DEFAULT_CEILINGS, ...config.ceilings };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV = new Set(["PATH", "HOME", "SEA_EGRESS_SOCKET"]);
/**
 * Environment names that control how code is found, loaded or interpreted, or where traffic goes. They may not be
 * allowlisted at all, whatever pattern is offered: the dynamic loader (LD_*, DYLD_*), language runtimes, VMs and their
 * package managers (NODE_*, BUN_*, DENO_*, npm_config_*, PYTHON*, RUBY*, PERL*, GEM_*, BUNDLE_*, JAVA_TOOL_OPTIONS,
 * _JAVA_OPTIONS, JDK_JAVA_OPTIONS, CLASSPATH, JAVA_HOME), VCS hooks (GIT_*), shell startup (BASH_ENV, ENV, BASH_FUNC_*),
 * libc locale and charset loading (GCONV_PATH, LOCPATH, NLSPATH), TLS roots (SSL_CERT_FILE, SSL_CERT_DIR), proxies
 * (*_proxy, *_PROXY), and the fixed PATH, HOME and TMPDIR. Every other allowlisted name still carries an operator-approved
 * value pattern that is part of the execution profile (`envValuePatterns`).
 */
const FORBIDDEN_ENV_NAMES = new Set(["BASH_ENV", "ENV", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "JAVA_HOME", "GCONV_PATH", "LOCPATH", "NLSPATH", "PATH", "HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
/** Matched case-sensitively as prefixes: loaders, language runtimes and their package managers, VCS and ruby/perl tooling. */
const FORBIDDEN_ENV_PREFIXES = ["LD_", "DYLD_", "PYTHON", "BASH_FUNC_", "NODE_", "BUN_", "DENO_", "npm_config_", "GIT_", "RUBY", "PERL", "GEM_", "BUNDLE_"];
/** Proxy settings redirect traffic: `*_proxy` and `*_PROXY` (http_proxy, HTTPS_PROXY, all_proxy, NO_PROXY ...). */
const FORBIDDEN_ENV_SUFFIXES = ["_proxy", "_PROXY"];
export const isForbiddenEnvName = (name: string): boolean => FORBIDDEN_ENV_NAMES.has(name) || FORBIDDEN_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)) || FORBIDDEN_ENV_SUFFIXES.some((suffix) => name.endsWith(suffix));
const SPEC_KEYS = new Set(["argv", "cwd", "env", "restrictions"]);
const RESTRICTION_KEYS = new Set(["filesystem", "network", "caps", "subprocess"]);
const NETWORK_KEYS = new Set(["outbound"]);
const CAP_KEYS = new Set(["memoryBytes", "cpuSeconds"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A dense array of strings: `every` skips holes, which Bun would spawn as the string "undefined". */
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && Object.keys(value).length === value.length && Array.from(value).every((item) => typeof item === "string");

/** A malformed spec is a typed refusal, not a TypeError from deep inside the planner. */
function checkShape(spec: unknown): asserts spec is StdioSpawnSpec {
  const bad = (why: string): never => { throw refuse("rlm-containment-unavailable", `malformed spawn spec: ${why}`); };
  if (!isRecord(spec)) return bad("not an object");
  if (!isStrings(spec.argv)) bad("argv must be an array of strings");
  if (typeof spec.cwd !== "string") bad("cwd must be a string");
  if (!isRecord(spec.env) || Object.values(spec.env).some((v) => typeof v !== "string")) bad("env must be an object of strings");
  const r = spec.restrictions;
  if (!isRecord(r)) return bad("restrictions must be an object");
  if (r.filesystem !== undefined && !isStrings(r.filesystem)) bad("restrictions.filesystem must be an array of strings");
  if (r.subprocess !== undefined && typeof r.subprocess !== "boolean") bad("restrictions.subprocess must be a boolean");
  if (r.network !== undefined && (!isRecord(r.network) || (r.network.outbound !== undefined && !isStrings(r.network.outbound)))) bad("restrictions.network.outbound must be an array of strings");
  if (r.caps !== undefined && (!isRecord(r.caps) || Object.values(r.caps).some((v) => v !== undefined && typeof v !== "number"))) bad("restrictions.caps must be an object of numbers");
}

/**
 * The launcher checks that must hold BEFORE the launcher is executed for any reason (even `--version`):
 * it exists, is outside every writable root, and has a trusted owner and directory chain. Returns the resolved path.
 */
export async function verifyLauncherPath(config: ContainedStdioPortConfig): Promise<string> {
  validateConfig(config);
  const launcherPath = await realFile(config.launcher.path, "launcher", "rlm-containment-unavailable");
  let workspace = config.workspaceRoot;
  try { workspace = await realpath(config.workspaceRoot); } catch { /* reported by the planner */ }
  const writable = [workspace, ...(await Promise.all(config.writableRoots.map((root) => realpath(root).catch(() => root))))];
  if (writable.some((root) => inside(root, launcherPath))) throw refuse("rlm-containment-unavailable", "the launcher must be outside every writable root");
  assertTrustedPath(launcherPath, "launcher", "rlm-containment-unavailable", false);
  return launcherPath;
}

/** A key the port does not handle is a request it cannot honor: refuse, never drop. */
function rejectUnknown(value: object | undefined, known: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value ?? {})) {
    if (!known.has(key)) throw refuse("rlm-containment-unavailable", `${where} key ${JSON.stringify(key)} is not enforced by this port`);
  }
}

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

const identity = (path: string, info: { dev: number | bigint; ino: number | bigint }): HostIdentity => ({ path, dev: String(info.dev), ino: String(info.ino) });

export interface BuildPlanInput {
  readonly config: ContainedStdioPortConfig;
  /** Per-port random key for the environment digests. */
  readonly envKey: Uint8Array;
  readonly spec: StdioSpawnSpec;
  readonly ctx: { readonly intentId: string; readonly runId: string };
  /** The launcher's self-reported `--version` (measured by the port, never supplied by a request). */
  readonly launcherVersion: string;
}

/**
 * Resolve a spec against trusted host configuration into a launch plan. Hashes the launcher and the
 * executable from disk at call time, so recomputing it detects a swapped binary, and records the dev/inode of
 * the workspace and the egress socket so a retargeted path is a different plan. Throws the typed Cognate
 * refusal for anything the port cannot enforce; it never narrows silently.
 */
/** Validate the SHAPE of a spawn spec (types, unknown keys, argv) without touching the filesystem or any process. */
export function checkSpecShape(spec: unknown): asserts spec is StdioSpawnSpec {
  checkShape(spec);
  rejectUnknown(spec, SPEC_KEYS, "spec");
  rejectUnknown(spec.restrictions, RESTRICTION_KEYS, "restriction");
  rejectUnknown(spec.restrictions.network, NETWORK_KEYS, "network restriction");
  rejectUnknown(spec.restrictions.caps, CAP_KEYS, "cap");
  if (spec.argv.length === 0 || spec.argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw refuse("rlm-port-unavailable", "invalid argv");
}

export async function buildLaunchPlan(input: BuildPlanInput): Promise<{ plan: LaunchPlan; material: LaunchMaterial; profile: ExecutionProfile; profileDigest: string }> {
  const { config, spec } = input;
  validateConfig(config);
  if (process.platform !== "linux") throw refuse("rlm-containment-unavailable", "the contained port requires Linux namespaces; there is no fallback");
  checkSpecShape(spec);
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

  // Launcher: path exists, outside every writable root, trusted ownership and chain, digest matches the pin.
  const launcherPath = await realFile(config.launcher.path, "launcher", "rlm-containment-unavailable");
  let workspace: string;
  let workspaceInfo;
  try {
    workspace = await realpath(config.workspaceRoot);
    workspaceInfo = await stat(workspace);
    if (workspace === "/" || !workspaceInfo.isDirectory()) throw new Error("bad workspace");
  } catch {
    throw refuse("rlm-containment-unavailable", "a dedicated workspace directory is required");
  }
  const writable = [workspace, ...(await Promise.all(config.writableRoots.map((root) => realpath(root).catch(() => root))))];
  if (writable.some((root) => inside(root, launcherPath))) throw refuse("rlm-containment-unavailable", "the launcher must be outside every writable root");
  assertTrustedPath(launcherPath, "launcher", "rlm-containment-unavailable", false);
  if ((await sha256File(launcherPath)) !== config.launcher.sha256) throw refuse("rlm-containment-unavailable", "the launcher digest does not match the host pin");
  assertTrustedPath(workspace, "workspace", "rlm-containment-unavailable", true);

  // Executable: must be one of the pinned executables, outside writable roots, trusted, digest matches.
  const requested = await realFile(spec.argv[0]!, "executable", "rlm-port-unavailable");
  let pinned: PinnedBinary | undefined;
  for (const candidate of config.executables) {
    if ((await realpath(candidate.path).catch(() => undefined)) === requested) pinned = candidate;
  }
  if (!pinned) throw refuse("rlm-port-unavailable", `executable ${requested} is not one of the host-pinned executables`);
  if (writable.some((root) => inside(root, requested))) throw refuse("rlm-containment-unavailable", "the executable must be outside every writable root");
  assertTrustedPath(requested, "executable", "rlm-containment-unavailable", false);
  if ((await sha256File(requested)) !== pinned.sha256) throw refuse("rlm-port-unavailable", "the executable digest does not match the host pin");

  // Workspace cwd.
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
  const executableMount = execInside ? [] : ["--dir", SANDBOX_EXECUTABLE_DIR, "--ro-bind-fd", "6", sandboxExecutable];
  const executableInfo = await stat(requested);

  // Environment: cleared, plus the allowlist. Caller values travel in fd 4 and appear in the plan as digests only.
  const allowlist = [...new Set(config.envAllowlist ?? [])].sort();
  for (const name of allowlist) if (!ENV_NAME.test(name) || RESERVED_ENV.has(name)) throw new Error(`contained port: envAllowlist name ${name} is invalid or reserved`);
  const userEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(spec.env)) {
    if (!allowlist.includes(name)) throw refuse("rlm-containment-unavailable", `environment variable ${name} is not in the host allowlist`);
    if (typeof value !== "string" || value.includes("\0")) throw refuse("rlm-containment-unavailable", `environment variable ${name} has an invalid value`);
    if (value.length > MAX_ENV_VALUE || !matchEnvPattern(patternFor(config.envValuePatterns![name]!), value).matched) throw refuse("rlm-containment-unavailable", `environment variable ${name} has a value outside the pattern the operator approved for it`);
    userEnv[name] = value;
  }
  const envPatterns: Record<string, string> = Object.fromEntries(allowlist.map((name) => [name, config.envValuePatterns![name]!]));
  const fixedEnv: Record<string, string> = { PATH: `${SANDBOX_EXECUTABLE_DIR}:/usr/bin:/bin`, HOME: "/nonexistent", ...(network === "none" ? {} : { SEA_EGRESS_SOCKET: SANDBOX_EGRESS_SOCKET }) };
  const userNames = Object.keys(userEnv).sort();
  const userEnvHmac = Object.fromEntries(userNames.map((name) => [name, createHmac("sha256", input.envKey).update(name).update("\0").update(userEnv[name]!).digest("hex")]));
  const argsFile = userNames.map((name) => `--setenv\0${name}\0${userEnv[name]}\0`).join("");

  // Network: unshared always; one host socket, pinned by resolved path and inode, is the single exception.
  let egress: HostIdentity | undefined;
  if (network !== "none") {
    try {
      const resolved = await realpath(network.slice("host-socket:".length));
      const info = await stat(resolved);
      if (!info.isSocket()) throw new Error("not a socket");
      egress = identity(resolved, info);
    } catch {
      throw refuse("rlm-egress-uncontrolled", `host socket ${network.slice("host-socket:".length)} is not an existing unix socket`);
    }
    assertTrustedPath(dirname(egress.path), "host socket directory", "rlm-egress-uncontrolled", true);
    assertTrustedPath(egress.path, "host socket", "rlm-egress-uncontrolled", false);
  }

  // H4: with no network, the sandbox may not create an AF_UNIX socket at all (a pathname socket under the workspace bind is
  // otherwise reachable). With the egress slot the child needs AF_UNIX, so no filter yet: #115 must hand it a pre-connected fd.
  const seccomp = network === "none" ? noUnixSocketFilter() : undefined;
  const argv = [sandboxExecutable, ...spec.argv.slice(1)];
  const prlimit = ["/usr/bin/prlimit", `--as=${effective.addressSpaceBytes}`, `--cpu=${effective.cpuSeconds}:${effective.cpuSeconds + 1}`, `--nofile=${effective.nofile}`, `--nproc=${effective.nproc}`, `--fsize=${effective.fsizeBytes}`, "--"];
  const common = ["--unshare-all", "--unshare-user", "--disable-userns", "--assert-userns-disabled", "--new-session", "--die-with-parent", "--cap-drop", "ALL", "--clearenv"];
  const sandboxArgv = [
    launcherPath, ...common, ...mounts,
    "--size", String(effective.tmpBytes), "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", ...executableMount,
    "--ro-bind-fd", "3", SANDBOX_WORKSPACE,
    ...(egress ? ["--dir", "/run", "--bind-fd", "5", SANDBOX_EGRESS_SOCKET] : []),
    "--chdir", cwd,
    ...Object.entries(fixedEnv).sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([name, value]) => ["--setenv", name, value]),
    "--args", "4",
    ...(seccomp ? ["--seccomp", String(SECCOMP_FD)] : []),
    "--", ...prlimit, ...argv,
  ];
  const probeArgv = [launcherPath, ...common, ...mounts, "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"];
  const profile: ExecutionProfile = {
    version: 1,
    launcher: { path: config.launcher.path, sha256: config.launcher.sha256, version: input.launcherVersion },
    executable: { path: pinned.path, sha256: pinned.sha256 },
    sandboxExecutable,
    args: spec.argv.slice(1),
    restrictions: { filesystem: "read-only", network: network === "none" ? "none" : "host-socket", credentials: "none", subprocess: "contained" },
    ceilings: effective,
    maxLineBytes: config.maxLineBytes ?? 65_536,
    mounts: { workspace: { sandboxPath: SANDBOX_WORKSPACE, mode: "read-only" }, egress: egress ? { sandboxPath: SANDBOX_EGRESS_SOCKET, hostPath: egress.path } : null },
    flagTemplate: sandboxArgv.slice(1),
    env: fixedEnv,
    envAllowlist: allowlist,
    envPatterns,
    envPatternGrammar: "linear-v1",
    seccomp: seccomp ? { id: seccomp.id, sha256: seccomp.sha256 } : null,
  };
  const profileDigest = executionProfileDigest(profile);
  const plan: LaunchPlan = {
    version: 2,
    executionProfileDigest: profileDigest,
    binding: { intentId: input.ctx.intentId, runId: input.ctx.runId },
    executable: { ...identity(requested, executableInfo), sha256: pinned.sha256, bound: execInside ? "runtime-root" : "fd" },
    launcher: { path: launcherPath, sha256: config.launcher.sha256, version: input.launcherVersion },
    argv,
    sandboxArgv,
    workspace: { ...identity(workspace, workspaceInfo), sandboxPath: SANDBOX_WORKSPACE, mode: "read-only", cwd },
    restrictions: { filesystem: "read-only", network, credentials: "none", subprocess: "contained" },
    ...(egress ? { egress } : {}),
    ceilings: effective,
    maxLineBytes: config.maxLineBytes ?? 65_536,
    env: fixedEnv,
    userEnvHmac,
    envAllowlist: allowlist,
  };
  return { plan, material: { argsFile, probeArgv, ...(seccomp ? { seccomp: seccomp.bytes } : {}) }, profile, profileDigest };
}
