// Host-owned contained `StdioSpawnPort` on bubblewrap (SEA-Forge #114). Cognate declares the port
// and ships only a refusing implementation; this host decides what "contained" means. The port is
// built only from trusted host configuration (`ServerOptions.rlmContainedPort`), and absent that the
// host keeps Cognate's `unavailableSpawnPort()`.
//
// Enforcement, all in the kernel and observable from outside (see test/J-RLM-contained-port.test.ts):
//   filesystem  read-only workspace + read-only runtime roots, /tmp is tmpfs, no host home
//   network     --unshare-all (no interfaces); at most one host unix socket bound in
//   processes   pid namespace + --die-with-parent + own session; teardown SIGKILLs the whole
//               process group and the namespace, then proves no member survived via /proc
//   ceilings    prlimit (AS, CPU, NOFILE, NPROC) inside the sandbox; wall-clock and output
//               bytes enforced by the port
//   spawn       refused with a typed Cognate code BEFORE any process starts; never an uncontained fallback
// Not enforced here (reported, not claimed): per-process memory beyond RLIMIT_AS, disk quota, UDP/DNS
// beyond the namespace itself (it has no interface at all). Seccomp: with no network, only AF_UNIX socket() and io_uring_setup are
// denied (containedSeccomp.ts); there is no general syscall filter.
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, readlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StdioSpawnPort, StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { createHash } from "node:crypto";
import { currentLease } from "./containedRunContext.ts";
import { LaunchGate } from "./launchGate.ts";
import { SpawnScope, type Owned } from "./spawnScope.ts";
import { buildLaunchPlan, launchPlanDigest, measureLauncherVersionSync, refuse, validateConfig, verifyLauncherPath, type ContainedStdioPortConfig, type ExecutionProfile, type LaunchMaterial, type LaunchPlan } from "./containedLaunch.ts";

const O_PATH = 0o10000000;
const FINISHED_RETAINED = 64;
type RunBinding = { readonly intentId: string; readonly runId: string };

export type ExitReason =
  | "exited"
  | "killed"
  | "wall-clock"
  | "output-limit"
  | "line-too-long"
  | "cpu-ceiling"
  | "signal";

export interface ExitRecord {
  readonly reason: ExitReason;
  /** The reason text a caller passed to kill(), when `reason` is "killed". */
  readonly detail?: string;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly at: string;
  /** Host pids still in the sandbox pid namespace after teardown (empty when containment held and `nsKnown`). */
  readonly residualPids: readonly number[];
  /** Whether the sandbox pid namespace was identified (and differs from the host's). When false, an empty
   *  `residualPids` is NOT evidence of a clean teardown. */
  readonly nsKnown: boolean;
  readonly outputBytes: number;
  readonly stderr: string;
}

export interface ContainedInspection {
  readonly id: string;
  readonly hostPid: number;
  readonly launchPlanDigest: string;
  readonly plan: LaunchPlan;
  readonly state: "running" | "exited";
  readonly exit?: ExitRecord;
}

export interface ContainedStdioSpawnPort extends StdioSpawnPort {
  /** Resolve a spec into the plan that spawn would run, without spawning. #116 binds an authority decision to this digest. */
  plan(spec: StdioSpawnSpec, ctx: RunBinding): Promise<{ readonly plan: LaunchPlan; readonly digest: string; readonly executionProfile: ExecutionProfile; readonly executionProfileDigest: string }>;
  /** The operator-approved profile for a spec, computed without launching anything (no run binding needed). */
  executionProfile(spec: StdioSpawnSpec): Promise<{ readonly profile: ExecutionProfile; readonly digest: string }>;
  inspect(id: string): ContainedInspection;
  /** Resolves with the exit record once the sandbox is gone. */
  exited(id: string): Promise<ExitRecord>;
  /**
   * A view of this port bound to one run: write, readLines and kill refuse ids another run spawned. Cognate's own
   * port interface carries no caller identity, so the unguessable id remains the capability on the shared port.
   */
  forRun(ctx: RunBinding): StdioSpawnPort;
  /** Test-only introspection: live cancellation registrations, and a barrier awaited inside launcher-handle acquisition. */
  __debug(): { readonly registrations: number; readonly scopes: number; barrier: (() => Promise<void>) | undefined; readonly launcherCalls: number; onAwait: ((label: string) => void) | undefined };
  /** Close the port, then terminate every live sandbox. A spawn still waiting on its authority decision launches nothing. Idempotent. */
  dispose(): Promise<void>;
}

