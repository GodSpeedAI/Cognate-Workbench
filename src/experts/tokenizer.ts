// Model-specific token counting for context accounting (J-CONTEXT-BUDGET). A route's model name
// resolves to a published tokenizer encoding; families without a public tokenizer use the closest
// public encoding and are labeled approximate. Counts never masquerade as provider measurements:
// the accounting method label always names the encoding used, and hidden provider framing stays
// unmeasured behind an explicit envelope margin.
export type TokenizerEncoding = "o200k_base" | "cl100k_base" | "p50k_base" | "r50k_base";

export interface ModelTokenizer {
  /** Token count for one UTF-8 string under the resolved encoding. */
  readonly count: (text: string) => number;
  /** Accounting label, e.g. "model-tokenizer:o200k_base" or "...:approximate". */
  readonly method: string;
}

/** Reserved tokens for provider-added hidden framing the visible request cannot measure. */
export const ENVELOPE_MARGIN_TOKENS = 256;

const loaded = new Map<TokenizerEncoding, Promise<{ countTokens(text: string): number }>>();

async function loadEncoding(encoding: TokenizerEncoding): Promise<{ countTokens(text: string): number }> {
  const existing = loaded.get(encoding);
  if (existing) return existing;
  const pending = import(`gpt-tokenizer/encoding/${encoding}.js`)
    .then(module => ((module as { default?: { countTokens(text: string): number } }).default ?? module as unknown as { countTokens(text: string): number }));
  loaded.set(encoding, pending);
  return pending;
}

function resolveEncoding(model: string, _protocol?: string): { encoding: TokenizerEncoding; native: boolean } | undefined {
  const name = model.trim().toLowerCase();
  if (!name) return undefined;
  if (/^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-oss|o1|o3|o4|chatgpt-4o)/.test(name)) return { encoding: "o200k_base", native: true };
  if (/^(gpt-4|gpt-3\.5|gpt-35|text-embedding)/.test(name)) return { encoding: "cl100k_base", native: true };
  if (/^text-davinci-00/.test(name)) return { encoding: "p50k_base", native: true };
  if (/^(davinci|curie|babbage|ada|text-ada|text-curie|text-babbage)/.test(name)) return { encoding: "r50k_base", native: true };
  // No public tokenizer exists for this family; the closest public encoding is labeled approximate.
  return { encoding: "cl100k_base", native: false };
}

/** Resolve the tokenizer for a concrete model route. A missing model name returns undefined so
 * callers retain their documented conservative fallback; a named model without a native public
 * tokenizer is counted with the closest public encoding, labeled approximate. */
export async function tokenizerForRoute(model: string, protocol?: string): Promise<ModelTokenizer | undefined> {
  const resolved = resolveEncoding(model, protocol);
  if (!resolved) return undefined;
  const encoding = await loadEncoding(resolved.encoding);
  return {
    count: text => encoding.countTokens(text),
    method: resolved.native ? `model-tokenizer:${resolved.encoding}` : `model-tokenizer:${resolved.encoding}:approximate`,
  };
}

/** Legacy conservative fallback: UTF-8 byte count, deliberately not a tokenizer count. */
export function legacyByteCount(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
