# PandaCode donor recon — 0.3.56 @ ceed919

All citations are `file:line` in `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode`. Everything below is **OBSERVED** unless marked INFERRED.

---

## 1. Grouping + collapse

**Group key + max size.** `src/tool-activity.ts:88-98` — pure function; a run keeps the *first* call's stable key, hard cap 5, and any non-tool entry (narration, status, error) becomes its own `message` run and therefore a boundary:

```ts
export function groupToolRuns<T>(entries: T[], toolKey: (entry: T) => string | undefined): ToolRun<T>[] {
  for (const entry of entries) {
    const key = toolKey(entry);
    if (key === undefined) { runs.push({ kind: 'message', item: entry }); continue; }
    const previous = runs[runs.length - 1];
    if (previous?.kind === 'tools' && previous.items.length < 5) previous.items.push(entry);
    else runs.push({ kind: 'tools', key, items: [entry] });
```
- Boundary condition is pushed by the caller: `src/main.ts:1326` (saved) and `src/main.ts:1554` (live) return `undefined` for commentary/status, so narration splits groups. `src/overlay-thread.ts:237-243` does the same in the overlay.
- Live stream additionally injects a `null` split at the first `dispatch_workers` call so the worker-strip host sits mid-list (`src/main.ts:1553-1555`).

**Group summary sentence.** `src/tool-trace.ts:237-253` `summarizeTools(tools, {live})`:
- `src/tool-trace.ts:24-37` `KINDS` gives each kind `[runningVerb, doneVerb, icon, nounSingular, nounPlural]`.
- `src/tool-trace.ts:224-231` `summaryPart` re-maps MCP calls by action: an MCP search counts as `searches`, an MCP read counts as `sources` (`Ran 2 searches and read 3 sources`). `SUMMARY_VERB` (`:39`) makes `search`/`web` say "Ran".
- Counting merges by `verb:key` (`:240-245`), keeps **only 2 clauses** (`SUMMARY_CLAUSES = 2`, `:234`), remainder becomes `and N more steps` (`:251`), joined with `joinPhrases` (`, … and …`, `:218-220`).
- Tense: present participles only when `options.live && some(status==='running')` (`:238`), plus trailing `…` (`:252`).
- Failures: `failed` count appended as ` · N failed` (`:252`).
- `src/tool-activity.ts:105-113` `renderToolGroup` splits that string on `' · '` into `[sentence, failures]` and renders failures as a separate `.tool-group-status.has-failure` span; `failed` also puts an alert icon in the summary; `running` sets `data-running`; `data-tool-group-key="group:<firstKey>"`.

**Header mark stack.** `summaryIcons` (`src/tool-trace.ts:256-265`) — up to **3** distinct marks, brand SVG for MCP servers (`brandFor(mcpParts(name).server)`), else the kind's line icon; wrapped by `toolStackHtml` (`src/tool-activity.ts:101-103`).

**Per-tool row.** `describeTool` → `traceRowHtml`:
- `describeTool` (`src/tool-trace.ts:202-207`) = `toolKind(name)` + `describeFields(...)` + verb defaulting to the **done** verb (`KINDS[kind][1]`, e.g. "Ran"), deliberately so rows "read as finished sentences even while they run".
- `toolKind` (`:65-79`) regex-maps ~30 names to 12 kinds; `describeFields` (`:137-190`) builds `{chip, object, mono, added, removed}` per kind (shell → chip = basename of program, object = args; edit → diff line counts; mcp → brand chip + `Searched/Read the`).
- `traceRowHtml` (`:210-216`): `<span.tool-trace-verb>verb</span><span.tool-trace-chip>b</span><span.tool-trace-object><span.tool-trace-delta>+a −r`.
- Row container: `renderToolActivity` (`src/tool-activity.ts:57-67`) → `<details class="tool-activity tool-trace" data-tool-key data-tool-status data-tool-kind data-tool-name><summary>lead + traceRowHtml + chevron</summary><div class="tool-activity-body">card + rawRecord</div>`.
- `toolPreview` (`src/tool-trace.ts:481-492`): `richCard(tool)` (tool-cards.ts) first, else per-kind `previewBody` (`:457-478`) → shell/file/diff/search/web/fetch/todo/excerpt card; MCP uses `mcpCard` (`:446-455`, 3 rows + `+N more`) unless the server is PandaCode/docs (`richFirst`, `:488-492`).
- `rawRecord` (`src/tool-activity.ts:51-54`): input/output `<pre>`s live behind a `</>`-icon `<details class="tool-trace-raw">`, **open** when there is no card. `toolNote` (`:38-45`) supplies "Waiting for output…" / "No output was returned."