const SIGNAL_NUMBERS: Readonly<Record<number, string>> = { 9: "SIGKILL", 15: "SIGTERM", 24: "SIGXCPU" };
const TEXT = new TextDecoder();

interface Live {
  readonly id: string;
  readonly owner: RunBinding;
  readonly plan: LaunchPlan;
  readonly digest: string;
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly lines: string[];
  sink: ((line: string) => void) | undefined;
  stdoutDone: Promise<void>;
  stderrDone: Promise<void>;
  stderr: string;
  outputBytes: number;
  requested: { reason: ExitReason; detail?: string } | undefined;
  exit: ExitRecord | undefined;
  readonly done: Promise<ExitRecord>;
  timer: ReturnType<typeof setTimeout> | undefined;
  nsInode: string | undefined;
}

async function pidNamespace(pid: number): Promise<string | undefined> {
  try { return await readlink(`/proc/${pid}/ns/pid`); } catch { return undefined; }
}

/** Host pids whose pid namespace is `inode`. Observed through the host's /proc, not through the child. */
export async function pidsInNamespace(inode: string): Promise<number[]> {
  if (inode === readlinkSync("/proc/self/ns/pid")) throw new Error("refusing to enumerate the host's own pid namespace");
  const found: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    if ((await pidNamespace(Number(entry))) === inode) found.push(Number(entry));
  }
  return found;
}

async function childrenOf(pid: number): Promise<number[]> {
  const out: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (ppid === pid) out.push(Number(entry));
    } catch { /* process vanished */ }
  }
  return out;
}

