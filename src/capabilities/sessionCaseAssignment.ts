// `session.caseAssignment.candidates` and `session.caseAssignment.handoff` (WP-23,
// J-CASE-ASSIGNMENT-handoff): the operator hands an approved case assignment to a session.
//
// The request names a candidate. The approved Brief, Budget and case context are resolved from the
// host's hand-off source on the server, and a request that carries its own is refused:
// caller-supplied authority fails closed. The session's run is opened through `startAssignedRun`,
// so there is one run per assignment id (a repeated hand-off replays that run), correlated to the
// session like any turn. That run's own `run.started` event is the binding: it carries the
// session, the run id and the assignment, and the `session-assignment-bindings` projection folds
// it. Nothing else is recorded, so the binding is visible the moment the run starts.
//
// Both are human decisions of the local operator (`localOperatorOnly`). With no hand-off source the host offers nothing: the
// candidates read reports the control unavailable and a hand-off is refused.
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";
import { isLocalOperator, startAssignedRun } from "../assignments/assignmentBinding.ts";
import { handoffCandidateView, type HandoffCandidate, type HandoffSource } from "../assignments/handoffSource.ts";
import { AGENT_CODING, type AgentCodingInput } from "../agents/agentCoding.ts";
import { operatorOnly } from "../workbench/operatorGuard.ts";

export interface CaseAssignmentHandoffInput {
  readonly sessionId: string;
  readonly candidateId: string;
  /** The run's message; defaults to the approved Brief's instruction. */
  readonly message?: string;
  /** The session's access mode and agent preset, as the composer would send them. */
  readonly mode?: string;
  readonly preset?: string;
}

/** A human decision by the one local operator, outside any run. Checked before any system-identity lookup, so a
 *  refused caller learns nothing about which sessions exist. */
async function localOperatorOnly(ctx: HandlerContext, capability: string): Promise<void> {
  await operatorOnly(ctx, capability);
  if (!isLocalOperator(ctx)) throw new Error(`${capability}: only the local operator may do this`);
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function sessionCaseAssignmentComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** The host's hand-off source; `null` or absent means the host offers no assignments. */
  readonly handoffSource: HandoffSource | null | undefined;
  readonly candidatesRef: SemanticRef | undefined;
  readonly handoffRef: SemanticRef | undefined;
}): Component {
  const candidatesContract = { id: "session.caseAssignment.candidates", version: "1.0.0", semanticRef: options.candidatesRef };
  const handoffContract = { id: "session.caseAssignment.handoff", version: "1.0.0", semanticRef: options.handoffRef };
  return {
    id: "session:case-assignment",
    provides: [candidatesContract, handoffContract],
    activate(fiber) {
      fiber.provide(candidatesContract, async (_rawInput, ctx) => {
        await localOperatorOnly(ctx, candidatesContract.id);
        const source = options.handoffSource;
        if (!source) return { available: false, candidates: [] };
        const offered = await source.list();
        return { available: true, candidates: offered.map(handoffCandidateView) };
      });

      fiber.provide(handoffContract, async (rawInput, ctx) => {
        await localOperatorOnly(ctx, handoffContract.id);
        const input = (rawInput ?? {}) as CaseAssignmentHandoffInput & Record<string, unknown>;
        for (const member of ["assignment", "caseContext", "linkExpiresAt", "budget", "brief"]) {
          if (member in input) throw new Error(`session.caseAssignment.handoff: the request carries "${member}"; the approved assignment is resolved by the server, never supplied`);
        }
        if (!text(input.sessionId)) throw new Error("session.caseAssignment.handoff: a sessionId is required");
        if (!text(input.candidateId)) throw new Error("session.caseAssignment.handoff: a candidateId is required");
        const source = options.handoffSource;
        if (!source) throw new Error("session.caseAssignment.handoff: this host offers no case assignments to hand off");
        const candidate: HandoffCandidate | undefined = await source.get(input.candidateId);
        if (!candidate) throw new Error(`session.caseAssignment.handoff: ${input.candidateId} is no longer offered for hand-off`);

        const service = options.getService();
        const sessionRows = (await service.readProjection(options.systemCaller, { name: "sessions" })).rows;
        const session = sessionRows.find((r) => r.key.slice(r.key.indexOf("/") + 1) === input.sessionId)?.value as { readonly workspaceId?: string } | undefined;
        if (!session?.workspaceId) throw new Error(`session.caseAssignment.handoff: unknown session ${input.sessionId}`);

        // The invoking operator opens the run, exactly as the composer's send would; the
        // assignment makes it one run per assignment id.
        const caller: Caller = { actor: ctx.actor, tenant: ctx.tenant };
        const turn: AgentCodingInput = {
          sessionId: input.sessionId,
          workspaceId: session.workspaceId,
          message: text(input.message) ? input.message : candidate.assignment.brief.instruction,
          ...(text(input.mode) ? { mode: input.mode } : {}),
          ...(text(input.preset) ? { preset: input.preset } : {}),
        };
        const run = await startAssignedRun(service, caller, {
          agent: AGENT_CODING,
          input: turn as unknown as Json,
          idempotencyKey: candidate.assignment.assignment_id,
          correlationId: `session:${input.sessionId}`,
          state: { steer: [] } as unknown as Json,
          caseContext: candidate.caseContext,
          assignment: candidate.assignment,
          linkExpiresAt: candidate.linkExpiresAt,
        });
        return { runId: run.runId, sessionId: input.sessionId, assignmentId: candidate.assignment.assignment_id, candidate: handoffCandidateView(candidate) };
      });
    },
  };
}
