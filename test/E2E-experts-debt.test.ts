import { expect,test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { configureDefaultRoutes,invoke,waitForAssignment,withExpertApp } from "./expert-helpers.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { SchedulesService } from "../src/schedules/service.ts";
import { ScheduleEvaluator } from "../src/schedules/evaluator.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
const SYSTEM_CALLER={tenant:LOCAL_OPERATOR.tenant,actor:{id:"system",kind:"system" as const}};

test("native schedule controls and evidence usage work on desktop and mobile",async()=>{
  await withExpertApp(async model=>({message:{role:"assistant",content:"Scheduled evidence receipt."},toolCalls:[],finishReason:"stop",model:model.model,usage:{inputTokens:127,outputTokens:23}}),async app=>{
    await configureDefaultRoutes(app);
    await invoke(app,"onboarding.dismiss",{step:"notice"});await invoke(app,"onboarding.dismiss",{step:"apikey"});
    const expert=(await app.state()).experts.builder!;
    await invoke(app,"expert.save",{expertId:expert.id,name:expert.name,specialization:expert.definition.specialization,instructions:expert.definition.instructions,tools:["read"],route:expert.definition.route,budget:{contextTokens:32000,maxOutputTokens:400,prices:{inputUsdPerMillion:2,outputUsdPerMillion:4}}});
    const browser=await chromium.launch();
    const errors:string[]=[];
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      page.setDefaultTimeout(10000);
      page.on("pageerror",error=>errors.push(error.message));
      await page.goto(app.app.url,{waitUntil:"domcontentloaded"});
      await page.getByRole("button",{name:"Experts and Teams",exact:true}).click();
      await page.getByRole("button",{name:"Schedules",exact:true}).click();
      await page.getByRole("combobox",{name:/^Active expert/}).selectOption("builder");
      await page.getByLabel("Objective",{exact:true}).fill("Create the scheduled verification receipt.");
      await page.getByLabel("Recurrence",{exact:true}).selectOption("once");
      await page.getByLabel("Due instant (ISO with timezone)",{exact:true}).fill(new Date(Date.now()-500).toISOString());
      await page.getByRole("button",{name:"Save schedule",exact:true}).click();
      await page.getByText("Schedule saved. Native Expert work will begin only when its occurrence is due.",{exact:true}).waitFor();
      const schedules=new SchedulesService(new ExpertsService(app.app.runtime.service,SYSTEM_CALLER));
      const evaluator=new ScheduleEvaluator(schedules,schedules.experts);
      // The controlled test fixture disables its automatic loop. This invokes the same durable
      // evaluator used by production; separate subprocess tests prove autonomous restart delivery.
      await evaluator.evaluate();
      let occurrence=Object.values((await schedules.read(LOCAL_OPERATOR)).state.occurrences)[0]!;
      await waitForAssignment(app,occurrence.assignmentId!,assignment=>!!assignment.handoff);
      await evaluator.evaluate();
      await page.getByRole("button",{name:"Inspect occurrence",exact:true}).waitFor();
      const shots=join(import.meta.dir,"..","screenshots","experts-debt");await mkdir(shots,{recursive:true});
      await page.screenshot({path:join(shots,"schedule-receipt-desktop.png")});
      await page.getByRole("button",{name:"Inspect occurrence",exact:true}).click();
      await page.getByText("Scheduled evidence receipt.",{exact:true}).first().waitFor();
      await page.getByText("Model usage and budget",{exact:true}).click();
      await page.getByText("Provider-reported usage: 127 input / 23 output tokens.",{exact:true}).waitFor();
      await page.getByText("Cost at operator-configured prices: USD 0.000346.",{exact:true}).waitFor();
      await page.screenshot({path:join(shots,"assignment-usage-desktop.png")});
      const mobile=await browser.newPage({viewport:{width:360,height:780}});
      mobile.on("pageerror",error=>errors.push(error.message));
      await mobile.goto(app.app.url,{waitUntil:"domcontentloaded"});
      await mobile.getByRole("button",{name:"Expand sidebar",exact:true}).click();
      await mobile.getByRole("button",{name:"Experts and Teams",exact:true}).click();
      await mobile.getByRole("button",{name:"Schedules",exact:true}).click();
      await mobile.getByRole("button",{name:"Inspect occurrence",exact:true}).waitFor();
      expect(await mobile.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await mobile.getByRole("heading",{name:"Schedule history",exact:true}).scrollIntoViewIfNeeded();
      await mobile.screenshot({path:join(shots,"schedule-receipt-mobile.png")});
      expect(errors).toEqual([]);
    }finally{await browser.close();}
  });
},90_000);

test("a human live update is pending during inference and incorporated into the next Team decision",async()=>{
  let started!:()=>void,release!:()=>void;
  const began=new Promise<void>(resolve=>{started=resolve;});
  const held=new Promise<void>(resolve=>{release=resolve;});
  let calls=0,saw=false;
  await withExpertApp(async(model,request)=>{
    calls++;
    if(calls===1){started();await held;}
    else saw=request.messages.some(message=>message.content.includes("UNTRUSTED LIVE TEAM MESSAGES") && message.content.includes("Use the revised Q3 source"));
    return {message:{role:"assistant",content:calls===1 ? "Initial decision":"Applied the revised Q3 source."},toolCalls:[],finishReason:"stop",model:model.model};
  },async app=>{
    await configureDefaultRoutes(app);
    await invoke(app,"onboarding.dismiss",{step:"notice"});await invoke(app,"onboarding.dismiss",{step:"apikey"});
    const browser=await chromium.launch();
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
      await page.goto(app.app.url,{waitUntil:"domcontentloaded"});
      await page.getByRole("button",{name:"Experts and Teams",exact:true}).click();
      await page.getByRole("button",{name:"Open Team conversation",exact:true}).click();
      await page.getByLabel("Message the Team",{exact:true}).fill("Assess the initial Q3 input");
      await page.getByRole("button",{name:"Send message",exact:true}).click();
      await began;
      await page.getByLabel("Live update",{exact:true}).fill("Use the revised Q3 source");
      await page.getByRole("button",{name:"Send live update",exact:true}).click();
      await page.getByText("Use the revised Q3 source",{exact:true}).waitFor();
      expect((await page.locator(".experts-transcript").innerText())).toContain("pending");
      release();
      await page.getByText("Applied the revised Q3 source.",{exact:true}).first().waitFor();
      expect(saw).toBe(true);
      expect((await page.locator(".experts-transcript").innerText())).toContain("incorporated");
      await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('select[aria-label="Conversation history"]')?.selectedOptions[0]?.textContent?.includes("3 messages"));
      await page.screenshot({path:join(import.meta.dir,"..","screenshots","experts-debt","live-inbox-desktop.png")});
    }finally{release();await browser.close();}
  });
},60000);
