# schedules (Native Schedule Registry, Evaluator, and Component)

## Overview

Durable Expert/Team scheduling (journey J-SCHEDULE-execution). [types.ts] is the
durable state model: `NativeSchedule`s with `once`/`daily`/`weekly` recurrences
targeting an Expert or Team, their `ScheduleOccurrence`s, and idempotency
receipts, stored as a schema-1 snapshot in the shared-state thread
[types.ts:SCHEDULES_THREAD] (`"schedules:registry"`). [service.ts:SchedulesService]
is the serialized mutation gate over that thread (read → pure action →
version-checked write with fingerprinted receipts). [evaluator.ts:ScheduleEvaluator]
is the durable-intent evaluator loop: it reconciles cancelled schedules,
syncs occurrence status from the native Assignments, applies misfire policy,
reserves deterministic occurrences, and dispatches them through the Experts
service — Cognate's native bridge remains the run executor. [service.ts:schedulesComponent]
exposes `schedule.save`, `schedule.manage`, `schedule.list`, and `schedule.dispatch`
as kernel capability contracts.

## Interface

- [types.ts:SCHEDULES_THREAD] — ledger thread id `"schedules:registry"`.
- [types.ts:ScheduleTarget] — `{ kind: "expert" | "team", id }`.
- [types.ts:ScheduleRecurrence] — `once` (offset-bearing instant), `daily`/`weekly` (`HH:mm` local time + IANA timezone; weekly adds `weekdays` 0–6).
- [types.ts:ScheduleLifecycle] — `"active" | "paused" | "cancelled" | "deleted"`; [types.ts:OccurrenceStatus] — `"reserved" | "queued" | "issued" | "waiting" | "completed" | "failed" | "cancelled" | "skipped"`; [types.ts:OccurrenceFailureKind] — `"dispatch" | "assignment" | null`.
- [types.ts:NativeSchedule] — durable schedule record (`accessMode` is always `"read-only"`, `maxInFlight` is always `1`).
- [types.ts:ScheduleOccurrence] — durable occurrence record with its frozen `intent` and dispatch bookkeeping.
- [types.ts:ScheduleState] / [types.ts:emptyScheduleState] — schema-1 snapshot (`schedules`, `occurrences`, `receipts`).
- [evaluator.ts:nextOccurrenceAfter] — next calendar occurrence strictly after an instant (DST-safe wall-time resolution).
- [evaluator.ts:previousOccurrenceOnOrBefore] — latest configured occurrence at or before an instant.
- [evaluator.ts:SCHEDULE_MISFIRE_GRACE_MS] — 60 000 ms misfire grace window; [evaluator.ts:ScheduleEvaluatorOptions] — `{ intervalMs?, maxInFlight?, now? }`.
- [evaluator.ts:ScheduleEvaluator] — evaluator class: `get status()`, [evaluator.ts:ScheduleEvaluator.reconcile], [evaluator.ts:ScheduleEvaluator.evaluate], `start`, `stop`; private `dispatch`, `syncReceipts`, `cancelAssignment`.
- [service.ts:SchedulesService] — service class: [service.ts:SchedulesService.runSerialized], `read`, [service.ts:SchedulesService.validateDispatch], [service.ts:SchedulesService.occurrenceId], [service.ts:SchedulesService.reserve], [service.ts:SchedulesService.recordDispatch], [service.ts:SchedulesService.recordFailure], [service.ts:SchedulesService.retryOccurrence], [service.ts:SchedulesService.updateOccurrence], [service.ts:SchedulesService.command]; private `mutate`, `validateTarget`, `reconcileCancelled`.
- [service.ts:schedulesComponent] — kernel `Component` (id `"schedules:native"`) providing `schedule.save`, `schedule.manage`, `schedule.list`, `schedule.dispatch` (version `1.0.0`, with semantic refs).
- Private recurrence validation in [service.ts:recurrence] (offset-bearing instant for `once`, `HH:mm` format, valid IANA timezone, weekday bounds 0–6 deduplicated and sorted).

## Invariants

