# PandaCode UX affordances → Cognate Workbench — implementation plan

Companion to `delta-matrix.md` (evidence for every claim below). Donor: `.tmp/donor/pandacode`
0.3.56 @ `ceed919`. Target: this repo @ `6fc51ab`.

**Recon corpus.** Four read-only recon reports back the citations in both documents and are the
source of record when a line number below disagrees with the tree:

| Report | Covers |
|---|---|
| `recon/donor-mechanisms.md` | donor grouping/collapse, steer lifecycle, approval bar, busy state |
| `recon/workbench-ui.md` | `App.tsx` transcript model, `useToolTimeline`, composer, approvals |
| `recon/message-path.md` | composer → server → provider, attachment feasibility, artifact storage |
| `recon/test-infrastructure.md` | how suites run, fixture/mock patterns, static-markup convention |

**Authority note.** `.agents/plans/PLAN_TEMPLATE.yaml` is a spec→settlement graph keyed on normative
requirement IDs from a frozen source spec. This mission has no such spec: the "spec" is four named
UX affordances plus a donor tree. So this plan borrows the template's *field discipline*
(`changes` / `proves` / `does_not_prove` / `hot_context` / `gate` / `teeth` / `redesign_trigger` /
`evidence`) and its task DAG, and deliberately omits `settles`/`traceability` rather than invent
requirement IDs that would imply a normative source which does not exist.

Proof levels: P0 mechanical, P1 behavioral + teeth, P2 invariant-sensitive. No P3 here — nothing in
this mission is settlement-critical.

---

## Slices, in dependency order

| Slice | Affordance | Size | Depends on | Decision |
|---|---|---|---|---|
| 1 | Collapsed tool activity | M | — | as recon'd |
| 2 | Screenshot paste | S | — | **re-scoped to (a-lite)**: preview only |
| 3 | Compact approvals | S | — | busy guard + long-text disclosure only |
| 4 | Multi-message queue + steering | M | 3 (shares busy/disabled idiom) | wire existing `steer.*` infra |

Slices 1, 2 and 3 touch disjoint code and may proceed in any order. Slice 4 is the only one that
changes user-visible *semantics* (multi-entry queue), so it goes last.

---

## Global gates (every task)

```
just typecheck
bun test --timeout 15000 test/<focused>.test.*
just verify            # at slice boundaries, not per-task
```

Baseline before any change: `just typecheck` clean.

---

## T01 — Collapsed tool activity (Slice 1)

**proof_level:** P1 · **confirmation:** builder_with_teeth · **depends_on:** []

**changes.** New pure module `src/toolGroups.ts` exporting `groupToolRuns` and `summarizeToolRuns`.
`MessageBubble` renders collapsible groups instead of the flat `verbose-step-list`
(`src/ui/App.tsx:3319-3327`). One consolidated tool-kind label table replaces the duplicated literals
in `toolActionLabel` (`:2349-2365`) and `verboseStepLabel` (`:3208-3218`). New CSS beside the existing
`verbose-step-list` rules (`src/ui/app.css:706-723`).

**proves.** Consecutive tool calls in one settled turn collapse into a disclosure whose summary names
the work in words, caps visible detail, and never merges across an intervening assistant narration.

**does_not_prove.** That the collapsed view survives reload (it does not — per-step detail is not
persisted; see the debt entry). That groups auto-open/close by recency (donor §1.7, out of scope).

**hot_context.**
- `.tmp/donor/pandacode/src/tool-activity.ts:88-98` — grouping: key = first call's key, cap 5,
  non-tool entry breaks the run.
- `.tmp/donor/pandacode/src/tool-trace.ts:218-253` — clause assembly, `SUMMARY_CLAUSES = 2`.
- `src/ui/App.tsx:160-168` — `ToolEntry` shape.
- The codebase's disclosure convention is `aria-expanded` on a `<button>` (`TodoWidget`,
  `src/ui/App.tsx:2490-2511`), **not** `<details>`. Follow the codebase.

**steps.**
1. `src/toolGroups.ts`: `groupToolRuns(entries, cap = 5)` → `readonly ToolRun[]`; a run carries the
   first entry's `toolCallId` as its stable key and holds at most `cap` entries.
