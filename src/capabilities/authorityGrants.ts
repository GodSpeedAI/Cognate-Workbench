// Capability-bundles tranche T1 (§1.2/§1.3/§1.5/§1.7): grant administration and the runtime
// enablement gate. Every command is operator-only (the shared guard). Grants are issued to
// responsible agent principals, are immutable once issued (adjustment is revoke + reissue),
// and revocation/expiry commits one CAS-atomic batch through the lifecycleRecorder — the
// suspensions of every activation clamped by the grant together with the grant record (§1.5;
// CUJ 12). `capability.runtime.enable` is the §1.7 predicate: refused unless the remediation
// evidence marker is present in the fold AND the store is a supported
// single-committing-process backend; unsupported modes fail closed (§1.5 deployment
// invariant — never a silent revocation gap).
import type { Component, HandlerContext, SemanticRef, CapabilityContract } from "@godspeedai/cognate-kernel-api";
import type { DurableStore } from "@godspeedai/cognate-events";
import { randomUUID } from "node:crypto";
import { requireOperator } from "../workbench/operatorGuard.ts";
import { LifecycleRecorder } from "../workbench/lifecycleRecorder.ts";
import type { AuthorityIndex } from "../workbench/authorityIndex.ts";

export const LOCAL_ROOT_ID = "wb-operator:root";
export const OPERATOR_ROOT_GRANT_ID = "grant-operator-root";

const GRANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PRINCIPAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
/** Structural v1 allowance sets (§1.3): what the level constants permit. A permission outside
 *  the set is refused at issue — the allowance family itself is deliberately not a record. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(["capability.invoke", "skill.load", "harness.modify", "bundle.create", "bundle.activate", "bundle.deactivate", "*"]);

export interface AuthorityGrantsOptions {
  /** Lazy accessors: the component is constructed in the createRuntime options list, before
   *  the runtime (and its store/index rebuild) exists. Handlers only run post-boot. */
  readonly getStore: () => DurableStore;
  readonly getIndex: () => AuthorityIndex;
  readonly tenant: string;
  /** §1.7 predicate input: reads the fold for the remediation marker (server wires this to the
   *  workbench projection; the component stays decoupled from projection plumbing). */
  readonly isRemediationVerified: () => boolean | Promise<boolean>;
  /** §1.5 predicate input: the supported single-committing-process store kinds. */
  readonly storeKind: "pg0" | "memory" | "external-postgres" | "external-postgres-single-writer";
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}

/** §1.5: an external PostgreSQL is a multi-writer store UNLESS the operator declares the deployment
 *  single-committing-process (`COGNATE_CAPABILITY_SINGLE_WRITER=1`) — a fact the operator asserts
 *  (one process on a dedicated database), never inferred. */
export function classifyCapabilityStore(env: Readonly<Record<string, string | undefined>>): AuthorityGrantsOptions["storeKind"] {
  if (!env.COGNATE_POSTGRES_URL) return "pg0";
  return env.COGNATE_CAPABILITY_SINGLE_WRITER === "1" ? "external-postgres-single-writer" : "external-postgres";
}

const CONTRACT_IDS = ["authority.grant.issue", "authority.grant.revoke", "authority.grant.list", "capability.runtime.enable"] as const;

