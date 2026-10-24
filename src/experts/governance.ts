// Native service boundary for Experts' internal waits and cascading cancellation. A browser
// cannot fabricate a Specialist return by resolving its parent's internal continuation.
import { ServiceError, type Caller, type RuntimeService } from "@godspeedai/cognate-runtime-api";
import { EXPERT_AGENT } from "./types.ts";

export function expertGovernedService(service:RuntimeService,system:Caller):RuntimeService{
  return {
    ...service,
    async readProjection(caller,request){
      const view=await service.readProjection(caller,request);
      // Immutable preparation cache rows are implementation state. Only the accepted root view
      // is public, including when a prepared partition lost its manifest CAS race.
      return request.name==="experts" ? {...view,rows:view.rows.filter(row=>row.key==="current" || row.key===`${caller.tenant}/current`)}:view;
    },
    async resolveContinuation(caller,request){
      const waits=await service.listContinuations({...system,tenant:caller.tenant},{});
      const wait=waits.find(w=>w.id===request.continuationId);
      if(wait?.type==="expert-assignment" && (caller.actor.kind!=="system" || caller.actor.id!==system.actor.id))throw new ServiceError("permission_denied","Specialist returns are resolved only by the durable completion bridge");
      const condition=wait?.condition as {kind?:string}|null|undefined;
      const humanGate=wait && (["tool-approval","governance-approval","plan-review"].includes(wait.type) || condition?.kind==="human_approval" || condition?.kind==="governance_approval");
      if(humanGate && caller.actor.kind!=="user")throw new ServiceError("permission_denied","Only a human may resolve protected approvals");
      return service.resolveContinuation(caller,request);
    },
    async cancelRun(caller,request){
      const run=await service.getRun(caller,{runId:request.runId});
      if(run.agent===EXPERT_AGENT && caller.actor.kind!=="system")throw new ServiceError("permission_denied","Cancel Expert work through team.cancel so delegated work is cancelled together");
      return service.cancelRun(caller,request);
    },
  };
}
