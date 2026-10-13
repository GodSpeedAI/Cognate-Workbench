// Native service boundary for Experts' internal waits and cascading cancellation. A browser
// cannot fabricate a Specialist return by resolving its parent's internal continuation.
import { ServiceError, type Caller, type RuntimeService } from "@godspeedai/cognate-runtime-api";
import { EXPERT_AGENT } from "./types.ts";

export function expertGovernedService(service:RuntimeService,system:Caller):RuntimeService{
  return {
    ...service,
    async resolveContinuation(caller,request){
      const waits=await service.listContinuations({...system,tenant:caller.tenant},{});
      const wait=waits.find(w=>w.id===request.continuationId);
      if(wait?.type==="expert-assignment" && (caller.actor.kind!=="system" || caller.actor.id!==system.actor.id))throw new ServiceError("permission_denied","Specialist returns are resolved only by the durable completion bridge");
      if(wait && ["tool-approval","governance-approval"].includes(wait.type) && caller.actor.kind!=="user")throw new ServiceError("permission_denied","Only a human may resolve protected approvals");
      return service.resolveContinuation(caller,request);
    },
    async cancelRun(caller,request){
      const run=await service.getRun(caller,{runId:request.runId});
      if(run.agent===EXPERT_AGENT && caller.actor.kind!=="system")throw new ServiceError("permission_denied","Cancel Expert work through team.cancel so delegated work is cancelled together");
      return service.cancelRun(caller,request);
    },
  };
}
