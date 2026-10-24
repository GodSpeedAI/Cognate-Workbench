import type { ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { ENVELOPE_MARGIN_TOKENS, legacyByteCount, type ModelTokenizer } from "./tokenizer.ts";

/** Per-assignment-attempt limits, frozen with the route. Prices are explicit operator estimates. */
export interface ExpertModelBudget {
  contextTokens: number;
  maxOutputTokens: number;
  totalTokens?: number;
  maxCostUsd?: number;
  prices?: {inputUsdPerMillion:number;outputUsdPerMillion:number};
}
export interface ModelAccounting {
  inputEstimate: number;
  reservedOutputTokens: number | null;
  /** Names the accounting method actually used: a model-specific tokenizer encoding, or the
   * legacy conservative UTF-8 byte estimate when no model tokenizer resolved. */
  estimateMethod: string;
  usageSource: "provider" | "unreported";
  configuredCostUsd: number | null;
}
export const LEGACY_ESTIMATE_METHOD = "utf8-visible-request-with-envelope-margin";
export class ModelBudgetError extends Error {
  override readonly name="ModelBudgetError";
  readonly kind="budget_exceeded";
}

export function parseExpertBudget(raw:unknown):ExpertModelBudget|undefined {
  if(raw===undefined || raw===null)return undefined;
  if(typeof raw!=="object" || Array.isArray(raw))throw new Error("Model budget must be an object");
  const input=raw as Record<string,unknown>;
  if(Object.keys(input).some(key=>!["contextTokens","maxOutputTokens","totalTokens","maxCostUsd","prices"].includes(key)))throw new Error("Unknown model budget field");
  const integer=(value:unknown,min:number,max:number,name:string)=>{
    if(!Number.isSafeInteger(value) || Number(value)<min || Number(value)>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return Number(value);
  };
  const nonnegative=(value:unknown,name:string)=>{
    if(typeof value!=="number" || !Number.isFinite(value) || value<0 || value>1_000_000)throw new Error(`${name} must be a finite nonnegative number`);
    return value;
  };
  const budget:ExpertModelBudget={contextTokens:integer(input.contextTokens,256,2_000_000,"Context token limit"),maxOutputTokens:integer(input.maxOutputTokens,1,64_000,"Output token reserve")};
  if(budget.maxOutputTokens>=budget.contextTokens)throw new Error("Output reserve must leave room for input context");
  if(input.totalTokens!==undefined)budget.totalTokens=integer(input.totalTokens,1,100_000_000,"Attempt token budget");
  if(input.maxCostUsd!==undefined)budget.maxCostUsd=nonnegative(input.maxCostUsd,"Attempt cost budget");
  if(input.prices!==undefined){
    if(!input.prices || typeof input.prices!=="object" || Array.isArray(input.prices))throw new Error("Prices must be an object");
    const prices=input.prices as Record<string,unknown>;
    if(Object.keys(prices).some(key=>!["inputUsdPerMillion","outputUsdPerMillion"].includes(key)))throw new Error("Unknown price field");
    budget.prices={inputUsdPerMillion:nonnegative(prices.inputUsdPerMillion,"Input price"),outputUsdPerMillion:nonnegative(prices.outputUsdPerMillion,"Output price")};
  }
  return budget;
}

/** This is an estimate of the complete visible request, not a provider tokenizer receipt. With a
 * resolved model tokenizer the visible payload is counted under that encoding plus an explicit
 * envelope margin; without one the conservative legacy UTF-8 byte count applies. Either way the
 * accounting method is labeled, and provider-added hidden framing remains unmeasured. */
export function estimateRequestTokens(request:ModelRequest,tokenizer?:ModelTokenizer):number {
  const serialized=JSON.stringify(request);
  return (tokenizer ? tokenizer.count(serialized)+ENVELOPE_MARGIN_TOKENS : legacyByteCount(serialized)+ENVELOPE_MARGIN_TOKENS);
}
export function estimateMethodOf(tokenizer?:ModelTokenizer):string {
  return tokenizer ? `${tokenizer.method}-with-envelope-margin` : LEGACY_ESTIMATE_METHOD;
}
function reportedUsage(response:ModelResponse):boolean {
  return !!response.usage && Number.isSafeInteger(response.usage.inputTokens) && response.usage.inputTokens>=0 && Number.isSafeInteger(response.usage.outputTokens) && response.usage.outputTokens>=0;
}
export function configuredCost(input:number,output:number,budget:ExpertModelBudget|undefined):number|null {
  return budget?.prices ? (input*budget.prices.inputUsdPerMillion+output*budget.prices.outputUsdPerMillion)/1_000_000 : null;
}

/** Failed/unknown generations retain their full conservative reservation. Successful reported
 * usage releases that reservation to the observed amount. Recorded invocations are unique steps. */
export function priorModelConsumption(events:readonly StoredEvent[],budget:ExpertModelBudget,tokenizer?:ModelTokenizer):{tokens:number;costUsd:number|null} {
  let tokens=0;
  let costUsd:number|null=budget.prices ? 0:null;
  for(const event of events){
    if(event.eventType!=="run.invocation" || event.metadata?.capability!=="expert.model.generate")continue;
    if(event.erasure)throw new ModelBudgetError("Prior model usage was erased; the remaining budget cannot be established safely");
    const payload=event.payload as {input?:{request?:ModelRequest};result?:ModelResponse};
    const request=payload?.input?.request;
    if(!request)throw new ModelBudgetError("Cannot establish prior model consumption; inspection is required");
    const usage=payload.result && reportedUsage(payload.result) ? payload.result.usage:undefined;
    const limited={...request,maxTokens:Math.min(request.maxTokens ?? budget.maxOutputTokens,budget.maxOutputTokens)};
    const input=usage?.inputTokens ?? estimateRequestTokens(limited,tokenizer);
    const output=usage?.outputTokens ?? budget.maxOutputTokens;
    tokens+=input+output;
    if(costUsd!==null)costUsd+=configuredCost(input,output,budget)!;
  }
  return {tokens,costUsd};
}

export function enforceExpertBudget(request:ModelRequest,budget:ExpertModelBudget,providerContextLimit:number,prior:{tokens:number;costUsd:number|null},tokenizer?:ModelTokenizer):ModelRequest {
  const limited={...request,maxTokens:Math.min(request.maxTokens ?? budget.maxOutputTokens,budget.maxOutputTokens)};
  if(!Number.isSafeInteger(limited.maxTokens) || limited.maxTokens<1)throw new ModelBudgetError("Invalid model output limit");
  const input=estimateRequestTokens(limited,tokenizer);
  const contextLimit=Number.isFinite(providerContextLimit) && providerContextLimit>0 ? Math.min(providerContextLimit,budget.contextTokens):budget.contextTokens;
  if(input+limited.maxTokens>contextLimit)throw new ModelBudgetError(`Context budget exceeded: model-specific estimate ${input} plus ${limited.maxTokens} reserved output exceeds ${contextLimit} tokens (${estimateMethodOf(tokenizer)}). Required context was retained; shorten the task or increase the limit.`);
  if(budget.totalTokens!==undefined && prior.tokens+input+limited.maxTokens>budget.totalTokens)throw new ModelBudgetError("Assignment attempt token budget exhausted before model invocation");
  if(budget.maxCostUsd!==undefined){
    const reservation=configuredCost(input,limited.maxTokens,budget);
    if(reservation===null || prior.costUsd===null)throw new ModelBudgetError("Cost budget cannot be enforced without explicit input and output prices");
    if(prior.costUsd+reservation>budget.maxCostUsd)throw new ModelBudgetError("Assignment attempt cost budget exhausted before model invocation");
  }
  return limited;
}

export function modelAccounting(request:ModelRequest,response:ModelResponse,budget?:ExpertModelBudget,tokenizer?:ModelTokenizer):ModelAccounting {
  const usage=reportedUsage(response) ? response.usage:undefined;
  return {inputEstimate:estimateRequestTokens(request,tokenizer),reservedOutputTokens:request.maxTokens ?? null,estimateMethod:estimateMethodOf(tokenizer),usageSource:usage ? "provider":"unreported",configuredCostUsd:usage ? configuredCost(usage.inputTokens,usage.outputTokens,budget):null};
}
