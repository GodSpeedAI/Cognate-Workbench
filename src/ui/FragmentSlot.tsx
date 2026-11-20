// Capability runtime T4a (§7.1, G8): the slot registry and the per-slot error boundary (net-new UI infrastructure).
//   - a registration accepts ONLY the closed panel-descriptor schema, parsed once at the registry boundary into the
//     branded RegisteredFragment; render code accepts only that type; content is data, rendered as text, never markup;
//   - the slot-id type is an enum of non-governance slots, so a governance override cannot be expressed downstream:
//     the boundary refuses it, records a core violation and escalates to safe mode;
//   - rendering takes the boot exclusion read as a parameter (no read, no render); in safe mode the core fallback renders;
//   - one error boundary wraps each fragment and its whole subtree; a fault is recorded once and the fallback renders;
//     recovery never renders the broken component again.
import React from "react";
import { createHash } from "node:crypto";
import { FaultRecorder, type FaultClass, type SafeModeController, type SafeModeRead } from "../workbench/safeMode.ts";

export const SLOT_IDS = ["capability.panel"] as const;
export type SlotId = (typeof SLOT_IDS)[number];
export const SCHEMA_VERSION = 1;
const LIMITS = { title: 80, summary: 200, label: 80, value: 200, rows: 50, capabilityId: 128 } as const;

export type FieldType = "string" | "number" | "boolean";
export type ViewRef =
  | { readonly kind: "list"; readonly rows: readonly { readonly label: string; readonly value: string }[] }
  | { readonly kind: "record"; readonly fields: readonly { readonly name: string; readonly type: FieldType; readonly value: string | number | boolean }[] };
export interface PanelPayload { readonly title: string; readonly summary: string; readonly capabilityId: string; readonly viewRef: ViewRef }

declare const fragBrand: unique symbol;
/** A descriptor that passed the closed schema at the registry boundary. */
export type RegisteredFragment = {
  readonly slotId: SlotId;
  readonly schemaVersion: 1;
  readonly payload: PanelPayload;
  /** capabilityId plus a digest of the descriptor: the fragment version a fault is deduplicated by. */
  readonly key: string;
  readonly [fragBrand]: true;
};

const GOVERNANCE = /^(governance|core|authority|approvals?|safe-?mode|policy|settlement|identity|evidence|grants?)([.:/_\- ]|$)/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const str = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;

function parseView(v: unknown): ViewRef | undefined {
  if (!isObj(v)) return undefined;
  if (v.kind === "list" && onlyKeys(v, ["kind", "rows"]) && Array.isArray(v.rows) && v.rows.length <= LIMITS.rows) {
    const rows: { label: string; value: string }[] = [];
    for (const r of v.rows) { if (!isObj(r) || !onlyKeys(r, ["label", "value"]) || !str(r.label, LIMITS.label) || !str(r.value, LIMITS.value)) return undefined; rows.push({ label: r.label, value: r.value }); }
    return { kind: "list", rows };
  }
  if (v.kind === "record" && onlyKeys(v, ["kind", "fields"]) && Array.isArray(v.fields) && v.fields.length <= LIMITS.rows) {
    const fields: { name: string; type: FieldType; value: string | number | boolean }[] = [];
    for (const f of v.fields) {
      if (!isObj(f) || !onlyKeys(f, ["name", "type", "value"]) || !str(f.name, LIMITS.label)) return undefined;
      if (f.type === "string" && str(f.value, LIMITS.value)) fields.push({ name: f.name, type: "string", value: f.value });
      else if (f.type === "number" && typeof f.value === "number" && Number.isFinite(f.value)) fields.push({ name: f.name, type: "number", value: f.value });
      else if (f.type === "boolean" && typeof f.value === "boolean") fields.push({ name: f.name, type: "boolean", value: f.value });
      else return undefined;
    }
    return { kind: "record", fields };
  }
  return undefined;
}

export type RegisterOutcome =
  | { readonly ok: true; readonly fragment: RegisteredFragment }
  | { readonly ok: false; readonly outcome: "refused" | "core-violation" };

const digestOf = (raw: unknown): string => {
  let s: string;
  try { s = JSON.stringify(raw) ?? "undefined"; } catch { s = "unserializable"; }
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
};

/** The only place a fragment can be admitted. Everything refused is recorded; governance escalates to safe mode. */
export class SlotRegistry {
  private readonly fragments = new Map<string, RegisteredFragment>();
  constructor(private readonly safe: SafeModeController) {}

  async register(raw: unknown): Promise<RegisterOutcome> {
    const digest = digestOf(raw);
    const slotId = isObj(raw) ? raw.slotId : undefined;
    if (typeof slotId === "string" && !(SLOT_IDS as readonly string[]).includes(slotId) && GOVERNANCE.test(slotId)) {
      await this.safe.faults.record({ fragmentKey: `refused@${digest}`, capabilityId: "unknown", faultClass: "core-violation", detail: "governance surface override" });
      this.safe.escalateCoreViolation();
      return { ok: false, outcome: "core-violation" };
    }
    const parsed = this.parse(raw);
    if (!parsed) {
      await this.safe.faults.record({ fragmentKey: `refused@${digest}`, capabilityId: "unknown", faultClass: "refused", detail: "descriptor does not match the closed schema" });
      return { ok: false, outcome: "refused" };
    }
    const fragment = { ...parsed, key: `${parsed.payload.capabilityId}@${digest}` } as RegisteredFragment;
    this.fragments.set(fragment.key, fragment);
    return { ok: true, fragment };
  }

