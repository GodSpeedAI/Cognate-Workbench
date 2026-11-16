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

/** Dollar amounts with precision that fits their size: tiny model costs keep six places, bigger ones fewer. */
export function formatUsd(value: number): string {
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return `USD ${value.toFixed(digits)}`;
}

export function SpendingStatus() {
  const billingRows = useProjection("experts-billing");
  const settingsRows = useProjection("settings");
  const billing = currentValue<BillingRow>(billingRows);
  const spending = currentValue<{ spending?: { sessionUsd?: number; globalUsd?: number } }>(settingsRows)?.spending;
  const reservations = billing?.reservations ?? [];
  const active = reservations.filter(reservation => reservation.status !== "released");
  // D-21 (REDESIGN): the settlement cause read the same on every run line — render the
  // distinct causes once above the list instead of repeating them per row.
  const causes = [...new Set(active.map(reservation => reservation.cause).filter(Boolean))] as readonly string[];
  return <section className="experts-section" aria-labelledby="spending-heading" data-testid="spending-status">
    <div className="experts-section-head"><div>
      <h3 id="spending-heading">Spending and billing</h3>
      <p className="experts-muted">Durable pre-dispatch reservations with operator ceilings. Unknown prices are never treated as zero.</p>
    </div></div>
    <p data-testid="spending-summary">{billing && billing.unknownPriceCount > 0 && billing.knownCostUsd === 0
      ? "Cost unknown (no price configured)."
      : `Booked cost at operator-configured prices: ${billing ? formatUsd(billing.knownCostUsd) : "unknown"}.`}{billing && billing.unknownPriceCount > 0 ? ` ${billing.unknownPriceCount} ${billing.unknownPriceCount === 1 ? "reservation has" : "reservations have"} no price, so spending ceilings cannot be verified until prices are set on the Expert.` : ""}</p>
    <p data-testid="spending-ceilings">{spending?.globalUsd !== undefined || spending?.sessionUsd !== undefined
      ? `Ceilings: global USD ${spending?.globalUsd ?? "not set"}, per session USD ${spending?.sessionUsd ?? "not set"}.`
      : "No spending ceilings are configured; dispatch is bounded only by Assignment budgets."}</p>
    {causes.length > 0 && <p className="experts-muted" data-testid="spending-causes">Settlement: {causes.join(" · ")}.</p>}
    {active.length === 0 ? <p data-testid="spending-reservations">No active billing reservations.</p> : <ol data-testid="spending-reservations">{active.slice(-10).map(reservation => <li key={reservation.id}>
      <strong>{reservation.model}</strong> — {reservation.status}{reservation.usage ? ` (usage ${reservation.usage.inputTokens} in / ${reservation.usage.outputTokens} out, ${reservation.usage.source})` : ` (reserved ${reservation.inputTokens} in / ${reservation.reservedOutputTokens} out)`}
      <p>{reservation.costUsd === null || reservation.costUsd === undefined ? "Cost unknown (no price configured)." : `Booked cost: ${formatUsd(reservation.costUsd)}.`}</p>
    </li>)}</ol>}
  </section>;
}
