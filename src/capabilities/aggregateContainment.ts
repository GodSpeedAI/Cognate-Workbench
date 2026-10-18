// Aggregate resource containment for contained executions (T8, J-RW-AGGREGATE-CONTAINMENT).
//
// The OS boundary of one contained workspace is its provider's (bubblewrap namespaces). What was
// missing is the AGGREGATE: one operator-configured ceiling across every contained execution and
// every Workbench process sharing one store. This ledger is the durable admission truth: a new
// contained execution must acquire an aggregate slot before any child process is launched, and a
// configured quota that would be exceeded refuses the work (fail closed, never silently widened).
//
// Quota dimensions (operator settings, `settings.changeContainment`):
//   maxConcurrent           aggregate live contained executions across processes (exact slot count)
//   cpuSecondsPerWindow     aggregate CPU-second budget per fixed window (default 24h); every
//                           admitted execution books its full kernel CPU cap conservatively — an
//                           upper bound, since actual per-child CPU time is not observable here
//   cpuSecondsPerExecution  the kernel RLIMIT_CPU cap applied to each contained child (prlimit)
//   maxAddressSpaceBytes    the kernel RLIMIT_AS cap applied to each contained child
//
// A crashed holder's slot is not leaked: reservations carry a lease (the exec's own timeout plus
// slack), and any later admission or boot reaps expired slots and books them conservatively. The
// kernel caps are applied inside the namespace with `prlimit` — if the quota is configured but the
// tooling is unavailable inside the world, the execution is refused, never run uncapped.
import type { ExecutionWorldProvider, ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

export const CONTAINMENT_THREAD = "containment:aggregate:v1";

export interface ContainmentQuotas {
  readonly maxConcurrent?: number;
  readonly cpuSecondsPerExecution?: number;
  readonly cpuSecondsPerWindow?: number;
  readonly cpuWindowHours?: number;
  readonly maxAddressSpaceBytes?: number;
}

export type ContainmentExecutionStatus = "reserved" | "completed";
export type ContainmentOutcome = "completed" | "cancelled" | "cpu-capped" | "memory-capped" | "killed" | "reaped";

export interface ContainmentExecution {
  readonly id: string;
  readonly worldId: string;
  status: ContainmentExecutionStatus;
  readonly reservedAt: string;
  /** Past this instant the slot may be reaped by any admission or boot: the child was bounded by
   *  its own exec timeout, so a slot older than the lease cannot still be live. */
  readonly leaseUntilMs: number;
  /** The kernel CPU cap booked conservatively for this execution (0 when no cap applies). */
  readonly cpuSeconds: number;
  readonly addressSpaceBytes: number | null;
  outcome?: ContainmentOutcome;
  wallMs?: number;
  endedAt?: string;
}

export interface ContainmentState { schema: 1; executions: Record<string, ContainmentExecution> }

export class ContainmentQuotaError extends Error {
  override readonly name = "ContainmentQuotaError";
  constructor(readonly kind: "max_concurrent" | "cpu_window" | "kernel_caps_unavailable" | "invalid_quota", message: string) { super(message); }
}

const CAP_FIELDS = ["maxConcurrent", "cpuSecondsPerExecution", "cpuSecondsPerWindow", "cpuWindowHours", "maxAddressSpaceBytes"] as const;

/** Authoritative parser shared by the settings validator and the enforcement layer. An invalid
 *  stored value throws — admission under an unusable quota fails closed. The empty object is the
 *  explicit "clear the quotas" patch, distinct from absent (no quota behavior). */
export function parseContainmentQuotas(raw: unknown): ContainmentQuotas | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Containment quotas must be an object");
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !(CAP_FIELDS as readonly string[]).includes(key))) throw new Error("Unknown containment quota field");
  const quotas: Record<string, number> = {};
  for (const field of CAP_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive finite number`);
    if (field === "maxConcurrent" && (!Number.isInteger(value) || value > 256)) throw new Error("maxConcurrent must be an integer between 1 and 256");
    if (field === "cpuSecondsPerExecution" && value > 86_400) throw new Error("cpuSecondsPerExecution must be at most one day");
    if (field === "cpuSecondsPerWindow" && value > 10 * 86_400) throw new Error("cpuSecondsPerWindow must be at most ten days");
    if (field === "cpuWindowHours" && (!Number.isInteger(value) || value > 24 * 90)) throw new Error("cpuWindowHours must be an integer between 1 and 2160");
    if (field === "maxAddressSpaceBytes" && (!Number.isInteger(value) || value > 2 ** 48)) throw new Error("maxAddressSpaceBytes must be an integer below 2^48");
    quotas[field] = value;
  }
  if (Object.keys(quotas).length === 0) return undefined;
  // A window budget is only enforceable if every execution carries a bookable CPU cap.
  if (quotas.cpuSecondsPerWindow !== undefined && quotas.cpuSecondsPerExecution === undefined) {
    throw new Error("cpuSecondsPerWindow requires cpuSecondsPerExecution (the bookable per-execution kernel CPU cap)");
  }
  return quotas as ContainmentQuotas;
}

export function emptyContainmentState(): ContainmentState { return { schema: 1, executions: {} }; }

export function isContainmentState(value: unknown): value is ContainmentState {
  return !!value && typeof value === "object" && (value as Partial<ContainmentState>).schema === 1
    && typeof (value as Partial<ContainmentState>).executions === "object" && !Array.isArray((value as Partial<ContainmentState>).executions);
}

/** Operator-configured quotas resolve from the authoritative settings projection; an invalid
 *  stored value fails closed (the caller's contained work is refused, never silently uncapped). */
export async function readContainmentQuotas(service: RuntimeService, caller: Caller): Promise<ContainmentQuotas | undefined> {
  const rows = (await service.readProjection(caller, { name: "settings" })).rows;
  const current = rows.find(row => row.key === "current" || row.key === `${caller.tenant}/current`)?.value as { containment?: unknown } | undefined;
  if (current?.containment === undefined || current?.containment === null) return undefined;
  return parseContainmentQuotas(current.containment);
}

async function readState(service: RuntimeService, caller: Caller): Promise<{ state: ContainmentState; version: number }> {
  const result = await service.readSharedState(caller, { threadId: CONTAINMENT_THREAD });
  if (result.version === 0) return { state: emptyContainmentState(), version: 0 };
  if (!isContainmentState(result.state)) throw new Error("Unsupported aggregate containment ledger schema; an explicit versioned migration is required");
  return { state: result.state as ContainmentState, version: result.version };
}

async function writeState(service: RuntimeService, caller: Caller, state: ContainmentState, version: number, idempotencyKey: string): Promise<boolean> {
  try {
    await service.updateSharedState(caller, { threadId: CONTAINMENT_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey });
    return true;
  } catch (error) {
    if (error instanceof ServiceError && ["failed_precondition", "unavailable"].includes(error.code)) return false;
    throw error;
  }
}

function windowStartMs(quotas: ContainmentQuotas, nowMs: number): number {
  const windowMs = (quotas.cpuWindowHours ?? 24) * 60 * 60 * 1000;
  return nowMs - (nowMs % windowMs);
}

/** Booked aggregate CPU seconds inside the current window. Every execution that is live now or
 *  ended inside the window books its FULL kernel CPU cap — a conservative upper bound (the same
 *  honesty rule as billing: never book less than the provable bound, never guess actual usage). */
export function bookedCpuSecondsInWindow(state: ContainmentState, quotas: ContainmentQuotas, nowMs: number): number {
  const start = windowStartMs(quotas, nowMs);
  let booked = 0;
  for (const execution of Object.values(state.executions)) {
    if (execution.cpuSeconds <= 0) continue;
    if (execution.status === "reserved") { booked += execution.cpuSeconds; continue; }
    const endedMs = Date.parse(execution.endedAt ?? execution.reservedAt);
    if (endedMs >= start) booked += execution.cpuSeconds;
  }
  return booked;
}

export interface ContainmentAdmission {
  readonly quotas: ContainmentQuotas;
  readonly cpuSecondsPerExecution: number;
  readonly addressSpaceBytes: number | null;
  readonly slotId: string;
  readonly leaseUntilMs: number;
}

/** The wrapper's own hard bound on any one contained execution. The lease is derived from this
 *  clamp, never from a caller-supplied timeout: the child is provably dead by
 *  clamped-timeout + slack, so a live slot can never outlive its lease and be reaped, and a
 *  crashed holder can never wedge the ceiling for longer than this bound. */
const MAX_CONTAINED_EXEC_MS = 300_000;

/** Acquire one aggregate slot for a contained execution. Refuses (typed, fail-closed, no child
 *  process) when the aggregate concurrency ceiling or the CPU window budget would be exceeded.
 *  Expired slots of dead holders are reaped first (booked conservatively), so a crashed process
 *  can never wedge the ceiling shut. Completed executions older than the window are pruned so the
 *  ledger stays bounded. */
export async function acquireContainedSlot(service: RuntimeService, caller: Caller, input: { readonly worldId: string; readonly execTimeoutMs?: number }): Promise<ContainmentAdmission> {
  const quotas = await readContainmentQuotas(service, caller);
  if (!quotas) return { quotas: {}, cpuSecondsPerExecution: 0, addressSpaceBytes: null, slotId: "", leaseUntilMs: 0 };
  const nowMs = Date.now();
  const clampedTimeoutMs = Math.min(input.execTimeoutMs ?? 30_000, MAX_CONTAINED_EXEC_MS);
  const leaseUntilMs = nowMs + clampedTimeoutMs + 5_000;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readState(service, caller);
    // Reap lapsed reservations (their child cannot still be live) and prune stale completions.
    const windowMs = (quotas.cpuWindowHours ?? 24) * 60 * 60 * 1000;
    const windowStart = windowStartMs(quotas, nowMs);
    for (const execution of Object.values(state.executions)) {
      if (execution.status === "reserved" && execution.leaseUntilMs < nowMs) {
        state.executions[execution.id] = { ...execution, status: "completed", outcome: "reaped", endedAt: new Date(nowMs).toISOString() };
      }
    }
    for (const [id, execution] of Object.entries(state.executions)) {
      if (execution.status === "completed" && Date.parse(execution.endedAt ?? execution.reservedAt) < windowStart) delete state.executions[id];
    }
    const live = Object.values(state.executions).filter(execution => execution.status === "reserved");
    if (quotas.maxConcurrent !== undefined && live.length + 1 > quotas.maxConcurrent) {
      throw new ContainmentQuotaError("max_concurrent", `Aggregate contained-execution ceiling exceeded: ${live.length} live execution(s) across processes already hold ${quotas.maxConcurrent} allowed slot(s); new work is refused until a slot releases`);
    }
    const cpuSecondsPerExecution = quotas.cpuSecondsPerExecution ?? 0;
    if (quotas.cpuSecondsPerWindow !== undefined) {
      const booked = bookedCpuSecondsInWindow(state, quotas, nowMs);
      if (booked + cpuSecondsPerExecution > quotas.cpuSecondsPerWindow) {
        throw new ContainmentQuotaError("cpu_window", `Aggregate CPU-second window budget exhausted: ${booked.toFixed(0)}s of ${quotas.cpuSecondsPerWindow}s booked in the current ${(quotas.cpuWindowHours ?? 24) * 60 * 60}s window; new work is refused until the window advances`);
      }
    }
    const slotId = `slot-${nowMs.toString(36)}-${attempt.toString(36)}-${Math.floor(Math.random() * 2 ** 31).toString(36)}`;
    state.executions[slotId] = {
      id: slotId, worldId: input.worldId, status: "reserved",
      reservedAt: new Date(nowMs).toISOString(), leaseUntilMs,
      cpuSeconds: cpuSecondsPerExecution, addressSpaceBytes: quotas.maxAddressSpaceBytes ?? null,
    };
    if (await writeState(service, caller, state, version, `containment-acquire:${slotId}`)) {
      return { quotas, cpuSecondsPerExecution, addressSpaceBytes: quotas.maxAddressSpaceBytes ?? null, slotId, leaseUntilMs };
    }
  }
  throw new Error("Aggregate containment ledger is busy; retry the execution");
}

/** Record the end of an admitted execution and release its aggregate slot. The kernel CPU cap
 *  stays booked conservatively (the child could have consumed up to it); a SIGXCPU death is
 *  recorded as cpu-capped so the ledger tells the truth about what happened. */
export async function releaseContainedSlot(service: RuntimeService, caller: Caller, slotId: string, outcome: ContainmentOutcome, wallMs: number): Promise<void> {
  if (!slotId) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readState(service, caller);
    const execution = state.executions[slotId];
    if (!execution) return; // already reaped: the slot's accounting is settled
    if (execution.status === "completed") return;
    state.executions[slotId] = { ...execution, status: "completed", outcome, wallMs, endedAt: new Date().toISOString() };
    if (await writeState(service, caller, state, version, `containment-release:${slotId}:${version}`)) return;
  }
  throw new Error("Aggregate containment ledger is busy; retry the release");
}

/** Boot hygiene: reap lapsed reservations so a crashed process cannot hold the ceiling shut. */
export async function reconcileContainmentAtBoot(service: RuntimeService, caller: Caller): Promise<number> {
  const nowMs = Date.now();
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readState(service, caller);
    const lapsed = Object.values(state.executions).filter(execution => execution.status === "reserved" && execution.leaseUntilMs < nowMs);
    if (lapsed.length === 0) return 0;
    for (const execution of lapsed) {
      state.executions[execution.id] = { ...execution, status: "completed", outcome: "reaped", endedAt: new Date(nowMs).toISOString() };
    }
    if (await writeState(service, caller, state, version, `containment-reap:${lapsed.map(e => e.id).sort().join(",")}:${version}`)) return lapsed.length;
  }
  throw new Error("Aggregate containment ledger is busy; retry boot reconciliation");
}

/** Sanitized inspection of the aggregate ledger: live slots and recent executions, no payloads. */
export function containmentOverview(state: ContainmentState): {
  readonly live: readonly { readonly id: string; readonly worldId: string; readonly reservedAt: string; readonly cpuSeconds: number }[];
  readonly recent: readonly { readonly id: string; readonly worldId: string; readonly outcome: ContainmentOutcome | undefined; readonly wallMs: number | undefined; readonly cpuSeconds: number; readonly endedAt: string | undefined }[];
  readonly liveCount: number;
} {
  const live = Object.values(state.executions).filter(execution => execution.status === "reserved")
    .map(({ id, worldId, reservedAt, cpuSeconds }) => ({ id, worldId, reservedAt, cpuSeconds }))
    .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt));
  const recent = Object.values(state.executions).filter(execution => execution.status === "completed")
    .map(({ id, worldId, outcome, wallMs, cpuSeconds, endedAt }) => ({ id, worldId, outcome, wallMs, cpuSeconds, endedAt }))
    .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? "")).slice(-50);
  return { live, recent, liveCount: live.length };
}

export async function readContainmentOverview(service: RuntimeService, caller: Caller): Promise<ReturnType<typeof containmentOverview>> {
  const { state } = await readState(service, caller);
  return containmentOverview(state);
}

/** The argv prefix that applies the configured kernel caps inside the world. Empty when no
 *  per-execution cap is configured. The CPU cap is `soft:hard` — the soft limit delivers
 *  SIGXCPU at the cap; the hard limit (+1s) is the backstop for a child that ignores SIGXCPU
 *  (an equal soft/hard pair goes straight to SIGKILL, which is indistinguishable from a kill). */
export function prlimitArgv(cpuSeconds: number, addressSpaceBytes: number | null): readonly string[] {
  const prefix: string[] = [];
  if (addressSpaceBytes !== null && addressSpaceBytes > 0) prefix.push(`--as=${addressSpaceBytes}`);
  if (cpuSeconds > 0) prefix.push(`--cpu=${cpuSeconds}:${cpuSeconds + 1}`);
  return prefix.length === 0 ? [] : ["prlimit", ...prefix, "--"];
}

interface AggregateContainmentOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
}

const SIGXCPU_EXIT = 152; // 128 + SIGXCPU(24): the kernel CPU cap killed the child.
const SIGKILL_EXIT = 137; // 128 + SIGKILL(9): the address-space cap (or a kill) ended the child.

/** Wrap one contained provider's process port with aggregate admission + accounting. The OS
 *  boundary stays the provider's; this layer owns the cross-process aggregate ceiling. */
function wrapContainedProcess(provider: ExecutionWorldProvider, options: AggregateContainmentOptions, prlimitAvailable: () => Promise<boolean>): ExecutionWorldProvider["process"] {
  const service = () => options.getService();
  return {
    async exec(spec, execOptions) {
      // Enforce the wrapper's own bound: the child is killed by the provider at the clamped
      // timeout even if the caller asked for longer, so the slot's lease always covers it.
      const clampedTimeoutMs = Math.min(spec.timeoutMs ?? 30_000, MAX_CONTAINED_EXEC_MS);
      const admission = await acquireContainedSlot(service(), options.systemCaller, { worldId: provider.worldId, execTimeoutMs: clampedTimeoutMs });
      const caps = prlimitArgv(admission.cpuSecondsPerExecution, admission.addressSpaceBytes);
      if (caps.length > 0 && !(await prlimitAvailable())) {
        // Fail closed: a configured quota must not degrade into an uncapped run.
        await releaseContainedSlot(service(), options.systemCaller, admission.slotId, "cancelled", 0);
        throw new ContainmentQuotaError("kernel_caps_unavailable", `Aggregate containment caps are configured but the kernel limit tooling is unavailable inside world ${provider.worldId}; the execution is refused rather than run uncapped`);
      }
      const startedMs = Date.now();
      try {
        const result = await provider.process.exec({ ...spec, argv: caps.length > 0 ? [...caps, ...spec.argv] : spec.argv, timeoutMs: clampedTimeoutMs }, execOptions);
        const wallMs = Date.now() - startedMs;
        const outcome = result.timedOut ? "killed" : result.exitCode === SIGXCPU_EXIT ? "cpu-capped" : result.exitCode === SIGKILL_EXIT ? "memory-capped" : "completed";
        await releaseContainedSlot(service(), options.systemCaller, admission.slotId, outcome, wallMs);
        return result;
      } catch (error) {
        // The provider refused or aborted the launch (or the caller cancelled): no child, or a dead
        // one. Release the slot and surface the original error unchanged.
        await releaseContainedSlot(service(), options.systemCaller, admission.slotId, "cancelled", Date.now() - startedMs);
        throw error;
      }
    },
  };
}

/** A registry decorator that applies aggregate containment to every CONTAINED provider it
 *  registers. Non-contained worlds (local, ssh, wsl) pass through unchanged: their containment
 *  story is different (T1 admission keys; the operator's own host) and this ledger does not
 *  pretend otherwise. */
export function aggregateContainedRegistry(base: ExecutionWorldRegistry, options: AggregateContainmentOptions): ExecutionWorldRegistry {
  const prlimitChecks = new Map<string, Promise<boolean>>();
  const prlimitAvailable = (provider: ExecutionWorldProvider): Promise<boolean> => {
    const existing = prlimitChecks.get(provider.worldId);
    if (existing) return existing;
    // One bounded probe per world: `prlimit` resolves (exit 0) or does not exist (exit 127).
    const probe = provider.process.exec({ argv: ["sh", "-c", "command -v prlimit >/dev/null 2>&1"], cwd: "/workspace", timeoutMs: 10_000 })
      .then(result => result.exitCode === 0)
      .catch(() => false);
    prlimitChecks.set(provider.worldId, probe);
    return probe;
  };
  return {
    register(provider) {
      if (provider.kind !== "linux-bubblewrap") return base.register(provider);
      const wrapped: ExecutionWorldProvider = {
        worldId: provider.worldId, kind: provider.kind, metadata: provider.metadata,
        fileSystem: provider.fileSystem,
        process: wrapContainedProcess(provider, options, () => prlimitAvailable(provider)),
        dispose: provider.dispose.bind(provider),
      };
      return base.register(wrapped);
    },
    unregister: (worldId) => base.unregister(worldId),
    has: (worldId) => base.has(worldId),
    get: (worldId) => base.get(worldId),
    list: () => base.list(),
    dispose: () => base.dispose(),
  };
}
