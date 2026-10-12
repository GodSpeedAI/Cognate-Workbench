import { test, describe, expect } from "bun:test";
import { globToRegExp, globMatch, isGlob } from "../src/workbench/glob";

describe("globToRegExp", () => {
  test("simple literal pattern", () => {
    const regex = globToRegExp("a.csv");
    expect(regex.test("a.csv")).toBe(true);
    expect(regex.test("b.csv")).toBe(false);
  });

  test("* matches any chars except /", () => {
    const regex = globToRegExp("*.csv");
    expect(regex.test("a.csv")).toBe(true);
    expect(regex.test("test.csv")).toBe(true);
    // * does not cross /
    expect(regex.test("dir/a.csv")).toBe(false);
  });

  test("* matches files in same directory only", () => {
    const regex = globToRegExp("src/*.ts");
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("src/lib.ts")).toBe(true);
    expect(regex.test("src/sub/index.ts")).toBe(false);
  });

  test("** matches zero or more directories", () => {
    const regex = globToRegExp("**/*.csv");
    expect(regex.test("a.csv")).toBe(true);
    expect(regex.test("dir/a.csv")).toBe(true);
    expect(regex.test("dir/sub/a.csv")).toBe(true);
    expect(regex.test("a.txt")).toBe(false);
  });

  test("**/path matches at any depth", () => {
    const regex = globToRegExp("**/node_modules");
    expect(regex.test("node_modules")).toBe(true);
    expect(regex.test("src/node_modules")).toBe(true);
    expect(regex.test("src/lib/node_modules")).toBe(true);
  });

  test("trailing /** matches everything beneath", () => {
    const regex = globToRegExp("tests/**");
    expect(regex.test("tests/a.ts")).toBe(true);
    expect(regex.test("tests/a/b.ts")).toBe(true);
    expect(regex.test("tests")).toBe(false);
  });

  test("? matches single non-/ char", () => {
    const regex = globToRegExp("?.md");
    expect(regex.test("a.md")).toBe(true);
    expect(regex.test("1.md")).toBe(true);
    expect(regex.test("ab.md")).toBe(false);
    expect(regex.test("a/b.md")).toBe(false);
  });

  test("multiple ? in pattern", () => {
    const regex = globToRegExp("test_???.js");
    expect(regex.test("test_abc.js")).toBe(true);
    expect(regex.test("test_a.js")).toBe(false);
  });

  test("[abc] character class", () => {
    const regex = globToRegExp("[abc].txt");
    expect(regex.test("a.txt")).toBe(true);
    expect(regex.test("b.txt")).toBe(true);
    expect(regex.test("c.txt")).toBe(true);
    expect(regex.test("d.txt")).toBe(false);
  });

  test("[a-z] character range", () => {
    const regex = globToRegExp("[a-z].js");
    expect(regex.test("a.js")).toBe(true);
    expect(regex.test("m.js")).toBe(true);
    expect(regex.test("z.js")).toBe(true);
    expect(regex.test("A.js")).toBe(false);
    expect(regex.test("1.js")).toBe(false);
  });

  test("[!abc] negated character class", () => {
    const regex = globToRegExp("[!abc].txt");
    expect(regex.test("d.txt")).toBe(true);
    expect(regex.test("z.txt")).toBe(true);
    expect(regex.test("a.txt")).toBe(false);
    expect(regex.test("b.txt")).toBe(false);
  });

  test("{a,b,c} brace alternation", () => {
    const regex = globToRegExp("{a,b}.json");
    expect(regex.test("a.json")).toBe(true);
    expect(regex.test("b.json")).toBe(true);
    expect(regex.test("c.json")).toBe(false);
  });

  test("brace alternation with multiple alternatives", () => {
    const regex = globToRegExp("{src,test,lib}/index.ts");
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("test/index.ts")).toBe(true);
    expect(regex.test("lib/index.ts")).toBe(true);
    expect(regex.test("build/index.ts")).toBe(false);
  });

  test("nested braces work without crashing", () => {
    // Nested braces: {a,{b,c}} - inner braces should not crash
    // We don't require nesting to work, just not to crash
    const regex = globToRegExp("{a,{b,c}}.txt");
    expect(typeof regex).toBe("object");
    expect(regex instanceof RegExp).toBe(true);
  });

  test(".env* matches .env and .env.local", () => {
    const regex = globToRegExp(".env*");
    expect(regex.test(".env")).toBe(true);
    expect(regex.test(".env.local")).toBe(true);
    expect(regex.test(".env.production")).toBe(true);
    expect(regex.test("env")).toBe(false);
  });

  test("dotfiles are matchable by *", () => {
    // Unlike picomatch default, we allow * to match dotfiles
    const regex = globToRegExp("*");
    expect(regex.test(".env")).toBe(true);
    expect(regex.test(".gitignore")).toBe(true);
    expect(regex.test("regular.txt")).toBe(true);
  });

  test("** .git /** matches .git at any depth", () => {
    const regex = globToRegExp("**/.git/**");
    expect(regex.test(".git/config")).toBe(true);
    expect(regex.test("src/.git/config")).toBe(true);
    expect(regex.test("a/b/c/.git/hooks")).toBe(true);
    expect(regex.test(".gitignore")).toBe(false);
  });

  test("escaped * matches literal *", () => {
    const regex = globToRegExp("test\\*.txt");
    expect(regex.test("test*.txt")).toBe(true);
    expect(regex.test("test1.txt")).toBe(false);
  });

  test("escaped ? matches literal ?", () => {
    const regex = globToRegExp("file\\?.txt");
    expect(regex.test("file?.txt")).toBe(true);
    expect(regex.test("file1.txt")).toBe(false);
  });

  test("escaped [ matches literal [", () => {
    const regex = globToRegExp("test\\[1\\].txt");
    expect(regex.test("test[1].txt")).toBe(true);
    expect(regex.test("test1.txt")).toBe(false);
  });

  test("regex metacharacters in filename are escaped", () => {
    // a+b(1).txt should match literally, not as regex
    const regex = globToRegExp("a+b(1).txt");
    expect(regex.test("a+b(1).txt")).toBe(true);
    expect(regex.test("ab(1).txt")).toBe(false);
    expect(regex.test("aab(1).txt")).toBe(false);
  });

  test("complex regex metacharacters", () => {
    const regex = globToRegExp("test$.txt");
    expect(regex.test("test$.txt")).toBe(true);
    expect(regex.test("testaaa.txt")).toBe(false);
  });

  test("parentheses escaped in filename", () => {
    const regex = globToRegExp("func(a,b).js");
    expect(regex.test("func(a,b).js")).toBe(true);
    expect(regex.test("funcab.js")).toBe(false);
  });

  test("unclosed bracket treated as literal", () => {
    const regex = globToRegExp("[unclosed");
    expect(regex.test("[unclosed")).toBe(true);
    expect(regex.test("u")).toBe(false);
  });

  test("unclosed brace treated as literal", () => {
    const regex = globToRegExp("{unclosed");
    expect(regex.test("{unclosed")).toBe(true);
    expect(regex.test("unclosed")).toBe(false);
  });

  test("empty string pattern", () => {
    const regex = globToRegExp("");
    expect(regex.test("")).toBe(true);
    expect(regex.test("a")).toBe(false);
  });

  test("absolute path pattern", () => {
    const regex = globToRegExp("/root/*.txt");
    expect(regex.test("/root/a.txt")).toBe(true);
    expect(regex.test("/root/dir/a.txt")).toBe(false);
  });
});

