// Durable pre-dispatch billing reservations (J-CONTEXT-BUDGET). Every model dispatch — Expert
// assignment or ordinary coding session — holds a reservation on this governed ledger before the
// provider is called. A crash between reservation and outcome never blindly repeats: the reserved
// entry blocks the same logical call until reconciliation settles it from committed invocation
// evidence, releases it when dispatch provably never happened, or books it as unknown at the
// conservative amount. Unknown prices are carried as null and never fabricated as zero; a
// configured spending ceiling cannot be verified while unknown-price activity exists and fails
// closed. The durable event log of this thread is the truth; this module never caches it.
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

export const EXPERTS_BILLING_THREAD = "experts:billing:v1";

export interface BillingPrices { inputUsdPerMillion: number; outputUsdPerMillion: number }
export type BillingStatus = "reserved" | "settled" | "released" | "reconciled-unknown";
export type BillingKind = "expert-model" | "session-model";

export interface BillingUsage { inputTokens: number; outputTokens: number; source: "provider" | "unreported" | "reconciled-conservative" }

export interface BillingReservation {
  readonly id: string;
  readonly kind: BillingKind;
  readonly runId: string | null;
  readonly assignmentId: string | null;
  readonly attempt: number | null;
  readonly sessionId: string | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly reservedOutputTokens: number;
  readonly prices: BillingPrices | null;
  status: BillingStatus;
  usage?: BillingUsage;
  costUsd: number | null;
  cause: string | null;
  readonly createdAt: string;
  updatedAt?: string;
}

export interface BillingState { schema: 1; reservations: Record<string, BillingReservation> }

export interface SpendingCeilings { sessionUsd?: number; globalUsd?: number }

export type BillingReservationInput = Pick<BillingReservation, "kind" | "runId" | "assignmentId" | "attempt" | "sessionId" | "model" | "inputTokens" | "reservedOutputTokens" | "prices"> & {
  readonly id: string;
};

export class BillingError extends Error {
  override readonly name = "BillingError";
  constructor(readonly kind: "ceiling_exceeded" | "reconciliation_required" | "identity_conflict", message: string) { super(message); }
}

export function parseSpendingCeilings(raw: unknown): SpendingCeilings | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Spending ceilings must be an object");
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !["sessionUsd", "globalUsd"].includes(key))) throw new Error("Unknown spending ceiling field");
  const ceilings: SpendingCeilings = {};
  const positive = (value: unknown, name: string) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error(`${name} must be a positive finite number`);
    return value;
  };
  if (input.sessionUsd !== undefined) ceilings.sessionUsd = positive(input.sessionUsd, "Session spending ceiling");
  if (input.globalUsd !== undefined) ceilings.globalUsd = positive(input.globalUsd, "Global spending ceiling");
  // The empty object is the explicit "clear both ceilings" patch, distinct from absent.
  return ceilings;
}

export function parseBillingPrices(raw: unknown): BillingPrices | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Prices must be an object");
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !["inputUsdPerMillion", "outputUsdPerMillion"].includes(key))) throw new Error("Unknown price field");
  const nonnegative = (value: unknown, name: string) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error(`${name} must be a finite nonnegative number`);
    return value;
  };
  return { inputUsdPerMillion: nonnegative(input.inputUsdPerMillion, "Input price"), outputUsdPerMillion: nonnegative(input.outputUsdPerMillion, "Output price") };
}

function conservativeCost(reservation: BillingReservation): number | null {
  return reservation.prices
    ? (reservation.inputTokens * reservation.prices.inputUsdPerMillion + reservation.reservedOutputTokens * reservation.prices.outputUsdPerMillion) / 1_000_000
    : null;
}

function usageCost(reservation: BillingReservation): number | null {
  if (!reservation.usage || !reservation.prices) return null;
  return (reservation.usage.inputTokens * reservation.prices.inputUsdPerMillion + reservation.usage.outputTokens * reservation.prices.outputUsdPerMillion) / 1_000_000;
}

/** Effective booked cost of a reservation: settled usage when known, the conservative
 * reservation while reserved or reconciled-unknown, nothing when released. Unknown stays null. */
export function bookedCostUsd(reservation: BillingReservation): number | null {
  if (reservation.status === "released") return 0;
  if (reservation.status === "settled") return usageCost(reservation);
  return conservativeCost(reservation);
}

export function emptyBillingState(): BillingState { return { schema: 1, reservations: {} }; }

