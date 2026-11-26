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
// beyond the namespace itself (it has no interface at all), seccomp syscall filtering.
import { readdir, readFile, readlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { StdioSpawnPort, StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { buildLaunchPlan, launchPlanDigest, refuse, sha256File, validateConfig, type ContainedStdioPortConfig, type LaunchPlan } from "./containedLaunch.ts";

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
  /** Host pids still in the sandbox pid namespace after teardown (empty when containment held). */
  readonly residualPids: readonly number[];
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
  plan(spec: StdioSpawnSpec): Promise<{ readonly plan: LaunchPlan; readonly digest: string }>;
  inspect(id: string): ContainedInspection;
  /** Resolves with the exit record once the sandbox is gone. */
  exited(id: string): Promise<ExitRecord>;
  /** Terminate every live sandbox. Idempotent. */
  dispose(): Promise<void>;
}

const SIGNAL_NUMBERS: Readonly<Record<number, string>> = { 9: "SIGKILL", 15: "SIGTERM", 24: "SIGXCPU" };
const TEXT = new TextDecoder();

interface Live {
  readonly id: string;
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function containedStdioSpawnPort(config: ContainedStdioPortConfig): ContainedStdioSpawnPort {
  validateConfig(config);
  const live = new Map<string, Live>();
  let versionByDigest: { digest: string; version: string } | undefined;
  let preflighted = false;

  /** Verify the launcher digest BEFORE executing it, then read its version (memoized per digest). */
  async function launcherVersion(): Promise<string> {
    let digest: string;
    try { digest = await sha256File(config.launcher.path); } catch { throw refuse("rlm-containment-unavailable", `bubblewrap launcher ${config.launcher.path} is missing`); }
    if (digest !== config.launcher.sha256) throw refuse("rlm-containment-unavailable", "the launcher digest does not match the host pin");
    if (versionByDigest?.digest === digest) return versionByDigest.version;
    const result = Bun.spawnSync([config.launcher.path, "--version"], { stdout: "pipe", stderr: "pipe", env: {} });
    const version = result.stdout.toString().trim().replace(/^bubblewrap\s+/, "");
    if (result.exitCode !== 0 || !/^\d+\.\d+\.\d+/.test(version)) throw refuse("rlm-containment-unavailable", "the launcher did not report a bubblewrap version");
    const parts = version.split(".").map((p) => Number.parseInt(p, 10));
    const patched = config.launcherPatchedAttested === true || parts[0]! > 0 || parts[1]! >= 12;
    if (!patched) throw refuse("rlm-containment-unavailable", `bubblewrap ${version} predates the CVE-2026-87766 fix and is not attested as patched`);
    versionByDigest = { digest, version };
    return version;
  }

  async function plan(spec: StdioSpawnSpec): Promise<{ plan: LaunchPlan; digest: string }> {
    const version = await launcherVersion();
    const built = await buildLaunchPlan({ config, spec, launcherVersion: version });
    return { plan: built, digest: launchPlanDigest(built) };
  }

  /** User namespaces and mounts must actually work here. A failure is a refusal, never a local run. */
  async function preflight(built: LaunchPlan): Promise<void> {
    if (preflighted) return;
    const probe = Bun.spawnSync([...built.sandboxArgv.slice(0, built.sandboxArgv.indexOf("--") + 1), "/usr/bin/true"], { stdout: "pipe", stderr: "pipe", env: {} });
    if (probe.exitCode !== 0) throw refuse("rlm-containment-unavailable", `bubblewrap could not create the sandbox (user namespaces unavailable?): ${probe.stderr.toString().slice(0, 300)}`);
    preflighted = true;
  }

  async function teardown(item: Live, why: { reason: ExitReason; detail?: string }): Promise<void> {
    if (item.exit) return;
    item.requested ??= why;
    if (item.timer) clearTimeout(item.timer);
    // Record the sandbox's pid namespace first: after the kill its members are only findable by it.
    if (item.nsInode === undefined) {
      for (const child of await childrenOf(item.proc.pid)) item.nsInode ??= await pidNamespace(child);
    }
    try { process.kill(-item.proc.pid, "SIGKILL"); } catch { /* group already gone */ }
    try { item.proc.kill("SIGKILL"); } catch { /* already gone */ }
    await item.proc.exited;
  }

  async function residual(item: Live): Promise<number[]> {
    if (!item.nsInode) return [];
    let left: number[] = [];
    for (let i = 0; i < 40; i++) {
      left = (await pidsInNamespace(item.nsInode)).filter((pid) => pid !== process.pid);
      if (left.length === 0) return [];
      await sleep(50);
    }
    // Backstop: anything still in the sandbox namespace is killed individually and reported.
    for (const pid of left) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    return left;
  }

  async function spawn(spec: StdioSpawnSpec, ctx: { readonly intentId: string; readonly runId: string }): Promise<{ readonly id: string }> {
    const { plan: built, digest } = await plan(spec);
    await preflight(built);
    await config.authorize?.(built, digest, ctx);
    // Drift check immediately before spawn: re-resolve and re-hash everything; any change refuses.
    const again = await plan(spec);
    if (again.digest !== digest) throw refuse("rlm-containment-unavailable", `launch plan drifted before spawn (${digest} -> ${again.digest})`);

    const id = randomUUID();
    const proc = Bun.spawn([...built.sandboxArgv], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true });
    const item: Live = {
      id, plan: built, digest, proc, lines: [], sink: undefined, stderr: "", outputBytes: 0, requested: undefined, exit: undefined, timer: undefined, nsInode: undefined,
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
      // A sandbox member can outlive the launcher only if containment failed; make sure none do.
      if (item.nsInode === undefined) for (const child of await childrenOf(proc.pid)) item.nsInode ??= await pidNamespace(child);
      if (item.timer) clearTimeout(item.timer);
      try { process.kill(-proc.pid, "SIGKILL"); } catch { /* group empty */ }
      const residualPids = await residual(item);
      await Promise.allSettled([item.stdoutDone, item.stderrDone]);
      const signal = proc.signalCode ?? null;
      const reason: ExitReason = item.requested?.reason
        ?? (code === 128 + 24 || signal === "SIGXCPU" ? "cpu-ceiling" : signal ? "signal" : "exited");
      const record: ExitRecord = {
        reason, ...(item.requested?.detail ? { detail: item.requested.detail } : {}), exitCode: code, signalCode: signal ?? (SIGNAL_NUMBERS[code - 128] ?? null),
        at: new Date().toISOString(), residualPids, outputBytes: item.outputBytes, stderr: item.stderr,
      };
      item.exit = record;
      return record;
    })();
    live.set(id, item);
    // Learn the namespace as soon as the launcher has forked its init, so teardown can sweep it.
    void (async () => { for (let i = 0; i < 20 && !item.nsInode && !item.exit; i++) { for (const child of await childrenOf(proc.pid)) item.nsInode ??= await pidNamespace(child); if (!item.nsInode) await sleep(10); } })();
    return { id };
  }

  const get = (id: string): Live => {
    const item = live.get(id);
    if (!item) throw new Error(`rlm-port-unavailable: unknown contained process ${id}`);
    return item;
  };

  return {
    plan,
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
      const item = live.get(id);
      if (!item) return; // idempotent: an unknown or already-reaped id is already gone
      await teardown(item, { reason: "killed", detail: reason });
      await item.done;
    },
    inspect(id) {
      const item = get(id);
      return { id, hostPid: item.proc.pid, launchPlanDigest: item.digest, plan: item.plan, state: item.exit ? "exited" : "running", ...(item.exit ? { exit: item.exit } : {}) };
    },
    exited: (id) => get(id).done,
    async dispose() {
      await Promise.all([...live.values()].map(async (item) => { await teardown(item, { reason: "killed", detail: "dispose" }); await item.done; }));
    },
  };
}
