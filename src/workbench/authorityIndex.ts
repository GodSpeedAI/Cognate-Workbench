// Capability-bundles tranche T1 (§2.1): the commit-synchronous authority index — the one read
// model `decideCapabilityInvocation` may consult. Two in-memory maps (grants per principal;
// activations keyed `capability|level|session`) plus a monotonic capability-event sequence
// number, updated synchronously inside the store's commit listener so every enforcement point
// sees committed state with no fold-lag window. Boot rebuilds from the workbench projection
// fold (boot-time reads are not latency-bound); replay-equality between fold and index is
// asserted by test/workbench-authority-index.test.ts. Any inability to answer fails closed.
// Deployment invariant (§1.5): commit-synchronicity holds for the committing process — the
// enablement gate refuses unsupported multi-writer stores (external PostgreSQL) in v1.
import type { DurableStore, StoredEvent } from "@godspeedai/cognate-events";

export interface GrantRow {
  readonly grantId: string;
  readonly principalId: string;
  readonly permissions: readonly string[];
  readonly status: "active" | "revoked" | "expired";
  readonly expiresAt?: string;
  readonly recordedAt: string;
}

export interface ActivationRow {
  readonly capabilityId: string;
  readonly level: string;
  readonly sessionId?: string;
  readonly version: string;
  readonly ceiling: readonly string[];
  readonly clampProvenance: string;
  readonly state: "active" | "suspended" | "dormant" | "retired" | "expired";
  readonly suspensionReasons: readonly string[];
}

const ACTIVATION_FAMILIES = new Set([
  "capability.activated", "capability.repointed", "capability.suspended", "capability.resumed",
  "capability.deactivated", "capability.uninstalled", "session.activation",
]);
const GRANT_FAMILIES = new Set(["authority.grant.issued", "authority.grant.revoked", "authority.grant.expired"]);

export class AuthorityIndex {
  readonly grants = new Map<string, GrantRow>();
  readonly activations = new Map<string, ActivationRow>();
  /** Resolves when the boot rebuild completes; index readers await it so the fire-and-forget
   *  boot rebuild (which must not block server boot under full-suite parallelism) stays
   *  deterministic for handlers. */
  ready: Promise<void> = Promise.resolve();
  #sequence = 0;
  #unlisten: (() => void) | undefined;

  constructor(readonly store: DurableStore, readonly tenant: string) {}

  /** Boot: rebuild from the workbench projection fold (the reducer's rows are the fold truth),
   *  then subscribe to the commit hook for synchronous deltas. Fire-and-forget from boot —
   *  readers await `ready`. */
  rebuild(rows: readonly { key: string; value: unknown }[]): Promise<void> {
    this.ready = this.#rebuild(rows);
    return this.ready;
  }