export function isBillingState(value: unknown): value is BillingState {
  return !!value && typeof value === "object" && (value as Partial<BillingState>).schema === 1
    && typeof (value as Partial<BillingState>).reservations === "object" && !Array.isArray((value as Partial<BillingState>).reservations);
}

export interface BillingSpend {
  readonly knownCostUsd: number;
  readonly unknownPriceCount: number;
  readonly sessionCostUsd: ReadonlyMap<string, number>;
  readonly unknownSessionCount: ReadonlySet<string>;
}

/** Sum booked spend across active reservations. Unknown prices are counted, never zeroed. */
export function billingSpend(state: BillingState): BillingSpend {
  let knownCostUsd = 0;
  let unknownPriceCount = 0;
  const sessionCostUsd = new Map<string, number>();
  const unknownSessionCount = new Set<string>();
  for (const reservation of Object.values(state.reservations)) {
    const cost = bookedCostUsd(reservation);
    if (cost === null) {
      unknownPriceCount += 1;
      if (reservation.sessionId) unknownSessionCount.add(reservation.sessionId);
      continue;
    }
    knownCostUsd += cost;
    if (reservation.sessionId && reservation.status !== "released") {
      sessionCostUsd.set(reservation.sessionId, (sessionCostUsd.get(reservation.sessionId) ?? 0) + cost);
    }
  }
  return { knownCostUsd, unknownPriceCount, sessionCostUsd, unknownSessionCount };
}

async function readBillingState(service: RuntimeService, caller: Caller): Promise<{ state: BillingState; version: number }> {
  const result = await service.readSharedState(caller, { threadId: EXPERTS_BILLING_THREAD });
  if (result.version === 0) return { state: emptyBillingState(), version: 0 };
  if (!isBillingState(result.state)) throw new Error("Unsupported Expert billing ledger schema; an explicit versioned migration is required");
  return { state: result.state as BillingState, version: result.version };
}

interface CeilingCheck { readonly reservation: BillingReservationInput; readonly existing: BillingState }

function enforceCeilings({ reservation, existing }: CeilingCheck, ceilings: SpendingCeilings | undefined): void {
  if (!ceilings || (ceilings.sessionUsd === undefined && ceilings.globalUsd === undefined)) return;
  const spend = billingSpend(existing);
  const reservedCost = reservation.prices
    ? (reservation.inputTokens * reservation.prices.inputUsdPerMillion + reservation.reservedOutputTokens * reservation.prices.outputUsdPerMillion) / 1_000_000
    : null;
  if (reservedCost === null) {
    throw new BillingError("ceiling_exceeded", "Spending ceilings cannot be enforced without explicit input and output prices; configure prices or remove the ceiling");
  }
  if (spend.unknownPriceCount > 0) {
    throw new BillingError("ceiling_exceeded", `Spending ceilings cannot be verified while ${spend.unknownPriceCount} reservation(s) have unknown prices; reconcile or price them first`);
  }
  if (ceilings.globalUsd !== undefined && spend.knownCostUsd + reservedCost > ceilings.globalUsd) {
    throw new BillingError("ceiling_exceeded", `Global spending ceiling exceeded: booked USD ${spend.knownCostUsd.toFixed(6)} plus reservation USD ${reservedCost.toFixed(6)} exceeds USD ${ceilings.globalUsd}`);
  }
  if (ceilings.sessionUsd !== undefined && reservation.sessionId) {
    const sessionCost = spend.sessionCostUsd.get(reservation.sessionId) ?? 0;
    if (sessionCost + reservedCost > ceilings.sessionUsd) {
      throw new BillingError("ceiling_exceeded", `Session spending ceiling exceeded: booked USD ${sessionCost.toFixed(6)} plus reservation USD ${reservedCost.toFixed(6)} exceeds USD ${ceilings.sessionUsd}`);
    }
  }
}

/** Reserve a model call before provider dispatch. Reservation ids are deterministic per logical
 * invocation, so a replayed committed step reuses its id, and a step re-executed after a crash
 * collides with its own interrupted reservation. That collision is never a blind repeat: the
 * interrupted entry is booked conservatively as reconciled-unknown (never zero), and the recovery
 * re-dispatch proceeds under a new, separately booked generation (`...:r1`, `...:r2`) of the same
 * identity — every attempt is accounted exactly once. A released entry re-activates in place
 * because its dispatch provably never happened. */
