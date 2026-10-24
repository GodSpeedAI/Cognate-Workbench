// Durable identities and revocable sessions (J-AUTH-SESSION, J-AUTH-TENANT-ISOLATION).
//
// The bearer token a client presents is never trusted as an identity: it is a random opaque
// string the server minted, and the durable session record — stored as a verified SHA-256 hash,
// never in cleartext — is the only truth about who is calling. Authentication resolves the token
// to a live, unexpired, unrevoked session bound to one durable identity and its fixed tenant; a
// revoked or expired session is refused before any capability or service mutation, so a replayed
// captured request produces no durable effect. The ledger is system-owned: it lives in the
// operator tenant's thread space and is read pre-authentication with the system caller, never
// with a caller derived from the request.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

export const IDENTITY_THREAD = "auth:identity:v1";
export const SESSION_TOKEN_PREFIX = "wbs1.";
/** Operator browser sessions live one boot-to-boot day; anything longer extends the replay window. */
export const OPERATOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type SessionStatus = "active" | "revoked" | "expired";

export interface DurableIdentity {
  readonly id: string;
  readonly tenant: string;
  readonly actorId: string;
  readonly label: string | null;
  readonly createdAt: string;
}

export interface DurableSession {
  readonly sid: string;
  readonly identityId: string;
  /** SHA-256 of the minted token. The cleartext token exists only in the issue response. */
  readonly tokenHash: string;
  status: SessionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  revokedAt?: string;
  cause?: string;
}

export interface IdentityState { schema: 1; identities: Record<string, DurableIdentity>; sessions: Record<string, DurableSession> }

export class IdentityError extends Error {
  override readonly name = "IdentityError";
  constructor(readonly kind: "invalid_input" | "not_found" | "conflict", message: string) { super(message); }
}

export function emptyIdentityState(): IdentityState { return { schema: 1, identities: {}, sessions: {} }; }

export function isIdentityState(value: unknown): value is IdentityState {
  return !!value && typeof value === "object" && (value as Partial<IdentityState>).schema === 1
    && typeof (value as Partial<IdentityState>).identities === "object" && !Array.isArray((value as Partial<IdentityState>).identities)
    && typeof (value as Partial<IdentityState>).sessions === "object" && !Array.isArray((value as Partial<IdentityState>).sessions);
}

const TENANT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ACTOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Constant-time hash comparison: the stored hash and the presented token's hash are both
 *  fixed-length hex digests, but compare them without a data-dependent early exit anyway. */
