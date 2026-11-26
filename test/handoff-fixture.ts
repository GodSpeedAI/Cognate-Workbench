// WP-23 (J-CASE-ASSIGNMENT-handoff): a stand-in hand-off source for the journey and browser tests.
// Horizon's case keeper is the production source; until that wiring exists, tests configure this
// one. It offers approved case assignments shaped like the binding SEA-Forge serves (assignment.v1
// Brief and Budget, the frozen world and kind) — see sea-rs
// crates/sea-forge-server/tests/conformance_fde_scenarios.rs, delegate-complete-freeze-accepted.
import type { HandoffCandidate, HandoffSource } from "../src/assignments/handoffSource.ts";

export const GATE_G3_INSTRUCTION = "Record the verifier's observation for gate G3.";
export const GATE_G3_ASSIGNMENT_ID = "assign:case-0001:item-03:1:1";
/** The aimock `wp23-handoff-slow` fixture streams this for about eight seconds, so an operator can report
 *  spend and interrupt the run while it is live. */
export const SLOW_GATE_INSTRUCTION = "[[scenario:wp23-handoff-slow]] Record the slow observation for gate G4.";
export const SLOW_GATE_ASSIGNMENT_ID = "assign:case-0001:item-03:1:2";

const BUDGET: HandoffCandidate["assignment"]["budget"] = [
  { currency: "time", limit: 14400, unit: "seconds" },
  { currency: "attention", limit: "unknown", unit: "operator_minutes" },
  { currency: "money", limit: 5, unit: "USD" },
  { currency: "risk", limit: "unknown", unit: "class" },
  { currency: "recovery", limit: 1, unit: "revert_steps" },
];

function approved(id: string, candidateId: string, k: number, instruction: string): HandoffCandidate {
  return {
    id: candidateId,
    assignment: {
      assignment_id: id,
      case_id: "case-0001",
      step_id: "item-03",
      n: 1,
      k,
      episode_ref: `episode:case-0001:item-03:1@sha256:${"cd".repeat(32)}`,
      brief: {
        instruction,
        adoptable_problem: "Record the verifier's observation before settling the episode.",
        domain_meaning: "An evidence record names an independent source.",
        context_refs: [{ ref: "doc:handoff-note-1", trust: "untrusted_reference" }],
      },
      budget: BUDGET,
      issued_at: "2026-11-24T09:00:00.000Z",
    },
    caseContext: {
      worldRef: `world:seed@sha256:${"0".repeat(64)}`,
      semanticRef: "fde-sop.work::Task",
      caseId: "case-0001",
      planItemId: "item-03",
      role: "executor",
      kind: "evaluated",
    },
    linkExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}

export const approvedGateG3 = (): HandoffCandidate => approved(GATE_G3_ASSIGNMENT_ID, "candidate:gate-g3", 1, GATE_G3_INSTRUCTION);
export const approvedSlowGate = (): HandoffCandidate => approved(SLOW_GATE_ASSIGNMENT_ID, "candidate:gate-g4-slow", 2, SLOW_GATE_INSTRUCTION);

/** A hand-off source holding exactly the candidates a test offers; `withdraw` makes one stop being offered. */
export function standInHandoffSource(initial: readonly HandoffCandidate[]): HandoffSource & { withdraw(id: string): void } {
  const offered = new Map(initial.map((candidate) => [candidate.id, candidate] as const));
  return {
    async list() {
      return [...offered.values()];
    },
    async get(id) {
      return offered.get(id);
    },
    withdraw(id) {
      offered.delete(id);
    },
  };
}
