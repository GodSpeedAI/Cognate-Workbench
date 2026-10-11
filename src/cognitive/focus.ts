// Shared attention. The human's selection becomes a small, ephemeral FocusContext keyed by stable
// semantic refs (never CSS/DOM paths). `contextOf` derives the focused neighbourhood from
// authoritative events; `surfaceFor` is the one semantic operation behind human click, WebMCP agent
// call and internal action. Nothing here mutates durable state, and `planInvoke` only *describes*
// the Cognate capability a consequential follow-up must travel through (policy -> mediation ->
// continuation); focus never confers authority.
import { diffManifests, foldLineage, type WorldManifest } from "./world.ts";
import { CASE_EVENTS, deriveCase, type CaseContext, type CaseEvent } from "./case.ts";
import { shortHash } from "./canonical.ts";
import { validateSurface, type Block, type Surface } from "./surface.ts";

export const REF_KINDS = ["case", "world", "candidate", "evidence", "affordance", "experiment", "tool-call", "surface", "artifact"] as const;
export type RefKind = (typeof REF_KINDS)[number];
export type SemanticRef = `${RefKind}:${string}`;

const REF = new RegExp(`^(${REF_KINDS.join("|")}):([A-Za-z0-9._-]+)$`);
export function parseRef(ref: string): { kind: RefKind; id: string } | undefined {
  const m = REF.exec(ref);
  return m ? { kind: m[1] as RefKind, id: m[2]! } : undefined;
}
export const formatRef = (kind: RefKind, id: string | number): SemanticRef => `${kind}:${id}` as SemanticRef;

export interface FocusContext {
  readonly ref: SemanticRef;
  readonly surfaceId?: string;
  readonly blockId?: string;
  readonly caseId?: string;
  readonly worldHash?: string;
  readonly candidateWorldHash?: string;
  readonly artifactRef?: SemanticRef;
  readonly evidenceRef?: SemanticRef;
  readonly affordanceRef?: SemanticRef;
  readonly selection?: string;
}

/** Ephemeral by construction: in-memory only, never written to an event, lost on reload. */
export function createFocusStore() {
  let current: FocusContext | undefined;
  const listeners = new Set<(f: FocusContext | undefined) => void>();
  return {
    get: () => current,
    set(next: FocusContext | undefined) {
      if (next && !parseRef(next.ref)) throw new Error(`focus: not a semantic ref: ${next.ref}`);
      current = next;
      for (const l of listeners) l(current);
    },
    subscribe(fn: (f: FocusContext | undefined) => void) { listeners.add(fn); return () => void listeners.delete(fn); },
  };
}

// -- dynamic tool exposure ----------------------------------------------------------------------
export interface FocusAction { readonly id: string; readonly label: string; readonly mutates: boolean }
const VIEW = (id: string, label: string): FocusAction => ({ id, label, mutates: false });

/** Only the actions meaningful to what is focused — not a permanent catalog. */
export function actionsFor(kind: RefKind, state?: { readonly blocked?: boolean; readonly primary?: boolean }): readonly FocusAction[] {
  switch (kind) {
    case "evidence": return [VIEW("inspect", "Inspect"), VIEW("show_timeline", "Show timeline"), VIEW("compare_to_previous", "Compare to previous"), { id: "retry_verification", label: "Retry verification", mutates: true }];
    case "candidate": return [VIEW("inspect_candidate", "Inspect candidate"), VIEW("compare_to_parent", "Compare to parent"), VIEW("show_lineage", "Show lineage")];
    case "world": return [VIEW("inspect", "Inspect"), VIEW("show_lineage", "Show lineage")];
    case "affordance": return state?.blocked ? [VIEW("explain_block", "Why blocked"), VIEW("show_requirements", "Show requirements")] : [VIEW("inspect", "Inspect"), ...(state?.primary ? [{ id: "invoke_next_affordable_move", label: "Do this", mutates: true } as FocusAction] : [])];
    case "experiment": return [VIEW("inspect", "Inspect"), VIEW("compare_to_best", "Compare to best")];
    case "case": return [VIEW("inspect", "Inspect"), VIEW("show_timeline", "Show timeline")];
    default: return [VIEW("inspect", "Inspect")];
  }
}

