# RECON REPORT — cognate-workbench, `src/ui/App.tsx` (5818 lines)

All citations are OBSERVED unless tagged INFERRED.

---

## 1. TOOL TIMELINE + TRANSCRIPT MODEL

### `ToolEntry` — `src/ui/App.tsx:160-168`
```ts
interface ToolEntry {
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "success" | "failed";
  readonly result?: unknown;
  readonly error?: string;
  readonly approval?: { readonly status: "pending" | "approved" | "denied"; readonly permission?: string; readonly justification?: string; readonly surface?: unknown };
}
```
- **No `at` / timestamp field on ToolEntry.** Time is not tracked per tool call at all; only `useElapsedSeconds` (2281-2289) gives a live per-run counter.
- `surface?: unknown` is consumed by `<SurfaceView>` inside `ApprovalBar` (2468).

### Per-turn snapshot type: `ChatMessage.steps` — `:157`
```ts
/** Snapshot of this turn's `useToolTimeline(activeRunId)` entries at finalize time ... */
readonly steps?: readonly ToolEntry[];
```
Doc comment (151-156) states it is **not persisted across reload/session-switch** — `session.history` returns only `stepCount`, so a reloaded turn loses per-step detail.

### `useToolTimeline` — `:2294-2342` (projection? events? → **events**)
```ts
function useToolTimeline(runId: string | undefined): readonly ToolEntry[] {
  const client = useCognate();
  const [entries, setEntries] = useState<readonly ToolEntry[]>([]);
  useEffect(() => {
    setEntries([]);
    if (!runId) return;
    const byId = new Map<string, ToolEntry>();
    const flush = () => setEntries([...byId.values()]);
    const unsubscribe = client.subscribe({ runId }, (event) => { ... });
    return unsubscribe;
  }, [client, runId]);
  return entries;
}
```
Fold rules (2304-2336), all OBSERVED:
- `tool.call.started` → insert `{toolCallId, tool, args: p.args ?? {}, status: "running"}`
- `tool.call.completed` → `{...prev, status:"success", result: p.result}`
- `tool.call.failed` → `{...prev, status:"failed", error: p.error}`
- `tool.approval.requested` → `{...prev, approval:{status:"pending", permission, justification, surface}}`
- `tool.approval.decided` → `{...prev, approval:{...prev.approval, status: approved?"approved":"denied"}}`

Ordering = `Map` insertion order, i.e. first-`started` order. Comment at 2291-2293: the loop is sequential so at most one entry is ever `"running"`.

**Answer:** the timeline is **purely an in-memory event-subscription fold over the live run** — no `useProjection`, no replay from a durable projection, no `afterPosition` (client subscribe default = live tail; `subscribe(options, listener)` at `node_modules/@godspeedai/cognate-client/src/*.ts:566` supports `afterPosition`, not used here). Consequence: on reload `runId` reattach yields an empty timeline until the next tool event.

Related derived helpers: `toolActionLabel` (2349-2365), `verboseStepLabel` (3208-3218), `AuthorityNotice` (3222-3238, filters `status==="failed"` + `error` matching `/blocked by authority/`).

---

## 2. MESSAGE STATE

### `ChatMessage` — `:120-158`
```ts
interface ChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly at?: string;
  readonly tookMs?: number;
  readonly failed?: boolean;
  readonly cancelled?: boolean;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly retryCount?: number;
  readonly editSummary?: EditSummary;
  readonly stepCount?: number;
  readonly streaming?: boolean;
  readonly steps?: readonly ToolEntry[];
}
```
Roles: `"user" | "assistant" | "system"` only.

### State holder — `:4699`
`const [transcript, setTranscript] = useState<readonly ChatMessage[]>([]);` (`activeRunId` at 4700.)

