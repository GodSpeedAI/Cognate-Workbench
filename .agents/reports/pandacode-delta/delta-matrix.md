# PandaCode → Cognate Workbench delta matrix

Mission: adopt PandaCode's *UX affordances* (collapsed tool activity, screenshot paste, compact
approvals, multi-message queue/steering) without disturbing Workbench architecture.

Legend: **OBSERVED** = read directly in source this session. **INFERRED** = reasoned from what was
read. Every row cites `file:line`. Donor root: `.tmp/donor/pandacode` (0.3.56 @ `ceed919`).
Workbench: repo root.

> **Line-number basis.** All `src/ui/App.tsx` and `src/ui/app.css` citations in the *"Workbench
> today"* column were captured against `6fc51ab`, **before** these slices were applied. They
> describe the pre-change state on purpose — that is what the column means — but they no longer
> resolve against the working tree, because slices T01–T04 shifted lines in both files. Citations
> into `src/` files the slices did not touch (`src/agents/`, `src/workbench/`, `src/capabilities/`)
> still resolve as written. The *as built* column (§4) is the current-state reference.

Excluded by mission (not rowed): wallpaper/background theming, GitHub hub, VM manager, terminal
runtime.

---

## 0. Frame: what kind of port this can be

The donor is a single-page Electron app that renders HTML strings into a DOM it owns, then repairs
that DOM by hand (`data-stream-key` reconciliation, `captureTools`/`restoreTools`). The Workbench is
a React 19 app over a durable event log; the UI folds recorded events into view state
(`useToolTimeline`, `src/ui/App.tsx:2291-2342`). Any donor mechanism that exists *because* the donor
re-renders by `innerHTML` does **not** transfer — React already preserves disclosure state across
re-renders. That single fact kills roughly a third of the donor's tool-activity code as
non-applicable, and it is the reason Slice 1 is small.

---

## 1. Collapsed tool activity

| # | Donor mechanism | Donor cite | Workbench today | Delta | Slice | Risk |
|---|---|---|---|---|---|---|
| 1.1 | `groupToolRuns`: fold consecutive tool entries into runs; a run keeps the **first** call's key; **hard cap 5**; any non-tool entry (`undefined` key) becomes its own `message` run and therefore a boundary | `.tmp/donor/pandacode/src/tool-activity.ts:88-98` | Nothing. The live timeline is a flat `ToolEntry[]` (`src/ui/App.tsx:160-168`); a settled turn shows *either* a folded "Took Ns" line *or* a flat `verbose-step-list` (`src/ui/App.tsx:3319-3327`) | Port as a **pure function** over `readonly ToolEntry[]` → runs. No DOM concerns. | 1 | Low — pure, no state |
| 1.2 | Summary sentence: per-kind `[runningVerb, doneVerb, icon, singular, plural]` table | `src/tool-trace.ts:24-37` | Workbench has two separate label tables for 7 tools: `toolActionLabel` (`src/ui/App.tsx:2349-2365`) and `verboseStepLabel` (`src/ui/App.tsx:3208-3218`) | Merge into one kind table (single source), then build clauses on it | 1 | Low |
| 1.3 | Clause assembly: merge by `verb:key`, show at most **2** clauses, remainder as `and N more steps`, join `a, b and c`; failures appended ` · N failed`; `…` only when live *and* something is running | `src/tool-trace.ts:218-253` (`SUMMARY_CLAUSES = 2` at `:234`) | No summarisation exists anywhere | Port the behaviour, re-written in Workbench idiom (frozen arrays, `readonly`, no `escape()`) | 1 | Low |
| 1.4 | Folded header renders as `<details class="tool-group">` with `data-tool-group-key="group:<firstKey>"`, `data-running`, failure alert mark, status span split off ` · ` | `src/tool-activity.ts:105-113` | No grouped disclosure. `TodoWidget` (`src/ui/App.tsx:2490-2511`) is the closest existing `<button aria-expanded>` pattern | Use the codebase's own `aria-expanded`-on-`<button>` convention, not `<details>` | 1 | Low |
| 1.5 | Expansion-state preservation across re-render: `captureToolGroups`/`restoreToolGroups`, keyed by group key *or* any shared tool key, plus focus restore | `src/main.ts:1353-1368`; call order `:1273,1316-1320` | **Not needed.** React reconciles by `key`; open/closed lives in component state bound to a stable key | **Drop entirely.** Porting it would create two sources of truth for disclosure. | — | Zero — do not port |
| 1.6 | Live patching that never replaces the group's DOM; `liveGroupEntries` WeakMap identity memo; node move instead of rebuild | `src/main.ts:1542-1614` | **Not applicable.** React does this. | Drop. | — | Zero |
| 1.7 | Auto-choreography: keep 2 newest result cards open, collapse older; `pinned` reader intent beats automation; narrated-past groups get `data-earlier` and never reopen | `src/trace-motion.ts:8,24-34,83-107`; `src/main.ts:1605-1612` | Nothing | Out of Slice 1. Second-order polish that *depends* on 1.1–1.4 existing. Candidate for the remaining-opportunities pass. | — (post-4) | Low |
| 1.8 | Live activity bounded to 30 entries, focused tool + narrative protected from eviction; `omittedActivity` → "Earlier activity will be available in saved history." | `src/main.ts:769-779,1548-1562` | The whole run's `ToolEntry[]` lives in a Map for the run's lifetime (`src/ui/App.tsx:2301`), discarded on run change. `MAX_TOOL_STEPS = 20` (`src/agents/agentCoding.ts:96`) bounds it naturally. | **No eviction needed today.** Real gap is `message.steps` not surviving reload — `session.history` returns only `stepCount` (`src/capabilities/sessionHistory.ts:53`), so a reloaded turn always folds even under Verbose (`src/ui/App.tsx:151-157`). Pre-existing, out of scope. Do not fix here. | — | Low |
| 1.9 | Turn-changes summary: changed-files chip, `+X −Y`, folder tree, Run / Open diff | `src/turn-changes.ts:15-45`; placement `src/main.ts:1262-1266,1298` | `EditDiff` + `openReviewPanel` (`src/ui/App.tsx:3332-3334`) and the whole `TrajectoryView`/review panel (`src/ui/App.tsx:4119-4208`) | **Not one of the four named affordances.** The Workbench review surface is already deeper than the donor's chip. Excluded. | — | — |

