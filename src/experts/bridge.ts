// Compatible completion bridge for Cognate 0.2.0: its run_completion condition is stored but
// not automatically resolved. Follow committed events, repair on boot, and resolve native waits.
// Cognate's own durable run outbox remains the executor. This is not a second work scheduler.
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { EXPERT_AGENT, EXPERTS_THREAD, isUnfinished, type Assignment, type Handoff } from "./types.ts";
import { ExpertsService } from "./service.ts";

export class ExpertCompletionBridge {
  readonly controller=new AbortController();
  #task:Promise<void>|undefined;
  error:string|null=null;
  constructor(readonly experts:ExpertsService,readonly tenant:string){}
  async reconcile():Promise<void>{
    const service:RuntimeService=this.experts.service;
    const caller=this.experts.caller(this.tenant);
    let state=await this.experts.state(this.tenant);
    for(const a of Object.values(state.assignments)){
      if(this.controller.signal.aborted)return;
      if(a.status==="cancelled"){
        if(a.runId){
          const run=await service.getRun(caller,{runId:a.runId});
          if(["running","waiting"].includes(run.status))await service.cancelRun(caller,{runId:a.runId,reason:"Assignment cancelled by the human operator",idempotencyKey:`expert-cancel:${a.id}:${a.attempt}`});
        }
        continue;
      }
      if(a.status==="queued" && !a.runId){
        // Serialize roots within a Team/conversation; children are admitted while their parent waits.
        const busy=!a.parentId && Object.values(state.assignments).some(other=>other.id!==a.id && !other.parentId && other.runId && isUnfinished(other) && (a.teamId ? other.teamId===a.teamId : other.conversationId===a.conversationId));
        if(busy)continue;
        if(a.parentId && !isUnfinished(state.assignments[a.parentId]!))continue;
        const run=await service.startRun(caller,{agent:EXPERT_AGENT,input:{assignmentId:a.id,attempt:a.attempt},idempotencyKey:`expert-run:${a.id}:${a.attempt}`,correlationId:`expert:${a.id}:${a.attempt}`});
        await this.experts.mutate(this.tenant,`bind:${a.id}:${a.attempt}`,{runId:run.runId},s=>{
          const current=s.assignments[a.id]!;
          if(!isUnfinished(current))return {ok:true};
          if(current.runId && current.runId!==run.runId)throw new Error("Assignment run identity conflict");
          current.runId=run.runId;current.status="running";
          current.execution.context=this.experts.context(s,s.experts[current.expertId]!,s.conversations[current.conversationId]!);
          for(const mid of s.conversations[current.conversationId]!.messageIds){const m=s.messages[mid]!;if(m.recipientId===current.expertId && m.delivery==="queued")m.delivery="delivered";}
          return {ok:true};
        });
        a.runId=run.runId;a.status="running";
      }
      if(!a.runId || !isUnfinished(a))continue;
      const run=await service.getRun(caller,{runId:a.runId});
      if(run.status==="waiting" && a.status!=="waiting")await this.experts.mutate(this.tenant,`waiting:${a.id}:${a.attempt}:${run.waitingOn.join(",")}`,{runId:run.runId},s=>{if(isUnfinished(s.assignments[a.id]!))s.assignments[a.id]!.status="waiting";return {ok:true};});
      if(!["completed","failed","cancelled"].includes(run.status))continue;
      const result=run.output as {output?:{text?:string};receipt?:string}|null;
      const observedFailures:string[]=[];
      let terminalEventId:string|null=null;
      for await(const event of service.events(caller,{runId:run.runId})){
        if(["run.completed","run.failed","run.cancelled"].includes(event.eventType))terminalEventId=event.eventId;
        if(event.eventType==="tool.call.failed"){
          const failed=event.payload as {tool?:string;error?:string};observedFailures.push(`${failed.tool ?? "tool"}: ${failed.error ?? "failed"}`);
        }
      }
      const handoff:Handoff=a.handoff ?? {
        assignmentId:a.id,expertId:a.expertId,runId:run.runId,disposition:run.status==="completed" ? "result":"failed",
        output:result?.output?.text ?? run.error ?? `Run ${run.status}`,artifacts:result?.receipt ? [result.receipt]:[],
        evidence:[`run:${run.runId}`],uncertainties:[],failures:run.status==="completed" ? []:[run.error ?? run.status],followUp:[],
      };
      if(result?.receipt && !handoff.artifacts.includes(result.receipt))handoff.artifacts.push(result.receipt);
      await this.experts.mutate(this.tenant,`return:${a.id}:${a.attempt}`,{runId:run.runId,status:run.status},s=>{
        const current=s.assignments[a.id]!;if(current.status==="cancelled" || current.attempt!==a.attempt)return {ok:true};
        const finalHandoff=current.handoff ?? handoff;
        finalHandoff.observedFailures=observedFailures;
        if(result?.receipt && !finalHandoff.artifacts.includes(result.receipt))finalHandoff.artifacts.push(result.receipt);
        if(run.status!=="completed"){finalHandoff.disposition="failed";finalHandoff.failures.push(run.error ?? run.status);}
        current.handoff=finalHandoff;current.status=run.status==="completed" ? "reconciliation-required":run.status==="cancelled" ? "cancelled":"failed";
        const c=s.conversations[current.conversationId]!;const id=`return:${a.id}:${a.attempt}`;
        s.messages[id]={id,conversationId:c.id,assignmentId:a.id,sender:{kind:"expert",id:a.expertId},recipientId:a.parentId ? s.assignments[a.parentId]!.expertId:"human",text:finalHandoff.output,correlationId:run.correlationId,causationId:terminalEventId,delivery:"delivered",replyTo:a.parentId};
        if(!c.messageIds.includes(id))c.messageIds.push(id);return {ok:true};
      });
    }
    state=await this.experts.state(this.tenant);
    const waits=await service.listContinuations(caller,{status:"OPEN"});
    for(const wait of waits){
      if(wait.type!=="expert-assignment")continue;
      const condition=wait.condition as {assignmentId?:string};
      const a=state.assignments[condition.assignmentId ?? ""];
      if(!a || isUnfinished(a))continue;
      const parent=state.assignments[a.parentId ?? ""];
      if(!parent || parent.runId!==wait.runId || !isUnfinished(parent))continue;
      const result=a.handoff ?? {assignmentId:a.id,status:a.status,disposition:"failed",failures:["Assignment cancelled"],output:"Assignment cancelled"};
      await service.resolveContinuation(caller,{continuationId:wait.id,action:"resume",input:JSON.parse(JSON.stringify(result)),idempotencyKey:`expert-return:${a.id}:${a.attempt}`});
      await this.experts.mutate(this.tenant,`reconciled:${a.id}:${a.attempt}`,{parentId:parent.id},s=>{s.assignments[a.id]!.reconciled=true;return {ok:true};});
    }
  }
  async start():Promise<void>{
    await this.reconcile();
    this.#task=(async()=>{
      // Replay from zero closes the scan/follow race. Operations deduplicate in the registry and SDK.
      for await(const event of this.experts.service.events(this.experts.caller(this.tenant),{follow:true,signal:this.controller.signal})){
        if(this.controller.signal.aborted)return;
        if(event.eventType==="state.changed" && event.metadata?.threadId===EXPERTS_THREAD || ["run.started","run.completed","run.failed","run.cancelled","run.waiting"].includes(event.eventType)){
          try{await this.reconcile();this.error=null;}catch(error){this.error=error instanceof Error ? error.message:"Expert completion bridge failed";console.error("[experts] completion reconciliation failed",this.error);}
        }
      }
    })().catch(error=>{if(!this.controller.signal.aborted){this.error=String(error);console.error("[experts] completion stream failed",this.error);}});
  }
  async stop():Promise<void>{this.controller.abort();await this.#task;}
}
