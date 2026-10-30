/**
 * WebAuthn for the phone remote: option builders and hand-rolled verification with WebCrypto.
 *
 * Scope is deliberate: registration accepts attestation format "none" only (the phone is asked for
 * no attestation), and assertions and registrations both require user verification (UV). Algorithms
 * are ES256, EdDSA and RS256, the three the browsers offer.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decodeCbor, decodeCborAt, type CborValue } from "./cbor.ts";

export const RP_NAME = "Cognate Workbench";
export const CHALLENGE_BYTES = 32;
const ALG_ES256 = -7;
const ALG_EDDSA = -8;
const ALG_RS256 = -257;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class WebAuthnError extends Error {
  constructor(
    readonly code: "format" | "type" | "challenge" | "origin" | "rp_id" | "flags" | "algorithm" | "credential" | "sign_count" | "signature",
    message: string,
  ) {
    super(message);
  }
}

export interface VerifiedRegistration {
  readonly credentialId: string;
  /** The credential public key as COSE_Key bytes, base64url. */
  readonly publicKey: string;
  readonly alg: number;
  readonly signCount: number;
}

export function newChallenge(): Uint8Array {
  return new Uint8Array(randomBytes(CHALLENGE_BYTES));
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Strict: only the unpadded base64url alphabet is accepted. */
export function fromB64url(text: unknown): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) throw new WebAuthnError("format", "a binary field is not base64url");
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registrationOptions(input: { readonly challenge: Uint8Array; readonly rpId: string; readonly userId: Uint8Array; readonly userName: string }) {
  return {
    challenge: b64url(input.challenge),
    rp: { id: input.rpId, name: RP_NAME },
    user: { id: b64url(input.userId), name: input.userName, displayName: input.userName },
    pubKeyCredParams: [
      { type: "public-key", alg: ALG_ES256 },
      { type: "public-key", alg: ALG_EDDSA },
      { type: "public-key", alg: ALG_RS256 },
    ],
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    attestation: "none",
    timeout: 120000,
  };
}

export function assertionOptions(input: { readonly challenge: Uint8Array; readonly rpId: string; readonly credentialIds: readonly string[] }) {
  return {
    challenge: b64url(input.challenge),
    rpId: input.rpId,
    allowCredentials: input.credentialIds.map((id) => ({ type: "public-key", id })),
    userVerification: "required",
    timeout: 120000,
  };
}

function clientDataHash(raw: unknown, type: string, challenge: Uint8Array, origin: string): Uint8Array {
  const bytes = fromB64url(raw);
  let data: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(bytes)) as typeof data;
  } catch {
    throw new WebAuthnError("format", "clientDataJSON is not JSON");
  }
  if (data.type !== type) throw new WebAuthnError("type", `clientDataJSON type is not ${type}`);
  if (data.challenge !== b64url(challenge)) throw new WebAuthnError("challenge", "the challenge does not match this request");
  if (data.origin !== origin) throw new WebAuthnError("origin", "the origin does not match this remote");
  return sha256(bytes);
}

interface AuthData {
  readonly rpIdHash: Uint8Array;
  readonly flags: number;
  readonly signCount: number;
  readonly credentialId?: Uint8Array;
  readonly key?: Uint8Array;
}

function parseAuthData(bytes: Uint8Array, rpId: string, attested: boolean): AuthData {
  if (bytes.length < 37) throw new WebAuthnError("format", "authenticator data is too short");
  const rpIdHash = bytes.subarray(0, 32);
  if (!equalBytes(rpIdHash, sha256(new TextEncoder().encode(rpId)))) throw new WebAuthnError("rp_id", "the RP ID hash does not match this remote");
  const flags = bytes[32] as number;
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  if (!attested) return { rpIdHash, flags, signCount };
  if ((flags & FLAG_AT) === 0 || bytes.length < 55) throw new WebAuthnError("flags", "attested credential data is missing");
  const idLength = new DataView(bytes.buffer, bytes.byteOffset + 53, 2).getUint16(0);
  const idStart = 55;
  if (bytes.length < idStart + idLength) throw new WebAuthnError("format", "the credential id is truncated");
  const credentialId = bytes.slice(idStart, idStart + idLength);
  let decoded: { value: CborValue; end: number };
  try {
    decoded = decodeCborAt(bytes, idStart + idLength);
  } catch {
    throw new WebAuthnError("format", "the credential public key is not CBOR");
  }
  const key = bytes.slice(idStart + idLength, decoded.end);
  return { rpIdHash, flags, signCount, credentialId, key };
}