**Slice 1 shape.** A new pure module (e.g. `src/toolGroups.ts`) exporting `groupToolRuns` +
`summarizeToolRuns`; `MessageBubble` renders groups instead of the flat `verbose-step-list` when it
has `message.steps`; live `ToolActivity` stays as-is (it is already the single-current-tool
indicator, `src/ui/App.tsx:2371-2396`). Reuses the existing `verbose-step-list` styling hooks
(`src/ui/app.css:706-723`).

---

## 2. Screenshot paste / attachments

| # | Donor mechanism | Donor cite | Workbench today | Delta | Slice | Risk |
|---|---|---|---|---|---|---|
| 2.1 | Document-level `paste` listener scoped to the prompt element, ignored while a dialog is open | `src/main.ts:4970` | Nothing in `src/` handles `paste`, `drop`, `File`, `FileReader`, or `<input type="file">` | Add a paste handler on the composer textarea only | 2 | Low (UI) / **High** (transport, 2.4) |
| 2.2 | Clipboard image → data URL → thumbnail in composer; images capped at **4** per turn; unreadable files rejected with a reason | `src/attachments.ts:32,137-159,220-226` | None | Port the *shape* (bounded count, bounded bytes, honest rejection copy) | 2 | Low |
| 2.3 | A harness that cannot take images gets a **reason string**, and a documents-only menu | `src/attachments.ts:19-20,59,166-171` | No harness-capability surface in the composer at all | **This is the honest core of Slice 2.** Surface an explicit capability limit. | 2 | Low |
| 2.4 | Images travel as **native image blocks** to the harness | `src/attachments.ts:5-6` ("images travel as native image blocks"), via native IPC | **`ModelMessage.content` is `readonly string`** — `node_modules/@godspeedai/cognate-capabilities/src/model.ts:7-14`. Every adapter hardcodes `multimodal_input: false` (`cognate-provider-anthropic-compatible/src/index.ts:58`, `-openai-responses/src/index.ts:58`, `-openai-compatible/src/index.ts:17`, `-local/src/index.ts:48`). `AgentCodingInput` has no attachment field (`src/agents/agentCoding.ts:53-85`); the only user-turn injection point is `src/agents/agentCoding.ts:463` | **BLOCKED at framework level. There is no image path to port.** | 2 (re-scoped) | **High — see P0-B** |
| 2.5 | Attachment rows in the queue carry a count chip; a queued message *with* attachments cannot be steered ("Queued messages with attachments are sent after the run.") | `src/message-queue.ts:40,54-55`; `src/main.ts:2554-2563` | No queue rows exist (see §4) | Only relevant once Slice 4 lands. If Slice 2 is text-only, the restriction is moot. | 4 | Low |
| 2.6 | Documents/folders attached as **bounded text** (`MAX_INLINE_TEXT = 32768`, truncation flagged in the label) | `src/attachments.ts:36,8-9,44-48,148-150` | Nothing | Text attachments *can* travel today: `content: string` is exactly what the adapters accept | 2 (fallback path) | Medium — needs a size/format gate |

