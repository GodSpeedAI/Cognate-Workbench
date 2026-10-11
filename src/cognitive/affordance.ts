// AffordanceResolver: derives what can actually be done now. Pure. possibility != affordance:
// an operation is current only if its preconditions hold, a capability+provider exist, the lease
// permits it, and the observer/recovery it needs are reachable. Anything else is a *blocked*
// affordance that says why and names the current move that would unblock it.
export interface PossibleOperation {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly advances: string;
  /** Capability id this operation invokes, when it invokes one. */
  readonly capability?: string;
  /** Fact keys that must hold first. */
  readonly requires?: readonly string[];
  /** Fact keys that hold if this succeeds (drives successor + unblocking). */
  readonly produces?: readonly string[];
  readonly authority?: "human" | "none";
  /** Only supply when evidence supports it; omitted means unknown, never zero. */
  readonly payment?: { readonly unit: string; readonly estimate: number; readonly basis: string };
  readonly recovery?: "required" | "none";
  readonly needsObserver?: boolean;
  readonly priority?: number;
}
export interface Facts {
  readonly holds: ReadonlySet<string>;
  /** Capabilities with an eligible provider and a lease that policy allows. */
  readonly availableCapabilities: ReadonlySet<string>;
  readonly recoveryAvailable: boolean;
  readonly observerAvailable: boolean;
  readonly budgetRemaining?: number;
}
export interface Affordance extends PossibleOperation {
  readonly whyNow: string;
  readonly authorityRequired: boolean;
  /** The one operation that becomes reachable if this succeeds (only when it exists). */
  readonly successor?: string;
}
export interface BlockedAffordance {
  readonly id: string;
  readonly label: string;
  readonly blockedBy: readonly string[];
  /** A current affordance that would remove a blocker, when one exists. */
  readonly reachableNow?: string;
}
export interface AffordanceField {
  readonly current: readonly Affordance[];
  readonly blocked: readonly BlockedAffordance[];
  /** At most one dominant maneuver; guidance, not authority. */
  readonly primary?: string;
}

export function resolveAffordances(ops: readonly PossibleOperation[], facts: Facts): AffordanceField {
  const reasons = (op: PossibleOperation): string[] => {
    const r: string[] = [];
    for (const k of op.requires ?? []) if (!facts.holds.has(k)) r.push(`missing:${k}`);
    if (op.capability && !facts.availableCapabilities.has(op.capability)) r.push(`capability-unavailable:${op.capability}`);
    if (op.recovery === "required" && !facts.recoveryAvailable) r.push("recovery-unavailable");
    if (op.needsObserver && !facts.observerAvailable) r.push("observer-unavailable");
    if (op.payment && facts.budgetRemaining !== undefined && op.payment.estimate > facts.budgetRemaining) r.push("unaffordable");
    return r;
  };
  const sorted = [...ops].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : 1));
  const evaluated = sorted.map((op) => ({ op, why: reasons(op) }));
  const currentOps = evaluated.filter((e) => e.why.length === 0).map((e) => e.op);
  const successorOf = (op: PossibleOperation): string | undefined => {
    const made = new Set(op.produces ?? []);
    return sorted.find((o) => o.id !== op.id && (o.requires ?? []).some((k) => made.has(k)) && reasons({ ...o, requires: (o.requires ?? []).filter((k) => !made.has(k)) }).length === 0)?.id;
  };
  const current: Affordance[] = currentOps.map((op) => {
    const successor = successorOf(op);
    return { ...op, whyNow: `advances ${op.advances}`, authorityRequired: op.authority === "human", ...(successor ? { successor } : {}) };
  });
  const blocked: BlockedAffordance[] = evaluated
    .filter((e) => e.why.length > 0)
    .map(({ op, why }) => {
      const missing = why.filter((w) => w.startsWith("missing:")).map((w) => w.slice(8));
      const unblock = currentOps.find((c) => (c.produces ?? []).some((k) => missing.includes(k)));
      return { id: op.id, label: op.label, blockedBy: why, ...(unblock ? { reachableNow: unblock.id } : {}) };
    });
  return { current, blocked, ...(current[0] ? { primary: current[0].id } : {}) };
}

/**
 * Smallest useful capability neighbourhood: recovery and diagnostic tools are always visible;
 * everything else only when a current affordance invokes it. installed != visible.
 */
export function capabilityNeighborhood(
  tools: readonly { readonly id: string; readonly kind: "recovery" | "diagnostic" | "mutating" | "observer" }[],
  field: AffordanceField,
): readonly string[] {
  const wanted = new Set(field.current.map((a) => a.capability).filter((c): c is string => c !== undefined));
  return tools.filter((t) => t.kind === "recovery" || t.kind === "diagnostic" || wanted.has(t.id)).map((t) => t.id);
}
