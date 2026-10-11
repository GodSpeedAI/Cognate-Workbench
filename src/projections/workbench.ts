// Public projection `workbench`: the cockpit's one derived view (tasks, contracts, workflows and
// their instances, the capability catalog and bindings, the evidence ledger, automations, usage,
// steering inboxes, grounded feedback, protection blocks). It only folds `workbench.*` events, via
// the pure reducer in `src/workbench/reducer.ts`. Keys are tenant-prefixed (public projection rule).
import type { Projection } from "@godspeedai/cognate-projections";
import { reduceWorkbench } from "../workbench/reducer.ts";

export const workbenchProjection: Projection = {
  name: "workbench",
  version: "1.0.0",
  apply(event, state) {
    if (!event.eventType.startsWith("workbench.")) return [];
    const prefix = `${event.tenant}/`;
    return reduceWorkbench(event.eventType, event.payload, event.recordedAt, event.eventId, (key) => state.get(`${prefix}${key}`)).map((w) => ({
      key: `${prefix}${w.key}`,
      value: w.value,
    }));
  },
};