export function authorityGrantsComponent(options: AuthorityGrantsOptions): Component {
  const contracts: CapabilityContract[] = CONTRACT_IDS.map((id) => ({ id, version: "1.0.0", semanticRef: options.semanticRefs?.[id] }));
  let recorderRef: LifecycleRecorder | undefined;
  const recorder = (): LifecycleRecorder => (recorderRef ??= new LifecycleRecorder(options.getStore(), options.tenant));
  const inRunEmit = (ctx: HandlerContext) =>
    ctx.runId ? (event: { readonly type: string; readonly payload: unknown }) => (ctx as { emit?: (t: string, p: unknown) => Promise<void> }).emit?.(event.type, event.payload) : undefined;

  return {
    id: "capability-runtime:authority",
    provides: contracts,
    activate(fiber) {
      const provide = <I, O>(id: (typeof CONTRACT_IDS)[number], handler: (input: I, ctx: HandlerContext) => Promise<O>) =>
        fiber.provide(contracts.find((c) => c.id === id) as CapabilityContract, async (raw, ctx) => handler(raw as I, ctx));

      provide("authority.grant.issue", async (input: { grantId?: string; principalId: string; permissions: readonly string[]; expiresAt?: string }, ctx) => {
        await requireOperator(ctx, "authority.grant.issue", inRunEmit(ctx));
        const grantId = input.grantId ?? `grant-${randomUUID().slice(0, 12)}`;
        if (!GRANT_ID.test(grantId) || !PRINCIPAL_ID.test(input.principalId)) throw new Error("authority.grant.issue: grant and principal ids must be safe identifiers");
        if (!input.principalId.startsWith("wb-agent:") && input.principalId !== LOCAL_ROOT_ID) throw new Error("authority.grant.issue: principals are wb-agent:* derivations or the operator root");
        const permissions = [...new Set(input.permissions)];
        if (permissions.length === 0) throw new Error("authority.grant.issue: a grant carries at least one permission");
        for (const permission of permissions) {
          if (!KNOWN_PERMISSIONS.has(permission)) throw new Error(`authority.grant.issue: unknown permission ${permission}`);
        }
        await recorder().commitBatch(grantId, [
          { type: "authority.grant.issued", payload: { grantId, principalId: input.principalId, permissions, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) } },
        ], `issue:${grantId}`);
        return { grantId, principalId: input.principalId, permissions };
      });

      provide("authority.grant.revoke", async (input: { grantId: string }, ctx) => {
        await requireOperator(ctx, "authority.grant.revoke", inRunEmit(ctx));
        await options.getIndex().ready;
        const grant = options.getIndex().grantFor(input.grantId);
        const byId = [...options.getIndex().grants.values()].find((g) => g.grantId === input.grantId);
        const target = grant ?? byId;
        if (!target || !target.grantId) throw new Error(`authority.grant.revoke: unknown grant ${input.grantId}`);
        // §1.5: suspend every activation whose clamp provenance names this grant, together with
        // the grant record, in one CAS-atomic batch (index pre-validation happens here).
        const suspensions: { capabilityId: string; level: string; sessionId?: string }[] = [];
        for (const row of options.getIndex().activations.values()) {
          if (row.clampProvenance === target.grantId && row.state === "active") {
            suspensions.push({ capabilityId: row.capabilityId, level: row.level, ...(row.sessionId ? { sessionId: row.sessionId } : {}) });
          }
        }
        await recorder().commitGrantRevocationBatch({ grantId: target.grantId, reason: "grant-revoked", suspensions });
        return { grantId: target.grantId, suspended: suspensions.length };
      });

      provide("authority.grant.list", async (_input, ctx) => {
        await requireOperator(ctx, "authority.grant.list", inRunEmit(ctx));
        await options.getIndex().ready;
        const grants: { grantId: string; principalId: string; permissions: readonly string[]; status: string }[] = [];
        for (const grant of options.getIndex().grants.values()) {
          if (grant.grantId) grants.push({ grantId: grant.grantId, principalId: grant.principalId, permissions: grant.permissions, status: grant.status });
        }
        return { grants };
      });

      provide("capability.runtime.enable", async (_input, ctx) => {
        await requireOperator(ctx, "capability.runtime.enable", inRunEmit(ctx));
        await options.getIndex().ready;
        // §1.7: (a) the remediation evidence marker must be present in the fold; (b) the store
        // must be a supported single-committing-process kind. Fail-closed on both.
        if ((await options.isRemediationVerified()) !== true) throw new Error("capability.runtime.enable: the remediation evidence marker is absent — the §1.6 prerequisite matrix has not passed on this build");
        if (options.storeKind === "external-postgres") throw new Error("capability.runtime.enable: external PostgreSQL is an unsupported multi-writer store for the capability runtime in v1 (§1.5 deployment invariant)");
        await recorder().commitBatch("runtime", [
          { type: "workbench.capability_runtime.enabled", payload: { enabledAt: new Date().toISOString(), storeKind: options.storeKind } },
        ], `enable:${randomUUID()}`);
        return { enabled: true };
      });
    },
  };
}

/** Boot seed (idempotent via the recorder's idempotency key): the operator's full-permission
 *  root grant — the operatorPermissions leg of every ceiling (§1.3), operator-governable. */
export function seedOperatorRootGrant(recorder: LifecycleRecorder): Promise<unknown> {
  return recorder.commitBatch(OPERATOR_ROOT_GRANT_ID, [{
    type: "authority.grant.issued",
    payload: { grantId: OPERATOR_ROOT_GRANT_ID, principalId: LOCAL_ROOT_ID, permissions: ["*"], seeded: true },
  }], `seed:${OPERATOR_ROOT_GRANT_ID}`);
}

/** Grant expiry sweep: called from the boot interval; expires grants whose wall clock passed
 *  `expiresAt`, producing the same CAS batch as revocation with reason `grant-expired`. */
export async function sweepExpiredGrants(recorder: LifecycleRecorder, index: AuthorityIndex, now = new Date()): Promise<number> {
  let expired = 0;
  for (const grant of index.grants.values()) {
    if (grant.status !== "active" || !grant.expiresAt) continue;
    if (new Date(grant.expiresAt).getTime() > now.getTime()) continue;
    const suspensions: { capabilityId: string; level: string; sessionId?: string }[] = [];
    for (const row of index.activations.values()) {
      if (row.clampProvenance === grant.grantId && row.state === "active") {
        suspensions.push({ capabilityId: row.capabilityId, level: row.level, ...(row.sessionId ? { sessionId: row.sessionId } : {}) });
      }
    }
    await recorder.commitGrantRevocationBatch({ grantId: grant.grantId, reason: "grant-expired", suspensions });
    expired += 1;
  }
  return expired;
}