### P0-B — the transport decision (must be settled before Slice 2 code)

The donor's screenshot affordance is built on a native image-block channel that Cognate 0.6.4 does
not have. Three honest options:

- **(a) Bounded local attachment, text-only transport.** Paste → thumbnail in the composer → on send,
  persist the bytes into the session workspace and inline a text reference the agent can `read`.
  The composer states plainly that the image is *not* sent to the model as an image. Implementable
  entirely in this repo; no framework change.
- **(b) File upstream.** No user-visible feature lands in this mission; the split is real and belongs
  in a framework issue.
- **(c) Skip Slice 2**, deliver Slices 1/3/4 and document the gap.

Recommendation: **(a)**. It is the only option that both delivers a paste affordance and stays
honest, and it bounds the claim to exactly "the file is on disk and the agent is told where" — never
"the model saw your screenshot".

---

## 3. Compact approvals

| # | Donor mechanism | Donor cite | Workbench today | Delta | Slice | Risk |
|---|---|---|---|---|---|---|
| 3.1 | Approval bar sits **above the prompt, outside the transcript**; the transcript's approval slot is deliberately emptied (`// Approvals live in the bar above the prompt, not in the transcript.`) | `src/main.ts:1517-1518,1766` | Already matches: `ApprovalBar` renders in the composer dock and *replaces* it (`src/ui/App.tsx:5746-5747`), docked styling at `src/ui/app.css:1235-1240` | None | — | Zero |
| 3.2 | Long request text collapsed into a `details`-style expander; summary = first non-empty line, backticks stripped, clipped at **240** chars | `src/approval-bar.ts:10-13,20-29` | `ApprovalBar` prints justification inline and unclipped (`src/ui/App.tsx:2466-2472`); `SurfaceView` when a surface exists | Port clip + expander — but **never for surfaced approvals**: `SurfaceView` is structured diff content and must stay fully visible | 3 | Low |
| 3.3 | **≥2 pending** collapse to one line: `N approvals needed` + first summary + `and N-1 more`, with **Deny all / Approve all** | `src/approval-bar.ts:33-42`; `src/main.ts:1726,4874-4875` | Unreachable: `pendingApproval` is a single `.find()` (`src/ui/App.tsx:4766`) because the run's tool loop is sequential (invariant documented `src/ui/App.tsx:2291-2293`) | **Not reachable.** Porting the group UI would build a state the runtime cannot enter. | 3 (excluded) | — |
| 3.4 | Per-request busy guard: `pendingApprovals.has(key)` disables the buttons until the answer resolves, cleared in `finally` | `src/main.ts:1723,1728-1737`; `src/approval-bar.ts:16-17` | `decideApproval` awaits `resolveContinuation` with **no** busy guard (`src/ui/App.tsx:4758-4765`); a double-activation can fire two resumes | Real, small, worth fixing. Presentation/robustness only — no authorization change | 3 | Low |
| 3.5 | Busy is per-request, so one in-flight answer does not block answering a second | `src/main.ts:1730` | N/A (single pending, §3.3) | Drop | — | — |
| 3.6 | Approval *modes* (`ask`/`auto`/`review`/`plan`/`full`), unsupported modes refused rather than simulated | donor `docs/approvals.md:16-22`; refusal `:120-128` | Workbench has its own `PermissionMode` on the composer (`src/ui/App.tsx:3094-3096`) and gate in `agentCoding` | **Do not touch.** The mission scopes approval *presentation*. Authorization semantics are not a UX affordance. | — | — |
| 3.7 | Keyboard: Enter approves, Escape rejects on the focused bar | donor uses explicit buttons only | Already implemented, with autofocus: `src/ui/App.tsx:2443-2465` | None | — | Zero |

**Slice 3 is small**: 3.4 (busy guard) + 3.2 (long-text disclosure for non-surfaced approvals). Both
are presentation/robustness. 3.3 is *excluded with a reason*, not deferred.

---

## 4. Multi-message queue + steering

The largest delta. The donor has a real queue; the Workbench has **one** parked slot — but it
already owns a durable steering inbox the UI never uses.