export async function reserveModelCall(service: RuntimeService, caller: Caller, input: BillingReservationInput, ceilings: SpendingCeilings | undefined): Promise<BillingReservation> {
  const fingerprint = JSON.stringify([input.kind, input.runId, input.assignmentId, input.attempt, input.sessionId, input.model, input.inputTokens, input.reservedOutputTokens, input.prices]);
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readBillingState(service, caller);
    const existingEntry = state.reservations[input.id];
    if (existingEntry) {
      const existingFingerprint = JSON.stringify([existingEntry.kind, existingEntry.runId, existingEntry.assignmentId, existingEntry.attempt, existingEntry.sessionId, existingEntry.model, existingEntry.inputTokens, existingEntry.reservedOutputTokens, existingEntry.prices]);
      if (existingFingerprint !== fingerprint) throw new BillingError("identity_conflict", "Billing reservation identity was reused for different work");
      if (existingEntry.status === "released") {
        const reactivated: BillingReservation = { ...existingEntry, status: "reserved", costUsd: conservativeCost(existingEntry), cause: "re-reserved after a proven no-dispatch release", updatedAt: new Date().toISOString() };
        state.reservations[input.id] = reactivated;
        try {
          await service.updateSharedState(caller, { threadId: EXPERTS_BILLING_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey: `billing-reserve:${input.id}:${version}:reactivate` });
          return reactivated;
        } catch (error) {
          if (!(error instanceof ServiceError) || !["failed_precondition", "unavailable"].includes(error.code)) throw error;
          continue;
        }
      }
      // This is the owning run's own crash-recovery re-execution: only that run can execute this
      // step, and committed steps replay their recorded outcome without reaching this code. Book
      // the interrupted attempt, then reserve the next generation for the recovery dispatch.
      let generation = 0;
      while (state.reservations[`${input.id}:r${generation + 1}`]) generation += 1;
      if (existingEntry.status === "reserved") {
        state.reservations[input.id] = {
          ...existingEntry, status: "reconciled-unknown",
          usage: { inputTokens: existingEntry.inputTokens, outputTokens: existingEntry.reservedOutputTokens, source: "reconciled-conservative" },
          costUsd: conservativeCost(existingEntry), cause: "owner interrupted before the outcome persisted; booked conservatively for the recovery generation", updatedAt: new Date().toISOString(),
        };
      }
      const generationId = `${input.id}:r${generation + 1}`;
      const reservation: BillingReservation = {
        id: generationId, kind: input.kind, runId: input.runId, assignmentId: input.assignmentId, attempt: input.attempt, sessionId: input.sessionId,
        model: input.model, inputTokens: input.inputTokens, reservedOutputTokens: input.reservedOutputTokens, prices: input.prices ?? null,
        status: "reserved", costUsd: null, cause: `recovery generation ${generation + 1} of ${input.id}`, createdAt: new Date().toISOString(),
      };
      reservation.costUsd = conservativeCost(reservation);
      enforceCeilings({ reservation: input, existing: state }, ceilings);
      state.reservations[generationId] = reservation;
      try {
        await service.updateSharedState(caller, { threadId: EXPERTS_BILLING_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey: `billing-reserve:${generationId}:${version}` });
        return reservation;
      } catch (error) {
        if (!(error instanceof ServiceError) || !["failed_precondition", "unavailable"].includes(error.code)) throw error;
      }
      continue;
    }
    enforceCeilings({ reservation: input, existing: state }, ceilings);
    const reservation: BillingReservation = {
      id: input.id, kind: input.kind, runId: input.runId, assignmentId: input.assignmentId, attempt: input.attempt, sessionId: input.sessionId,
      model: input.model, inputTokens: input.inputTokens, reservedOutputTokens: input.reservedOutputTokens, prices: input.prices ?? null,
      status: "reserved", costUsd: null, cause: null, createdAt: new Date().toISOString(),
    };
    reservation.costUsd = conservativeCost(reservation);
    state.reservations[input.id] = reservation;
    try {
      await service.updateSharedState(caller, { threadId: EXPERTS_BILLING_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey: `billing-reserve:${input.id}:${version}` });
      return reservation;
    } catch (error) {
      if (!(error instanceof ServiceError) || !["failed_precondition", "unavailable"].includes(error.code)) throw error;
    }
  }
  throw new Error("Expert billing ledger is busy; retry this reservation");
}

