# Cognate Console UI Shell

## Overview

Bun/TSX React shell of the Cognate Console: the root application component (`App.tsx`) plus the
shared shell-level surfaces — sidebar and session tree, composer and queue/steer machinery,
approval / plan-review / governance / settlement / interrupted-step cards, settings dialogs
(models, shortcuts, config file, governance pane), workspace forms (local, Linux child
containment, SSH, WSL), the cognitive-frame right panel with its closed-grammar Surface renderer,
the WebMCP attention projection, markdown rendering, icons, and browser download helpers.

All state is server-owned: data is read from Cognate public projections via
`useProjection` (`@godspeedai/cognate-react`), every mutation goes through a named capability via
`client.invoke` / `client.startRun`, and agent-blocking decisions arrive as continuations
(`useContinuations`) that the shell resolves. Domain logic lives outside this directory
(`src/toolGroups.ts`, `src/steerQueue.ts`, `src/sidebarView.ts`, `src/shortcuts.ts`,
`src/settings.ts`, `src/attachments.ts`, `src/reviewPatch.ts`, `src/approvalSummary.ts`,
`src/cognitive/*`); presentation styling is `app.css` (excluded from this contract).

Child panels with their own contracts: [Experts & Teams panels](./experts/README.md) and
[Workbench cockpit panels](./workbench/README.md).

## Interface

- `./App.tsx:App` — root shell; composes sidebar, center column (hero landing / Experts &
  Teams / Plugins / Workbench / conversation), right panel (ReviewPanel / TraceDetailsPanel /
  RightPanel / CognitiveFrame) and the modal dialogs.
- `./App.tsx:ToolEntry` — one tool call in a run's timeline (`toolCallId`, `tool`, `args`,
  `status: "running" | "success" | "failed"`, optional `approval` with
  `status: "pending" | "approved" | "denied"`).
- `./App.tsx:SessionTaskBindingRow` — the durable Task↔Session binding row
  (`session-task-bindings` projection); `taskId: null` is an explicit detach, absent row is
  "never bound".
- `./App.tsx:SubagentRowView` — one child delegation row (`subagents` projection).
- `./App.tsx:SessionRowButton` — one sidebar session row (`role="treeitem"`) with waiting /
  reconciliation / plan-review badges and an archive/restore toggle.
- `./App.tsx:ApprovalBar` — docked tool-approval card (Enter = allow, Escape = reject).
- `./App.tsx:SubagentTree` — the "Subagent sessions" disclosure tree.
- `./App.tsx:ReviewPanel` — right-hand split-diff review panel (tabs, list/split/code views,
  line wrap, patch copy/download).
- `./App.tsx:Composer` — the message composer: paste-image previews, queued messages with
  Steer/cancel, access-mode dropdown, plan-mode toggle, turns/steps counters.
- `./App.tsx:ToolGroup` — one collapsed group of consecutive tool calls.
- `./App.tsx:ShortcutsDialog` — keyboard-shortcuts editor; props
  `{ overrides, onChangeShortcuts, onClose }` (the callback writes through
  `settings.changeShortcuts`).
- `./App.tsx:ConfigFileDialog` — "Configuration file" dialog; props
  `{ onResolve, onClose }` where `onResolve` returns a `ConfigPathResult` (injected for
  testability).
- `./App.tsx:selectWorkspaceForExecution` — shared workspace-open path:
  `mode === "contained"` requires `inspection.configured && inspection.platformSupported`
  (throws `inspection.reason` otherwise) and invokes `workspace.contained.select`; local mode
  invokes `workspace.select`.
- `./App.tsx:LocalWorkspaceForm` — local tab of the Add-workspace dialog with the execution-mode
  radio group (local vs Linux child containment).
- `./App.tsx:PluginsPanelBody` — presentational body of the sidebar Plugins panel; all data and
  callbacks are props (serves the plugin install/toggle tests without a client).
- `./AmbiguousStepCard.tsx:AmbiguousStepCard` — operator reconciliation card for an interrupted
  agent step (`ambiguous-invocation`); a `modelCall` step offers only "retry".
