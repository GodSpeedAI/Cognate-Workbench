import { expect,test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { enforceExpertBudget,estimateRequestTokens,estimateMethodOf,LEGACY_ESTIMATE_METHOD,modelAccounting,parseExpertBudget,priorModelConsumption } from "../src/experts/economics.ts";
import { tokenizerForRoute } from "../src/experts/tokenizer.ts";
import { configureDefaultRoutes,invoke,route,waitForAssignment,withExpertApp } from "./expert-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { ModelRequest } from "@godspeedai/cognate-capabilities";

test("J-CONTEXT-BUDGET accounts instructions, tools, Unicode and reserved output before invocation",()=>{
  const request={messages:[{role:"user" as const,content:"hello 世界"}],instructions:"Pinned constraints",tools:[{name:"read",description:"Read a file",inputSchema:{type:"object" as const}}]};
  const budget=parseExpertBudget({contextTokens:4096,maxOutputTokens:500,totalTokens:10_000})!;
  expect(estimateRequestTokens(request)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(request.messages)).byteLength);
  expect(enforceExpertBudget(request,budget,8192,{tokens:0,costUsd:null}).maxTokens).toBe(500);
  expect(()=>enforceExpertBudget({...request,instructions:"x".repeat(5000)},budget,8192,{tokens:0,costUsd:null})).toThrow("Context budget exceeded");
  expect(()=>enforceExpertBudget(request,budget,8192,{tokens:9800,costUsd:null})).toThrow("token budget exhausted");
});
test("unknown prices and unreported usage never become a fabricated zero cost",()=>{
  const request={messages:[{role:"user" as const,content:"hello"}]};
  const response={message:{role:"assistant" as const,content:"done"},toolCalls:[],finishReason:"stop" as const,model:"test"};
  const budget=parseExpertBudget({contextTokens:4096,maxOutputTokens:100,maxCostUsd:1})!;
  expect(()=>enforceExpertBudget(request,budget,4096,{tokens:0,costUsd:null})).toThrow("without explicit");
  expect(modelAccounting(request,response,budget)).toMatchObject({usageSource:"unreported",configuredCostUsd:null});
  expect(modelAccounting(request,{...response,usage:{inputTokens:12,outputTokens:3}},budget)).toMatchObject({usageSource:"provider",configuredCostUsd:null});
});
test("failed model calls consume reservations; reported usage replaces estimates",()=>{
  const budget=parseExpertBudget({contextTokens:4096,maxOutputTokens:100,prices:{inputUsdPerMillion:1,outputUsdPerMillion:2}})!;
  const request={messages:[{role:"user" as const,content:"hello"}],maxTokens:100};
  const event=(payload:unknown):StoredEvent=>({eventType:"run.invocation",metadata:{capability:"expert.model.generate"},payload:payload as StoredEvent["payload"],eventId:"test",streamId:"test",streamSequence:1,position:1,recordedAt:"2026-10-14T00:00:00Z",occurredAt:"2026-10-14T00:00:00Z",tenant:"local",correlationId:"test",causationId:null,runId:"test",scopeId:"test",schemaVersion:1});
  const prior=priorModelConsumption([event({input:{request},failure:{kind:"failed"}}),event({input:{request},result:{usage:{inputTokens:10,outputTokens:20}}})],budget);
  expect(prior.tokens).toBe(estimateRequestTokens(request)+100+30);
  expect(prior.costUsd).toBeGreaterThan(0);
  expect(()=>parseExpertBudget({contextTokens:1000,maxOutputTokens:100,prices:{inputUsdPerMillion:NaN,outputUsdPerMillion:2}})).toThrow("finite");
  const withoutOutputLimit={messages:request.messages};
  expect(priorModelConsumption([event({input:{request:withoutOutputLimit},failure:{kind:"failed"}})],budget).tokens).toBe(estimateRequestTokens({...withoutOutputLimit,maxTokens:100})+100);
});

