import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { readExperts } from "../src/experts/state.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { ExpertState } from "../src/experts/types.ts";
import { route } from "./expert-helpers.ts";

test("J-EXPERT-INBOX-RECOVER: SIGKILL after registry CAS replays one identical batch into the next decision",async()=>{
  const home=await mkdtemp(join(tmpdir(),"cognate-expert-inbox-replay-"));
  const portFile=join(home,"server.port"),modelStartedFile=join(home,"model.started"),modelReleaseFile=join(home,"model.release");
  const consumeMarkerFile=join(home,"consume.committed"),consumeReleaseFile=join(home,"consume.release"),observedFile=join(home,"next-model-messages.json");
  const workspace=join(home,"workspace");await mkdir(workspace,{recursive:true});
  const worker=join(process.cwd(),"test","expert-inbox-replay-worker.ts");
  let processHandle:ReturnType<typeof Bun.spawn>|undefined;
  let client:ReturnType<typeof createClient>|undefined;
  let service:ReturnType<typeof createRemoteRuntimeService>|undefined;
  const boot=async()=>{
    await rm(portFile,{force:true});
    processHandle=Bun.spawn([process.execPath,worker],{env:{...process.env,EXPERT_INBOX_HOME:home,EXPERT_INBOX_PORT_FILE:portFile,EXPERT_INBOX_MODEL_STARTED_FILE:modelStartedFile,EXPERT_INBOX_MODEL_RELEASE_FILE:modelReleaseFile,EXPERT_INBOX_CONSUME_MARKER_FILE:consumeMarkerFile,EXPERT_INBOX_CONSUME_RELEASE_FILE:consumeReleaseFile,EXPERT_INBOX_OBSERVED_FILE:observedFile},stdout:"ignore",stderr:"inherit"});
    const deadline=Date.now()+20_000;
    while(Date.now()<deadline && !(await Bun.file(portFile).exists())){if(processHandle.exitCode!==null)throw new Error(`inbox worker exited during startup: ${processHandle.exitCode}`);await Bun.sleep(20);}
    if(!(await Bun.file(portFile).exists()))throw new Error("inbox worker did not publish its port");
    const port=(await readFile(portFile,"utf8")).trim();service=createRemoteRuntimeService(connectTransport(`http://127.0.0.1:${port}`),()=>devToken(LOCAL_OPERATOR));client=createClient({service,caller:LOCAL_OPERATOR});
  };
  const call=async(capability:string,input:unknown)=>client!.invoke(capability,input as never);
  const readState=async():Promise<ExpertState>=> (await readExperts(service!,LOCAL_OPERATOR)).state;
  const waitFor=async<T>(action:()=>Promise<T>,predicate:(value:T)=>boolean,label:string,timeoutMs=30_000):Promise<T>=>{
    const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const value=await action();if(predicate(value))return value;await Bun.sleep(20);}throw new Error(`timed out waiting for ${label}`);
  };
  try{
    await boot();
    const selected=await call("workspace.select",{path:workspace}) as {workspaceId:string};
    const seeded=await waitFor(readState,state=>!!state.experts["product-manager"],"seeded Experts");
    const pm=seeded.experts["product-manager"]!;
    await call("expert.save",{expertId:pm.id,name:pm.name,specialization:pm.definition.specialization,instructions:pm.definition.instructions,tools:pm.definition.tools,route:route("pm-model")});
    const started=await call("team.converse",{teamId:"cognate-team",workspaceId:selected.workspaceId,message:"Review the active input.",requestId:"inbox-replay-root"}) as {conversationId:string;assignmentId:string};
    await waitFor(()=>Bun.file(modelStartedFile).exists(),Boolean,"first provider request");
    const running=await waitFor(readState,state=>!!state.assignments[started.assignmentId]?.runId && state.assignments[started.assignmentId]?.status==="running","active recipient run");
    const assignment=running.assignments[started.assignmentId]!;
    const sent=await call("team.inbox.send",{assignmentId:assignment.id,text:"Use replayed Q4 assumptions.",requestId:"live-inbox-replay-message"}) as {messageId:string};
    await writeFile(modelReleaseFile,"release first provider response","utf8");
    await waitFor(()=>Bun.file(consumeMarkerFile).exists(),Boolean,"post-CAS consume hook");
    const committed=await readState();
    expect(committed.messages[sent.messageId]?.inboxStatus).toBe("incorporated");
    expect(Object.values(committed.inboxReceipts ?? {}).filter(receipt=>receipt.messageIds.includes(sent.messageId))).toHaveLength(1);

    // The test-only worker hook has committed the CAS and is suspended before the capability
    // returns to Cognate. Kill Workbench, retain PostgreSQL/pg0 and the original run identity.
    processHandle!.kill(9);await processHandle!.exited;await client?.close();client=undefined;
    await writeFile(consumeReleaseFile,"allow replay to return the stored receipt","utf8");
    await boot();
    const recovered=await waitFor(readState,state=>!!state.assignments[assignment.id]?.handoff,"replayed next decision and handoff",45_000);
    const observed=(await readFile(observedFile,"utf8")).trim().split("\n").map(line=>JSON.parse(line) as {content?:string}[]);
    expect(observed).toHaveLength(1);
    const serialized=JSON.stringify(observed[0]);
    expect(serialized.match(/Use replayed Q4 assumptions\./g)).toHaveLength(1);
    expect(recovered.assignments[assignment.id]?.runId).toBe(assignment.runId);
    expect(recovered.messages[sent.messageId]?.inboxStatus).toBe("incorporated");
    expect(Object.values(recovered.inboxReceipts ?? {}).filter(receipt=>receipt.messageIds.includes(sent.messageId))).toHaveLength(1);
  }finally{
    await client?.close().catch(()=>{});
    if(processHandle && processHandle.exitCode===null){processHandle.kill(9);await processHandle.exited;}
    await rm(home,{recursive:true,force:true});
  }
},90_000);
