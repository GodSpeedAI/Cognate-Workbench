// The ONE place a launcher process is started (SEA-Forge #114, the root mechanism behind the lifetime reviews). The contained port's
// lifetime used to be enforced by `closed`, lease and registration checks placed after each await, and every review found another gap
// between two awaits. Here the check and the effect are the same synchronous turn: `enter` tests the gate and the permit, counts the
// launch and calls Bun.spawn / Bun.spawnSync with nothing in between, and `close()` (dispose's first statement) is synchronous. After
// `close()` no launch can begin, by construction, whatever await any spawn is suspended at. These two methods are the only calls to
// the spawn APIs in the contained port's modules (a test greps for that).
import { refuse } from "./containedLaunch.ts";

/** Anything with a live/ended state: the host's run lease. A launch needs it active; host-level calls (the version probe) pass none. */
export interface LaunchPermit { readonly active: boolean }

type SpawnArgs = Parameters<typeof Bun.spawn>;
type SpawnSyncArgs = Parameters<typeof Bun.spawnSync>;

export class LaunchGate {
  #closed = false;
  #inFlight = 0;
  #begun = 0;
  /** Launches the gate has BEGUN (the instant before the spawn API was called). */
  get begun(): number { return this.#begun; }
  /** Launches inside the synchronous window right now: zero whenever any other code can observe it. */
  get inFlight(): number { return this.#inFlight; }
  get closed(): boolean { return this.#closed; }
  /** Synchronous: from this statement on, nothing can begin. */
  close(): void { this.#closed = true; }

  spawn(permit: LaunchPermit | undefined, cmd: SpawnArgs[0], options: SpawnArgs[1]): ReturnType<typeof Bun.spawn> {
    return this.#enter(permit, () => Bun.spawn(cmd as never, options as never));
  }

  spawnSync(permit: LaunchPermit | undefined, cmd: SpawnSyncArgs[0], options: SpawnSyncArgs[1]): ReturnType<typeof Bun.spawnSync> {
    return this.#enter(permit, () => Bun.spawnSync(cmd as never, options as never));
  }

  #enter<T>(permit: LaunchPermit | undefined, begin: () => T): T {
    if (this.#closed) throw refuse("rlm-containment-unavailable", "the contained port has been disposed; nothing more is launched");
    if (permit && !permit.active) throw refuse("rlm-containment-unavailable", "the lease of the run has ended: its execution returned, so nothing more is launched for it");
    this.#inFlight += 1; this.#begun += 1;
    try { return begin(); } finally { this.#inFlight -= 1; }
  }
}
