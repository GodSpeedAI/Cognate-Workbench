# auth (Durable Identities and Revocable Sessions)

## Overview

Durable identity and session ledger for the workbench (journeys J-AUTH-SESSION,
J-AUTH-TENANT-ISOLATION). The bearer token a client presents is never trusted
as an identity: it is a random opaque string the server minted, and the durable
session record — stored as a verified SHA-256 hash, never in cleartext — is the
only truth about who is calling. The ledger lives in the operator tenant's
shared-state thread ([identity.ts:IDENTITY_THREAD]) and is read
pre-authentication with the system caller, never with a caller derived from the
request. Authentication resolves a token to a live, unexpired, unrevoked
session bound to one durable identity and its fixed tenant. This is the
single-operator development authenticator: a known security limitation, not
production hardening.

## Interface

- [identity.ts:IDENTITY_THREAD] — ledger thread id `"auth:identity:v1"`.
- [identity.ts:SESSION_TOKEN_PREFIX] — minted token prefix `"wbs1."`.
- [identity.ts:OPERATOR_SESSION_TTL_MS] — default operator session TTL (24 hours).
- [identity.ts:SessionStatus] — `"active" | "revoked" | "expired"`.
- [identity.ts:DurableIdentity], [identity.ts:DurableSession] — ledger record types (`tokenHash` is the SHA-256 of the minted token; the cleartext token exists only in the issue response).
- [identity.ts:IdentityState] — `{ schema: 1, identities, sessions }`; [identity.ts:emptyIdentityState] constructs it; [identity.ts:isIdentityState] validates the shape and rejects other schema versions.
- [identity.ts:IdentityError] — error class with `kind: "invalid_input" | "not_found" | "conflict"`.
- [identity.ts:sessionTokenHash] — SHA-256 hex digest of a token.
- [identity.ts:mintSessionToken] — mints `SESSION_TOKEN_PREFIX` + 32 random bytes (base64url).
- [identity.ts:isSessionTokenFormat] — format gate: prefix plus 32–128 base64url characters.
- [identity.ts:ensureIdentity] — idempotent provisioning of one identity per tenant+actor pair (deterministic id derived from a SHA-256 of `tenant\0actorId`).
- [identity.ts:issueSession] — issues one session for a provisioned identity; returns [identity.ts:IssuedSession] (cleartext token returned exactly once); TTL must be between one minute and ninety days.
- [identity.ts:revokeSession] — durable, immediate revocation with a `cause`; idempotent for already-revoked sessions.
- [identity.ts:authenticateSessionToken] — resolves a bearer token against the ledger; returns [identity.ts:ResolvedSession] or `undefined` for unknown format, unknown hash, revoked, expired, or missing identity.
- [identity.ts:createSessionAuthenticator] — request-boundary authenticator with a process-local read-through cache (at most two seconds, invalidated on the next identity-ledger write in this process); refusals are never cached.
- [identity.ts:ageExpiredSessions] — boot-time hygiene: marks past-expiry sessions `expired` and prunes ended sessions older than 30 days.
- [identity.ts:supersedeBootSessions] — revokes the previous boot's browser-entry sessions ([identity.ts:BOOT_SESSION_CAUSE]); device sessions are untouched.
- [identity.ts:identityOverview] / [identity.ts:readIdentityOverview] — sanitized inspection; never exposes token hashes or credential material.
- Private (not exported): [identity.ts:readIdentityState], [identity.ts:readIdentityStateForAuth] (one retry on transient `unavailable`/`failed_precondition`), [identity.ts:writeIdentityState] (version-checked compare-and-swap via `service.updateSharedState`), and the module-local `identityWriteEpoch` counter.

## Invariants

- The bearer token is never trusted as identity; the durable session record's `tokenHash` is the only truth (file header of [identity.ts:authenticateSessionToken]).
- Tokens are stored as SHA-256 hashes, never in cleartext ([identity.ts:DurableSession.tokenHash]); [identity.ts:issueSession] returns the cleartext token exactly once.
- Ledger reads pre-authentication use the system caller, never a caller derived from the request (file header of [identity.ts:authenticateSessionToken]).
- Hash comparison uses `timingSafeEqual` with an explicit length check — no data-dependent early exit ([identity.ts:authenticateSessionToken]).
- A revoked or expired session is refused before any capability or service mutation; [identity.ts:authenticateSessionToken] returns `undefined` for `revoked` status, `expired` status, `expiresAt` in the past, or a missing identity.
- Tenant and actor id formats are enforced by the regexes [identity.ts:TENANT] `/^[a-z0-9][a-z0-9._-]{0,63}$/` and [identity.ts:ACTOR] `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` in [identity.ts:ensureIdentity]; session TTL is bounded to 1 minute–90 days in [identity.ts:issueSession].
- Ledger writes are version-checked compare-and-swap operations ([identity.ts:writeIdentityState] passes `expectedVersion` and an idempotency key); optimistic-concurrency retries are bounded at 30 attempts before a busy error.
- The authenticator cache is validated against `identityWriteEpoch`, so a revocation issued by this process removes a cached resolution immediately; a refusal is never cached; cross-process staleness is bounded at two seconds (documented read-lag boundary, cache logic in [identity.ts:createSessionAuthenticator]).
- A transient store failure during authentication is retried once (25 ms delay) for `unavailable`/`failed_precondition` codes only ([identity.ts:readIdentityStateForAuth]); a genuinely absent/revoked/expired session still refuses immediately.
- An unsupported ledger schema version throws and requires an explicit versioned migration ([identity.ts:readIdentityState]).

## Side Effects

- Reads and writes the shared-state thread [identity.ts:IDENTITY_THREAD] via `service.readSharedState` and `service.updateSharedState` (the durable PostgreSQL-backed ledger through the Cognate runtime).
- `setTimeout` 25 ms delay inside the single transient retry of [identity.ts:readIdentityStateForAuth].
- Process-local mutation: `identityWriteEpoch` is incremented by every committed ledger write, invalidating cached session resolutions in this process.
- [identity.ts:createSessionAuthenticator] keeps a process-local `Map` cache of token → caller (bounded by session expiry, two seconds, and the write epoch).
- [identity.ts:mintSessionToken] consumes `node:crypto` `randomBytes` (randomness); [identity.ts:sessionTokenHash] consumes `createHash`.
- [identity.ts:ageExpiredSessions] and [identity.ts:supersedeBootSessions] mutate ledger records (status changes and pruning) during boot hygiene.
- No network, filesystem, or lock side effects originate in this module itself.

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-AUTH-SESSION.test.ts`, `test/J-AUTH-TENANT-ISOLATION.test.ts`, and `test/J-AUTH-REBIND.test.ts` (all verified present under `test/`).