- `./CognitiveFrame.tsx:CognitiveFrame` — the cognitive-navigation right panel (Destination,
  Present, Deviation, Next move, Settlement, conditional Authority/Search/Method/Reality).
- `./CognitiveFrame.tsx:SurfaceView` — renders a server Surface only after
  `validateSurface` accepts it; invalid input renders a rejection message instead.
- `./DirectoryField.tsx:DirectoryField` — shared accessible directory type-ahead; key types
  `./DirectoryField.tsx:DirectoryFieldProps`, `./DirectoryField.tsx:DirectorySuggestOption`.
- `./GovernanceApprovalCard.tsx:GovernanceApprovalCard` — SEA-Forge escalation card; plus
  `./GovernanceApprovalCard.tsx:governanceApprovalOf` (extracts `{ approvalId, capability }`
  from a `governance-approval` continuation).
- `./GovernancePane.tsx:GovernancePane` — Settings → Governance & evidence
  (authority / settlement / proof declaration), props `{ workspaceId }`.
- `./RemoteWorkspaceForm.tsx:SshWorkspaceForm`, `./RemoteWorkspaceForm.tsx:WslWorkspaceForm`,
  `./RemoteWorkspaceForm.tsx:WorldBanner`, `./RemoteWorkspaceForm.tsx:useExecutionWorlds`,
  `./RemoteWorkspaceForm.tsx:friendlyConnectionError`; key type
  `./RemoteWorkspaceForm.tsx:WorldRow`.
- `./SettlementCard.tsx:SettlementCard` — what SEA-Forge settled for this session's runs; key
  types `./SettlementCard.tsx:SettlementOperation` (status
  `"settled" | "rejected" | "unsettled" | "refused" | "not-attempted"`) and the poll hook
  `./SettlementCard.tsx:useSessionSettlement`.
- `./download.ts:downloadTextFile` — writes bytes to the browser's downloads folder via a Blob
  URL + temporary anchor (revoked on the next task). `./download.ts:copyToClipboard` —
  clipboard write that reports success instead of throwing.
- `./markdown.ts:renderMarkdown` — deliberately minimal, dependency-free markdown → HTML
  (headings, bold/italic, inline code, fenced blocks, bullet lists, links); escapes HTML first.
- `./webmcp.ts:toolsForFocus`, `./webmcp.ts:publishToWebMcp` — the focus-dependent WebMCP tool
  set and its registration against `navigator.modelContext`; key interfaces
  `./webmcp.ts:WebMcpTool`, `./webmcp.ts:WebMcpHost`, `./webmcp.ts:AttentionBackend`.
- `./icons.tsx` — inline-SVG icon set (`./icons.tsx:LogoIcon`, `CollapseIcon`, `PlusIcon`,
  `SearchIcon`, `SlidersIcon`, `GearIcon`, `PluginIcon`, `ChevronDownIcon`, `ChevronRightIcon`,
  `FolderIcon`, `SendIcon`, `StopIcon`, `CopyIcon`, `SunIcon`, `MoonIcon`, `ThumbUpIcon`,
  `ThumbDownIcon`, `BranchIcon`, `CheckIcon`, `EditIcon`, `TrashIcon`, `FileIcon`,
  `ExternalLinkIcon`, `PanelRightIcon`, `ListViewIcon`, `SplitViewIcon`, `CodeViewIcon`,
  `FullscreenIcon`, `MoreIcon`) — monochrome `currentColor`, all `aria-hidden`.
- Subdirectories: [Experts & Teams panels](./experts/README.md) — roster/conversation cockpit,
  Expert/Team editors, schedules, spending surfaces; [Workbench cockpit panels](./workbench/README.md) —
  tasks, contract editor, workflow graph, capability lifecycle, automations.

## Invariants

- Human decisions resolve continuations exactly once: `./App.tsx:ApprovalBar` guards the
  resolve with a `deciding` state and deliberately has no `finally` reset (the bar unmounts when
  the continuation resolves; resetting would re-open the double-submit window); the keyboard
  path (Enter/Escape) respects the same guard.
