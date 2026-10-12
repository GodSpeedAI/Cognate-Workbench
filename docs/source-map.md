# Source map

Concepts, capabilities, workflows and subsystems mapped to their principal implementation
locations. Every entry names the symbols that establish it, not just the directory.

Use this when you know *what* you are looking for and need to find *where*. For the reverse — what a
file does — see [Documentation map](documentation-map.md).

---

## Subsystems

| Subsystem | Principal locations |
|---|---|
| Runtime and server | `src/server.ts` — `startServer`, `GRANTED_CAPABILITIES`, `LOCAL_OPERATOR`, `SYSTEM_CALLER`, `buildPolicy`, `buildActionPolicy`, `BROWSER_ENTRY_TEMPLATE`, `indexHtml`, `Bun.serve`; `src/store.ts` — `schemaFor`, `storeConfigFor` |
| Agents | `src/agents/agentCoding.ts` — `agentCodingAgent`, `TOOL_DEFS`, `UI_TOOL_DEFS`, `PRESET_TOOLS`, `toolsForPreset`; `src/agents/agentConfig.ts` — `AgentConfigInput`; `src/agents/agentCognitive.ts` — `COGNITIVE_EVENT_TYPES` |
| Capabilities | `src/capabilities/` (14 files); `src/capabilities/workbench.ts` — `WORKBENCH_CAPABILITY_IDS` |
| Projections | `src/projections/` (11 files) |
| Workbench domain | `src/workbench/` (15 pure modules); `src/workbench/types.ts` — the type root; `src/workbench/reducer.ts` — the fold |
| Cognitive domain | `src/cognitive/` (13 pure modules); `src/cognitive/world.ts`, `case.ts`, `criterion.ts`, `affordance.ts`, `mediation.ts`, `sentinel.ts`, `surface.ts` |
| Execution worlds, providers, secrets | `src/capabilities/executionWorlds.ts` — `restoreExecutionWorlds`; `src/components/providerRegistry.ts` — `ModelWireProtocol`, `buildProvider`, `ProviderRegistry.swap`; `src/components/modelProvider.ts` — `streamingProviderComponent`; `src/secrets.ts` |
| Observations and RealityTrace | `src/observations.ts` — `OBSERVED_EVENT_TYPES`, `observationOutboxFor`, `defaultSxrBin`, `wireObservations` |
| User interface | `src/ui/App.tsx`; `src/ui/workbench/` (14 components, `UX.md`, 8 CSS sheets); `src/ui/CognitiveFrame.tsx`; `src/ui/webmcp.ts` |
| Pure gates | `src/domain/approvalGate.ts`, `src/domain/planGate.ts` |

## Concepts

