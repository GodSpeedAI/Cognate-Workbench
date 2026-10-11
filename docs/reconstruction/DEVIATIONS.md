# Deviations from the pinned DeepSeek Harness reference (tranche T5b)

> **Note (2026-09-27):** the entries below describe divergence up through the settled
> reconstruction. From this point forward the app's *visual* identity is deliberately diverging
> further under an independent Hallmark/Impeccable redesign — see
> `.agents/evidence/2026-09-27-deepseek-harness-redesign-decision.md` and the new `DESIGN.md` this
> redesign introduces. New visual divergence is a product decision recorded in `DESIGN.md`, not a
> tranche deviation to log here; this file remains the record of *behavioral*/structural deviations.

This file records every place the Cognate reconstruction's UI is intentionally different from, or
inert relative to, the pinned reference — either because the underlying feature is out of scope
for this tranche, or because reproducing the reference exactly would mean copying DeepSeek's own
content/branding. Structural parity is still intentional: every control listed below is present in
the DOM/aria tree with the reference's accessible name, just disabled (`title="Not implemented in
this tranche — see APP/DEVIATIONS.md"`), so `tests/visual/compare.ts` diffs are content differences,
not missing-control differences. See `diffs/summary.md` for the measured per-checkpoint pixel-diff
evidence this file explains.

## First-run dialog pair (fixed — critic round-1 P0-1)

A Cognate-branded "Internal Testing Notice" dialog (heading + two paragraphs + "Continue") and an
"Add an API key to get started" dialog ("Configure later"/"Save and continue", disabled until a key
is entered) now appear on a fresh `COGNATE_HARNESS_HOME`, matching the reference's structure/roles
with Cognate's own wording (not DeepSeek's copy — see the spec's brand-substitution allowance).
Dismissal is durable per-home: `onboarding.dismiss` (`src/capabilities/onboardingDismiss.ts`) records
an `onboarding.dismissed` event via `agent.config`, folded by the `onboarding` projection
(`src/projections/onboarding.ts`); absence of a dismissal row is what makes the pair reappear on a
fresh home. "Save and continue" dismisses the apikey step the same as "Configure later" — this
tranche has no default/preset provider to key-only configure (no DeepSeek-branded "official"
provider), so the entered key is not persisted from this dialog; full provider setup happens in
Settings → Models afterward. This was not an observed reference behavior for this specific case — an
assumption, not a reproduction.

## Settings > Models provider list + add-provider wizard (fixed — critic round-1 P0-4/P1-4)

`SettingsModels` (`src/ui/App.tsx`) now has a provider-list view (a card for the configured
provider, or an empty state, plus "+ Add model provider") and a two-tab "Add model provider" wizard
("Third-party model provider" / "Custom model API"), matching the reference's structure and button
labels (list view: Cancel/Apply on the API-key row; wizard: Cancel/Create provider) — checkpoints
02/02b/02c/02d. The "Third-party model provider" tab's combobox is a small, original list of generic
OpenAI-compatible provider presets (OpenAI, OpenRouter, Azure OpenAI, Groq, Mistral, Together AI,
Fireworks) — deliberately not a copy of the reference's ~35-entry DeepSeek-branded provider list;
picking one pre-fills the Custom model API tab's fields. This tranche's backend (`model.configure`)
still only ever holds one live provider config (the `model-config` projection's single `"current"`
row), so: "Edit" reopens the wizard prefilled from that config; "Delete" is present with the
reference's accessible-name pattern but disabled (no backend "unconfigure" capability this tranche —
same "control present, feature stubbed" pattern used throughout this app); the Models sub-list
supports multiple rows in the UI (Add model, per-row Model ID/display name, the P0-4 validation rule)
but only the first row is actually wired through to `model.configure`'s single `model` field;
"Fetch available models" is present (disabled until Base URL is set) but disabled outright — no live
provider introspection capability exists this tranche. The write-only API key contract is unchanged:
reopening Edit never shows the plaintext key back, only a "Configured — enter a new value to replace"
placeholder (checkpoint 02d). An "Open configuration file" link is present in the titlebar (critic
round-1 P1-1), disabled — no OS file-reveal capability this tranche.

## Settings General / Built-in plugins / Agent presets — inert nav items