// -- neighbourhood ------------------------------------------------------------------------------
export interface Neighborhood {
  readonly focused: SemanticRef;
  readonly case?: SemanticRef;
  readonly meaning: string;
  readonly world?: string;
  readonly related: readonly SemanticRef[];
  readonly actions: readonly FocusAction[];
  /** Recorded detail the agent can quote (never UI text). */
  readonly recorded?: Readonly<Record<string, string | number | boolean>>;
}

export interface FocusEnv { readonly events: readonly CaseEvent[]; readonly caseContext: CaseContext }

export function contextOf(focus: FocusContext | undefined, env: FocusEnv): Neighborhood | undefined {
  if (!focus) return undefined;
  const parsed = parseRef(focus.ref);
  if (!parsed) return undefined;
  const caseId = focus.caseId;
  const projection = caseId ? deriveCase(caseId, env.events, env.caseContext) : undefined;
  const related: SemanticRef[] = [];
  const caseRef = caseId ? formatRef("case", caseId) : undefined;
  let meaning = `${parsed.kind} ${parsed.id}`;
  let recorded: Record<string, string | number | boolean> | undefined;
  let state: { blocked?: boolean; primary?: boolean } | undefined;

  if (parsed.kind === "evidence") {
    const e = env.events.find((x) => String(x.position) === parsed.id && x.eventType === CASE_EVENTS.verification);
    if (!e) meaning = `evidence ${parsed.id}: no such recorded observation`;
    else {
      const p = e.payload as Record<string, any>;
      meaning = `${p.checkId} ${p.passed ? "passed" : "failed"}`;
      recorded = { checkId: String(p.checkId), passed: p.passed === true, exitCode: Number(p.exitCode ?? -1), tail: String(p.tail ?? ""), criterionHash: String(p.criterionHash) };
      if (p.candidateHash) related.push(formatRef("candidate", String(p.candidateHash)));
    }
  } else if (parsed.kind === "candidate" || parsed.kind === "world") {
    const w = foldLineage(env.events).worlds.get(parsed.id);
    meaning = w ? `${w.status} world ${shortHash(w.worldHash)}` : `unknown world ${shortHash(parsed.id)}`;
    if (w?.parentWorldHash) related.push(formatRef("world", w.parentWorldHash));
  } else if (parsed.kind === "affordance" && projection) {
    const b = projection.field.blocked.find((x) => x.id === parsed.id);
    const c = projection.field.current.find((x) => x.id === parsed.id);
    state = { blocked: !!b, primary: projection.field.primary === parsed.id };
    meaning = b ? `${b.label} is blocked: ${b.blockedBy.join(", ")}` : c ? `${c.label}: ${c.whyNow}` : `affordance ${parsed.id}`;
    if (b?.reachableNow) related.push(formatRef("affordance", b.reachableNow));
  } else if (parsed.kind === "case" && projection) {
    meaning = projection.materialDeviation ?? (projection.settlementReachable ? "settlement reachable" : "no material deviation recorded");
  }
  if (projection?.candidateWorldHash && parsed.kind !== "candidate") related.push(formatRef("candidate", projection.candidateWorldHash));
  return {
    focused: focus.ref,
    ...(caseRef ? { case: caseRef } : {}),
    meaning,
    ...(projection?.candidateWorldHash ? { world: `candidate ${shortHash(projection.candidateWorldHash)}` } : projection?.baseWorldHash ? { world: `settled ${shortHash(projection.baseWorldHash)}` } : {}),
    related: [...new Set(related)],
    actions: actionsFor(parsed.kind, state),
    ...(recorded ? { recorded } : {}),
  };
}

// -- one semantic operation for click, WebMCP and internal callers ----------------------------------
export type SemanticOp =
  | { readonly op: "inspect"; readonly ref: SemanticRef }
  | { readonly op: "compare"; readonly left: SemanticRef; readonly right: SemanticRef }
  | { readonly op: "timeline"; readonly ref: SemanticRef };

const manifestOf = (events: readonly CaseEvent[], hash: string): WorldManifest | undefined => foldLineage(events).worlds.get(hash)?.manifest;
const bare = (ref: SemanticRef) => parseRef(ref)?.id ?? "";