  async #rebuild(rows: readonly { key: string; value: unknown }[]): Promise<void> {
    // Idempotent (R3-1): one entry per grant id and one commit subscription, however often it runs.
    this.#unlisten?.();
    this.#unlisten = undefined;
    this.grants.clear();
    this.activations.clear();
    for (const row of rows) {
      if (row.key.startsWith("activation/")) {
        const v = row.value as ActivationRow;
        this.activations.set(this.activationKey(v.capabilityId, v.level, v.sessionId), v);
        this.#sequence += 1;
      } else if (row.key.startsWith("grant/")) {
        const v = row.value as GrantRow;
        this.grants.set(this.grantKey(v.grantId), v);
        this.#sequence += 1;
      }
    }
    this.#unlisten = this.store.onCommitted((events: readonly StoredEvent[]) => {
      for (const event of events) {
        if (ACTIVATION_FAMILIES.has(event.eventType) || GRANT_FAMILIES.has(event.eventType) || event.eventType === "session.archived") this.#sequence += 1;
        if (event.tenant !== this.tenant) continue;
        const p = (event.payload ?? {}) as Record<string, unknown>;
        if (event.eventType === "authority.grant.issued") {
          const grant: GrantRow = {
            grantId: String(p.grantId ?? ""), principalId: String(p.principalId ?? ""),
            permissions: (p.permissions as readonly string[] | undefined) ?? [],
            status: "active", expiresAt: p.expiresAt ? String(p.expiresAt) : undefined, recordedAt: event.recordedAt,
          };
          if (grant.grantId) this.grants.set(this.grantKey(grant.grantId), grant);
        } else if (event.eventType === "authority.grant.revoked" || event.eventType === "authority.grant.expired") {
          const grantId = String(p.grantId ?? "");
          const grant = this.grants.get(this.grantKey(grantId));
          if (grant) this.grants.set(this.grantKey(grantId), { ...grant, status: event.eventType === "authority.grant.expired" ? "expired" : "revoked" });
        } else if (event.eventType === "capability.activated") {
          const row: ActivationRow = {
            capabilityId: String(p.capabilityId ?? ""), level: String(p.level ?? "user"),
            sessionId: typeof p.sessionId === "string" ? p.sessionId : undefined,
            version: String(p.version ?? ""), ceiling: (p.ceiling as readonly string[] | undefined) ?? [],
            clampProvenance: String(p.clampProvenance ?? "operator"), state: "active", suspensionReasons: [],
          };
          if (row.capabilityId) this.activations.set(this.activationKey(row.capabilityId, row.level, row.sessionId), row);
        } else if (event.eventType === "capability.repointed") {
          const row = this.activations.get(this.activationKey(String(p.capabilityId ?? ""), String(p.level ?? "user"), typeof p.sessionId === "string" ? p.sessionId : undefined));
          if (row && p.to) this.activations.set(this.activationKey(row.capabilityId, row.level, row.sessionId), { ...row, version: String(p.to) });
        } else if (event.eventType === "capability.suspended") {
          const row = this.activations.get(this.activationKey(String(p.capabilityId ?? ""), String(p.level ?? "user"), typeof p.sessionId === "string" ? p.sessionId : undefined));
          if (row) {
            const reasons = new Set([...row.suspensionReasons, String(p.reason ?? "operator-yank")]);
            this.activations.set(this.activationKey(row.capabilityId, row.level, row.sessionId), { ...row, state: "suspended", suspensionReasons: [...reasons] });
          }
        } else if (event.eventType === "capability.resumed") {
          const row = this.activations.get(this.activationKey(String(p.capabilityId ?? ""), String(p.level ?? "user"), typeof p.sessionId === "string" ? p.sessionId : undefined));
          if (row) {
            const reasons = row.suspensionReasons.filter((r) => r !== String(p.clearedReason ?? ""));
            this.activations.set(this.activationKey(row.capabilityId, row.level, row.sessionId), { ...row, state: reasons.length === 0 ? "active" : "suspended", suspensionReasons: reasons });
          }
        } else if (event.eventType === "capability.deactivated" || event.eventType === "capability.uninstalled") {
          const row = this.activations.get(this.activationKey(String(p.capabilityId ?? ""), String(p.level ?? "user"), typeof p.sessionId === "string" ? p.sessionId : undefined));
          if (row) this.activations.set(this.activationKey(row.capabilityId, row.level, row.sessionId), { ...row, state: event.eventType === "capability.uninstalled" ? "retired" : "dormant", suspensionReasons: [] });
        } else if (event.eventType === "session.archived") {
          const sessionId = String(p.sessionId ?? "");
          for (const [key, row] of this.activations) {
            if (row.sessionId === sessionId) this.activations.set(key, { ...row, state: "expired" });
          }
        }
      }
    });
  }

  stop(): void {
    this.#unlisten?.();
    this.#unlisten = undefined;
  }

  activationKey(capabilityId: string, level: string, session?: string): string {
    return `${capabilityId}|${level}|${session ?? ""}`;
  }

  private grantKey(grantId: string): string {
    return `grant:${grantId}`;
  }

  /** The invoking actor's grant (trusted, durable). */
  grantFor(principalId: string): GrantRow | undefined {
    for (const grant of this.grants.values()) {
      if (grant.principalId === principalId && grant.status === "active") return grant;
    }
    return undefined;
  }

  /** §4.1 row selection (total): an invocation bound to session S consults the session-scoped
   *  row when one exists — whatever its state (an expired row governs and refuses); only when
   *  no session-scoped row exists does the persistent row govern. */
  selectActivation(capabilityId: string, level: string, sessionId?: string): ActivationRow | undefined {
    if (sessionId) {
      const sessionRow = this.activations.get(this.activationKey(capabilityId, level, sessionId));
      if (sessionRow) return sessionRow;
    }
    return this.activations.get(this.activationKey(capabilityId, level, ""));
  }

  sequence(): number {
    return this.#sequence;
  }
}
