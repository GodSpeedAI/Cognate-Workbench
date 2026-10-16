// Conflict-aware workspace-effect admission. The single global exclusion key is replaced by
// canonical per-resource keys derived from AUTHORITATIVE application state (workspace records,
// execution-world records, the Experts registry), never from run-supplied input. Provably disjoint
// work overlaps; same-resource work serializes; unknown or unclassifiable work fails closed to the
// unchanged global exclusion key. `assertModelOnlyExpertRun` keeps the model-only overlap semantics.
// Admission remains process-local by SDK contract — this is not distributed safety.
import type { Caller, RunView, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CODING } from "../agents/agentCoding.ts";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { AGENT_COGNITIVE, COGNITIVE_EVENT_TYPES } from "../agents/agentCognitive.ts";
import type { ExpertsService } from "./service.ts";
import { EXPERT_AGENT, isUnfinished, type ExpertState } from "./types.ts";

/** The fail-closed exclusion group: unknown agents, unknown input shapes and unknown workspace
 * identities all serialize here. Only a model-only Expert turn is allowed to overlap workspace
 * effects at all, and it holds no key. */
export const WORKSPACE_EFFECTS_RESOURCE_KEY = "workbench:workspace-effects";
/** Configuration runs mutate shared operator state (settings, model, providers, plugins, records).
 * They serialize with each other and with workspace/world mutators, but never block model-only
 * Expert work. */
export const CONFIGURATION_RESOURCE_KEY = "workbench:configuration";

export const workspaceResourceKey = (workspaceId: string): string => `workbench:workspace:${workspaceId}`;
export const worldResourceKey = (worldId: string): string => `workbench:world:${worldId}`;

const MODEL_ONLY_TOOLS = ["expert_return"] as const;

/** A workspace record read from the `workspaces` projection (root, execution world, title). */
export interface WorkspaceRecord {
  readonly id: string;
  readonly root: string;
  readonly title: string;
  readonly executionWorldId: string;
}

export type ExpertsReady = (signal?: AbortSignal) => Promise<ExpertsService>;

function deny(message: string): never {
  throw new Error(`Parallel Expert admission denied: ${message}`);
}

function bounded(keys: readonly string[]): readonly string[] {
  const unique = [...new Set(keys)];
  if (!unique.length || unique.length > 100 || unique.some((key) => typeof key !== "string" || !key || key.length > 500)) {
    return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  }
  return unique;
}

const systemCaller = (tenant: string): Caller => ({ actor: { id: "system", kind: "system" }, tenant });

/** Workspace record lookup by authoritative id. An id that is absent from the projection is a
 * forged or aliased identity and must never mint a resource key. */
export async function workspaceRecordFor(service: RuntimeService, tenant: string, workspaceId: unknown): Promise<WorkspaceRecord | undefined> {
  if (typeof workspaceId !== "string" || !workspaceId) return undefined;
  const rows = (await service.readProjection(systemCaller(tenant), { name: "workspaces" })).rows;
  const row = rows.find((candidate) => candidate.key === `record/${workspaceId}`);
  if (!row) return undefined;
  const value = row.value as { readonly root?: unknown; readonly title?: unknown; readonly executionWorldId?: unknown };
  if (typeof value.executionWorldId !== "string" || !value.executionWorldId) return undefined;
  return {
    id: workspaceId,
    root: typeof value.root === "string" ? value.root : "",
    title: typeof value.title === "string" ? value.title : "",
    executionWorldId: value.executionWorldId,
  };
}

/** All workspace ids currently placed in an execution world, from the authoritative projection. */
export async function workspaceIdsInWorld(service: RuntimeService, tenant: string, worldId: string): Promise<readonly string[]> {
  const rows = (await service.readProjection(systemCaller(tenant), { name: "workspaces" })).rows;
  return rows
    .filter((row) => row.key.startsWith("record/") && (row.value as { executionWorldId?: unknown }).executionWorldId === worldId)
    .map((row) => row.key.slice("record/".length));
}

/** Keys for a run that can mutate one workspace's files: the workspace resource. An unresolvable
 * workspace identity fails closed to the global exclusion key. Runs hold only the resources they
 * can mutate — they do NOT hold their world key, so runs on different workspaces stay disjoint even
 * when they share one execution world; world mutators enumerate the workspaces they affect instead. */
export async function workspaceEffectKeys(service: RuntimeService, tenant: string, workspaceId: unknown): Promise<readonly string[]> {
  const record = await workspaceRecordFor(service, tenant, workspaceId);
  if (!record) return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  return [workspaceResourceKey(record.id)];
}


/** Keys for a run that mutates the workspace/world record graph itself: the configuration
 * resource plus the exact records it names. A world mutator additionally names every workspace
 * placed in that world, so it serializes against the runs those workspaces carry without forcing
 * runs to share a world key (which would serialize disjoint workspaces). Record identities are
 * validated against the authoritative projection: a record that does not exist is never trusted
 * from the run input, and the run fails closed to exclusion. */