- Schedules are read-only at the execution plane: `NativeSchedule.accessMode` is always `"read-only"` and `maxInFlight` is always `1` ([types.ts:NativeSchedule]); [service.ts:SchedulesService.validateDispatch] rejects any intent whose `accessMode` is not `"read-only"`.
- Only the human operator manages schedules: [service.ts:SchedulesService.command] requires `caller.actor.kind === "user"`; only the internal evaluator dispatches: the `schedule.dispatch` handler requires `ctx.actor.kind === "system"` with the expected system-actor id ([service.ts:schedulesComponent]).
- All state mutations are serialized in-process via [service.ts:SchedulesService.runSerialized] and committed as version-checked compare-and-swap writes with idempotency keys and fingerprinted command receipts; a reused command id for different work throws ("Schedule command identity was reused for different work", [service.ts:SchedulesService.mutate]); optimistic-concurrency retries are bounded at 30 attempts.
- Occurrence ids are deterministic content hashes of `(scheduleId, revision, dueAt)` ([service.ts:SchedulesService.occurrenceId]); reservation against a schedule whose lifecycle is not `active` or whose revision does not match is a no-op ([service.ts:SchedulesService.reserve]).
- Dispatch re-validates authority just before issuing: schedule must be `active`, revision must match, creator must match the intent ([service.ts:SchedulesService.validateDispatch]); a schedule changed before issue cancels the occurrence ([evaluator.ts:ScheduleEvaluator] private `dispatch`).
- A competing cancellation/edit that wins after native acceptance never resurrects the occurrence: [service.ts:SchedulesService.recordDispatch] returns `false` and the evaluator revokes the deterministic Assignment instead ([evaluator.ts:ScheduleEvaluator] private `dispatch`).
- Dispatch failures retry with capped exponential backoff (attempts < 3, `min(60s, 1s * 2^(attempts-1))`, [service.ts:SchedulesService.recordFailure]); only `dispatch`-kind failures are retried, and a failed occurrence with `attempts >= 3` is never re-reserved ([service.ts:SchedulesService.retryOccurrence]).
- `updateOccurrence` never moves a `cancelled` occurrence to another status ([service.ts:SchedulesService.updateOccurrence]).
- Misfire policy: `skip` drops a missed occurrence (status `skipped`) when more than [evaluator.ts:SCHEDULE_MISFIRE_GRACE_MS] late; `coalesce` dispatches the latest configured occurrence at or before now ([evaluator.ts:ScheduleEvaluator.evaluate]).
- Unsupported state schema versions throw and require an explicit migration ([service.ts:SchedulesService.read]).
- `schedule.list` returns only schedules created by the caller, with their occurrences ([service.ts:SchedulesService.command]).
- Only an active Expert (or an active Team passing `assertTeamInvariant`) in an existing workspace is a valid target ([service.ts:SchedulesService] private `validateTarget`).

## Side Effects

- Reads and writes the shared-state thread [types.ts:SCHEDULES_THREAD] via `experts.service.readSharedState` / `updateSharedState` (durable PostgreSQL-backed state through the Cognate runtime).
- Dispatch invokes the native Experts bridge via `experts.service.invoke` with capability `expert.converse` or `team.converse` (deterministic `correlationId: "schedule:<occurrenceId>"`, `idempotencyKey: "schedule-dispatch:<occurrenceId>"`) and `team.cancel` for cancellations (`idempotencyKey: "schedule-cancel:<occurrenceId>"`).
- Reads the Experts projection/state (`experts.state`, `readProjection("workspaces")`) for target validation and occurrence-status syncing.
- [evaluator.ts:ScheduleEvaluator] runs a periodic loop (`setTimeout`-based, default interval 1000 ms, `options.intervalMs`), holds an `AbortController`/`status` for lifecycle control, and records its last error on the instance.
- In-process serialization state: [service.ts:SchedulesService.runSerialized] promise tail; `structuredClone`d state snapshots on read.
- [service.ts:schedulesComponent] returns JSON via the `json()` helper; `schedule.list` embeds the evaluator `status` snapshot.

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-SCHEDULE-execution.test.ts` and `test/ui-schedules.test.tsx` (both verified present under `test/`).
