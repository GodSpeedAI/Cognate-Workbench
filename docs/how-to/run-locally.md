# How-to: run locally

## Goal

Get a working local development server.

## Prerequisites

Bun 1.4+, Just, and Linux x86-64 / WSL if you want the bundled pg0 path.

## Option A — bundled pg0 (Linux x86-64 / WSL)

```bash
bun install
just db-setup    # downloads pg0 0.15.2 into .tmp/pg0 and verifies its sha256
just dev
```

`db-setup` is idempotent: on a second run it re-hashes the existing binary and exits if it matches.

`just dev` starts the server. You do not need `just db-up` — the runtime starts the named pg0
instance on demand. Use `db-up` / `db-status` / `db-down` to manage the instance explicitly.

**Verify:** `http://127.0.0.1:3180` loads and `/health` returns
`{ ok: true, semantic: { objects, digest } }`.

## Option B — an existing PostgreSQL

See [Use an existing PostgreSQL](use-external-postgres.md).

## Useful variations

```bash
PORT=4000 just dev                                  # a different port
COGNATE_WORKBENCH_HOME=/tmp/wb just dev             # a throwaway home
COGNATE_PG0_NAME=wb-alt just db-up                   # a differently-named pg0 instance
```

The home directory determines the PostgreSQL schema, so two homes never share state. This is what
makes per-test isolation work.

## Implementation locations

| Step | Where |
|---|---|
| `just db-setup` | `justfile`, `scripts/setup-pg0.ts` |
| `just dev` | `justfile`, `package.json` → `bun src/server.ts` |
| home resolution | `src/server.ts` module tail |
| schema derivation | `src/store.ts` → `schemaFor` |
| store selection | `src/store.ts` → `storeConfigFor` |

## Validation

```bash
just typecheck
just smoke     # three fast pure-domain tests; no server, no database
just verify    # typecheck + the whole suite
```

`just test` needs Chromium (`bun x playwright install --with-deps chromium`) and the pinned
RealityTrace CLI (`just setup-realitytrace`, requires Rust and Cargo). Without them, the delivery
tests fail rather than skipping.

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| `setup-pg0: no pinned pg0 binary for <platform>-<arch>` | Not Linux x86-64 | Install PostgreSQL yourself and use `COGNATE_POSTGRES_URL` |
| `sha256 mismatch for pg0` | Corrupt or tampered download | Re-run `just db-setup`; investigate before trusting it |
| `EADDRINUSE` | Another instance is running | `PORT=…`, or stop the other one |
| Server starts but the agent cannot call the model | No provider configured | Settings → Models |
| Observations stay queued | No SXR binary | `just setup-realitytrace`, or set `SXR_BIN` |

## Recovery

There is no application state to recover — projections rebuild from the event log. To reset
everything, delete the home directory (or point `COGNATE_WORKBENCH_HOME` somewhere new). That
includes sessions, settings, provider configuration and the first-run dismissals.

## Source trail

- `justfile` — every recipe
- `package.json` — the `dev`, `start`, `typecheck`, `test`, `verify`, `test:smoke` scripts
- `scripts/setup-pg0.ts` — `PG0_VERSION`, `DIGESTS`, `target`
- `src/server.ts` — the `import.meta.main` block
- `src/store.ts` — `schemaFor`, `storeConfigFor`
- `fixtures/README.md` — the deterministic model fixture used by tests