**Accumulation is append-only via function updater** — every writer:
| line | write |
|---|---|
| 4927-4938 | `openSession` → `setTranscript(history.map(...))` (replace, from `session.history`) |
| 4985 | `startNewSession` → `setTranscript([])` |
| 5105-5109 | `send` → append optional `system` plan notice + `{role:"user"}` |
| 5143 | steer → append `user` + `system` ("steering · sent…") |
| 5176 | turn completed → append `assistant` w/ `tookMs, editSummary, stepCount, steps` |
| 5182 | cancelled → append `assistant` w/ `cancelled:true, stepCount, steps` |
| 5189-5202 | failed → append `assistant` w/ `failed, retryCount, failureCode, failureMessage, stepCount, steps` |

```ts
// :5174-5176
const lastEdit = [...toolEntries].reverse().find((e) => e.tool === "edit" && e.status === "success");
const editSummary = lastEdit ? (lastEdit.result as EditSummary | undefined) : undefined;
setTranscript((prev) => [...prev, { role: "assistant", content: streaming.text, at, tookMs, editSummary, stepCount: toolEntries.length + 1, steps: toolEntries }]);
```
The settle effect is keyed `[streaming.status, streaming.text, streaming.retries, streaming.failure, toolEntries]` (5205) — i.e. it fires when status flips to terminal and then also sets `setActiveRunId(undefined)`.

**Tool entries are BOTH kept separate and snapshotted:**
- Live/current turn: `toolEntries = useToolTimeline(activeRunId)` (`:4753`) — separate, not attached to any message; consumed by `ToolActivity` (5714), `pendingApproval` (4766), `ComposerBar steps` (5735), `lastEdit` (5174).
- Settled turns: frozen copy in `ChatMessage.steps` at finalize (5176/5182/5200). Only `workDetails === "verbose"` renders it.

---

## 3. RENDER PATH (chat pane)

Block: `:5699-5717`.
```tsx
<div className="messages" aria-live="polite" aria-atomic="false" aria-relevant="additions text" style={{ "--cg-content-font-size": ... }}>
  {transcript.length === 0 && streaming.status === "idle" && <p className="empty-state">Start the conversation below.</p>}
  {transcript.map((message, index) => (
    <MessageBubble key={index} message={message} turnNumber={index + 1} onOpenReview={openReviewPanel} workDetails={workDetails} />
  ))}
  {streaming.status === "streaming" && (
    <>
      <MessageBubble message={{ role: "assistant", content: streaming.text, streaming: true }} elapsedSeconds={elapsedSeconds} />
      {streaming.retries.length > 0 && <RetryDisclosure retries={streaming.retries} elapsedSeconds={elapsedSeconds} />}
      <ToolActivity entries={toolEntries} elapsedSeconds={elapsedSeconds} workDetails={workDetails} />
    </>
  )}
</div>
```
Order: empty-state → historical `MessageBubble`s → (live bubble → `RetryDisclosure` → `ToolActivity`).

- **Streaming text** is a *separate, unappended* `MessageBubble` with `streaming:true` and no `steps`/`turnNumber`; it is replaced by an appended transcript message when the settle effect fires.
- `EditDiff` is **not** mounted at this level — it is nested inside `MessageBubble` (3332-3334) from `message.editSummary`.
- `ApprovalBar` / `GovernanceApprovalCard` / `AmbiguousStepCard` / `PlanReviewCard` / `Composer` are a **mutually exclusive if/else chain below the message list** (`:5746-5789`), i.e. the approval surface *replaces* the composer.
- Above the messages list: session header (`SubagentTree` 5660, `session-tabs` 5670-5679, `PresetMenu` 5680) and, below it, `WorldBanner` (5722), `TodoWidget` (5725), `ComposerBar` (5727-5741), `continuation-waiting` (5743), `SettlementCard` (5745).

### Memoization: **none**
- `rg 'memo\('` over `src/ui -g '*.tsx'` → **zero matches**; no `React.memo` anywhere in the UI.
- `MessageBubble` is keyed by array **index** (`key={index}`, 5708).
- `MessageBubble` is *defined but not exported/memoized* (3240 `function MessageBubble(`).
- `useMemo`/`useCallback` counts: 68 occurrences in App.tsx, all used for derived values/props (e.g. `availableReviewTabs` 4788, `sessionTurns` 5214, `sessionSteps` 5215), **not** to freeze message subtrees.
⇒ INFERRED: every streaming text delta (`setText` at 2246) re-renders all historical `MessageBubble`s, each re-running `renderMarkdown` (3329) and `dangerouslySetInnerHTML`.

