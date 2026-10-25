/**
 * WebAuthn for the phone remote, with a SOFTWARE AUTHENTICATOR written in test/support (an in-process
 * P-256 key that emits real CBOR attestation and DER assertions). Positive and negative cases only:
 * every refusal named in the brief must be refused by the verifier, not merely absent.
 */
import { describe, expect, test } from "bun:test";
import { decodeCbor, decodeCborAt, CborError } from "../src/remote/cbor.ts";
import { assertionOptions, b64url, fromB64url, newChallenge, registrationOptions, verifyAssertion, verifyRegistration, WebAuthnError } from "../src/remote/webauthn.ts";
import { cborEncode, FLAGS, SoftwareAuthenticator } from "./support/remote-authenticator.ts";

const ORIGIN = "https://workbench.example";
const RP_ID = "workbench.example";

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof WebAuthnError ? error.code : `unexpected:${String(error)}`;
  }
}

async function codeOfAsync(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof WebAuthnError ? error.code : `unexpected:${String(error)}`;
  }
}

async function registered(authenticator: SoftwareAuthenticator, challenge: Uint8Array = newChallenge()) {
  const credential = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID });
  return { challenge, credential, verified: verifyRegistration(credential, { challenge, origin: ORIGIN, rpId: RP_ID }) };
}

describe("CBOR subset decoder", () => {
  test("round-trips the value kinds WebAuthn uses", () => {
    const value = new Map<unknown, unknown>([
      ["fmt", "none"],
      [1, 2],
      [-7, -1000],
      ["bytes", new Uint8Array([1, 2, 3])],
      ["list", [true, false, null, 300]],
    ]);
    const decoded = decodeCbor(cborEncode(value as never)) as Map<unknown, unknown>;
    expect(decoded.get("fmt")).toBe("none");
    expect(decoded.get(1)).toBe(2);
    expect(decoded.get(-7)).toBe(-1000);
    expect(Array.from(decoded.get("bytes") as Uint8Array)).toEqual([1, 2, 3]);
    expect(decoded.get("list")).toEqual([true, false, null, 300]);
  });

  test("reports the end offset of an item inside a larger buffer", () => {
    const first = cborEncode([1, 2]);
    const both = new Uint8Array([...first, ...cborEncode("tail")]);
    expect(decodeCborAt(both, 0).end).toBe(first.length);
  });

  test("refuses indefinite lengths, tags, floats, duplicate keys and trailing bytes", () => {
    expect(() => decodeCbor(new Uint8Array([0x5f, 0xff]))).toThrow(CborError);
    expect(() => decodeCbor(new Uint8Array([0xc1, 0x01]))).toThrow(CborError);
    expect(() => decodeCbor(new Uint8Array([0xf9, 0x3c, 0x00]))).toThrow(CborError);
    expect(() => decodeCbor(new Uint8Array([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(CborError);
    expect(() => decodeCbor(new Uint8Array([0x01, 0x02]))).toThrow(CborError);
    expect(() => decodeCbor(new Uint8Array([0x45, 0x01]))).toThrow(CborError);
  });
});

describe("registration (software authenticator)", () => {
  test("a valid attestation none registration verifies and yields a COSE ES256 key", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const { verified } = await registered(authenticator);
    expect(verified.credentialId).toBe(b64url(authenticator.credentialId));
    expect(verified.alg).toBe(-7);
    expect(verified.signCount).toBe(0);
    expect(fromB64url(verified.publicKey).length).toBeGreaterThan(60);
  });

  test("refuses a wrong origin, a stale challenge, a wrong RP ID and a wrong type", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const challenge = newChallenge();
    const expected = { challenge, origin: ORIGIN, rpId: RP_ID };
    const wrongOrigin = await authenticator.register({ challenge: b64url(challenge), origin: "https://evil.example", rpId: RP_ID });
    expect(codeOf(() => verifyRegistration(wrongOrigin, expected))).toBe("origin");
    const stale = await authenticator.register({ challenge: b64url(newChallenge()), origin: ORIGIN, rpId: RP_ID });
    expect(codeOf(() => verifyRegistration(stale, expected))).toBe("challenge");
    const wrongRp = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: "other.example" });
    expect(codeOf(() => verifyRegistration(wrongRp, expected))).toBe("rp_id");
    const wrongType = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, type: "webauthn.get" });
    expect(codeOf(() => verifyRegistration(wrongType, expected))).toBe("type");
  });

  test("refuses a passkey that did not verify the user (UV clear) and one without presence (UP clear)", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const challenge = newChallenge();
    const expected = { challenge, origin: ORIGIN, rpId: RP_ID };
    const noUv = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, flags: FLAGS.UP | FLAGS.AT });
    expect(codeOf(() => verifyRegistration(noUv, expected))).toBe("flags");
    const noUp = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, flags: FLAGS.UV | FLAGS.AT });
    expect(codeOf(() => verifyRegistration(noUp, expected))).toBe("flags");
  });

  test("refuses any attestation format other than none, and a credential id that does not match", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const challenge = newChallenge();
    const expected = { challenge, origin: ORIGIN, rpId: RP_ID };
    const good = await authenticator.register({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID });
    const packed = cborEncode(new Map<unknown, unknown>([["fmt", "packed"], ["attStmt", new Map()], ["authData", new Uint8Array(37)]]) as never);
    expect(codeOf(() => verifyRegistration({ id: good.id, response: { clientDataJSON: good.response.clientDataJSON, attestationObject: b64url(packed) } }, expected))).toBe("format");
    const mismatch = { ...good, id: b64url(new Uint8Array(32).fill(9)) };
    expect(codeOf(() => verifyRegistration(mismatch, expected))).toBe("credential");
  });
});