/** The sandbox pid namespace of the launcher's child, or undefined when unknown or equal to the host's. */
async function sandboxNamespace(launcherPid: number): Promise<string | undefined> {
  const host = readlinkSync("/proc/self/ns/pid");
  for (const child of await childrenOf(launcherPid)) {
    const ns = await pidNamespace(child);
    if (ns && ns !== host) return ns;
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function containedStdioSpawnPort(config: ContainedStdioPortConfig): ContainedStdioSpawnPort {
  if (typeof config.authorize !== "function") throw new Error("contained port: an authorize hook is required; a contained spawn is never launched without an authority decision");
  validateConfig(config);
  const live = new Map<string, Live>();
  const finished = new Map<string, Live>();
  const envKey = randomBytes(32);
  let preflighted = false;
  // Lifetime is two constructs. ONE launch gate is the only place a process is started: it checks "open and lease active" and calls the
  // spawn API in the same synchronous turn, and dispose() closes it as its first statement. ONE scope per spawn owns every resource that
  // spawn acquires and every await it is suspended at, and dispose() cancels them all. Nothing below re-checks `closed` after an await.
  const gate = new LaunchGate();
  const scopes = new Set<SpawnScope>();
  const pending = new Set<Promise<unknown>>();
  let waiters = 0;
  const debug: { readonly registrations: number; readonly scopes: number; barrier: (() => Promise<void>) | undefined; readonly launcherCalls: number; onAwait: ((label: string) => void) | undefined } = {
    get registrations() { return waiters; }, get scopes() { return scopes.size; }, barrier: undefined, get launcherCalls() { return gate.begun; }, onAwait: undefined,
  };
  // The launcher pin and its measured version are snapshotted HERE and used everywhere: a later mutation of the caller's config
  // object (a re-pin, a flipped attestation) cannot make a cached version describe other bytes (delta-3 #5). Everything else
  // still reads the live config, as before.
  const authorize = config.authorize;
  const pin = Object.freeze({ path: config.launcher.path, sha256: config.launcher.sha256 });
  const attested = config.launcherPatchedAttested === true;
  const cfg: ContainedStdioPortConfig = new Proxy(config, { get(target, key, receiver) { return key === "launcher" ? pin : key === "launcherPatchedAttested" ? attested : Reflect.get(target, key, receiver); } });
  // The launcher's version is measured ONCE, here, against the pinned digest, and cached: a spawn never runs the launcher
  // to learn it (review F9). A failure is kept and refused at spawn, so a broken configuration still builds a port.
  const measured: { version: string } | { error: unknown } = (() => { try { return { version: measureLauncherVersionSync(cfg, gate) }; } catch (error) { return { error }; } })();

  /**
   * The launcher, opened once: its path checks (writable roots, owner, directory chain) pass before it is ever executed,
   * it is hashed THROUGH the open descriptor, and it is executed through `/proc/<pid>/fd/<n>` of that same descriptor,
   * so the bytes that were hashed are the bytes that run. Close the handle when the process no longer needs it.
   */
  async function launcherHandle(scope: SpawnScope): Promise<{ readonly exec: string; close(): void; transfer(): void }> {
    const path = await verifyLauncherPath(cfg);
    scope.point("launcher-verified");
    if (debug.barrier) { await debug.barrier(); scope.throwIfCancelled(); }
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { throw refuse("rlm-containment-unavailable", `bubblewrap launcher ${pin.path} is missing`); }
    const owned = scope.own(() => closeSync(fd));      // registered in the turn it was opened: a scope that ends closes it, whoever holds the handle
    try {
      const info = fstatSync(fd);
      const at = lstatSync(path);
      if (info.dev !== at.dev || info.ino !== at.ino) throw refuse("rlm-containment-unavailable", "the launcher changed while it was being opened");
      if (createHash("sha256").update(readFileSync(fd)).digest("hex") !== pin.sha256) throw refuse("rlm-containment-unavailable", "the launcher digest does not match the host pin");
    } catch (error) { owned.release(); throw error; }
    return { exec: `/proc/${process.pid}/fd/${fd}`, close: owned.release, transfer: owned.transfer };
  }

  async function launcherVersion(): Promise<string> {
    if ("error" in measured) throw measured.error;
    return measured.version;
  }

  async function resolve(spec: StdioSpawnSpec, ctx: RunBinding): Promise<{ plan: LaunchPlan; material: LaunchMaterial; digest: string; profile: ExecutionProfile; profileDigest: string }> {
    const version = await launcherVersion();
    const built = await buildLaunchPlan({ config: cfg, spec, ctx, envKey, launcherVersion: version });
    return { ...built, digest: launchPlanDigest(built.plan) };
  }

  /** User namespaces and mounts must actually work here. A failure is a refusal, never a local run. */
  async function preflight(probeArgv: readonly string[], permit: { readonly active: boolean }, scope: SpawnScope): Promise<void> {
    if (preflighted) return;
    const handle = await scope.guard("preflight-handle", launcherHandle(scope));
    const probe = (() => { try { return gate.spawnSync(permit, [handle.exec, ...probeArgv.slice(1)], { stdout: "pipe", stderr: "pipe", env: {} }); } finally { handle.close(); } })();
    if (probe.exitCode !== 0) throw refuse("rlm-containment-unavailable", `bubblewrap could not create the sandbox (user namespaces unavailable?): ${(probe.stderr ?? Buffer.alloc(0)).toString().slice(0, 300)}`);
    preflighted = true;
  }

  /**
   * Open the workspace and egress socket once and hand bubblewrap the descriptors, so no path is re-resolved after
   * this point. Each descriptor must still be the object the plan recorded (dev/inode and resolved path).
   */
  function openPinned(plan: LaunchPlan, scope: SpawnScope): { workspace: number; egress: number | undefined; executable: number | undefined } {
    // Every descriptor is owned by the spawn's scope the turn it is opened, so any later throw, cancellation or dispose closes it (review L11).
    const pinned = (path: string, flags: number, want: { dev: string; ino: string }, what: string): { fd: number; owned: Owned } => {
      let fd: number;
      try { fd = openSync(path, flags | constants.O_NOFOLLOW); } catch { throw refuse("rlm-containment-unavailable", `${what} ${path} could not be opened`); }
      const owned = scope.own(() => closeSync(fd));
      const info = fstatSync(fd, { bigint: true });
      const link = (() => { try { return readlinkSync(`/proc/self/fd/${fd}`); } catch { return undefined; } })();
      if (String(info.dev) !== want.dev || String(info.ino) !== want.ino || link !== path) {
        throw refuse("rlm-containment-unavailable", `${what} ${path} is no longer the object the launch plan recorded`);
      }
      return { fd, owned };
    };
    const workspace = pinned(plan.workspace.path, constants.O_RDONLY | constants.O_DIRECTORY, plan.workspace, "workspace").fd;
    const egress = plan.egress ? pinned(plan.egress.path, O_PATH, plan.egress, "host socket").fd : undefined;
    // The executable is hashed through the descriptor it is bound by, so the hashed bytes are the bound bytes.
    const exe = pinned(plan.executable.path, O_PATH, plan.executable, "executable");
    let bytes: Buffer;
    try { bytes = readFileSync(`/proc/self/fd/${exe.fd}`); } catch { throw refuse("rlm-port-unavailable", "the executable could not be read through its descriptor"); }
    if (createHash("sha256").update(bytes).digest("hex") !== plan.executable.sha256) throw refuse("rlm-port-unavailable", "the executable digest does not match the host pin");
    if (plan.executable.bound !== "fd") { exe.owned.release(); return { workspace, egress, executable: undefined }; }
    return { workspace, egress, executable: exe.fd };
  }

  /** Allowlisted environment values travel in a private, already-unlinked file passed as fd 4. */
  function argsFd(material: LaunchMaterial, scope: SpawnScope): number {
    const dir = mkdtempSync(join(tmpdir(), "contained-args-"));
    const path = join(dir, "args");
    try {
      writeFileSync(path, material.argsFile, { mode: 0o600 });
      const fd = openSync(path, constants.O_RDONLY);
      scope.own(() => closeSync(fd));
      return fd;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** The seccomp program travels in a private, already-unlinked file passed as fd 7. */
  function seccompFd(program: Buffer, scope: SpawnScope): number {
    const dir = mkdtempSync(join(tmpdir(), "contained-seccomp-"));
    const path = join(dir, "filter");
    try {
      writeFileSync(path, program, { mode: 0o600 });
      const fd = openSync(path, constants.O_RDONLY);
      scope.own(() => closeSync(fd));
      return fd;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  async function teardown(item: Live, why: { reason: ExitReason; detail?: string }): Promise<void> {
    if (item.exit) return;
    item.requested ??= why;
    if (item.timer) clearTimeout(item.timer);
    // Learn the namespace before the kill: afterwards its members are only findable by it.
    item.nsInode ??= await sandboxNamespace(item.proc.pid);
    // Signal the launcher's group only while the launcher is still ours: a reaped pid may be recycled.
    if (item.proc.exitCode === null && item.proc.signalCode === null) {
      try { process.kill(-item.proc.pid, "SIGKILL"); } catch { /* group already gone */ }
      try { item.proc.kill("SIGKILL"); } catch { /* already gone */ }
    }
    await item.proc.exited;
  }

  /** Survivors in the sandbox namespace; only ever by a namespace known to differ from the host's. */
  async function residual(item: Live): Promise<{ pids: number[]; known: boolean }> {
    if (!item.nsInode) return { pids: [], known: false };
    let left: number[] = [];
    for (let i = 0; i < 40; i++) {
      left = (await pidsInNamespace(item.nsInode)).filter((pid) => pid !== process.pid);
      if (left.length === 0) return { pids: [], known: true };
      await sleep(50);
    }
    // Backstop: anything still in the sandbox namespace is killed individually and reported.
    for (const pid of left) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    return { pids: left, known: true };
  }

  const disposed = (): ReturnType<typeof refuse> => refuse("rlm-containment-unavailable", "the contained port has been disposed; nothing more is launched");

  function spawn(spec: StdioSpawnSpec, ctx: RunBinding): Promise<{ readonly id: string }> {
    const scope = new SpawnScope(scopes, (delta) => { waiters += delta; }, (label) => debug.onAwait?.(label));
    if (gate.closed) scope.cancel(disposed());
    const run = spawnOne(spec, ctx, scope).finally(() => scope.release());   // however the spawn ends, its scope closes everything it still owns
    pending.add(run);
    const forget = (): void => { pending.delete(run); };
    run.then(forget, forget);
    return run;
  }

  async function spawnOne(spec: StdioSpawnSpec, provided: RunBinding, scope: SpawnScope): Promise<{ readonly id: string }> {
    scope.throwIfCancelled();
    // M9: identity and reach come from the host's lease for the admitted child run, never from arguments the provider chose.
    const run = currentLease();
    if (!run) throw refuse("rlm-containment-unavailable", "a contained spawn must run inside an admitted child run's context, and none is active");
    if (!run.active) throw refuse("rlm-containment-unavailable", `the lease of run ${run.runId} has ended: its execution returned, so nothing more is launched for it`);
    // The provider's object is read exactly once; from here the immutable binding is what planning, authorization, ownership and evidence use.
    const ctx: RunBinding = Object.freeze({ intentId: String(provided.intentId), runId: String(provided.runId) });
    if (run.runId !== ctx.runId) throw refuse("rlm-containment-unavailable", `the spawn names run ${ctx.runId}, which is not the run ${run.runId} that is executing`);
    const first = await scope.guard("resolve", resolve(spec, ctx));
    if (first.plan.restrictions.network !== "none" && run.reach === "none") {
      throw refuse("rlm-egress-uncontrolled", `the spawn asks for the host socket, but the operator declared network none for the provider of run ${run.runId}`);
    }
    // The decision comes first. No sandbox of any kind (the namespace preflight included) starts before SEA-Forge allows (review M5).
    if (!run.active) throw refuse("rlm-containment-unavailable", `the lease of run ${run.runId} ended before the authority was asked`);
    await scope.guard("authorize", Promise.resolve(authorize(first.plan, first.digest, ctx, first.profileDigest)));
    await preflight(first.material.probeArgv, run, scope);
    // Descriptors are owned by this scope from the turn each is opened; nothing here closes them by hand.
    const fds = openPinned(first.plan, scope);
    const argFd = argsFd(first.material, scope);
    const filterFd = first.material.seccomp ? seccompFd(first.material.seccomp, scope) : undefined;
    // Drift check immediately before spawn: re-resolve and re-hash everything; any change refuses.
    const again = await scope.guard("resolve-again", resolve(spec, ctx));
    if (again.profileDigest !== first.profileDigest) throw refuse("rlm-containment-unavailable", `execution profile drifted before spawn (${first.profileDigest} -> ${again.profileDigest})`);
    if (again.digest !== first.digest) throw refuse("rlm-containment-unavailable", `launch plan drifted before spawn (${first.digest} -> ${again.digest})`);
    // Hash and exec through one descriptor, immediately before spawn.
    const launcher = await scope.guard("launcher-handle", launcherHandle(scope));
    const stdio: (string | number)[] = ["pipe", "pipe", "pipe", fds.workspace, argFd];
    if (fds.egress !== undefined || fds.executable !== undefined || filterFd !== undefined) stdio.push(fds.egress ?? "ignore");
    if (fds.executable !== undefined || filterFd !== undefined) stdio.push(fds.executable ?? "ignore");
    if (filterFd !== undefined) stdio.push(filterFd);
    // The launch gate checks "open and lease active" and starts the process in this same synchronous turn: nothing can intervene.
    const proc = gate.spawn(run, [launcher.exec, ...first.plan.sandboxArgv.slice(1)], { env: {}, stdio: stdio as never, detached: true });
    launcher.transfer();                                  // the live process record closes the launcher handle when the process exits
    const built = first.plan;
    const digest = first.digest;
    const id = randomUUID();
    const item: Live = {
      id, owner: { intentId: ctx.intentId, runId: ctx.runId }, plan: built, digest, proc, lines: [], sink: undefined, stderr: "", outputBytes: 0, requested: undefined, exit: undefined, timer: undefined, nsInode: undefined,
      stdoutDone: Promise.resolve(), stderrDone: Promise.resolve(),
      done: undefined as unknown as Promise<ExitRecord>,
    };
    const stderrLimit = config.stderrBytes ?? 65_536;
    const stop = (reason: ExitReason): void => { item.requested ??= { reason }; void teardown(item, { reason }); };

    item.stdoutDone = (async () => {
      let pending = "";
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        item.outputBytes += chunk.length;
        if (item.outputBytes > built.ceilings.outputBytes) { stop("output-limit"); return; }
        pending += TEXT.decode(chunk, { stream: true });
        let index: number;
        while ((index = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 1);
          if (Buffer.byteLength(line) > built.maxLineBytes) { stop("line-too-long"); return; }
          if (item.sink) item.sink(line); else item.lines.push(line);
        }
        if (Buffer.byteLength(pending) > built.maxLineBytes) { stop("line-too-long"); return; }
      }
      if (pending.length > 0) { if (item.sink) item.sink(pending); else item.lines.push(pending); }
    })();
    item.stderrDone = (async () => {
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
        if (item.stderr.length < stderrLimit) item.stderr += TEXT.decode(chunk).slice(0, stderrLimit - item.stderr.length);
      }
    })();
    item.timer = setTimeout(() => stop("wall-clock"), built.ceilings.wallSeconds * 1000);
    (item as { done: Promise<ExitRecord> }).done = (async () => {
      const code = await proc.exited;
      launcher.close();
      item.nsInode ??= await sandboxNamespace(proc.pid); // usually gone with the launcher; then the namespace stays unknown
      if (item.timer) clearTimeout(item.timer);
      const left = await residual(item);
      await Promise.allSettled([item.stdoutDone, item.stderrDone]);
      const signal = proc.signalCode ?? null;
      const reason: ExitReason = item.requested?.reason
        ?? (code === 128 + 24 || signal === "SIGXCPU" ? "cpu-ceiling" : signal ? "signal" : "exited");
      const record: ExitRecord = {
        reason, ...(item.requested?.detail ? { detail: item.requested.detail } : {}), exitCode: code, signalCode: signal ?? (SIGNAL_NUMBERS[code - 128] ?? null),
        at: new Date().toISOString(), residualPids: left.pids, nsKnown: left.known, outputBytes: item.outputBytes, stderr: item.stderr,
      };
      item.exit = record;
      // Keep the exit record (bounded) but release the live entry.
      live.delete(id);
      finished.set(id, item);
      while (finished.size > FINISHED_RETAINED) finished.delete(finished.keys().next().value as string);
      return record;
    })();
    live.set(id, item);
    // Learn the namespace as soon as the launcher has forked its init, so teardown can sweep it.
    void (async () => { for (let i = 0; i < 40 && !item.nsInode && !item.exit; i++) { item.nsInode ??= await sandboxNamespace(proc.pid); if (!item.nsInode) await sleep(10); } })();
    return { id };
  }

  const find = (id: string): Live | undefined => live.get(id) ?? finished.get(id);
  const get = (id: string): Live => {
    const item = find(id);
    if (!item) throw new Error(`rlm-port-unavailable: unknown contained process ${id}`);
    return item;
  };
  const owned = (id: string, owner: RunBinding): Live => {
    const item = get(id);
    if (item.owner.runId !== owner.runId || item.owner.intentId !== owner.intentId) throw new Error(`rlm-port-unavailable: contained process ${id} belongs to another run`);
    return item;
  };

  const port: ContainedStdioSpawnPort = {
    __debug: () => debug,
    plan: async (spec, ctx) => { const r = await resolve(spec, ctx); return { plan: r.plan, digest: r.digest, executionProfile: r.profile, executionProfileDigest: r.profileDigest }; },
    executionProfile: async (spec) => { const r = await resolve(spec, { intentId: "profile", runId: "profile" }); return { profile: r.profile, digest: r.profileDigest }; },
    spawn,
    async write(id, line) {
      const item = get(id);
      if (item.exit) throw new Error(`contained process ${id} has exited`);
      if (line.includes("\n")) throw new Error("a line must not contain a newline");
      const stdin = item.proc.stdin as { write(data: string): number; flush(): number | Promise<number> };
      stdin.write(`${line}\n`);
      await stdin.flush();
    },
    async readLines(id, sink) {
      const item = get(id);
      for (const line of item.lines.splice(0)) sink(line);
      item.sink = sink;
      await item.stdoutDone;
    },
    async kill(id, reason) {
      const item = find(id);
      if (!item) return; // idempotent: an unknown or already-pruned id is already gone
      await teardown(item, { reason: "killed", detail: reason });
      await item.done;
    },
    inspect(id) {
      const item = get(id);
      return { id, hostPid: item.proc.pid, launchPlanDigest: item.digest, plan: item.plan, state: item.exit ? "exited" : "running", ...(item.exit ? { exit: item.exit } : {}) };
    },
    exited: (id) => get(id).done,
    forRun(ctx) {
      return {
        spawn: (spec, c) => { if (c.runId !== ctx.runId || c.intentId !== ctx.intentId) return Promise.reject(new Error("rlm-port-unavailable: spawn for another run")); return spawn(spec, c); },
        write: (id, line) => { try { owned(id, ctx); } catch (error) { return Promise.reject(error); } return port.write(id, line); },
        readLines: (id, sink) => { try { owned(id, ctx); } catch (error) { return Promise.reject(error); } return port.readLines(id, sink); },
        kill: (id, reason) => { try { owned(id, ctx); } catch (error) { return Promise.reject(error); } return port.kill(id, reason); },
      };
    },
    async dispose() {
      gate.close();                                  // FIRST statement, synchronous: from here no launch can begin, by construction
      for (const scope of [...scopes]) scope.cancel(disposed());   // every spawn stops at whatever await it is at, and its scope closes what it owns
      await Promise.allSettled([...pending]); // a spawn that already reached Bun.spawn is in `live` by now, so it is torn down below
      await Promise.all([...live.values()].map(async (item) => { await teardown(item, { reason: "killed", detail: "dispose" }); await item.done; }));
    },
  };
  return port;
}