---


## 4. `MessageBubble` — `:3240-3347`

Props (3240-3252): `message: ChatMessage`, `elapsedSeconds?: number`, `turnNumber?: number`, `onOpenReview?: (summary: EditSummary, turnNumber: number) => void`, `workDetails?: WorkDetailsMode`.

Three early-return branches, then the assistant branch:
- `role === "system"` (3255-3261): `<div className="message message-system" role="status">{message.content}</div>` — plain text, no markdown.
- `role === "user"` (3263-3277): `message-bubble` > `message-body` with `dangerouslySetInnerHTML={{__html: renderMarkdown(message.content)}}`, plus `message-meta` with a **non-wired** Copy button + `meta-time`.
- assistant (3279-3346), render order:
  1. `message-status-row` — either streaming pill + "Deep diving for Ns" (3281-3287) or status pill (`Worked`/`Failed`/`Stopped`) + `took-btn` (`Stopped` or `Took Ns`) (3288-3306).
  2. `RetryDisclosure` when `failed && retryCount !== undefined` (3307-3312).
  3. `message-divider` (3313).
  4. `verbose-step-list` `<ul aria-label="Tool call steps">` when `workDetails === "verbose" && message.steps` — one `<li>` per `verboseStepLabel(entry)`, failed rows get `verbose-step-failed` + `verbose-step-error` (3319-3328).
  5. `message-body` markdown (3329) + `<CodeBlocks containerRef={bodyRef}/>` (3330, copy/wrap header buttons, 3040-3052).
  6. `<AuthorityNotice steps={message.steps}/>` (3331).
  7. `EditDiff` when `message.editSummary && onOpenReview` (3332-3334).
  8. `FailureBlock` when `failed && failureMessage` (3335).
  9. `message-actions` (Copy + `at`) when `!failed && !streaming` (3336-3344).

**Markdown rendering** = `renderMarkdown` from `./markdown.ts` injected as raw HTML (no sanitizer visible at call site — INFERRED risk).

`EditDiff` — `:2653-2687`: a single `<button className="edit-diff-toggle edit-diff-card">` inside `.edit-diff`, showing an ext glyph (`TS`/`FileIcon`), `Edited <fileName>`, `+N -M`; `onClick → onOpenReview(summary, turnNumber)`. It opens `ReviewPanel` (`:2695`, mounted at 5793-5799).

---

## 5. `Composer` — `:3056-3203`

Props (3056-3104): `disabled`, `sending`, `modelLabel`, `planMode`, `onSend(message)`, `onStop`, `onTogglePlanMode`, `turns=0`, `steps=0`, `accessMode: PermissionMode`, `onAccessModeChange`, `sendBehavior: SendBehavior`, `onBusySubmit(message, behavior)`, `queued?: string`, `onCancelQueued?`, `focusToken?`.

Internal: `message` state (3105), `textareaRef` (3106), focus effect on `focusToken` (3107-3110), `submit()` (3111-3116), `busySubmit(behavior)` (3117-3125).

Structure / classes:
- `.composer-card` wrapper (3127)
- `<textarea>` (3128-3152): `aria-label` = planMode ? "describe your task to generate plan" : "Message or run a task, / commands, @ files or sessions"; `disabled`; tri-state placeholder (3132-3138); `onChange` only; `onKeyDown` (3141-3151) — Enter w/o Shift → if `sending` then `busySubmit(ctrl/meta ? flipped : sendBehavior)` else `submit()`. **No `onPaste`, no drop, no `onKeyDown` for `@`/`/` autocomplete.**
- **`queued` display** (3153-3162): `div.composer-queued role="status"` → `span.composer-queued-text[title]` "Queued — sends when the current run finishes: {queued}" + `button.icon-btn aria-label="Cancel queued message"` (×).
- `.composer-toolbar` (3163-3195): `SettingMenu` (access mode), conditional `.plan-mode-toggle` ("Plan"), `.composer-info-label` (model), `.composer-spacer`, then `.send-btn.stop` (`Stop generating`, StopIcon) when `sending` else `.send-btn` (`Send message`, SendIcon, disabled when empty).
- `.composer-stats` (3196-3200): `span.stat-chip` "{turns} turn(s) · {steps} step(s)".

