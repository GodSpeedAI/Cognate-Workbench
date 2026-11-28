// Admission guard for the contained spawn path (SEA-Forge #114). The `agent.rlm` child run is the code that
// reaches the spawn port, and a run for that agent can be started by anything that may start runs. Only the
// governed `rlm.invoke` (grant subset, depth, reservation, pinned context) may cause a spawn. The governed
// component records, for each invocation it admits, a digest of the exact child input it derived; this guard
// refuses an `agent.rlm` run whose input is not byte-for-byte that input (so a replay with wider authority, a
// bigger budget or another task is refused), and binds each admission to the first run that uses it (so a second
// run with identical input is refused too). Cognate re-runs a child body on resume, so the same run may enter
// again. A repeat of the same admission (rlm.invoke is repeatable for one invocation) keeps the existing entry and
// its claim instead of re-arming it, and a dispatch that fails disarms what it armed. The claim is bound to the
// lineage the governed component knows when it admits: the parent run (in the input) and the parent's principal,
// which Cognate gives the child run as its actor. Cognate starts the child before returning, so the child run id is
// not known at admission; an unclaimed admission also expires. A caller that can act as the parent's own agent
// principal is inside the same trust domain. The record is in memory and bounded: after a host restart an in-flight child is refused rather than
// re-spawned, which fails closed (a contained process does not survive a restart anyway).
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import { createHash } from "node:crypto";
import { canonicalJson } from "./containedLaunch.ts";

export interface AdmittedInvocation {
  readonly invocationId: string;
  /** The child input the governed component derived and will hand to Cognate's `agent.rlm`. */
  readonly input: unknown;
  /** The parent run's principal id: the actor Cognate starts the child run as. */
  readonly principal: string;
}

export interface RlmAdmissionGuard {
  /** Records the admission and returns a disarm function that removes it only if THIS call created it. */
  admit(invocation: AdmittedInvocation): () => void;
  wrap(agent: AgentDefinition): AgentDefinition;
}

const RETAINED = 256;
/** An admission nobody claimed within this long is dead. */
const DEFAULT_TTL_MS = 5 * 60_000;
const digestOf = (input: unknown): string => createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(input ?? null)))).digest("hex");

export function rlmAdmissionGuard(options: { readonly ttlMs?: number; readonly now?: () => number } = {}): RlmAdmissionGuard {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const admitted = new Map<string, { digest: string; principal: string; armedAt: number; consumedBy?: string }>();
  return {
    admit(invocation) {
      const digest = digestOf(invocation.input);
      const existing = admitted.get(invocation.invocationId);
      const live = existing && (existing.consumedBy !== undefined || now() - existing.armedAt <= ttl);
      if (existing && live && existing.digest === digest && existing.principal === invocation.principal) return () => {}; // a repeat does not re-arm
      const entry: { digest: string; principal: string; armedAt: number; consumedBy?: string } = { digest, principal: invocation.principal, armedAt: now() };
      admitted.delete(invocation.invocationId);
      admitted.set(invocation.invocationId, entry);
      while (admitted.size > RETAINED) admitted.delete(admitted.keys().next().value as string);
      return () => { if (admitted.get(invocation.invocationId) === entry && entry.consumedBy === undefined) admitted.delete(invocation.invocationId); };
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
          if (context.actor.id !== entry.principal || context.actor.kind !== "agent") {
            throw new RlmRefusedError("rlm-posture-refused", "this child run was not started as the parent run's principal");
          }
          if (entry.consumedBy === undefined && now() - entry.armedAt > ttl) {
            admitted.delete(id as string);
            throw new RlmRefusedError("rlm-posture-refused", "this admission expired before any run used it");
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
