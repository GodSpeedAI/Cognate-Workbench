# Experts & Teams UI Panels

## Overview

Bun/TSX React components for the Workbench's "Experts & Teams" surface: the roster and
conversation cockpit (`ExpertsTeamsPanel`), Expert and Team editors, scoped-memory stewardship,
schedules, and read-only status surfaces for runtime execution capacity and durable spending.
The panels are a thin layer over the Cognate client: data comes from public projections
(`experts`, `model-config`, `provider-routes`, `settings`), and every mutation goes through a
named capability via `client.invoke`. Domain types and constants live in sibling packages
(`src/experts/types.ts`, `src/experts/economics.ts`, `src/schedules/types.ts`); this directory
holds no domain logic. Presentation styling is `experts.css` (excluded from this contract).

## Interface

- `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel` — root panel; props
  `{ workspaceId, onClose, onOpenNavigation, onOpenSettings }`. Also exports
  `./ExpertsTeamsPanel.tsx:LiveInboxForm`, `./ExpertsTeamsPanel.tsx:AssignmentSettlement`,
  `./ExpertsTeamsPanel.tsx:ExpertMemoryPanel`, `./ExpertsTeamsPanel.tsx:AssignmentEffectResolution`
  (used directly by `test/ui-experts.test.tsx`). Internal (not exported):
  `ConversationPane`, `TeamContextSelect`, `AssignmentApproval`, `useExpertRunTraces`,
  `safeTrace`, `AssignmentTrace`, `ArtifactDownload`, `EffectResolutionForm`.
- `./ExpertEditor.tsx:ExpertEditor` — create/edit/copy Expert identity form; props include
  `initial`, `copying`, `defaultRoute`, `routes`, `busy`, `onCancel`, `onSave`, `onOpenSettings`.
  Key type: `./ExpertEditor.tsx:ExpertDraft`.
- `./TeamEditor.tsx:TeamEditor` — draft Team editor (create/rename/copy, capability ceiling,
  coordination limits). Key type: `./TeamEditor.tsx:TeamDraft`.
- `./SchedulesPanel.tsx:SchedulesPanel` — presentational operator surface for durable schedule
  intent and occurrence receipts; key type `./SchedulesPanel.tsx:SchedulesPanelProps` (commands
  arrive as the `onCommand` callback, capability names `"schedule.save" | "schedule.manage"`).
- `./SchedulesSurface.tsx:SchedulesSurface` — polling wrapper that owns schedule data via
  `client.invoke("schedule.list")` and renders `SchedulesPanel`.
- `./AssignmentUsage.tsx:AssignmentUsage` — per-Assignment model usage and budget disclosure.
- `./RuntimeExecutionStatus.tsx:RuntimeExecutionStatus` — read-only host execution-capacity
  display fed by the `inspect` callback prop. Key type:
  `./RuntimeExecutionStatus.tsx:RuntimeExecutionInspection`.
- `./SpendingStatus.tsx:SpendingStatus` — durable billing/spending inspection over the
  `experts-billing` and `settings` projections (`data-testid="spending-status"`).

Parent context: the [src/ui shell contract](../README.md) covers the shared application shell.

## Invariants

- Team activation requires exactly one Orchestrator: the activate button in
  `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel` is disabled unless
  `members.filter((member) => member.role === "orchestrator").length === 1`, and a blocker
  message renders otherwise.
- Human-only governance: `./ExpertsTeamsPanel.tsx:AssignmentSettlement` computes `mayAccept`
  in code — acceptance requires an affirmative review (`review?.verdict === "accept"`) citing
  independent evidence, `handoff.disposition === "result"`, and no `handoff.failures` or
  `handoff.uncertainties`; the "Accept settlement" button is disabled unless `mayAccept`.
  Independent evidence requires a different `expertId`, a result handoff without
  failures/uncertainties, and a successful `read`/`bash`/`run_code` tool-trace entry.
- Effect reconciliation is operator-only and deferred: `./ExpertsTeamsPanel.tsx:AssignmentEffectResolution`
  shows reconciliation forms only for effects in state `DISPATCHED` or
  `UNKNOWN_RECONCILIATION_REQUIRED` and only after the Assignment status is no longer
  `queued`/`running`/`waiting` (active runs show "Side effect in progress" instead).
- Admission metadata is authoritative: `./TeamEditor.tsx:TeamEditor` states the effective
  admission policy comes from Team metadata, never run input, with code defaults
  `{ maxDepth: 2, maxAssignments: 12, maxUnread: 20, maxRounds: 8, maxConcurrentRuns: 2,
  admissionBatch: 1 }`.
