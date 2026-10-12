# Cognate Workbench

A capability-native agent development workbench built on the **published Cognate SDK**. This is an application, not a fork of the Cognate framework.

## Development

Requires Bun 1.4+ and PostgreSQL (either locally managed pg0 via the SDK or a configured server). The app uses pinned `@godspeedai/cognate-*` **0.2.0** packages.

```sh
bun install
bun run typecheck
bun run test:smoke
bun run dev
```

For an existing PostgreSQL server, set `COGNATE_POSTGRES_URL` before running. Without it, `src/store.ts` selects the SDK's pg0-managed database. Database startup, migrations and persistence must be verified in the target environment.

Run `just setup-realitytrace` (requires Rust/Cargo) before the complete RealityTrace integration suite; `SXR_BIN` may alternatively point at a pinned, compatible CLI. The normal app still boots without it, but the actual delivery tests intentionally fail when it is absent. Run `bun run test` for the complete application tests. Browser tests require Chromium/Playwright. `just verify` runs typechecking and tests.

## Architecture

- App sources: `src/`
- Semantic interaction domain: `.sea/interaction/`
- Explicit capability bindings: `domain/index.ts`
- Regression suites: `test/`
- Mock-model fixtures: `fixtures/`
- Model-first development skills: `.agents/skills/`
- Original reconstruction decisions: `docs/reconstruction/`

Application runtime composes Cognate via `createRuntime`, not by forking `@godspeedai/cognate-profile-harness`.

## Provenance and limitations

Extracted from [GodSpeedAI/Cognate](https://github.com/GodSpeedAI/Cognate) at commit `a4517d005c433d37a1b3ae7fb149c14e6ca8ec2c`, path `validation/reconstructions/deepseek-harness/cognate/`. The original remains in Cognate until independent validation completes. See [MIGRATION.md](MIGRATION.md). Known behavior and security gaps are tracked in `docs/reconstruction/WORKBENCH-DEVIATIONS.md`.

This repository's development authentication is **not production authentication**. Do not expose the server to untrusted clients without hardening.