| # | Donor mechanism | Donor cite | Workbench today | Delta | Slice | Risk |
|---|---|---|---|---|---|---|
| 4.1 | Queue is an ordered list: `position`, id, timestamps, attachments | `src/message-queue.ts:4-14` | `queued?: string` — a **single string** + `queuedRef` (`src/ui/App.tsx:3099,4617-4618`) | Replace the one-slot ref with an ordered array | 4 | Medium |
| 4.2 | Queue panel above composer: `Queued` + count + `Sends when the agent finishes` / `Sending next…` / hold label + Resume | `src/message-queue.ts:62-70` | One row: "Queued — sends when the current run finishes: …" + cancel (`src/ui/App.tsx:3153-3160`, `src/ui/app.css:812-826`) | Extend the existing row into a list; keep today's copy for the single-entry case | 4 | Low |
| 4.3 | Per-row actions: Steer, Send now, Edit, Move up, Move down, Remove | `src/message-queue.ts:43-59` | Remove (cancel) only | Port Steer + Edit + Remove; Send now / reorder optional | 4 | Medium |
| 4.4 | `HoldReason = restart\|failed\|stopped\|limited`, with Resume; `limited` hides Resume because the limit banner owns it | `src/message-queue.ts:16-22,62-70` | No holds. The dispatch effect fires only on `idle` (`src/ui/App.tsx:5160-5167`) | Holds require modelling run-failure/limit states the composer does not currently see. **Defer**; a failed run simply leaves the message queued. | 4 (minimal) | Medium |
| 4.5 | `⌘/Ctrl+Enter` steers; attachments or a team force a queue with explanatory copy; a refusal falls back to queue | `src/main.ts:1762,2522-2552` | `busySubmit` supports both behaviors; Steer writes `/steer/-` into run shared state (`src/ui/App.tsx:5136-5152`), drained at the next step boundary (`src/agents/agentCoding.ts:474-487`). Enter behaviour from `sendBehavior` (`src/settings.ts:110-113`) | Mechanism already correct — the donor queues on refusal rather than losing the text, and the Workbench's step-boundary drain achieves the same delivery without touching run control. Missing (now ported in slice 4): failure fallback and the keyboard affordance copy | 4 | Low |
| 4.6 | Steering lifecycle `pending → delivered → failed`, with "Not taken by the agent · moved to the queue" + requeue | `src/main.ts:2476-2520,2507-2513` | Optimistic single line: appends a `system` message "steering · sent to the running agent; it applies at the next step." (`src/ui/App.tsx:5143`) and **never observes whether it was consumed** | **Real gap.** `workbench.steer.consumed` is already emitted (`src/agents/agentCoding.ts:484`) and folded (`src/workbench/reducer.ts:183-188`) — the UI simply never reads it | 4 | Medium — but the plumbing exists |
| 4.7 | Durable queue persisted through native IPC, restored on restart | `src/message-queue.ts` + donor `queue_*` IPC | **Half-built and unsafe to wire**: `steer.enqueue` / `steer.pending` exist (`src/capabilities/workbench.ts:528-540`) with a reducer (`src/workbench/reducer.ts:178-188`) and tests (`test/workbench-steering.test.ts`) — but `mode:"queue-next"` routes to `inbox.nextTurn` (`src/workbench/steering.ts:47-52`), and **nothing in `src/` consumes `nextTurn`**. The agent reads only `pending.steer` = `nextStep` (`src/agents/agentCoding.ts:480`); `drainTurn` (`src/workbench/steering.ts:71`) is **called only from tests** | **Do not naively wire.** Repointing the composer at `steer.enqueue` without a `nextTurn` consumer would make queued messages durable *and undeliverable* — worse than today's ref, which sends on `idle` (`src/ui/App.tsx:5160-5167`). Blocked; tracked as plan T04b | 4 (blocked) | **High — known trap** |
| 4.8 | Steering injected as `[user steering] …` | donor native | `steeringReflection` (`src/workbench/steering.ts:122-135`), consumed at the step boundary (`src/agents/agentCoding.ts:485`) | None — already implemented and tested | — | Zero |
| 4.9 | Inline `<textarea>` queue edit with Cancel/Save | `src/message-queue.ts:44-47` | Nothing | Optional polish; skip unless Slice 4 lands cheaply | 4 (optional) | Low |

**Slice 4 shape.** Two deliverable halves, plus one blocked one: (i) the composer *queue* becomes
multi-entry with FIFO dispatch (in-memory — **not** durable, because of the `nextTurn` trap in 4.7);
(ii) *steering* gains an observed lifecycle by reading `workbench.steer.consumed` instead of asserting
that it "applies at the next step"; (iii) durability is **blocked** pending a real `nextTurn` consumer
(plan T04b). (i) and (ii) narrow the gap between what the UI claims and what the log records, which is
this codebase's own stated principle (`src/ui/workbench/UX.md` rule 9, Honesty).

