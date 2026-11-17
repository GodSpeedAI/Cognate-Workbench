// WP-23 (Workbench half): sessions opened from a case assignment, and the operator's controls over them.
// A request with no assignment is passed through untouched, so a Workbench without a case behaves as before.
import type { Assignment, AssignmentService, AssignmentView, Caller, CaseContext, Currency, RuntimeService, RunView } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

export const ASSIGNMENT_ACTIONS: ReadonlySet<string> = new Set(["assignment.interrupt", "assignment.resume", "assignment.spend"]);

/**
 * Who may drive an assignment's lifecycle: the local operator (interrupt, resume, report spend) and the system
 * lineage (report spend only). An agent, including the run's own, can never resume, interrupt or re-budget itself.
 * Returns `undefined` for every other action so the caller's remaining rules apply.
 */
export function authorizeAssignmentAction(request: { readonly action: string; readonly caller: Caller }): { readonly allow: boolean; readonly reason: string } | undefined {
  if (!ASSIGNMENT_ACTIONS.has(request.action)) return undefined;
  const { actor, tenant } = request.caller;
  if (tenant !== "local") return { allow: false, reason: "assignment controls belong to the local operator" };
  if (actor.kind === "user" && actor.id === "operator") return { allow: true, reason: "operator controls the assignment" };
  if (actor.kind === "system" && request.action === "assignment.spend") return { allow: true, reason: "system reports spend" };
  return { allow: false, reason: `${actor.kind} may not ${request.action}` };
}

export interface StartRunRequest {
  readonly agent: string;
  readonly input: Json;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly state?: Json;
  readonly caseContext?: CaseContext;
  readonly assignment?: Assignment;
  readonly linkExpiresAt?: string;
}

/**
 * Open a session. With an assignment, the run is bound to it: one run per assignment id (the idempotency key and
 * correlation id derive from the id, so a repeated delegation resolves to the same run), and Cognate refuses it without a
 * matching case context. Without one, the request is forwarded exactly as given.
 */
export function startAssignedRun(service: Pick<RuntimeService, "startRun">, caller: Caller, request: StartRunRequest): Promise<RunView> {
  const { assignment } = request;
  if (!assignment) return service.startRun(caller, request);
  return service.startRun(caller, { ...request, idempotencyKey: `${assignment.assignment_id}`, correlationId: request.correlationId ?? assignment.assignment_id });
}

/** Operator controls over one run's assignment. Idempotency keys are derived so a retried click is not a second event. */
export function assignmentControls(assignments: AssignmentService, caller: Caller) {
  return {
    view: (runId: string): Promise<AssignmentView> => assignments.getAssignment(caller, { runId }),
    interrupt: (runId: string, reason: string, token: string): Promise<AssignmentView> => assignments.interruptAssignment(caller, { runId, reason, idempotencyKey: `${runId}:interrupt:${token}` }),
    resume: (runId: string, token: string): Promise<AssignmentView> => assignments.resumeAssignment(caller, { runId, idempotencyKey: `${runId}:resume:${token}` }),
    spend: (runId: string, currency: Currency, amount: number | "unknown", token: string): Promise<AssignmentView> => assignments.recordSpend(caller, { runId, currency, amount, idempotencyKey: `${runId}:spend:${currency}:${token}` }),
  };
}
