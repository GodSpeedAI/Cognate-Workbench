// Public projection `experts-billing` (J-CONTEXT-BUDGET): one sanitized "current" row per tenant,
// folded from the durable billing ledger's `state.changed` events. The row carries the ledger's
// public inspection view — reservation ids, kinds, statuses, models, token amounts, booked costs
// and unknown-price counts — and never a route, credential or private payload. Unknown prices are
// surfaced as null cost plus an unknown-price count, never as zero.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";
import { billingOverview, EXPERTS_BILLING_THREAD, isBillingState } from "../experts/billing.ts";

export const expertsBillingProjection: Projection = {
  name: "experts-billing",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType !== "state.changed" || event.metadata?.threadId !== EXPERTS_BILLING_THREAD) return [];
    if (event.erasure) return [{ key: `${event.tenant}/current`, value: null }];
    const snapshot = (event.payload as { snapshot?: unknown }).snapshot;
    if (!isBillingState(snapshot)) return [{ key: `${event.tenant}/current`, value: null }];
    return [{ key: `${event.tenant}/current`, value: JSON.parse(JSON.stringify(billingOverview(snapshot))) as Json }];
  },
};
