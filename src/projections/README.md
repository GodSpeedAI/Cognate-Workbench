# projections (Public Read-Model Projections)

## Overview

The app's public read models: one `Projection` per file (from
`@godspeedai/cognate-projections`), each a pure fold from durable events to
tenant-prefixed projection rows (`key: "<tenant>/...", value: Json | null`).
A `null` value deletes a projection key. Projections never carry secrets — the
event payloads they fold are already sanitized (model provider secrets live in
the `SecretStore`; execution-world records carry only auth *kind*, key *path*,
and pinned host-key fingerprints). The truth is always the durable event log;
these rows are derived and rebuildable.

## Interface

- [sessions.ts:sessionsProjection] — name `"sessions"` (v1.1.0): one row per session, keyed `<tenant>/<sessionId>`; folds `session.created`, `session.turn.started`, `message.completed`, `run.waiting`, `tool.approval.requested`, `session.archived`, `run.cancelled`, `run.failed`.
- [sessionTrace.ts:sessionTraceProjection] — name `"session-trace"` (v1.0.0): developer-tools execution trace, one row per session keyed `<tenant>/trace/<sessionId>`; types [sessionTrace.ts:TraceRow], [sessionTrace.ts:TraceTurn], [sessionTrace.ts:TraceRequest], [sessionTrace.ts:TraceTool].
- [plans.ts:plansProjection] — name `"plans"` (v1.0.0): one row per session keyed `<tenant>/<sessionId>`; types [plans.ts:PlanState], [plans.ts:PlanReview], [plans.ts:TodoItem]; folds `plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`, `plan.review.decided`.
- [workspaces.ts:workspacesProjection] — name `"workspaces"` (v1.2.0): one record row per workspace plus a `current` pointer; folds `workspace.added`, `workspace.selected`, `workspace.renamed`, `workspace.deleted`.
- [modelConfig.ts:modelConfigProjection] — name `"model-config"` (v1.1.0): the `<tenant>/current` configured-provider row; folds `model.configured` and `provider.deleted`.
- [providerRoutes.ts:providerRoutesProjection] — name `"provider-routes"` (v1.0.0): safe per-provider route catalog keyed `<tenant>/provider:<providerId>` (secrets remain in the SecretStore); folds `model.configured` and `provider.deleted`.
- [settings.ts:settingsProjection] — name `"settings"` (v1.2.0): the `<tenant>/current` settings row, merge-folded from partial `settings.changed` patches.
- [plugins.ts:pluginsProjection] — name `"plugins"` (v1.0.0): one row per installed plugin keyed `<tenant>/record/<pluginId>`; folds `plugin.installed` and `plugin.uninstalled`.
- [onboarding.ts:onboardingProjection] — name `"onboarding"` (v1.0.0): one row per dismissed step keyed `<tenant>/notice` / `<tenant>/apikey`; folds `onboarding.dismissed`.
- [cognitive.ts:cognitiveProjection] — name `"cognitive"` (v1.0.0): a `latest` change-signal row plus an `activeCase` row on `case.opened`; folds exactly the event types in [cognitive.ts:COGNITIVE_EVENT_TYPES] (imported from `src/agents/agentCognitive.ts`). The Case itself is never stored here — it is derived server-side via `case.derive`.
- [executionWorlds.ts:executionWorldsProjection] — name `"execution-worlds"` (v1.0.0): one record per connected remote world keyed `<tenant>/record/<worldId>`; type [executionWorlds.ts:WorldRecord]; folds `execution.world.connected` and `execution.world.disconnected`.
- [experts.ts:expertsProjection] — name `"experts"` (v3.0.0): public Experts state restored from either a manifest with content-addressed partition chunks (`<tenant>/partition/<hash>`) or a schema-1 root snapshot (`<tenant>/current`); also handles `erasure.recorded` invalidation. Uses `publicExperts`/`publicPartition` from `src/experts/state.ts` and `validateExpertManifestReferences` from `src/experts/persistence.ts`.
- [expertsBilling.ts:expertsBillingProjection] — name `"experts-billing"` (v1.0.0): one sanitized `<tenant>/current` billing-inspection row folded from the billing ledger thread's `state.changed` events (via `billingOverview` from `src/experts/billing.ts`).
- [sessionTaskBindings.ts:sessionTaskBindingsProjection] — name `"session-task-bindings"` (v1.0.0): one row per explicitly task-bound session keyed `<tenant>/<sessionId>`; type [sessionTaskBindings.ts:SessionTaskBindingRow]; folds `session.task.bound`.
- [taskCheckoutBindings.ts:taskCheckoutBindingsProjection] — name `"task-checkout-bindings"` (v1.0.0): one row per Task-bound Git checkout keyed `<tenant>/task/<taskId>`; type [taskCheckoutBindings.ts:TaskCheckoutBindingRow]; folds `workbench.checkout.bound` and `workbench.checkout.removed`.
- [subagents.ts:subagentsProjection] — name `"subagents"` (v1.0.0): one row per `subagent` tool call keyed `<tenant>/<parentRunId>/<toolCallId>`; type [subagents.ts:SubagentRow]; folds `subagent.spawned` plus the child's own `message.completed`/`run.failed`.
- [workbench.ts:workbenchProjection] — name `"workbench"` (v1.0.0): the cockpit's derived view (tasks, contracts, workflows, capability catalog, evidence ledger, automations, usage, steering inboxes, grounded feedback, protection blocks); delegates to the pure reducer `reduceWorkbench` from `src/workbench/reducer.ts`.

