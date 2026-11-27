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
  const grant = index.grantFor(principalId, nowMs);
  if (grant) return { ok: true, grant };
  const lapsed = index.grantFor(principalId);
  if (lapsed) return { ok: false, code: "grant-expired", reason: `grant ${lapsed.grantId} has expired` };
  return { ok: false, code: principalId === LOCAL_ROOT_ID ? "no-root-grant" : "no-grant", reason: `${label} ${principalId} holds no active grant` };
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

export type CapabilityOp = "invoke" | "skill.load" | "activate" | "deactivate" | "harness.resolve" | "harness.refresh" | "harness.apply" | "uninstall" | "grant.issue" | "grant.revoke" | "suspend" | "resume" | "mcp.start" | "mcp.stop";

export interface AuthorizeArgs {
  /** The durable enablement marker (§1.7). */
  readonly enabled: boolean;
  /** The §1.5 deployment invariant, re-evaluated for THIS call (never remembered from boot). */
  readonly deploymentOk: boolean;
  readonly index: AuthorityIndex | undefined;
  readonly actor: Actor;
  readonly runId?: string;
  /** From the run context ONLY (`sessionOfRun`) — never from call input. */
  readonly sessionId?: string;
  readonly capabilityId?: string;
  readonly permission?: string;
  readonly nowMs: number;
}

export type Authorization = { readonly ok: true; readonly index: AuthorityIndex; readonly principalId: string; readonly grant?: GrantRow; readonly root?: GrantRow; readonly row?: ActivationRow } | Failure;

/** THE authorization function (review R3): every capability-runtime entry point — invoke, skill
 *  load, activate, deactivate, harness resolve/refresh/apply — decides here, in one place:
 *  enablement and the §1.5 deployment invariant, the principal, the principal's live grant
 *  intersected with the live root grant (expiry and revocation), and — for operations on a
 *  capability's activation — the governing row (session suspension wins; the session is the run's). */