test("J-CONTEXT-BUDGET rejects a real Expert invocation before provider dispatch and preserves required context",async()=>{
  await withExpertApp(async model=>({message:{role:"assistant",content:"should not execute"},toolCalls:[],finishReason:"stop",model:model.model}),async app=>{
    await configureDefaultRoutes(app);
    const expert=(await app.state()).experts.builder!;
    await invoke(app,"expert.save",{expertId:expert.id,name:expert.name,specialization:expert.definition.specialization,instructions:expert.definition.instructions,tools:["read"],route:expert.definition.route,budget:{contextTokens:1000,maxOutputTokens:100,totalTokens:1500}});
    const result=await invoke(app,"expert.converse",{expertId:"builder",workspaceId:app.workspaceId,message:"Pinned requirement: "+"essential input ".repeat(120)}) as {assignmentId:string};
    const assignment=await waitForAssignment(app,result.assignmentId,a=>a.status==="failed");
    expect(app.providerCalls).toHaveLength(0);
    expect(assignment.purpose).toContain("essential input");
    const failures:StoredEvent[]=[];
    for await(const event of app.app.runtime.service.events(LOCAL_OPERATOR,{runId:assignment.runId!}))if(event.eventType==="turn.failed")failures.push(event);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({code:"BUDGET_EXCEEDED"});
    expect(assignment.handoff?.failures.join(" ")).toContain("Context budget exceeded");
  });
},35_000);

test("J-CONTEXT-BUDGET freezes limits across Expert edits, clamps output and records observed usage in durable invocations",async()=>{
  let started!:()=>void;
  let release!:()=>void;
  const active=new Promise<void>(resolve=>{started=resolve;});
  const held=new Promise<void>(resolve=>{release=resolve;});
  const seen:ModelRequest[]=[];
  await withExpertApp(async(model,request)=>{seen.push(request);started();await held;return {message:{role:"assistant",content:"Observed result"},toolCalls:[],finishReason:"stop",model:model.model,usage:{inputTokens:127,outputTokens:23}};},async app=>{
    await configureDefaultRoutes(app);
    const expert=(await app.state()).experts.builder!;
    const save={expertId:expert.id,name:expert.name,specialization:expert.definition.specialization,instructions:expert.definition.instructions,tools:["read"],route:expert.definition.route};
    const budget={contextTokens:32000,maxOutputTokens:400,totalTokens:20000,prices:{inputUsdPerMillion:2,outputUsdPerMillion:4}};
    await invoke(app,"expert.save",{...save,budget});
    const result=await invoke(app,"expert.converse",{expertId:"builder",workspaceId:app.workspaceId,message:"Report an independently attributable observation."}) as {assignmentId:string};
    await active;
    await invoke(app,"expert.save",{...save,route:route("replacement-model"),budget:{contextTokens:1000,maxOutputTokens:1,totalTokens:1}});
    release();
    const assignment=await waitForAssignment(app,result.assignmentId,a=>!!a.handoff);
    expect(assignment.execution.budget).toEqual(budget);
    expect(seen[0]?.maxTokens).toBe(400);
    expect(app.providerCalls.map(call=>call.model)).toEqual(["builder-model"]);
    const receipts:StoredEvent[]=[];
    for await(const event of app.app.runtime.service.events(LOCAL_OPERATOR,{runId:assignment.runId!}))if(event.eventType==="run.invocation" && event.metadata?.capability==="expert.model.generate")receipts.push(event);
    expect(receipts).toHaveLength(1);
    expect((receipts[0]?.payload as any).result).toMatchObject({usage:{inputTokens:127,outputTokens:23},accounting:{usageSource:"provider",reservedOutputTokens:400,configuredCostUsd:0.000346}});
    await app.restart();
    expect((await app.state()).assignments[assignment.id]?.execution.budget).toEqual(budget);
  });
},45_000);

test("J-CONTEXT-BUDGET tokenizes with the route's model-specific tokenizer and labels the method",async()=>{
  const o200k=await tokenizerForRoute("gpt-4o-mini","openai-compatible");
  const cl100k=await tokenizerForRoute("gpt-4-turbo","openai-compatible");
  const approximate=await tokenizerForRoute("claude-3-5-sonnet","anthropic-messages");
  expect(o200k!.method).toBe("model-tokenizer:o200k_base");
  expect(cl100k!.method).toBe("model-tokenizer:cl100k_base");
  expect(approximate!.method).toBe("model-tokenizer:cl100k_base:approximate");
  const request={messages:[{role:"user" as const,content:"hello 世界"}]};
  const tokenized=estimateRequestTokens(request,o200k);
  const legacy=estimateRequestTokens(request);
  expect(tokenized).toBeLessThan(legacy);
  expect(tokenized).toBe(o200k!.count(JSON.stringify(request))+256);
  expect(estimateMethodOf(o200k)).toBe("model-tokenizer:o200k_base-with-envelope-margin");
  expect(estimateMethodOf(undefined)).toBe(LEGACY_ESTIMATE_METHOD);
  // CJK text: the legacy byte estimate undercounts real tokens; the tokenizer does not.
  expect(o200k!.count("你好世界，这是一个分词测试。")).toBeGreaterThan(6);
  expect(await tokenizerForRoute("","openai-compatible")).toBeUndefined();
});