2. `summarizeToolRuns(runs)` → `{ text, failedCount, running }`. Merge clauses by tool kind, show at
   most 2, append `and N more steps`, join `, ` / ` and `, append ` · N failed` when
   `failedCount > 0`; trailing `…` only when `running`.
3. One table `TOOL_KINDS` keyed by tool name → `{ action, noun }`; rewrite `toolActionLabel` and
   `verboseStepLabel` on top of it with behaviour preserved — the existing observability tests must
   not change.
4. `ToolGroup` component: `<button aria-expanded>` header (summary + failure mark + optional
   spinner); children = the existing per-step lines; `open` in component state.
5. In `MessageBubble`, render groups when `message.steps` is non-empty. Verbose now means "groups
   start open", not "grouping is off". `AuthorityNotice` stays unchanged and always visible.
6. CSS: reuse `.verbose-step-list` hooks; add `.tool-group*` only where needed.

**gate.**
```
just typecheck
bun test test/tool-groups.test.ts test/ui-observability.test.tsx
```

**teeth.**
- attack: 7 consecutive `read` calls, cap 5. expected: 2 runs, not 1 — the second run's key is the
  6th call's `toolCallId`, so the cap actually binds.
- attack: `read`, `edit`, an assistant narration entry (no `toolCallId`), `read`. expected: 3 runs;
  narration never appears among a run's children and never contributes a summary clause.
- attack: 6 failures in one run. expected: summary contains `6 failed` and the failure mark is in
  static markup; the summary does not read as success.
- attack: rewrite `toolActionLabel` on the new table, then diff its output for all 7 tools × 4 work
  detail modes against pre-change behaviour. expected: byte-identical.

**redesign_trigger.** If `ToolEntry` cannot be imported by a pure module without dragging React or
runtime imports in, stop: extract the type to a shared module first rather than importing `App.tsx`
from a pure function.

**evidence.** `.agents/reports/pandacode-delta/evidence/T01/`

**done_when.** Gate exits 0; all four teeth behave as specified; no existing test modified.

---

## T02 — Screenshot paste, preview-only (Slice 2, re-scoped)

**proof_level:** P1 · **depends_on:** [] (independent of T01)

**Decision (user-selected, option a-lite).** Ship the clipboard handler, thumbnail strip, 4-image cap
and capability-limit copy. **Do not** ship a send path. Pasted images stay in the composer.

**changes.** `Composer` (`src/ui/App.tsx:3056-3160`) gains `onPaste`, an attachment strip, and a
stated limitation. New pure module `src/attachments.ts` with the paste reducer and bounds.

**proves.** Pasting an image into the composer produces exactly one visible chip per image, bounded
at 4, and the UI states the image is not sent to the model — so the affordance cannot be mistaken for
multimodal transport that does not exist.

**does_not_prove.** That the model ever receives a pixel. `ModelMessage.content` is
`readonly string` (`node_modules/@godspeedai/cognate-capabilities/src/model.ts:7-14`) and all four
adapters hardcode `multimodal_input: false`. This task proves *presentation and honesty*, nothing
about transport.

**hot_context.**
- `.tmp/donor/pandacode/src/attachments.ts:19-20,32,59,137-159,166-171` — capability reason strings,
  `MAX_IMAGES = 4`, per-file rejection copy.
- Donor paste listener: `src/main.ts:4970` — scoped to the prompt element, ignores open dialogs. Copy
  the scoping, not the IPC.
- `src/capabilities/tools.ts` — how capability limits are phrased elsewhere in this app.

**steps.**
1. `src/attachments.ts`: `reducePaste(existing, files)` → `{ accepted, rejected }`; bounds
   `MAX_IMAGES = 4`, ≤ 4 MiB each, mime must start `image/`. Rejection reasons must be actionable
   ("Only images can be pasted here", "Limit 4 images per message").
2. Preview object URLs must be revoked on removal **and** unmount — the leak is invisible otherwise,
   so keep the revoke path explicit and testable.
3. Composer `onPaste`: read `e.clipboardData.items`, keep `kind === "file"`, and `preventDefault`
   only when at least one image was accepted.
