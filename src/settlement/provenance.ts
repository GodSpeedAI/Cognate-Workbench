// Settlement provenance (#117): one vocabulary for the two settlement machines, so a reader can tell
// them apart from the payload alone and a record that predates the distinction is never reclassified.
//
//   "local"    — a Candidate Promotion (`world.settle`): the human promotes a verified candidate in
//                this world; no external judge is involved, so the receipt is always null.
//   "governed" — a SEA-Forge settlement record (`workbench.settlement.recorded`). When SEA-Forge
//                returns a ledger entry, `receiptRef` names it; a governed attempt with no receipt
//                carries `receiptRef:null` and is still governed.
//
// Absence reads as local/null, never as governed: a record that never declared a scope must not be
// promoted by omission, so historical records keep the weaker standing their fields support.

export type SettlementScope = "local" | "governed";

export interface SettlementProvenance {
  readonly settlementScope: SettlementScope;
  /** SEA-Forge's ledger entry (the receipt reference), or null for a local promotion / an attempt with no receipt. */
  readonly receiptRef: string | null;
}

/** The provenance every settlement payload carries. Absent fields read as local/null. */
export function settlementProvenance(payload: unknown): SettlementProvenance {
  const p = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  const settlementScope: SettlementScope = p.settlementScope === "governed" ? "governed" : "local";
  const receiptRef = typeof p.receiptRef === "string" && p.receiptRef.length > 0 ? p.receiptRef : null;
  return { settlementScope, receiptRef };
}

/** The provenance fragment a local Candidate Promotion carries. */
export const LOCAL_SETTLEMENT: SettlementProvenance = { settlementScope: "local", receiptRef: null };

/** The provenance fragment a governed settlement record carries (receipt null until SEA-Forge returns one). */
export function governedSettlement(receiptRef: string | null): SettlementProvenance {
  return { settlementScope: "governed", receiptRef };
}