## Invariants

- Every key is tenant-prefixed (`<tenant>/...`) and every fold is a pure function of the event and prior rows; a `null` row value deletes a key ([sessions.ts:sessionsProjection] through [workbench.ts:workbenchProjection]).
- Projections never carry secrets: `model-config` folds payloads that never contained one, and `provider.deleted` fires only after the secret was already removed ([modelConfig.ts:modelConfigProjection] header); `execution-worlds` records carry no password, passphrase, or key material ([executionWorlds.ts:executionWorldsProjection] header); `experts-billing` never carries a route, credential, or private payload, and unknown prices surface as `null` cost plus an unknown-price count, never zero ([expertsBilling.ts:expertsBillingProjection] header).
- [sessions.ts:sessionsProjection] sets the title from the literal first human message only on the first turn and never overwrites an existing title; it excludes anything not correlated `session:<id>` (subagent child runs are excluded); `session.archived` only rewrites the `archived` flag (turns, runs, events are never deleted); the fold rebuilds rows, so the `archived` flag, `accessMode`, and `mode` badge are carried forward explicitly; archiving an unseen session invents nothing.
- [sessions.ts:sessionsProjection] `tool.approval.requested` sets a sticky `mode: "ptc"` badge — it does not flip back once set.
- [plans.ts:plansProjection] keeps the last plan review after mode turns off; only a fresh `plan.review.requested` replaces it, and `plan.review.decided` applies only to a pending review with the matching `toolCallId`.
- [sessionTrace.ts:sessionTraceProjection] folds only `session:`-correlated events (subagent runs excluded); new turns append, everything else folds into the LAST turn (the tool loop is single-flight).
- [sessionTaskBindings.ts:sessionTaskBindingsProjection] bindings are never inferred; a `taskId: null` row is an explicit detach; absence is "never bound"; the fold is idempotent so a replayed attach cannot resurrect a detached binding.
- [taskCheckoutBindings.ts:taskCheckoutBindingsProjection] rows are idempotent on replay; removal deletes the row while history stays; a worktree is never a second workspace, task ledger, or execution-world fork (file header).
- [subagents.ts:subagentsProjection] rows are created only from `subagent.spawned`; the child's completion comes only from the child's own `subagent:`-correlated events (fire-and-forget; the parent cannot record it); `run.failed` only moves a `running` row to `failed`.
- [experts.ts:expertsProjection] verifies partition snapshots against their thread-id hash and throws on content-verification failure; erased envelopes produce no rows (their `erasure.recorded` event invalidates derived rows); a manifest whose partition chunks are missing or mismatched clears `current` rather than restoring a partial state.
- [settings.ts:settingsProjection] merge-folds partial patches: unmentioned fields keep their value; `plugins` and `shortcuts` maps merge per key so a patch cannot clobber other entries.
- [plugins.ts:pluginsProjection] refuses to delete a row that was never installed (fold stays total against a replay of an unmatched pair); [workspaces.ts:workspacesProjection] rename of an unknown record and archive/delete of unknown rows are no-ops.

## Side Effects

- None at runtime. Every file is a pure fold; no I/O, network, filesystem, or process side effects. Persistence of the folded rows is handled by the `@godspeedai/cognate-projections` runtime (PostgreSQL-backed via `src/store.ts`), outside this directory.
- Import-time dependencies reach into sibling modules for pure helpers/types: [cognitive.ts:COGNITIVE_EVENT_TYPES] (from `src/agents/agentCognitive.ts`), `publicExperts`/`publicPartition`/`fingerprint` (from `src/experts/*`), `billingOverview`/`EXPERTS_BILLING_THREAD` (from `src/experts/billing.ts`), `reduceWorkbench` (from `src/workbench/reducer.ts`), and the `ModelConfig` type (from `src/components/providerRegistry.ts`).

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-B-basic-session.test.ts` and `test/J-SESSION-archive.test.ts` (`sessions`), `test/J-T-trajectory.test.ts` (`session-trace`), `test/J-E-plan.test.ts` (`plans`), `test/J-F-delegation.test.ts` (`subagents`), `test/J-TASK-session-scope.red.test.ts` (`session-task-bindings`), `test/J-CHECKOUT-lifecycle.test.ts` (`task-checkout-bindings`), `test/J-CFG-model-catalog.test.ts` (`model-config`/`provider-routes`), `test/J-SET-settings.test.ts` (`settings`), `test/J-PLG-install.test.ts` (`plugins`), `test/J-COG-liveverify.test.ts` (`cognitive`), `test/executionWorlds.test.ts` (`execution-worlds`), `test/J-EXPERT-inbox.test.ts` and `test/J-MEMORY-migration.test.ts` (`experts`), `test/J-CONTEXT-BUDGET-billing.test.ts` (`experts-billing`), `test/J-WB-workflow.test.ts` (`workbench`). All files verified present under `test/`.
