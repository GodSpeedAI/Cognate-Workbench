// Compatible completion bridge for Cognate: its run_completion condition is stored but
// not automatically resolved. Follow committed events, repair on boot, and resolve native waits.
// Cognate's own durable run outbox remains the executor. This is not a second work scheduler.
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { RLM_AGENT_ID } from "@godspeedai/cognate-runtime-api";
import { EXPERT_AGENT, EXPERTS_THREAD, isUnfinished, type Assignment, type Handoff, type RlmChildOutcome } from "./types.ts";
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
    const startedThisPass=new Map<string,number>();
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
        if(a.parentId){
          // Children are admitted while their parent waits; they never consume root batch slots.
          if(!isUnfinished(state.assignments[a.parentId]!))continue;
        }else{
          // T2 batching policy: a Team's queued roots dispatch in batches of its authoritative
          // `admissionBatch` (solo conversations keep one-at-a-time); concurrency is separately
          // bounded by the Team's admission lanes at the eligibility lookup.
          const groupKey=a.teamId ? `team:${a.teamId}` : `conversation:${a.conversationId}`;
          const batch=a.teamId ? (state.teams[a.teamId]?.limits.admissionBatch ?? 1) : 1;
          const boundedBatch=Number.isSafeInteger(batch) && (batch as number)>=1 && (batch as number)<=8 ? batch as number : 1;
          const activeRoots=Object.values(state.assignments).filter(other=>other.id!==a.id && !other.parentId && other.runId && isUnfinished(other) && (a.teamId ? other.teamId===a.teamId : other.conversationId===a.conversationId)).length;
          const dispatchedThisPass=startedThisPass.get(groupKey) ?? 0;
          if(activeRoots+dispatchedThisPass>=boundedBatch)continue;
        }
        const groupKey=a.teamId ? `team:${a.teamId}` : `conversation:${a.conversationId}`;
        // Capability-bundles tranche P (§1.1): expert runs execute under the responsible agent
        // principal — `wb-agent:<expertId>` — so enforcement attributes work to the agent, never
        // to the operator or the shared system caller. Narrowing is lineage-derived (the child's
        // own assignment bounds); the principal creates no new identity authority (§1.7).
        const runCaller={actor:{id:`wb-agent:${a.expertId}`,kind:"agent" as const},tenant:this.tenant};
        const run=await service.startRun(runCaller,{agent:EXPERT_AGENT,input:{assignmentId:a.id,attempt:a.attempt},idempotencyKey:`expert-run:${a.id}:${a.attempt}`,correlationId:`expert:${a.id}:${a.attempt}`,...(a.execution.caseContext ? {caseContext:a.execution.caseContext} : {})});
        startedThisPass.set(groupKey,(startedThisPass.get(groupKey) ?? 0)+1);
        await this.experts.mutate(this.tenant,`bind:${a.id}:${a.attempt}`,{runId:run.runId},s=>{
          const current=s.assignments[a.id]!;
          if(!isUnfinished(current))return {ok:true};
          if(current.runId && current.runId!==run.runId)throw new Error("Assignment run identity conflict");
          current.runId=run.runId;current.status="running";
          current.execution.context=this.experts.context(s,s.experts[current.expertId]!,s.conversations[current.conversationId]!,s.assignments[current.reviews ?? ""]);
          for(const mid of s.conversations[current.conversationId]!.messageIds){const m=s.messages[mid]!;if(m.recipientId===current.expertId && m.delivery==="queued" && !m.targetAssignmentId){m.targetAssignmentId=current.id;m.targetRunId=run.runId;m.inboxStatus="incorporated";m.delivery="delivered";m.incorporatedAtBoundary="assignment-start";}}
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
      const rlmChildren:RlmChildOutcome[]=[];
      let terminalEventId:string|null=null;
      for await(const event of service.events(caller,{runId:run.runId})){
        if(["run.completed","run.failed","run.cancelled"].includes(event.eventType))terminalEventId=event.eventId;
        // J-RLM-CHILD-RUN: the parent recorded each child's terminal outcome after its wait resolved.
        if(event.eventType==="rlm.child.completed"){
          const child=event.payload as unknown as RlmChildOutcome;
          if(!rlmChildren.some(known=>known.invocationId===child.invocationId))rlmChildren.push(child);
        }
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
        if(rlmChildren.length){
          finalHandoff.rlmChildren=rlmChildren;
          for(const child of rlmChildren){const ref=`rlm-child:${child.runId}:${child.status}`;if(!finalHandoff.evidence.includes(ref))finalHandoff.evidence.push(ref);}
        }
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
    await this.reconcileRlmChildren(waits);
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
  /** J-RLM-CHILD-RUN: resolve a parent's `rlm-child` wait once the linked child run is terminal. The wait's own
   * condition is never trusted: the child must be an `agent.rlm` run correlated to exactly this parent. */
  async reconcileRlmChildren(waits:readonly {id:string;type:string;runId:string;condition:unknown}[]):Promise<void>{
    const service:RuntimeService=this.experts.service;
    const caller=this.experts.caller(this.tenant);
    for(const wait of waits){
      if(wait.type!=="rlm-child" || this.controller.signal.aborted)continue;
      const condition=wait.condition as {invocationId?:string;childRunId?:string}|null;
      if(!condition?.childRunId || !condition.invocationId)continue;
      const child=await service.getRun(caller,{runId:condition.childRunId});
      if(child.agent!==RLM_AGENT_ID || child.correlationId!==`rlm:${wait.runId}:${condition.invocationId}`)continue;
      if(!["completed","failed","cancelled"].includes(child.status))continue;
      let outcome:Record<string,unknown>={};
      for await(const event of service.events(caller,{runId:child.runId}))if(event.eventType==="rlm.outcome")outcome=event.payload as Record<string,unknown>;
      const reported=child.status==="completed" ? (child.output as {status?:string}|null)?.status : child.status;
      const status=(["completed","failed","timedOut","cancelled"].includes(String(reported)) ? reported : child.status==="completed" ? "completed":child.status) as RlmChildOutcome["status"];
      const result:Record<string,unknown>={invocationId:condition.invocationId,runId:child.runId,status,evidence:Array.isArray(outcome.evidence)?outcome.evidence:[],...(typeof outcome.resultRef==="string"?{resultRef:outcome.resultRef}:{}),...(child.error?{error:child.error}:{})};
      await service.resolveContinuation(caller,{continuationId:wait.id,action:"resume",input:JSON.parse(JSON.stringify(result)),idempotencyKey:`rlm-child:${wait.id}`});
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