export async function configurationEffectKeys(service: RuntimeService, tenant: string, input: unknown): Promise<readonly string[]> {
  const command = input as { kind?: unknown; workspaceId?: unknown; executionWorldId?: unknown; worldId?: unknown } | null;
  if (!command || typeof command !== "object") return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  const kind = command.kind;
  if (typeof kind !== "string") return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  switch (kind) {
    case "workspace.added":
    case "workspace.contained.added": {
      // These runs CREATE the record, so the id cannot pre-exist; the keyed identity is the
      // record the run itself establishes, plus the world it names.
      const keys = [CONFIGURATION_RESOURCE_KEY];
      if (typeof command.workspaceId === "string" && command.workspaceId) keys.push(workspaceResourceKey(command.workspaceId));
      if (typeof command.executionWorldId === "string" && command.executionWorldId) {
        keys.push(worldResourceKey(command.executionWorldId));
      }
      return bounded(keys);
    }
    case "workspace.selected":
    case "workspace.renamed":
    case "workspace.deleted": {
      const record = await workspaceRecordFor(service, tenant, command.workspaceId);
      if (!record) return [WORKSPACE_EFFECTS_RESOURCE_KEY];
      return [CONFIGURATION_RESOURCE_KEY, workspaceResourceKey(record.id)];
    }
    case "execution.world.connected":
    case "execution.world.disconnected": {
      const worldId = command.worldId;
      if (typeof worldId !== "string" || !worldId) return [WORKSPACE_EFFECTS_RESOURCE_KEY];
      const placed = await workspaceIdsInWorld(service, tenant, worldId);
      return bounded([CONFIGURATION_RESOURCE_KEY, worldResourceKey(worldId), ...placed.map(workspaceResourceKey)]);
    }
    default:
      return [CONFIGURATION_RESOURCE_KEY];
  }
}

/** Keys for `agent.cognitive`: it records case/world facts and never mutates a workspace's files,
 * so it holds configuration plus the named world, and nothing else. */
export function cognitiveEffectKeys(input: unknown): readonly string[] {
  const command = input as { eventType?: unknown; payload?: unknown } | null;
  if (!command || typeof command !== "object" || typeof command.eventType !== "string" || !COGNITIVE_EVENT_TYPES.has(command.eventType)) {
    return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  }
  const payload = command.payload as { worldId?: unknown } | null;
  const keys = [CONFIGURATION_RESOURCE_KEY];
  if (payload && typeof payload === "object" && typeof payload.worldId === "string" && payload.worldId) {
    keys.push(worldResourceKey(payload.worldId));
  }
  return bounded(keys);
}

export const teamAdmissionKey = (teamId: string, lane: number): string => `workbench:team:${teamId}:concurrent:${lane}`;

/**
 * T2 Team admission policy. The policy (maximum concurrent runs) resolves ONLY from authoritative
 * Team metadata — client-supplied policy is refused at the capability layer and never read here.
 * Each of the Team's runs holds exactly one of `maxConcurrentRuns` lane keys, so at most that many
 * of its runs may overlap regardless of process capacity: a Team exceeding its policy waits even
 * when the runtime is free. The lane count is derived from authoritative assignment state; after a
 * process restart a recovered run may re-enter a different lane, which can only serialize more —
 * never admit beyond the policy. Unknown Teams or invalid policy fail closed to full Team
 * serialization.
 */
export function teamAdmissionKeys(state: ExpertState, assignmentId: string): readonly string[] {
  const assignment = state.assignments[assignmentId];
  const teamId = assignment?.teamId;
  if (!teamId) return [];
  const team = state.teams[teamId];
  if (!team || team.lifecycle !== "active") return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  const capacity = team.limits?.maxConcurrentRuns;
  if (!Number.isSafeInteger(capacity) || (capacity as number) < 1 || (capacity as number) > 8) {
    return [teamAdmissionKey(teamId, 0)];
  }
  const occupied = Object.values(state.assignments).filter((candidate) =>
    candidate.id !== assignmentId && candidate.teamId === teamId && candidate.runId !== null && isUnfinished(candidate)).length;
  return [teamAdmissionKey(teamId, occupied % (capacity as number))];
}