### `sendBehavior` / `onBusySubmit` wiring
- Settings type: `SendBehavior` from `src/settings.ts:111`, default `"queue"` (`:113`), labels `:114`. UI picker at `App.tsx:1543` (`settings.changeSendBehavior`).
- App-level `busySubmit` (`:5136-5152`): `"steer"` → append `user` + `system` ("steering · sent to the running agent; it applies at the next step.") and `client.updateState(activeRunId, {patch:[{op:"add", path:"/steer/-", value:{id, text}}]})` — **does not cancel the run**; `"queue"` → `queuedRef.current = message; setQueuedMessage(message)`.
- Flush effect (5160-5167): when `streaming.status === "idle"` and a queued message exists → clear and `void send(queued)`. `cancelQueued` (5153-5156).

### Attachments — **nothing exists today**
`rg -n 'onPaste|type="file"|dataTransfer|accept=' src/ui -g '*.tsx'` → **no matches** (OBSERVED). No `<input type="file">`, no paste/drop handler, no attachment state in `Composer`. Wiring would need: a new state + `<input type="file" hidden>` or `onPaste`/`onDrop` on `.composer-card`, a chip row inside `.composer-card` before `.composer-toolbar`, and a widened `onSend` signature (today `onSend: (message: string) => void`, propagated to `send(message: string)` at `:5105-5119` which calls `client.startRun("agent.coding", {… message: messageWithFocus(message) …})`).

---

## 6. APPROVAL

### `ApprovalBar` — `:2441-2483`
```tsx
function ApprovalBar({ entry, onDecide }: { readonly entry: ToolEntry; readonly onDecide: (approved: boolean) => void }) {
```
- autofocuses via `ref.current?.focus()` on mount (2443-2445), `tabIndex={-1}`.
- keydown (2452-2460): **Enter → onDecide(true)**, **Escape → onDecide(false)**.
- DOM: `div.approval-card.surface-consequential[data-approval-panel]` → `.approval-header` (`.approval-dot` + `.approval-waiting` "Waiting for approval") → `.approval-details[role=group aria-label="Approval details"]` rendering `<SurfaceView surface={entry.approval?.surface}/>` when present, else the literal `Allow this operation with {permission} permissions: {justification}.` → `.approval-actions` with `.approval-btn.approval-reject` "Reject" and `.approval-btn.approval-allow` "Allow once".
- Shown content is driven entirely by `entry.approval` (status must already be `"pending"` to be selected).

### `GovernanceApprovalCard` — `src/ui/GovernanceApprovalCard.tsx:5-37` (whole file, 48 lines)
Props: `approvalId: string`, `capability?: string`, `busy: boolean`, `error?: string`, `onDecide(resolution: "approved"|"rejected")`.
Renders `<section className="experts-review" aria-label="Action awaiting SEA-Forge approval">`: `<h4>Action awaiting approval</h4>`, prose with capability, `<p className="settings-description">SEA-Forge approval <code>{approvalId}</code></p>`, `<div className="modal-actions">` Reject + `btn-primary` (label `busy ? "Recording…" : "Approve"`), and `<p role="alert">{error}</p>`.
Helper `governanceApprovalOf` (`:40-48`) extracts `{approvalId, capability}` from a `governance-approval` continuation (`condition.approvalId`, then `payload|condition .capability`).

**Difference:** `ApprovalBar` = Workbench-side *tool* approval (`tool-approval` continuation, live `ToolEntry`); `GovernanceApprovalCard` = external SEA-Forge authority escalation (action **has not run**), no keyboard shortcuts, no surface view.

