// J-AUTH-SESSION / J-AUTH-TENANT-ISOLATION: the operator's identity-administration capabilities.
// `identity.session.issue` provisions a durable identity (idempotently) and returns a server-minted
// session token exactly once; `identity.session.revoke` revokes durably (refused from the next
// request on); `identity.inspect` is a sanitized ledger read (never token material). All three are
// direct human-operator acts — a run context is refused, exactly like contained-workspace
// selection: agents cannot mint or revoke sessions.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ensureIdentity, issueSession, readIdentityOverview, revokeSession } from "../auth/identity.ts";

export interface IdentityAdminOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** The one durable operator identity that may administer sessions (defense in depth: the
   *  capability policy already restricts these grants; this check survives policy edits). */
  readonly operatorTenant: string;
  readonly operatorActorId: string;
  readonly semanticRefs: { readonly issue?: SemanticRef; readonly revoke?: SemanticRef; readonly inspect?: SemanticRef };
}

export function identityAdminComponent(options: IdentityAdminOptions): Component {
  const issue = { id: "identity.session.issue", version: "1.0.0", semanticRef: options.semanticRefs.issue };
  const revoke = { id: "identity.session.revoke", version: "1.0.0", semanticRef: options.semanticRefs.revoke };
  const inspect = { id: "identity.inspect", version: "1.0.0", semanticRef: options.semanticRefs.inspect };
  const operatorOnly = (ctx: { readonly actor?: { readonly kind?: string; readonly id?: string }; readonly tenant?: string; readonly runId?: string }, capability: string) => {
    if (ctx.actor?.kind !== "user" || ctx.runId) throw new Error(`${capability}: only a direct human operator may administer sessions`);
    if (ctx.tenant !== options.operatorTenant || ctx.actor.id !== options.operatorActorId) {
      throw new Error(`${capability}: session administration belongs to the operator identity only`);
    }
  };
  return {
    id: "identity:admin",
    provides: [issue, revoke, inspect],
    activate(fiber) {
      fiber.provide(issue, async (rawInput, ctx) => {
        operatorOnly(ctx, issue.id);
        const input = rawInput as { readonly tenant?: unknown; readonly actorId?: unknown; readonly label?: unknown; readonly ttlHours?: unknown; readonly cause?: unknown };
        if (!input || typeof input !== "object") throw new Error(`${issue.id}: tenant, actorId and optional label are required`);
        // Strict input: an unknown field is refused, never ignored — smuggled authority is a
        // rejection, not a silent drop.
        if (Object.keys(input).some(key => !["tenant", "actorId", "label", "ttlHours", "cause"].includes(key))) {
          throw new Error(`${issue.id}: unknown field; accepts tenant, actorId, label, ttlHours, cause only`);
        }
        const tenant = input.tenant;
        const actorId = input.actorId;
        if (typeof tenant !== "string" || typeof actorId !== "string") throw new Error(`${issue.id}: tenant and actorId are required strings`);
        if (input.label !== undefined && (typeof input.label !== "string" || input.label.length > 128)) throw new Error(`${issue.id}: label must be a short string`);
        if (input.ttlHours !== undefined && (typeof input.ttlHours !== "number" || !Number.isFinite(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > 24 * 90)) throw new Error(`${issue.id}: ttlHours must be between 1 and 2160`);
        if (input.cause !== undefined && (typeof input.cause !== "string" || input.cause.length > 256)) throw new Error(`${issue.id}: cause must be a short string`);
        // The operator tenant has exactly one human. Issuing a session for another actor inside it
        // would create a second identity whose settings writes land in the operator's partition —
        // the one place tenant partitioning does not isolate capability consequences. Refused.
        if (tenant === options.operatorTenant && actorId !== options.operatorActorId) {
          throw new Error(`${issue.id}: the operator tenant has exactly one human identity (${options.operatorActorId}); provision second humans in their own tenant`);
        }
        const service = options.getService();
        const identity = await ensureIdentity(service, options.systemCaller, { tenant, actorId, ...(input.label !== undefined ? { label: input.label } : {}) });
        const issued = await issueSession(service, options.systemCaller, {
          identityId: identity.id,
          ...(input.ttlHours !== undefined ? { ttlMs: Math.round(input.ttlHours * 60 * 60 * 1000) } : {}),
          ...(input.cause !== undefined ? { cause: input.cause } : { cause: "operator-issued" }),
        });
        // The one place a cleartext token is returned to a caller. It is never persisted.
        return { sessionId: issued.session.sid, identityId: identity.id, tenant: identity.tenant, actorId: identity.actorId, token: issued.token, expiresAt: issued.session.expiresAt };
      });
      fiber.provide(revoke, async (rawInput, ctx) => {
        operatorOnly(ctx, revoke.id);
        const input = rawInput as { readonly sessionId?: unknown; readonly cause?: unknown };
        if (!input || typeof input !== "object") throw new Error(`${revoke.id}: sessionId is required`);
        if (Object.keys(input).some(key => !["sessionId", "cause"].includes(key))) {
          throw new Error(`${revoke.id}: unknown field; accepts sessionId and cause only`);
        }
        if (typeof input.sessionId !== "string") throw new Error(`${revoke.id}: sessionId is required`);
        if (input.cause !== undefined && (typeof input.cause !== "string" || input.cause.length > 256)) throw new Error(`${revoke.id}: cause must be a short string`);
        const session = await revokeSession(options.getService(), options.systemCaller, input.sessionId, input.cause ?? "operator-revoked");
        return { sessionId: session.sid, status: session.status, revokedAt: session.revokedAt ?? null };
      });
      fiber.provide(inspect, async (_rawInput, ctx) => {
        operatorOnly(ctx, inspect.id);
        return readIdentityOverview(options.getService(), options.systemCaller);
      });
    },
  };
}