async function transitionReservation(service: RuntimeService, caller: Caller, id: string, apply: (reservation: BillingReservation) => BillingReservation): Promise<BillingReservation> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readBillingState(service, caller);
    const existing = state.reservations[id];
    if (!existing) throw new BillingError("identity_conflict", `Billing reservation ${id} does not exist`);
    const updated = apply(structuredClone(existing));
    state.reservations[id] = updated;
    try {
      await service.updateSharedState(caller, { threadId: EXPERTS_BILLING_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey: `billing-transition:${id}:${version}:${updated.status}` });
      return updated;
    } catch (error) {
      if (!(error instanceof ServiceError) || !["failed_precondition", "unavailable"].includes(error.code)) throw error;
    }
  }
  throw new Error("Expert billing ledger is busy; retry this transition");
}

/** Settle a reservation with observed usage. Provider-reported usage replaces the conservative
 * reservation; unreported generations retain their full conservative amount. */
export async function settleModelCall(service: RuntimeService, caller: Caller, id: string, usage: BillingUsage, cause: string): Promise<BillingReservation> {
  return transitionReservation(service, caller, id, reservation => {
    if (reservation.status !== "reserved" && reservation.status !== "settled") throw new BillingError("reconciliation_required", `Billing reservation ${id} is ${reservation.status} and cannot be settled`);
    const prices = reservation.prices;
    const costUsd = prices ? (usage.inputTokens * prices.inputUsdPerMillion + usage.outputTokens * prices.outputUsdPerMillion) / 1_000_000 : null;
    return { ...reservation, status: "settled", usage, costUsd, cause, updatedAt: new Date().toISOString() };
  });
}

/** Release a reservation whose dispatch provably never happened; it books nothing. */
export async function releaseModelCall(service: RuntimeService, caller: Caller, id: string, cause: string): Promise<BillingReservation> {
  return transitionReservation(service, caller, id, reservation => {
    if (reservation.status !== "reserved") throw new BillingError("reconciliation_required", `Billing reservation ${id} is ${reservation.status} and cannot be released`);
    return { ...reservation, status: "released", costUsd: 0, usage: undefined, cause, updatedAt: new Date().toISOString() };
  });
}

/** Book an unresolvable reservation at its full conservative amount. Never zero, never repeated. */
export async function markReconciledUnknown(service: RuntimeService, caller: Caller, id: string, cause: string): Promise<BillingReservation> {
  return transitionReservation(service, caller, id, reservation => {
    if (reservation.status !== "reserved") throw new BillingError("reconciliation_required", `Billing reservation ${id} is ${reservation.status} and cannot be reconciled`);
    return {
      ...reservation, status: "reconciled-unknown",
      usage: { inputTokens: reservation.inputTokens, outputTokens: reservation.reservedOutputTokens, source: "reconciled-conservative" },
      costUsd: conservativeCost(reservation), cause, updatedAt: new Date().toISOString(),
    };
  });
}

export interface ReconcileVerdict {
  readonly outcome: "in-flight" | "settled" | "released" | "reconciled-unknown";
  readonly usage?: BillingUsage;
  readonly cause: string;
}

/** Evidence-based verdict for one reserved reservation: committed invocation outcomes settle,
 * provable no-dispatch releases, anything else books as unknown at the conservative amount. */
export type ReconcileInspector = (reservation: BillingReservation) => Promise<ReconcileVerdict>;

export async function reconcileBilling(service: RuntimeService, caller: Caller, inspect: ReconcileInspector): Promise<{ settled: number; released: number; unknown: number }> {
  const { state } = await readBillingState(service, caller);
  const result = { settled: 0, released: 0, unknown: 0 };
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.status !== "reserved") continue;
    const verdict = await inspect(structuredClone(reservation));
    if (verdict.outcome === "in-flight") continue;
    if (verdict.outcome === "settled") { await settleModelCall(service, caller, reservation.id, verdict.usage!, verdict.cause); result.settled += 1; }
    else if (verdict.outcome === "released") { await releaseModelCall(service, caller, reservation.id, verdict.cause); result.released += 1; }
    else { await markReconciledUnknown(service, caller, reservation.id, verdict.cause); result.unknown += 1; }
  }
  return result;
}