export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintSessionToken(): string {
  return `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isSessionTokenFormat(token: unknown): token is string {
  if (typeof token !== "string" || !token.startsWith(SESSION_TOKEN_PREFIX)) return false;
  const body = token.slice(SESSION_TOKEN_PREFIX.length);
  return body.length >= 32 && body.length <= 128 && /^[A-Za-z0-9_-]+$/.test(body);
}

async function readIdentityState(service: RuntimeService, caller: Caller): Promise<{ state: IdentityState; version: number }> {
  const result = await service.readSharedState(caller, { threadId: IDENTITY_THREAD });
  if (result.version === 0) return { state: emptyIdentityState(), version: 0 };
  if (!isIdentityState(result.state)) throw new Error("Unsupported identity ledger schema; an explicit versioned migration is required");
  return { state: result.state as IdentityState, version: result.version };
}

/** Authentication happens on EVERY request, so a transient store blip (pool exhaustion under
 *  heavy parallel load) must not become a spurious 401 for a valid session: retry a transient
 *  failure once. A genuinely absent/revoked/expired session still refuses immediately. */
async function readIdentityStateForAuth(service: RuntimeService, caller: Caller): Promise<{ state: IdentityState; version: number }> {
  try {
    return await readIdentityState(service, caller);
  } catch (error) {
    if (error instanceof ServiceError && ["unavailable", "failed_precondition"].includes(error.code)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return await readIdentityState(service, caller);
    }
    throw error;
  }
}

async function writeIdentityState(service: RuntimeService, caller: Caller, state: IdentityState, version: number, idempotencyKey: string): Promise<boolean> {
  try {
    await service.updateSharedState(caller, { threadId: IDENTITY_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey });
    identityWriteEpoch += 1; // any write in this process invalidates cached session resolutions
    return true;
  } catch (error) {
    if (error instanceof ServiceError && ["failed_precondition", "unavailable"].includes(error.code)) return false;
    throw error;
  }
}

/** Process-local epoch of identity-ledger writes (bumped by every committed write above). Session
 *  resolution caches are validated against it, so a revocation issued by THIS process removes a
 *  cached resolution immediately — the revocation teeth hold exactly where they are tested. */
let identityWriteEpoch = 0;

/** Provision (or return the existing) durable identity for one tenant+actor. Idempotent. */
export async function ensureIdentity(service: RuntimeService, caller: Caller, input: { tenant: string; actorId: string; label?: string }): Promise<DurableIdentity> {
  if (!TENANT.test(input.tenant)) throw new IdentityError("invalid_input", "tenant must be a lowercase slug of 1-64 safe characters");
  if (!ACTOR.test(input.actorId)) throw new IdentityError("invalid_input", "actorId must be 1-64 safe characters");
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readIdentityState(service, caller);
    for (const identity of Object.values(state.identities)) {
      if (identity.tenant === input.tenant && identity.actorId === input.actorId) return identity;
    }
    const id = `identity-${createHash("sha256").update(`${input.tenant}\0${input.actorId}`).digest("hex").slice(0, 16)}`;
    const identity: DurableIdentity = { id, tenant: input.tenant, actorId: input.actorId, label: input.label ?? null, createdAt: new Date().toISOString() };
    state.identities[id] = identity;
    if (await writeIdentityState(service, caller, state, version, `identity-ensure:${id}:${version}`)) return identity;
  }
  throw new Error("Identity ledger is busy; retry provisioning");
}

export interface IssuedSession { readonly session: DurableSession; readonly token: string }

/** Issue one session for a provisioned identity. The cleartext token is returned exactly once. */
export async function issueSession(service: RuntimeService, caller: Caller, input: { identityId: string; ttlMs?: number; cause?: string }): Promise<IssuedSession> {
  const ttlMs = input.ttlMs ?? OPERATOR_SESSION_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 90 * 24 * 60 * 60 * 1000) throw new IdentityError("invalid_input", "session ttl must be between one minute and ninety days");
  const token = mintSessionToken();
  const tokenHash = sessionTokenHash(token);
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readIdentityState(service, caller);
    const identity = state.identities[input.identityId];
    if (!identity) throw new IdentityError("not_found", `identity ${input.identityId} is not provisioned`);
    const sid = `session-${createHash("sha256").update(`${input.identityId}\0${tokenHash}`).digest("hex").slice(0, 16)}`;
    if (state.sessions[sid]) throw new IdentityError("conflict", "session id collision; retry issuance");
    const now = new Date();
    const session: DurableSession = {
      sid, identityId: input.identityId, tokenHash, status: "active",
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      ...(input.cause ? { cause: input.cause } : {}),
    };
    state.sessions[sid] = session;
    if (await writeIdentityState(service, caller, state, version, `identity-issue:${sid}:${version}`)) return { session, token };
  }
  throw new Error("Identity ledger is busy; retry issuance");
}

/** Revoke one session (or mark it expired). Revocation is durable and immediate for new requests. */
export async function revokeSession(service: RuntimeService, caller: Caller, sid: string, cause: string): Promise<DurableSession> {
  if (typeof sid !== "string" || !/^[A-Za-z0-9-]+$/.test(sid)) throw new IdentityError("invalid_input", "session id is malformed");
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readIdentityState(service, caller);
    const session = state.sessions[sid];
    if (!session) throw new IdentityError("not_found", `session ${sid} does not exist`);
    if (session.status === "revoked") return session;
    const revoked: DurableSession = { ...session, status: "revoked", revokedAt: new Date().toISOString(), cause };
    state.sessions[sid] = revoked;
    if (await writeIdentityState(service, caller, state, version, `identity-revoke:${sid}:${version}`)) return revoked;
  }
  throw new Error("Identity ledger is busy; retry revocation");
}

export interface ResolvedSession { readonly caller: Caller; readonly session: DurableSession }

/** Resolve a presented bearer token against the durable ledger. Refused tokens return undefined:
 *  unknown format, unknown hash, revoked, expired, or a session whose identity is missing. The
 *  caller is derived from the durable identity only — never from any client-supplied string. */
export async function authenticateSessionToken(service: RuntimeService, systemCaller: Caller, token: string): Promise<ResolvedSession | undefined> {
  if (!isSessionTokenFormat(token)) return undefined;
  const { state } = await readIdentityStateForAuth(service, systemCaller);
  const tokenHash = sessionTokenHash(token);
  let session: DurableSession | undefined;
  for (const candidate of Object.values(state.sessions)) {
    if (candidate.tokenHash.length === tokenHash.length && timingSafeEqual(Buffer.from(candidate.tokenHash), Buffer.from(tokenHash))) { session = candidate; break; }
  }
  if (!session) return undefined;
  if (session.status === "revoked") return undefined;
  if (session.status === "expired" || Date.parse(session.expiresAt) <= Date.now()) return undefined;
  const identity = state.identities[session.identityId];
  if (!identity) return undefined;
  return { caller: { tenant: identity.tenant, actor: { id: identity.actorId, kind: "user" } }, session };
}

/**
 * The request-boundary session authenticator: the durable ledger stays the truth, but a resolved
 * token caches its caller for at most two seconds AND only until the next identity-ledger write
 * in this process. Revocation therefore takes effect immediately in the process that revoked (the
 * production single-process posture, and what the revocation journey proves); a second process
 * may serve one cached resolution for at most two seconds after a cross-process revocation — a
 * documented read-lag boundary, the same freshness class as any read-replicated ledger. This
 * read-through keeps a busy UI (which polls continuously) from re-reading the ledger on every
 * request without ever widening who a token resolves to.
 */
export function createSessionAuthenticator(service: RuntimeService, systemCaller: Caller): (token: string) => Promise<Caller | undefined> {
  const cache = new Map<string, { readonly caller: Caller; readonly expiresAtMs: number; readonly cachedAtMs: number; readonly epoch: number }>();
  return async (token) => {
    if (!isSessionTokenFormat(token)) return undefined;
    const now = Date.now();
    const cached = cache.get(token);
    if (cached && cached.epoch === identityWriteEpoch && now < cached.expiresAtMs && now - cached.cachedAtMs < 2_000) return cached.caller;
    const resolved = await authenticateSessionToken(service, systemCaller, token);
    if (!resolved) {
      cache.delete(token); // never cache a refusal: revocation/expiry must never gain slack
      return undefined;
    }
    cache.set(token, { caller: resolved.caller, expiresAtMs: Date.parse(resolved.session.expiresAt), cachedAtMs: now, epoch: identityWriteEpoch });
    return resolved.caller;
  };
}

/** Boot-time hygiene: mark sessions past their expiry as expired (they are already refused;
 *  this makes the ledger's own status truthful for inspection) and prune sessions that ended
 *  (expired or revoked) more than 30 days ago so the ledger stays bounded. Returns how many aged. */
export async function ageExpiredSessions(service: RuntimeService, systemCaller: Caller): Promise<number> {
  let aged = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readIdentityState(service, systemCaller);
    const now = Date.now();
    const stale = Object.values(state.sessions).filter(s => s.status === "active" && Date.parse(s.expiresAt) <= now);
    const ancientCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const ancient = Object.values(state.sessions).filter(s => s.status !== "active" && Date.parse(s.revokedAt ?? s.expiresAt) < ancientCutoff);
    if (stale.length === 0 && ancient.length === 0) return aged;
    for (const session of stale) state.sessions[session.sid] = { ...session, status: "expired" as SessionStatus };
    for (const session of ancient) delete state.sessions[session.sid];
    if (await writeIdentityState(service, systemCaller, state, version, `identity-age:${[...stale, ...ancient].map(s => s.sid).sort().join(",")}:${version}`)) return stale.length;
  }
  throw new Error("Identity ledger is busy; retry expiry aging");
}

/** Boot hygiene: supersede the previous boot's browser-entry sessions so a restart invalidates
 *  the token an old browser entry (or a stolen copy of it) still holds. Operator-issued device
 *  sessions are untouched — only this-marked boot sessions are revoked. */
export async function supersedeBootSessions(service: RuntimeService, caller: Caller, identityId: string): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, version } = await readIdentityState(service, caller);
    const stale = Object.values(state.sessions).filter(s => s.status === "active" && s.identityId === identityId && s.cause === BOOT_SESSION_CAUSE);
    if (stale.length === 0) return 0;
    for (const session of stale) state.sessions[session.sid] = { ...session, status: "revoked" as SessionStatus, revokedAt: new Date().toISOString(), cause: "superseded by a later boot" };
    if (await writeIdentityState(service, caller, state, version, `identity-supersede:${stale.map(s => s.sid).sort().join(",")}:${version}`)) return stale.length;
  }
  throw new Error("Identity ledger is busy; retry boot supersession");
}

/** Cause marking this boot's browser-entry session (see supersedeBootSessions). */
export const BOOT_SESSION_CAUSE = "browser entry session for this boot";

/** Public, sanitized inspection. Never exposes token hashes or any credential material. */
export function identityOverview(state: IdentityState): {
  readonly identities: readonly { readonly id: string; readonly tenant: string; readonly actorId: string; readonly label: string | null; readonly createdAt: string }[];
  readonly sessions: readonly { readonly sid: string; readonly identityId: string; readonly tenant: string; readonly actorId: string; readonly status: SessionStatus; readonly createdAt: string; readonly expiresAt: string; readonly revokedAt?: string; readonly cause?: string }[];
} {
  const identities = Object.values(state.identities).map(({ id, tenant, actorId, label, createdAt }) => ({ id, tenant, actorId, label, createdAt })).sort((a, b) => a.id.localeCompare(b.id));
  const sessions = Object.values(state.sessions).map(session => {
    const identity = state.identities[session.identityId];
    return {
      sid: session.sid, identityId: session.identityId, status: session.status,
      createdAt: session.createdAt, expiresAt: session.expiresAt,
      ...(session.revokedAt ? { revokedAt: session.revokedAt } : {}), ...(session.cause ? { cause: session.cause } : {}),
      tenant: identity?.tenant ?? "unknown", actorId: identity?.actorId ?? "unknown",
    };
  }).sort((a, b) => a.sid.localeCompare(b.sid));
  return { identities, sessions };
}

export async function readIdentityOverview(service: RuntimeService, caller: Caller): Promise<ReturnType<typeof identityOverview>> {
  const { state } = await readIdentityState(service, caller);
  return identityOverview(state);
}
