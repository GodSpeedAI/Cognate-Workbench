import { expect, test } from "bun:test";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { expertGovernedService } from "../src/experts/governance.ts";

test("J-TEAM-HANDOFF / SETTLEMENT: internal returns cannot be forged and Experts cannot approve protected effects",async()=>{
  const human:Caller={tenant:"test",actor:{id:"operator",kind:"user"}};
  const system:Caller={tenant:"test",actor:{id:"system",kind:"system"}};
  const native={
    async listContinuations(){return [{id:"child-return",type:"expert-assignment"},{id:"human-gate",type:"tool-approval"}];},
    async resolveContinuation(){return {outcome:"transitioned"};},
    async getRun(_caller:Caller,request:{runId:string}){return {agent:request.runId==="expert" ? "agent.expert":"agent.coding"};},
    async cancelRun(){return {status:"cancelled"};},
  } as unknown as RuntimeService;
  const service=expertGovernedService(native,system);
  const resume=(continuationId:string)=>({continuationId,action:"resume" as const,idempotencyKey:"same",input:{approved:true}});
  await expect(service.resolveContinuation(human,resume("child-return"))).rejects.toThrow("durable completion bridge");
  await expect(service.resolveContinuation(system,resume("human-gate"))).rejects.toThrow("Only a human");
  expect((await service.resolveContinuation(human,resume("human-gate"))).outcome).toBe("transitioned");
  expect((await service.resolveContinuation(system,resume("child-return"))).outcome).toBe("transitioned");
  await expect(service.cancelRun(human,{runId:"expert",reason:"stop",idempotencyKey:"cancel"})).rejects.toThrow("team.cancel");
  expect((await service.cancelRun(human,{runId:"legacy",reason:"stop",idempotencyKey:"cancel"})).status).toBe("cancelled");
});
