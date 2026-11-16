// Capability-bundles tranche T1 (§1.5): the lifecycleRecorder — the narrow, app-owned write
// adapter for the six lifecycle-critical transition families (activate, re-point,
// suspend/resume/deactivate, uninstall, grant revocation/expiry batch, enablement/remediation
// markers). It calls the store's conditional-commit API directly: per-record/stream
// `expectedVersion` CAS and atomic append batches, which the store conformance suite proves.
// The general recording path (`agent.config` runs via ctx.emit) exposes neither primitive,
// which is why this adapter exists — the split and its rationale are recorded in §1.5 and the
// §9.2 inventory.
//
// Recorder discipline (verified against the store contract): full event envelopes are
// constructed here (an invalid envelope fails the whole batch before anything is written);
// idempotency keys guard the CAS retries (a post-commit crash before recording success must
// not re-apply facts); stream ids are NEVER run-shaped (run-enrolled streams are fenced behind
// the runOwnership credential, which this recorder deliberately routes around); and the
// commit-hook listeners that feed the authority index are pure in-memory updates — a listener
// that itself commits would be deferred past the current commit's synchronous window.
import type { DurableStore, NewEvent, StoredEvent } from "@godspeedai/cognate-events";
import { createHash, randomUUID } from "node:crypto";

export interface LifecycleEventInput {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export class LifecycleCommitError extends Error {
  constructor(readonly stage: "pre-state" | "cas" | "envelope", message: string) {
    super(message);
  }
}

export class LifecycleRecorder {
  constructor(readonly store: DurableStore, readonly tenant: string) {}

  /** One CAS-atomic batch: every event lands or none does. Pre-state validation is the
   *  caller's contract (validate against the authority index immediately before calling);
   *  a stale stream version throws LifecycleCommitError("cas") and the caller retries against
   *  the re-read index. */
  async commitBatch(capabilityId: string, events: readonly LifecycleEventInput[], idempotencyKey?: string): Promise<readonly StoredEvent[]> {
    const streamId = `wb-lifecycle:${capabilityId}`;
    const prior = await this.store.readStream(streamId);
    const occurredAt = new Date().toISOString();
    const correlationId = idempotencyKey ?? randomUUID();
    const batch: readonly NewEvent[] = events.map((event) => ({
      eventType: event.type,
      schemaVersion: 1,
      occurredAt,
      tenant: this.tenant,
      correlationId,
      causationId: null,
      runId: null,
      scopeId: capabilityId,
      payload: event.payload as never,
    }));
    const key = idempotencyKey ?? randomUUID();
    const outcome = await this.store.commit({
      appends: [{ streamId, expectedVersion: prior.length, events: batch }],
      idempotency: { scope: `wb-lifecycle:${capabilityId}`, key, fingerprint: createHash("sha256").update(JSON.stringify(batch.map((e) => ({ eventType: e.eventType, payload: e.payload })))).digest("hex") },
    });
    if (outcome.kind === "duplicate") return outcome.events;
    return outcome.events;
  }

  /** Grant revocation/expiry batch (§1.5): the suspensions of every activation clamped by the
   *  grant commit TOGETHER WITH the grant record — one append batch, one atomic decision.
   *  The index pre-validation must be done by the caller immediately before this call. */
  commitGrantRevocationBatch(args: { grantId: string; reason: "grant-revoked" | "grant-expired"; suspensions: readonly { capabilityId: string; level: string; sessionId?: string }[] }, idempotencyKey?: string): Promise<readonly StoredEvent[]> {
    const events: LifecycleEventInput[] = args.suspensions.map((s) => ({
      type: "capability.suspended",
      payload: { capabilityId: s.capabilityId, level: s.level, ...(s.sessionId ? { sessionId: s.sessionId } : {}), reason: args.reason },
    }));
    events.push({ type: args.reason === "grant-expired" ? "authority.grant.expired" : "authority.grant.revoked", payload: { grantId: args.grantId } });
    return this.commitBatch(args.grantId, events, idempotencyKey ?? `revoke:${args.grantId}`);
  }
}