- The agent tool loop is sequential, so at most one `tool-approval` and one `plan-review`
  continuation is open per run; `./App.tsx:App` matches the open continuation to the entry with
  `approval.status === "pending"` rather than by id.
- Steering is credited by id, never by text: `ChatMessage.steerId` is promoted to "applied" only
  when `workbench.steer.consumed`'s `ids` array names it (`./App.tsx:App`'s steer-consumed
  effect), so two identical pending steers cannot collide. A steered message lives in exactly
  one place — `./App.tsx:steerQueued` removes it from the queue before calling `busySubmit`.
- Exactly one queue dispatch per idle window: `./App.tsx:App` guards the queue-settle effect
  with the `dispatchedForIdleRef` ref (the `send` identity can change while idle, which would
  otherwise dispatch twice).
- Sends go to the session's own workspace: `./App.tsx:send` uses
  `currentSession?.workspaceId ?? currentWorkspaceId`, never the asynchronously-updated global
  "current" pointer alone. The hero composer's first send creates the durable session
  (`session.create` with a fresh `crypto.randomUUID()` `requestId`) and binds the parked
  `pendingTaskId` via `session.task.bind` before the run starts.
- Access-mode precedence is fixed: `./App.tsx:App`'s `effectiveAccessMode` is per-session
  override > the `sessions` projection's folded mode > pending hero choice (session-less) >
  `settings.permission`; it is passed to `agent.coding` as `mode` for `approvalGate`.
- New-session isolation: `./App.tsx:startNewSession` resets transcript, review panel, trace
  detail, session tab and the explicit focus selection; the task binding is per-session by
  construction (`session-task-bindings`).
- `localStorage` is a UI convenience only: `./App.tsx:rememberSession` (last-open session per
  workspace) is explicitly not durable state — the run/approval state shown after a reload comes
  from durable events/projections, and `openSession` reattaches to a still-in-flight run from
  the `sessions` projection's durable `runId`/`lastStatus`.
- Only the top-most modal reacts to Escape/Tab: every dialog registers in `OPEN_MODAL_STACK`
  via `./App.tsx:useModalFocus`, which traps focus, restores the previously focused element on
  unmount, and ignores keys while another modal sits above it.
- The send path is string-only: `./App.tsx:Composer` refuses to send while image attachments
  are present (`attachmentsBlockSend`) and says why; the paste handler only claims the paste
  event when image files were actually accepted or rejected.