### Mount points
- `ApprovalBar` — `:5746-5747`, first branch of the bottom-slot chain:
```tsx
{pendingApproval ? (
  <ApprovalBar entry={pendingApproval} onDecide={(approved) => decideApproval(pendingApproval.toolCallId, approved)} />
) : governanceApproval ? (<GovernanceApprovalCard … />) : ambiguousContinuation ? (<AmbiguousStepCard …/>) : planReviewContinuation ? (<PlanReviewCard …/>) : (<Composer … />)}
```
`pendingApproval` computed at `:4766`: `toolEntries.find((e) => e.approval?.status === "pending")`.
- `GovernanceApprovalCard` — `:5748-5755`, second branch (`governanceContinuation` at 4829, `governanceApproval` at 4830).
- `GovernancePane` — mounted **only inside the Settings modal**, `:1952` (`<GovernancePane workspaceId={workspaceId} />` under `section === "governance"`, "Governance & evidence"). It is a settings pane (authority mode / settlement / proof), *not* an approval surface. `experts-review` class lives in `src/ui/experts/experts.css` (INFERRED — same class name; not verified by grep).

### `decideApproval` — `:4758-4765`
```ts
const decideApproval = useCallback(async (_toolCallId: string, approved: boolean) => {
  const continuation = openContinuations.find((c) => c.type === "tool-approval");
  if (!continuation) return;
  await resolveContinuation(continuation.id, "resume", { approved });
}, [openContinuations, resolveContinuation]);
```
- **`toolCallId` is ignored** (`_toolCallId`) — it relies on the "one open `tool-approval` continuation per run" invariant (comment 4756-4757).
- Runtime call: `client.resolveContinuation(id, "resume", { approved })` (`@godspeedai/cognate-react` `:308-318`).
- `openContinuations`/`resolveContinuation` come from `useContinuations(activeRunId)` (`:4754`), which is `useRun(runId).openContinuations` (`cognate-react/src/index.tsx:308-318`).
- `decideGovernance` (`:4833-4847`) instead calls `client.invoke("governance.approval.resolve", { approvalId, resolution })` with local `governanceBusy`/`governanceError`.

---

## 7. STATE HOOKS

`@godspeedai/cognate-react` import — `App.tsx:4`
```ts
import { useCognate, useContinuations, useProjection } from "@godspeedai/cognate-react";
```

| hook | occurrences (App.tsx) |
|---|---|
| `useCognate()` | 321, 588, 599, 1320, 1429, 1685, 2214, 2295, 3499, 3570, 3880, 4249, 4575 (App root) |
| `useProjection(name)` | 194 `workspaces`, 200 `workspaces`, 208 `sessions`, 232 `session-task-bindings` \| `sessions`, 242 `plans`, 266 `subagents`, 278 `plans`, 290 `model-config`, 303 `settings`, 322 `settings`, 365 `onboarding`, 4033 `session-trace`, 4582 `cognitive` |
| `useContinuations(runId)` | 4754 (also in `SettlementCard`/`GovernancePane` via their own imports) |

Package also exports `useRun/useAgent/useSharedState/useCapability/useArtifact/useConnectionStatus` (`cognate-react/src/index.tsx:153-353`) — **unused** in App.tsx.

**Pattern (OBSERVED):**
- Read side = `useProjection(<name>)` → `useSyncExternalStore` over a memoized projection store (`cognate-react/src/index.tsx:218-224`), then narrow with `useMemo` (`useWorkspaces` 199-205, `useSessions` 207-216, `usePlanState` 241-248, `useSubagents` 265, `useModelConfig` 289, `useGeneralSettings` 302).
- Run/stream side = **imperative `client.subscribe({runId}, …)` inside `useEffect` + `useState`**, not a projection: `useStreamingTurn` (2213-2277), `useToolTimeline` (2294-2342).
- Continuations = `useContinuations(activeRunId)` (4754). No `useEvents`/`useState` (cognate) hook is used; the App's own React state is plain `useState` (`transcript` 4699, `activeRunId` 4700, `activeSessionId` 4698, `queuedMessage` 4617, etc.).

