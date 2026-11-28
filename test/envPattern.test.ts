// #114 M10 (delta-2): environment value patterns use a restricted grammar and a linear-time (Thompson NFA) matcher, never a
// backtracking RegExp, so a provider-supplied near-match cannot stall the host before authorization.
import { describe, expect, test } from "bun:test";
import { MAX_PATTERN_STATES, compileEnvPattern, matchEnvPattern } from "../src/capabilities/envPattern.ts";

/** The documented ceiling: 2 x (length + 1) x (states + 1). */
const bound = (states: number, length: number): number => 2 * (length + 1) * (states + 1);
const ok = (pattern: string, value: string): boolean => matchEnvPattern(compileEnvPattern(pattern), value).matched;

describe("grammar: atoms with optional quantifiers, implicitly anchored at both ends", () => {
  test("literals, escapes, bracket classes and the four quantifiers", () => {
    expect(ok("abc", "abc")).toBe(true);
    expect(ok("abc", "abcd")).toBe(false);                       // implicitly anchored at the end
    expect(ok("abc", "xabc")).toBe(false);                       // and at the start
    expect(ok("[A-Za-z0-9._-]{1,8}", "a.b-C_9")).toBe(true);     // "_" "." "-" inside a class
    expect(ok("[A-Za-z0-9._-]{1,8}", "")).toBe(false);
    expect(ok("[A-Za-z0-9._-]{1,8}", "abcdefghi")).toBe(false);
    expect(ok("a?b*c+", "c")).toBe(true);
    expect(ok("a?b*c+", "abbbcc")).toBe(true);
    expect(ok("a?b*c+", "b")).toBe(false);
    expect(ok("o[nf]f?", "on")).toBe(true);
    expect(ok("o[nf]f?", "off")).toBe(true);
    expect(ok("o[nf]f?", "ON")).toBe(false);
    expect(ok("a\\.b\\*", "a.b*")).toBe(true);                   // escaped literals
    expect(ok("a\\.b", "axb")).toBe(false);
    expect(ok("x{3,3}", "xxx")).toBe(true);
    expect(ok("x{3,3}", "xx")).toBe(false);
    expect(ok("x{0,0}", "")).toBe(true);                         // a legal zero count matches only the empty value
    expect(ok("x{0,0}", "x")).toBe(false);
    expect(ok("a{0,0}b", "b")).toBe(true);
    expect(ok("[a-c]{0,2}", "")).toBe(true);
    expect(ok("[a-c]{0,2}", "cab")).toBe(false);
  });
  test("a newline, a NUL and non-ASCII never match a class that does not list them", () => {
    for (const bad of ["a\n", "a\0", "aé", "\n"]) expect(ok("[a-z]*", bad)).toBe(false);
  });
  test("construction refuses groups, alternation, nested or stacked repetition, anchors, dot, lookaround, backreferences and bounds over 256", () => {
    for (const bad of ["(a)", "a|b", "(a|b)", "(a+)+", "a**", "a+*", "a{2}{3}", "x{3}", "x{0}", "[a-z]+?", "^a$", "a$", "^a", ".", "a.b", "(?=a)", "\\1", "a{3,}", "a{,3}", "a{2,1}", "a{257}", "a{0,257}", "[]", "[a", "a]", "[z-a]", "[^a]", "a{x}", "", "\\", "{2}", "?a", "*", `${"a".repeat(201)}`]) {
      expect(() => compileEnvPattern(bad), JSON.stringify(bad)).toThrow(/pattern/);
    }
  });
  test("a pattern that would expand past the state budget is refused at construction", () => {
    expect(() => compileEnvPattern("a{256}".repeat(5))).toThrow(/pattern/);
    expect(MAX_PATTERN_STATES).toBeGreaterThanOrEqual(256);
  });
});

describe("linear time: the work is O(length x states), asserted by counting steps, not by timing", () => {
  const worst = "[a-z]*[a-z]*[a-z]*[a-z]*[a-z]*[a-z]*[a-z]*[a-z]*";           // the classic catastrophic shape, here a valid pattern
  test("a near-match input costs steps proportional to its length, and the count doubles when the input doubles", () => {
    const compiled = compileEnvPattern(worst);
    const nearMiss = (n: number) => "a".repeat(n) + "!";
    const small = matchEnvPattern(compiled, nearMiss(100));
    const large = matchEnvPattern(compiled, nearMiss(200));
    expect(small.matched).toBe(false);
    expect(large.matched).toBe(false);
    expect(small.steps).toBeLessThanOrEqual(bound(compiled.states, 101));            // the bound itself
    expect(large.steps).toBeLessThanOrEqual(bound(compiled.states, 201));
    expect(large.steps / small.steps).toBeLessThan(2.2);                              // linear, not quadratic or exponential
    expect(large.steps / small.steps).toBeGreaterThan(1.8);
  });
  test("at the 1024-state cap with a 256-character value the work stays within the documented bound", () => {
    const compiled = compileEnvPattern("[a-z]{0,256}".repeat(4));
    expect(compiled.states).toBe(MAX_PATTERN_STATES);
    const value = "a".repeat(255) + "!";
    expect(value).toHaveLength(256);
    const r = matchEnvPattern(compiled, value);
    expect(r.matched).toBe(false);
    expect(r.steps).toBeLessThanOrEqual(bound(compiled.states, 256));
    expect(matchEnvPattern(compiled, "a".repeat(256)).matched).toBe(true);   // control: the same pattern accepts a 256-character match
  });
  test("the worst valid pattern on the longest accepted value finishes with a bounded step count", () => {
    const compiled = compileEnvPattern("[a-z]{0,256}[a-z]{0,256}");
    const r = matchEnvPattern(compiled, "a".repeat(256) + "!");
    expect(r.matched).toBe(false);
    expect(r.steps).toBeLessThanOrEqual(bound(compiled.states, 257));
  });
});
