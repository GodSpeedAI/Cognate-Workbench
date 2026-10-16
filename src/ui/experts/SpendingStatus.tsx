// J-CONTEXT-BUDGET spending inspection: the operator's durable billing state — booked cost,
// unknown-price count, active reservations and the effective spending ceilings — folded live from
// the public `experts-billing` and `settings` projections. Unknown cost is shown as unknown and
// never as zero; a ceiling that cannot be verified says so.
import { useProjection } from "@godspeedai/cognate-react";

interface BillingReservationRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly reservedOutputTokens: number;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly source: string };
  readonly costUsd: number | null;
  readonly cause: string | null;
}

interface BillingRow {
  readonly reservations: readonly BillingReservationRow[];
  readonly knownCostUsd: number;
  readonly unknownPriceCount: number;
}

function currentValue<T>(rows: readonly { readonly key: string; readonly value: unknown }[] | undefined): T | undefined {
  const row = rows?.find((candidate) => candidate.key === "current" || candidate.key.endsWith("/current"));
  return row?.value as T | undefined;
}

export function SpendingStatus() {
  const billingRows = useProjection("experts-billing");
  const settingsRows = useProjection("settings");
  const billing = currentValue<BillingRow>(billingRows);
  const spending = currentValue<{ spending?: { sessionUsd?: number; globalUsd?: number } }>(settingsRows)?.spending;
  const reservations = billing?.reservations ?? [];
  const active = reservations.filter(reservation => reservation.status !== "released");
  return <section className="experts-section" aria-labelledby="spending-heading" data-testid="spending-status">
    <div className="experts-section-head"><div>
      <h3 id="spending-heading">Spending and billing</h3>
      <p className="experts-muted">Durable pre-dispatch reservations with operator ceilings. Unknown prices are never treated as zero.</p>
    </div></div>
    <p data-testid="spending-summary">Booked cost at operator-configured prices: {billing ? `USD ${billing.knownCostUsd.toFixed(6)}` : "unknown"}.{billing && billing.unknownPriceCount > 0 ? ` ${billing.unknownPriceCount} reservation(s) have unknown prices; the spending ceilings cannot be verified while they stand.` : ""}</p>
    <p data-testid="spending-ceilings">{spending?.globalUsd !== undefined || spending?.sessionUsd !== undefined
      ? `Ceilings: global USD ${spending?.globalUsd ?? "not set"}, per session USD ${spending?.sessionUsd ?? "not set"}.`
      : "No spending ceilings are configured; dispatch is bounded only by Assignment budgets."}</p>
    {active.length === 0 ? <p data-testid="spending-reservations">No active billing reservations.</p> : <ol data-testid="spending-reservations">{active.slice(-10).map(reservation => <li key={reservation.id}>
      <strong>{reservation.model}</strong> — {reservation.status}{reservation.usage ? ` (usage ${reservation.usage.inputTokens} in / ${reservation.usage.outputTokens} out, ${reservation.usage.source})` : ` (reserved ${reservation.inputTokens} in / ${reservation.reservedOutputTokens} out)`}
      <p>{reservation.costUsd === null || reservation.costUsd === undefined ? "Cost unknown: explicit prices are required." : `Booked cost: USD ${reservation.costUsd.toFixed(6)}.`}{reservation.cause ? ` ${reservation.cause}.` : ""}</p>
    </li>)}</ol>}
  </section>;
}