| Concept | Where it is defined | Where it is decided |
|---|---|---|
| Capability | `@godspeedai/cognate-capabilities`; `domain/index.ts` (bindings) | `src/capabilities/*` |
| Semantic model | `.sea/interaction/interaction-model.sea` | `domain/index.ts` — `loadDomain` |
| Tool | `src/agents/agentCoding.ts` — `TOOL_DEFS`, `UI_TOOL_DEFS` | `src/capabilities/tools.ts` |
| Agent preset | `src/agents/agentCoding.ts` — `AgentPreset`, `PRESET_TOOLS` | the same file's preset check |
| Event | `@godspeedai/cognate-events` | `src/agents/agentConfig.ts` — `AgentConfigInput` |
| Projection | `@godspeedai/cognate-projections` | `src/projections/*` |
| Continuation | `@godspeedai/cognate-runtime-api` | `src/agents/agentCoding.ts` — `ctx.waitFor` |
| Execution world | `@godspeedai/cognate-execution` (+ `-ssh`, `-wsl`) | `src/server.ts` — `createExecutionWorldRegistry`; `src/capabilities/executionWorlds.ts` |
| Task contract | `src/workbench/types.ts` — `TaskContract` | `src/workbench/contract.ts` — `contractMissing` |
| Authority scopes | `src/workbench/types.ts` — `AuthorityScopes`, `Grant` | `src/workbench/authority.ts` — `decideWrite`, `decideShell` |
| Protected evidence | `src/workbench/types.ts`; patterns in the `workbench` projection | `src/workbench/glob.ts` + `authority.ts` |
| Evidence | `src/workbench/types.ts` — `EvidenceEntry`, `EvidenceKind` | `src/workbench/ledger.ts` |
| Done level | `src/workbench/types.ts` — `DoneLevel` | `src/workbench/ledger.ts` — `doneLevel` |
| Review gate | `src/workbench/types.ts`; `Entity "ReviewGate"` | `src/capabilities/workbench.ts` — the human-only check |
| Skill lifecycle | `src/workbench/types.ts` — `CAPABILITY_LIFECYCLE` | `src/workbench/skillOs.ts` — `advanceLifecycle` |
| Workflow edges | `src/workbench/types.ts`; `src/workbench/workflow.ts` | `src/workbench/workflow.ts` — `readyNodes`, `nextTransitions` |
| Automation lifecycle | `src/workbench/types.ts` — `AUTOMATION_STATES` | `src/workbench/automation.ts` — `advance` |
| Steering | `src/workbench/types.ts` — `InboxMessage` | `src/workbench/steering.ts` — `enqueue` |
| Case | `src/cognitive/case.ts` — `deriveCase`, `CaseProjection` | `src/capabilities/cognitive.ts` |
| World manifest / hash | `src/cognitive/world.ts` — `WorldManifest`, `worldHash` | the same file |
| Lineage | `src/cognitive/world.ts` — `foldLineage`, `Lineage` | `foldLineage`, `checkPromotion` |
| Criterion | `src/cognitive/criterion.ts` — `FrozenCriterion` | `freezeCriterion` |
| Affordance | `src/cognitive/affordance.ts` | the resolver in the same file |
| Mediation | `src/cognitive/mediation.ts` — `MediatorSpec` | `createMediationHost` |
| Sentinel | `src/cognitive/sentinel.ts` | `sentinel`, `SentinelConfig` |
| Semantic Surface | `src/cognitive/surface.ts` — `Surface`, `Block` | `validateSurface` |
| Focus | `src/cognitive/focus.ts` — `FocusContext`, `SemanticRef` | `src/ui/webmcp.ts` — `toolsForFocus` |
| Shell classification | `src/workbench/shellSafety.ts` | `isDestructiveCommand`, `mutationTargets`, `usesNetwork` |
| Settings | `src/settings.ts` — `SettingsPatch`, `resolveGeneralSettings` | `src/capabilities/settingsChange.ts` |
| Grounded feedback | `src/workbench/grounded.ts` | `validateGroundedFeedback` |

## Capabilities

Full table with bindings in [Capability catalog](reference/capability-catalog.md). Sources by family:

| Family | File |
|---|---|
| Tools | `src/capabilities/tools.ts` |
| Workbench (23 ids) | `src/capabilities/workbench.ts` |
| Cognitive | `src/capabilities/cognitive.ts` |
| Model configuration | `src/capabilities/modelConfigure.ts` |
| Secrets | `src/capabilities/secretPut.ts` |
| Session history | `src/capabilities/sessionHistory.ts` |
| Workspaces | `src/capabilities/workspaceSelect.ts`, `workspacePath.ts`, `workspaceManage.ts` |
| Execution worlds | `src/capabilities/executionWorlds.ts` |
| Plans, subagents, onboarding | `src/capabilities/planState.ts`, `subagentStart.ts`, `onboardingDismiss.ts` |
| Settings (10 ids) | `src/capabilities/settingsChange.ts` |
| Observations | `src/observations.ts` |
| Model generation | `src/components/modelProvider.ts` |

## Events

Full table in [Event catalog](reference/event-catalog.md). Event constant sets:

| Namespace | Constant |
|---|---|
| `workbench.*` | `WORKBENCH_EVENTS` — `src/workbench/types.ts` |
| `case.*`, `criterion.*`, `verification.*` | `CASE_EVENTS` — `src/cognitive/case.ts` |
| `world.*` | `WORLD_EVENTS` — `src/cognitive/world.ts` |
| cognitive union | `COGNITIVE_EVENT_TYPES` — `src/agents/agentCognitive.ts` |
| observed for RealityTrace | `OBSERVED_EVENT_TYPES` — `src/observations.ts` |
| everything else | literals in `src/agents/agentCoding.ts` and `src/agents/agentConfig.ts` |

