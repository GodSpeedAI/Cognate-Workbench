/**
 * Pairing and challenges as pure state (expiry, single use, generation revocation, stop), plus the
 * remote settings read from the environment. Time is passed in explicitly.
 */
import { describe, expect, test } from "bun:test";
import { PAIRING_TTL_MS, Pairing } from "../src/remote/pairing.ts";
import { newChallenge } from "../src/remote/webauthn.ts";
import { remoteSettingsFromEnv } from "../src/remote/mobile.ts";

const T0 = 1_700_000_000_000;

describe("pairing link", () => {
  test("expires after five minutes and is refused as expired, not as invalid", () => {
    const pairing = new Pairing();
    const { secret } = pairing.start(T0);
    expect(pairing.redeem(secret, T0 + PAIRING_TTL_MS - 1).ok).toBe(true);
    const late = new Pairing();
    const issued = late.start(T0);
    expect(late.redeem(issued.secret, T0 + PAIRING_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  test("is single use: two concurrent redemptions, only one succeeds and the other says used", () => {
    const pairing = new Pairing();
    const { secret } = pairing.start(T0);
    const first = pairing.redeem(secret, T0);
    const second = pairing.redeem(secret, T0);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "used" });
  });

  test("a wrong or malformed secret is invalid and never consumes the real link", () => {
    const pairing = new Pairing();
    const { secret } = pairing.start(T0);
    expect(pairing.redeem("A".repeat(43), T0)).toEqual({ ok: false, reason: "invalid" });
    expect(pairing.redeem("not a secret", T0)).toEqual({ ok: false, reason: "invalid" });
    expect(pairing.redeem(undefined, T0)).toEqual({ ok: false, reason: "invalid" });
    expect(pairing.redeem(secret, T0).ok).toBe(true);
  });

  test("refresh revokes every prior link and bumps the generation; stop turns remote control off", () => {
    const pairing = new Pairing();
    const first = pairing.start(T0);
    const second = pairing.refresh(T0 + 1000);
    expect(second.generation).toBe(first.generation + 1);
    expect(pairing.redeem(first.secret, T0 + 1000)).toEqual({ ok: false, reason: "invalid" });
    expect(pairing.redeem(second.secret, T0 + 1000).ok).toBe(true);
    pairing.stop();
    expect(pairing.isEnabled).toBe(false);
    expect(pairing.redeem(second.secret, T0 + 2000)).toEqual({ ok: false, reason: "off" });
    expect(pairing.current(T0 + 2000)).toBeNull();
  });

  test("a restart floor keeps the new generation above any stored device generation", () => {
    const pairing = new Pairing();
    const issued = pairing.start(T0, 7);
    expect(issued.generation).toBe(8);
  });
});

describe("challenges", () => {
  test("a challenge is single use, bound to its kind and to the generation", () => {
    const pairing = new Pairing();
    pairing.start(T0);
    const challenge = newChallenge();
    const ticket = pairing.issueChallenge(challenge, "auth", T0);
    expect(pairing.takeChallenge(ticket, "register", T0)).toBeNull();
    const again = pairing.issueChallenge(challenge, "auth", T0);
    expect(pairing.takeChallenge(again, "auth", T0)).toEqual(challenge);
    expect(pairing.takeChallenge(again, "auth", T0)).toBeNull();
  });

  test("a challenge expires after two minutes and does not survive a refresh", () => {
    const pairing = new Pairing();
    pairing.start(T0);
    const expiring = pairing.issueChallenge(newChallenge(), "auth", T0);
    expect(pairing.takeChallenge(expiring, "auth", T0 + 120_000)).toBeNull();
    const stale = pairing.issueChallenge(newChallenge(), "auth", T0);
    pairing.refresh(T0);
    expect(pairing.takeChallenge(stale, "auth", T0)).toBeNull();
  });
});

describe("remote settings", () => {
  test("the public URL is an origin only, HTTPS or localhost; the port defaults to 3181", () => {
    expect(remoteSettingsFromEnv({})).toEqual({ port: 3181 });
    expect(remoteSettingsFromEnv({ COGNATE_REMOTE_PORT: "4330", COGNATE_REMOTE_PUBLIC_URL: "https://workbench.example/" })).toEqual({ port: 4330, publicUrl: "https://workbench.example" });
    expect(remoteSettingsFromEnv({ COGNATE_REMOTE_PUBLIC_URL: "http://localhost:3181" })).toEqual({ port: 3181, publicUrl: "http://localhost:3181" });
    expect(() => remoteSettingsFromEnv({ COGNATE_REMOTE_PUBLIC_URL: "http://workbench.example" })).toThrow("https");
    expect(() => remoteSettingsFromEnv({ COGNATE_REMOTE_PUBLIC_URL: "https://workbench.example/path" })).toThrow("origin");
    expect(() => remoteSettingsFromEnv({ COGNATE_REMOTE_PUBLIC_URL: "https://user:pw@workbench.example?x=1" })).toThrow("origin");
    expect(() => remoteSettingsFromEnv({ COGNATE_REMOTE_PORT: "99999" })).toThrow("port");
  });
});
