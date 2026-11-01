# Interaction model conformance, 2026-10-31

Branch `feat/ui-production-readiness`. Scope: the `building-with-cognate` rule that the model, the
catalog, the handoff bindings and the journey tests agree. Method: a script compared the 82 literal
capability ids in `GRANTED_CAPABILITIES` (`src/server.ts`) and the 87 `journey_id` records in
`interaction-model.sea` (87 before this pass, 90 after) against `canonical-journey-catalog.md`,
`handoff.md`, `domain/index.ts` and `test/`.

## Gaps found and disposition

| # | Gap | Fix | Status |
|---|---|---|---|
| 1 | 13 journeys in the model had no catalog entry: `J-CFG-config-path`, `J-CFG-config-edit`, `J-CFG-model-catalog`, `J-CFG-provider-delete`, `J-SECRETS-storage`, `J-WS-files-browse`, `J-PLG-install`, `J-PREFS-shortcuts`, `J-SESSION-archive`, `J-TEAM-ADMISSION`, `J-AUTH-SESSION`, `J-AUTH-TENANT-ISOLATION`, `J-RW-AGGREGATE-CONTAINMENT` | entries added to the catalog from the model records, each with its executable evidence | fixed |
| 2 | Desktop launch (`cognate-workbench launch` / `stop`) had no journey | `J-DESKTOP-launch` added to the model and catalog as a host-surface journey with settlement, variants and evidence `test/J-DESKTOP-launch.test.ts` | fixed |
| 3 | Command palette, global shortcuts and inspector tabs had no model presence | `J-UI-command-palette`, `J-UI-inspector` added (pure projections, no capability of their own); global shortcuts added as a variant of `J-PREFS-shortcuts`. The model has no separate affordance/surface section, so the existing journey-record convention was followed | fixed |
| 4 | `J-A-first-use` described the old flow (Settings -> Models, then workspace) | steps, capabilities and variants updated to Welcome -> Connect a model provider -> Choose a folder -> ready, plus Configure later and the empty state; catalog entry rewritten | fixed (re-check when the in-progress onboarding work lands) |
| 5 | Folder suggestion matching (f138304) not reflected | variant added to `J-WS-directory-discovery` | fixed |
| 6 | Handoff recorded bindings for only some capabilities; 49 of 82 granted ids absent | "Capability binding register" added to `handoff.md` listing every granted literal id, its anchor table and its journeys | fixed |
| 7 | Source translation map had no record of the PandaCode UI adoption or divergences | donor mapping table and divergence list added | fixed |
| 8 | `J-DESKTOP-launch`, palette and inspector tests not named after the journey id | `describe`/`test` titles prefixed with the journey id in `test/J-DESKTOP-launch.test.ts`, `test/ui-shell.test.tsx`, `test/ui-inspector-tabs.test.tsx` (naming only) | fixed |
| 9 | `onboarding.dismiss` granted and registered, but no `semanticRef` and no anchor in `domain/index.ts` | recorded in handoff "Open binding gaps"; `domain/index.ts` and `src/server.ts` are outside this pass | OPEN |
| 10 | `execution.wsl.list` has no binding (siblings `execution.world.*` do) | recorded | OPEN |
| 11 | `observation.status`, `observation.record` have no binding and no journey | recorded | OPEN |
| 12 | `J-A-first-use` has no test named after it; `test/E2E-onboarding.test.ts` covers it but belongs to the agent doing the onboarding rework | catalog cites the file and flags the naming; that agent should put `J-A-first-use` in the `describe` title | OPEN |
| 13 | No test named after `J-WB-focus`, `J-TEAM-CONVERSE`, `J-TEAM-SETTLEMENT` (older, cited by other files, not renamed here) | recorded in assumptions | OPEN |
| 14 | `J-PKG-*` (7 journeys) have no `test/` file | by design: evidence is installed-archive qualification (catalog states this); not an unmet claim | accepted |
| 15 | 36 tests named `J-<ID>-...` do not match a `journey_id` exactly (for example `J-TEAM-security`, `J-SET-settings`, `J-EXPERT-inbox`). Most are sub-suites of a journey or support capabilities | not renamed; listed so a later pass can map or alias them | OPEN (informational) |

Note on count 6: the register lists 82 literal ids. Ids supplied by `*_ANCHORS` spreads in
`GRANTED_CAPABILITIES` are bound by those tables.

## Validation

All commands run from the repository root.

| Command | Result |
|---|---|
| `domainforge --version` (global) | `domainforge 0.21.2`, the version pinned in the justfile |
| `domainforge validate --format human .sea/interaction/interaction-model.sea` | `Validation succeeded: 0 violations total` |
| `domainforge fmt --check .sea/interaction/interaction-model.sea` | `already formatted` |
| `domainforge parse .sea/interaction/interaction-model.sea --format human` | Entities 55, Resources 54, Flows 54, Roles 8, Relations 6, Entity instances 91, Policies 1 |
| `bun scripts/verify-sea-format.ts` | `SEA formatter fidelity verified` |
| `bun test test/sea-format.test.ts test/skill-bundle.test.ts test/J-SEA-FORGE-AUTHORITY.test.ts test/J-DESKTOP-launch.test.ts test/ui-shell.test.tsx test/ui-inspector-tabs.test.tsx test/cognitive-bindings.test.ts` | 26 pass, 1 skip, 0 fail |
| the two other tests importing `domain/index` | 5 pass, 0 fail |
| `loadDomain()` and `bindTranche11` | 270 semantic objects loaded, 10 bindings resolve |

The one skip is in an existing test file and was not traced; the desktop launch suite ran (it is skipped only on win32).
The full `just verify` gate was not run in this pass: other agents are editing `src/ui/**`
concurrently, so a full run would not be attributable to the model change.

## Repo-local pinned DomainForge install

Gate: met.

| Command | Result |
|---|---|
| `just setup-domainforge` (`cargo install domainforge-core --version 0.21.2 --features cli --locked --root .tmp/domainforge`) | exit 0, about 12 minutes of compilation; `.tmp/domainforge/bin/domainforge` installed (`.tmp` is git-ignored) |
| `.tmp/domainforge/bin/domainforge --version` | `domainforge 0.21.2` |
| `.tmp/domainforge/bin/domainforge validate --format human .sea/interaction/interaction-model.sea` | `Validation succeeded: 0 violations total` |
| `.tmp/domainforge/bin/domainforge fmt --check .sea/interaction/interaction-model.sea` | `already formatted` |
| `.tmp/domainforge/bin/domainforge parse .sea/interaction/interaction-model.sea --format human` | Entities 55, Entity instances 91, Policies 1 |

The earlier "global" rows above used a `domainforge` already on PATH that also reports 0.21.2.
