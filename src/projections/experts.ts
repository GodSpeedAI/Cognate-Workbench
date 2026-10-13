import type { Projection } from "@godspeedai/cognate-projections";
import { EXPERTS_THREAD, type ExpertState } from "../experts/types.ts";
import { json, publicExperts } from "../experts/state.ts";

export const expertsProjection: Projection = {
  name:"experts",version:"1.0.0",
  apply(event) {
    if (event.eventType !== "state.changed" || event.metadata?.threadId !== EXPERTS_THREAD) return [];
    const payload = event.payload as {snapshot?: ExpertState};
    if (payload.snapshot?.schema !== 1) return [];
    return [{key:`${event.tenant}/current`,value:json(publicExperts(payload.snapshot))}];
  },
};