  list(): readonly RegisteredFragment[] { return [...this.fragments.values()]; }

  private parse(raw: unknown): Omit<RegisteredFragment, "key" | typeof fragBrand> | undefined {
    if (!isObj(raw) || !onlyKeys(raw, ["slotId", "schemaVersion", "payload"])) return undefined;
    if (!(SLOT_IDS as readonly string[]).includes(raw.slotId as string) || raw.schemaVersion !== SCHEMA_VERSION) return undefined;
    const p = raw.payload;
    if (!isObj(p) || !onlyKeys(p, ["title", "summary", "capabilityId", "viewRef"])) return undefined;
    if (!str(p.title, LIMITS.title, 1) || !str(p.summary, LIMITS.summary) || !str(p.capabilityId, LIMITS.capabilityId, 1) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.capabilityId)) return undefined;
    const viewRef = parseView(p.viewRef);
    if (!viewRef) return undefined;
    return { slotId: raw.slotId as SlotId, schemaVersion: 1, payload: { title: p.title, summary: p.summary, capabilityId: p.capabilityId, viewRef } };
  }
}

// ---- rendering ----
type Guard = <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => void;
const GuardContext = React.createContext<Guard | undefined>(undefined);
/** Wrap an event handler: React error boundaries do not see handler faults, so a handler routes them to its slot's boundary. */
export function useFragmentGuard(): Guard {
  const g = React.useContext(GuardContext);
  if (!g) throw new Error("useFragmentGuard outside a FragmentSlot");
  return g;
}

export const CoreFallback: React.FC<{ fragmentKey?: string; reason: "fault" | "safe-mode" }> = ({ fragmentKey, reason }) => (
  <div className="wb-slot-fallback" role="status" data-slot-fallback={reason} data-fragment={fragmentKey ?? ""}>
    {reason === "safe-mode" ? "Extensions are suspended (safe mode)." : "This panel is unavailable."}
  </div>
);

export const DefaultView: React.FC<{ fragment: RegisteredFragment }> = ({ fragment }) => {
  const { title, summary, viewRef } = fragment.payload;
  return (
    <section className="wb-slot-panel" data-fragment={fragment.key}>
      <h3>{title}</h3>
      <p>{summary}</p>
      {viewRef.kind === "list"
        ? <ul>{viewRef.rows.map((r, i) => <li key={i}><span>{r.label}</span>: <span>{r.value}</span></li>)}</ul>
        : <dl>{viewRef.fields.map((f, i) => <React.Fragment key={i}><dt>{f.name}</dt><dd>{String(f.value)}</dd></React.Fragment>)}</dl>}
    </section>
  );
};

interface BoundaryProps { fragment: RegisteredFragment; faults: FaultRecorder; children: React.ReactNode }
class SlotBoundary extends React.Component<BoundaryProps, { faulted: boolean }> {
  override state = { faulted: false };
  static getDerivedStateFromError(): { faulted: boolean } { return { faulted: true }; }
  override componentDidCatch(error: unknown): void { this.report(error, "render"); }
  readonly guard: Guard = (fn) => (...args) => {
    const fail = (e: unknown): void => { this.report(e, "event"); this.setState({ faulted: true }); };
    try { const r = fn(...args); if (r instanceof Promise) r.catch(fail); } catch (e) { fail(e); }
  };
  private report(error: unknown, faultClass: FaultClass): void {
    void this.props.faults.record({ fragmentKey: this.props.fragment.key, capabilityId: this.props.fragment.payload.capabilityId, faultClass, detail: error instanceof Error ? error.message : "non-error thrown" });
  }
  override render(): React.ReactNode {
    if (this.state.faulted || this.props.faults.isFaulty(this.props.fragment.key)) return <CoreFallback fragmentKey={this.props.fragment.key} reason="fault" />;
    return <GuardContext.Provider value={this.guard}>{this.props.children}</GuardContext.Provider>;
  }
}

export interface FragmentSlotProps {
  readonly fragment: RegisteredFragment;
  /** The boot exclusion read: required, so nothing renders without it. */
  readonly read: SafeModeRead;
  readonly faults: FaultRecorder;
  /** Host-supplied view renderer for a registered fragment (defaults to the closed list/record view). */
  readonly renderView?: React.ComponentType<{ fragment: RegisteredFragment }>;
}
export const FragmentSlot: React.FC<FragmentSlotProps> = ({ fragment, read, faults, renderView }) => {
  if (read.safe) return <CoreFallback reason="safe-mode" />;
  const View = renderView ?? DefaultView;
  return <SlotBoundary key={fragment.key} fragment={fragment} faults={faults}><View fragment={fragment} /></SlotBoundary>;
};