---


## 2. Expansion-state stability under streaming

Two layers: (a) live patching that never replaces the affected group's DOM; (b) a capture/restore pass around any full re-render.

**(a) Patch only the affected group — `src/main.ts:1544-1614` `paintLiveActivity`.** Keyed child reconciliation by `data-stream-key`:
- `src/main.ts:1547` builds `previous = Map(dataset.streamKey → node)` from existing children.
- `src/main.ts:1576-1590` is the crux — when the run's entries are unchanged the node is reused untouched; when they changed, only the two inner containers are replaced, and tool disclosure state is captured/restored around it:

```ts
} else if (!previousEntries || previousEntries.length !== run.items.length || run.items.some((entry, index) => entry !== previousEntries[index])) {
  const html = renderToolGroup(run.items, true, true);
  const views = captureTools(node);
  ...
  node.querySelector('.tool-group-summary')!.innerHTML = fresh.querySelector('.tool-group-summary')!.innerHTML;
  node.querySelector('.tool-group-body')!.innerHTML = fresh.querySelector('.tool-group-body')!.innerHTML;
  restoreTools(node, views);
```
- `liveGroupEntries` WeakMap (`src/main.ts:1542`, `:1591`) memoizes the exact `run.items` array identity used for the length/shallow-equality check.
- Reordering/removal is node-move only (`:1601-1604`: remove unretained, `insertBefore` to order) — no `innerHTML` of the host.
- Nodes are created from a `<template>` once (`:1579-1581`).

**(b) Save/restore native `details.open` — exact functions.**
| What | Capture | Restore |
|---|---|---|
| Tool row (`details[data-tool-key]`) incl. nested `.tool-trace-raw` + pre scroll/focus | `captureTools` `src/main.ts:1462-1474` | `restoreTools` `src/main.ts:1475-1487` |
| Tool **group** (`details.tool-group`) matched by key **or** by shared tool key | `captureToolGroups` `src/main.ts:1353-1359` | `restoreToolGroups` `src/main.ts:1360-1368` |
| Turn (`details.turn-activity`) | `captureTurns` `src/main.ts:1375-1377` | `restoreTurns` `src/main.ts:1387-1395` |
| Turn change cards (`details[data-change-key]`) | `captureChangeCards` `src/turn-changes.ts:53-55` | `restoreChangeCards` `src/turn-changes.ts:56-58` |

`captureTools` reads `open: tool.open, rawOpen: Boolean(tool.querySelector('.tool-trace-raw')?.open)` (`src/main.ts:1471`); `restoreTools` assigns `tool.open = view.open` and `raw.open = view.rawOpen` (`:1478-1480`) and restores per-control `scrollTop/scrollLeft` and focus (`:1481-1485`). Group restore additionally re-focuses the summary when it was focused (`:1366`). Matching is deliberately fuzzy: `views.find(view => view.key === group.dataset.toolGroupKey || view.toolKeys.some(key => keys.has(key)))` (`:1363`) — a group whose first key changed still gets its state back.

Call order in `renderTranscript` (`src/main.ts:1273` capture, `:1316-1320` restore): turns → (foldSavedTurn) → groups → change cards → tools → scroll anchor.

