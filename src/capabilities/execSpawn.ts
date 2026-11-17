// Capability-bundles tranche T3 (design §2.1C, §6): the governed spawn wrapper — the ONLY route by
// which a bundle's executable payload becomes a process.
//
//  * §6.2 containment matrix, per provider kind. Refusal is the default: a restriction the world
//    cannot enforce refuses the spawn unless the world's execution-posture RECORD explicitly and
//    accurately authorizes the weaker posture. A record that claims more than the matrix supports
//    is inaccurate (a recorded core violation), and an unknown provider kind fails closed.
//  * §6.3 record-before-spawn ledger: `capability.mcp.spawn.intended` (secret REFERENCES only) is
//    committed before the process starts; `spawned` after; `exited` (or `reconciled-unknown`)
//    terminal. A failed spawn is recorded. Authorization (`beforeIntent`) is the last step before
//    the intent commit.
//  * Secrets resolve from the secret store at spawn, fail closed when a key is missing, and travel
//    ONLY in the child's environment: never argv, never a record, never a log (every string we keep
//    is redacted of the resolved values).
//  * Long-lease slot class (per world), released by the terminal record or the boot sweep.
//  * The wrapper owns the process group (`detached` => own pgid; `kill(-pgid)`), but only on the
//    host-process path. The framework's ProcessPort is buffered (`exec` returns after exit, no
//    stdin/stdout streams), so a server whose MCP stream must live over a provider cannot be spawned
//    through it: those worlds refuse with `stream-port-unavailable` (recorded) once the matrix passes.
import type { ExecutionWorldProvider, ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { readdir, readFile, readlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { StdioChannel } from "../mcp/client.ts";

export type Level = "enforced" | "partial" | "not-enforced";
export type Restriction = "filesystem" | "network" | "caps" | "subprocess" | "termination";
const RANK: Record<Level, number> = { "not-enforced": 0, partial: 1, enforced: 2 };

export interface ServerRestrictions {
  /** Declared workspace-scoped paths (port-level scoping). */
  readonly filesystem?: readonly string[];
  /** Declared outbound scopes; absent or empty = deny all. */
  readonly network?: { readonly outbound: readonly string[] };
  readonly caps?: { readonly memoryBytes?: number; readonly cpuSeconds?: number };
  /** True = the server declares it spawns subprocesses (nothing to deny). Default: denied. */
  readonly subprocess?: boolean;
}

/** The world's execution-posture record (§6.2): per restriction, the enforcement level the operator
 *  accepts, named honestly. Operator-authored; consulted, never inferred. */
export interface PostureRecord {
  readonly worldId: string;
  readonly authorizes: Partial<Record<Restriction, { readonly level: Level; readonly note: string }>>;
}

export interface ContainmentProbes { readonly prlimitVerified: boolean }

/** What each provider kind can enforce (the §6.2 matrix, one row per kind). Unknown kinds: undefined. */
export function worldMatrix(kind: string, probes: ContainmentProbes): Record<Restriction, Level> | undefined {
  switch (kind) {
    case "linux-bubblewrap": return { filesystem: "enforced", network: "enforced", caps: probes.prlimitVerified ? "enforced" : "not-enforced", subprocess: "not-enforced", termination: "enforced" };
    case "local": return { filesystem: "partial", network: "not-enforced", caps: "not-enforced", subprocess: "not-enforced", termination: "enforced" };
    case "ssh": return { filesystem: "partial", network: "not-enforced", caps: "not-enforced", subprocess: "not-enforced", termination: "not-enforced" };
    case "wsl": return { filesystem: "partial", network: "not-enforced", caps: "not-enforced", subprocess: "not-enforced", termination: "partial" };
    default: return undefined;
  }
}

export type ContainmentDecision =
  | { readonly ok: true; readonly relaxed: readonly { readonly restriction: Restriction; readonly actual: Level; readonly note: string }[]; readonly termination: Level }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly restriction?: Restriction; readonly coreViolation?: true };

export function decideContainment(world: { readonly kind: string; readonly worldId: string }, restrictions: ServerRestrictions, posture: PostureRecord | undefined, probes: ContainmentProbes): ContainmentDecision {
  const matrix = worldMatrix(world.kind, probes);
  if (!matrix) return { ok: false, code: "posture-unknown", reason: `the containment posture of provider kind "${world.kind}" is unknown — failing closed` };
  if (restrictions.network && restrictions.network.outbound.length > 0 && world.kind === "linux-bubblewrap") {
    return { ok: false, code: "network-scope-unsatisfiable", reason: "the contained posture denies the network totally (--unshare-all); a declared outbound scope cannot be satisfied there", restriction: "network" };
  }
  const required: Restriction[] = ["network", "subprocess", "termination"];
  if (restrictions.filesystem && restrictions.filesystem.length > 0) required.push("filesystem");
  if (restrictions.caps && (restrictions.caps.memoryBytes || restrictions.caps.cpuSeconds)) required.push("caps");
  if (restrictions.subprocess === true) required.splice(required.indexOf("subprocess"), 1);
  const relaxed: { restriction: Restriction; actual: Level; note: string }[] = [];
  for (const restriction of required) {
    const actual = matrix[restriction];
    if (actual === "enforced") continue;
    const record = posture?.authorizes[restriction];
    if (!record) return { ok: false, code: `unenforceable:${restriction}`, reason: `world ${world.worldId} (${world.kind}) cannot enforce ${restriction} (${actual}) and its posture record does not authorize the weaker posture`, restriction };
    if (RANK[record.level] > RANK[actual]) {
      return { ok: false, code: "posture-inaccurate", reason: `the posture record of ${world.worldId} claims ${restriction} is ${record.level}, but the ${world.kind} matrix supports only ${actual}: an inaccurate record is a core violation`, restriction, coreViolation: true };
    }
    if (!record.note.trim()) return { ok: false, code: "posture-unexplained", reason: `the posture record of ${world.worldId} authorizes weaker ${restriction} without naming the weaker posture`, restriction };
    relaxed.push({ restriction, actual, note: record.note });
  }
  return { ok: true, relaxed, termination: matrix.termination };
}

export interface SpawnRequest {
  readonly capabilityId: string;
  readonly version: string;
  readonly serverId: string;
  readonly sessionId?: string;
  readonly worldId: string;
  /** Declared argv (from the verified manifest, `${bundleDir}` already substituted). Never carries secrets. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** The version directory: the signature the boot sweep scopes kills to. */
  readonly bundleDir: string;
  readonly secrets: readonly { readonly env: string; readonly key: string }[];
  readonly restrictions: ServerRestrictions;
  readonly stop: "graceful" | "emergency";
}

export type LedgerEvent = { readonly type: string; readonly payload: Record<string, unknown> };

export interface SpawnDeps {
  readonly registry: ExecutionWorldRegistry;
  readonly getPosture: (worldId: string) => PostureRecord | undefined;
  readonly resolveSecret: (key: string) => Promise<string | undefined>;
  /** Commit ledger records (one stream per spawn). A throw means "not recorded". */
  readonly ledger: (spawnId: string, events: readonly LedgerEvent[]) => Promise<void>;
  /** Decision record for a refusal (point "spawn"). */
  readonly recordRefusal: (request: SpawnRequest, code: string, reason: string, extra?: Record<string, unknown>) => Promise<void>;
  readonly slots: { acquire(worldId: string): Promise<{ slotId: string }>; release(slotId: string, wallMs: number): Promise<void>; /** Boot: free every long-lease slot still reserved after the ledger sweep. */ releaseAll?(): Promise<unknown> };
  /** The app's execution posture permits host-process spawns on the `local` world. */
  readonly localHostSpawnAllowed: () => boolean;
  /** The LAST step before the intent commit: the authorization (authorizeCapabilityOp). */
  readonly beforeIntent: () => Promise<{ readonly code: string; readonly reason: string } | undefined>;
  readonly probes?: (provider: ExecutionWorldProvider) => Promise<ContainmentProbes>;
  readonly graceMs?: number;
  readonly killMs?: number;
}

export interface ExitInfo { readonly outcome: string; readonly exitCode: number | null; readonly stopReason?: string }

export interface SpawnHandle {
  readonly spawnId: string;
  readonly pid: number;
  readonly channel: StdioChannel;
  readonly exited: Promise<ExitInfo>;
  /** Initiates termination synchronously (state flips and the first signal is sent before this returns). */
  stop(reason: string, mode?: "graceful" | "emergency"): void;
  readonly stopping: boolean;
}

export type SpawnResult = { readonly ok: true; readonly handle: SpawnHandle } | { readonly ok: false; readonly code: string; readonly reason: string };

const redactor = (secrets: readonly string[]) => (text: string): string => secrets.filter((s) => s.length >= 4).reduce((acc, s) => acc.split(s).join("[redacted]"), text);

export async function spawnGoverned(deps: SpawnDeps, request: SpawnRequest): Promise<SpawnResult> {
  const refuse = async (code: string, reason: string, extra: Record<string, unknown> = {}): Promise<SpawnResult> => {
    await deps.recordRefusal(request, code, reason, extra).catch(() => {});
    return { ok: false, code, reason };
  };
  if (!deps.registry.has(request.worldId)) return refuse("world-unavailable", `execution world ${request.worldId} is not connected`);
  const world = deps.registry.get(request.worldId);
  const probes = deps.probes ? await deps.probes(world).catch(() => ({ prlimitVerified: false })) : { prlimitVerified: false };
  const decision = decideContainment(world, request.restrictions, deps.getPosture(world.worldId), probes);
  if (!decision.ok) return refuse(decision.code, decision.reason, decision.coreViolation ? { coreViolation: true } : {});
  if (world.kind !== "local") return refuse("stream-port-unavailable", `world ${world.worldId} (${world.kind}) exposes no streaming process port; an MCP server cannot be held over it in this release`);
  if (!deps.localHostSpawnAllowed()) return refuse("posture-contained", "the execution posture is contained: host-process spawns on the local world are refused");
  if (request.argv.length === 0) return refuse("empty-argv", "the server declares no command");

  // Secrets: env-only, fail closed on a missing key.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  const resolved: string[] = [];
  for (const secret of request.secrets) {
    const value = await deps.resolveSecret(secret.key).catch(() => undefined);
    if (value === undefined || value === "") return refuse("missing-secret", `secret key ${secret.key} (for ${secret.env}) is not in the secret store`);
    env[secret.env] = value;
    resolved.push(value);
  }
  const redact = redactor(resolved);

  let slot: { slotId: string };
  try {
    slot = await deps.slots.acquire(world.worldId);
  } catch (error) {
    return refuse("slot-refused", redact(error instanceof Error ? error.message : String(error)));
  }
  const startedMs = Date.now();
  const spawnId = `spawn-${randomUUID()}`;
  const base = { spawnId, capabilityId: request.capabilityId, version: request.version, serverId: request.serverId, ...(request.sessionId ? { sessionId: request.sessionId } : {}), worldId: world.worldId, worldKind: world.kind };
  // One stream per spawn: its records commit strictly in order (CAS on the stream version).
  let chain: Promise<unknown> = Promise.resolve();
  const queued = (events: readonly LedgerEvent[]): Promise<void> => {
    const next = chain.then(() => deps.ledger(spawnId, events));
    chain = next.catch(() => undefined);
    return next;
  };
  const release = (): Promise<void> => deps.slots.release(slot.slotId, Date.now() - startedMs).catch(() => {});

  const denied = await deps.beforeIntent();
  if (denied) { await release(); return refuse(denied.code, denied.reason); }
  try {
    await deps.ledger(spawnId, [{
      type: "capability.mcp.spawn.intended",
      payload: { ...base, argv: [...request.argv], cwd: request.cwd, bundleDir: request.bundleDir, secretRefs: request.secrets.map((s) => ({ env: s.env, key: s.key })), slotId: slot.slotId, stop: request.stop, restrictions: request.restrictions as unknown as Record<string, unknown>, relaxed: decision.relaxed as unknown as Record<string, unknown>[], termination: decision.termination },
    }]);
  } catch (error) {
    await release();
    return { ok: false, code: "record-failed", reason: `the spawn intent could not be recorded, so nothing was spawned: ${redact(error instanceof Error ? error.message : String(error))}` };
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([...request.argv], { cwd: request.cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    await queued([{ type: "capability.mcp.exited", payload: { ...base, outcome: "spawn-failed", exitCode: null, stderrTail: message.slice(0, 512) } }]).catch(() => {});
    await release();
    return { ok: false, code: "spawn-failed", reason: message };
  }
  const pid = proc.pid;
  const stdin = proc.stdin as unknown as { write(data: string): unknown; flush?(): unknown; end(): unknown };
  const dataListeners: ((chunk: Buffer) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  // Redaction happens on a retained window that is wider than any secret (never on a slice that could
  // cut one in half), then the record keeps only the redacted tail.
  const window = Math.max(8192, 2 * Math.max(0, ...resolved.map((v) => v.length)) + 1024);
  let stderrTail = "";
  const pump = async (stream: ReadableStream<Uint8Array>, sink: (chunk: Buffer) => void): Promise<void> => {
    try { for await (const chunk of stream) sink(Buffer.from(chunk)); } catch { /* closed */ }
  };
  void pump(proc.stdout as ReadableStream<Uint8Array>, (chunk) => { for (const l of dataListeners) l(chunk); });
  void pump(proc.stderr as ReadableStream<Uint8Array>, (chunk) => { stderrTail = (stderrTail + chunk.toString("utf8")).slice(-window); });

  let stopping = false;
  let stopReason: string | undefined;
  const killGroup = (signal: NodeJS.Signals): void => { try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } } };
  const grace = deps.graceMs ?? 3000;
  const killAfter = deps.killMs ?? 2000;
  const stop = (reason: string, mode: "graceful" | "emergency" = request.stop): void => {
    if (stopping && mode !== "emergency") return;
    const first = !stopping;
    stopping = true;
    stopReason ??= reason;
    if (mode === "emergency") { killGroup("SIGKILL"); return; }
    if (!first) return;
    try { void stdin.end(); } catch { /* closed */ }
    setTimeout(() => killGroup("SIGTERM"), grace).unref?.();
    setTimeout(() => killGroup("SIGKILL"), grace + killAfter).unref?.();
  };

  const exited: Promise<ExitInfo> = (async () => {
    const exitCode = await proc.exited;
    // Anything left in the group dies with the server (group-kill discipline, §6.1).
    killGroup("SIGKILL");
    const outcome = stopping ? "stopped" : exitCode === 0 ? "exited" : "crashed";
    const info: ExitInfo = { outcome, exitCode, ...(stopReason ? { stopReason } : {}) };
    await queued([{ type: "capability.mcp.exited", payload: { ...base, outcome, exitCode, ...(stopReason ? { stopReason } : {}), termination: decision.termination === "enforced" ? "group-kill" : "best-effort", stderrTail: redact(stderrTail).slice(-512) } }]).catch(() => {});
    await release();
    for (const l of closeListeners) l();
    return info;
  })();

  const handle: SpawnHandle = {
    spawnId, pid, exited, stop,
    get stopping() { return stopping; },
    channel: {
      write: (data) => { stdin.write(data); stdin.flush?.(); },
      onData: (l) => { dataListeners.push(l); },
      onClose: (l) => { closeListeners.push(l); },
      close: async () => { stop("channel-closed", "graceful"); },
    },
  };
  try {
    await queued([{ type: "capability.mcp.spawned", payload: { ...base, pid } }]);
  } catch (error) {
    stop("unrecorded", "emergency");
    await exited;
    return { ok: false, code: "record-failed", reason: `the spawn confirmation could not be recorded; the process was killed: ${redact(error instanceof Error ? error.message : String(error))}` };
  }
  return { ok: true, handle };
}

export interface LedgerRow {
  readonly spawnId: string; readonly status: string; readonly pid?: number | null; readonly bundleDir?: string; readonly argv?: readonly string[];
  readonly capabilityId: string; readonly version: string; readonly serverId: string; readonly sessionId?: string; readonly worldId: string; readonly worldKind?: string; readonly slotId?: string;
}

/** Boot-sweep reconciliation (§6.3): every intent without a terminal record reconciles to a
 *  recorded outcome. `confirmed`: kill by recorded pid after checking the process still carries the
 *  version-directory signature; `intended`: best-effort signature kill scoped to the version
 *  directory path (never a bare cmdline match); then record. The caller runs this before any spawn. */
export async function reconcileSpawnLedger(deps: Pick<SpawnDeps, "ledger" | "slots">, rows: readonly LedgerRow[], proc: { readonly readCmdline: (pid: number) => Promise<string | undefined>; readonly readCwd: (pid: number) => Promise<string | undefined>; readonly listPids: () => Promise<number[]> } = procfs): Promise<{ spawnId: string; outcome: string }[]> {
  const results: { spawnId: string; outcome: string }[] = [];
  for (const row of rows) {
    if (row.status !== "intended" && row.status !== "confirmed") continue;
    const signature = row.bundleDir ?? "";
    // Identity: the process runs under the version directory (its cwd, or its command line names it)
    // AND its program is the declared one. A relative command (`bun server.mjs` with cwd = the
    // version directory) is identified by its cwd.
    const program = (row.argv?.[0] ?? "").split("/").pop() ?? "";
    const matches = async (pid: number): Promise<boolean> => {
      if (!signature) return false;
      const cmdline = await proc.readCmdline(pid);
      if (cmdline === undefined) return false;
      const underDir = cmdline.includes(signature) || (await proc.readCwd(pid)) === signature;
      return underDir && (!program || cmdline.includes(program));
    };
    let outcome = "reconciled-unknown";
    if (row.worldKind === "local") {
      if (row.status === "confirmed" && typeof row.pid === "number") {
        if (await matches(row.pid)) { try { process.kill(-row.pid, "SIGKILL"); } catch { try { process.kill(row.pid, "SIGKILL"); } catch { /* gone */ } } outcome = "reconciled-killed"; }
        else outcome = "reconciled-gone";
      } else if (signature) {
        for (const pid of await proc.listPids()) if (pid !== process.pid && await matches(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
      }
    }
    await deps.ledger(row.spawnId, [{ type: "capability.mcp.exited", payload: { spawnId: row.spawnId, capabilityId: row.capabilityId, version: row.version, serverId: row.serverId, ...(row.sessionId ? { sessionId: row.sessionId } : {}), worldId: row.worldId, outcome: outcome === "reconciled-gone" || outcome === "reconciled-killed" ? "reconciled" : "reconciled-unknown", reconciled: outcome, exitCode: null } }]);
    if (row.slotId) await deps.slots.release(row.slotId, 0).catch(() => {});
    results.push({ spawnId: row.spawnId, outcome });
  }
  return results;
}

const procfs = {
  async readCmdline(pid: number): Promise<string | undefined> {
    try { return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "); } catch { return undefined; }
  },
  async readCwd(pid: number): Promise<string | undefined> {
    try { return await readlink(`/proc/${pid}/cwd`); } catch { return undefined; }
  },
  async listPids(): Promise<number[]> {
    try { return (await readdir("/proc")).filter((n) => /^\d+$/.test(n)).map(Number); } catch { return []; }
  },
};