/** Read-only: builds a Surface from recorded facts. It never writes, so inspecting changes no truth. */
export function surfaceFor(op: SemanticOp, env: FocusEnv, caseId?: string): Surface {
  const events = env.events;
  const provenance = { source: `ui.${op.op}` };
  const base = { id: `ui:${op.op}:${op.op === "compare" ? `${op.left}|${op.right}` : op.ref}`, lifetime: "session" as const, provenance, ...(caseId ? { relatedCase: caseId } : {}) };
  if (op.op === "compare") {
    const a = manifestOf(events, bare(op.left));
    const b = manifestOf(events, bare(op.right));
    const diff = a && b ? diffManifests(a, b) : [];
    const side = (label: string, ref: SemanticRef) => ({ label, hash: bare(ref), items: diff.map((d) => ({ key: d.key, value: (ref === op.left ? d.before : d.after) ?? "—" })) });
    return validateSurface({ ...base, title: "Compare", intent: "compare", purpose: "What differs between these two worlds?", blocks: [{ type: "compare", left: side("A", op.left), right: side("B", op.right) }] });
  }
  if (op.op === "timeline") {
    const consequential = new Set(["case.opened", "world.baseline.frozen", "world.candidate.frozen", "world.candidate.rejected", "world.settled", "tool.approval.requested", "tool.approval.decided", "sentinel.finding", CASE_EVENTS.verification, "criterion.frozen"]);
    const entries = [...events].filter((e) => consequential.has(e.eventType) && (!caseId || (e.payload as any).caseId === undefined || (e.payload as any).caseId === caseId)).sort((x, y) => x.position - y.position).map((e) => {
      const p = e.payload as Record<string, any>;
      const label = e.eventType === CASE_EVENTS.verification ? `${p.checkId} ${p.passed ? "passed" : "FAILED"}` : e.eventType;
      const hash = p.candidateWorldHash ?? p.candidateHash ?? p.worldHash;
      return { position: e.position, kind: e.eventType, label, ...(hash ? { hash: shortHash(String(hash)) } : {}) };
    });
    return validateSurface({ ...base, title: "Timeline", intent: "inspect", purpose: "What happened, in what consequential order?", blocks: [{ type: "timeline", entries }] });
  }
  const n = contextOf({ ref: op.ref, ...(caseId ? { caseId } : {}) }, env);
  const blocks: Block[] = [{ type: "entity", label: n?.focused ?? op.ref, fields: [{ key: "meaning", value: n?.meaning ?? "unknown" }, ...Object.entries(n?.recorded ?? {}).map(([k, v]) => ({ key: k, value: String(v) }))] }];
  return validateSurface({ ...base, title: "Inspect", intent: "inspect", purpose: `What is ${op.ref}?`, blocks });
}

// -- authority boundary ---------------------------------------------------------------------------
export interface CapabilityRequest { readonly capability: string; readonly input: Record<string, unknown>; readonly via: "cognate" }
export type InvokePlan =
  | { readonly kind: "view"; readonly op: SemanticOp }
  | { readonly kind: "capability"; readonly request: CapabilityRequest }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Maps a focused action to what must happen next. A mutating action is never executed here: it is
 * described as a request to a Cognate capability, which applies policy/lease, mediation (Sentinel)
 * and a human continuation where authority is required. Unknown or not-currently-offered actions are refused.
 */
export function planInvoke(focus: FocusContext, actionId: string, env: FocusEnv): InvokePlan {
  const n = contextOf(focus, env);
  const action = n?.actions.find((a) => a.id === actionId);
  if (!n || !action) return { kind: "refused", reason: `action ${actionId} is not offered for ${focus.ref}` };
  const parsed = parseRef(focus.ref)!;
  if (!action.mutates) {
    if (actionId === "show_timeline" || actionId === "show_lineage") return { kind: "view", op: { op: "timeline", ref: focus.ref } };
    if (actionId === "compare_to_parent") {
      const parent = n.related.find((r) => r.startsWith("world:"));
      return parent ? { kind: "view", op: { op: "compare", left: parent, right: focus.ref } } : { kind: "refused", reason: "no parent world recorded" };
    }
    return { kind: "view", op: { op: "inspect", ref: focus.ref } };
  }
  if (actionId === "retry_verification" && parsed.kind === "evidence") {
    return { kind: "capability", request: { via: "cognate", capability: "verification.run", input: { caseId: focus.caseId, candidateHash: focus.candidateWorldHash } } };
  }
  return { kind: "capability", request: { via: "cognate", capability: `affordance.${actionId}`, input: { ref: focus.ref, caseId: focus.caseId } } };
}
