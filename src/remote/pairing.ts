/**
 * Pairing state for the phone remote: the pairing link (single use, five minutes), the generation
 * that every link, device credential and session is bound to, and the short-lived WebAuthn
 * challenges. Everything here is in memory; a restart drops it all.
 *
 * Only the SHA-256 verifier of a pairing secret is kept for checking. The plain secret is held in
 * memory alone so the desktop panel can show the same link again until it is redeemed, expires,
 * or is replaced.
 */
import { createHash, randomBytes } from "node:crypto";
import { b64url, equalBytes, fromB64url, newChallenge } from "./webauthn.ts";

export const PAIRING_TTL_MS = 5 * 60_000;
export const CHALLENGE_TTL_MS = 2 * 60_000;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type ChallengeKind = "register" | "auth";
export type RedeemResult =
  | { readonly ok: true; readonly ticket: string; readonly challenge: Uint8Array; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: "off" | "used" | "expired" | "invalid" };

interface Challenge {
  readonly challenge: Uint8Array;
  readonly kind: ChallengeKind;
  readonly generation: number;
  readonly expiresAt: number;
}

function verifierOf(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(fromB64url(secret)).digest());
}

export class Pairing {
  /** Bumped by every refresh and every stop; a value from an older generation is never honoured. */
  generation = 0;
  private enabled = false;
  private verifier: Uint8Array | null = null;
  private secret: string | null = null;
  private expiresAt = 0;
  private dead: { readonly verifier: Uint8Array; readonly reason: "used" | "expired" } | null = null;
  private readonly challenges = new Map<string, Challenge>();

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Turn remote control on: a new generation (above `floor`, the highest stored one) and a new pairing link. */
  start(now: number, floor = 0): { readonly secret: string; readonly expiresAt: number; readonly generation: number } {
    this.generation = Math.max(this.generation, floor);
    this.enabled = true;
    return this.refresh(now);
  }

  /** A new link and a new generation: every prior link, credential and session stops working. */
  refresh(now: number): { readonly secret: string; readonly expiresAt: number; readonly generation: number } {
    this.generation += 1;
    this.challenges.clear();
    this.secret = b64url(randomBytes(32));
    this.verifier = verifierOf(this.secret);
    this.expiresAt = now + PAIRING_TTL_MS;
    this.dead = null;
    return { secret: this.secret, expiresAt: this.expiresAt, generation: this.generation };
  }

  /** Turn remote control off: the generation moves on, so nothing issued before this call is honoured. */
  stop(): void {
    this.enabled = false;
    this.generation += 1;
    this.challenges.clear();
    this.secret = null;
    this.verifier = null;
    this.dead = null;
  }

  /** The link the desktop shows, while it is still redeemable. */
  current(now: number): { readonly secret: string; readonly expiresAt: number } | null {
    if (!this.enabled || this.secret === null || this.verifier === null) return null;
    if (now >= this.expiresAt) return null;
    return { secret: this.secret, expiresAt: this.expiresAt };
  }

  /**
   * Redeem a pairing secret. The check and the consumption happen in one synchronous step, so two
   * concurrent redemptions cannot both succeed.
   */
  redeem(secret: unknown, now: number): RedeemResult {
    if (!this.enabled) return { ok: false, reason: "off" };
    if (typeof secret !== "string" || !SECRET_SHAPE.test(secret)) return { ok: false, reason: "invalid" };
    const presented = verifierOf(secret);
    if (this.verifier === null) {
      const reason = this.dead !== null && equalBytes(presented, this.dead.verifier) ? this.dead.reason : "invalid";
      return { ok: false, reason };
    }
    if (!equalBytes(presented, this.verifier)) return { ok: false, reason: "invalid" };
    if (now >= this.expiresAt) {
      this.dead = { verifier: this.verifier, reason: "expired" };
      this.verifier = null;
      this.secret = null;
      return { ok: false, reason: "expired" };
    }
    this.dead = { verifier: this.verifier, reason: "used" };
    this.verifier = null;
    this.secret = null;
    const challenge = newChallenge();
    const ticket = this.issueChallenge(challenge, "register", now);
    return { ok: true, ticket, challenge, expiresAt: now + CHALLENGE_TTL_MS };
  }

  /** A fresh single-use challenge for a registration or an assertion, bound to this generation. */
  issueChallenge(challenge: Uint8Array, kind: ChallengeKind, now: number): string {
    this.purge(now);
    const ticket = b64url(randomBytes(32));
    this.challenges.set(ticket, { challenge, kind, generation: this.generation, expiresAt: now + CHALLENGE_TTL_MS });
    return ticket;
  }

  /** Take a challenge out of the store. It is gone after this call whether or not the caller succeeds. */
  takeChallenge(ticket: unknown, kind: ChallengeKind, now: number): Uint8Array | null {
    if (typeof ticket !== "string") return null;
    const entry = this.challenges.get(ticket);
    if (entry === undefined) return null;
    this.challenges.delete(ticket);
    if (entry.kind !== kind || entry.generation !== this.generation || now >= entry.expiresAt) return null;
    return entry.challenge;
  }

  private purge(now: number): void {
    for (const [ticket, entry] of this.challenges) {
      if (now >= entry.expiresAt) this.challenges.delete(ticket);
    }
  }
}
