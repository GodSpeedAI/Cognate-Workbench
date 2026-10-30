# T04 — Multi-message queue + observed steering status: evidence

Date: this session. Target repo @ `6fc51ab` + T04 changes.

## What shipped, and the one thing that did not

Shipped:
1. **Multi-entry composer queue** — `queued?: string` became `readonly QueuedMessage[]`, dispatched
   FIFO, one per idle transition.
2. **Per-row Steer and Remove** — rows render as `role="list"`, each numbered and individually
   actionable.
3. **Truthful steering status** — the pre-T04 line asserted "it applies at the next step" the instant
   the message was written, before anything confirmed it. That claim is now gated on
   `workbench.steer.consumed` naming the id, and a steer that is never consumed is reported as not
   applied with its text returned to the queue.

**Not shipped — T04b, deliberately.** Per plan Correction 2, `steer.enqueue({mode:"queue-next"})`
writes `inbox.nextTurn`, which nothing consumes. Repointing the composer at that capability would
produce messages that are durable, acked, displayed as queued, and never delivered — strictly worse
than the in-memory queue, which does send on idle. The queue therefore stays local this slice; the
blocked remainder and the correct (event-path) fix are recorded in `DEBT.md` and §T04b.

| File | Change |
|---|---|
| `src/steerQueue.ts` | **new** — `enqueue`/`remove`/`shift`, `markConsumed`, `settleRun`, `steerStatusLine`, `queueNotice` |
| `src/ui/App.tsx` | queue state → array; `busySubmit` records a `SteerAttempt`; `steerQueued`; consumed-event subscription; run-end settlement; `ChatMessage.steerId`; `Composer` queue list |
| `src/ui/app.css` | `.composer-queue-list`, `-row`, `-index`, `-text`, `-action` |
| `test/steer-queue.test.ts` | **new** — 15 tests |
| `test/composer-queue.test.tsx` | **new** — 6 tests |

## Gate

```
just typecheck                                     → exit 0
bun test test/workbench-steering.test.ts test/J-WB-steering.test.ts \
         test/composer-queue.test.tsx test/steer-queue.test.ts          → 56 pass, 0 fail
```

All four slices together:

```
bun test test/tool-groups.test.ts test/tool-group-render.test.tsx \
         test/approval-summary.test.ts test/approval-bar-render.test.tsx \
         test/attachments.test.ts test/composer-attachments.test.tsx \
         test/steer-queue.test.ts test/composer-queue.test.tsx \
         test/workbench-steering.test.ts test/J-WB-steering.test.ts
                                                              → 133 pass, 0 fail, 336 expect() calls
```

Full suite: **1340 pass, 12 skip, 8 fail**. None of the 8 is caused by this work,
and each was traced rather than waved at:

| Failure | Diagnosis |
|---|---|
| 3× `J-EXPERT-MODEL-PARALLEL` | `5000.12ms` / `5077.22ms` / `5001.75ms` — bun's default 5s per-test budget, not an assertion |
| `workspace.proof.current` | `5005.04ms`, `timed out after 5000ms` |
| `J-CFG-model-catalog` | `5104.84ms`, `timed out after 5000ms` |
| `J-H-provider-error` | `5010.60ms`, `timed out after 5000ms` |
| `E2E remote workspaces` | proven pre-existing on unmodified `6fc51ab` (debt entry 6) |
| `E2E Experts and Teams` | passes on this tree when run alone (`EXIT:0`); fails on unmodified `6fc51ab` when run alone. Load-dependent, not a regression |

The six timeout failures are one cause: these tests boot three servers inside a
default 5s limit. Debt entry 7 records it with the baseline evidence.

## Teeth — each one, with its resolution

1. **Queue two while busy, cancel the first → exactly the second is sent, once.**
   `steer-queue.test.ts` → "TEETH: cancelling the first of two sends exactly the second". Note the
   second half of that assertion: after the dispatch the queue is *empty*, so a cancelled message
   cannot resurface, and `shift` on the remainder yields nothing — "once".
   The exactly-once dispatch is additionally guarded in the UI by `dispatchedForIdleRef`: the effect
   depends on `send`, whose identity changes independently of run status, and without the ref a `send`
   identity change while still idle would dispatch a second message into the same idle window.

2. **Steer a message the agent never consumes → the transcript never says "applied"; the row is
   marked not applied and the text is requeued.**
   `markConsumed` is the only path to `applied`, and `settleRun` is the only path off `pending` when
   the log is silent. Asserted for the status, the wording (the line must not contain "applied at the
   next step"), and the hand-back of text. In the UI, the settle effect rewrites the `steerId` row and
   enqueues the text.

3. **Steer two, a `consumed` arrives for only the second → the first stays pending.**
   `steer-queue.test.ts` → "TEETH: consumption is credited by id, so a sibling attempt stays pending".
   This is the tooth that decided an implementation detail: the transcript row carries
   `ChatMessage.steerId` and promotion matches *that*. A first implementation matched the status row by
   `m.content === steerStatusLine("pending")`, which is exactly the mis-credit the tooth forbids for two
   identical pending steers — it would have promoted the earlier row. Removed before it shipped.

4. **Make `updateState` reject → composer text restored, failure visible, no text lost.**
   The `catch` on the `updateState` promise marks the attempt `rejected` (whose wording says the
   message is back in the composer) and enqueues the text. It does not claim success anywhere.
   **Honest limit:** the rejection path lives inside a React callback and is not exercised by an
   automated test (no DOM harness). What is asserted is the pure predicate it relies on — that
   `rejected` has distinct wording which states the text is returning to the composer, so the
   failure cannot be silent or misread as success ("the rejected line says the text is coming back,
   not that it was lost").

## Honest limits

- **The queue does not survive reload.** It is React state. T04 does not claim otherwise; T04b is where
  durability would arrive, and it is blocked (see above).
- **Hold reasons are absent.** The donor models `restart | failed | stopped | limited`
  (`message-queue.ts:15-20`); none are implemented, so a run that ends unexpectedly parks messages with
  no explanation of *why* they are still waiting. The plan defers these and this slice does not imply
  them.
- **Edit and reorder are absent** (the donor has both, `message-queue.ts:53-55,82-90`). Cancel and
  Steer cover the two actions with a delivery consequence; moving a message up is presentation only, so
  it was cut rather than half-built.
- **`steer.consumed` is per run.** The subscription is scoped to `activeRunId`, so a steer written to a
  run that ends and is replaced mid-flight is settled by the settle effect (the run it belongs to is
  over) rather than by a late event. A trailing event arriving after settlement must not flip the row
  back — asserted ("an already-settled attempt is not reopened by a late consumed event"), because
  `markConsumed` only promotes from `pending` and the text has already been returned by then.
- **Settlement relies on `activeRunId` clearing.** The settle effect fires on
  `status === "idle" && activeRunId === undefined`. If a future change kept `activeRunId` set after a
  run ends, unapplied steers would stay pending rather than being reported. The condition is explicit
  and commented for that reason.