/** Accept only the three algorithms we verify, and check the key carries what that algorithm needs. */
function algorithmOf(keyBytes: Uint8Array): number {
  let key: CborValue;
  try {
    key = decodeCbor(keyBytes);
  } catch {
    throw new WebAuthnError("format", "the credential public key is not CBOR");
  }
  if (!(key instanceof Map)) throw new WebAuthnError("format", "the credential public key is not a map");
  const alg = key.get(3);
  const bytesOf = (label: number): Uint8Array | null => {
    const value = key.get(label);
    return value instanceof Uint8Array ? value : null;
  };
  if (alg === ALG_ES256 && key.get(1) === 2 && key.get(-1) === 1 && bytesOf(-2)?.length === 32 && bytesOf(-3)?.length === 32) return ALG_ES256;
  if (alg === ALG_EDDSA && key.get(1) === 1 && key.get(-1) === 6 && bytesOf(-2)?.length === 32) return ALG_EDDSA;
  if (alg === ALG_RS256 && key.get(1) === 3 && bytesOf(-1) !== null && bytesOf(-2) !== null) return ALG_RS256;
  throw new WebAuthnError("algorithm", "the credential key algorithm is not ES256, EdDSA or RS256");
}

/** Verify a registration (attestation "none"). Returns what the server stores for this device. */
export function verifyRegistration(
  credential: { readonly id: unknown; readonly response: { readonly clientDataJSON: unknown; readonly attestationObject: unknown } },
  expected: { readonly challenge: Uint8Array; readonly origin: string; readonly rpId: string },
): VerifiedRegistration {
  clientDataHash(credential.response.clientDataJSON, "webauthn.create", expected.challenge, expected.origin);
  let attestation: CborValue;
  try {
    attestation = decodeCbor(fromB64url(credential.response.attestationObject));
  } catch (error) {
    if (error instanceof WebAuthnError) throw error;
    throw new WebAuthnError("format", "the attestation object is not CBOR");
  }
  if (!(attestation instanceof Map) || attestation.get("fmt") !== "none") {
    throw new WebAuthnError("format", "only attestation format none is accepted");
  }
  const statement = attestation.get("attStmt");
  if (!(statement instanceof Map) || statement.size !== 0) throw new WebAuthnError("format", "attestation none carries no statement");
  const authData = attestation.get("authData");
  if (!(authData instanceof Uint8Array)) throw new WebAuthnError("format", "the attestation has no authenticator data");
  const parsed = parseAuthData(authData, expected.rpId, true);
  if ((parsed.flags & (FLAG_UP | FLAG_UV)) !== (FLAG_UP | FLAG_UV)) {
    throw new WebAuthnError("flags", "the passkey must confirm presence and user verification");
  }
  if (typeof credential.id !== "string" || parsed.credentialId === undefined || !equalBytes(parsed.credentialId, fromB64url(credential.id))) {
    throw new WebAuthnError("credential", "the credential id does not match the attested key");
  }
  const key = parsed.key as Uint8Array;
  return { credentialId: credential.id, publicKey: b64url(key), alg: algorithmOf(key), signCount: parsed.signCount };
}

