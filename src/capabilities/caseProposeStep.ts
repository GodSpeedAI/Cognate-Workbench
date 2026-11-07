// Agents in the workshop propose a follow-up step to a case (Horizon stage 4).
//
// The proposal goes over the SEA-Forge socket as the case keeper's `case_add_item` verb. The case
// keeper stamps `proposed_by` from the identity-verified actor, never from the request. The actor
// is the workshop's service principal (`authority.service`, as in governance.ts) and the call carries
// NO `on_behalf_of`: an agent speaks as the service and never as the operator, so the operator's
// approval of the step stays a separate, human act.
//
// `request_id` is deterministic (`propose:<assignmentId>:<planItemId>`), so a retried proposal is the
// same request to the case keeper and does not add a second step. An unreachable or refusing case
// keeper is a plain error; nothing is queued silently.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { ExternalAuthority } from "./governance.ts";

// One NDJSON request/response over the SEA-Forge Unix socket. The typed `SeaForgeAuthority` client has no
// `case_add_item` verb (ported from the pre-0.9.0 governance.ts helper), so the case keeper call stays local.
async function seaForgeCall(socketPath: string, request: Record<string, unknown>, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  let buffered = "";
  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("SEA-Forge did not answer in time")), timeoutMs);
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) { socket.write(`${JSON.stringify(request)}\n`); },
        data(socket, chunk) {
          buffered += new TextDecoder().decode(chunk);
          const newline = buffered.indexOf("\n");
          if (newline < 0) return;
          // Settle before closing: in Bun, end() fires close() synchronously.
          try { finish(null, JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>); }
          catch { finish(new Error("SEA-Forge answered with invalid JSON")); }
          socket.end();
        },
        close() { finish(new Error("SEA-Forge closed the connection without an answer")); },
        error(_socket, error) { finish(error); },
      },
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

export const CASE_PROPOSE_STEP = "case.proposeStep";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface ProposeStepInput {
  readonly caseId: string;
  /** The proposing agent's assignment; part of the request id. */
  readonly assignmentId: string;
  readonly planItemId: string;
  readonly name: string;
  readonly policy: string;
  readonly settlementCriteria: Readonly<Record<string, unknown>>;
  /** The case keeper requires exactly one agent_task operation on an agent_task item (case_engine.rs:385-400). */
  readonly endpointRef: string;
  readonly instruction: string;
  readonly maxTurns: number;
}

function validate(raw: unknown): ProposeStepInput {
  const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const id = (field: string): string => {
    const value = v[field];
    if (typeof value !== "string" || !ID.test(value)) throw new Error(`${CASE_PROPOSE_STEP}: ${field} must be an identifier`);
    return value;
  };
  const name = v.name;
  if (typeof name !== "string" || !name.trim() || name.length > 300) throw new Error(`${CASE_PROPOSE_STEP}: name must be 1 to 300 characters`);
  const criteria = v.settlementCriteria ?? {};
  if (typeof criteria !== "object" || criteria === null || Array.isArray(criteria)) throw new Error(`${CASE_PROPOSE_STEP}: settlementCriteria must be an object`);
  const policy = v.policy ?? "policy.yaml";
  if (typeof policy !== "string" || !policy) throw new Error(`${CASE_PROPOSE_STEP}: policy must be a name`);
  const endpointRef = v.endpointRef;
  if (typeof endpointRef !== "string" || !endpointRef.trim()) throw new Error(`${CASE_PROPOSE_STEP}: endpointRef must name the delegation endpoint`);
  const instruction = v.instruction ?? name;
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 20_000) throw new Error(`${CASE_PROPOSE_STEP}: instruction must be 1 to 20000 characters`);
  const maxTurns = v.maxTurns ?? 8;
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new Error(`${CASE_PROPOSE_STEP}: maxTurns must be an integer from 1 to 100`);
  return { endpointRef, instruction, maxTurns, caseId: id("caseId"), assignmentId: id("assignmentId"), planItemId: id("planItemId"), name: name.trim(), policy, settlementCriteria: criteria as Record<string, unknown> };
}

/** The exact `case_add_item` frame sent for one proposal. */
export function proposeStepFrame(authority: ExternalAuthority, input: ProposeStepInput): Record<string, unknown> {
  return {
    verb: "case_add_item",
    case_id: input.caseId,
    item: { plan_item_id: input.planItemId, name: input.name, item_kind: "agent_task", operations: [{ kind: "agent_task", endpoint_ref: input.endpointRef, instruction: input.instruction, max_turns: input.maxTurns }], settlement_criteria: input.settlementCriteria },
    policy: input.policy,
    request_id: `propose:${input.assignmentId}:${input.planItemId}`,
    actor: authority.service,
  };
}

export async function proposeStep(authority: ExternalAuthority | undefined, raw: unknown): Promise<{ caseId: string; planItemId: string; proposedBy: string }> {
  if (!authority) throw new Error(`${CASE_PROPOSE_STEP}: no case keeper is configured (COGNATE_GOVERNANCE is off)`);
  const input = validate(raw);
  let response: Record<string, unknown>;
  try { response = await seaForgeCall(authority.socketPath, proposeStepFrame(authority, input), authority.timeoutMs); }
  catch (error) { throw new Error(`${CASE_PROPOSE_STEP}: the case keeper is not reachable (${error instanceof Error ? error.message : String(error)}); the proposal was not sent`); }
  if (response.ok !== true) throw new Error(`${CASE_PROPOSE_STEP}: the case keeper refused the step: ${String(response.error ?? response.error_class ?? JSON.stringify(response).slice(0, 300))}`);
  return { caseId: input.caseId, planItemId: input.planItemId, proposedBy: String(response.proposed_by ?? authority.service.actor_id) };
}

export function caseProposeStepComponent(options: { readonly authority: ExternalAuthority | undefined; readonly semanticRef?: SemanticRef }): Component {
  const capability = { id: CASE_PROPOSE_STEP, version: "1.0.0", ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  return {
    id: "case:propose-step",
    provides: [capability],
    activate(fiber) {
      fiber.provide(capability, async (raw, ctx) => {
        // Agents propose; the case keeper and the operator decide. A direct human call is not a proposal.
        if (!ctx.runId) throw new Error(`${CASE_PROPOSE_STEP}: only an agent run may propose a step`);
        return await proposeStep(options.authority, raw) as never;
      });
    },
  };
}