**Slice 4 as built** (evidence: `evidence/T04/README.md`):

| # | Resolution |
|---|---|
| 4.1 | Done. `queued?: string` → `readonly QueuedMessage[]` (`src/steerQueue.ts`, `src/ui/App.tsx`). |
| 4.2 | Done, minus hold labels. Rows render numbered under `role="list"`; count and per-row actions as below. Hold labels deferred with 4.4. |
| 4.3 | Steer + Remove ported. Edit/Move up/Move down/Send now cut: Cancel and Steer are the actions with a delivery consequence; reorder is presentation only. |
| 4.4 | Still deferred, as planned. No hold reason exists, so an unexpectedly-ended run leaves messages queued with no explanation of why. Stated as a limit in the evidence. |
| 4.5 | Failure fallback added: a rejected steer is marked `rejected` (copy says the text is back in the composer) and the text is re-enqueued. Keyboard-affordance copy not ported. |
| 4.6 | **Gap closed.** The optimistic "it applies at the next step" line is gone (grep-verified absent from `src/`). Status is `pending → applied` on a matching `workbench.steer.consumed` id, credited via `ChatMessage.steerId`; run end settles still-pending attempts as not applied and returns their text. |
| 4.7 | Unchanged and still blocked — `nextTurn` has no consumer. The queue is explicitly in-memory this slice; `T04b`/`T04b-pre` hold the durable path. |
| 4.8 | Unchanged (already implemented). |
| 4.9 | Skipped, as the "optional" label allowed. |

---

## 5. What this mission should *not* port

| Thing | Why excluded |
|---|---|
| DOM capture/restore | React does it (§1.5, §1.6) |
| Auto-choreography of open cards | Second-order; needs §1 to exist first (§1.7) |
| Approval modes / permission policy | Authorization, not presentation (§3.6) |
| Approval group UI for ≥2 pending | Unreachable in a sequential tool loop (§3.3) |
| Turn-changes chip/tree | Workbench's review surface is already deeper (§1.9) |
| Native image blocks | Framework cannot carry them (§2.4) |
| Durable `queue-next` wiring | `nextTurn` has no consumer (§4.7) — would silently lose messages |
| Queue hold reasons | Needs run-failure/limit state the composer lacks (§4.4) |

## 6. Latent defect found while mapping

`steer.enqueue({mode:"queue-next"})` and `steer.pending().queued` form a **write-only channel**:
`inbox.nextTurn` is written, folded into the projection, returned to callers, unit-tested — and never
drained by any production code path. `drainTurn` (`src/workbench/steering.ts:71`) exists and is
exercised by `test/workbench-steering.test.ts:243-312`, yet `grep -rn 'drainTurn' src/` finds only its
own definition.

The project's own E2E journey encodes this as intended behaviour: `test/J-WB-steering.test.ts:55` asserts
that after the run completes, `nextTurn` still holds `["then write a changelog"]` ("Queue-next was not
consumed; it still waits for the next turn"). So the queue persists and is deliberately undelivered.
`drainStep` is orphaned the same way (`src/workbench/steering.ts:57`, referenced only by
`test/workbench-steering.test.ts`): production injects steer-now via `steer.pending` and then emits
`workbench.steer.consumed`, and the reducer prunes the queue by consumed id
(`src/workbench/reducer.ts:188`). The `drain*` helpers are therefore a *parallel unused API* rather than
the intended entry point — which is why T04b-pre must use the event-based path, not adopt `drainTurn`.

This is the kind of gap a passing test suite hides: the unit is correct, the wiring is absent, and one
journey test asserts the absence. Any future work that "uses the durable queue" must first supply the
missing consumer. Recorded in `.agents/DEBT.md`.

## 7. Test-infrastructure delta

Workbench: `bun:test`; 14 `test/*.tsx`, of which 11 assert **rendered static markup** via
`renderToStaticMarkup` (e.g. `test/ui-observability.test.tsx:1-20`), plus pure-logic `test/*.ts`
(`test/workbench-steering.test.ts`, `test/workbench-sidebar-view.test.ts`). Convention documented in
`src/ui/workbench/UX.md` "Code conventions": one component test per component, asserting visible
words, roles and aria attributes.

The donor tests the same ideas against a live DOM (`tests/tool-activity.test.mjs`). Every donor
assertion worth keeping (summary sentence, cap-5 grouping, boundary on narration) is expressible here
as a **pure-function** assertion — cheaper and stronger than the donor's DOM equivalent. Slice 1 thus
gets fast unit tests plus one static-markup test, and needs no DOM harness.