## Projections

| Name | File |
|---|---|
| `sessions` | `src/projections/sessions.ts` |
| `session-trace` | `src/projections/sessionTrace.ts` |
| `plans` | `src/projections/plans.ts` |
| `subagents` | `src/projections/subagents.ts` |
| `workbench` | `src/projections/workbench.ts` + `src/workbench/reducer.ts` |
| `workspaces` | `src/projections/workspaces.ts` |
| `execution-worlds` | `src/projections/executionWorlds.ts` |
| `model-config` | `src/projections/modelConfig.ts` |
| `settings` | `src/projections/settings.ts` |
| `onboarding` | `src/projections/onboarding.ts` |
| `cognitive` | `src/projections/cognitive.ts` |

## Configuration

| Thing | Location |
|---|---|
| Commands | `justfile` |
| Scripts and dependencies | `package.json` |
| Environment variables | `src/server.ts` (port, home), `src/store.ts` (database), `src/observations.ts` (`SXR_BIN`), `src/agents/agentCoding.ts` (`MODEL_RETRY_BACKOFF_MS`) |
| App metadata | `cognate.config.ts` — **not read at runtime** |
| Semantic model | `.sea/interaction/interaction-model.sea` |
| Local PostgreSQL installer | `scripts/setup-pg0.ts` — `PG0_VERSION`, `DIGESTS` |
| CI | `.github/workflows/verify.yml` |

## Design inputs

| Document | What it authoritatively owns |
|---|---|
| `PRODUCT.md` | Users, purpose, brand voice, anti-references, design principles, accessibility target |
| `DESIGN.md` | The locked visual system: theme, type, spacing, surface registers, component voice, motion, density, responsive contract |
| `src/ui/workbench/UX.md` | The per-component contract for cockpit components |
| `.sea/interaction/` | The semantic model and its companions |
| `.agents/plans/unified_harness_experience_model_v2.md` | The workbench design source |
| `.agents/specs/cybernetic-navigation-proof.md` | The cognitive layer design source |
| `AGENTS.md` | Agent working rules: semantic-id stability, registry-only SDK consumption, verification order |
| `MIGRATION.md` | The extraction snapshot |

## Tests that establish the load-bearing contracts

| Contract | Test |
|---|---|
| A pending approval survives a full restart | `test/J-D-approval.test.ts` |
| State survives a restart | `test/J-G-persistence.test.ts` |
| The tool loop, including the read-before-edit refusal | `test/J-C-tool-execution.test.ts` |
| Authority cannot be stepped around | `test/workbench-authority-bypass.test.ts` |
| Protected evidence is enforced structurally | `test/J-WB-protected-evidence.test.ts` |
| Review is a human decision | `test/J-WB-review-gate.test.ts` |
| Contract completeness | `test/workbench-contract.test.ts` |
| Provider hot-swap and rollback | `test/providerRegistry.test.ts` |
| Fire-and-forget delegation | `test/J-F-delegation.test.ts` |
| Plan mode | `test/J-E-plan.test.ts` |
| The cognitive distinctions | `test/cognitive-semantics.test.ts` |
| Registry-only SDK consumption | `test/skill-bundle.test.ts` |
| Remote worlds | `test/J-RW-ssh-workspaces.test.ts`, `test/E2E-remote-workspaces.test.ts` |

## Deliberately *not* here

`.tmp/` and `docs/`-external scratch directories are working material, not implementation. `.tmp/`
is gitignored and nothing in `docs/` depends on it. `.serena/` and `.jolli/` are tool state.

## Source trail

- The whole repository — this page is the map of it
- `src/server.ts` — the composition root every path resolves through
- `domain/index.ts` — the binding surface
- `package.json` — every import this application uses
- `.github/workflows/verify.yml` — what CI proves