4. Thumbnail strip above the textarea, `role="list"`, per-chip Remove with an `aria-label` carrying
   the file name.
5. Capability notice: one line, visible whenever attachments are present, stating the image is kept in
   the composer and **not** sent to the model. Word it as a limit, not a promise.
6. **Block send while attachments are present**, with the reason shown, so no message can go out whose
   text silently drops the images. This is the slice's teeth.

**gate.**
```
just typecheck
bun test test/attachments.test.ts test/composer-attachments.test.tsx
```

**teeth.**
- attack: paste 5 images. expected: 4 accepted, 1 rejected with the limit reason; no silent drop.
- attack: paste a clipboard with no image items. expected: `preventDefault` not called and the paste
  proceeds as ordinary text — attaching must not eat text paste.
- attack: with one attachment present, trigger send. expected: no `onSend` call, reason visible in
  rendered markup.

**redesign_trigger.** If the framework gains an image content part mid-flight, stop and re-plan the
send path rather than bolting transport onto a preview-only composer.

**evidence.** `.agents/reports/pandacode-delta/evidence/T02/`

---

## T03 — Compact approvals (Slice 3)

**proof_level:** P1 · **depends_on:** []

**Scope note.** Only two donor mechanisms are reachable here. The donor's "N approvals needed /
Approve all" group (matrix §3.3) needs ≥2 concurrent pending approvals, which this runtime cannot
produce: `pendingApproval` is a single `.find()` (`src/ui/App.tsx:4766`) over a sequential tool loop
(invariant at `:2291-2293`). That row is **excluded with a reason**, not deferred.

**changes.** `ApprovalBar` (`src/ui/App.tsx:2440-2485`) gains a busy guard and long-text disclosure.
`decideApproval` (`:4758-4765`) gains per-request in-flight state.

**proves.** A pending approval cannot be answered twice by a fast double-activation, and a long
justification no longer pushes the decision buttons out of view.

**does_not_prove.** Anything about authorization. No permission, gate, or `PermissionMode` semantics
change; the donor's approval *modes* are out of scope (matrix §3.6).

**hot_context.**
- `.tmp/donor/pandacode/src/main.ts:1723,1728-1737` — `pendingApprovals` guard, cleared in `finally`.
- `.tmp/donor/pandacode/src/approval-bar.ts:10-13,20-29` — 240-char clip, first non-empty line,
  backticks stripped.
- `src/ui/App.tsx:2443-2465` — existing autofocus + Enter/Escape handling; do not regress it.
- `SurfaceView` renders structured diff content — **never** clip or collapse it.

**steps.**
1. `src/approvalSummary.ts` (pure): `summarizeApproval(text)` → first non-empty line, backticks
   stripped, clipped at 240 with an ellipsis, plus `isLong` so the UI can offer disclosure.
2. `ApprovalBar`: wrap a long justification in the same `aria-expanded` button convention as
   `TodoWidget` and `ToolGroup`. Skip entirely when `surface` is present.
3. In-flight guard: `const [deciding, setDeciding] = useState(false)`; disable both buttons while
   true, reset in `finally`. It must cover the `resolveContinuation` await.
4. Keep Enter/Escape working while not busy; suppress while busy.

**gate.**
```
just typecheck
bun test test/approval-summary.test.ts test/ui-observability.test.tsx
```

**teeth.**
- attack: activate Approve twice before the first promise resolves. expected: exactly one
  `resolveContinuation` call.
- attack: an approval whose `surface` is present. expected: no disclosure wrapper in the markup — the
  structured content renders in full.
- attack: a 500-char justification containing backticks. expected: summary ≤ 240 chars, backticks
  gone, full text still reachable.

**redesign_trigger.** If guard state has to live outside the bar (e.g. because the bar remounts per
approval), stop and re-derive: remounting would clear `deciding` mid-flight and silently reopen the
double-submit window.

**evidence.** `.agents/reports/pandacode-delta/evidence/T03/`

**done_when.** Gate exits 0; teeth behave as specified; no permission code touched.

---

## T04 — Multi-message queue + observed steering (Slice 4)

