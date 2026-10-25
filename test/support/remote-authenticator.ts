/**
 * SOFTWARE AUTHENTICATOR (test double). A P-256 passkey generated in-process with WebCrypto,
 * producing the bytes a platform authenticator would: a CBOR attestation object with fmt "none",
 * authenticator data with the flags a test chooses, and DER-encoded ES256 assertion signatures.
 * It is not a real passkey and proves nothing about a real device; it exercises our verifier.
 */
import { createHash } from "node:crypto";
import { b64url, fromB64url } from "../../src/remote/webauthn.ts";

export const FLAGS = { UP: 0x01, UV: 0x04, AT: 0x40 } as const;

type Encodable = number | string | boolean | null | Uint8Array | Encodable[] | Map<Encodable, Encodable>;

/** Minimal CBOR encoder for the test's own fixtures (ints, bytes, text, arrays, maps). */
export function cborEncode(value: Encodable): Uint8Array {
  const head = (major: number, length: number): number[] => {
    if (length < 24) return [(major << 5) | length];
    if (length < 256) return [(major << 5) | 24, length];
    return [(major << 5) | 25, length >> 8, length & 0xff];
  };
  const parts: number[][] = [];
  const pushAll = (bytes: Uint8Array | number[]) => parts.push([...bytes]);
  const write = (item: Encodable): void => {
    if (typeof item === "number") {
      if (item >= 0) pushAll(head(0, item));
      else pushAll(head(1, -1 - item));
    } else if (typeof item === "string") {
      const bytes = new TextEncoder().encode(item);
      pushAll(head(3, bytes.length));
      pushAll(bytes);
    } else if (item instanceof Uint8Array) {
      pushAll(head(2, item.length));
      pushAll(item);
    } else if (item === null) {
      pushAll([0xf6]);
    } else if (typeof item === "boolean") {
      pushAll([item ? 0xf5 : 0xf4]);
    } else if (Array.isArray(item)) {
      pushAll(head(4, item.length));
      for (const child of item) write(child);
    } else {
      pushAll(head(5, item.size));
      for (const [key, child] of item) {
        write(key);
        write(child);
      }
    }
  };
  write(value);
  return new Uint8Array(parts.flat());
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

/** WebCrypto returns ECDSA signatures as raw r||s; authenticators send DER. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const value = [...bytes.slice(start)];
    if ((value[0] as number) & 0x80) value.unshift(0);
    return [0x02, value.length, ...value];
  };
  const body = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

export interface Ceremony {
  readonly challenge: string;
  readonly origin: string;
  readonly rpId: string;
  /** Override the flags byte, to test refusals. Defaults to UP|UV (|AT for registration). */
  readonly flags?: number;
  /** Override the sign counter, to test regressions. */
  readonly counter?: number;
  /** Type string written into clientDataJSON, to test refusals. */
  readonly type?: string;
}

export class SoftwareAuthenticator {
  private keys: CryptoKeyPair | null = null;
  readonly credentialId = new Uint8Array(32).map((_, index) => (index * 7 + 3) & 0xff);
  private counter = 0;

  async generate(): Promise<this> {
    this.keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    return this;
  }

  private async coseKey(): Promise<Uint8Array> {
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys!.publicKey)) as { x: string; y: string };
    return cborEncode(
      new Map<Encodable, Encodable>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x)],
        [-3, fromB64url(jwk.y)],
      ]),
    );
  }

  private clientData(type: string, ceremony: Ceremony): { readonly bytes: Uint8Array; readonly hash: Uint8Array } {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: ceremony.type ?? type, challenge: ceremony.challenge, origin: ceremony.origin, crossOrigin: false }),
    );
    return { bytes, hash: sha256(bytes) };
  }

  /** A registration response, as navigator.credentials.create would return it, serialised to base64url. */
  async register(ceremony: Ceremony): Promise<{ readonly id: string; readonly rawId: string; readonly type: "public-key"; readonly response: { clientDataJSON: string; attestationObject: string } }> {
    const { bytes } = this.clientData("webauthn.create", ceremony);
    const flags = ceremony.flags ?? FLAGS.UP | FLAGS.UV | FLAGS.AT;
    const counter = new Uint8Array([0, 0, 0, 0]);
    new DataView(counter.buffer).setUint32(0, ceremony.counter ?? 0);
    const attested = concat(
      new Uint8Array(16),
      new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]),
      this.credentialId,
      await this.coseKey(),
    );
    const authData = concat(sha256(new TextEncoder().encode(ceremony.rpId)), new Uint8Array([flags]), counter, attested);
    const attestation = cborEncode(new Map<Encodable, Encodable>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    const id = b64url(this.credentialId);
    return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64url(bytes), attestationObject: b64url(attestation) } };
  }

  /** An assertion response for the registered passkey, signed with its private key. */
  async assert(ceremony: Ceremony): Promise<{ readonly id: string; readonly rawId: string; readonly type: "public-key"; readonly response: { clientDataJSON: string; authenticatorData: string; signature: string } }> {
    const { bytes, hash } = this.clientData("webauthn.get", ceremony);
    const flags = ceremony.flags ?? FLAGS.UP | FLAGS.UV;
    this.counter += 1;
    const counter = new Uint8Array([0, 0, 0, 0]);
    new DataView(counter.buffer).setUint32(0, ceremony.counter ?? this.counter);
    const authData = concat(sha256(new TextEncoder().encode(ceremony.rpId)), new Uint8Array([flags]), counter);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys!.privateKey, concat(authData, hash) as BufferSource));
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: { clientDataJSON: b64url(bytes), authenticatorData: b64url(authData), signature: b64url(rawToDer(raw)) },
    };
  }
}