describe("globMatch with path normalization", () => {
  test("normalizes backslashes to forward slashes", () => {
    expect(globMatch("src/*.ts", "src\\index.ts")).toBe(true);
  });

  test("removes leading ./", () => {
    expect(globMatch("src/*.ts", "./src/index.ts")).toBe(true);
  });

  test("collapses multiple slashes", () => {
    const regex = globToRegExp("src/*.ts");
    // Path normalization collapses //
    const normalized = globMatch("src/*.ts", "src//index.ts");
    expect(normalized).toBe(true);
  });

  test("combined path normalizations", () => {
    expect(globMatch("src/*.ts", ".\\src//index.ts")).toBe(true);
  });
});

describe("globMatch integration", () => {
  test("*.csv matches a.csv but not dir/a.csv", () => {
    expect(globMatch("*.csv", "a.csv")).toBe(true);
    expect(globMatch("*.csv", "dir/a.csv")).toBe(false);
  });

  test("**/*.csv matches both", () => {
    expect(globMatch("**/*.csv", "a.csv")).toBe(true);
    expect(globMatch("**/*.csv", "dir/a.csv")).toBe(true);
  });

  test("tests/** matches tests/a/b.ts and not tests", () => {
    expect(globMatch("tests/**", "tests/a/b.ts")).toBe(true);
    expect(globMatch("tests/**", "tests")).toBe(false);
  });
});

