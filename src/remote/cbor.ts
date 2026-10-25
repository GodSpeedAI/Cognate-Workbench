/**
 * The CBOR subset WebAuthn uses (RFC 8949): unsigned and negative integers, byte and text strings,
 * arrays, maps, and the simple values false, true and null. Tags, floats, indefinite lengths and
 * duplicate map keys are refused, never guessed at.
 */

export type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

export class CborError extends Error {}

const MAX_DEPTH = 16;

/** Decode one data item starting at `offset`; `end` is the offset just past it. */
export function decodeCborAt(bytes: Uint8Array, offset = 0): { readonly value: CborValue; readonly end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (at: number, count: number): void => {
    if (at + count > bytes.length) throw new CborError("truncated CBOR item");
  };
  const read = (at: number, depth: number): [CborValue, number] => {
    if (depth > MAX_DEPTH) throw new CborError("CBOR nesting is too deep");
    need(at, 1);
    const initial = bytes[at] as number;
    const major = initial >> 5;
    const info = initial & 0x1f;
    let pos = at + 1;
    let arg: number;
    if (info < 24) {
      arg = info;
    } else if (info === 24) {
      need(pos, 1);
      arg = bytes[pos] as number;
      pos += 1;
    } else if (info === 25) {
      need(pos, 2);
      arg = view.getUint16(pos);
      pos += 2;
    } else if (info === 26) {
      need(pos, 4);
      arg = view.getUint32(pos);
      pos += 4;
    } else if (info === 27) {
      need(pos, 8);
      const big = view.getBigUint64(pos);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("CBOR integer is too large");
      arg = Number(big);
      pos += 8;
    } else {
      throw new CborError("unsupported CBOR additional information");
    }
    switch (major) {
      case 0:
        return [arg, pos];
      case 1:
        return [-1 - arg, pos];
      case 2:
        need(pos, arg);
        return [bytes.slice(pos, pos + arg), pos + arg];
      case 3:
        need(pos, arg);
        return [new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(pos, pos + arg)), pos + arg];
      case 4: {
        const items: CborValue[] = [];
        for (let index = 0; index < arg; index += 1) {
          const [item, next] = read(pos, depth + 1);
          items.push(item);
          pos = next;
        }
        return [items, pos];
      }
      case 5: {
        const map = new Map<CborValue, CborValue>();
        for (let index = 0; index < arg; index += 1) {
          const [key, afterKey] = read(pos, depth + 1);
          const [value, afterValue] = read(afterKey, depth + 1);
          if (map.has(key)) throw new CborError("duplicate CBOR map key");
          map.set(key, value);
          pos = afterValue;
        }
        return [map, pos];
      }
      case 7:
        if (info === 20) return [false, pos];
        if (info === 21) return [true, pos];
        if (info === 22) return [null, pos];
        throw new CborError("unsupported CBOR simple value");
      default:
        throw new CborError("unsupported CBOR major type");
    }
  };
  const [value, end] = read(offset, 0);
  return { value, end };
}

/** Decode a complete buffer as exactly one data item. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, end } = decodeCborAt(bytes, 0);
  if (end !== bytes.length) throw new CborError("trailing bytes after CBOR item");
  return value;
}
