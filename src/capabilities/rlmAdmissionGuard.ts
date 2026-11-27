// Admission guard for the contained spawn path (SEA-Forge #114). The `agent.rlm` child run is the code that
// reaches the spawn port, and a run for that agent can be started by anything that may start runs. Only the
// governed `rlm.invoke` (grant subset, depth, reservation, pinned context) may cause a spawn, so the governed
// component records each invocation it admits, and this guard refuses an `agent.rlm` run that was not admitted
// that way. The record is in memory: after a host restart an in-flight child is refused rather than re-spawned,
// which fails closed (a contained process does not survive a restart anyway).
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";

export interface AdmittedInvocation {
  readonly invocationId: string;
  readonly parentRunId: string;
  readonly providerId: string;
}

export interface RlmAdmissionGuard {
  admit(invocation: AdmittedInvocation): void;
  wrap(agent: AgentDefinition): AgentDefinition;
}

export function rlmAdmissionGuard(): RlmAdmissionGuard {
  const admitted = new Map<string, AdmittedInvocation>();
  return {
    admit(invocation) { admitted.set(invocation.invocationId, invocation); },
    wrap(agent) {
      return {
        ...agent,
        async run(input, context) {
          const child = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
          const entry = typeof child.invocationId === "string" ? admitted.get(child.invocationId) : undefined;
          if (!entry || entry.parentRunId !== child.runId || entry.providerId !== child.providerId) {
            throw new RlmRefusedError("rlm-posture-refused", "this child run was not admitted by the governed rlm.invoke, so it may not use the contained spawn port");
          }
          return agent.run(input, context);
        },
      };
    },
  };
}