**(c) Auto-choreography that can override `.open` (`src/trace-motion.ts`).** Reader intent is pinned and beats the choreography:
- `src/trace-motion.ts:24-34` — a capture-phase click listener on `.live-activity details.tool-trace > summary` records the tool key into `pinned` per turn and deletes `data.auto`, so automated open/close stops touching it.
- `choreograph` (`:83-107`): keeps the **two** newest result cards open (`OPEN_CARDS = 2`, `:8`), collapses older ones, and `if (pinned.get(turnKey)?.has(key)) { delete tool.dataset.auto; continue; }` (`:100`).
- Groups the agent has narrated past fold once and are tagged `data-earlier` (`src/main.ts:1605-1612`), then never reopened; `readingTrace` (`trace-motion.ts:110-113`) keeps a turn open when the reader holds one of its tools; `foldTurn` (`:116-123`) clears `pinned`/`seen` for the turn.
- Live activity is bounded to 30 entries (`src/main.ts:769-779`) with the focused tool key and retained narrative explicitly protected from eviction.

**(d) The overlay variant** is a simpler whole-replace with the same idea: `src/overlay-thread.ts:236` snapshots `new Set([...activity.querySelectorAll('details[open]')].map(d => d.dataset.toolGroupKey ?? d.dataset.toolKey))`, re-renders `innerHTML`, then `:249` reassigns `detail.open`.

Native `outerHTML` is **not** used for these paths; `replaceChildren` appears only for unrelated panels (`src/main.ts:3155`, `:3256`, `:4078`).


## 3. Queue + steering

`src/chats.ts` is unrelated (projectless-chat folder regex, 7 lines). `src/agent-input.ts` is the structured question/form renderer, not the queue. The queue is **`src/message-queue.ts` (79 lines, pure renderer)** + state/actions in `src/main.ts`.

**Data structures.**
- `QueuedMessage` (`src/message-queue.ts:4-14`): `{id, sessionId, position, text, attachments: QueuedAttachment[], createdAt, updatedAt}`; attachments are `{kind:'path'|'image'|'document'|'folder'|'sketch', …}`.
- Client cache: `state.queues: Map<sessionId, QueuedMessage[]>`, `state.queueHolds: Map<sessionId, HoldReason>`, `state.queueEditing: string`, `state.queueBusy: Set<sessionId>`, `steeringQueued: Set<id>` (`src/main.ts:114`, `:2482`); helpers `queueOf`/`setQueue` (`:2439-2440`).
- `HoldReason = 'restart'|'failed'|'stopped'|'limited'` with copy in `HOLD_LABEL` (`src/message-queue.ts:16-22`).
- `sendFirst: Map<sessionId, {id, stopping?, hold?}>` (`src/main.ts:2438`) — the "send now" override that jumps the hold.
- Persistence is native IPC: `queue_add`, `queue_update`, `queue_remove`, `queue_reorder`, `queue_list`, `queue_take`, `queue_restore`, and a `queue-changed` subscription that re-lists (`src/main.ts:5014-5016`; preview stub `src/preview.ts:1063-1080`).

**Affordances** (`src/message-queue.ts:43-59`): index badge, one-line text (`.queue-text`, first line or `(attachments only)`), attachment count chip, then per-row buttons — `queue-steer` (spark, "Steer"), `queue-send-now` (arrow, "Send now"), `queue-edit`, `queue-up`, `queue-down` (rotated arrow), `queue-remove` (close). Edit swaps the row for a `<textarea class="queue-edit">` + Cancel/Save (`:45-48`). All buttons are disabled while `view.busy`.

**Send now vs steer — the distinction.** `queue-send-now` is shown when `view.sendable && !busy`; `queue-steer` only when `running && steerable && !busy && !attachments.length` (`:54-55`). Behind them (`src/main.ts:2571-2598`):
- `queue-steer` → `steerQueued` (`:2554-2563`): refuses if the entry has attachments ("Queued messages with attachments are sent after the run.") or a mirror is still starting; adds to `steeringQueued` so the row shows a spinner; entry leaves the queue **only after** the native `steer_task` resolves.
- `queue-send-now` → `sendQueuedNow` (`:2584-2598`): idle → `sendFirst` + `dispatchQueue`; running & steerable → fall through to `steerQueued`; otherwise it *stops* the run, records `sendFirst = {id, stopping:true, hold: previousHold}` and `runEndings = 'stopped'`, with `notify('Stopping the run to send this message…')`.
- Composer-level: `steerFromComposer` (`:2522-2552`) — attachments or a team ⇒ queue instead ("Attachments travel with queued messages, so this one was queued." / "A team takes messages between runs…"); remote-start pending ⇒ queue; `steer_task` refusal ⇒ `queue_add` and "… Queued instead."
- Keyboard: `⌘/Ctrl+Enter` steers (`placeholder: 'Queue a follow-up · ⌘↩ steers now'`, `src/main.ts:1762`; asserted in `tests/message-queue.spec.ts:57-59`).

