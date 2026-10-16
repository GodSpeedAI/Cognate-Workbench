import { fingerprint as nativeFingerprint, type Json } from "@godspeedai/cognate-events";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import { EXPERTS_THREAD, EXPERT_TOOLS, emptyExpertState, type ExpertState, type Team, type ExpertTool } from "./types.ts";
import { isExpertStateManifest, prepareExpertManifest, prepareExpertManifestUpdate, privateConversationIds, restoreExpertManifest, restoreExpertSectionEntries, stateSections, type ExpertStateManifest } from "./persistence.ts";

export type ExpertRootRead =
  | { kind: "empty"; version: 0 }
  | { kind: "legacy"; state: ExpertState; version: number }
  | { kind: "manifest"; manifest: ExpertStateManifest; version: number };

/** Read only the global root. No partition is restored; scoped readers verify exactly the
 * partitions they touch against this accepted root, so erased or aliased sources fail closed. */
export async function readExpertRoot(service: RuntimeService, caller: Caller): Promise<ExpertRootRead> {
  const result = await service.readSharedState(caller,{threadId:EXPERTS_THREAD});
  if (result.version === 0) return {kind:"empty",version:0};
  const raw = result.state as Partial<ExpertState> & {schema?: number};
  if (raw.schema === 1) return {kind:"legacy",state:raw as ExpertState,version:result.version};
  if (isExpertStateManifest(result.state)) return {kind:"manifest",manifest:result.state,version:result.version};
  throw new Error("Unsupported Experts state schema; an explicit versioned migration is required");
}

export const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
export const fingerprint = (value: unknown) => nativeFingerprint(json(value));
export function text(value: unknown, field: string, max = 20000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must contain 1–${max} characters`);
  if (/id$/i.test(field) && ["__proto__","constructor","prototype"].includes(value.trim()))throw new Error("Reserved identity");
  return value.trim();
}
export function tools(value: unknown): ExpertTool[] {
  if (!Array.isArray(value) || value.some(v => !EXPERT_TOOLS.includes(v))) throw new Error("Unknown Expert tool capability");
  return [...new Set(value)] as ExpertTool[];
}
export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Limit must be between ${min} and ${max}`);
  return Number(value);
}
export function assertTeamInvariant(state: ExpertState, team: Team): void {
  const count = team.members.filter(m => m.role === "orchestrator").length;
  if (count > 1) throw new Error("A Team may have only one Orchestrator");
  if (team.lifecycle === "active" && count !== 1) throw new Error("An active Team requires exactly one Orchestrator");
  if (new Set(team.members.map(m => m.expertId)).size !== team.members.length) throw new Error("Duplicate Team membership");
  for (const member of team.members) {
    if (state.experts[member.expertId]?.lifecycle !== "active") throw new Error("Team members must be active Experts");
  }
}

const PROFILES = [
  ["product-manager", "Product Manager", "Interpret objectives, current and desired states, constraints and acceptance criteria. Reduce the search space. Choose necessary Specialists, create bounded payable assignments with acceptance criteria, coordinate dependencies, track blockers and evidence, reconcile findings. Do not invoke every Specialist automatically. Escalate approval needs to the human. Propose completion only when settlement criteria have evidence. Never accept your own results or elevate authority."],
  ["builder", "Builder", "Implement focused code and artifacts following existing contracts. Report assumptions, limitations, tests and incomplete work. An attempted change is not a verified outcome. Return artifacts and observable evidence."],
  ["critic", "Critic", "Challenge assumptions, plans and completed work. Find contradictions, counterexamples, failure modes, security concerns and architectural debt. Report actionable, testable disagreements; never silently reconcile contradictions."],
  ["verifier", "Verifier", "Independently test claims against observable behavior, requirements and regression/recovery contracts. Distinguish passed, failed, untested and blocked. Preserve machine-readable receipts using artifacts and recorded tool results. A remembered claim is not demonstrated capability."],
  ["reviewer", "Reviewer", "Review implementation, critique and verification evidence together. Identify omitted tests, contradictions, false assurances and architectural inconsistencies. Recommend acceptance, revision or escalation with rationale. Never self-authorize human settlement."],
] as const;

export function seedExperts(state: ExpertState): void {
  // Seed once, including deliberate user removals/archives. No restart overwrites customization.
  if (state.receipts["seed:v1"]) return;
  for (const [id, name, instructions] of PROFILES) {
    state.experts[id] ??= {
      id, name, lifecycle: "active",
      definition: {id:`definition:${id}`,specialization:name,instructions,route:null,
        tools: id === "product-manager" ? ["read","team_delegate","team_message","expert_memory_read","expert_memory_write","expert_return"]
          : id === "builder" ? ["read","edit","bash","expert_memory_read","expert_memory_write","expert_return"]
          : ["read","bash","expert_memory_read","expert_memory_write","expert_return"],
        contextBudget:16000,maxSteps:12},
    };
  }
  state.teams["cognate-team"] ??= {
    id:"cognate-team",name:"Cognate Team",lifecycle:"active",tools:[...EXPERT_TOOLS],
    members:PROFILES.map(([expertId]) => ({expertId,role:expertId === "product-manager" ? "orchestrator" : "specialist",tools:[...EXPERT_TOOLS]})),
    limits:{maxDepth:2,maxAssignments:12,maxUnread:20,maxRounds:8,maxConcurrentRuns:2,admissionBatch:1},
  };
  state.receipts["seed:v1"] = {fingerprint:"seed:v1",result:{ok:true}};
}

