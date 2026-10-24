# Reference: projection catalog

The sixteen read models. Each is a pure fold of events; each can be deleted and rebuilt.

## The contract

- Keys are tenant-prefixed (`${tenant}/…`). `ReadProjection` strips the prefix before a value reaches
  the browser.
- Absence of a row is meaningful: it is what drives UI defaults and the first-run dialogs.
- A projection performs no I/O, calls no capability, starts no run, and decides nothing.
- Bump `version` when you change how values are derived.

## The sixteen

### `sessions`

**Folds:** `session.turn.started`, tool and message events.
**Key:** per session.
**Carries** the conversation, the tool timeline, and — folded from *run inputs* on
`session.turn.started` — the session's current access `mode` and agent `preset`.
**Read by:** the transcript, the sidebar, the composer.

Note the consequence: the mode and preset are derived from what the turn carried, not from a separate
settings write. A turn sent without them leaves the previously folded values intact.

### `session-trace`

**Folds:** the authoritative event log.
**Key:** per event, with position.
**Read by:** the execution-trace inspector.
This is *the* trace. RealityTrace observation receipts are a separate enrichment and are not part of
it.

### `plans`

**Folds:** `plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`,
`plan.review.decided`.
**Key:** `${tenant}/${sessionId}`.
**Shape:** `PlanState { sessionId, on, todos, review? }`, where `PlanReview` is
`{ status, toolCallId, heading, markdown }`.
**Read by:** `plan.state` (the agent, at the top of each turn) and the UI (to-dos, review card,
sidebar prefix).

### `subagents`

**Folds:** `subagent.spawned` **plus the child's own** `message.completed` / `run.failed`.
**Key:** `${tenant}/${parentRunId}/${toolCallId}`.
**Shape:** `{ status: "running" | "completed" | "failed", startedAt, … }`.
**Read by:** the UI's subagent panel, and `session.history` — which is how a completed child's result
durably returns to the parent as context on its **next** turn.

This projection observes another run's events rather than waiting for the parent to record anything.
That is the direct consequence of fire-and-forget delegation.

### `workbench`

**Folds:** every `workbench.*` event, through `src/workbench/reducer.ts`.
**Key:** tenant-prefixed; one cockpit view covering tasks, contracts, workflows and their instances,
the capability catalog and bindings, the evidence ledger, automations, usage, steering inboxes,
grounded feedback, and protection blocks.
**Read by:** every cockpit component, and by the 25 workbench capabilities for validation.

This is the projection most likely to be read immediately after a write, so it is the one where
read-after-write lag is most visible. See
[Why `agent.config` is the write path](../explanation/why-agent-config-is-the-write-path.md).

### `workspaces`

**Folds:** `workspace.added`, `workspace.selected`, `workspace.renamed`, `workspace.deleted`.
**Key:** per workspace, plus a current pointer.
**Read by:** the sidebar, the composer gating, `workspace.path`, `workspace.select`,
`workspace.manage`.

### `execution-worlds`

**Folds:** `execution.world.connected`, `execution.world.disconnected`.
**Key:** `${tenant}/record/${worldId}`.
**Shape:** `WorldRecord { worldId, kind, label, metadata, connection }` — exactly what is needed to
rebuild the provider after a restart, and nothing secret.
**Read by:** the remote-workspace form, `execution.world.*`, and the boot-time registry restore.

### `model-config`

**Folds:** `model.configured`.
**Key:** `${tenant}/current`.
**Shape:** `{ providerId, baseURL, protocol, model, configuredAt }`.
**Read by:** the Settings UI, `model.configure`, and — critically — `src/server.ts` at boot, to
remount the provider so a resumed run can call `model.generate`.

**Never carries the secret.** The projection's own comment says the event it folds never contained
one.

### `settings`

**Folds:** `settings.changed`.
**Key:** `${tenant}/current`.
**Shape:** one merged row of the durable General settings.

Two fold behaviours to know:

- Fields are **partial patches**, merged into the previous row. Last write wins per field.
- The `plugins` map merges **per key**, so toggling one plugin does not clobber the others.

