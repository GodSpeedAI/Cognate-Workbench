// `agent.cognitive`: records the durable facts of the cognitive-navigation proof (case, criterion,
// world lineage, observations, findings, experiment rounds, method decisions). Like `agent.config`
// it is deterministic and only emits; all I/O (hashing a workspace, running an observer) happens in
// the `cognitive.*` capability handlers before this run starts. Authority is checked there, not here.
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

export const AGENT_COGNITIVE = "agent.cognitive";

export const COGNITIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "case.opened",
  "criterion.frozen",
  "world.baseline.frozen",
  "world.candidate.frozen",
  "world.candidate.rejected",
  "world.settled",
  "verification.observed",
  "sentinel.finding",
  "experiment.round.completed",
  "method.recommended",
  "method.accepted",
]);

export interface AgentCognitiveInput {
  readonly eventType: string;
  readonly payload: Json;
}

export const agentCognitiveAgent: AgentDefinition = {
  id: AGENT_COGNITIVE,
  version: "1.0.0",
  async run(input, ctx) {
    const { eventType, payload } = input as unknown as AgentCognitiveInput;
    if (!COGNITIVE_EVENT_TYPES.has(eventType)) throw new Error(`agent.cognitive: not a cognitive event type: ${eventType}`);
    await ctx.emit(eventType, payload);
    return { ok: true };
  },
};
