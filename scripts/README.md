# scripts

## Overview

Operational and maintenance scripts for the Cognate Workbench, each run directly with
Bun (`bun scripts/<name>.ts`). There is no shared module here; each file is a
self-contained entry point except `verify-sea-format.ts`, which also exports two
functions imported by `test/sea-format.test.ts`. The scripts cover four maintenance
tasks: PostgreSQL-backed scale benchmarking of the Experts aggregate, drafting a Linux
bubblewrap containment config, installing the pinned `pg0` PostgreSQL binary, and
verifying DomainForge formatter fidelity for the SEA interaction model.

## Interface

- `benchmark-experts.ts` — executable (`main` guarded by `import.meta.main`). CLI
  options parsed by `parseConfig`: `--experts`, `--teams`, `--memories`,
  `--messages`, `--memory-chars`, `--message-chars`, `--operations`, `--concurrency`,
  `--partitioned`, `--help` (see `benchmark-experts.ts:HELP`). Populates synthetic
  Experts/Teams/memories/messages via `populate` (`ExpertsService.mutate`), sweeps
  concurrent `expert.save` writers via `runWriters`, instruments
  `RuntimeService.readSharedState`/`updateSharedState` through `instrument`, and
  emits one JSON benchmark report to stdout. No exports.
- `containment-config.ts` — executable. CLI flags `--bwrap <path>`, `--source
  "<provenance>"`, `--out <file>`, `--attest` (`containment-config.ts:opt`,
  `containment-config.ts:attest`). Measures the host `bwrap` binary (path, SHA-256,
  reported version, dpkg package origin, CVE-2026-87766 patch state via
  `distroPatchState`), validates the draft with `validateContainmentConfig` from
  `../src/capabilities/containedWorkspace.ts`, and either prints the draft or writes
  the containment JSON. No exports.
- `setup-pg0.ts` — executable, also the target of `just db-setup`
  (`justfile:db-setup` → `bun scripts/setup-pg0.ts`). Downloads the pinned pg0
  release binary (`PG0_VERSION`, `DIGESTS`) into `.tmp/pg0/pg0`. No exports.
- `verify-sea-format.ts` — exports `extractCommentTokens(source: string):
  CommentToken[]` and `verifySeaFormat(path = .sea/interaction/interaction-model.sea):
  void` (`verify-sea-format.ts:extractCommentTokens`,
  `verify-sea-format.ts:verifySeaFormat`). When run as a script (`import.meta.main`),
  verifies `domainforge fmt` fidelity against the repository's canonical model
  `.sea/interaction/interaction-model.sea`, or the path given as `argv[2]`.

## Invariants

- `benchmark-experts.ts`: the serialized Expert snapshot is capped at 900 KiB to stay
  below Cognate's 1 MiB event envelope limit; exceeding it aborts unless
  `--partitioned` is set (`benchmark-experts.ts:populate`), and the committed
  aggregate is re-checked after population (`benchmark-experts.ts:main`).
- `benchmark-experts.ts`: config bounds are enforced in `parseConfig` —
  `--concurrency` accepts only 1, 2, 4, or 8; `--teams` cannot exceed `--experts`;
  synthetic text is capped at 24 MiB; `--operations` is bounded to 4..32.
- `benchmark-experts.ts`: memory quality/scope gates must pass or the run aborts —
  pinned notes retained, exactly one lexical exact match, zero cross-expert
  personal-scope leaks, zero context scope leaks (`benchmark-experts.ts:main`).
- `benchmark-experts.ts`: connection URLs are never printed; `safeError` redacts
  `postgres://`/`postgresql://` URLs (`benchmark-experts.ts:safeError`).
- `benchmark-experts.ts`: no model calls or external vector services are used
  (`benchmark-experts.ts:HELP`); post-restart state recovery must be complete or the
  script exits non-zero (`benchmark-experts.ts:main`).
- `containment-config.ts`: a binary without the CVE-2026-87766 fix (bubblewrap
  < 0.12.0 and no distro patch) is refused outright with exit code 2
  (`containment-config.ts:distroPatchState` and the `patched` gate).