describe("assertion (software authenticator)", () => {
  test("a valid assertion verifies and advances the sign count", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const { verified } = await registered(authenticator);
    const challenge = newChallenge();
    const assertion = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, counter: 5 });
    const result = await verifyAssertion(assertion, { challenge, origin: ORIGIN, rpId: RP_ID, publicKey: verified.publicKey, signCount: verified.signCount });
    expect(result.signCount).toBe(5);
  });

  test("refuses a wrong origin, a wrong RP ID hash, a UV-clear assertion and a replayed challenge", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const { verified } = await registered(authenticator);
    const challenge = newChallenge();
    const base = { challenge, origin: ORIGIN, rpId: RP_ID, publicKey: verified.publicKey, signCount: 0 };
    const wrongOrigin = await authenticator.assert({ challenge: b64url(challenge), origin: "https://evil.example", rpId: RP_ID });
    expect(await codeOfAsync(() => verifyAssertion(wrongOrigin, base))).toBe("origin");
    const wrongRp = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: "other.example" });
    expect(await codeOfAsync(() => verifyAssertion(wrongRp, base))).toBe("rp_id");
    const noUv = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, flags: FLAGS.UP });
    expect(await codeOfAsync(() => verifyAssertion(noUv, base))).toBe("flags");
    const fresh = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID });
    expect(await codeOfAsync(() => verifyAssertion(fresh, { ...base, challenge: newChallenge() }))).toBe("challenge");
  });

  test("refuses a bad signature and a sign-count regression (a cloned passkey)", async () => {
    const authenticator = await new SoftwareAuthenticator().generate();
    const { verified } = await registered(authenticator);
    const challenge = newChallenge();
    const base = { challenge, origin: ORIGIN, rpId: RP_ID, publicKey: verified.publicKey, signCount: 0 };
    const good = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, counter: 9 });
    const tampered = { ...good, response: { ...good.response, signature: b64url(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01])) } };
    expect(await codeOfAsync(() => verifyAssertion(tampered, base))).toBe("signature");
    const reused = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, counter: 9 });
    expect(await codeOfAsync(() => verifyAssertion(reused, { ...base, signCount: 9 }))).toBe("sign_count");
    const reset = await authenticator.assert({ challenge: b64url(challenge), origin: ORIGIN, rpId: RP_ID, counter: 0 });
    expect(await codeOfAsync(() => verifyAssertion(reset, { ...base, signCount: 9 }))).toBe("sign_count");
  });

  test("options carry the required user verification and the challenge as base64url", () => {
    const challenge = newChallenge();
    const options = assertionOptions({ challenge, rpId: RP_ID, credentialIds: ["abc"] });
    expect(options.userVerification).toBe("required");
    expect(options.challenge).toBe(b64url(challenge));
    const creation = registrationOptions({ challenge, rpId: RP_ID, userId: new Uint8Array(16), userName: "operator" });
    expect(creation.authenticatorSelection).toEqual({ residentKey: "preferred", userVerification: "required" });
    expect(creation.attestation).toBe("none");
  });
});
