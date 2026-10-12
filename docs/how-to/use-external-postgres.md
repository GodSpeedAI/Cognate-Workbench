# How-to: use an existing PostgreSQL

## Goal

Run Workbench against a PostgreSQL server you already operate, instead of the bundled pg0 instance.

## Prerequisites

- A reachable PostgreSQL 18 server (CI uses the `postgres:18` image).
- A database the app may create schemas in. The schema is created per home directory.

## Procedure

Set the URL and start. That is the whole mechanism — `storeConfigFor` branches on the variable being
present.

```bash
export COGNATE_POSTGRES_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE'
just dev
```

Or for a container, matching CI:

```bash
docker run -d --name wb-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  postgres:18

export COGNATE_POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:5432/postgres'
just dev
```

## What happens

```
COGNATE_POSTGRES_URL set  →  { postgres:  { url, schema } }
COGNATE_POSTGRES_URL unset →  { postgresPg0: { name: COGNATE_PG0_NAME ?? "cognate-dev", schema } }
```

`schema` comes from `schemaFor(dataPath, "harness")`: the home path is sanitised to
`[A-Za-z0-9_]`, truncated to its last 40 characters, lower-cased, and prefixed
`cognate_harness_`.

The consequence worth understanding: **the home directory determines the schema.** The same home
always maps to the same schema, so restarting the server keeps your state. A different home — which
is what each test's `mkdtemp` produces — maps to an isolated one, so suites cannot contaminate each
other.

Note the 40-character tail: two home paths whose sanitised tails are identical will collide.

## Validation

```bash
curl -s http://127.0.0.1:3180/health
```

Expect `{ "ok": true, "semantic": { "objects": <n>, "digest": "<hash>" } }`.

Then confirm a schema appeared:

```sql
SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'cognate_%';
```

## Implementation locations

- `src/store.ts` — `postgresUrl`, `schemaFor`, `storeConfigFor`
- `src/server.ts` — `storeConfigFor(home, "harness")` at boot
- `.github/workflows/verify.yml` — the reference configuration

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| Connection refused | Server not running, or bound elsewhere | Check the host and port |
| Authentication failed | Credentials or `pg_hba.conf` | Verify the URL |
| `schema does not exist` and it is not created | The role lacks `CREATE` on the database | Grant it |
| Two runs sharing state unexpectedly | Same home, or colliding 40-character tails | Use distinct `COGNATE_WORKBENCH_HOME` values |

## Rollback

There is nothing to roll back in the application. To stop using the external server, unset the
variable and restart; the pg0 path takes over. Schemas in the external database are left in place —
drop them yourself if you want them gone.

## Source trail

- `src/store.ts` — the whole mechanism
- `src/server.ts` — the boot call site
- `.github/workflows/verify.yml` — `COGNATE_POSTGRES_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres`
- `README.md` — the quick-start note