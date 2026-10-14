import { expect, test } from "bun:test";
import type { ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import { configureDefaultRoutes, invoke, route, waitForAssignment, withExpertApp } from "./expert-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

test("J-EXPERT-STEER / J-EXPERT-INBOX-RECOVER: a live Team message reaches the next model decision and has a stable boundary receipt", async () => {
  let started!: () => void;
  let release!: () => void;
  const modelStarted = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  let sawMessage = false;
  const responder = async (modelRoute: ReturnType<typeof route>, request: ModelRequest): Promise<ModelResponse> => {
    calls++;
    if (calls === 1) { started(); await hold; return { message:{role:"assistant",content:"checking"},toolCalls:[],finishReason:"stop",model:modelRoute.model }; }
    const batch=request.messages.find(message=>message.content.includes("UNTRUSTED LIVE TEAM MESSAGES"))?.content ?? "";
    sawMessage ||= batch.includes("Use the revised input: Q3") && batch.includes("Second ordered update") && batch.indexOf("Use the revised input: Q3")<batch.indexOf("Second ordered update");
    return { message:{role:"assistant",content:"The next decision incorporated the update."},toolCalls:[],finishReason:"stop",model:modelRoute.model };
  };
  await withExpertApp(responder, async app => {
    await configureDefaultRoutes(app,{productManager:route("pm-model")});
    const startedConversation=await invoke(app,"team.converse",{teamId:"cognate-team",workspaceId:app.workspaceId,message:"Review the initial input."}) as {conversationId:string;assignmentId:string};
    await modelStarted;
    const running=await waitForAssignment(app,startedConversation.assignmentId,a=>a.status==="running" && !!a.runId);
    const queued=await invoke(app,"team.inbox.send",{assignmentId:running.id,text:"Use the revised input: Q3."}) as {messageId:string;sequence:number;delivery:string};
    const duplicate=await invoke(app,"team.inbox.send",{requestId:"same-live-message-command",assignmentId:running.id,text:"Use the revised input: Q3."}) as {messageId:string;sequence:number;delivery:string};
    const replay=await invoke(app,"team.inbox.send",{requestId:"same-live-message-command",assignmentId:running.id,text:"Use the revised input: Q3."}) as {messageId:string;sequence:number;delivery:string};
    const second=await invoke(app,"team.inbox.send",{assignmentId:running.id,text:"Second ordered update."}) as {messageId:string;sequence:number;delivery:string};
    expect(queued.delivery).toBe("pending");
    expect(queued.sequence).toBeGreaterThan(0);
    expect(replay).toEqual(duplicate);
    expect(second.sequence).toBeGreaterThan(duplicate.sequence);
    release();
    await waitForAssignment(app,startedConversation.assignmentId,a=>!!a.handoff);
    expect(sawMessage, JSON.stringify(app.providerCalls.map(call=>call.messages))).toBe(true);
    const committed=await app.state();
    const message=committed.messages[queued.messageId]!;
    expect(message.inboxStatus).toBe("incorporated");
    expect(committed.messages[duplicate.messageId]?.inboxStatus).toBe("incorporated");
    expect(committed.messages[second.messageId]?.inboxStatus).toBe("incorporated");
    expect(message.incorporatedAtBoundary).toBe("after-decision:0");
    const receipt=Object.values(committed.inboxReceipts ?? {}).find(value=>value.messageIds.includes(queued.messageId));
    expect(receipt).toMatchObject({assignmentId:running.id,runId:running.runId,messageIds:[queued.messageId,duplicate.messageId,second.messageId]});
    await app.restart();
    const recovered=await app.state();
    expect(recovered.messages[queued.messageId]?.inboxStatus).toBe("incorporated");
    expect(Object.values(recovered.inboxReceipts ?? {}).filter(value=>value.messageIds.includes(queued.messageId))).toHaveLength(1);
  });
},45_000);

test("J-EXPERT-STEER: only a live same-Team Assignment accepts a human inbox update", async () => {
  let started!: () => void;
  let release!: () => void;
  const modelStarted = new Promise<void>(resolve=>{started=resolve;});
  const hold = new Promise<void>(resolve=>{release=resolve;});
  let sawInbound=false;
  await withExpertApp(async (modelRoute,request) => {started();await hold;sawInbound ||= request.messages.some(message=>message.content.includes("UNTRUSTED LIVE TEAM MESSAGES") && message.content.includes("Final update"));return {message:{role:"assistant",content:"done"},toolCalls:[],finishReason:"stop",model:modelRoute.model};}, async app => {
    await configureDefaultRoutes(app);
    const orchestrator=(await app.state()).experts["product-manager"]!;
    await invoke(app,"expert.save",{expertId:orchestrator.id,name:orchestrator.name,specialization:orchestrator.definition.specialization,instructions:orchestrator.definition.instructions,tools:orchestrator.definition.tools.filter(tool=>tool!=="team_message"),route:route("pm-model")});
    const team=(await app.state()).teams["cognate-team"]!;
    await invoke(app,"team.save",{teamId:team.id,name:team.name,tools:team.tools,limits:{...team.limits,maxUnread:1}});
    const conversation=await invoke(app,"team.converse",{teamId:"cognate-team",workspaceId:app.workspaceId,message:"Create an active recipient."}) as {assignmentId:string};
    await modelStarted;
    const assignment=await waitForAssignment(app,conversation.assignmentId,a=>a.status==="running" && !!a.runId);
    const sent=await invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"First update"}) as {messageId:string};
    const other={tenant:LOCAL_OPERATOR.tenant,actor:{id:"another-human",kind:"user" as const}};
    await expect(app.app.runtime.service.invoke(other,{capability:"team.inbox.send",input:{assignmentId:assignment.id,text:"Forged replacement",supersedesId:sent.messageId}})).rejects.toThrow("Only your pending message");
    await expect(app.app.runtime.service.invoke(other,{capability:"team.inbox.cancel",input:{messageId:sent.messageId}})).rejects.toThrow("Only the sender");
    const replacement=await invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"Replacement update",supersedesId:sent.messageId}) as {messageId:string};
    await expect(invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"Over the unread bound"})).rejects.toThrow("Unread message limit reached");
    await expect(invoke(app,"team.message",{assignmentId:assignment.id,recipientId:"builder",text:"Forged human sender"})).rejects.toThrow("Addressed messaging is not authorized");
    await expect(invoke(app,"team.inbox.send",{assignmentId:"stale-assignment",text:"Stale target"})).rejects.toThrow("Recipient Assignment is not accepting live messages");
    await invoke(app,"team.inbox.cancel",{messageId:replacement.messageId});
    const final=await invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"Final update"}) as {messageId:string};
    const state=await app.state();
    expect(state.messages[sent.messageId]?.inboxStatus).toBe("superseded");
    expect(state.messages[replacement.messageId]?.inboxStatus).toBe("cancelled");
    release();
    await waitForAssignment(app,conversation.assignmentId,a=>!!a.handoff);
    expect(sawInbound).toBe(true);
    expect((await app.state()).assignments[conversation.assignmentId]?.execution.tools).not.toContain("team_message");
    expect((await app.state()).messages[final.messageId]?.inboxStatus).toBe("incorporated");
  });
},45_000);