**Status copy.** Queue header: `Queued` + count + either `Sends when the agent finishes` or `Sending next…` or the hold label + `Resume`/`Resume after this run` (`src/message-queue.ts:62-70`); `limited` hides Resume because the limit banner owns it. Delivery is a hard removal (`queue_take` then `setQueue(filter)`, `src/main.ts:2628-2629`), with `queue_restore` putting a failed send back at the front (`:2650-2658`).

**Steer lifecycle copy (`src/main.ts:2476-2520`).** `SteerStatus = 'pending' | 'delivered' | 'failed'`, `SteerMode = 'live' | 'next-turn'`. `steerStateHtml` renders under the pending user message: pending → spinner + `Steering…` (or `Sends when this turn ends` for `next-turn`); failed → `Not taken by the agent · moved to the queue` and `requeueSteer` re-adds it (`:2507-2513`).
- **There is no "superseded" or "consumed" state anywhere in the queue.** `consumed` appears only for attachments (`attachments.consume`) and `superseded` only for a stale remote mount (`src/main.ts:3161`). Delivered steers simply stop rendering (`status !== 'delivered'` filter, `:2516`).

---


## 4. Approval bar placement, busy state, multiple pending

**Placement.** `renderComposer` builds `#composer-area` then: `$('#composer-area').insertAdjacentHTML('afterbegin', '<div id="approval-bar"></div>')` (`src/main.ts:1765`, comment: "Approvals sit above everything that rides on the prompt, the context bar included"), and `queuePanel(...)` is inserted `beforebegin` of `#composer` (`:1766`). DOM order therefore is **approval bar → worktree/context bar → queue panel → composer**. The transcript's `.live-approvals` div is deliberately emptied: `// Approvals live in the bar above the prompt, not in the transcript.` (`src/main.ts:1517-1518`). Width/typography are locked to the prompt's (`src/approval-bar.css:1-2`).

**State holders.** `Stream.approvals: Map<requestId, text>` (`src/main.ts:97`), `pendingApprovals: Set<"sessionId+requestId">` (`:137`), `approvalGroupOpen` (`:1717`), `approvalDetails: Set<"sessionId+requestId">` (`:1718`).

**Busy.** `busy: id => pendingApprovals.has(sessionId + id)` (`:1723`). `respondApproval` guards re-entry (`if (!current?.approvals.has(id) || pendingApprovals.has(approvalKey)) return`), sets busy → re-renders (buttons get `disabled`, `src/approval-bar.ts:16-17`), then clears in `finally` with `renderStream(); renderNavigation(); renderApprovalBar()` (`src/main.ts:1728-1737`).

**Multiple pending.** 1 request = one line with Deny/Approve (`src/approval-bar.ts:33-36`). ≥2 = `is-group` line: `<strong>N approvals needed</strong>` + first summary + `and N-1 more`, with **Deny all / Approve all**; expanded shows one `row` per request (`:37-42`). Group expansion is client-local and resets when the list empties (`if (!approvals.length) approvalGroupOpen = false`, `src/main.ts:1726`); the toggle is `case 'approval-group'` (`:4875`) and bulk actions loop `respondApproval` over all keys (`:4874`). Long requests get a `details`-style expander: `approvalSummary` takes the first non-empty line, strips backticks, clips at 240 chars (`src/approval-bar.ts:10-13`), and `row` shows `<pre class="approval-full">` only when `more && open` (`:20-29`).

**Lifecycle (OBSERVED in code).**
1. `event.kind === 'approval'` → `approvals.set(requestId, text)`, `revision++`, status `Waiting for approval`, notify if the task isn't open (`src/main.ts:3035`).
2. Surface: bar renders for the **open** session only (`:1722`); other sessions surface as a nav "attention" dot (`:1058`) + notification.
3. User responds → `respond_approval` IPC, entry removed, `approvalDetails` cleared, status → `Continuing task` if it was the last one (`:1733-1735`).
4. Harness withdraws → `event.kind === 'approval_cancelled'` → delete + same status transition (`:3036-3037`).
5. Busy is per-request, so one in-flight answer does not block answering a second.

