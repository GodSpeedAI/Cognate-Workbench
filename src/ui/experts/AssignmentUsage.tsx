import { useEffect,useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import type { ModelResponse } from "@godspeedai/cognate-capabilities";
import type { ModelAccounting } from "../../experts/economics.ts";
import type { Assignment } from "../../experts/types.ts";

type UsageRow={id:string;model:string;usage:ModelResponse["usage"];accounting:ModelAccounting|undefined};
export function AssignmentUsage({assignment}:{readonly assignment:Assignment}){
  const client=useCognate();
  const [open,setOpen]=useState(false);
  const [rows,setRows]=useState<UsageRow[]>([]);
  useEffect(()=>{
    setRows([]);
    if(!open || !assignment.runId)return;
    const results=new Map<string,UsageRow>();
    return client.subscribe({runId:assignment.runId},event=>{
      if(event.eventType!=="run.invocation" || !["model.generate","expert.model.generate"].includes(String(event.metadata?.capability)))return;
      const response=(event.payload as {result?:ModelResponse & {accounting?:ModelAccounting}})?.result;
      if(!response)return;
      results.set(event.eventId,{id:event.eventId,model:response.model,usage:response.usage,accounting:response.accounting});
      setRows([...results.values()]);
    });
  },[client,assignment.runId,open]);
  const budget=assignment.execution.budget;
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Model usage and budget</summary>
    <p>{budget ? `Frozen attempt limits: context ${budget.contextTokens}; output ${budget.maxOutputTokens}${budget.totalTokens ? `; total ${budget.totalTokens}`:""}${budget.maxCostUsd!==undefined ? `; cost USD ${budget.maxCostUsd}`:""}.`:"No token or cost ceiling configured for this Assignment attempt."}</p>
    {rows.length===0 ? <p>No model usage has been reported.</p>:<ol>{rows.map(row=><li key={row.id}><strong>{row.model}</strong>
      <p>{row.usage && Number.isSafeInteger(row.usage.inputTokens) && row.usage.inputTokens>=0 && Number.isSafeInteger(row.usage.outputTokens) && row.usage.outputTokens>=0 ? `Provider-reported usage: ${row.usage.inputTokens} input / ${row.usage.outputTokens} output tokens.`:"Provider token usage is unreported or invalid."}</p>
      {row.accounting && <p>Conservative visible-input estimate: {row.accounting.inputEstimate} tokens. Output reserve: {row.accounting.reservedOutputTokens ?? "unknown"}. Provider-added framing is unmeasured.</p>}
      <p>{row.accounting?.configuredCostUsd!==null && row.accounting?.configuredCostUsd!==undefined ? `Cost at operator-configured prices: USD ${row.accounting.configuredCostUsd.toFixed(6)}.`:"Cost unknown: reported usage and explicit prices are required."}</p>
    </li>)}</ol>}
  </details>;
}