---

## 8. CSS

Single stylesheet for all chat/composer/approval classes: **`src/ui/app.css`** (3307 lines). (`experts.css`, and `workbench/*.css` do not define the classes below — verified by `rg -l` per class.)

| Component | Classes (definition line in app.css) |
|---|---|
| `Composer` (3056-3203) | `.composer-card` 1666, `.composer-card textarea` 1680 / `:focus-visible` 1691 / `::placeholder` 1695, `.composer-queued` 812, `.composer-queued-text` 822, `.composer-toolbar` 1699 (+ media query 2373), `.composer-info-label` 1706 (shares rule w/ `.dropdown-btn`), `.composer-spacer` ~1735, `.send-btn` ~1738 / `.send-btn:disabled` / `.send-btn.stop`, `.composer-stats` 1755, `.stat-chip`, `.plan-mode-toggle`, `.icon-btn` |
| `ToolActivity` (2371-2396) | `.tool-activity` 1204, `.tool-activity-btn` 1211, `.status-pill` 1115, `.status-pill.status-active` 1132, `.sr-only` |
| `MessageBubble` (3240-3347) | `.message`, `.message-user`, `.message-assistant`, `.message-system`, `.message-failed` 1172, `.message-bubble` 1062 (+ `.message-bubble .message-body :is(p,li)` 1069), `.message-body` 1179-1189 (+ `pre.code-block` 1602, `.wrap-lines` 1614, `:not(pre) > code` 1656), `.message-status-row` 1105, `.status-pill` 1115 / `.status-streaming` 1123 / `.status-cancelled` 1138, `.took-btn` 1158, `.message-divider`, `.message-actions` 1189, `.cancelled-tag` 1196, `.meta-action` 1085-1105, `.meta-time`, `.verbose-step-list` 706 (+ `.verbose-step-failed`), `.authority-notice`, `.failure-block` |
| `EditDiff` (2653-2687) | `.edit-diff`, `.edit-diff-toggle`, `.edit-diff-card`, `.edit-diff-icon` (`[data-ext]`), `.edit-diff-info`, `.edit-diff-heading`, `.edit-diff-stat` |
| `ApprovalBar` (2441-2483) | `.approval-card` 1235 (docked at composer slot; shared positioning comment at 752), `.surface-consequential` 1221-1225, `.approval-header` 1242, `.approval-dot`, `.approval-waiting`, `.approval-details` 1265, `.approval-actions` 1271, `.approval-btn` 1278, `.approval-btn.approval-allow` 1285, `.approval-btn.approval-reject` 1291 |
| `GovernanceApprovalCard` | `.experts-review`, `.settings-description` (700), `.modal-actions`, `.btn-primary` — `experts-review` presumably in `src/ui/experts/experts.css` (INFERRED, not verified) |
| `RetryDisclosure` / `FailureBlock` | `.retry-disclosure`, `.retry-disclosure-btn`, `.retry-list`, `.failure-title`, `.failure-message`, `.failure-code` |

---

## Notable gaps found incidentally (not fixed, not investigated)

1. `App.tsx:4758` — `decideApproval` takes `_toolCallId` and ignores it; correctness depends on the "single open `tool-approval` continuation" invariant.
2. `App.tsx:2294-2342` — `useToolTimeline` subscribes live only (no `afterPosition`), so a reloaded in-flight run shows an empty timeline / no `pendingApproval` until the next tool event; consistent with the `docs/known-gaps.md` note at 154-156.
3. `App.tsx:5708` — `MessageBubble key={index}` + no `React.memo` anywhere in `src/ui` ⇒ full-history markdown re-render per stream delta.
4. `App.tsx:3270-3272` and `3339-3341` — user/assistant "Copy" `meta-action` buttons have no `onClick`.
5. `App.tsx:3153-3162` — `queued` display has no attachment/multi-item representation; `Composer` has zero file-input/paste handling.

Counts: 0 commands edited any file.

