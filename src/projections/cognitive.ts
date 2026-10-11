// Public projection `cognitive`: a single `latest` row that changes whenever a cognitive fact is
// recorded. The Console subscribes to it only as a *change signal* and then asks `case.derive` for
// the Case — the Case itself is never stored here (it is derived server-side from events).
import type { Projection } from "@godspeedai/cognate-projections";
import { COGNITIVE_EVENT_TYPES } from "../agents/agentCognitive.ts";

export const cognitiveProjection: Projection = {
  name: "cognitive",
  version: "1.0.0",
  apply(event) {
    if (!COGNITIVE_EVENT_TYPES.has(event.eventType)) return [];
    const rows = [{ key: `${event.tenant}/latest`, value: { position: event.position, eventType: event.eventType } }];
    if (event.eventType === "case.opened") rows.push({ key: `${event.tenant}/activeCase`, value: String((event.payload as { caseId?: string }).caseId ?? "") } as never);
    return rows;
  },
};
