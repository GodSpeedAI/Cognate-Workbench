# Concept: the capability model

How a name in the semantic model becomes a thing that runs. This is the chain every feature in this
repository passes through, and understanding it is the difference between adding a capability in an
hour and fighting the codebase for a day.

## The chain

```
.sea/interaction/interaction-model.sea     "what exists, and what it is called"
        │  domain.semanticId("TaskContract")
        ▼
domain/index.ts                             the ONLY path from a name to a contract
        │  bindCapabilities(domain.projection, bindings) → CapabilityContract
        ▼
src/capabilities/<family>.ts                a component providing that contract
        │  runtime.kernel.mount(component)
        ▼
runtime                                     resolves the binding, leases it, invokes the handler
        │
        ▼
src/agents/*.ts                              invokes it, emits the event that records the result
        │
        ▼
src/projections/*.ts                         folds the event into the read model the UI reads
```

`bindCapabilities` from `@godspeedai/cognate-capabilities` is the only sanctioned path. Every
`bind*` function asserts its expected count and throws otherwise, so a silently dropped binding is
a boot failure rather than a runtime surprise.

## Why a name has to exist first

The semantic model exists so that a capability's *meaning* is separated from its *mechanism*. When a
provider changes, when the implementation is swapped, when the executor moves from an LLM to a
deterministic command, the `TaskContract` stays `TaskContract`. The binding is what makes that
separation enforceable rather than aspirational.

`AGENTS.md` reinforces this: preserve semantic ids unless performing an explicit data migration.

## Tranches

Bindings were added in tranches, and the tranche grouping survives in `domain/index.ts`:

| Group | Covers |
|---|---|
| `tranche5` / `bindTranche5` | `model.generate`, `model.configure`, `secret.put`, `workspace.select`, `session.history` |
| `tranche7` / `bindTranche7` | `tool.read`, `tool.edit`, `tool.bash`, `tool.run_code`, `workspace.path` |
| `tranche9` / `bindTranche9` | `plan.state` |
| `tranche10` / `bindTranche10` | `subagent.start` |
| execution worlds | the `filesystem.*` / `process.exec` family plus `execution.world.*` |
| `usage2` / `bindUsage2` | the 10 `settings.change*`, anchored on `UserPreferences` |
| `usage3` / `bindUsage3` | `workspace.rename`, `workspace.delete`, anchored on `WorkspaceRecord` |
| `bindWorkbench` | the 23 workbench capabilities |

## Three shapes of "not a capability contract"

Not everything worth naming is a bound capability. Three cases are handled differently, and
conflating them is a common mistake.

**A pure decision function plus a continuation.** `ApprovalGate` and `PlanMode` are entities in the
`.sea` model, but the *behaviour* is not a `CapabilityContract` a UI action invokes. `approvalGate`
and `planGate` are pure functions; the agent opens a `ctx.waitFor` continuation when the answer is
"ask". Model as: decision function + durable wait.

**A tool, not a capability.** `subagent.start` is bound. The `subagent` *tool* is not — the decision
to delegate is the agent's, and the only governed act is starting the child run.

**A read over a non-domain store.** `observation.status` and `observation.record` read the
DurableStore `observations` collection, which is not the event log. `onboarding.dismiss` is a
durable UI-flow flag. No entity describes either, and inventing one would misstate the domain. Both
are left unbound on purpose.

## One known gap

The cognitive-navigation capabilities (`case.open`, `world.settle`, `verification.run`,
`risk.assess`, the `experiment.*`, `method.*` and `ui.*` family) are real, executable capabilities
that are **not** bound to the `.sea` model. The reason recorded in the legacy bindings document is
that the `.sea` file carries another tranche's uncommitted edits. That is a gap, not a decision.
It is listed in [Known gaps](../known-gaps.md).

## Consequences you will feel

- **Renaming an entity is a migration.** It touches `domain/index.ts`, and anything keyed off the
  name.
- **Adding a capability without adding a name** is possible, but it leaves the model incomplete.
  Prefer adding the entity.
- **A capability's identity is `id.version`.** Bumping the version is how a behavioural change is
  expressed; compatibility is checked by `compatibilityRule` / `isCompatible` from
  `@godspeedai/cognate-capabilities`.

## Source trail

- `.sea/interaction/interaction-model.sea` — the semantic model
- `.sea/interaction/README.md` — the representation compromise (no Journey primitive; journeys are
  `Instance … of "CanonicalJourney"`)
- `.sea/interaction/canonical-journey-catalog.md` — the journeys and their ids
- `domain/index.ts` — every binding and count assertion
- `src/capabilities/workbench.ts` — `WORKBENCH_CAPABILITY_IDS`
- `src/capabilities/planState.ts`, `src/capabilities/subagentStart.ts`, `src/observations.ts` —
  the three "not a plain capability" shapes
- `src/domain/approvalGate.ts`, `src/domain/planGate.ts` — the pure decisions
- `AGENTS.md` — the semantic-id stability rule