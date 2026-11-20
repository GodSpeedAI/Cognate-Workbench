// Capability runtime T4a (§7.2, G8): the ONE safe-mode module. Safe mode is derived, never stored as a flag:
//   - the boot exclusion read folds the durable safe-mode events once, BEFORE any render or mount, into a branded
//     SafeModeRead that only this module can mint; render (FragmentSlot) and mount (mountBundleHandlers) take it as a
//     parameter, so neither can run without it;
//   - safe mode holds while a core violation is unresolved, or while two boots with the same extension set failed
//     (attempted, never ready); only the operator-only `workbench.safemode.cleared` lifts it;
//   - this module writes only `capability.presentation.faulted` and `workbench.safemode.*` events.
import type { DurableStore, StoredEvent } from "@godspeedai/cognate-events";
import { createHash } from "node:crypto";
import { LifecycleRecorder } from "./lifecycleRecorder.ts";

/** Every event this module may write (A5): nothing else is ever appended in safe mode. */
export const SAFE_MODE_EVENT_TYPES = [
  "capability.presentation.faulted",
  "workbench.safemode.boot_attempted",
  "workbench.safemode.boot_ready",
  "workbench.safemode.cleared",
] as const;

const SAFE_SCOPE = "safemode";
const SAFE_STREAM = `wb-lifecycle:${SAFE_SCOPE}`;
export const FAILED_BOOTS_TO_SUSPEND = 2;

export type FaultClass = "render" | "effect" | "event" | "core-violation" | "refused" | "unauthorized-clear";

declare const readBrand: unique symbol;
/** The boot exclusion read. Not constructible outside this module. */
export type SafeModeRead = {
  readonly safe: boolean;
  readonly reason: "none" | "core-violation" | "failed-boots";
  readonly setHash: string;
  readonly [readBrand]: true;
};
const mint = (safe: boolean, reason: SafeModeRead["reason"], setHash: string): SafeModeRead => ({ safe, reason, setHash }) as SafeModeRead;

export const extensionSetHash = (extensionIds: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify([...new Set(extensionIds)].sort())).digest("hex");

/** Pure fold over the safe-mode events (oldest first). */
export function foldSafeMode(events: readonly { eventType: string; payload: unknown }[], setHash: string): SafeModeRead {
  let violation = false;
  let run: string[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as { setHash?: string; faultClass?: string };
    if (e.eventType === "workbench.safemode.cleared") { violation = false; run = []; }
    else if (e.eventType === "capability.presentation.faulted" && p.faultClass === "core-violation") violation = true;
    else if (e.eventType === "workbench.safemode.boot_ready") run = [];
    else if (e.eventType === "workbench.safemode.boot_attempted") {
      const h = String(p.setHash ?? "");
      if (run.length > 0 && run[run.length - 1] !== h) run = [];
      run.push(h);
    }
  }
  if (violation) return mint(true, "core-violation", setHash);
  if (run.length >= FAILED_BOOTS_TO_SUSPEND && run.every((h) => h === setHash)) return mint(true, "failed-boots", setHash);
  return mint(false, "none", setHash);
}

/** The boot exclusion read: reads the log once and writes nothing. Call before any render or mount. */
export async function readBootExclusion(store: DurableStore, extensionIds: readonly string[]): Promise<SafeModeRead> {
  return foldSafeMode(await store.readStream(SAFE_STREAM), extensionSetHash(extensionIds));
}

const faultKeyOf = (f: { fragmentKey: string; faultClass: FaultClass }): string => `${f.fragmentKey}|${f.faultClass}`;

