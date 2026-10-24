import { useCallback,useEffect,useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import type { Expert,Team } from "../../experts/types.ts";
import type { NativeSchedule,ScheduleOccurrence } from "../../schedules/types.ts";
import { SchedulesPanel } from "./SchedulesPanel.tsx";

/** Refreshing this optional read view never drives scheduled execution. */
export function SchedulesSurface({experts,teams,workspaceId,onInspect}:{readonly experts:readonly Expert[];readonly teams:readonly Team[];readonly workspaceId:string|undefined;readonly onInspect?:(occurrence:ScheduleOccurrence)=>void}){
  const client=useCognate();
  const [view,setView]=useState<{schedules:NativeSchedule[];occurrences:ScheduleOccurrence[];evaluator?:{running:boolean;error:string|null;mode:"single-process"}}>({schedules:[],occurrences:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string>();
  const refresh=useCallback(async()=>{
    const result=await client.invoke("schedule.list",{}) as unknown as typeof view;
    if(!result || !Array.isArray(result.schedules) || !Array.isArray(result.occurrences))throw new Error("Schedule history is unavailable");
    return result;
  },[client]);
  useEffect(()=>{
    let closed=false,pending=false;
    const poll=async()=>{
      if(pending)return;
      pending=true;
      try{const result=await refresh();if(!closed){setView(result);setError(undefined);}}
      catch(failure){if(!closed)setError(failure instanceof Error ? failure.message:String(failure));}
      finally{pending=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),2000);
    return()=>{closed=true;clearInterval(timer);};
  },[refresh]);
  const command=async(capability:"schedule.save"|"schedule.manage",input:Record<string,unknown>)=>{
    setBusy(true);
    try{const result=await client.invoke(capability,input as never);setView(await refresh());return result;}
    finally{setBusy(false);}
  };
  return <>{error && <p role="alert">{error}</p>}<SchedulesPanel {...view} experts={experts} teams={teams} workspaceId={workspaceId} busy={busy} onCommand={command} onInspect={onInspect} /></>;
}