/** Pure predicate over the native run view and authoritative Experts snapshot. */
export function assertModelOnlyExpertRun(run: RunView, state: ExpertState, systemActorId: string): boolean {
  if (run.agent !== EXPERT_AGENT || run.startedBy !== systemActorId) deny("run is not system-started agent.expert");
  if (run.status !== "running" && run.status !== "waiting") deny("run is not active");
  if (!run.runId || !run.tenant) deny("run identity is incomplete");

  const input = run.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) deny("run input is invalid");
  const assignmentId = (input as Record<string, unknown>).assignmentId;
  const attempt = (input as Record<string, unknown>).attempt;
  if (typeof assignmentId !== "string" || !assignmentId || !Number.isSafeInteger(attempt) || (attempt as number) < 1) {
    deny("run does not name an assignment attempt");
  }
  const assignment = state.assignments[assignmentId];
  if (!assignment || !isUnfinished(assignment) || assignment.attempt !== attempt) deny("assignment attempt is stale or terminal");
  if (assignment.runId !== null && assignment.runId !== run.runId) deny("assignment belongs to another run");
  if (assignment.execution.assignmentId !== assignment.id || assignment.execution.expertId !== assignment.expertId) deny("frozen execution identity does not match assignment");

  const expert = state.experts[assignment.expertId];
  if (!expert || expert.lifecycle !== "active") deny("Expert is no longer active");
  const frozenTools = assignment.execution.tools;
  if (!frozenTools.includes("expert_return")) deny("frozen execution is missing intrinsic expert_return");

  let teamOrchestrator = false;
  if (assignment.teamId) {
    const team = state.teams[assignment.teamId];
    if (!team || team.lifecycle !== "active") deny("Team is no longer active");
    const member = team.members.find((item) => item.expertId === assignment.expertId);
    if (!member) deny("Expert is no longer a Team member");
    if (member.role !== "orchestrator" && member.role !== "specialist") deny("Team membership role is invalid");
    teamOrchestrator = member.role === "orchestrator";
  }

  if (assignment.status === "reconciliation-required" || Object.values(assignment.effects ?? {}).some((effect) =>
    effect.state === "UNKNOWN_RECONCILIATION_REQUIRED" || effect.state === "DISPATCHING")) {
    deny("assignment has unresolved external effects");
  }
  return !teamOrchestrator && frozenTools.length === MODEL_ONLY_TOOLS.length && frozenTools[0] === MODEL_ONLY_TOOLS[0];
}

export interface AdmissionLookupSources {
  /** Experts registry readiness; only `agent.expert` runs wait on it. Configuration runs must
   * never wait on Expert boot readiness, avoiding seed dependency loops. */
  readonly ready: ExpertsReady;
  /** Runtime readiness for projection reads; independent of Expert boot. */
  readonly getService: (signal?: AbortSignal) => Promise<RuntimeService>;
}

/**
 * Create the native-runtime admission lookup. Keys derive from authoritative application state —
 * the Experts registry for Expert work, the `workspaces`/`execution-worlds` projections for
 * everything else — and never from run-supplied input. agent.config is deliberately independent of
 * the Experts registry during boot; it only shares the configuration/workspace exclusion keys.
 */
export function createExpertAdmissionResourceKeys(sources: AdmissionLookupSources) {
  return async (run: RunView, signal?: AbortSignal): Promise<readonly string[]> => {
    if (run.agent === EXPERT_AGENT) {
      const experts = await sources.ready(signal);
      signal?.throwIfAborted();
      const authoritativeRun = await experts.service.getRun(experts.caller(run.tenant), { runId: run.runId });
      signal?.throwIfAborted();
      if (authoritativeRun.runId !== run.runId) deny("runtime returned a different RunView");
      const state = await experts.state(run.tenant);
      signal?.throwIfAborted();
      const modelOnly = assertModelOnlyExpertRun(authoritativeRun, state, experts.systemCaller.actor.id);
      // Tool-bearing Expert work mutates its Assignment's workspace. The identity comes from the
      // authoritative registry record, never the run input; an unknown identity fails closed.
      const assignmentId = (authoritativeRun.input as Record<string, unknown>).assignmentId as string;
      // T2: the Team admission policy resolves from authoritative Team metadata. Solo model-only
      // work keeps its overlap semantics (no keys at all); every Team run holds one admission lane
      // so a Team exceeding its policy waits even when process capacity is free.
      const teamKeys = teamAdmissionKeys(state, assignmentId);
      if (modelOnly) return teamKeys.length ? bounded(teamKeys) : [];
      const service = await sources.getService(signal);
      signal?.throwIfAborted();
      return bounded([...teamKeys, ...await workspaceEffectKeys(service, run.tenant, state.assignments[assignmentId]?.workspaceId)]);
    }

    // Coding sessions and configuration classify against the authoritative projections without
    // waiting on Expert boot; unclassifiable work falls through to the global exclusion key.
    if (run.agent === AGENT_CODING || run.agent === AGENT_CONFIG) {
      const service = await sources.getService(signal);
      signal?.throwIfAborted();
      if (run.agent === AGENT_CODING) {
        return workspaceEffectKeys(service, run.tenant, (run.input as { workspaceId?: unknown } | null)?.workspaceId);
      }
      return configurationEffectKeys(service, run.tenant, run.input);
    }
    if (run.agent === AGENT_COGNITIVE) return cognitiveEffectKeys(run.input);
    return [WORKSPACE_EFFECTS_RESOURCE_KEY];
  };
}

/** Startup-only setting. Unknown values fail closed to serial execution. */
export function parseExpertAdmissionCapacity(raw: string | undefined): 1 | 2 | 4 | 8 {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  if (value === 1 || value === 2 || value === 4 || value === 8) return value;
  throw new RangeError("Expert model-only admission capacity must be one of 1, 2, 4, or 8");
}
