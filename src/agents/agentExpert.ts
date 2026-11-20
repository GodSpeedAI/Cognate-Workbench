// A governed durable Expert run reuses the existing coding engine, authority plane and approvals.
// Identity/config/context are obtained from the assignment registry, never trusted from run input.
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { agentCodingAgent as defaultCoding } from "./agentCoding.ts";
import { EXPERT_AGENT, type ExpertExecution } from "../experts/types.ts";
import { json } from "../experts/state.ts";

export const createAgentExpert = (coding: AgentDefinition = defaultCoding): AgentDefinition => ({
  id:EXPERT_AGENT,version:"1.0.0",
  async run(raw,ctx) {
    const input=raw as {assignmentId:string;attempt:number};
    const config=await ctx.invoke("expert.context",{assignmentId:input.assignmentId}) as unknown as {execution:ExpertExecution;workspaceId:string;mode:string;message:string};
    // J-TASK-expert-provenance: the Assignment's validated Task rides the trusted execution
    // snapshot; agent.coding freezes it into the run's evidence (it is never raw run input).
    const output=await coding.run(json({sessionId:`expert:${input.assignmentId}:${input.attempt}`,workspaceId:config.workspaceId,message:config.message,mode:config.mode,expertExecution:config.execution}),ctx);
    // J-HANDOFF-case-context: the validated CEP context and its asserted provenance are recorded in
    // the run's evidence. `worldCorroboration` is `asserted` unless a real registry check ran; the
    // receipt adds no keys when the run is case-free.
    const receipt=await ctx.artifact({name:`expert-${input.assignmentId}-attempt-${input.attempt}.json`,mediaType:"application/json",bytes:new TextEncoder().encode(JSON.stringify({assignmentId:input.assignmentId,expertId:config.execution.expertId,taskId:config.execution.taskId ?? null,...(config.execution.caseContext ? {caseContext:config.execution.caseContext,assertedBy:config.execution.assertedBy ?? null,worldCorroboration:config.execution.worldCorroboration ?? "asserted"} : {}),runId:ctx.runId,output,verification:"unverified; independent evidence and human settlement required"}))});
    return {output,receipt};
  },
});

export const agentExpert: AgentDefinition = createAgentExpert();
