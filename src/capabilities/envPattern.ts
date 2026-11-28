// Value patterns for allowlisted environment names (SEA-Forge #114, review M10). The operator approves WHICH values a name may
// take; the pattern is part of the execution profile. A provider chooses the value, so matching it must not be a way to stall
// the host before authorization: a backtracking RegExp can take exponential time on a near-match. This is a restricted grammar
// with a Thompson-NFA matcher whose work is O(value length x states), counted in steps so a test can assert it.
//
// Grammar (implicitly anchored at both ends; printable ASCII only):
//   pattern  := atom*
//   atom     := (literal | '\' escaped | '[' class ']') quantifier?
//   quantifier := '?' | '*' | '+' | '{' m ',' n '}'                  (0 <= m <= n <= 256; `{0,0}` is legal and matches nothing;
//                                                                  the single-number form `{n}` is NOT in the grammar: write `{n,n}`)
//   class    := (char | char '-' char | '\' escaped)+
// There are no groups, alternation, backreferences, lookaround, anchors, dot or negated classes, and no quantifier on a
// quantifier. The expanded NFA may hold at most MAX_PATTERN_STATES states.
export const MAX_PATTERN_LENGTH = 200;
export const MAX_REPEAT = 256;
export const MAX_PATTERN_STATES = 1024;

const SPECIAL = new Set(["\\", "[", "]", "(", ")", "|", "^", "$", "?", "*", "+", "{", "}", "."]);
const bad = (why: string): never => { throw new Error(`env value pattern: ${why}`); };

interface Node { readonly set: Uint8Array; readonly skip: boolean; readonly loop: boolean }
export interface CompiledEnvPattern { readonly source: string; readonly nodes: readonly Node[]; readonly states: number }

const printable = (code: number): boolean => code >= 0x20 && code <= 0x7e;

export function compileEnvPattern(source: string): CompiledEnvPattern {
  if (typeof source !== "string" || source.length === 0 || source.length > MAX_PATTERN_LENGTH) bad(`must be 1 to ${MAX_PATTERN_LENGTH} characters`);
  const nodes: Node[] = [];
  let i = 0;
  const literal = (ch: string): Uint8Array => {
    const code = ch.charCodeAt(0);
    if (ch.length !== 1 || !printable(code)) bad("only printable ASCII is allowed");
    const set = new Uint8Array(128); set[code] = 1; return set;
  };
  const escaped = (): string => {
    i += 1; const ch = source[i]; if (ch === undefined) bad("a trailing backslash"); i += 1;
    if (!SPECIAL.has(ch!) && ch !== "-" && ch !== " ") bad(`an unsupported escape \\${ch} (only punctuation can be escaped: no backreferences or character-class shortcuts)`);
    return ch!;
  };
  while (i < source.length) {
    const c = source[i]!;
    let set: Uint8Array;
    if (c === "[") {
      set = new Uint8Array(128);
      i += 1;
      let members = 0;
      for (;;) {
        const ch = source[i];
        if (ch === undefined) bad("an unterminated bracket class");
        if (ch === "]") { i += 1; break; }
        const first = ch === "\\" ? escaped() : (i += 1, ch!);
        if (ch === "^" && members === 0) bad("negated classes are not supported");
        let last = first;
        if (source[i] === "-" && source[i + 1] !== undefined && source[i + 1] !== "]") {
          i += 1;
          const end = source[i]!;
          last = end === "\\" ? escaped() : (i += 1, end);
        }
        const lo = first.charCodeAt(0); const hi = last.charCodeAt(0);
        if (first.length !== 1 || last.length !== 1 || !printable(lo) || !printable(hi)) bad("only printable ASCII is allowed");
        if (lo > hi) bad("a class range runs backwards");
        for (let code = lo; code <= hi; code += 1) set[code] = 1;
        members += 1;
      }
      if (members === 0) bad("an empty bracket class");
    } else if (c === "\\") {
      set = literal(escaped());
    } else if (SPECIAL.has(c)) {
      bad(`${JSON.stringify(c)} is not supported (no groups, alternation, anchors, dot, lookaround or bare quantifiers)`);
      set = new Uint8Array(0);
    } else {
      set = literal(c); i += 1;
    }
    let min = 1; let max: number | "inf" = 1;
    const q = source[i];
    if (q === "?") { min = 0; max = 1; i += 1; }
    else if (q === "*") { min = 0; max = "inf"; i += 1; }
    else if (q === "+") { min = 1; max = "inf"; i += 1; }
    else if (q === "{") {
      const close = source.indexOf("}", i);
      const body = close < 0 ? "" : source.slice(i + 1, close);
      const m = /^(\d{1,3}),(\d{1,3})$/.exec(body);
      if (!m) bad("a malformed quantifier: only {m,n} is accepted (write {n,n} for an exact count)");
      min = Number(m![1]); max = Number(m![2]);
      if (max > MAX_REPEAT || min > max) bad(`a {m,n} quantifier needs m <= n <= ${MAX_REPEAT}`);
      i = close + 1;
    }
    const next = source[i];
    if (next === "?" || next === "*" || next === "+" || next === "{") bad("a quantifier may not follow a quantifier (no nested or stacked repetition)");
    for (let k = 0; k < min; k += 1) nodes.push({ set, skip: false, loop: false });
    if (max === "inf") nodes.push({ set, skip: true, loop: true });
    else for (let k = min; k < max; k += 1) nodes.push({ set, skip: true, loop: false });
    if (nodes.length > MAX_PATTERN_STATES) bad(`expands to more than ${MAX_PATTERN_STATES} states`);
  }
  return { source, nodes, states: nodes.length };
}

/** Run the NFA over `value`. `steps` counts state visits and never exceeds 2 x (value.length + 1) x (states + 1). */
export function matchEnvPattern(pattern: CompiledEnvPattern, value: string): { readonly matched: boolean; readonly steps: number } {
  const n = pattern.nodes.length;
  let steps = 0;
  // `reach` marks node indexes "about to match node p"; skippable nodes also expose the position after them (epsilon closure).
  const close = (marks: Uint8Array): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(n + 1);
    for (let p = 0; p <= n; p += 1) {
      steps += 1;
      if (marks[p]) out[p] = 1;
      if (out[p] && p < n && pattern.nodes[p]!.skip) out[p + 1] = 1;
    }
    return out;
  };
  let current: Uint8Array<ArrayBuffer> = new Uint8Array(n + 1); current[0] = 1; current = close(current);
  for (let k = 0; k < value.length; k += 1) {
    const code = value.charCodeAt(k);
    const next = new Uint8Array(n + 1);
    if (code < 128) {
      for (let p = 0; p < n; p += 1) {
        steps += 1;
        if (!current[p]) continue;
        const node = pattern.nodes[p]!;
        if (node.set[code]) { next[p + 1] = 1; if (node.loop) next[p] = 1; }
      }
    }
    current = close(next);
  }
  return { matched: current[n] === 1, steps };
}