**proof_level:** P2 · **depends_on:** [T03] · **confirmation:** builder_with_teeth

**Scope note — two corrections from recon, one of which invalidates the obvious design.**

*Correction 1 (good news).* The steering machinery is not greenfield:

- reducer folds `workbench.steer.enqueued` / `.consumed` — `src/workbench/reducer.ts:178-188`
- event names — `src/workbench/types.ts:194-195`
- `steeringReflection` — `src/workbench/steering.ts:122-135`
- existing tests — `test/workbench-steering.test.ts`

*Correction 2 (blocker).* **The `queue-next` channel is write-only.**
`steer.enqueue({mode:"queue-next"})` routes into `inbox.nextTurn`
(`src/workbench/steering.ts:47-52`), and `steer.pending` returns it as `queued`
(`src/capabilities/workbench.ts:539`) — but **nothing in `src/` reads `nextTurn` for delivery**. The
agent reads only `pending.steer`, i.e. `nextStep` (`src/agents/agentCoding.ts:480`), and `drainTurn` is
exported and unit-tested but **called from nowhere outside `test/workbench-steering.test.ts`**. A naive
"wire the composer to `steer.enqueue`" would make queued messages durable and visible while **never
delivering them** — strictly worse than today's React ref, which at least sends on `idle`
(`src/ui/App.tsx:5160-5167`).

So T04 splits: T04 is what ships; T04b records the blocked remainder.

### T04 — multi-entry queue + truthful steering status

**changes.**
1. `Composer` queue: `queued?: string` → `readonly queued: readonly QueuedMessage[]`
   (`src/ui/App.tsx:3099`), with the dispatch effect at `:5160-5167` sending them FIFO.
2. Per-row Steer and Remove (Edit optional). Rows render as `role="list"`.
3. Replace the optimistic line at `src/ui/App.tsx:5143` — which asserts "it applies at the next step"
   *before* anything confirms it — with an observed status driven by `workbench.steer.consumed`.

**proves.** (i) Two messages can be queued while a run streams, are individually cancellable, and are
sent in order when the run settles; (ii) the transcript only claims a steering message was applied
after the log records `workbench.steer.consumed` for it.

**does_not_prove.** That the queue survives reload — it does not, and T04 does **not** claim otherwise
(see T04b). That hold reasons exist (`restart|failed|stopped|limited`, donor §4.4) — deferred.

**hot_context.**
- `src/ui/App.tsx:5136-5170` — the current steer/queue path. Delivery into a **live** run goes through
  `client.updateState("/steer/-")`, deliberately *not* through the capability, because a capability
  write would queue behind the serial executor (`src/agents/agentCoding.ts:467-470` documents this).
  Keep that mechanism exactly as-is.
- `src/agents/agentCoding.ts:474-487` — `drainSteering` already emits `workbench.steer.consumed`.
- `.tmp/donor/pandacode/src/message-queue.ts:4-14,43-70` — entry shape and panel copy.

**steps.**
1. Type change + FIFO dispatch; keep today's single-entry copy verbatim so the one-message case reads
   exactly as before.
2. Per-row Steer/Remove in the list.
3. Steering status: append the user message immediately, then a **pending** system row. Promote it to
   "applied at the next step" only when a `workbench.steer.consumed` arrives whose `ids` contains the id
   written into `/steer`. Match by id — not by "some steering happened", which would mis-credit one
   message's consumption to another.
4. If a run ends without that id being consumed, mark the row "not applied" and **requeue** the text
   rather than dropping it.
5. Failure path: if `updateState` rejects, restore the composer text and say so.

**gate.**
```
just typecheck
bun test test/workbench-steering.test.ts test/composer-queue.test.tsx
just verify
```

**teeth.**
- attack: queue two messages while busy, cancel the first. expected: exactly the second is sent, once.
- attack: steer a message the agent never consumes before the run ends. expected: the transcript never
  says "applied"; the row is marked not applied and the text is requeued.
- attack: steer two messages, then a `steer.consumed` arrives for only the second. expected: the first
  stays pending — the UI must not credit consumption to the wrong message.
