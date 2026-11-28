// One scope per spawn owns EVERYTHING that spawn acquires: descriptors, the launcher handle, and the cancellation waiters of each
// await it is suspended at. `dispose()` cancels every live scope; `release()` (the spawn's `finally`) closes whatever is still owned,
// whichever await the spawn was at. This replaces per-site abandon callbacks and re-checks. A resource is registered in the same
// synchronous turn that acquires it, so there is no window in which something is held that no scope will close. This file starts no
// process (the launch gate does).
export interface Owned {
  /** Close it now and stop owning it. */
  release(): void;
  /** Stop owning it without closing: someone else (the live process record) closes it later. */
  transfer(): void;
}

export class SpawnScope {
  #cancelled: Error | undefined;
  #released = false;
  readonly #waiters = new Set<(reason: Error) => void>();
  readonly #owned = new Set<() => void>();
  readonly #onWaiters: (delta: number) => void;
  readonly #onAwait: ((label: string) => void) | undefined;
  readonly #registry: Set<SpawnScope>;

  constructor(registry: Set<SpawnScope>, onWaiters: (delta: number) => void, onAwait?: (label: string) => void) {
    this.#registry = registry; this.#onWaiters = onWaiters; this.#onAwait = onAwait;
    registry.add(this);
  }

  get cancelled(): Error | undefined { return this.#cancelled; }
  throwIfCancelled(): void { if (this.#cancelled) throw this.#cancelled; }

  /** A named, observable point at which this spawn is about to yield (or has just resumed). Throws if the scope was cancelled. */
  point(label: string): void { this.#onAwait?.(label); this.throwIfCancelled(); }

  /** Wait for `work`, but never past cancellation: a cancelled scope rejects immediately and the waiter is removed as soon as it settles. */
  guard<T>(label: string, work: Promise<T>): Promise<T> {
    work.then(undefined, () => {});               // `work` is ours to observe even when we refuse to wait for it: its late failure is not an unhandled rejection
    return new Promise<T>((resolve, reject) => {
      if (this.#cancelled) { reject(this.#cancelled); return; }
      this.#onAwait?.(label);                      // dispose / revocation can be injected exactly here
      if (this.#cancelled) { reject(this.#cancelled); return; }
      const cancel = (reason: Error): void => { if (this.#waiters.delete(cancel)) { this.#onWaiters(-1); reject(reason); } };
      this.#waiters.add(cancel); this.#onWaiters(1);
      const done = (settle: () => void): void => { if (this.#waiters.delete(cancel)) { this.#onWaiters(-1); settle(); } };
      work.then((value) => done(() => (this.#cancelled ? reject(this.#cancelled) : resolve(value))), (error) => done(() => reject(error)));
    });
  }

  /** Own a resource acquired in this synchronous turn. On a cancelled or released scope it is closed at once and the caller is told. */
  own(close: () => void): Owned {
    if (this.#cancelled || this.#released) { try { close(); } catch { /* closed */ } throw this.#cancelled ?? new Error("the spawn scope has ended"); }
    let closed = false;
    const closeOnce = (): void => { if (!closed) { closed = true; try { close(); } catch { /* already closed */ } } };
    this.#owned.add(closeOnce);
    // `release` closes it whenever it is called, even after `transfer` (the new owner closes it through the same handle).
    return { release: () => { this.#owned.delete(closeOnce); closeOnce(); }, transfer: () => { this.#owned.delete(closeOnce); } };
  }

  cancel(reason: Error): void {
    if (this.#cancelled) return;
    this.#cancelled = reason;
    for (const cancelWaiter of [...this.#waiters]) cancelWaiter(reason);
  }

  /** The spawn is over, one way or another: close everything still owned and leave the registry. */
  release(): void {
    this.#cancelled ??= new Error("the spawn scope has ended");
    this.#released = true;
    for (const closeOwned of [...this.#owned].reverse()) closeOwned();
    for (const cancelWaiter of [...this.#waiters]) cancelWaiter(this.#cancelled);
    this.#registry.delete(this);
  }
}
