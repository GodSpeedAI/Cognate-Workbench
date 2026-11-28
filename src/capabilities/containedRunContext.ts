// The host-owned lease for one admitted child execution (SEA-Forge #114, reviews M9 and delta-3 findings 1 and 2).
// The server wraps each admitted child's execution in `runInContainedLease`: a fresh lease {runId, reach, active} that is
// revoked in `finally`, so a callback or timer that outlives the run cannot spawn. The store that carries it is module-private:
// nothing outside this file can read it except through `currentLease`, the port's reader, or replace or write it. The port
// snapshots the lease into an immutable binding at spawn entry and checks `active` before authorization and immediately
// before launch; the provider's `ctx` is used only to compare against that binding at entry.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ContainedLease {
  readonly runId: string;
  /** `none`, or `host-socket` when the operator declared the provider's reach as the one host-mediated unix socket. */
  readonly reach: "none" | "host-socket";
  /** True while the admitted run is executing; false for ever once it has returned. */
  readonly active: boolean;
}

const store = new AsyncLocalStorage<ContainedLease>();

/** Run `fn` as the admitted child run `spec.runId`: the lease exists for exactly as long as `fn` takes, then is revoked. */
export async function runInContainedLease<T>(spec: { readonly runId: string; readonly reach: "none" | "host-socket" }, fn: () => T): Promise<Awaited<T>> {
  let active = true;
  const lease: ContainedLease = Object.freeze({ runId: spec.runId, reach: spec.reach, get active() { return active; } });
  try {
    return await store.run(lease, fn);
  } finally {
    active = false;
  }
}

/** The lease of the run executing now, if any. Used by the contained port. */
export const currentLease = (): ContainedLease | undefined => store.getStore();
