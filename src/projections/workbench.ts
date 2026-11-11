// Public projection `workbench`: the cockpit's one derived view (tasks, contracts, workflows and
// their instances, the capability catalog and bindings, the evidence ledger, automations, usage,
// steering inboxes, grounded feedback, protection blocks). It folds `workbench.*` events and —
// capability-bundles tranche P — the `authority.*` decision/grant families, via the pure reducer
// in `src/workbench/reducer.ts`. Keys are tenant-prefixed (public projection rule).
import type { Projection } from "@godspeedai/cognate-projections";
import { reduceWorkbench } from "../workbench/reducer.ts";

export const workbenchProjection: Projection = {
  name: "workbench",
  version: "1.0.0",
  apply(event, state) {
    if (!event.eventType.startsWith("workbench.") && !event.eventType.startsWith("authority.") && !event.eventType.startsWith("capability.")) return [];
    const prefix = `${event.tenant}/`;
    return reduceWorkbench(event.eventType, event.payload, event.recordedAt, event.eventId, (key) => state.get(`${prefix}${key}`)).map((w) => ({
      key: `${prefix}${w.key}`,
      value: w.value,
    }));
  },
};
