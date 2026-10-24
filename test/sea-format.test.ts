import { describe, expect, test } from "bun:test";
import { extractCommentTokens, verifySeaFormat } from "../scripts/verify-sea-format";

describe("SEA formatter fidelity", () => {
  test("comment scanner ignores slashes inside single-line and multiline strings", () => {
    expect(
      extractCommentTokens(`Entity "https://example.test" // declaration note\nValue """\n// string data\n"""\n// final note`),
    ).toEqual([
      { text: "declaration note", trailing: true },
      { text: "final note", trailing: false },
    ]);
  });

  test("model formatting preserves AST and comments and is canonical", () => {
    verifySeaFormat();
  });
});