test("J-EXPERT-STEER: a permitted same-Team Expert can message a waiting Orchestrator without gaining authority", async () => {
  let parentReceived = false;
  const responder = async (modelRoute: ReturnType<typeof route>, request: ModelRequest): Promise<ModelResponse> => {
    if(modelRoute.model==="pm-model" && !request.messages.some(message=>message.role==="tool"))return {
      message:{role:"assistant",content:""},toolCalls:[{id:"delegate-child",name:"team_delegate",arguments:{expertId:"builder",purpose:"Check the updated inputs",acceptance:["Return findings"]}}],finishReason:"tool_calls",model:modelRoute.model,
    };
    if(modelRoute.model==="builder-model" && !request.messages.some(message=>message.role==="tool"))return {
      message:{role:"assistant",content:""},toolCalls:[{id:"message-parent",name:"team_message",arguments:{recipientId:"product-manager",text:"The input source has changed; re-evaluate Q3."}}],finishReason:"tool_calls",model:modelRoute.model,
    };
    if(modelRoute.model==="pm-model")parentReceived=request.messages.some(message=>message.content.includes("UNTRUSTED LIVE TEAM MESSAGES") && message.content.includes("re-evaluate Q3"));
    return {message:{role:"assistant",content:"Completed with the existing Assignment authority."},toolCalls:[],finishReason:"stop",model:modelRoute.model};
  };
  await withExpertApp(responder,async app=>{
    await configureDefaultRoutes(app,{productManager:route("pm-model"),builder:route("builder-model")});
    const builder= (await app.state()).experts.builder!;
    await invoke(app,"expert.save",{expertId:"builder",name:builder.name,specialization:builder.definition.specialization,instructions:builder.definition.instructions,tools:[...builder.definition.tools,"team_message"],route:route("builder-model")});
    const root=await invoke(app,"team.converse",{teamId:"cognate-team",workspaceId:app.workspaceId,message:"Ask the Builder to check Q3."}) as {assignmentId:string};
    await waitForAssignment(app,root.assignmentId,a=>!!a.handoff);
    expect(parentReceived).toBe(true);
    const state=await app.state();
    const sent=Object.values(state.messages).find(message=>message.text.includes("re-evaluate Q3"));
    expect(sent).toMatchObject({sender:{kind:"expert",id:"builder"},recipientId:"product-manager",inboxStatus:"incorporated"});
    expect(state.inboxReceipts && Object.values(state.inboxReceipts).some(receipt=>receipt.assignmentId===root.assignmentId && receipt.messageIds.includes(sent!.id))).toBe(true);
    expect(state.assignments[root.assignmentId]?.execution.tools).toEqual(["read","team_delegate","team_message","expert_memory_read","expert_memory_write","expert_return"]);
  });
},45_000);