- `containment-config.ts`: `operatorVerified` is written only with `--attest`, which
  records the operator reviewed the binary; without `--attest` the draft is printed
  but never written to disk (`containment-config.ts:draft`, `--attest` branch). The
  source provenance of a non-package binary is never inferred — only `--source` or
  dpkg metadata is recorded (`containment-config.ts:source`).
- `setup-pg0.ts`: the pg0 version and its sha256 are pinned in the script and
  verified on every run; a digest mismatch aborts the install
  (`setup-pg0.ts:DIGESTS`, sha256 check on the fetched bytes). Only
  `linux-x86_64-gnu` has a pinned digest; other platforms must set `COGNATE_PG0_BIN`
  (`setup-pg0.ts:target`).
- `verify-sea-format.ts`: `domainforge fmt` must not change the normalized AST
  (excluding `line`/`column` locations), must preserve comment content, placement,
  and trailing flags (string-aware extraction via `extractCommentTokens`), must be
  idempotent on a second pass, and `domainforge fmt --check` must pass
  (`verify-sea-format.ts:verifySeaFormat`). Both the original and the formatted model
  must pass `domainforge validate --format human`.
- These scripts are maintenance tooling: none of them is exercised by `bun run test`
  except `verify-sea-format.ts`, whose exported functions are imported by
  `test/sea-format.test.ts`.

## Side Effects

- `benchmark-experts.ts` requires a reachable PostgreSQL: `COGNATE_POSTGRES_URL` when
  set, otherwise the pg0 instance named by `COGNATE_PG0_NAME` (default
  `cognate-dev`) via `resolvePg0Url` (`benchmark-experts.ts:main`). It starts and
  stops a full workbench server (`startServer({ port: 0, home })`), creates a unique
  Cognate schema and drops that schema on exit, creates and removes a
  `cognate-experts-scale-*` temp home directory, and writes synthetic state
  (Experts, Teams, memories, messages) through the Experts service. Needs a running
  environment — do not invoke casually against shared databases.
- `containment-config.ts` executes the `bwrap` binary (`--version`), queries
  `dpkg-query` and zcats the distro changelog (`containment-config.ts:sh`,
  `containment-config.ts:distroPatchState`), and computes the SHA-256 of the bwrap
  binary. With `--attest --out <file>` it writes the containment JSON intended for
  `COGNATE_LINUX_CONTAINMENT_CONFIG`.
- `setup-pg0.ts` fetches from
  `https://github.com/vectorize-io/pg0/releases/...` over the network and creates
  `.tmp/pg0/` inside the repository, writing the `pg0` binary with mode 0o755 and
  unlinking a previously installed binary whose digest no longer matches
  (`setup-pg0.ts` top-level module code).
- `verify-sea-format.ts` requires the `domainforge` CLI on `PATH` and shells out to
  it repeatedly (`fmt`, `fmt --check`, `validate`, `parse --ast --format json`);
  install it with `just setup-domainforge`, which puts the pinned build in
  `.tmp/domainforge` (`justfile:setup-domainforge`). It reads the SEA model
  read-only, writes `domainforge fmt` output only to a `cognate-sea-format-*` scratch
  temp directory, and removes that scratch directory on exit.
- Shared read across scripts: several of these flows depend on binaries pinned into
  `.tmp/` by justfile setup recipes (`db-setup` for pg0, `setup-domainforge` for
  DomainForge); `.tmp/` is repo-local and never committed.

## Verification

- Repository test suite: `bun run test` (equivalent to
  `bun test --timeout 15000 test` from the repo root).
- Typecheck: `just typecheck` (runs `tsc -p tsconfig.json`).
- Full gate: `just verify` (typecheck + test).
- `setup-pg0.ts` is directly exercised by `just db-setup`.
- `verify-sea-format.ts` needs `just setup-domainforge` first (the pinned
  DomainForge CLI); `containment-config.ts` needs bubblewrap >= 0.12.0 on the host;
  `benchmark-experts.ts` needs a reachable PostgreSQL per the environment rules
  above.
