// Admission guard for the contained spawn path (SEA-Forge #114). The `agent.rlm` child run is the code that
// reaches the spawn port, and a run for that agent can be started by anything that may start runs. Only the
// governed `rlm.invoke` (grant subset, depth, reservation, pinned context) may cause a spawn. The governed
// component records, for each invocation it admits, a digest of the exact child input it derived; this guard
// refuses an `agent.rlm` run whose input is not byte-for-byte that input (so a replay with wider authority, a
// bigger budget or another task is refused), and binds each admission to the first run that uses it (so a second
// run with identical input is refused too). Cognate re-runs a child body on resume, so the same run may enter
// again. The record is in memory and bounded: after a host restart an in-flight child is refused rather than
// re-spawned, which fails closed (a contained process does not survive a restart anyway).
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import { createHash } from "node:crypto";
import { canonicalJson } from "./containedLaunch.ts";

export interface AdmittedInvocation {
  readonly invocationId: string;
  /** The child input the governed component derived and will hand to Cognate's `agent.rlm`. */
  readonly input: unknown;
}

export interface RlmAdmissionGuard {
  admit(invocation: AdmittedInvocation): void;
  wrap(agent: AgentDefinition): AgentDefinition;
}

const RETAINED = 256;
const digestOf = (input: unknown): string => createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(input ?? null)))).digest("hex");

export function rlmAdmissionGuard(): RlmAdmissionGuard {
  const admitted = new Map<string, { digest: string; consumedBy?: string }>();
  return {
    admit(invocation) {
      admitted.delete(invocation.invocationId);
      admitted.set(invocation.invocationId, { digest: digestOf(invocation.input) });
      while (admitted.size > RETAINED) admitted.delete(admitted.keys().next().value as string);
    },
    wrap(agent) {
      return {
        ...agent,
        async run(input, context) {
          const id = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).invocationId : undefined;
          const entry = typeof id === "string" ? admitted.get(id) : undefined;
          if (!entry || entry.digest !== digestOf(input)) {
            throw new RlmRefusedError("rlm-posture-refused", "this child run is not the input the governed rlm.invoke admitted, so it may not use the contained spawn port");
          }
          if (entry.consumedBy !== undefined && entry.consumedBy !== context.runId) {
            throw new RlmRefusedError("rlm-posture-refused", "this admission was already used by another run");
          }
          entry.consumedBy = context.runId;
          return agent.run(input, context);
        },
      };
    },
  };
}