export function authorizeCapabilityOp(op: CapabilityOp, a: AuthorizeArgs): Authorization {
  // Operator-only lifecycle acts (R4): the human decision itself — a direct operator outside any
  // run. They carry no enablement or root-liveness precondition (revoking the root grant must
  // never lock the operator out), but they pass through this function as the LAST step before
  // their commit, so the one decision point covers every mutating op.
  if (op === "uninstall" || op === "grant.issue" || op === "grant.revoke" || op === "suspend" || op === "resume" || op === "mcp.stop") {
    if (a.actor.kind !== "user" || a.runId) return { ok: false, code: "operator-only", reason: `${op} is a human decision: only a direct operator may do this, not ${a.actor.kind} "${a.actor.id}"${a.runId ? ` inside run ${a.runId}` : ""}` };
    if (!a.index) return { ok: false, code: "index-unavailable", reason: "the authority index is unavailable — failing closed" };
    return { ok: true, index: a.index, principalId: LOCAL_ROOT_ID };
  }
  // Spawning a server (T3): a human act like activation, but it creates a process, so it carries
  // the full precondition set: enablement, deployment invariant, live operator root, and the
  // TARGET slot's activation active, unsuspended, covering `mcp.server` under a live clamp. The
  // slot is the operator's explicit target (like activate/deactivate), never a caller's session.
  if (op === "mcp.start") {
    if (a.actor.kind !== "user" || a.runId) return { ok: false, code: "operator-only", reason: `mcp.start is a human decision: only a direct operator may do this, not ${a.actor.kind} "${a.actor.id}"${a.runId ? ` inside run ${a.runId}` : ""}` };
    if (!a.enabled) return { ok: false, code: "runtime-disabled", reason: "the capability runtime is not enabled (workbench.capability_runtime.enabled marker absent)" };
    if (!a.deploymentOk) return { ok: false, code: "deployment-invariant", reason: "the capability runtime is disabled: external PostgreSQL without an operator-declared single-writer deployment (§1.5)" };
    if (!a.index || !a.capabilityId) return { ok: false, code: "index-unavailable", reason: "the authority index is unavailable — failing closed" };
    const slot = a.index.activations.get(a.index.activationKey(a.capabilityId, "user", a.sessionId));
    if (!slot) return { ok: false, code: "no-activation", reason: `capability ${a.capabilityId} has no activation in this slot` };
    if (slot.state !== "active" || slot.suspensionReasons.length > 0) return { ok: false, code: slot.state === "suspended" || slot.suspensionReasons.length > 0 ? "suspended" : `inactive:${slot.state}`, reason: `activation of ${a.capabilityId} is ${slot.state}${slot.suspensionReasons.length ? ` (${slot.suspensionReasons.join(", ")})` : ""}` };
    if (!permissionCovered(slot.ceiling, "mcp.server")) return { ok: false, code: "beyond-ceiling", reason: `mcp.server exceeds the activation ceiling of ${a.capabilityId}` };
    const rootLive = liveAuthorityFor(a.index, slot, "mcp.server", a.nowMs);
    if (!rootLive.ok) return rootLive;
    return { ok: true, index: a.index, principalId: LOCAL_ROOT_ID, row: slot };
  }
  if (!a.enabled) return { ok: false, code: "runtime-disabled", reason: "the capability runtime is not enabled (workbench.capability_runtime.enabled marker absent)" };
  if (!a.deploymentOk) return { ok: false, code: "deployment-invariant", reason: "the capability runtime is disabled: external PostgreSQL without an operator-declared single-writer deployment (§1.5)" };
  if (!a.index) return { ok: false, code: "index-unavailable", reason: "the authority index is unavailable — failing closed" };
  const index = a.index;
  const principal = principalForActor(a.actor, a.runId);
  if (!principal.ok) return principal;
  if (op === "harness.resolve" || op === "harness.refresh") return { ok: true, index, principalId: principal.principalId };

  let row: ActivationRow | undefined;
  if ((op === "invoke" || op === "skill.load" || op === "harness.apply") && a.capabilityId) {
    const governing = governingActivation(index, a.capabilityId, "user", a.sessionId, a.actor.kind !== "user" || Boolean(a.runId));
    if (governing.blockedBy) return { ok: false, code: "suspended", reason: `activation of ${a.capabilityId} is suspended for session ${governing.blockedBy.sessionId} and this call carries no session — refusing (fail closed)` };
    row = governing.row;
    if (!row) return { ok: false, code: "no-activation", reason: `capability ${a.capabilityId} has no activation` };
    if (row.state !== "active" || row.suspensionReasons.length > 0) {
      const suspended = row.state === "suspended" || row.suspensionReasons.length > 0;
      return { ok: false, code: suspended ? "suspended" : `inactive:${row.state}`, reason: `activation of ${a.capabilityId} is ${row.state}${row.suspensionReasons.length ? ` (${row.suspensionReasons.join(", ")})` : ""}` };
    }
    if (a.permission && op !== "harness.apply" && !permissionCovered(row.ceiling, a.permission)) return { ok: false, code: "beyond-ceiling", reason: `${a.permission} exceeds the activation ceiling of ${a.capabilityId}` };
  }
  const live = liveGrant(index, principal.principalId, a.nowMs);
  if (!live.ok) return live;
  if (a.permission && !permissionCovered(live.grant.permissions, a.permission)) return { ok: false, code: "beyond-grant", reason: `${a.permission} exceeds the grant of ${principal.principalId}` };
  const root = liveGrant(index, LOCAL_ROOT_ID, a.nowMs, "operator root");
  if (!root.ok) return root;
  if (a.permission && !permissionCovered(root.grant.permissions, a.permission)) return { ok: false, code: "beyond-operator", reason: `${a.permission} exceeds the operator root's permissions` };
  if (row) {
    const clamp = liveClamp(index, row, a.nowMs);
    if (!clamp.ok) return clamp;
  }
  return { ok: true, index, principalId: principal.principalId, grant: live.grant, root: root.grant, ...(row ? { row } : {}) };
}

/** The session of a run, from the run's own start input (set by the turn that began it). */
export async function sessionOfRun(service: { getRun(caller: never, request: { runId: string }): Promise<{ input: unknown }> }, tenant: string, runId: string | undefined): Promise<string | undefined> {
  if (!runId) return undefined;
  try {
    const run = await service.getRun({ actor: { id: "system", kind: "system" }, tenant } as never, { runId });
    const value = (run.input as { sessionId?: unknown } | null)?.sessionId;
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}
