# Native Expert schedules (A1)

## Scope and plan

A schedule is durable domain intent in the Cognate shared-state thread `schedules:registry`; it is not an operating-system timer, a second database, or an alternate run executor. The evaluator checks that intent and creates ordinary Workbench Expert/Team conversations through the existing `expert.converse` / `team.converse` capability. The Cognate run outbox and completion bridge remain responsible for native execution and terminal evidence.

Implementation tranches:

1. Define versioned schedule/occurrence records, command receipts, timezone recurrence, and the schedule CAS service. Validate save/manage behavior and calendar edge cases.
2. Add a bounded evaluator that reserves an occurrence before invoking the native conversation capability, reuses stable IDs after restart, revalidates human authority and current target/workspace, and records queued/issued/waiting/terminal receipts without awaiting run completion.
3. Add the Schedules panel for creating, inspecting, pausing, resuming, editing, cancelling, and tombstoning schedules; retain occurrence history after deletion.
4. Prove J-SCHEDULE-CREATE/FIRE/RECOVER against the real Workbench RuntimeService/Postgres store and deterministic provider seam, including restart recovery, retries, misfire policy, cancellation, DST, and backpressure.

## State and identity

The registry uses `RuntimeService.readSharedState` / `updateSharedState` with expected versions and logical command receipts, following `src/experts/state.ts`. A mutation re-reads and revalidates after CAS conflict. Creator identity comes from the authenticated `HandlerContext.actor.id`; request payloads cannot supply it. Schedules contain an active/paused/cancelled/deleted lifecycle, integer revision, target, workspace, bounded objective, explicit local recurrence and misfire policy, read-only access mode, next due instant, and timestamps. Delete is a tombstone; it does not erase receipts.

An occurrence ID is a stable digest of `(scheduleId, revision, dueInstant)`. Its Expert Assignment ID and native conversation command request ID are deterministic functions of that ID. An occurrence is reserved durably before native dispatch, then records queued/issued/waiting/completed/failed/cancelled/skipped state and any assignment/run references. Retries repeat the same native command identity, so an uncertain response cannot create a second logical assignment. Configuration edits increment revision and cancel prior-revision reservations that have not been issued. Already-issued assignments retain their frozen objective and continue as native work.

## Recurrence and bounded recovery

One-time schedules use an explicit offset-bearing instant. Daily and weekly schedules use an IANA timezone plus local `HH:mm`; weekly schedules require a non-empty bounded weekday set. A nonexistent local wall time in a DST spring gap is skipped. If a wall time repeats during a fall fold, the earlier instant is the one occurrence for that calendar date. The next due instant is persisted.

For outages, `coalesce` creates at most one run for the latest missed due instant; `skip` creates no run and records the latest missed occurrence as skipped only when it is over 60 seconds late. An on-time `skip` schedule still runs normally. Both policies move directly to the next future instant after a missed occurrence, without replaying an unbounded backlog. The evaluator limits unresolved reserved/queued/issued/waiting occurrences globally across schedules (default one) and admits at most one unresolved occurrence per schedule. This prevents queued native assignments from accumulating behind the SDK's serial run executor.

## Authority, cancellation, and execution boundary

Only a human-created schedule may dispatch. Before dispatch, the evaluator re-reads the schedule, verifies the creator and revision, confirms the Expert is active or the Team is active with one current Orchestrator, confirms the workspace still exists, and forces `read-only` mode. A schedule cannot choose broader tools or permissions. The native conversation creates a normal Assignment; the existing bridge starts a Cognate run. Dispatch records run assignment, not successful completion.

Schedule mutation and native dispatch share one in-process serialization boundary. Thus a cancellation that becomes durable cannot race past an already-validated dispatch in this supported single-process mode: if dispatch is first, cancellation follows by cancelling its deterministic Assignment; if cancellation is first, dispatch sees the tombstone. On boot, the evaluator reconciles cancelled schedules and reservations before the Expert completion bridge starts. A future multi-process deployment requires a distributed schedule owner/lease or an atomic cross-aggregate protocol; this slice does not claim that guarantee across processes.

The evaluator never waits for model completion. It records `queued` when the native command returns, `issued` when an Assignment has a run ID, `waiting` for human approval/waiting, and terminal assignment states separately. Native commitments and human approval/reconciliation remain unchanged.

## Native integration and evidence

`src/server.ts` binds all four contracts through `domain/index.ts`, mounts the component, reconciles before starting the Expert completion bridge, starts evaluation independently of the browser, and stops it before the bridge/runtime. Open **Experts and Teams → Schedules** to create or manage intent. **Inspect occurrence** opens its native conversation, handoff, run trace and model usage. The read view polls receipts; it never drives execution.

`test/J-SCHEDULE-execution.test.ts` covers calendar/DST, recurrence, misfires, bounded capacity, revision changes, cancellation, provider failure, human approval and true subprocess kill/restart. Dispatch acknowledgment revalidates the current revision/status; a competing cancellation cannot resurrect a reserved occurrence. A late accepted native Assignment is cancelled. This compensating defense does not establish distributed run ownership. `test/E2E-experts-debt.test.ts` exercises the controls and evidence on desktop/mobile Chromium. Creator-only listings and mutation checks do not make the development authenticator a production trust boundary.
