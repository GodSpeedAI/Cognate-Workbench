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
  /** Process group id (the child leads its own group). */
  readonly pgid: number;
  /** Scrubs this server's resolved secret values (and their encodings) out of anything MCP-originated. */
  readonly scrubber: Scrubber;
  /** Initiates termination synchronously (state flips and the first signal is sent before this returns). */
  stop(reason: string, mode?: "graceful" | "emergency"): void;
  readonly stopping: boolean;
}

export type SpawnResult = { readonly ok: true; readonly handle: SpawnHandle } | { readonly ok: false; readonly code: string; readonly reason: string };

/** Secrets shorter than this (UTF-8 bytes) are not scrubbed: too short to match meaningfully. */
const MIN_SCRUB_BYTES = 8;

/** The scrubber for one server's resolved secrets: the exact value plus its common encodings (base64 in
 *  its standard/URL-safe, padded/unpadded forms, URL-encoded, hex) become `[REDACTED:<NAME>]`. Applied to
 *  everything MCP-originated before it is returned, recorded or logged. */
export interface Scrubber {
  text(value: string): string;
  deep<T>(value: T): T;
}
export function makeScrubber(secrets: readonly { readonly name: string; readonly value: string }[]): Scrubber {
  const patterns: { needle: string; mark: string }[] = [];
  for (const { name, value } of secrets) {
    if (Buffer.byteLength(value, "utf8") < MIN_SCRUB_BYTES) continue;
    const mark = `[REDACTED:${name}]`;
    const bytes = Buffer.from(value, "utf8");
    const b64 = bytes.toString("base64");
    const variants = new Set([value, b64, b64.replace(/=+$/, ""), bytes.toString("base64url"), encodeURIComponent(value), bytes.toString("hex"), bytes.toString("hex").toUpperCase()]);
    // UTF-16 (LE and BE): the raw code units, and their base64 and hex forms.
    for (const wide of [Buffer.from(value, "utf16le"), Buffer.from(value, "utf16le").swap16()]) {
      const wb64 = wide.toString("base64");
      for (const form of [wide.toString("latin1"), wb64, wb64.replace(/=+$/, ""), wide.toString("base64url"), wide.toString("hex"), wide.toString("hex").toUpperCase()]) variants.add(form);
    }
    for (const needle of variants) if (needle) patterns.push({ needle, mark });
  }
  // Longest first, so an encoding that contains a shorter variant is replaced whole.
  patterns.sort((a, b) => b.needle.length - a.needle.length);
  const text = (value: string): string => patterns.reduce((acc, p) => (acc.includes(p.needle) ? acc.split(p.needle).join(p.mark) : acc), value);
  const deep = <T,>(value: T): T => {
    if (typeof value === "string") return text(value) as T;
    if (Array.isArray(value)) return value.map((v) => deep(v)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [text(k), deep(v)])) as T;
    return value;
  };
  return { text, deep };
}

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
  if (process.platform === "win32") return refuse("no-process-groups", "this platform cannot give a spawned server its own process group, so it cannot be stopped as a group: refusing, not falling back");
  if (request.argv.length === 0) return refuse("empty-argv", "the server declares no command");

  // Secrets: env-only, fail closed on a missing key.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  const resolved: string[] = [];
  const resolvedNamed: { name: string; value: string }[] = [];
  for (const secret of request.secrets) {
    const value = await deps.resolveSecret(secret.key).catch(() => undefined);
    if (value === undefined || value === "") return refuse("missing-secret", `secret key ${secret.key} (for ${secret.env}) is not in the secret store`);
    // A value this short cannot be scrubbed safely from what the server sends back: it is never delivered (fail closed).
    if (Buffer.byteLength(value, "utf8") < MIN_SCRUB_BYTES) return refuse("secret-too-short", `the secret for ${secret.env} (key ${secret.key}) is shorter than ${MIN_SCRUB_BYTES} bytes and cannot be scrubbed from a server's output; it is not delivered`);
    env[secret.env] = value;
    resolved.push(value);
    resolvedNamed.push({ name: secret.env, value });
  }
  const scrubber = makeScrubber(resolvedNamed);
  const redact = scrubber.text;

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
    // The spawn id travels in the environment (not a secret): descendants inherit it, so the boot sweep can find every
    // process of a spawn even when its leader is gone and it recorded nothing yet.
    proc = Bun.spawn([...request.argv], { cwd: request.cwd, env: { ...env, COGNATE_SPAWN_ID: spawnId }, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true });
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

  const groupAlive = (): boolean => { try { process.kill(-pid, 0); return true; } catch { return false; } };
  const holders = async (): Promise<number[]> => (await procfs.pidsWithSpawnId(spawnId)).filter((p) => p !== process.pid);
  /** Alive means: the group answers a probe OR any process still carries the spawn's marker (a descendant that left the group). */
  const anythingAlive = async (): Promise<boolean> => groupAlive() || (await holders()).length > 0;
  const signalAll = async (sig: NodeJS.Signals): Promise<void> => { killGroup(sig); for (const h of await holders()) { try { process.kill(h, sig); } catch { /* gone */ } } };
  const waitGroupGone = async (ms: number): Promise<boolean> => {
    const until = Date.now() + ms;
    while ((await anythingAlive()) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
    return !(await anythingAlive());
  };
  const exited: Promise<ExitInfo> = (async () => {
    const exitCode = await proc.exited;
    // Whatever is left in the leader's group is ended as a group: TERM, KILL after the grace period; the slot is
    // released only once nothing of the group is alive (section 6.1).
    let survivors = false;
    if (await anythingAlive()) {
      await signalAll("SIGTERM");
      if (!(await waitGroupGone(grace))) { await signalAll("SIGKILL"); survivors = !(await waitGroupGone(killAfter + 1000)); }
    }
    const outcome = stopping ? "stopped" : exitCode === 0 ? "exited" : "crashed";
    const info: ExitInfo = { outcome, exitCode, ...(stopReason ? { stopReason } : {}) };
    await queued([{ type: "capability.mcp.exited", payload: { ...base, outcome, exitCode, ...(stopReason ? { stopReason } : {}), pgid: pid, ...(survivors ? { survivors: true } : {}), termination: decision.termination === "enforced" ? "group-kill" : "best-effort", stderrTail: redact(stderrTail).slice(-512) } }]).catch(() => {});
    if (!survivors) await release(); // survivors keep the slot reserved: the boot sweep reconciles them
    for (const l of closeListeners) l();
    return info;
  })();

  const handle: SpawnHandle = {
    spawnId, pid, pgid: pid, scrubber, exited, stop,
    get stopping() { return stopping; },
    channel: {
      write: (data) => { stdin.write(data); stdin.flush?.(); },
      onData: (l) => { dataListeners.push(l); },
      onClose: (l) => { closeListeners.push(l); },
      close: async () => { stop("channel-closed", "graceful"); },
    },
  };
  try {
    await queued([{ type: "capability.mcp.spawned", payload: { ...base, pid, pgid: pid } }]);
  } catch (error) {
    stop("unrecorded", "emergency");
    await exited;
    return { ok: false, code: "record-failed", reason: `the spawn confirmation could not be recorded; the process was killed: ${redact(error instanceof Error ? error.message : String(error))}` };
  }
  return { ok: true, handle };
}