/** Public, sanitized inspection view. Never exposes routes, credentials or private payloads. */
export function billingOverview(state: BillingState): {
  readonly reservations: readonly { readonly id: string; readonly kind: BillingKind; readonly status: BillingStatus; readonly model: string; readonly inputTokens: number; readonly reservedOutputTokens: number; readonly usage?: BillingUsage; readonly costUsd: number | null; readonly cause: string | null }[];
  readonly knownCostUsd: number;
  readonly unknownPriceCount: number;
} {
  const reservations = Object.values(state.reservations).map(reservation => ({
    id: reservation.id, kind: reservation.kind, status: reservation.status, model: reservation.model,
    inputTokens: reservation.inputTokens, reservedOutputTokens: reservation.reservedOutputTokens,
    ...(reservation.usage ? { usage: reservation.usage } : {}), costUsd: bookedCostUsd(reservation), cause: reservation.cause,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const spend = billingSpend(state);
  return { reservations, knownCostUsd: spend.knownCostUsd, unknownPriceCount: spend.unknownPriceCount };
}

/** Operator-configured spending ceilings resolve from the authoritative settings projection.
 * An invalid stored value fails closed: the caller cannot dispatch under an unusable ceiling. */
export async function readSpendingCeilings(service: RuntimeService, caller: Caller): Promise<SpendingCeilings | undefined> {
  const rows = (await service.readProjection(caller, { name: "settings" })).rows;
  const current = rows.find(row => row.key === "current" || row.key === `${caller.tenant}/current`)?.value as { spending?: unknown } | undefined;
  if (current?.spending === undefined || current?.spending === null) return undefined;
  return parseSpendingCeilings(current.spending);
}

function invocationIndexOf(reservation: BillingReservation): number {
  const segments = reservation.id.split(":");
  let tail = segments.pop() ?? "";
  // Recovery generations carry an ":rN" suffix after the invocation index.
  if (/^r\d+$/.test(tail)) tail = segments.pop() ?? "";
  const index = Number(tail);
  return Number.isSafeInteger(index) && index >= 0 ? index : -1;
}

function reportedUsagePayload(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (payload as { result?: { usage?: { inputTokens?: unknown; outputTokens?: unknown } } } | undefined)?.result?.usage;
  return usage && Number.isSafeInteger(usage.inputTokens) && Number(usage.inputTokens) >= 0 && Number.isSafeInteger(usage.outputTokens) && Number(usage.outputTokens) >= 0
    ? { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) } : undefined;
}

/** Evidence-based reconciliation for reservations whose owner died before settling. A committed
 * invocation outcome settles from provider-reported usage (or conservatively when the committed
 * call failed or went unreported); a live run stays in flight; anything else — including erased
 * evidence — books the full conservative amount as unknown rather than guessing or repeating. */
export function runInvocationInspector(service: RuntimeService, caller: Caller): ReconcileInspector {
  return async reservation => {
    const capability = reservation.kind === "expert-model" ? "expert.model.generate" : "model.generate";
    if (!reservation.runId) return { outcome: "reconciled-unknown", cause: "reservation records no owning run" };
    let run: { status?: string } | undefined;
    try { run = await service.getRun(caller, { runId: reservation.runId }); }
    catch { return { outcome: "reconciled-unknown", cause: "owning run is missing from authoritative state" }; }
    if (run && ["running", "waiting"].includes(run.status ?? "")) return { outcome: "in-flight", cause: "owning run is still active" };
    const invocations: { erasure?: unknown; payload: unknown }[] = [];
    try {
      for await (const event of service.events(caller, { runId: reservation.runId })) {
        if (event.eventType === "run.invocation" && event.metadata?.capability === capability) invocations.push({ erasure: event.erasure, payload: event.payload });
      }
    } catch {
      return { outcome: "reconciled-unknown", cause: "owning run event history is unavailable" };
    }
    const index = invocationIndexOf(reservation);
    const committed = index >= 0 ? invocations[index] : undefined;
    if (!committed) return { outcome: "reconciled-unknown", cause: "no committed invocation outcome; the dispatch outcome cannot be established" };
    if (committed.erasure) return { outcome: "reconciled-unknown", cause: "the committed invocation outcome was erased" };
    const usage = reportedUsagePayload(committed.payload);
    return usage
      ? { outcome: "settled", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, source: "provider" }, cause: "settled from the committed provider-reported invocation" }
      : { outcome: "settled", usage: { inputTokens: reservation.inputTokens, outputTokens: reservation.reservedOutputTokens, source: "reconciled-conservative" }, cause: "settled conservatively from the committed failed or unreported invocation" };
  };
}
