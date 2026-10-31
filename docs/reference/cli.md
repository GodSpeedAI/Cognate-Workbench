# Reference: CLI commands

Every recipe in the `justfile`. There are eleven. If a command is not here, it does not exist —
several commands named in older notes have no recipe.

## Recipes

| Command | What it runs | Purpose |
|---|---|---|
| `just setup` | `bun install` | Install dependencies |
| `just dev` | `bun run dev` | Start the server |
| `just typecheck` | `bun run typecheck` | `tsc -p tsconfig.json` |
| `just test` | `bun run test` | The full suite |
| `just verify` | `bun run verify` | Typecheck, then the full suite |
| `just smoke` | `bun run test:smoke` | Three fast pure-domain tests |
| `just setup-realitytrace` | a pinned CLI installer | Install RealityTrace (needs Rust and Cargo) |
| `just db-setup` | `bun scripts/setup-pg0.ts` | Download the pinned, checksum-verified pg0 into `.tmp/pg0` |
| `just db-up` | `.tmp/pg0/pg0 start --name <name>` | Start a pg0 instance |
| `just db-status` | `.tmp/pg0/pg0 info --name <name>` | Inspect a pg0 instance |
| `just db-down` | `.tmp/pg0/pg0 stop --name <name>` | Stop a pg0 instance. Data is kept |

`<name>` is `COGNATE_PG0_NAME`, defaulting to `cognate-dev`.

`just dev` does **not** require `just db-up`. The runtime starts the named pg0 instance on demand.
Use `db-up` / `db-status` / `db-down` to manage it explicitly.

## The standalone command: `cognate-workbench`

The compiled executable in a native package. Its source entry point is `src/cli.ts`.

| Command | Purpose |
|---|---|
| `cognate-workbench` / `cognate-workbench start` | Verify the bundled pg0, start or reconnect its database, and run the server on `PORT` (default 3180) |
| `cognate-workbench doctor` | Report version and commit, runtime, install location, data home, pg0 identity, database mode and health, semantic model, authentication, execution posture, containment, and optional integrations. Exits non-zero only for an unusable installation (pg0 mismatch, unreachable database, missing model). It starts nothing and never prints a credential |
| `cognate-workbench --version` | The version, commit, Bun target and pg0 version the package was built from |
| `cognate-workbench --help` | Usage and the environment variables that matter |

From a checkout, `bun src/cli.ts <command>` runs the same commands; `bun run dev` and `bun run start` call `start`.

Exit status: `0` success, `1` a refusal or failure (the message names the condition), `2` an unknown command.

## Package scripts

| Script | Command |
|---|---|
| `bun run dev` | `bun src/server.ts` |
| `bun run start` | `bun src/server.ts` |
| `bun run test` | `bun test test` |
| `bun run typecheck` | `tsc -p tsconfig.json` |
| `bun run verify` | `bun run typecheck && bun run test` |
| `bun run test:smoke` | `bun test test/workbench-contract.test.ts test/workbench-glob.test.ts test/skill-bundle.test.ts` |

## HTTP endpoints

The server binds `127.0.0.1` only.

| Path | Method | Response |
|---|---|---|
| `/health` | GET | `{ ok: true, semantic: { objects, digest } }` |
| `/cognate.v1.RuntimeService/*` | POST | Connect RPC |
| `/app.js` | GET | The bundled browser JavaScript, `cache-control: no-store` |
| `/app.css` | GET | `app.css` plus the concatenated workbench sheets |
| `/astryx.css` | GET | An Astryx stylesheet, if one is present |
| `/theme.css` | GET | An Astryx theme stylesheet, if one is present |
| `/` | GET | The HTML shell |
| anything else | — | `404 not found` |

## The smoke set

`just smoke` is the fast gate because all three are pure: no runtime, no database, no browser.

| Test | Covers |
|---|---|
| `test/workbench-contract.test.ts` | Contract completeness |
| `test/workbench-glob.test.ts` | Protection pattern matching |
| `test/skill-bundle.test.ts` | The Cognate skill bundle and registry-only SDK consumption |

## CI sequence

`.github/workflows/verify.yml`, on push to `main` or `migration/**`, on pull requests, and on manual
dispatch:

1. Bun 1.4.0, Just, `bun install`
2. `just typecheck`
3. `just smoke`
4. `bun x playwright install --with-deps chromium`
5. `just setup-realitytrace`
6. `just test`

against a `postgres:18` service with `COGNATE_POSTGRES_URL` set. Timeout 45 minutes.

## Commands referenced by legacy notes that do not exist

| Name | Status |
|---|---|
| `just remote-workspaces-live` | **Does not exist.** Named in a removed legacy note as a live gate against real `sshd` and WSL. The SSH and WSL journeys run in CI against the normal suite. |

If you need a live SSH or WSL gate, it has to be written. See
[How to add an execution world](../how-to/add-an-execution-world.md) for what it would need to do.

## Source trail

- `justfile` — the recipes
- `package.json` — the scripts
- `src/server.ts` — the route handling, `Bun.serve`
- `scripts/setup-pg0.ts` — `setup-realitytrace`'s sibling installer pattern
- `.github/workflows/verify.yml` — the CI sequence