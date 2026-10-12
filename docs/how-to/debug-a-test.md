# How-to: debug a test

## Goal

Find and fix a failing test without guessing.

## Know which kind of test you have

The suite is named by what it establishes, so the name tells you where to look.

| Prefix | Kind | How it runs |
|---|---|---|
| `workbench-*.test.ts` | Pure workbench domain unit | no runtime, no database |
| `cognitive-*.test.ts` | Pure cognitive domain unit | no runtime, no database |
| `ui-*.test.tsx` | Component render | `renderToStaticMarkup`, no runtime |
| `J-*.test.ts` | Canonical journey | boots a real server against a real database |
| `E2E-*.test.ts` | Browser | Playwright + Chromium |

`just smoke` runs three pure tests — `workbench-contract`, `workbench-glob`, `skill-bundle` — which
is why it is fast enough to run before every commit.

## Run one test

```bash
bun test test/workbench-authority.test.ts
```

Use a name filter for a subset:

```bash
bun test test/ --test-name-pattern "protected evidence"
```

## Journey tests need infrastructure

`J-*` and `E2E-*` boot a real server via `startServer()` and need a database. Set one up:

```bash
docker run -d --name wb-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  postgres:18
export COGNATE_POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:5432/postgres'
```

Browser tests additionally need:

```bash
bun x playwright install --with-deps chromium
just setup-realitytrace   # the delivery tests fail rather than skip without it
```

The model is faked. `test/helpers.ts` boots the deterministic `aimock` fixture server with
`--validate-on-load`, and `fixtures/workspace/make-workspace.ts` builds a throwaway workspace. You do
not need a real provider.

## Waiting correctly

`test/wb-helpers.ts` states the rule: wait on durable state, never on sleeps.

Because every durable write starts a run and the runtime executes runs serially, a projection row can
lag a capability's return by a moment. A `sleep(500)` is both slower and flakier than waiting for the
row you actually want:

```ts
await waitFor(async () => (await readRows("workbench"))?.tasks.length === 1);
```

If a test is flaky, this is almost always why.

## When a journey test fails at boot

| Message | Cause |
|---|---|
| A DomainForge parse error | The `.sea` model does not parse |
| "expected N bound contracts, got M" | A component's capability list and its tranche count assertion disagree |
| Connection refused to PostgreSQL | No `COGNATE_POSTGRES_URL` and no pg0 |

The count assertion is a feature. If you removed a capability from a component and forgot the
assertion, boot fails loudly rather than running with a silently missing capability.

## When an approval test hangs

An approval journey parks a run on a durable continuation and resolves it. If the test hangs, the
resolve never happened, or the run is waiting on something else — a plan review, or a second gate.

Check which continuation the run is on rather than adding a timeout.

## When a UI test fails on a word

`ui-*.test.tsx` assert the visible words, roles and aria attributes that carry meaning — including the
honest-empty and disabled-with-reason states. If a test fails because a label changed, decide which
is wrong: the component or the assertion. Both are load-bearing; neither is a detail.

## Isolate

```bash
just typecheck                          # is it even a typecheck failure?
bun test test/workbench-ledger.test.ts  # narrow to one file
bun test test/ --test-name-pattern "authority"
```

`just typecheck` first is worth the habit: many apparent logic failures in this codebase are
`noUncheckedIndexedAccess` errors surfacing as something else.

## Common failures and their causes

| Symptom | Likely cause |
|---|---|
| Hangs | Waiting on a continuation, or sleeping instead of waiting on a row |
| Flaky in CI only | Timing; replace the sleep with a durable wait |
| "unknown tool" | The turn's preset excludes it |
| Connection refused | No database |
| Delivery test failure | RealityTrace CLI missing |
| Count assertion | A component and its binding tranche disagree |

## Before you commit

```bash
just typecheck && just smoke && just test
```

`just verify` runs typecheck then the full suite. AGENTS.md asks for `just typecheck` and targeted
`bun test` runs before changing UI or agent behaviour.

## Source trail

- `justfile` — `smoke`, `test`, `verify`, `setup-realitytrace`
- `package.json` — `test`, `test:smoke`, `typecheck`
- `test/helpers.ts` — server boot, the aimock fixture, connection helpers
- `test/wb-helpers.ts` — the "wait on durable state, never on sleeps" rule
- `fixtures/README.md`, `fixtures/workspace/make-workspace.ts` — the test fixtures
- `domain/index.ts` — the binding count assertions that fail at boot
- `src/ui/workbench/UX.md` — what the `ui-*.test.tsx` tests are asserting