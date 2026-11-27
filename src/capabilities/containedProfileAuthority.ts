// SEA-Forge authority for a contained spawn (ticket #116, Workbench host half). Before any sandbox starts, the host asks
// SEA-Forge for a decision on the `cognate_capability` resource, claiming the execution profile it is about to launch
// (`claims.execution_profile_digest`), and launches only on a decision that proves SEA authorized exactly that profile.
//
// The route to SEA-Forge is the one Workbench already has: the typed `SeaForgeAuthority.decide` client over the CEP
// authority socket (`externalAuthorityFromEnv`). No transport is added here.
//
// Accepted: disposition `boundary` whose constraints hold EXACTLY ONE constraint of type `execution_profile` with the
// claimed digest, and a plan that embeds that same digest. Everything else refuses before spawn, fail closed: deny,
// escalate (an approval is not awaited here: a contained spawn does not park a run), a plain allow, a constrained or
// degraded allow, a missing, wrong, extra or duplicate profile constraint, an unreachable or erroring SEA-Forge, a
// malformed decision, a missing world reference. SEA-Forge binds the digest the host claims and cannot verify it, so the
// host also recomputes it (the port's pre-spawn recompute) and compares it with the plan before asking.
//
// Evidence records the digests and the decision id only, never the raw packets.
import { RlmRefusedError, type GovernanceDecision, type GovernedOperation } from "@godspeedai/cognate-runtime-bun";
import { RLM_CAPABILITIES } from "@godspeedai/cognate-runtime-api";
import type { Principal } from "@godspeedai/cognate-kernel-api";
import type { ContainedStdioPortConfig } from "./containedLaunch.ts";

/** The claim key SEA-Forge reads, the boundary dimension it narrows, and the constraint type it exports. */
export const EXECUTION_PROFILE_CLAIM = "execution_profile_digest";
export const EXECUTION_PROFILE_CONSTRAINT = "execution_profile";
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** The part of `SeaForgeAuthority` this needs; a stand-in implements the same. */
export interface ProfileAuthority {
  decide(operation: GovernedOperation, worldRef: string): GovernanceDecision | Promise<GovernanceDecision>;
}

/** What the host keeps about one authorized spawn: digests and the decision id only. */
export interface ProfileAuthorization {
  readonly executionProfileDigest: string;
  readonly launchPlanDigest: string;
  readonly decisionId: string | undefined;
  readonly runId: string;
  readonly at: string;
}

export interface ProfileAuthorizeOptions {
  readonly authority: ProfileAuthority;
  /** The immutable world reference the runtime is governed against (`governance.worldRef`). */
  readonly worldRef: string | undefined;
  /** The identity the host speaks as when it asks (the service principal). */
  readonly actor: Principal;
  readonly tenant: string;
  /** Receives each authorization (digests and decision id only). */
  readonly record?: (authorization: ProfileAuthorization) => void;
}

const unauthorized = (why: string): RlmRefusedError => new RlmRefusedError("rlm-containment-unavailable", `rlm-profile-unauthorized: ${why}`);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Pure decision check: returns the decision id, or throws the typed refusal. */
export function checkProfileDecision(decision: unknown, executionProfileDigest: string): string | undefined {
  if (!isObject(decision)) throw unauthorized("the authority decision is malformed");
  if (typeof decision.disposition !== "string") throw unauthorized("the authority decision has no disposition");
  if (decision.disposition !== "boundary") throw unauthorized(`SEA-Forge answered ${decision.disposition}, not a boundary allow bound to this execution profile`);
  if (!Array.isArray(decision.constraints)) throw unauthorized("the boundary decision carries no constraints");
  let matching = 0;
  for (const constraint of decision.constraints) {
    if (!isObject(constraint) || typeof constraint.type !== "string" || typeof constraint.value !== "string") throw unauthorized("a constraint in the decision is malformed");
    if (constraint.type !== EXECUTION_PROFILE_CONSTRAINT) continue;
    if (constraint.value !== executionProfileDigest) throw unauthorized("the decision authorizes a different execution profile");
    matching += 1;
  }
  if (matching !== 1) throw unauthorized(matching === 0 ? "the decision carries no execution_profile constraint" : "the decision carries more than one execution_profile constraint");
  const ref = typeof decision.decisionRef === "string" && decision.decisionRef.length > 0 ? decision.decisionRef : undefined;
  const authority = isObject(decision.authority) && typeof decision.authority.decisionEnvelopeId === "string" ? decision.authority.decisionEnvelopeId : undefined;
  return ref ?? authority;
}

/**
 * The `authorize` hook for `ContainedStdioPortConfig`: ask SEA-Forge, require the exact boundary allow, require the
 * plan to embed the claimed digest, and throw the typed refusal on anything else.
 */
export function profileAuthorize(options: ProfileAuthorizeOptions): NonNullable<ContainedStdioPortConfig["authorize"]> {
  return async (plan, launchPlanDigest, ctx, executionProfileDigest) => {
    if (typeof executionProfileDigest !== "string" || !DIGEST.test(executionProfileDigest)) throw unauthorized("the execution profile digest is malformed");
    if (plan.executionProfileDigest !== executionProfileDigest) throw unauthorized("the launch plan does not embed the execution profile digest being authorized");
    if (!options.worldRef) throw unauthorized("no governed world reference is configured, so SEA-Forge cannot be asked");
    const operation: GovernedOperation = {
      kind: "capability",
      request: {
        operation: "invoke", actor: options.actor, tenant: options.tenant, scopeId: ctx.runId,
        capability: { id: RLM_CAPABILITIES.invoke, version: "1.0.0" }, providerId: "workbench-contained-port", correlationId: ctx.runId,
      },
      claims: { [EXECUTION_PROFILE_CLAIM]: executionProfileDigest },
    };
    let decision: unknown;
    try {
      decision = await options.authority.decide(operation, options.worldRef);
    } catch (error) {
      throw unauthorized(`SEA-Forge could not decide: ${error instanceof Error ? error.message : String(error)}`);
    }
    const decisionId = checkProfileDecision(decision, executionProfileDigest);
    options.record?.({ executionProfileDigest, launchPlanDigest, decisionId, runId: ctx.runId, at: new Date().toISOString() });
  };
}