/** DER ECDSA signature to the raw r||s form WebCrypto expects. */
function derToRaw(der: Uint8Array, size = 32): Uint8Array {
  let pos = 0;
  const byte = (): number => {
    if (pos >= der.length) throw new WebAuthnError("signature", "malformed signature");
    pos += 1;
    return der[pos - 1] as number;
  };
  const length = (): number => {
    const first = byte();
    if ((first & 0x80) === 0) return first;
    let value = 0;
    for (let index = 0; index < (first & 0x7f); index += 1) value = value * 256 + byte();
    return value;
  };
  const integer = (): Uint8Array => {
    if (byte() !== 0x02) throw new WebAuthnError("signature", "malformed signature");
    const count = length();
    if (pos + count > der.length) throw new WebAuthnError("signature", "malformed signature");
    let value = der.slice(pos, pos + count);
    pos += count;
    while (value.length > size && value[0] === 0) value = value.slice(1);
    if (value.length > size) throw new WebAuthnError("signature", "malformed signature");
    const out = new Uint8Array(size);
    out.set(value, size - value.length);
    return out;
  };
  if (byte() !== 0x30) throw new WebAuthnError("signature", "malformed signature");
  length();
  const r = integer();
  const s = integer();
  if (pos !== der.length) throw new WebAuthnError("signature", "malformed signature");
  return concat(r, s);
}

async function signatureValid(keyBytes: Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const key = decodeCbor(keyBytes) as Map<CborValue, CborValue>;
  const x = key.get(-2) as Uint8Array | undefined;
  const y = key.get(-3) as Uint8Array | undefined;
  const n = key.get(-1) as Uint8Array | undefined;
  const e = key.get(-2) as Uint8Array | undefined;
  const payload = data as BufferSource;
  switch (key.get(3)) {
    case ALG_ES256: {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: b64url(x as Uint8Array), y: b64url(y as Uint8Array), ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, derToRaw(signature) as BufferSource, payload);
    }
    case ALG_EDDSA: {
      const cryptoKey = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: b64url(x as Uint8Array), ext: true }, { name: "Ed25519" }, false, ["verify"]);
      return crypto.subtle.verify("Ed25519", cryptoKey, signature as BufferSource, payload);
    }
    case ALG_RS256: {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: b64url(n as Uint8Array), e: b64url(e as Uint8Array), alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature as BufferSource, payload);
    }
    default:
      throw new WebAuthnError("algorithm", "the stored key algorithm is not supported");
  }
}

/**
 * Verify an assertion against the stored credential. The sign count must rise whenever either the
 * stored or the reported count is non-zero; zero on both sides means the authenticator keeps none.
 */
export async function verifyAssertion(
  credential: {
    readonly response: { readonly clientDataJSON: unknown; readonly authenticatorData: unknown; readonly signature: unknown };
  },
  expected: { readonly challenge: Uint8Array; readonly origin: string; readonly rpId: string; readonly publicKey: string; readonly signCount: number },
): Promise<{ readonly signCount: number }> {
  const hash = clientDataHash(credential.response.clientDataJSON, "webauthn.get", expected.challenge, expected.origin);
  const authData = fromB64url(credential.response.authenticatorData);
  const parsed = parseAuthData(authData, expected.rpId, false);
  if ((parsed.flags & (FLAG_UP | FLAG_UV)) !== (FLAG_UP | FLAG_UV)) throw new WebAuthnError("flags", "the passkey must confirm presence and user verification");
  if ((parsed.signCount !== 0 || expected.signCount !== 0) && parsed.signCount <= expected.signCount) {
    throw new WebAuthnError("sign_count", "the sign count did not increase: this may be a cloned passkey");
  }
  const keyBytes = fromB64url(expected.publicKey);
  algorithmOf(keyBytes);
  const valid = await signatureValid(keyBytes, concat(authData, hash), fromB64url(credential.response.signature));
  if (!valid) throw new WebAuthnError("signature", "the passkey signature is not valid");
  return { signCount: parsed.signCount };
}
