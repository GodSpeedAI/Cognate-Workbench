// MediationHost: the smallest "around" mediation over capability-shaped events.
//
// A mediator is `(context, event, next) => Outcome`. It may pass through, transform the request,
// observe or transform the downstream result, short-circuit, or deny. Chains are ordered by trust
// tier (governance outermost, then system, product, user, then the core operation) and, inside a
// tier, by registration order — never by timing of anything else. A tier is fixed at registration;
// `registrar(maxAuthority)` hands lower-trust code a register function that cannot claim a more
// trusted tier.
//
// `next.trusted(maxTier)` answers "what would the more-trusted subchain have returned without
// lower-trust mediation?" by re-running only mediators at or above `maxTier` against a *shadow* core
// (`core(event, { shadow: true })` must be side-effect free). That is an authority feature: the
// governance layer compares what actually happened with what trusted policy alone would have done.
import { canonicalize } from "./canonical.ts";

export type Tier = "governance" | "system" | "product" | "user";
export const TIER_RANK: Readonly<Record<Tier, number>> = { governance: 0, system: 1, product: 2, user: 3 };

export interface Origin {
  readonly id: string;
  readonly kind: "agent" | "user" | "component" | "mediator";
}
export interface MediationEvent {
  readonly family: string;
  readonly origin: Origin;
  readonly input: unknown;
}
export type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly denied: { readonly by: string; readonly reason: string } };

export type TraceAction = "observed" | "transformed-request" | "transformed-result" | "short-circuited" | "denied";
export interface TraceEntry {
  readonly mediator: string;
  readonly tier: Tier;
  readonly actions: TraceAction[];
}

export interface Next {
  (event?: MediationEvent): Promise<Outcome>;
  /** Re-run only mediators at `maxTier` or more trusted (below the caller) against a shadow core. */
  trusted(maxTier: Tier, event?: MediationEvent): Promise<Outcome>;
  readonly origin: Origin;
  /** Mediators beneath the caller that have participated so far (outer to inner). */
  readonly trace: readonly TraceEntry[];
}

export interface MediationContext {
  readonly mediatorId: string;
  readonly tier: Tier;
}
export type Handler = (context: MediationContext, event: MediationEvent, next: Next) => Promise<Outcome> | Outcome;
export interface MediatorSpec {
  readonly id: string;
  readonly tier: Tier;
  /** `family`, `prefix.*`, or `*`. */
  readonly pattern: string;
  readonly handler: Handler;
}
export type Core = (event: MediationEvent, mode: { readonly shadow: boolean }) => Promise<Outcome> | Outcome;
/** Anything with `register(disposer)`, e.g. a Cognate `FiberContext.effects`. */
export interface EffectsLike {
  register(disposer: () => void | Promise<void>, label?: string): unknown;
}

export class TrustedSubchainRecursion extends Error {
  override readonly name = "TrustedSubchainRecursion";
}
export class TierEscalation extends Error {
  override readonly name = "TierEscalation";
}

function matches(pattern: string, family: string): boolean {
  if (pattern === "*" || pattern === family) return true;
  return pattern.endsWith(".*") && family.startsWith(pattern.slice(0, -1));
}

interface Registered extends MediatorSpec {
  readonly seq: number;
}

export interface MediationHost {
  register(spec: MediatorSpec, effects?: EffectsLike): () => void;
  registrar(maxAuthority: Tier): { register(spec: MediatorSpec, effects?: EffectsLike): () => void };
  run(event: MediationEvent, core: Core): Promise<{ readonly outcome: Outcome; readonly trace: readonly TraceEntry[] }>;
  readonly size: number;
}

export function createMediationHost(): MediationHost {
  const registered: Registered[] = [];
  let seq = 0;

  const register = (spec: MediatorSpec, effects?: EffectsLike): (() => void) => {
    if (registered.some((r) => r.id === spec.id)) throw new Error(`mediator already registered: ${spec.id}`);
    const entry: Registered = { ...spec, seq: seq++ };
    registered.push(entry);
    const dispose = () => {
      const i = registered.indexOf(entry);
      if (i >= 0) registered.splice(i, 1);
    };
    effects?.register(dispose, `mediator:${spec.id}`);
    return dispose;
  };

  async function dispatch(chain: readonly Registered[], i: number, event: MediationEvent, core: Core, shadow: boolean, trace: TraceEntry[], stack: readonly string[]): Promise<Outcome> {
    if (i >= chain.length) return core(event, { shadow });
    const m = chain[i]!;
    const entry: TraceEntry = { mediator: m.id, tier: m.tier, actions: [] };
    if (!shadow) trace.push(entry);
    let called = false;
    let last: Outcome | undefined;
    const traceStart = trace.length;
    const next = (async (ev: MediationEvent = event) => {
      called = true;
      // The origin is the initiating actor and cannot be rewritten by mediation.
      const forwarded: MediationEvent = { ...ev, origin: event.origin };
      if (canonicalize(forwarded.input) !== canonicalize(event.input) && !entry.actions.includes("transformed-request")) entry.actions.push("transformed-request");
      last = await dispatch(chain, i + 1, forwarded, core, shadow, trace, stack);
      return last;
    }) as Next & { origin: Origin; trace: readonly TraceEntry[] };
    next.trusted = async (maxTier, ev = event) => {
      if (stack.includes(m.id)) throw new TrustedSubchainRecursion(`trusted subchain re-entered by ${m.id}`);
      const sub = chain.slice(i + 1).filter((x) => TIER_RANK[x.tier] <= TIER_RANK[maxTier]);
      return dispatch(sub, 0, { ...ev, origin: event.origin }, core, true, [], [...stack, m.id]);
    };
    Object.defineProperty(next, "origin", { get: () => event.origin });
    Object.defineProperty(next, "trace", { get: () => trace.slice(traceStart) });

    const out = await m.handler({ mediatorId: m.id, tier: m.tier }, event, next);
    if (!called) entry.actions.push(out.ok ? "short-circuited" : "denied");
    else if (!out.ok && last?.ok !== false) entry.actions.push("denied");
    else if (canonicalize(out) !== canonicalize(last)) entry.actions.push("transformed-result");
    if (called && entry.actions.length === 0) entry.actions.push("observed");
    return out;
  }

  return {
    register,
    registrar(maxAuthority) {
      return {
        register(spec, effects) {
          if (TIER_RANK[spec.tier] < TIER_RANK[maxAuthority]) throw new TierEscalation(`${spec.id} may not register at tier ${spec.tier}`);
          return register(spec, effects);
        },
      };
    },
    async run(event, core) {
      const chain = registered
        .filter((r) => matches(r.pattern, event.family))
        .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.seq - b.seq);
      const trace: TraceEntry[] = [];
      const outcome = await dispatch(chain, 0, event, core, false, trace, []);
      return { outcome, trace };
    },
    get size() {
      return registered.length;
    },
  };
}
