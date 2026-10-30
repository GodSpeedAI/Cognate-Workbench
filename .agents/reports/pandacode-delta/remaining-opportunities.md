# Remaining opportunities

What this mission deliberately left unbuilt, ordered by what it would take to get
right — not by how appealing it is.

## 1. T04b — durable queue (blocked; prerequisite written out)

The queue is React state and dies with the page. Making it durable *correctly*
requires first closing a plumbing gap that has nothing to do with the UI:

**T04b-pre.** `steer.enqueue({mode:"queue-next"})` writes `inbox.nextTurn`
(`src/workbench/steering.ts:47-52`), and nothing in `src/` reads `nextTurn`. The
agent reads `pending.steer` = `nextStep`
(`src/agents/agentCoding.ts:480`). So `queue-next` is a capability that accepts
writes and delivers nothing. The fix is to give `nextTurn` the consumption path
`nextStep` already has: read it from `steer.pending().queued` and, when it is
injected as the next user turn, emit `workbench.steer.consumed` for its id — the
reducer already prunes both queues by consumed id
(`src/workbench/reducer.ts:183-188`).

**Do not reach for `drainTurn`.** Neither `drainTurn` nor `drainStep` has a
production caller, because the shipped design prunes by *event* rather than by
returning a reduced inbox. Calling one now would fork a second, divergent
consumption mechanism — exactly the class of bug this mission's tooth 3 exists to
catch.

Only after that does repointing the composer at `steer.enqueue` become safe, with
the rendered queue derived from the `inbox/` projection so a reload shows the true
queue. This is a separate change because it alters agent execution behaviour — an
extra turn can appear that the operator did not type during that run — and needs
its own replay and idempotency analysis.

## 2. Queue hold reasons

The donor models `HoldReason = restart | failed | stopped | limited` with per-reason
labels and a Resume action (`message-queue.ts:16-22`). None exist here, so a run
that fails or hits a limit leaves messages queued with no statement of *why*.

This was deferred on purpose, and the deferral has a cost worth naming: silence is
not neutral. A message that stays queued after a failure looks like a UI bug to the
operator. Doing it properly needs the composer to observe run-failure and limit
state, which today it does not — so a label added cheaply would be a guess rendered
as fact. Next slice of this family, after T04b-pre.

## 3. Queue edit and reorder

The donor has inline edit, move up, and move down (`message-queue.ts:44-55,82-90`).
Cut here because reorder is presentation-only and Cancel + Steer already cover both
actions with a delivery consequence. Low value, low risk; it can land whenever the
queue list is next touched.

## 4. A DOM test harness

The single biggest limit across all four slices. Every "the UI does X" claim rests
on a pure predicate tested in isolation plus a reading of the effect body. That is
honest, and it is weaker than a rendered assertion. T04's promotion, settlement,
and one-per-idle dispatch are the highest-value candidates: they involve timing and
event ordering that pure tests cannot reach, and they fail in ways that are visible
only after a real run ends.

Adding a harness is a mission of its own (it means a renderer, a fake client, and a
decision about how to advance effects deterministically), which is why it was not
smuggled into an affordance slice.

## 5. Transport for attachments

T02 previews a pasted screenshot and states plainly that the bytes are never sent.
Making that true requires model transport the framework does not have:
`content: string`, `multimodal_input: false` across all adapters. Not a UI change;
not in scope; and the UI copy exists so nobody reads the preview as delivery.

## 6. Test hygiene (observed, logged, not fixed)

Two pre-existing failures make the suite red for environmental reasons. Both were
proven on unmodified `6fc51ab` before being attributed to the environment, and both
are in `.agents/DEBT.md`:

- E2E remote workspaces: the WSL "not responding" state has no matching locator.
- Several `J-*` tests boot three servers inside bun's default 5s budget and time
  out at ~5000ms under load.

The second one is the more corrosive: because the failures cluster in files
unrelated to whatever is being changed, a red suite invites the reader to suspect
the change in front of them. Raising those timeouts to reflect the actual work is
a small, high-value fix.

## What is *not* an opportunity

Approval modes and permission policy (T03's neighbour) are authorization decisions,
not affordances; approving them under a UX mission would be a category error. The
approval group UI for ≥2 pending is unreachable given a single `.find()` over a
sequential tool loop. The turn-changes chip and folder tree are shallower than the
Workbench's existing review surface. None of these are gaps to close.