test("J-EXPERT-STEER: a message arriving on the final allowed decision is recorded late, not as incorporated", async () => {
  let started!: () => void;
  let release!: () => void;
  const modelStarted=new Promise<void>(resolve=>{started=resolve;});
  const hold=new Promise<void>(resolve=>{release=resolve;});
  await withExpertApp(async modelRoute=>{started();await hold;return {message:{role:"assistant",content:"final answer"},toolCalls:[],finishReason:"stop",model:modelRoute.model};},async app=>{
    await configureDefaultRoutes(app);
    const pm=(await app.state()).experts["product-manager"]!;
    await invoke(app,"expert.save",{expertId:pm.id,name:pm.name,specialization:pm.definition.specialization,instructions:pm.definition.instructions,tools:pm.definition.tools,maxSteps:1,route:route("pm-model")});
    const conversation=await invoke(app,"team.converse",{teamId:"cognate-team",workspaceId:app.workspaceId,message:"One-decision objective."}) as {assignmentId:string};
    await modelStarted;
    const assignment=await waitForAssignment(app,conversation.assignmentId,item=>item.status==="running" && !!item.runId);
    const sent=await invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"This arrived too late to incorporate."}) as {messageId:string};
    release();
    await waitForAssignment(app,assignment.id,item=>!!item.handoff);
    const state=await app.state();
    expect(app.providerCalls).toHaveLength(1);
    expect(state.messages[sent.messageId]).toMatchObject({inboxStatus:"late",terminalAtBoundary:"after-decision:0"});
    expect(state.messages[sent.messageId]?.incorporatedAtBoundary).toBeUndefined();
    expect(Object.values(state.inboxReceipts ?? {}).some(receipt=>receipt.lateMessageIds?.includes(sent.messageId))).toBe(true);
    await expect(invoke(app,"team.inbox.send",{assignmentId:assignment.id,text:"Closed inbox"})).rejects.toThrow("not accepting live messages");
  });
},45_000);