export interface LedgerRow {
  readonly spawnId: string; readonly status: string; readonly pid?: number | null; readonly pgid?: number | null; readonly bundleDir?: string; readonly argv?: readonly string[];
  readonly capabilityId: string; readonly version: string; readonly serverId: string; readonly sessionId?: string; readonly worldId: string; readonly worldKind?: string; readonly slotId?: string;
}

export interface ProcView {
  readCmdline(pid: number): Promise<string | undefined>;
  readCwd(pid: number): Promise<string | undefined>;
  listPids(): Promise<number[]>;
  /** Every live process whose environment carries this spawn's id (the leader AND its descendants, even after the leader died). */
  pidsWithSpawnId(spawnId: string): Promise<number[]>;
}

/** Boot-sweep reconciliation (section 6.3): every intent without a terminal record reconciles to a
 *  recorded outcome. A spawn's processes are found by the spawn id in their environment (leader and
 *  descendants alike, whether or not the leader still lives, whether or not the spawn was confirmed),
 *  and by the version-directory signature (command line or cwd) for ledgers that predate the marker.
 *  They are ended as a set: TERM, KILL after the grace period, and the slot is released only when none
 *  survives. The caller runs this before any new spawn. */
export async function reconcileSpawnLedger(deps: Pick<SpawnDeps, "ledger" | "slots"> & { readonly graceMs?: number }, rows: readonly LedgerRow[], proc: ProcView = procfs): Promise<{ spawnId: string; outcome: string }[]> {
  const grace = deps.graceMs ?? 1000;
  const results: { spawnId: string; outcome: string }[] = [];
  const signal = (pid: number, sig: NodeJS.Signals): void => { try { process.kill(pid, sig); } catch { /* gone */ } };
  for (const row of rows) {
    if (row.status !== "intended" && row.status !== "confirmed") continue;
    const signature = row.bundleDir ?? "";
    const program = (row.argv?.[0] ?? "").split("/").pop() ?? "";
    // Signature identity (older ledgers): the process runs under the version directory AND is the declared program.
    const matches = async (pid: number): Promise<boolean> => {
      if (!signature) return false;
      const cmdline = await proc.readCmdline(pid);
      if (cmdline === undefined) return false;
      const underDir = cmdline.includes(signature) || (await proc.readCwd(pid)) === signature;
      return underDir && (!program || cmdline.includes(program));
    };
    let outcome = "reconciled-unknown";
    let survivors = false;
    if (row.worldKind === "local") {
      const targets = async (): Promise<Set<number>> => {
        const found = new Set(await proc.pidsWithSpawnId(row.spawnId));
        if (row.status === "confirmed" && typeof row.pid === "number" && (await matches(row.pid))) found.add(row.pid);
        else if (row.status === "intended" && signature) for (const pid of await proc.listPids()) if (pid !== process.pid && (await matches(pid))) found.add(pid);
        found.delete(process.pid);
        return found;
      };
      // "Gone" needs proof: the recorded group answers no probe AND no process carries the spawn's marker.
      const group = row.pgid ?? undefined; // only a RECORDED group id is probed: a bare pid may have been reused
      const groupLive = (): boolean => { if (typeof group !== "number" || group <= 1) return false; try { process.kill(-group, 0); return true; } catch { return false; } };
      const anyAlive = async (): Promise<boolean> => (await targets()).size > 0 || groupLive();
      const endAll = async (sig: NodeJS.Signals): Promise<void> => {
        for (const pid of await targets()) signal(pid, sig);
        if (typeof group === "number" && group > 1) signal(-group, sig);
      };
      if (await anyAlive()) {
        await endAll("SIGTERM");
        const until = Date.now() + grace;
        while ((await anyAlive()) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
        if (await anyAlive()) {
          await endAll("SIGKILL");
          const hard = Date.now() + 1000;
          while ((await anyAlive()) && Date.now() < hard) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        survivors = await anyAlive();
        outcome = survivors ? "reconcile-incomplete" : row.status === "confirmed" ? "reconciled-killed" : "reconciled-unknown";
      } else if (row.status === "confirmed") outcome = "reconciled-gone";
    }
    await deps.ledger(row.spawnId, [{ type: "capability.mcp.exited", payload: { spawnId: row.spawnId, capabilityId: row.capabilityId, version: row.version, serverId: row.serverId, ...(row.sessionId ? { sessionId: row.sessionId } : {}), worldId: row.worldId, outcome: outcome === "reconciled-gone" || outcome === "reconciled-killed" ? "reconciled" : "reconciled-unknown", reconciled: outcome, ...(survivors ? { survivors: true } : {}), exitCode: null } }]);
    // A slot is released only when nothing of the spawn survives; survivors keep it reserved (and are reported).
    if (row.slotId && !survivors) await deps.slots.release(row.slotId, 0).catch(() => {});
    results.push({ spawnId: row.spawnId, outcome });
  }
  return results;
}

const procfs: ProcView = {
  async readCmdline(pid: number): Promise<string | undefined> {
    try { return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "); } catch { return undefined; }
  },
  async readCwd(pid: number): Promise<string | undefined> {
    try { return await readlink(`/proc/${pid}/cwd`); } catch { return undefined; }
  },
  async pidsWithSpawnId(spawnId: string): Promise<number[]> {
    const marker = `COGNATE_SPAWN_ID=${spawnId}\0`;
    const found: number[] = [];
    for (const pid of await this.listPids()) {
      try { if ((await readFile(`/proc/${pid}/environ`, "utf8")).includes(marker)) found.push(pid); } catch { /* not ours or gone */ }
    }
    return found;
  },
  async listPids(): Promise<number[]> {
    try { return (await readdir("/proc")).filter((n) => /^\d+$/.test(n)).map(Number); } catch { return []; }
  },
};
