import type { RunView } from "@godspeedai/cognate-runtime-api";
import type { ExpertsService } from "./service.ts";
import { EXPERT_AGENT, isUnfinished, type ExpertState } from "./types.ts";

/** The only work allowed to overlap Workbench workspace effects is a model-only Expert turn. */
export const WORKSPACE_EFFECTS_RESOURCE_KEY = "workbench:workspace-effects";
const MODEL_ONLY_TOOLS = ["expert_return"] as const;

export type ExpertsReady = (signal?: AbortSignal) => Promise<ExpertsService>;

function deny(message: string): never {
  throw new Error(`Parallel Expert admission denied: ${message}`);
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

/**
 * Create the native-runtime admission lookup. agent.config is deliberately independent of the
 * Experts registry during boot. Its workspace/world events still share the mutation-exclusion key.
 */
export function createExpertAdmissionResourceKeys(ready: ExpertsReady) {
  return async (run: RunView, signal?: AbortSignal): Promise<readonly string[]> => {
    if (run.agent !== EXPERT_AGENT) return [WORKSPACE_EFFECTS_RESOURCE_KEY];

    const experts = await ready(signal);
    signal?.throwIfAborted();
    const authoritativeRun = await experts.service.getRun(experts.caller(run.tenant), { runId: run.runId });
    signal?.throwIfAborted();
    if (authoritativeRun.runId !== run.runId) deny("runtime returned a different RunView");
    const state = await experts.state(run.tenant);
    signal?.throwIfAborted();
    return assertModelOnlyExpertRun(authoritativeRun, state, experts.systemCaller.actor.id)
      ? []
      : [WORKSPACE_EFFECTS_RESOURCE_KEY];
  };
}

/** Startup-only setting. Unknown values fail closed to serial execution. */
export function parseExpertAdmissionCapacity(raw: string | undefined): 1 | 2 | 4 | 8 {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  if (value === 1 || value === 2 || value === 4 || value === 8) return value;
  throw new RangeError("Expert model-only admission capacity must be one of 1, 2, 4, or 8");
}