**docs/approvals.md is about *modes*, not per-request states** — the doc has no pending/approved/denied state machine. What it specifies:
- Four/five stored modes per harness: `ask` (Standard), `auto` (Accept edits / Codex agent-review / Kimi ask-when-needed), `review` (Approve for me — Claude `--permission-mode auto`; Codex N/A), `plan` (read-only / plan workflow), `full` (bypass) — table at `docs/approvals.md:16-22`.
- Mode is saved **with the task**; new tasks default to Full access; switching harness or applying a team profile preserves it; no migration of old tasks (`:3-9`). Workers, forks, and agent-created tasks inherit the parent's current mode; retrying a worker after a reduction uses the reduced mode (`:11-14`).
- Full access maps to explicit native flags per harness (`:28-36`); the UI never simulates acceptance by clicking pending buttons (`:42-44`); unsupported modes / failed policy changes **fail the turn** instead of silently continuing (`:45-48`).
- `review` on a harness that cannot represent it is shown disabled with a reason and `review_supported` in `providers.rs` refuses to start (`:120-128`).
- Plan mode is read-permissive / write-blocking, with per-harness detail (`:130-145`).

---


## 5. Tests

**`tests/tool-activity.test.mjs`** (8, `node:test`)
- `:12` decodes only bounded, versioned `tool_activity` records; rejects junk.
- `:27` renders command + recorded output under a stable `data-tool-key` disclosure.
- `:42` tool payloads/keys cannot inject HTML or delegated actions.
- `:50` legacy disclosures don't repeat their summary in the body.
- `:58` status events produce no empty disclosure; empty output is explained.
- `:68` failure says so once (icon + card badge); card-less record shows raw sections open.
- `:75` **groups at most five**, never crossing a narration or a status; keys are each run's first entry.
- `:90` group summary counts/tense (`Ran 1 command and read 1 file` vs `Running … and reading ……`), `· 1 failed`, mark stack, key escaping.

**`tests/tool-trace.test.mjs`** (6): `:8` verb/chip/object per kind; `:54` rows read as finished sentences while running; `:64` pluralisation, verb merging, running/failure reporting; `:85` MCP brand rows (+N more); `:116` preview prefers MCP card then rich card in shared chrome; `:139` escaping.

**`tests/turn-activity.test.mjs`** (12, `node:test`): `:11` coordination opens a separate turn; `:38` completed goal markers split turns; `:60` no invented changes on old history; `:70` user turn + ordered commentary/tools, final answer outside; `:93` legacy completion placeholders omitted, output preserved; `:110` normalized tools provide the stable turn key; `:118` partial page keeps an unanchored turn and doesn't borrow the next user's timestamp; `:134` failures stay outside collapsed activity and can end a timed turn; `:149` exact zero duration preserved, invalid timing falls back only to sane timestamps; `:174` empty/pending turns invent nothing; `:194` duration formatting + "about" estimate; `:205` assistant updates stay before trailing tools, only a trailing answer is final.

**`tests/message-queue.spec.ts`** (8, Playwright): `:37` queue during a run, edit, reorder, remove, and ⌘↩ steers; `:63` next message delivers on `done`, holds after `error`/restart; `:83` a rejected steer is queued; `:92` fast typing during a slow `queue_add` loses nothing; `:102` agent-queued follow-up for an idle task sends immediately; `:111` Send now delivers a held entry and keeps the rest held; `:125` Send now falls back to stopping the run and preserves order; `:140` Steer sends a queued entry into a steerable turn.

**`tests/steering.spec.ts`** (5): `:30` composer Steer shows pending → delivered; `:44` harness without live steering sends at turn end (`next-turn`); `:55` Steer on a queued row steers only that entry; `:65` Send now while running steers instead of stopping; `:76` an untaken steer returns to the queue with the `moved to the queue` state.