- Streaming honesty: `./App.tsx:useStreamingTurn` discards deltas from superseded (lower)
  attempts (`attemptRef`), and the step counter is always tool-call count + 1 (the `+1` is the
  model's own generation step) for completed, cancelled and failed turns alike.
- Refused work stays visible: `./App.tsx:AuthorityNotice` renders calls whose error matches
  "blocked by authority" outside the collapsible tool groups, whatever the Work-details
  verbosity.
- Type-ahead never lies about freshness: `./DirectoryField.tsx:DirectoryField` discards stale or
  out-of-order `workspace.directory.suggest` responses via a monotonic sequence ref; Enter with
  an active suggestion completes it, Enter with none falls through to the form submit; the
  component never touches the local machine's filesystem — suggestions come from the selected
  execution world only.
- Trust is an explicit human step: `./RemoteWorkspaceForm.tsx:SshWorkspaceForm` disables
  "Trust and connect" until the operator checks "I trust this host key" and the probe is not
  `revoked`; passwords/passphrases are cleared from component state immediately after
  `execution.world.connect` succeeds (never kept, never re-shown).
- Governance cards state reality: `./GovernanceApprovalCard.tsx:GovernanceApprovalCard` says the
  action has NOT run and the run is waiting; the decision goes to SEA-Forge via
  `governance.approval.resolve`. `./AmbiguousStepCard.tsx:AmbiguousStepCard` states the step was
  NOT repeated; resolution goes through `run.invocation.reconcile` and a model-call step offers
  only the retry outcome.
- Surfaces fail closed: `./CognitiveFrame.tsx:SurfaceView` rejects any surface that fails
  `validateSurface` with a visible message instead of rendering it.
- WebMCP tools cannot mutate truth: `./webmcp.ts:toolsForFocus` routes mutating actions to
  `AttentionBackend.proposeMutation`, which only surfaces a human confirmation
  (`./CognitiveFrame.tsx:CognitiveFrame`'s backend returns
  `{ status: "awaiting-human-confirmation" }`); read-only ops go through `ui.request` /
  `ui.context`. The exposed set is focus-dependent, not a permanent catalog.
- The projection is a hint, the server is the truth: `./CognitiveFrame.tsx:CognitiveFrame`
  re-invokes `case.derive` on a 1500 ms interval because `useProjection` can go stale
  (DEBT-021); "Settle candidate" is disabled unless `settlementReachable` and the case is not
  already settled.
- Containment is opt-in with proof of support: `./App.tsx:selectWorkspaceForExecution` throws
  when contained mode is requested but `execution.containment.inspect` did not report
  `configured && platformSupported`; `./App.tsx:LocalWorkspaceForm` preselects contained only
  when available and the posture is not `uncontained-local`.
- The Plugins panel renders no dead controls: lifecycle decides whether a toggle may exist at
  all (`src/plugins.ts`); `./App.tsx:PluginsPanelBody` renders a real `role="switch"` only for
  toggleable `settings-toggle` plugins, and `./App.tsx:PluginsPanel` takes its rows from the
  server-authoritative `plugin.catalog`.
- Sidebar auto-collapse fires strictly below 1024 px (`window.matchMedia("(max-width: 1023px)")`
  in `./App.tsx:App`) — 1024 px itself stays expanded; a manual toggle can still re-expand.
- Archive visibility is a view preference, not state: `./App.tsx:App`'s `archiveFilter` controls
  listing only; durability lives in `session.setArchived`.

## Side Effects

- Capability invocations through `client.invoke` in `./App.tsx:App` and its subcomponents:
  `agent.coding` (via `client.startRun`, with `idempotencyKey`, `correlationId`
  `session:<id>` and seeded run state `{ steer: [] }`), `client.cancelRun` (Stop),
  `client.updateState` (steer patch `op: "add", path: "/steer/-"`), `session.create`,
  `session.history`, `session.setArchived`, `session.task.bind`, `workspace.select`,
  `workspace.contained.select`, `workspace.rename`, `workspace.delete`,
  `execution.containment.inspect`, `model.configure`, `model.catalog`, `provider.delete`,
  `config.path` (Settings' ConfigFileDialog), `settings.changePermission`,
  `settings.changePreset`, `settings.changePlugin`, `settings.changeShortcuts`,
  `onboarding.dismiss`, `plugin.catalog`, `plugin.install`, `plugin.uninstall`,
  `observation.status`, `observation.record` (TraceDetailsPanel ledger), `run.invocation.reconcile`,
  `governance.approval.resolve`, `settlement.status`.
- Governance capabilities in `./GovernancePane.tsx:GovernancePane`:
  `governance.status`, `workspace.proof.current`, `workspace.proof.declare`,
  `workspace.proof.declare_contract`.
- Remote-world capabilities in `./RemoteWorkspaceForm.tsx`: `execution.world.probe`,
  `execution.world.connect`, `execution.world.check`, `execution.wsl.list`, `workspace.select`.
- Cognitive capabilities in `./CognitiveFrame.tsx:CognitiveFrame`: `case.derive`, `ui.pending`,
  `ui.focus.publish`, `ui.request`, `ui.context`, `world.settle`, `method.accept`.
- Directory suggestion: `workspace.directory.suggest` from `./DirectoryField.tsx:DirectoryField`
  (180 ms debounce, `limit: 8`).
- Event subscriptions (`client.subscribe({ runId })`): `./App.tsx:useStreamingTurn`
  (`run.invocation.progress`, `model.request.retried`, `turn.failed`, `message.completed`,
  `run.cancelled`, `run.failed`), `./App.tsx:useToolTimeline` (`tool.call.started` /
  `tool.call.completed` / `tool.call.failed`, `tool.approval.requested` / `tool.approval.decided`),
  and the steer-consumed effect (`workbench.steer.consumed`); plus
  `useContinuations(activeRunId)` for the blocking decision cards.
- Projection reads (`useProjection`): `workspaces`, `sessions`, `session-task-bindings`,
  `plans`, `subagents`, `model-config`, `settings`, `onboarding`, `cognitive`, `session-trace`
  in `./App.tsx:App` and its hooks; `execution-worlds` in
  `./RemoteWorkspaceForm.tsx:useExecutionWorlds`; `cognitive` in
  `./CognitiveFrame.tsx:CognitiveFrame`.
- Polling timers: `./SettlementCard.tsx:useSessionSettlement` re-polls its `load` callback every
  `pollMs` (default 3000) while the session is active; `./RemoteWorkspaceForm.tsx:WorldBanner`
  checks `execution.world.check` every 30 s and on `window` focus;
  `./CognitiveFrame.tsx:CognitiveFrame` runs 1500 ms (`case.derive`) and 600 ms (`ui.pending`)
  intervals; `./App.tsx:useElapsedSeconds` ticks 1 s while streaming.
- WebMCP registration: `./webmcp.ts:publishToWebMcp` calls
  `navigator.modelContext.provideContext` when the browser exposes one.
- DOM/browser effects: `document.documentElement.setAttribute("data-theme", …)`
  (`./App.tsx:useTheme`); modal focus trap and focus restore (`./App.tsx:useModalFocus`);
  `./download.ts:downloadTextFile` (Blob URL + anchor click + revoke);
  `./download.ts:copyToClipboard` and `./App.tsx:CodeBlocks`' Copy button
  (`navigator.clipboard`); `./App.tsx:ReviewPanel` opens the unified patch as a Blob URL in a
  new tab or downloads it; `localStorage` keys `cognate.lastSession.<workspaceId>` (write/read)
  and legacy `cognate.theme` (read-only seed); `window.location.hash` / `history.back` /
  `history.replaceState` for the `#plugins/<id>` route; `window.matchMedia` listeners for
  theme and the 1024 px breakpoint.
- Object-URL hygiene: `./App.tsx:Composer` revokes all pasted-image Blob URLs on unmount and on
  per-image removal (`revokeAll` / `removeAttachment`).

## Verification

- `test/ui-ambiguous-step.test.tsx` — verified by grep to render `AmbiguousStepCard` and
  `SessionRowButton`.
- `test/ui-governance-approval.test.tsx` — verified to exercise `GovernanceApprovalCard`,
  `governanceApprovalOf` and `SessionRowButton`.
- `test/ui-settlement.test.tsx` — verified to exercise `SettlementCard`.
- `test/ui-contained-workspace.test.tsx` — verified to exercise `LocalWorkspaceForm` and
  `selectWorkspaceForExecution`.
- `test/ui-observability.test.tsx` — verified to exercise `SubagentTree` (and the `ToolEntry`
  shape).
- `test/approval-bar-render.test.tsx` and `test/approval-summary.test.ts` — verified to exercise
  `ApprovalBar` and `SurfaceView`.
- `test/composer-attachments.test.tsx` and `test/composer-queue.test.tsx` — verified to exercise
  `Composer` (paste/attachments and queue/steer rows).
- `test/tool-group-render.test.tsx` — verified to exercise `ToolGroup`.
- `test/executionWorlds.test.ts` — verified to exercise
  `./RemoteWorkspaceForm.tsx:friendlyConnectionError`.
- `test/E2E-cognitive-console.test.ts` — verified to exercise `CognitiveFrame` (its
  `data-testid="cognitive-frame"`) and the WebMCP tool registration end to end.
- The `App()` shell itself, `GovernancePane`, `DirectoryField`, `ReviewPanel`,
  `PluginsPanelBody`, `ShortcutsDialog`, `ConfigFileDialog`, `download.ts`, `markdown.ts` and
  `icons.tsx` have no direct component test (covered indirectly through the journey/E2E suites);
  for those, run the full suite.
- Full suite: Run (from repo root): `bun run test` (type checking separately: `just typecheck`).
