# PandaCode → Cognate Workbench: implementation report

Four vertical slices ported from the PandaCode donor
(`.tmp/donor/pandacode`) into the Workbench, each one a self-contained
affordance with its own pure module, its own tests, and its own evidence file.

Base: `6fc51ab`. T01–T03 are purely additive — new modules, new CSS, no existing
behaviour repointed. T04 is the exception and says so: it replaces the composer's
one-slot `queued?: string` with an ordered list, which is a change to an existing
mechanism rather than an addition beside one. It does not touch any capability or
event the agent side consumes.

## What was ported, and what "ported" excludes

| Slice | Affordance | New module | Tests | Evidence |
|---|---|---|---|---|
| T01 | Tool activity collapses into a summary with per-group expansion | `src/toolGroups.ts` | 29 + 6 | `evidence/T01/README.md` |
| T02 | Screenshot paste → thumbnail in the composer, with an explicit "not sent" limit | `src/attachments.ts` | 21 + 3 | `evidence/T02/README.md` |
| T03 | Long approval text is summarized with a disclosure for the full text | `src/approvalSummary.ts` | 12 + 6 | `evidence/T03/README.md` |
| T04 | Multi-entry composer queue + steering status observed from the log | `src/steerQueue.ts` | 15 + 6 | `evidence/T04/README.md` |

98 new tests. Combined focused gate:

```
bun test test/tool-groups.test.ts test/tool-group-render.test.tsx \
         test/approval-summary.test.ts test/approval-bar-render.test.tsx \
         test/attachments.test.ts test/composer-attachments.test.tsx \
         test/steer-queue.test.ts test/composer-queue.test.tsx \
         test/workbench-steering.test.ts test/J-WB-steering.test.ts
→ 133 pass, 0 fail, 336 expect() calls
```

`just typecheck` → exit 0.

## The recurring shape

All four slices ended up in the same structure, because that is what this
codebase already does: **pure logic in a module with no React, thin presentational
code in `App.tsx`, and the decisions tested where they can be tested without a DOM.**
The repo has no DOM harness, and none was added. That choice is visible in every
evidence file as a limit rather than as a claim: the pure predicates are proven,
the wiring is argued from the code path, and where a behaviour can only be
demonstrated by rendering, the evidence says so instead of implying otherwise.

## Where the donor was deliberately not followed

| Donor behaviour | Why not | Slice |
|---|---|---|
| Queue edit / move up / move down | Reorder is presentation-only; Cancel and Steer are the actions with a delivery consequence | T04 |
| `HoldReason = restart\|failed\|stopped\|limited` | Requires run-failure state the composer does not see; a half-built hold label would be a false explanation | T04 §4.4 |
| Image transport to the model | Framework blocks it: `content: string`, `multimodal_input: false` | T02 |
| Approval permission modes | Authorization, not a UX affordance | T03 |
| DOM capture/restore of expansion | React reconciles by key; porting it creates a second source of truth | T01 |

## Two traps found by building, not by reading

1. **The `nextTurn` black hole (T04).** `steer.enqueue({mode:"queue-next"})` writes
   `inbox.nextTurn`, which nothing in `src/` consumes. Repointing the composer at it
   would have produced messages that are durable, acknowledged, displayed as queued,
   and never delivered — worse than the in-memory queue it replaced. Durability was
   therefore *not* shipped; it is blocked in the plan as T04b with its prerequisite
   (T04b-pre) written out. This is the single most valuable output of the mission,
   and it is a refusal.
2. **Content-matched promotion (T04).** The first implementation of "mark the steer
   applied" matched the transcript row by its text. With two identical pending
   steers that credits the wrong row — precisely what tooth 3 forbids. Caught during
   construction and replaced with `ChatMessage.steerId`, so consumption is credited
   by identity rather than by resemblance.

## Pre-existing failures, proven not caused here

Two failures in the suite are environmental and were each demonstrated on
unmodified `6fc51ab` in a separate worktree before being attributed to the
environment rather than to this work:

- `E2E remote workspaces` — `RemoteWorkspaceForm` has a third WSL end-state
  (`reason === "not-responding"`) that the test's locator cannot match.
- Several `J-*` integration tests boot three servers inside bun's default 5000ms
  budget and time out at 5000–5017ms under load, including when run as a single
  file on a quiet machine at ~4.4 load average.

Both are logged in `.agents/DEBT.md` (entries 6 and 7) with confidence `high`,
because in each case the failing behaviour was directly observed on the
unmodified tree.

## Honest limits of the whole mission

1. **T02 ships no transport.** It is a preview plus an explicit limitation. The
   bytes are never sent; all adapters report `multimodal_input: false`.
2. **T01's collapsed history and T04's queue do not survive reload.** Both are
   React state; `session.history` returns only `stepCount`.
3. **No behaviour that requires rendering is covered by an automated test.** The
   promotion, settlement, and dispatch-on-idle paths in T04 are argued from the
   pure module and the effect body, not demonstrated in a DOM.
4. **This is four affordances, not a UX overhaul.** It does not make Workbench
   match PandaCode; it closes the four specific deltas that the matrix scored as
   worth closing, and records the rest as excluded with reasons.
