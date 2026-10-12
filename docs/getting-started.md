# Getting started

## Prerequisites

| Requirement | Version | Why |
|---|---|---|
| [Bun](https://bun.sh) | 1.4+ | Runtime, test runner, bundler, and package manager |
| [Just](https://github.com/casey/just) | any recent | Task runner (`just dev`, `just verify`) |
| PostgreSQL | 18 | The durable event store |
| Linux x86_64 or WSL | | Only for the bundled `pg0` path; see below |
| Rust and Cargo | | Only for RealityTrace, which is optional |

The app depends on pinned `@godspeedai/cognate-*` **0.2.0** packages. It consumes the published SDK
only. It does not import Cognate monorepo source.

## Run it

```bash
git clone https://github.com/GodSpeedAI/Cognate-Workbench.git
cd Cognate-Workbench
bun install
just db-setup     # downloads the pinned, checksum-verified pg0 binary into .tmp/pg0
just dev
```

`just dev` starts the server on `http://127.0.0.1:3180` and prints the dev bearer token. The
browser opens on that address.

`just db-setup` only installs the binary. `just db-up` starts a named instance. If you would rather
use a PostgreSQL server you already run, skip both and set `COGNATE_POSTGRES_URL` instead — see
[Use an existing PostgreSQL](how-to/use-external-postgres.md).

## First five minutes

1. The app opens with two first-run dialogs. Dismiss them. The dismissal is durable per home
   directory; deleting the home directory brings them back.
2. Open **Settings → Models** and add a provider: a name, a base URL, a wire protocol, a model id,
   and an API key. The key is written to `secrets.json` under your home directory; the event log
   never sees it.
3. Select or add a workspace. A workspace is a directory on a machine the app can reach.
4. Send a message. The agent will call `read`, `edit`, and `bash` against that workspace, and the
   transcript shows each tool call and its output.

You now have the loop described in [Send a turn](workflows/send-a-turn.md).

## Verify the install

```bash
just typecheck   # tsc -p tsconfig.json
just smoke       # three fast, deterministic tests
just test        # the whole suite
just verify      # typecheck then test
```

`just test` needs the optional integration prerequisites — Chromium via Playwright and the pinned
RealityTrace CLI. The delivery tests intentionally fail without them rather than skipping silently.

```bash
bun x playwright install --with-deps chromium
just setup-realitytrace    # requires Rust and Cargo; sets nothing globally
```

Without RealityTrace the app still runs; observations stay queued and are never reported as
delivered.

## What you just installed into your machine

- `.tmp/pg0/pg0` — a pinned PostgreSQL launcher, verified against a recorded sha256 on every run.
- `.tmp/realitytrace/` — the pinned RealityTrace CLI, same trust pattern.
- `.data/` — the default home directory, unless you set `COGNATE_WORKBENCH_HOME`.

## Before you trust it with anything that matters

The development authenticator is a single-operator development token, not production
authentication. Path checks and best-effort shell parsing are not a sandbox. The server binds to
`127.0.0.1` and refuses nothing else about its callers. Read [Known gaps](known-gaps.md) before
pointing this at untrusted code or data.

## Where to go next

- [Tutorial: first run](tutorials/first-run.md) — a guided session with expected results.
- [Mental model](mental-model.md) — the shape of the system.
- [Glossary](glossary.md) — the vocabulary.
- [Troubleshooting](troubleshooting.md) — when something does not work.