# Reference: configuration and environment

Everything that changes behaviour at runtime: environment variables, the durable settings surface,
and the one file that is *not* a runtime input.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3180` | HTTP port. The server always binds `127.0.0.1`. |
| `COGNATE_WORKBENCH_HOME` | `<repo>/.data` | The application data directory. |
| `COGNATE_HARNESS_HOME` | — | **Legacy** fallback for the home. Still accepted for migration; `COGNATE_WORKBENCH_HOME` wins. |
| `COGNATE_POSTGRES_URL` | unset | Use an external PostgreSQL instead of pg0. |
| `COGNATE_PG0_NAME` | `cognate-dev` | The pg0 instance name. |
| `SXR_BIN` | unset | Path to a RealityTrace binary. Falls back to the pinned local install. |
| `MODEL_RETRY_BACKOFF_MS` | unset | Overrides the base model-retry backoff. |
| `CI` | unset | Set by CI. Present in the workflow, not read by application code. |
| `COGNATE_PG0_BIN` | — | Referenced only in `scripts/setup-pg0.ts`'s error message, suggesting it as a manual-install escape. Not read by the app. |

### Resolution order

```
home = COGNATE_WORKBENCH_HOME ?? COGNATE_HARNESS_HOME ?? <repo>/.data
port = PORT ?? 3180
store = COGNATE_POSTGRES_URL ? postgres(url, schema) : postgresPg0(COGNATE_PG0_NAME ?? "cognate-dev", schema)
schema = "cognate_harness_" + sanitise(home)      // [A-Za-z0-9_], last 40 chars, lower-cased
```

**The home determines the schema.** The same home always maps to the same schema, so restarting
keeps your state. A different home maps to an isolated schema — which is how each test's temporary
directory stays uncontaminated.

Note the 40-character tail: two home paths whose sanitised tails match will collide.

## What lives where

| Path | Contents |
|---|---|
| `<home>/secrets.json` | API keys, SSH passwords and passphrases. Created with restrictive permissions. |
| `<home>/` (derived schema) | All durable events, projections, continuations, the outbox, observation receipts. |
| `.tmp/pg0/pg0` | The pinned PostgreSQL launcher (Linux x86-64 only). |
| `.tmp/realitytrace/bin/realitytrace` | The pinned RealityTrace CLI. |
| `.generated/entry.tsx` | The generated browser entry point. Rewritten on every boot. |
| `.data/` | The default home, when neither home variable is set. |

## Durable settings

Settings are not environment variables. They are events folded into the `settings` projection's single
current row, editable in **Settings → General** and persisted in PostgreSQL.

Events carry **partial patches**, so each `settings.change*` capability writes only its own field and
the fold merges into the previous row. A field, once set, keeps its value until a later event changes
it. The `plugins` map merges per key.

| Setting | Type | Default | Notes |
|---|---|---|---|
| `workDetails` | `compact` \| `standard` \| `detailed` \| `verbose` | `standard` | How much of each tool call renders. `showsLiveProcessDetail` is true for `standard` and `detailed`. |
| `permission` | access mode | `read-only` | The composer's per-session access-mode dropdown is wired to it; see below. |
| `language` | language code | — | |
| `appearance` | `light` \| `dark` \| `system` | `system` | |
| `fontSize` | number | — | |
| `performanceDetail` | level | — | |
| `codingTools` | selection | — | |
| `sendBehavior` | `enter` \| `ctrl-enter` | — | |
| `preset` | `standard` \| `ptc` \| `minimal` | `standard` | Agent preset sent with each turn. |
| `plugins` | `Record<string, boolean>` | — | Global plugin enable state. Only plugins with real runtime behaviour are toggleable. |

Because absence of a row means "the default", a fresh home directory needs no seeded row.

`resolveGeneralSettings` in `src/settings.ts` is the read-side resolver: it applies the documented
defaults for anything absent.

## Settings that are durable but not settings

Two more pieces of durable per-home state, each with their own small projection:

| State | Projection | Consequence of absence |
|---|---|---|
| The configured model provider | `model-config` | No provider is mounted; the agent cannot call the model. |
| First-run dialog dismissals | `onboarding` | The dialogs reappear. |

## What is *not* configuration

### `cognate.config.ts`

```ts
export default {
  profile: "harness",
  instructions: "Cognate Workbench: capability-native agent development, …",
} satisfies CognateConfig;
```

Its own header says it is **not consumed by `cognate dev`**. It is kept for shape parity with the
generated starter and as a single place for app metadata. Look here for descriptions; do not expect
behaviour.

### The semantic model

`.sea/interaction/interaction-model.sea` is configuration in the sense that it names things, but
changing it changes the boot-time object set and every binding keyed on a semantic id. `AGENTS.md`
requires preserving semantic ids unless performing an explicit data migration.

### The composer's per-session overrides

Two composer selections are **not** settings: they are per-session, held in the UI, and resolved at
send time.

| Selection | Resolution order for a send |
|---|---|
| Access mode | the per-session override → the pending hero-composer choice (consumed by the session-creating send) → the `permission` setting |
| Agent preset | the per-session override → the `preset` setting |

The chosen access mode is passed to `agent.coding` as `AgentCodingInput.mode`, which feeds
`approvalGate`. Both are folded back by the `sessions` projection from the run inputs the turn
carried, which is how the UI reads the current value. See
[Authority and approval](../concepts/authority-and-approval.md).

## Verified versus uncertain

| Claim | Status |
|---|---|
| The seven environment variables and their defaults | **Verified** in `src/server.ts`, `src/store.ts`, `src/observations.ts`, `src/agents/agentCoding.ts` |
| The home → schema derivation and its 40-character tail | **Verified** in `src/store.ts` |
| The settings fields and their merge semantics | **Verified** in `src/settings.ts` and `src/projections/settings.ts` |
| The composer's access mode and preset are per-session, not settings, and feed `approvalGate` | **Verified** in `src/ui/App.tsx` (the `accessModeOverrides` / `presetOverrides` resolution and the `mode` passed to the run) |
| `cognate.config.ts` is not read at runtime | **Verified** — its own comment says so |
| Whether `MODEL_RETRY_BACKOFF_MS` overrides the base or the whole delay | **Uncertain.** Read the usage site before relying on it. |

## Source trail

- `src/server.ts` — `PORT`, home resolution, `COGNATE_HARNESS_HOME` fallback
- `src/store.ts` — `storeConfigFor`, `schemaFor`, `COGNATE_POSTGRES_URL`, `COGNATE_PG0_NAME`
- `src/settings.ts` — `SettingsPatch`, `GeneralSettings`, `resolveGeneralSettings`, the field
  vocabularies
- `src/workDetails.ts` — the work-details modes and `showsLiveProcessDetail`
- `src/observations.ts` — `SXR_BIN`, `defaultSxrBin`
- `src/agents/agentCoding.ts` — `MODEL_RETRY_BACKOFF_MS`, the retry loop
- `src/secrets.ts` — the secrets file
- `src/projections/settings.ts` — the merge, including per-key `plugins`
- `src/projections/modelConfig.ts`, `onboarding.ts` — the other durable per-home state
- `cognate.config.ts` — app metadata only
- `scripts/setup-pg0.ts` — `COGNATE_PG0_BIN` in the error message