- attack: make `updateState` reject. expected: composer text restored, failure visible, no text lost.

**redesign_trigger.** If matching a `steer.consumed` id back to a rendered row requires reconstructing
run state the UI does not have, stop: surface the honest coarse status ("sent to the agent") instead of
inventing per-message certainty.

**evidence.** `.agents/reports/pandacode-delta/evidence/T04/`

**done_when.** Gate + `just verify` green; the "applies at the next step" claim appears only after an
observed consumption; no user message can be lost.

### T04b — durable queue (BLOCKED — needs T04b-pre first)

**Blocked on:** the `queue-next` channel having no consumer. Adding durability before fixing that turns
today's working in-memory queue into a durable black hole.

**T04b-pre (prerequisite, agent-side).** Give `nextTurn` the *same* consumption path `nextStep` already
has: read it from `steer.pending().queued` and, when it is injected as the next user turn, emit
`workbench.steer.consumed` for its id — the reducer already prunes both queues by consumed id
(`src/workbench/reducer.ts:188`). Do **not** reach for `drainTurn`: neither `drainTurn` nor `drainStep`
has a production caller, because the shipped design prunes by event rather than by returning a reduced
inbox. Calling one of them now would fork a second, divergent consumption mechanism.

**Only then:** repoint the composer queue at `steer.enqueue({mode:"queue-next"})` and derive the
rendered queue from the `inbox/` projection so a reload shows the true queue.

**Why this is not in this mission.** T04b-pre changes agent execution behaviour — an extra turn can
appear that the operator did not type during that run. That is beyond "UX affordance" and deserves its
own change with its own replay and idempotency analysis. Logged as debt, with the closure path recorded.

---

## DAG and critical path

```
T01 collapsed activity ──┐
T02 paste preview      ──┼──→ final pass (implementation-report, remaining-opportunities)
T03 approvals ──→ T04 queue + observed steering ──┘
```

Critical path: **T03 → T04**. T01 and T02 are independent of both and of each other; they can land in
any order or in parallel. The only real prerequisite in the whole plan is T04 depending on T03, and
only because they share the disabled/busy idiom — not because of data.

## Excluded work, with reasons

| Excluded | Reason | Where |
|---|---|---|
| DOM capture/restore of group expansion | React reconciles by key; porting it would create a second source of truth | matrix §1.5, §1.6 |
| Auto-open/close choreography | Depends on T01 existing first; second-order polish | matrix §1.7 |
| Approval group UI (≥2 pending) | Unreachable: single `.find()`, sequential tool loop | matrix §3.3 |
| Approval modes / permission policy | Authorization, not a UX affordance | matrix §3.6 |
| Turn-changes chip / folder tree | Workbench review surface already deeper | matrix §1.9 |
| Image transport to the model | Framework: `content: string`, `multimodal_input: false` | matrix §2.4, P0-B |
| Queue hold reasons | Needs run-failure/limit state the composer lacks | matrix §4.4 |
| Live-array eviction | `MAX_TOOL_STEPS = 20` already bounds it | matrix §1.8 |

## Honest limits of this plan

1. **T02 ships no transport.** It is a preview affordance plus an explicit limitation. Anyone reading
   the result as "Cognate takes screenshots now" would be wrong, and the UI copy exists to prevent
   exactly that misreading.
2. **Collapsed history does not survive reload.** `session.history` returns only `stepCount`
   (`src/capabilities/sessionHistory.ts:53`), so a reloaded turn has no per-step detail to group.
   T01 improves the live-session transcript only. This is pre-existing, logged as debt, and not fixed
   here.
3. **T04 does not add delivery guarantees, and does not make the queue durable.** It makes the queue
   *multi-entry* and the steering claim *truthful*; delivery still rides the existing
   `idle`-settle dispatch effect (`src/ui/App.tsx:5160-5167`), so a reload still loses anything queued.
   Durability is deliberately deferred to T04b, which is blocked by the write-only `nextTurn` channel.
   A reader must not mistake T04's list UI for a durable inbox.
4. **No P3 task.** Nothing here is settlement-critical, and claiming otherwise would inflate the
   evidence requirements beyond what the change can bear.