/** Records presentation faults once per (fragment version, fault class), durably (idempotency key) and in memory. */
export class FaultRecorder {
  private readonly recorder: LifecycleRecorder;
  private readonly seen = new Set<string>();
  private readonly faulty = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly store: DurableStore, tenant: string) { this.recorder = new LifecycleRecorder(store, tenant); }

  /** A fresh dedupe window after an operator clear. */
  reset(): void { this.seen.clear(); }

  isFaulty(fragmentKey: string): boolean { return this.faulty.has(fragmentKey); }

  /** Resolves true when a new event was written, false for a deduplicated fault. Never throws. */
  record(f: { fragmentKey: string; capabilityId: string; faultClass: FaultClass; detail?: string }): Promise<boolean> {
    if (f.faultClass !== "refused" && f.faultClass !== "unauthorized-clear" && f.faultClass !== "core-violation") this.faulty.add(f.fragmentKey);
    const key = faultKeyOf(f);
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    const run = async (): Promise<boolean> => {
      try {
        // durable dedupe: an identical fault already recorded since the last operator clear is not recorded again
        const rows = await this.store.readStream(SAFE_STREAM);
        const lastClear = rows.map((r) => r.eventType).lastIndexOf("workbench.safemode.cleared");
        if (rows.slice(lastClear + 1).some((r) => r.eventType === "capability.presentation.faulted" && (r.payload as { fragmentKey?: string; faultClass?: string }).fragmentKey === f.fragmentKey && (r.payload as { faultClass?: string }).faultClass === f.faultClass)) return false;
        await this.recorder.commitBatch(SAFE_SCOPE, [{ type: "capability.presentation.faulted", payload: { fragmentKey: f.fragmentKey, capabilityId: f.capabilityId, faultClass: f.faultClass, detail: (f.detail ?? "").slice(0, 200) } }]);
        return true;
      } catch { this.seen.delete(key); return false; }
    };
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }
}

/** Holds the live read; escalation and operator clear re-derive from (or extend) the durable log. */
export class SafeModeController {
  private current: SafeModeRead;
  private readonly recorder: LifecycleRecorder;
  readonly faults: FaultRecorder;
  constructor(readonly store: DurableStore, readonly tenant: string, initial: SafeModeRead, private readonly extensionIds: readonly string[]) {
    this.current = initial;
    this.recorder = new LifecycleRecorder(store, tenant);
    this.faults = new FaultRecorder(store, tenant);
  }
  read(): SafeModeRead { return this.current; }
  /** Boot: read the exclusion FIRST, then record the attempt. */
  static async boot(store: DurableStore, tenant: string, extensionIds: readonly string[]): Promise<SafeModeController> {
    const read = await readBootExclusion(store, extensionIds);
    const c = new SafeModeController(store, tenant, read, extensionIds);
    await c.recorder.commitBatch(SAFE_SCOPE, [{ type: "workbench.safemode.boot_attempted", payload: { setHash: read.setHash } }]);
    return c;
  }
  /** The boot reached readiness. Evidence only from a non-safe boot: an extension-less boot proves nothing. */
  async bootReady(): Promise<boolean> {
    if (this.current.safe) return false;
    await this.recorder.commitBatch(SAFE_SCOPE, [{ type: "workbench.safemode.boot_ready", payload: { setHash: this.current.setHash } }]);
    return true;
  }
  /** A core violation escalates immediately (the durable fault event makes it survive restart). */
  escalateCoreViolation(): void { this.current = mint(true, "core-violation", this.current.setHash); }
  async recordUnauthorizedClear(actorId: string, detail: string): Promise<void> {
    await this.faults.record({ fragmentKey: `clear:${actorId}`, capabilityId: SAFE_SCOPE, faultClass: "unauthorized-clear", detail });
  }

  /** Operator-only. A non-operator is refused and the refusal is recorded. */
  async clear(actor: { readonly role: string; readonly id?: string }): Promise<{ ok: boolean }> {
    if (actor.role !== "operator") {
      await this.recordUnauthorizedClear(actor.id ?? "unknown", `role ${actor.role.slice(0, 40)}`);
      return { ok: false };
    }
    await this.recorder.commitBatch(SAFE_SCOPE, [{ type: "workbench.safemode.cleared", payload: { actor: actor.id ?? "operator" } }]);
    this.faults.reset();
    this.current = await readBootExclusion(this.store, this.extensionIds);
    return { ok: true };
  }
}

export type BundleHandler = { readonly id: string; readonly mount: () => void };
export type MountTable = Map<string, BundleHandler>;
/** Mount takes the exclusion read as a parameter: in safe mode no bundle handler mounts. Returns the mounted ids. */
export function mountBundleHandlers(read: SafeModeRead, table: MountTable, handlers: readonly BundleHandler[]): string[] {
  if (read.safe) return [];
  const mounted: string[] = [];
  for (const h of handlers) { table.set(h.id, h); h.mount(); mounted.push(h.id); }
  return mounted;
}

export type { StoredEvent };