describe("isGlob", () => {
  test("returns false for literal paths", () => {
    expect(isGlob("a.csv")).toBe(false);
    expect(isGlob("src/index.ts")).toBe(false);
  });

  test("returns true for * pattern", () => {
    expect(isGlob("*.csv")).toBe(true);
  });

  test("returns true for ? pattern", () => {
    expect(isGlob("?.md")).toBe(true);
  });

  test("returns true for [ pattern", () => {
    expect(isGlob("[a-z]")).toBe(true);
  });

  test("returns true for { pattern", () => {
    expect(isGlob("{a,b}")).toBe(true);
  });

  test("returns false for escaped glob chars", () => {
    expect(isGlob("\\*.csv")).toBe(false);
    expect(isGlob("\\?.md")).toBe(false);
  });

  test("returns false for literal brackets without glob meaning", () => {
    // unclosed [ might still be a literal
    expect(isGlob("[unclosed")).toBe(true); // contains [
  });
});

describe("performance: pathological patterns", () => {
  test("5000-char path against complex pattern completes quickly", () => {
    const longPath = "a/".repeat(1000) + "a";
    const pattern = "**/*a*a*a*b"; // This can cause backtracking

    const start = performance.now();
    const result = globMatch(pattern, longPath);
    const elapsed = performance.now() - start;

    // Should complete in under 200ms even though it doesn't match
    expect(elapsed).toBeLessThan(200);
    expect(result).toBe(false);
  });

  test("deeply nested ** pattern", () => {
    const longPath = "a/b/c/d/e/f/g/h/i/j/test.ts";
    const pattern = "**/test.ts";

    const start = performance.now();
    const result = globMatch(pattern, longPath);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result).toBe(true);
  });
});

describe("edge cases", () => {
  test("pattern with only **", () => {
    const regex = globToRegExp("**");
    expect(regex.test("anything")).toBe(true);
    expect(regex.test("a/b/c")).toBe(true);
    expect(regex.test("")).toBe(true);
  });

  test("multiple ** in sequence", () => {
    const regex = globToRegExp("**/**");
    expect(regex.test("a")).toBe(true);
    expect(regex.test("a/b")).toBe(true);
  });

  test("file ending with *", () => {
    const regex = globToRegExp("test*");
    expect(regex.test("test")).toBe(true);
    expect(regex.test("test.ts")).toBe(true);
    expect(regex.test("test/file")).toBe(false);
  });

  test("directory-like patterns", () => {
    const regex = globToRegExp("src/*/index.ts");
    expect(regex.test("src/lib/index.ts")).toBe(true);
    expect(regex.test("src/lib/sub/index.ts")).toBe(false);
  });

  test("pattern with no wildcards", () => {
    const regex = globToRegExp("package.json");
    expect(regex.test("package.json")).toBe(true);
    expect(regex.test("src/package.json")).toBe(false);
  });

  test("hyphen in character class", () => {
    const regex = globToRegExp("[a-z]");
    expect(regex.test("a")).toBe(true);
    expect(regex.test("z")).toBe(true);
    expect(regex.test("A")).toBe(false);
  });

  test("caret at start of class is negation", () => {
    const regex = globToRegExp("[^abc]");
    expect(regex.test("d")).toBe(true);
    expect(regex.test("a")).toBe(false);
  });

  test("brace with no comma", () => {
    // {single} with no comma should match literally
    const regex = globToRegExp("{single}");
    // This might match "single" or "{single}" depending on implementation
    // Our implementation treats {X} without comma as literal
    expect(regex.test("{single}")).toBe(true);
  });

  test("empty alternatives in braces", () => {
    const regex = globToRegExp("{a,,b}");
    expect(regex.test("a")).toBe(true);
    expect(regex.test("b")).toBe(true);
    expect(regex.test("")).toBe(true); // empty alternative
  });

  test("** at the very start", () => {
    const regex = globToRegExp("**/src/index.ts");
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("a/src/index.ts")).toBe(true);
    expect(regex.test("a/b/c/src/index.ts")).toBe(true);
  });

  test("multiple levels of **", () => {
    const regex = globToRegExp("**/node_modules/**/index.js");
    expect(regex.test("node_modules/index.js")).toBe(true);
    expect(regex.test("src/node_modules/lib/index.js")).toBe(true);
    expect(regex.test("a/node_modules/b/c/index.js")).toBe(true);
  });
});