Present in the Settings left nav with the reference's exact labels (aria: `button "General"`,
`"Models"`, `"Built-in plugins"`, `"Agent presets"`). `Built-in plugins`/`Agent presets` remain
disabled stubs. `General` is now live (critic round-2 batch A cross-cutting P2): it holds the
Appearance section (`Light`/`Dark` theme buttons) that used to be a persistent sidebar footer
control with no reference counterpart — the reference switches theme via Settings → General →
Appearance (`tests/capture/reference.capture.ts`'s `20-theme-variant` step), not a standing sidebar
toggle, so the sidebar control was removed and the switch moved here to match.

## Sidebar "Plugins" global panel — inert

`nav[aria-label="Global panels"] > button[aria-label="Plugins"]` is present and disabled. No plugin
system in this tranche.

## Session header actions — inert

"Open in Files", "More ways to open", "More actions" (`…`), and "Open right sidebar" are present
with the reference's accessible names but disabled — no file-open integration, no right sidebar/
inspector panel in this tranche.

## Trajectory tab — inert

`tablist` has both `tab "Chat"` (selected, functional) and `tab "Trajectory"` (present, disabled).
No trajectory/step-inspector view in this tranche.

## Message action row — Good/Bad response, Branch, Usage are inert or static

Copy (functional, uses `navigator.clipboard`), Good response / Bad response / Branch into a new
conversation are present with the reference's accessible names but disabled — no feedback or
conversation-branching backend in this tranche. "Usage 0 tok" is a static placeholder chip (no
token-usage accounting is computed).

## Composer permission-mode and model dropdowns — inert, single-value

> **Usage pass U2 update:** the access-mode dropdown is now **functional** — a per-session control
> (the composer's `SettingMenu`, aria-label `Access mode, current: <label>`) whose value rides each
> turn into `AgentCodingInput.mode` → `approvalGate`, seeded from the durable Settings → General →
> Permission default for new sessions (hero composer: a pending choice consumed by the
> session-creating send). The `sessions` projection folds the last run's mode back
> (`session.turn.started`'s `mode` field), so it restores after a reload. A run with NO mode still
> fails closed to `read-only` (the J-D contract, unchanged). The **model** dropdown remains a
> single-value label: `model.configure` still holds exactly one live provider config.

(Pre-U2 this entry read: both dropdowns present with the reference's accessible-name pattern but
disabled — one implicit access mode, one configured model, nothing to switch between.)

## Settings → General inventory (usage pass U2, reference-behavior-matrix.md §11)

The full §11 inventory is implemented — Permission (with the Full-access confirmation dialog,
checkpoint 22f), Language, Appearance (Light/Dark/System), Font size (1px stepper, floor 12),
Work details, Performance & usage, Coding Tools, Keyboard shortcuts (dialog), Send behavior while
busy — each a durable `settings.change*` capability writing its own field into the `settings`
projection's merged "current" row (`test/J-SET-settings.test.ts` proves all fields survive a full
runtime restart). Intentional deviations within it:

- **Language is display-only persistence.** 中文 is selectable and durable, but the app has no
  i18n strings — every other surface stays English. The reference actually re-languages its UI.
- **Appearance's "System"** follows `prefers-color-scheme` live; the pre-U2
  `localStorage["cognate.theme"]` value seeds `appearance` until the first explicit durable choice.
- **Font size ceiling is 32px** (this app's own sane bound — the reference's ceiling was never
  characterized; its floor 12 is reproduced exactly). Applies to conversation content only
  (`.messages` inherits `--cg-content-font-size`); chrome keeps fixed sizes.
- **Keyboard shortcuts**: the dialog lists this app's real actions/bindings only (4 editable +
  3 fixed regions) — not the reference's 17-action Application list. "Open keyboard shortcuts
  Ctrl /" is the one real binding; per-action Edit buttons and "Restore all defaults" are inert
  (`NOT_IMPLEMENTED`).
- **Send behavior — Queue is real, Steer is real but coarser than the reference's.** While a run
  streams, the composer stays typeable: Enter performs the configured behavior (Queue parks the
  message — a "Queued" chip shows it and it dispatches when the run settles; Steer cancels the run
  and sends immediately), and Cmd/Ctrl+Enter performs the other behavior. The reference's exact
  Steer semantics (mid-stream steering of the running generation, if richer than interrupt+resend)
  were not characterized; this app's Steer is cancel-then-send. The send *button* position still
  shows Stop while streaming (this app's own stop affordance), so busy-sends go through Enter —
  the reference's "Enter and the Send button" wording is not reproduced literally.
- **Coding Tools** is durable and gates nothing yet — the Trajectory surface it exists to expose
  lands with the developer-tools tranche (usage plan U5); until then its only observable effect is
  the persisted value (same as the reference's setting being meaningful only with a tab strip).
- **The General pane footer** shows this app's own version constant, not the reference's.

## Sidebar Workspaces section (usage pass U3, reference-behavior-matrix.md §12)

The full multi-workspace sidebar is implemented: every `workspace.added` record renders as its own
expandable treeitem with its sessions nested (no longer just the current workspace's), the header
gains Search sessions (live title filter + Clear), View options, and Add workspace, the
composer-area workspace pill became a functional "Choose workspace" dropdown (added workspaces +
"Add workspace…"), and each workspace row has hover actions — "New session in <name>" (idempotent
re-select + fresh session) and a "Workspace actions" menu with Rename and Delete workspace
(durable `workspace.rename` / `workspace.delete` → `agent.config` events → the `workspaces`
projection; deleting the active workspace clears the current pointer and drops the app back to the
no-workspace chooser). `test/J-WS2-multi-workspace.test.ts` proves the durable behavior including a
full-runtime-restart. Intentional deviations:

- **Add workspace is a path-input dialog**, not the reference's full directory-browser
  (`dialog "Select Workspace Directory"` with breadcrumb/home/new-folder/hidden-files) — out of
  scope this pass, consistent with the app's pre-U3 chooser; the structural entry points (sidebar
  button + hero "Add workspace…") match the reference.
- **View options**: Group by "Workspace Tree" and "In one list" are real; "WorkSpace" (the
  reference's distinction from Workspace Tree was never characterized beyond the label) and both
  "Filter sessions" items (no archive feature exists) are present but inert (`NOT_IMPLEMENTED`).
  Order by "Manual" (projection order) and "Last updated" are real.
- **Delete workspace has no confirmation dialog** — the reference's menu item deletes directly
  (as observed, §12); this app matches that. Sessions of a deleted workspace stay in the event
  log; only the sidebar group disappears.
- The workspace treeitem expands/collapses per the local UI state (the reference's expansion
  behavior was not characterized in detail).

## Built-in plugins + Agent presets (usage pass U4, reference-behavior-matrix.md §14–15)

- **Built-in plugins is an inspect-only inventory of this app's own plugins** — Session plugins =
  the model-facing tool catalog an agent preset composes (`agentCoding.ts`'s `PRESET_TOOLS` is the
  single source of truth), Global plugins = the always-on capabilities (provider hot-swap, session
  history, workspace scoping, approvals, preferences) plus RealityTrace observations. **Usage pass
  U7 gives the RealityTrace switch real behavior** — the one enable/disable toggle of a real
  capability: it writes durable per-plugin state (`settings.changePlugin` → `settings.changed` →
  the `settings` projection's `plugins` map, merged per key, default disabled, restart-surviving —
  `test/J-PLG-toggle.test.ts`), and the observation drain gate reads that same fold per cycle
  (off ⇒ observations stay queued; on ⇒ the backlog delivers, at-least-once). Every other switch
  stays inert (`NOT_IMPLEMENTED` / "Not configured this build"): the remaining global plugins are
  always-on compositions with nothing to toggle, and no plugin-install backend exists (Refresh /
  Add plugin / View stay inert too).
- **Agent presets: three of the reference's four.** Standard/PTC/Minimal are real and behavioral —
  a preset scopes the turn's model-facing tool catalog (`PRESET_TOOLS`), the composer sends the
  per-session choice (`AgentCodingInput.preset`), the Settings default (`settings.changePreset`)
  seeds NEW sessions, and the `sessions` projection folds the last run's preset into the row's
  `mode` badge (replacing the approval-derived sticky "ptc" as the primary source; that sticky
  fold remains the fallback for direct-API runs without a preset). A model call for a tool outside
  the preset fails closed with the reference's own wording (`Error: unknown tool "run_code"` —
  §6.2), proven by `test/J-PLG-panels.test.ts`. **Creator mode is out of scope** (it customizes
  the harness through conversation — no equivalent surface here); the "Mode details"/"View
  configuration" dialogs show this app's own copy and its real per-preset tool composition, not
  the reference's plugin YAML.
- A run WITHOUT a preset (direct `startRun` calls, all pre-U4 tests) keeps the FULL tool catalog —
  the preset scope applies only where the composer/UI contract sends one.

## Trajectory tab — developer tools (usage pass U5, reference-behavior-matrix.md §13)

The session header gains the Chat/Trajectory tab strip (gated on the Coding Tools setting), a
role-badged trace table (USER rows; one ASSISTANT "Request #N" row per recorded `model.generate`
invocation; TOOL rows `tool{args} → result` with mono args), a Collapse-turns toggle + live
"Search trajectory" filter, and the right-hand "Event details" panel (TOOL:
Summary/Payload/Result/Schema/Timing; Request: Summary/Options/Timing). Data source: the public
`session-trace` projection (`src/projections/sessionTrace.ts`) folding the session's own durable
events — live during a run via the usual `useProjection` subscription, byte-stable after a reload
or a full runtime restart (`test/J-T-trajectory.test.ts` proves the restart). Intentional
deviations:

- **No SYSTEM/CONTEXT rows.** This app sends no system prompt and no runtime-context snapshot, so
  the trace honestly has no such rows (the reference's rows show its agent's own prompt
  construction). The row-kind vocabulary is the same; the rows that don't apply simply don't occur.
- **Timeline strip + toolbar realized (usage pass U7).** The reference's `region "Trajectory
  timeline"` now renders as three labeled lanes (Input / Model / Tools) with segments positioned
  from the events' own timestamps (blue user / violet model / amber tools — this app's palette,
  not the reference's), and the toolbar carries the reference's three toggles + search: `Use
  actual duration` (renders event-derived durations on rows), `Collapse turns` / `Expand turns`,
  and `Collapse calls` / `Expand calls` (folds a turn's tool rows into a "Collapsed calls, N tool
  calls" line). The Event details header gained the reference's `· Step N` and the Timing tab
  gained `Timing source: Session timestamps`. Still approximated: the timeline is a proportional
  layout (the reference's exact segment geometry was not measured), the details' Payload/Schema
  render formatted JSON rather than the expandable tree widget, request "Usage" (tokens) stays
  unreproduced (no token accounting exists — same honest-zero policy), and "Hierarchy → Assistant
  Message" remains a no-op button.
- **Event details' Payload/Schema render formatted JSON**, not the reference's expandable JSON
 *tree* widget; Schema comes from this app's own `TOOL_DEFS` entry (the same catalog the preset
 scopes), not the reference's tool docs. Request "Usage" is folded into the request's Summary
 (Status/Tool calls/Result) — no token accounting exists (same honest-zero policy as the composer
 footer), so the reference's separate Usage tab is not reproduced.
- **"Hierarchy → Assistant Message"** is present on the TOOL Summary but is currently a no-op
  button (the parent request jump is unimplemented).
- The trace includes failed tool calls (status Failed with the error text) and runs' failed model
  requests (`run.invocation` failures render as failed Request rows with the failure message).

## RealityTrace enrichment (usage pass U6, Option A — operator decision 2026-09-29)

The trace stays Cognate's (the `session-trace` projection over the authoritative event log);
RealityTrace adds the evidence layer. Trace-worthy events (`tool.call.started/completed/failed`,
`message.completed`, `run.failed`) get an observation intent committed atomically with the event
via the runtime's generic `outboxFor` hook — no runtime dependency on RealityTrace — and an
`ObservationDelivery` drains them at-least-once in the background to the pinned SXR CLI v0.3.0
(`just setup-realitytrace`; overridable via `SXR_BIN`). **Usage pass U7: the drain is gated by the
durable RealityTrace plugin state** (`settings.changePlugin`; default disabled, so a fresh home
queues observations until the plugin is enabled — journeys that exercise delivery enable it first,
see `test/J-RT-realitytrace.test.ts`). The Event details panel gains a
RealityTrace tab: per-event receipt state, observation id, SXR ledger position, attempts, and the
"View SXR record" drill-down (the CEP `extensions.cognate` correlation payload, via the port's
`readCorrelation`). `test/J-RT-realitytrace.test.ts` proves accepted receipts + ledger positions +
the drill-down against the REAL binary, and the Option A invariant: without the binary the harness
runs unchanged (the read side stays mounted and reports honest `queued` states; the trace folds
normally). Notes:

- **The read capabilities (`observation.status` / `observation.record`) are client-invoke and
  unrecorded** — receipts live in the DurableStore `observations` collection, not the event log,
  so a projection never sees them (and the capability's own invocation must not either). They are
  deliberately unbound in `.sea` (the `onboarding.dismiss` precedent — a diagnostic read, not a
  domain capability; see BINDINGS.md).
- **No pending/retrying surface in the UI yet beyond the state string** — the tab shows
  queued/retrying/failed/accepted as text with attempts; a richer reconciliation view is out of
  scope this pass.
- **SXR ingest is a subprocess pair per observation** (plan create + ingest), so a busy session's
  deliveries trail the run by seconds; the tab's states make that lag visible rather than hiding
  it.

## Composer stats footer — static

"`N turns N steps · N tok/s`" and "`N% of context used`" are present in the reference's position and
wording pattern but always render `0 turns 0 steps · 0 tok/s` / `0% of context used` — no
turn/step/token/context accounting is implemented. Wiring this to real per-run counts is a backend
change; tracked here rather than done silently.

## Session title source (fixed — critic round-1 P0-3)

Confirmed against `reference/observations/aria/06-user-message.desktop.txt` and
`08-tool-running.desktop.txt` (not just the *completed*-session dump this tranche originally checked):
the reference's sidebar session-tree label is the literal first **human message** text, verbatim
(truncated), set at the moment the turn starts — not the assistant's answer, and not delayed until
the run completes. `src/projections/sessions.ts` now sets the title from `session.turn.started`'s
message text immediately, and `message.completed` no longer overwrites it. Tests
`J-B-basic-session.test.ts` and `J-G-persistence.test.ts` were updated accordingly. The reference's
`all-prompts` LLM-re-titling cadence (a separate, observed model request — see
`reference-behavior-matrix.md` §0/§4) was not observed to visibly replace this literal-text title
within the pinned pass's timeframe, so a second titling call is still not implemented — every session
keeps its literal-first-message title for its lifetime; this is a documented assumption, not a gap
the evidence contradicts.

## Cancel/error presentation — implemented, not reference-identical

`client.cancelRun()` is wired to a "Stop" button shown in place of "Send message" while a run
streams; a cancelled run appends a small centered "Stopped" system row (no reference equivalent
observed to copy exactly — the reference's own "Stop"-labelled control was not confirmed against
the pinned build per `reference-behavior-matrix.md`). A failed run renders the assistant row with a
red status dot and a `role="alert"`-free error-tinted body ("Something went wrong…") rather than the
reference's still-unconfirmed error-row chrome.

## Approval-gate access mode is a fixed default, not wired to the composer dropdown (T7-T8)

`approvalGate` (`src/domain/approvalGate.ts`) compares a `run_code` call's requested
`sandbox_permissions` against the session's access mode, ranked `read-only < workspace-write <
full-access` — this is the real reference comparison (per updated
`reference-behavior-matrix.md` §6: approval fires when the requested permission ranks above the
current access mode). Since the composer's access-mode dropdown is still inert/display-only this
tranche (see "Composer permission-mode and model dropdowns" above), `agent.coding` defaults `mode`
to `"read-only"` when the caller doesn't pass one — the conservative default that matches the
reference's own observed mode during its approval scenario (`Access mode, current: Read Only` in
`12-approval-resolved-allow`/`-deny`). `AgentCodingInput.mode` exists so a later tranche can plumb
the dropdown's real value through without changing the gate.

## Pending approvals survive a full server restart; the reference does not (T8)

Confirmed by re-reading `reference-behavior-matrix.md` after this pass started: the reference keeps
a pending approval across a page *reload*, but **not** across a full process restart — after a
restart it silently finalizes the turn as "Worked", with no approval card and no answer text. This
reconstruction deliberately does not reproduce that: a Cognate run's open continuations are durable
by construction (SQLite-backed `run.waiting`/`continuation` state), and treating durable event
history as authoritative is a project invariant this reconstruction does not want to break to match
a reference implementation detail that looks like data loss. `test/J-D-approval.test.ts` ("a pending
approval survives a full server restart") asserts Cognate's actual (durable) behavior — the
continuation is still `OPEN` and the run still `waiting` after a full `app.stop()` + fresh
`startServer()` against the same SQLite store, and resolving it then still completes the run. Note
this required one supporting fix: `src/server.ts` now re-mounts the last-configured model provider
on boot from the persisted `model-config` projection (previously only `model.configure` mounted a
provider), because a run resumed after a restart needs a live `model.generate` provider to finish.

## `run_code`'s sandbox is an original harness, not the reference's dsh-tools sandbox (T7)

The reference's `run_code` (`packages/core/tools/src/ptc.ts`, not read/copied) executes an
arbitrary JS snippet in a real sandbox exposing a `tools` object. This reconstruction's
`tool.run_code` (`src/capabilities/tools.ts`) runs the model-supplied `code` as a `bun -e`
subprocess wrapped in a small, original harness that defines `tools.bash` in terms of this same
app's `tool.bash` execution path — enough to run the fixture's exact `run_code` snippet
(`await tools.bash({ command: 'rm -rf /tmp/scratch-cache', ... })`) faithfully, not a general
reproduction of the reference's sandbox/permission model (no filesystem/network sandboxing beyond
this app's own workspace-path containment).

## `08-tool-running` may land on an already-completed frame (T7)

Each `read`/`bash`/`edit` invocation in this reconstruction resolves against the local filesystem
in well under a millisecond (no real process spawn latency beyond `bash`'s own near-instant exit,
no network filesystem) — so the window where a given tool call's UI state is genuinely `"running"`
(after `tool.call.started`, before `tool.call.completed`) is only as wide as one local
event round trip, not the reference's real backend tool latency (a few seconds per turn, per
`08-tool-running`'s aria: `button "Deep diving for 1s"`). `tests/capture/cognate.capture.ts`
best-effort-polls for `.tool-activity-btn` before capturing "08-tool-running", but on a fast
machine the run can finish before that poll observes a running frame, so the checkpoint sometimes
shows the same completed state as "09-tool-complete" instead of a genuine mid-run frame. This is a
timing/nature difference, not a missing feature — the running-state UI itself (verified separately
by capturing while an *approval* is pending, which genuinely blocks for a human decision and is
stably reproducible, e.g. `11-approval-pending`) is correct. Not fixed by adding an artificial delay
to the tool capabilities themselves, which would misrepresent this app's real (fast, local) tool
latency for a screenshot's sake.

## Plan mode (T9)

- **`13-plan-active` lands past the intended `todo_write`-only frame.** The reference's
  `13-plan-active` shows a mid-`todo_write` frame (`button "Updating the plan · todo_write"`, no
  review card yet). The mock model's `plan` script runs `todo_write` then `exit_plan_mode` back to
  back with no real latency between them (same root cause as "`08-tool-running` may land on an
  already-completed frame" above), so by the time `tests/capture/cognate.capture.ts` observes the
  `todo_write` activity label and takes the screenshot, `exit_plan_mode` has often already opened the
  `plan-review` continuation — the capture ends up showing the same state as `13b`. The
  `13-plan-active`/`13b-plan-review-prompt` UI states are each individually correct and distinct
  (verified via `test/J-E-plan.test.ts`'s event-order assertions, which don't race a screenshot); this
  is a capture-timing artifact, not a missing or incorrect feature.
- **No right-sidebar plan tab.** The reference auto-opens the plan as its own tab in a right sidebar
  (title = plan heading, rendered markdown) alongside the review card/completed-session state. This
  tranche has no right sidebar at all — "Open right sidebar" is already inert (see above) — so the
  full plan is shown inline instead, via `PlanReviewCard`'s "View full plan" disclosure. This accounts
  for most of `13b-plan-review-prompt`/`13c-plan-completed`'s pixel diff (the reference's screenshot
  is wider, with a populated right pane; this app's right pane is simply absent).
- **"Open plan: `<title>`" is present but disabled.** The reference's completed-session standalone
  button linking back to the plan artifact (`13c-plan-completed`) is reproduced with the same
  accessible name pattern but disabled (`title={NOT_IMPLEMENTED}`) — no plan-artifact viewer in this
  tranche, consistent with the right-sidebar gap above.
- **"Request changes" wording is not reference-confirmed.** `reference-behavior-matrix.md` §6.3
  states this path "was not exercised this pass" against the pinned build. The tool-result text
  `planRequestChangesToolResult` (`src/domain/planGate.ts`) feeds back on denial is this app's own
  invention, shaped by `canonical-journey-catalog.md` `j_e_plan`'s step description rather than any
  observed string — `test/J-E-plan.test.ts` does not assert this path for the same reason (only
  Approve is exercised, matching the brief's stated test scope).
- **"Plan mode off." confirmation turn.** Toggling plan mode off (`"/plan off"`, or the composer's
  "Plan mode on, press to turn off" button) is handled by `agent.coding` as a pure control command:
  no model round trip, just a `plan.mode.changed` event and a short assistant-style confirmation
  message ("Plan mode off."). The reference's exact UI for this transition was not captured/observed
  this pass, so this exchange (and the composer toggle invoking a full new turn to produce it) is this
  app's own minimal design, not a reproduction.

## Subagents (T10)

Delegation is fire-and-forget, matching the reference exactly (reference-behavior-matrix.md §6.4):
`agent.coding` starts the child (`subagent.start`, this app's own capability —
`src/capabilities/subagentStart.ts`) and returns immediately with `Tool result: started subagent
<childRunId>`; there is no `ctx.waitFor` and no parent-side completion watcher (an earlier pass of
this tranche synchronously awaited the child and fed its answer back as the tool result, which does
not match the reference — corrected; `src/server.ts` no longer needs or contains a
`run_completion`-resolving watcher at all). The child's own completion is observed directly from its
own events (the `subagents` projection parses the `subagent:<parentRunId>:<toolCallId>` correlation
back off `message.completed`/`run.failed`, `src/projections/subagents.ts`), and durably "returns to
the parent" as a synthetic context message on the parent session's *next* turn
(`src/capabilities/sessionHistory.ts`), per the matrix's "the parent's next model turn ... would see
the child's result as its tool output."

- **`14-subagent-active` may already show the "N subagent(s)" banner.** Same root cause as the
  `08`/`13` timing notes above: `subagent.spawned` is recorded (and the banner becomes visible) as
  soon as the child run is *started*, which on this local mock setup can happen well before the
  capture script's poll for the "Coordinating subagents" activity label resolves. The reference's
  `14-subagent-active` does not yet show the banner at that point; this app's sometimes does. Content-
  timing artifact, not a missing/incorrect feature (`test/J-F-delegation.test.ts` asserts the actual
  event ordering without racing a screenshot).
- **"Open `<title>` in sidebar" opens a minimal, newly-built right panel, not a reused one.** No right
  sidebar existed anywhere in this app before this correction (`DEVIATIONS.md` previously listed
  "Open right sidebar" as fully inert) — there was nothing to reuse. `RightPanel`
  (`src/ui/App.tsx`) is a small new component populated entirely from the child's own `subagents` row
  (its delegated prompt + final answer as a two-message transcript), not a general session/transcript
  viewer — sufficient for a single-turn child, not a reproduction of the reference's own right-sidebar
  chrome (tabs, split/fullscreen/collapse controls) beyond a close button. Plan mode's "View full
  plan" (J-E-plan) is unchanged and still renders inline rather than in this panel.

## Cancellation and provider error/retry (T11)

Cancel and the runtime-level cancellation wiring (`RunContext.signal` -> the invocation's
`HandlerContext.signal` -> `streamingProviderComponent`'s `provider.stream(request, ctx.signal)` ->
`openAICompatible`'s `AbortSignal.any([...])` on the underlying `fetch`) already existed unchanged
from an earlier tranche (`src/components/modelProvider.ts`, `packages/kernel-cordis/src/lease.ts`,
`packages/provider-openai-compatible/src/index.ts`) — this pass only added the retry loop, the
sessions-projection folding of `run.cancelled`/`run.failed`, and the UI's failure/retry/stopped
rendering. `test/J-H-cancellation.test.ts` confirms the mock model server (a real, separate HTTP
process — see `test/helpers.ts`'s `bootMockModel`) actually observes the connection abort via a new
`GET /__abort-count` endpoint on `fixtures/mock-model/server.ts` (a counter incremented on the
request's `AbortSignal`, added because the mock always runs out-of-process, so a test cannot import
its in-memory state directly).

- **Provider-error code mapping is text-based, not status-based, by construction.** Only
  `InvocationFailedError.failure.message` survives the kernel's JSON boundary for a handler that
  throws — `packages/runtime-bun/src/invoker.ts`'s `failureJson` reduces any `{ kind: "failed" }`
  failure to `{ kind: "failed", message: messageOf(error) }`, dropping `ModelProviderError`'s own
  `kind`/`status` fields entirely. `agentCoding.ts`'s `classifyModelFailure` therefore matches on the
  message text: `/timed out/i` maps to the reference's own observed `"Request timed out." / TIMEOUT`
  (reference-behavior-matrix.md §8); everything else — including this app's mock `[[scenario:error]]`
  path, a scripted HTTP 500 — maps to an honest, non-invented `"Internal server error" / HTTP_500`
  rather than fabricating a timeout that didn't happen. `18-error`'s capture and
  `J-H-provider-error.test.ts` both exercise the HTTP 500 path (this app's mock has no timeout
  scenario), not the reference's network-timeout trigger.
- **Retry backoff is real but short, and configurable only via `MODEL_RETRY_BACKOFF_MS`.** The
  reference's own timing (~90s for the full 5-attempt budget) is not reproduced; `DEFAULT_RETRY_BACKOFF_MS`
  is 300ms (capture/manual use), and the test suite overrides it to 10-150ms per test via the env var
  so `bun test` stays fast. The retry *count* (5) and event shape are unaffected by this.
- **Cancelled-turn history.** Whether a cancelled turn's partial reply should be fed back into the
  next turn's `session.history` model context is not documented in reference-behavior-matrix.md. This
  app does not synthesize one: `session.history` (`src/capabilities/sessionHistory.ts`) already only
  appends an assistant message `if (run.status === "completed")`, so a cancelled run contributes just
  its user message, unchanged, to history — the partial text stays visible only in the live UI
  transcript for that browser session (via `run.invocation.progress` events), not restored after a
  reload/history refetch. Documented as an assumption per the tranche brief, not fixed by adding a
  cancelled-partial-text capability.
- **No manual "Retry"/"Dismiss" on a failed turn**, matching the reference exactly
  (reference-behavior-matrix.md §8: "No manual 'Retry' or 'Dismiss' button is shown on the failed turn
  itself") — the composer remains available underneath to start a new message.
- **The retry disclosure's expanded content is this app's own minimal rendering** (one line per
  recorded attempt: "Attempt k/5: `<message>` (`<CODE>`)") — the reference's own expanded-state
  content for `"Retried model request (k/5)"` was not captured, so this is not a reproduction, similar
  in spirit to the To-dos widget's expanded list (T9 section above).
- **Composer "Stop generating" aria-label matches the reference exactly**
  (reference-behavior-matrix.md §7 — `button "Stop generating"`, resolved via role/name query); an
  earlier pass of this tranche used the shorter, non-matching label `"Stop"` — corrected.

## Icons

All icons (`src/ui/icons.tsx`) are original inline SVGs drawn for this reconstruction — simple
monochrome line glyphs, not visual copies of the reference's iconography.

## Round-2 critic fixes (see `critic/round-2-disposition.md` for the full item-by-item list)

New in this pass, all still governed by durable events/projections:

- **Review split-diff panel** (`ReviewPanel` in `src/ui/App.tsx`): "Edited `<file>` +N -M" now opens a
  real right-hand pane beside the chat (reusing the same `<aside class="right-panel">` shell the
  subagent child view already used) — tab strip (`Review · turn N` + close + disabled "+"), a
  list/split/code toolbar, and a two-column diff with a line-number gutter and one `@@` hunk header
  (`diffHunk()` derives gutter numbers/hunk bounds from the existing `EditSummary.diffLines`, no new
  domain data). Geometry per product-characterization.md §2 (min 300px / max 70% / default 45vw).
  Previously this was an inline diff card inside the message body — removed.
- **"Into the Unknown" hero landing** (`HeroLanding`): a selected workspace with zero messages in the
  active session now renders the centered landing (logo, heading, Preview badge, workspace/mode
  pills, centered composer, no tab bar) instead of jumping straight to the tabbed session chrome.
- **Header mode badge is a real per-session field**: `sessions` projection now sets `mode: "ptc"` the
  first time a session's run emits `tool.approval.requested`, sticky afterward; the header shows "PTC
  mode" for those sessions, "Standard mode" otherwise (was a hardcoded string).
- **Subagent popover anchors under the header** (`.subagent-count-wrap`/`.subagent-tree` in
  `app.css`), not as a bottom banner above the composer.
- **Accent color audit (critic round-3 P0/P1 — corrects this entry's earlier blanket claim):** the
  reference does not use one accent hue for every primary/active element. Pixel-sampled from
  `reference/screenshots/desktop/{01-first-launch,02-model-settings,07-streaming,11-approval-
  pending,15-completed-session}.png`:
  - Near-black/gray (`--cg-accent`, `#1b1d22` light / `#ececee` dark) is correct for modal/approval
    CTA buttons only — "Continue", "Apply", "Allow once" (samples to `#0f1115`-ish).
  - The composer send/stop button and the active-tab underline are a separate **blue**
    (`--cg-accent-interactive`, sampled `#4176e6`) — round-2's retone had incorrectly pulled these
    onto the near-black token too; split out in `src/ui/app.css`.
  - The user-message bubble is its own **light lavender fill with dark text**
    (`--cg-message-bubble-bg: #edf3fe`, `--cg-message-bubble-text`), sampled from
    `15-completed-session.png` — round-2's retone had also pulled the bubble onto near-black
    (`--cg-accent`), which this DEVIATIONS.md previously and incorrectly described as "matching the
    reference." Fixed in `.message-bubble` (`src/ui/app.css`).
  - `--cg-active` (low-alpha near-black, e.g. `rgba(27,29,34,0.08)`) was already correct as-is — at
    that opacity over a white surface it renders as the same light neutral gray the reference's
    active session row uses (`#eceef0`-ish); no change needed there.
  Sidebar "Workspaces" label is sentence-case/regular-weight, not small-caps/bold (unchanged, still
  accurate).
- **02-model-settings checkpoint pairing (P1, accepted, not fixed):** the reference's own
  `02-model-settings` capture happens to already show a configured-provider card (a pre-existing
  config carried into that capture run), while Cognate's `02` is a genuinely fresh, unconfigured
  first visit (the only state consistent with `01`/`03` needing no model configured yet). Both states
  are individually correct per this app's own lifecycle — `02d-model-settings-redacted-key` already
  demonstrates the configured-provider card layout side-by-side with the reference's equivalent.
  Reordering the capture script to pre-configure a provider before `02` would corrupt `01`/`03`'s
  required unconfigured state, so this is left as a documented capture-sequencing difference, not
  reworked.

## Round-3 critic fixes

- **In-chat file-change control is now a file-icon card**, not a text pill: `EditDiff` (`src/ui/
  App.tsx`) renders a `FileIcon`, an "Edited `<file>`" heading line, and a "+N -M" stat line inside a
  bordered card (`.edit-diff-card` in `app.css`), matching `reference/screenshots/*/10-file-change-
  expanded.png`. The accessible name (`View changes to <path>: Edited <file> +N -M`) is preserved via
  `aria-label` on the button.
- **Review panel toolbar controls added, several inert by design (feature out of scope this
  tranche):** matching `reference/observations/aria/10-file-change-expanded.desktop.txt`'s tab-strip
  and toolbar rows —
  - Tab-strip row: `Split`, `Fullscreen`, `Collapse right sidebar` icon buttons are now present next
    to "Add tab", but **inert** (`disabled`, `title={NOT_IMPLEMENTED}`) — this tranche has no
    multi-pane layout engine, real fullscreen, or a separate collapsible right sidebar to drive them.
  - Toolbar row: `Show file location` and `More ways to open` buttons are now present, also
    **inert** for the same reason (no file-location surface or external-open integration exists) —
    this matches the reference itself, which also shows both `[disabled]` in its own ARIA dump.
  - `Open <file> in sidebar` is now **enabled** (previously incorrectly disabled) — the reference
    leaves it enabled. Since this panel already *is* the file's sidebar view, the click is a no-op
    rather than a second navigation.
- **User-message bubble background/text color**: see the "Accent color audit" entry above.
- **Cancelled-turn status pill has no visual dot**: `.status-pill.status-cancelled` renders
  transparent/zero-size (was inheriting the default green `--cg-success` dot used for "Worked"); the
  accessible `role="status"` text ("Stopped") is unchanged. Reference's standalone "Stopped" line has
  no leading indicator (`19-cancelled.desktop.txt`).
- **Step counter now counts the model's own generation step, not just tool calls**: turn `stepCount`
  is `useToolTimeline(...).length + 1` (previously just the raw tool-call count) — the `+1` accounts
  for the generation/response step itself, present even with zero tool calls or on a turn cancelled
  mid-stream. Verified against every reference ARIA dump with a turns/steps footer (`{15-completed-
  session,19-cancelled}` 0 tools → "1 steps"; `12-approval-resolved-{allow,deny}` 1 tool → "2 steps";
  `13c-plan-completed` 2 tools → "3 steps"; `{09-tool-complete,10-file-change-*}` 3 tools → "4
  steps") — all now match with the `+1` term.
- **Checkpoint 03 capture-alignment (capture-script fault, not an app defect):** `tests/capture/
  cognate.capture.ts`'s `03-no-workspace` checkpoint now runs before either onboarding dialog is
  dismissed, same as `reference.capture.ts` (whose own `dismiss(page, "Continue")` before `03` is a
  no-op against the reference's disabled "Continue" button) — both sides now land on the same first
  dialog ("Internal Testing Notice" / its Cognate-branded equivalent) still open, instead of Cognate
  advancing to its second dialog first.

## Cognitive-navigation proof (2026-10-03)

Spec: `.agents/specs/cybernetic-navigation-proof.md`; plan: `.agents/plans/cybernetic-navigation-proof.md`.
Everything below is a **local harness proof mechanism** unless marked otherwise; nothing changed in
Cognate core, `.sea` grammar, or dependencies.

| Mechanism | Kind | Where |
| --- | --- | --- |
| Event log, continuations, `@cognate/execution` worlds, RealityTrace outbox, policy | existing Cognate primitive | reused as-is |
| World identity (`worldHash`), lineage fold, promotion check | local proof mechanism | `src/cognitive/world.ts` |
| Frozen criterion, `criterionHash`, observer coverage | local proof mechanism | `src/cognitive/criterion.ts` |
| `CaseProjection`, Reality, affordance field | derived (fold of events on every call; no store) | `src/cognitive/case.ts`, `affordance.ts` |
| `MediationHost` (tiers, `next`, `next.trusted`, origin, trace), Sentinel, `userToyMod`, RiskPreflight, LiveVerify | local proof mechanism | `src/cognitive/mediation.ts`, `sentinel.ts`, `preflight.ts`, `liveverify.ts` |
| Surface grammar (callout, entity, table, compare, timeline, preflight, ask) | local proof mechanism | `src/cognitive/surface.ts`, `src/ui/CognitiveFrame.tsx` |
| Bounded search rounds, method review | local proof mechanism | `src/cognitive/experiment.ts`, `method.ts` |
| Shared attention (`FocusContext`, WebMCP adapter) | local proof mechanism; focus is ephemeral | `src/cognitive/focus.ts`, `src/ui/webmcp.ts` |
| `cognitive.*` capabilities | components over the above | `src/capabilities/cognitive.ts` |

**World identity.** `worldHash = SHA-256("cognate.canonical.v1\n" + canonical JSON)` of the
consequential manifest: workspace file digests, repo SHA, semantic-model / policy / environment
hashes, criterion and method hashes. Origin case/run, parent, status, sandbox id and timestamps are
lineage metadata on events and are *not* hashed, so a candidate promoted to settled keeps its hash
(`repoSha != worldHash`; same Git SHA with a different policy is a different world).

**Durable / reconstructible / ephemeral.** Durable: `case.opened`, `criterion.frozen`,
`world.{baseline,candidate}.frozen`, `world.candidate.rejected`, `world.settled`,
`verification.observed`, `sentinel.finding`, `experiment.round.completed`, `method.recommended`,
`method.accepted`, approvals/continuations (all in the event log; the evidence-bearing ones also ride
the RealityTrace outbox). Reconstructible: Case, Reality, affordance field, lineage, search state,
active `methodHash`, the `cognitive` projection. Ephemeral: `FocusContext`, requested Surfaces
(in-memory bridge), view state, hover/animation. Fork directories are disposable.

**Authority.** `world.settle` and `method.accept` refuse any call made from inside a run
(`ctx.runId`), and require a `user` actor; settlement additionally needs reachable mandatory
conditions, current parent, and evidence. A lower-trust mediator cannot lower a trusted approval
requirement (Sentinel compares against `next.trusted`, which re-runs only mediators at or above the
chosen tier against a shadow core). `ui_*` / WebMCP tools are read/representation only; mutating
actions are shown to the human as an `ask` and are never executed by the agent.

**Deliberate differences / limits.** CubeSandbox is absent (DEBT-022). New capabilities are
unbound to `.sea` (DEBT-023). Several spec items are not implemented (DEBT-024). RiskPreflight
classifies the `rm -r` family only. Agent runs cannot await a child run, so `case.observe` returns
facts and the agent emits them. Core-promotion candidates (none promoted): (1) world identity +
lineage fold — deficit: no content-addressed world notion; evidence: used by cleanup, search and
attention journeys; before promotion: a second app and a provider-owned manifest contract; (2)
around-mediation with trusted-subchain — deficit: Cognate policy cannot ask "what would trusted
policy alone have done"; evidence: Sentinel, RiskPreflight, LiveVerify, toy mod; before promotion:
a Component/fiber-lifetime binding instead of the `effects` shim; (3) closed Surface grammar —
deficit: no governed representation capability; evidence: preflight, timeline, compare, ask in two
surfaces; before promotion: a second renderer.


## Remote Workspaces (2026-10-04)

- **Trust is probe-then-pin, with no trust-on-first-use.** The Add-workspace dialog shows the host's
  fingerprint (and whether it matches `~/.ssh/known_hosts`); connecting requires ticking "I trust this
  host key"; the pinned fingerprint is part of the durable (non-secret) world record and the provider
  refuses any other key.
- **Secrets only in `secrets.json` (0600).** Passwords/passphrases are cleared from the form once sent;
  events, projections and SQLite carry the auth *kind*, a key *path* and the fingerprint only
  (`J-RW-ssh-workspaces` scans the SQLite bytes and event log for the password).
- **Re-selecting a workspace now passes its world** (`workspace.select { path, worldId }`); previously a
  remote root would have been re-added as a *local* workspace.
- **`execution.wsl.list` and the WSL tab distinguish "not installed" from "not responding"**, with
  `wsl.exe`'s own message and a "Try again" button, because WSL's service fails intermittently.
- The approval card still renders from `tool.approval.requested` slightly before its continuation
  exists (DEBT-025); unrelated to remote workspaces but visible in the same journeys.
- No directory browser: the remote folder is typed (default: the remote home). A browser over
  `filesystem.list` is the natural follow-up.
