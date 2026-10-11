// LiveVerify: a long-lived mediator that watches consequential results, debounces, and runs the
// affected observer. Healthy transitions are silent; only a change of verdict is surfaced, and it
// updates one representation (same `surfaceId`) rather than emitting a new message each time.
import type { MediatorSpec, EffectsLike } from "./mediation.ts";

export interface LiveVerifyOptions {
  readonly debounceMs: number;
  /** Which tool results are consequential edits worth verifying. */
  readonly isConsequential: (family: string, input: unknown) => boolean;
  readonly run: () => Promise<{ readonly healthy: boolean; readonly summary: string }>;
  /** Called only when the verdict changes (quiet normality). */
  readonly onVerdict: (verdict: { readonly healthy: boolean; readonly summary: string; readonly surfaceId: string }) => void;
  readonly surfaceId?: string;
  /** Injectable for deterministic tests. */
  readonly timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export function liveVerify(opts: LiveVerifyOptions, effects?: EffectsLike): { readonly mediator: MediatorSpec; readonly flush: () => Promise<void>; readonly pending: () => boolean } {
  const timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  let handle: unknown;
  let last: boolean | undefined;
  let inflight: Promise<void> | undefined;
  const surfaceId = opts.surfaceId ?? "live-verify";
  const execute = async () => {
    handle = undefined;
    const v = await opts.run();
    const previous = last;
    last = v.healthy;
    if (v.healthy === previous) return; // unchanged verdict: stay quiet
    if (v.healthy && previous === undefined) return; // first observation is healthy: quiet normality
    opts.onVerdict({ ...v, surfaceId }); // failure, or repair after failure
  };
  const schedule = () => {
    if (handle !== undefined) timers.clear(handle);
    handle = timers.set(() => { inflight = execute(); }, opts.debounceMs);
  };
  effects?.register(() => { if (handle !== undefined) timers.clear(handle); handle = undefined; }, "live-verify-timer");
  return {
    mediator: {
      id: "live-verify",
      tier: "system",
      pattern: "tool.*",
      async handler(_c, event, next) {
        const out = await next(event);
        if (out.ok && opts.isConsequential(event.family, event.input)) schedule();
        return out;
      },
    },
    async flush() {
      if (handle !== undefined) { timers.clear(handle); await execute(); } else await inflight;
    },
    pending: () => handle !== undefined,
  };
}