- Runtime inspection fails closed: `./RuntimeExecutionStatus.tsx:RuntimeExecutionStatus` accepts
  only payloads where `configuredCapacity === 1 && admissionPolicy === "serial"` or
  `configuredCapacity ∈ {2,4,8} && admissionPolicy === "model-only-parallel"`; anything else
  renders "Runtime capacity unavailable" rather than guessing.
- Schedule targets must be active: `./SchedulesPanel.tsx:SchedulesPanel` filters the target list
  to `lifecycle === "active"` and refuses submit without `workspaceId`, target and objective;
  every `schedule.save`/`schedule.manage` command carries a fresh `requestId` (`crypto.randomUUID()`).
- Schedule surface is read-only dispatch: `./SchedulesSurface.tsx:SchedulesSurface` only lists and
  mutates schedule intent; its doc comment states refreshing the view never drives scheduled
  execution.
- Expert editor bounds: `./ExpertEditor.tsx:ExpertEditor` enforces context budget 2000–64000
  tokens, max steps 1–20, per-attempt budget context 256–2000000 and output 1–64000; both prices
  are required together or the cost entry is omitted. Provider credentials never enter this
  form — routing them to Settings is the `onOpenSettings` callback.
- Stale-response guards: `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel` (conversation history) and
  `./ExpertsTeamsPanel.tsx:ExpertMemoryPanel` (memory records) only render results whose scope
  key still matches the current selection (`historyScopeKey` / `expectedRecordsScope` refs).

## Side Effects

- Capability invocations through `useCognate().invoke` in
  `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel`: `experts.seed`, `expert.save`, `expert.copy`,
  `expert.archive`, `expert.converse`, `expert.context`, `expert.memory.read`,
  `expert.memory.write`, `expert.effect.resolve`, `team.save`, `team.copy`, `team.member`,
  `team.activate`, `team.replaceOrchestrator`, `team.converse`, `team.inbox.send`,
  `team.inbox.cancel`, `team.cancel`, `team.retry`, `team.review`, `team.settle`,
  `execution.runtime.inspect`.
- Schedule capabilities in `./SchedulesSurface.tsx:SchedulesSurface`: `schedule.list`,
  `schedule.save`, `schedule.manage`.
- Event subscriptions: `client.subscribe({ runId })` in
  `./ExpertsTeamsPanel.tsx:useExpertRunTraces` (`tool.call.started` / `tool.call.completed` /
  `tool.call.failed`) and `./AssignmentUsage.tsx:AssignmentUsage` (`run.invocation` for
  `model.generate` / `expert.model.generate` capability metadata).
- Approval continuations: `./ExpertsTeamsPanel.tsx:AssignmentApproval` uses
  `useContinuations(assignment.runId)` and resolves `tool-approval` continuations with
  `{ approved }`.
- Projection reads: `useProjection("experts")`, `useProjection("model-config")`,
  `useProjection("provider-routes")` in `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel`;
  `useProjection("experts-billing")` and `useProjection("settings")` in
  `./SpendingStatus.tsx:SpendingStatus`.
- Polling timer: `./SchedulesSurface.tsx:SchedulesSurface` sets a 2000 ms `setInterval` refresh
  (cleared on unmount).
- Artifact download: `./ExpertsTeamsPanel.tsx:ArtifactDownload` calls `client.artifact`, creates
  a Blob URL, clicks a temporary anchor, and revokes the URL after 1 s.
- DOM navigation: `document.getElementById(...).scrollIntoView` in
  `./ExpertsTeamsPanel.tsx:ExpertsTeamsPanel` and its `ConversationPane`.

## Verification

- `test/ui-experts.test.tsx` — verified by grep to render `ExpertEditor`, `TeamEditor`,
  `AssignmentSettlement`, `ExpertMemoryPanel`, `LiveInboxForm`, `AssignmentEffectResolution`.
- `test/ui-schedules.test.tsx` — verified to exercise `./SchedulesPanel.tsx:SchedulesPanel`.
- `test/ui-runtime-execution.test.tsx` — verified to exercise
  `./RuntimeExecutionStatus.tsx:RuntimeExecutionStatus`.
- `test/E2E-experts.test.ts` — verified to exercise `ExpertsTeamsPanel` (`.experts-panel`).
- `test/E2E-experts-debt.test.ts` — verified to exercise `SpendingStatus`
  (`spending-status` test id) and `AssignmentUsage` ("Model usage and budget").
- Full suite: Run (from repo root): `bun test test`
