// gpt-tokenizer's `exports` map (`./*` -> `./esm/*.js`) does not resolve its `encoding/<name>.js` subpaths for
// TypeScript, although every module loads at runtime. Only `countTokens` is used (src/experts/tokenizer.ts), so
// each shim declares exactly that and nothing more.
declare module "gpt-tokenizer/encoding/o200k_base.js" {
  const encoding: { countTokens(text: string): number };
  export default encoding;
}
declare module "gpt-tokenizer/encoding/cl100k_base.js" {
  const encoding: { countTokens(text: string): number };
  export default encoding;
}
declare module "gpt-tokenizer/encoding/p50k_base.js" {
  const encoding: { countTokens(text: string): number };
  export default encoding;
}
declare module "gpt-tokenizer/encoding/r50k_base.js" {
  const encoding: { countTokens(text: string): number };
  export default encoding;
}
