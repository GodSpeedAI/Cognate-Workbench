# Reference: test layout

123 files. The naming tells you what kind of test it is and what it establishes.

## By class

| Prefix | Count | Kind | Infrastructure |
|---|---|---|---|
| `J-*` | 64 | Canonical journey | Boots a real server against a real database |
| `workbench-*` | 20 | Pure workbench domain unit | None |
| `ui-*` | 11 | Component render | None (`renderToStaticMarkup`) |
| `E2E-*` | 11 | Browser | Playwright + Chromium |
| `cognitive-*` | 3 | Pure cognitive domain unit | None |
| `expert-*`, `experts-*` | 9 | Expert admission, routing, economics, scheduling | Mixed; several boot a server |
| `providerRegistry`, `executionWorlds`, `containedWorkspace`, `aggregateContainment` | 4 | Provider switch, execution worlds, containment | None or server |
| `sea-format`, `skill-bundle` | 2 | Semantic model formatter, registry-only SDK consumption | None |
| `helpers`, `wb-helpers` | 2 | Shared harness | — |

`just smoke` runs three of the pure ones: `workbench-contract`, `workbench-glob`, `skill-bundle`.

## Why `J-` names exist

Journey ids are stable and short — `j_d_approval`, `j_e_plan`, `j_wb_task_contract` — and they come
from the semantic model's canonical journey catalog. Tests are named after them so the suite reads as
a requirements list, and so a journey in the model with no test is visible as a gap.

Naming: `J-<AREA>-<journey-slug>.ts`. Prefixes in use include `AIM`, `B`, `C`, `CFG`, `COG`, `D`, `E`,
`F`, `G`, `H`, `I`, `PLG`, `RT`, `RW`, `SET`, `T`, `WB`, `WS`, `WS2`.

| Prefix | Area |
|---|---|
| `AIM` | the deterministic model fixture |
| `B` | basic session |
| `C` | tool execution |
| `CFG` | model provider configuration |
| `COG` | cognitive navigation |
| `D` | approval |
| `E` | plan mode |
| `F` | delegation / subagents |
| `G` | persistence |
| `H` | cancellation and provider errors |
| `I` | work details |
| `PLG` | panels and toggles |
| `RT` | RealityTrace |
| `RW` | remote workspaces |
| `SET` | settings |
| `T` | trajectory / developer tools |
| `WB` | workbench |
| `WS`, `WS2` | workspace selection, multi-workspace |

## The harness

`test/helpers.ts` boots the app: `startServer()`, the `aimock` deterministic model server with
`--validate-on-load`, a temporary workspace from `fixtures/workspace/make-workspace.ts`, and a Connect
client. **No real provider is needed.**

`test/wb-helpers.ts` adds, for the workbench journeys: a seeded workspace and model, a reader for the
derived `workbench` projection, and durable waits.

Its header states the rule that matters most when a test is flaky:

> wait on durable state (never on sleeps alone)

Because every durable write starts a run and the runtime executes runs serially, a projection row can
lag a capability's return. Waiting on the row you want is both faster and more reliable than sleeping.

## Fixtures

`fixtures/README.md` documents the two:

- **aimock** — a deterministic OpenAI-compatible endpoint, driven by scenario markers in
  `fixtures.json`, with `--validate-on-load`. This is why a journey test can assert an exact
  transcript.
- **workspace** — a small throwaway project (`make-workspace.ts` plus `template/`) with a source file,
  a notes file and a `package.json`.

## What journey tests establish

| Test | Establishes |
|---|---|
| `J-B-basic-session` | one streamed turn; history feeds the next turn |
| `J-C-tool-execution` | the read → bash → edit loop; the read-before-edit refusal |
| `J-D-approval` | allow, deny, **restart while pending**, and replay safety |
| `J-E-plan` | plan mode, to-dos, plan review |
| `J-F-delegation` | fire-and-forget subagent delegation and return |
| `J-G-persistence` | state survives a restart |
| `J-H-cancellation` / `J-H-provider-error` | stop mid-stream; error classification and retry |
| `J-CFG-model-provider` | configure and hot-swap |
| `J-WS-select` / `J-WS2-multi-workspace` | workspace selection; several workspaces |
| `J-CFG`, `J-RW` | remote workspaces over SSH and WSL |
| `J-COG-*` | case, criterion, world, verification, method, cleanup, search, attention, live verify |
| `J-WB-*` | task contract, review gate, protected evidence, workflow, capability lifecycle, automation, economics, parallelism, steering, grounded feedback |

## Running

```bash
just smoke                              # the three fast ones
bun test test/workbench-authority.test.ts
bun test test/ --test-name-pattern "authority"
just test                               # everything
just verify                             # typecheck + everything
```

Journey and browser tests need a database:

```bash
export COGNATE_POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:5432/postgres'
bun x playwright install --with-deps chromium
just setup-realitytrace
```

The RealityTrace delivery tests **fail** rather than skip when the CLI is absent. That is deliberate: a
silent skip would let a broken evidence layer look healthy.

## Architecture guards

`test/skill-bundle.test.ts` guards that the app consumes the Cognate skills and the SDK through its
published registry, rather than reaching into monorepo internals. `AGENTS.md` states the same rule:
do not import the framework's source, vendored tarballs, or workspace aliases.

## Source trail

- `test/` — the 63 files
- `test/helpers.ts` — the boot harness and the aimock integration
- `test/wb-helpers.ts` — the workbench harness and the durable-wait rule
- `fixtures/README.md`, `fixtures/aimock/fixtures.json`, `fixtures/workspace/make-workspace.ts`
- `package.json` — `test`, `test:smoke`
- `justfile` — `smoke`, `test`, `verify`, `setup-realitytrace`
- `.github/workflows/verify.yml` — the CI sequence
- `.sea/interaction/canonical-journey-catalog.md` — the journey ids tests are named after
- `docs/how-to/debug-a-test.md` — how to diagnose a failure