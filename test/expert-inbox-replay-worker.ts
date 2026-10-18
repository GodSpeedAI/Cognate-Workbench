import { appendFile, writeFile } from "node:fs/promises";
import type { ModelRequest } from "@godspeedai/cognate-capabilities";
import type { ModelConfig } from "../src/components/providerRegistry.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { startServer } from "../src/server.ts";

const home=process.env.EXPERT_INBOX_HOME;
const portFile=process.env.EXPERT_INBOX_PORT_FILE;
const modelStartedFile=process.env.EXPERT_INBOX_MODEL_STARTED_FILE;
const modelReleaseFile=process.env.EXPERT_INBOX_MODEL_RELEASE_FILE;
const consumeMarkerFile=process.env.EXPERT_INBOX_CONSUME_MARKER_FILE;
const consumeReleaseFile=process.env.EXPERT_INBOX_CONSUME_RELEASE_FILE;
const observedFile=process.env.EXPERT_INBOX_OBSERVED_FILE;
if(!home || !portFile || !modelStartedFile || !modelReleaseFile || !consumeMarkerFile || !consumeReleaseFile || !observedFile)throw new Error("Expert inbox replay worker environment is incomplete");

const original=ExpertsService.prototype.command;
ExpertsService.prototype.command=async function(capability,input,ctx){
  const result=await original.call(this,capability,input,ctx);
  const delivery=result as {messages?:readonly unknown[]}|undefined;
  if(capability==="team.inbox.consume" && delivery?.messages?.length && !(await Bun.file(consumeReleaseFile).exists())){
    await writeFile(consumeMarkerFile,"shared-state consume committed; invocation response not returned","utf8");
    await new Promise<void>(()=>{});
  }
  return result;
};

let modelCalls=0;
const server=await startServer({
    devAuth: true,
  port:0,
  home,
  expertProviderFactory(route:ModelConfig){
    return {
      id:route.providerId,
      model:route.model,
      features:{generate:true,stream:false,tool_use:true,structured_output:false,multimodal_input:false,context_limit:32_000},
      async generate(request:ModelRequest){
        modelCalls++;
        if(request.messages.some(message=>JSON.stringify(message.content).includes("Use replayed Q4 assumptions."))){
          await appendFile(observedFile,`${JSON.stringify(request.messages)}\n`,"utf8");
        }
        if(modelCalls===1){
          await writeFile(modelStartedFile,"provider request started","utf8");
          while(!(await Bun.file(modelReleaseFile).exists()))await Bun.sleep(15);
          return {message:{role:"assistant",content:"First model decision is complete."},toolCalls:[],finishReason:"stop",model:route.model};
        }
        return {message:{role:"assistant",content:"Recovered after inbox consume replay."},toolCalls:[],finishReason:"stop",model:route.model};
      },
      async *stream() {},
    };
  },
});
await writeFile(portFile,new URL(server.url).port,"utf8");
await new Promise<void>(()=>{});