**`tests/turn-changes.spec.ts`** (14): `:63` one compact card per completed turn in conversation *and* board; `:90` card survives goal boundaries / delayed task loading; `:131` nested folders + immutable syntax-rendered diff with layout/theme controls; `:165` no changes ⇒ no card; `:178` legacy `attributed` missing/false ⇒ hidden; `:186` tracking limit adds no card; `:197` partial capture explains itself without implying failure; `:209` newest selected file wins over a late-resolving older detail; `:227` binary/truncated/unavailable states without inventing counts or executing markup; `:252` same read-only viewer for working-tree changes; `:265` completed workers show their own changed files.

**Approvals:** `tests/approval-modes.spec.ts` (`:19` Approve-for-me offered to Claude and kept with the task; `:35` shown unavailable rather than substituted on a harness without it; `:57` Plan-mode investigation copy). Note: **no dedicated test file exists for the approval *bar*** — bar behavior is only touched indirectly (`tests/ui.spec.ts`, `tests/architect.spec.ts`, `tests/concurrency.spec.ts` reference `approval`).

**Expansion stability under streaming:** `tests/streaming.spec.ts:121` "live tool activity stays open regardless of Settings and preserves manual disclosure choices during updates" (asserts 2 open live groups, a hand-opened step surviving new text *and* new tools, `:129-153`); `:228-309` narrated-past groups fold and saved turns honour `data-earlier`/selection. `tests/agent-traces.spec.ts:114` "leaves cards the reader toggled by hand alone, and stays open while one is read"; `:39` choreography replay (two newest cards open, folds to one summary).

---


## 6. Turn-changes summary

**Function:** `renderTurnChanges(sessionId, changes, runnable)` — `src/turn-changes.ts:38-45`. Renders nothing when `!count || !changes.attributed` (`:41`).

**Shape (one `<section class="turn-changes">`):**
1. `.turn-changes-actions` (floated/absolutely-positioned action cluster): a **Run** button (`data-action="run-project"`, `hidden` unless `runnable`) and an **Open diff** button (`data-action="open-turn-diff"`).
2. `<details class="turn-change-list" data-change-key="<changes.id>" open>` whose summary is the chip line: chevron + `<strong>N changed file(s)</strong>` + `changeCounts(additions, deletions)` (`+X` / `−Y`, or `—` when null, `:5-8`) + an optional `infoMark(notice)` plus `sr-only` notice text.
3. `<div class="turn-change-tree">` — a folder tree from `fileTree` (`:15-32`): `<details class="turn-change-folder" data-change-key="id:path">` per directory (chevron + folder icon + name + rolled-up counts), and a `<button class="turn-change-file" data-action="open-turn-diff" data-path>` per file with icon, basename, a one-letter status (`A`/`D`/`R`/`M`, `title` = full status) and either `Binary` or `+a −d`.

**Data it needs** (`src/types.ts:17-18`):
```ts
TurnChangeFile { path; oldPath?; status:'added'|'modified'|'deleted'|'renamed'; additions:number|null; deletions:number|null; binary?; truncated? }
TurnChanges    { attributed?; id; files[]; additions; deletions; truncated; concurrent; error?:string|null }
```
The whole object is also serialized into `data-changes` on the section (`:44`), which is how diff opening works without a re-fetch: `changeRequest` (`:47-51`) parses it back and `showTurnDiff` → `openSavedDiff(sessionId, changes, path)` (`src/main.ts:3474-3479`) loads stored patches lazily.

**Placement:** `changesRow` wraps it in `<div class="turn-changes-row">` and suppresses it for remote tasks (`src/main.ts:1262-1266`); it is emitted in `renderTranscript` after the turn's final message and before the worker slot (`src/main.ts:1298`). Notice copy (`:10-12`) covers `concurrent`, `truncated`, and `error`.

**Docs** (`docs/turn-changes.md`): appears in Conversation, Board task panel, and architect worker history (`:3-9`); only named writes captured, never Git status (`:16-27`); snapshots freeze at tool completion and patches are fetched only on open, never from the working tree (`:31-39`); limits 200 paths/turn, 1 MiB/file, 32 MiB captured, 256 KiB patch/file, 2 MiB/turn, 128 MiB patch budget (`:47-57`).

---