Every other field is whole-value. Getting this wrong is the classic way to lose a setting.

### `onboarding`

**Folds:** `onboarding.dismissed`.
**Key:** `${tenant}/notice`, `${tenant}/apikey`.
**Read by:** the first-run dialogs. Absence is what makes them reappear on a fresh home directory.

### `cognitive`

**Folds:** any event in `COGNITIVE_EVENT_TYPES`.
**Key:** `${tenant}/latest`, plus `${tenant}/activeCase`.
**Shape:** a change signal — `{ position, eventType }`.

This projection stores **no Case**. The UI subscribes to it purely to learn that something changed,
then asks `case.derive` for the Case, which is recomputed server-side from events on every read.

### `experts`

**Folds:** the Experts and Teams `state.changed` events on the versioned `experts:registry` thread,
plus `erasure.recorded`.
**Key:** tenant-prefixed, restored per section (`experts`, `teams`, `conversations`, `assignments`,
`messages`, `memory`, `receipts`).
**Shape:** `publicExperts(...)` — the roster and work view.
**Read by:** the Experts & Teams surfaces.

Scoped memory and private context deliberately stay outside this projection.

### `experts-billing`

**Folds:** `state.changed` events whose `metadata.threadId` is `EXPERTS_BILLING_THREAD`.
**Key:** `${tenant}/current`.
**Shape:** one sanitized `billingOverview(snapshot)` row: reservation ids, kinds, statuses, models,
token amounts, booked costs, unknown-price counts.

It never carries a route, a credential or a private payload. An unknown price surfaces as a null cost
plus an unknown-price count, never as zero.

### `provider-routes`

**Folds:** `model.configured` and `provider.deleted`.
**Key:** `${tenant}/provider:${providerId}`.
**Shape:** `{ providerId, baseURL, protocol, model }` — the safe route catalog, no secret.

`model.configured` writes one row per provider; `provider.deleted` deletes that provider's row. It
keeps the legacy single-current-route view alongside the multi-provider list.

### `session-task-bindings`

**Folds:** `session.task.bound` only.
**Key:** `${tenant}/${sessionId}`.
**Shape:** `{ sessionId, workspaceId, taskId }`, where `taskId: null` is an explicit detach.

Bindings are never inferred. Creating a workspace task binds no session, and a workspace task stays
merely *available* in every session of its workspace. Invalidating a binding writes `taskId: null`,
so history and run provenance are never rewritten. Absence of a row means the session was never
bound, which is also a valid "no task".

### `plugins`

**Folds:** `plugin.installed` and `plugin.uninstalled`.
**Key:** `${tenant}/record/${pluginId}`.
**Shape:** `{ pluginId, installedAt, implementation? }`.

Installation is durable and reversible: uninstall writes a `null` value, which deletes the key. The
fold refuses to delete a row that was never installed, keeping it total against a replayed unmatched
pair. The catalog is code; the install state is data; `src/plugins.ts` merges them.

## Choosing a fold style

| Situation | Style | Example |
|---|---|---|
| The event carries the whole row | last-write-wins | `model-config`, `onboarding` |
| The event carries part of the row | merge into the prior row | `settings` |
| A nested map is partial | merge **per key** | `settings.plugins` |
| The row only signals change | a single `latest` row | `cognitive` |
| The value comes from another run's events | observe those directly | `subagents` |

## Reading a projection from code

In the UI:

```ts
const rows = useProjection("workbench", { tenant });
```

In a capability or the boot sequence:

```ts
const row = await runtime.service.readProjection(caller, { name: "model-config" });
```

## Source trail

- `src/projections/` — all sixteen definitions, each documenting its own fold
- `src/workbench/reducer.ts` — the `workbench.*` fold
- `src/settings.ts` — `SettingsPatch`, `resolveGeneralSettings`
- `src/agents/agentCognitive.ts` — `COGNITIVE_EVENT_TYPES`
- `src/server.ts` — registration, and the boot read of `model-config`
- `src/ui/App.tsx`, `src/ui/workbench/` — the readers
- [`../how-to/add-an-event-and-projection.md`](../how-to/add-an-event-and-projection.md) — adding one