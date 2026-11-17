// Shared authority selection (review R2): ONE implementation of "which activation row governs a
// call/run" and "which principal and grants authorize it", used by the dispatcher
// (`capabilityRuntime.ts`) and the run-start resolver (`runStartResolver.ts`) so the two paths
// cannot drift.
import { LOCAL_ROOT_ID } from "../capabilities/authorityGrants.ts";
import type { ActivationRow, AuthorityIndex, GrantRow } from "./authorityIndex.ts";

export type Failure = { readonly ok: false; readonly code: string; readonly reason: string };
export type Actor = { readonly id: string; readonly kind: string };

export const permissionCovered = (set: readonly string[], permission: string): boolean => set.includes("*") || set.includes(permission);

/** The actor's principal for grant lookup: operator => root; an agent => its id; a user-kind actor
 *  inside a run is the operator's CLIENT identity carried into agent work (§1.1/§1.6.iii), which
 *  runs under `wb-agent:coding`. */
export function principalForActor(actor: Actor, runId?: string): { ok: true; principalId: string } | Failure {
  if (actor.kind === "system") return { ok: false, code: "system-caller", reason: "the system caller may not use bundle handlers (anti-laundering)" };
  if (actor.kind === "user") return { ok: true, principalId: runId ? "wb-agent:coding" : LOCAL_ROOT_ID };
  if (actor.kind === "agent") return { ok: true, principalId: actor.id };
  return { ok: false, code: "unknown-actor", reason: `actor kind ${actor.kind} holds no capability authority` };
}

/** A live (active, unexpired on the injected clock) grant, or the named refusal. */
export function liveGrant(index: AuthorityIndex, principalId: string, nowMs: number, label = "principal"): { ok: true; grant: GrantRow } | Failure {
  const grant = index.grantFor(principalId);
  if (!grant) return { ok: false, code: principalId === LOCAL_ROOT_ID ? "no-root-grant" : "no-grant", reason: `${label} ${principalId} holds no active grant` };
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= nowMs) return { ok: false, code: "grant-expired", reason: `grant ${grant.grantId} has expired` };
  return { ok: true, grant };
}

/** The row that GOVERNS a call (§4.1, total): a session-scoped row governs whenever one exists for
 *  the call's session — whatever its state. A call whose session is unknown (`strict`: agent-shaped
 *  calls and run-start assembly) cannot dodge a session-scoped suspension: any suspended
 *  session-scoped row of the capability blocks it (fail closed). */
export function governingActivation(index: AuthorityIndex, capabilityId: string, level: string, sessionId: string | undefined, strict: boolean):
  { readonly row?: ActivationRow; readonly blockedBy?: ActivationRow } {
  if (!sessionId && strict) {
    for (const candidate of index.activations.values()) {
      if (candidate.capabilityId === capabilityId && candidate.level === level && candidate.sessionId && (candidate.state === "suspended" || candidate.suspensionReasons.length > 0)) return { blockedBy: candidate };
    }
  }
  return { row: index.selectActivation(capabilityId, level, sessionId) };
}

/** The activation's clamp grant must be live (unexpired on the injected clock) unless it is the
 *  operator's — whose clamp IS the root grant, checked by `liveAuthorityFor`. */
export function liveClamp(index: AuthorityIndex, row: ActivationRow, nowMs: number): { ok: true } | Failure {
  if (row.clampProvenance === "operator") return { ok: true };
  const clamp = [...index.grants.values()].find((g) => g.grantId === row.clampProvenance);
  if (!clamp || clamp.status !== "active" || (clamp.expiresAt && new Date(clamp.expiresAt).getTime() <= nowMs)) return { ok: false, code: "clamp-revoked", reason: `the clamp grant ${row.clampProvenance} of ${row.capabilityId} is no longer active` };
  return { ok: true };
}

/** Live clamp + root intersection for one use of `permission` under `row`. */
export function liveAuthorityFor(index: AuthorityIndex, row: ActivationRow, permission: string, nowMs: number): { ok: true } | Failure {
  const root = liveGrant(index, LOCAL_ROOT_ID, nowMs, "operator root");
  if (!root.ok) return root;
  if (!permissionCovered(root.grant.permissions, permission)) return { ok: false, code: "beyond-operator", reason: `${permission} exceeds the operator root's permissions` };
  return liveClamp(index, row, nowMs);
}