export async function readExperts(service: RuntimeService, caller: Caller): Promise<{state: ExpertState; version: number}> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const root = await readExpertRoot(service,caller);
    if (root.kind === "empty") return {state:emptyExpertState(),version:0};
    if (root.kind === "legacy") {
      const manifest = await prepareExpertManifest(service,caller,root.state);
      try {
        const migrated = await service.updateSharedState(caller,{
          threadId:EXPERTS_THREAD,
          update:{snapshot:json(manifest)},
          expectedVersion:root.version,
          idempotencyKey:`expert-state-migration:${root.version}:${fingerprint(manifest)}`,
        });
        return {state:root.state,version:migrated.version};
      } catch (error) {
        if (!(error instanceof ServiceError) || !["failed_precondition","unavailable"].includes(error.code)) throw error;
        continue;
      }
    }
    return {state:await restoreExpertManifest(service,caller,root.manifest),version:root.version};
  }
  throw new Error("Experts are busy; retry the state migration");
}

/** Scoped read: restore only the named sections from the accepted root. Empty and legacy roots
 * fall back to the full read; manifest roots never touch an unrequested section's partitions. */
export async function readExpertsScope(service: RuntimeService, caller: Caller, sections: readonly string[]): Promise<{state: Partial<ExpertState>; version: number; manifest: ExpertStateManifest | undefined}> {
  const root = await readExpertRoot(service,caller);
  if (root.kind !== "manifest") {
    const full = await readExperts(service,caller);
    const state: Partial<ExpertState> = {};
    for (const section of sections) (state as unknown as Record<string, unknown>)[section] = (full.state as unknown as Record<string, unknown>)[section];
    return {state,version:full.version,manifest:undefined};
  }
  const state: Partial<ExpertState> = {};
  for (const section of sections) {
    const entries = await restoreExpertSectionEntries(service,caller,root.manifest,section);
    if (section === "audit") state.audit = entries.map(([,value]) => value as NonNullable<ExpertState["audit"]>[number]);
    else (state as unknown as Record<string, unknown>)[section] = Object.fromEntries(entries);
  }
  return {state,version:root.version,manifest:root.manifest};
}

/** Re-read AND revalidate the intent after every conflict. Logical receipts live in the aggregate,
 * so idempotency does not depend on reusing a CAS fingerprint with a different version. Unchanged
 * sections are carried forward by verified content address instead of being re-serialized. */
export async function mutateExperts<T>(service: RuntimeService, caller: Caller, commandId: string, command: unknown, mutate: (state: ExpertState) => T): Promise<T> {
  const digest = fingerprint(command);
  for (let attempt = 0; attempt < 30; attempt++) {
    const root = await readExpertRoot(service,caller);
    let state: ExpertState;
    let version: number;
    let previous: ExpertStateManifest | undefined;
    if (root.kind === "empty") {
      state = emptyExpertState();
      version = 0;
    } else if (root.kind === "legacy") {
      const manifest = await prepareExpertManifest(service,caller,root.state);
      let migrated;
      try {
        migrated = await service.updateSharedState(caller,{
          threadId:EXPERTS_THREAD,
          update:{snapshot:json(manifest)},
          expectedVersion:root.version,
          idempotencyKey:`expert-state-migration:${root.version}:${fingerprint(manifest)}`,
        });
      } catch (error) {
        if (!(error instanceof ServiceError) || !["failed_precondition","unavailable"].includes(error.code)) throw error;
        continue;
      }
      state = root.state;
      version = migrated.version;
      previous = manifest;
    } else {
      state = await restoreExpertManifest(service,caller,root.manifest);
      version = root.version;
      previous = root.manifest;
    }
    const receipt = state.receipts[commandId];
    if (receipt) {
      if (receipt.fingerprint !== digest) throw new Error("Idempotency identity was reused for different work");
      return receipt.result as T;
    }
    const result = mutate(state);
    for (const team of Object.values(state.teams)) assertTeamInvariant(state,team);
    state.receipts[commandId] = {fingerprint:digest,result:result ?? null};
    try {
      const sections = stateSections(state);
      const manifest = await prepareExpertManifestUpdate(service,caller,{manifest:previous},sections,privateConversationIds(state));
      await service.updateSharedState(caller,{threadId:EXPERTS_THREAD,update:{snapshot:json(manifest)},expectedVersion:version,idempotencyKey:`${commandId}:${version}:${digest}:${fingerprint(manifest)}`});
      return result;
    } catch (error) {
      if (!(error instanceof ServiceError) || !["failed_precondition","unavailable"].includes(error.code)) throw error;
    }
  }
  throw new Error("Experts are busy; retry this operation");
}

/** Public roster/conversation projection omits private conversation content and ALL memory.
 * The human operator can read private scopes through explicitly authorized capabilities. */
export function publicExperts(state: ExpertState): ExpertState {
  const view = structuredClone(state);
  view.memory = {}; view.receipts = {}; view.audit = [];
  for (const [id, conversation] of Object.entries(view.conversations)) {
    if (conversation.scope !== "private-team") continue;
    delete view.conversations[id];
    for (const messageId of conversation.messageIds) delete view.messages[messageId];
    for (const assignmentId of conversation.assignmentIds) delete view.assignments[assignmentId];
  }
  // Do not expose personal context/memory embedded in execution snapshots.
  for (const assignment of Object.values(view.assignments)) assignment.execution.context = [];
  return view;
}
