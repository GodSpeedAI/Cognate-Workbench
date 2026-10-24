# SEA formatter fidelity

The interaction model is canonical under DomainForge's formatter while
retaining its parsed meaning and comments. The verifier is
`bun run scripts/verify-sea-format.ts`; its regression test is
`bun test test/sea-format.test.ts`.

The verifier uses the installed `domainforge 0.19.0` at
`/home/sprime01/.cargo/bin/domainforge`. It validates both the checked-in model
and the formatter output, parses both as AST JSON and compares them after
removing source `line` and `column` locations, checks the exact ordered
comment contents and whether each comment trails a declaration, verifies
`fmt(fmt(model)) == fmt(model)`, and requires `domainforge fmt --check` to pass.
Its comment scanner ignores `//` within escaped quoted strings and triple
quoted multiline strings.

## Evidence

- Before canonical formatting, `bun test test/sea-format.test.ts` failed at
  the intended `fmt --check` assertion: DomainForge reported 985 source lines
  versus 983 formatted lines. AST, comment, and validation comparisons passed.
- Formatted the model with `domainforge fmt` 0.19.0. The only source changes
  are two redundant blank lines removed and canonical syntax for the existing
  policy and metric (`forall` layout, `0` to `0.0`, and `count` to `COUNT`).
  The normalized AST is equal; no declaration or semantic ID changed.
- Original and formatted models validate with zero violations. The 37 comment
  tokens are identical and remain in the same leading/trailing positions.
- `domainforge fmt --check .sea/interaction/interaction-model.sea` passes.
- `bun test test/sea-format.test.ts`: 2 passed, 0 failed.
- Upstream focused gate: `CARGO_TARGET_DIR=/tmp/domainforge-formatter-target
  cargo test -p domainforge-core --features cli --test formatter_fidelity_tests`
  passed 4 tests, 0 failed (build artifacts stayed under `/tmp`).

The formatter behavior is provided by DomainForge commit
`5feeb93bda04b9f44077d46faf59458aec4f2e4f` (ADR-017 implementation, PR #130),
present in release tags v0.19.0, v0.20.0, and v0.21.0. That upstream change
fixed quantifier spelling, `entity_instances of` collection decoding, and
comment preservation; this workbench change consumes the published CLI and
does not patch DomainForge.
