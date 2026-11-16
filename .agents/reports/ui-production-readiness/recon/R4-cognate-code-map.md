# R4 Cognate Workbench code map (UI production readiness)

Scope: read-only recon. No source files were modified. Line numbers are from the checkout at `/home/sprime01/projects/cognate-workbench` (branch `feat/standalone-packages`). Items marked **(unverified)** were inferred and need a run or a screenshot to confirm.

---

## 0. Orientation

- `AGENTS.md`: use Bun 1.4+, Just, `just verify`. Keep the model -> capability -> journey test -> evidence sequence. Do not claim production hardening (single-operator authenticator is a known limitation).
- `src/ui/README.md`: the UI is a shell over Cognate projections. All mutations go through named capabilities via `client.invoke`. `app.css` is excluded from the contract.
- Test runner: `package.json:9` `bun test --timeout 15000 test`. `package.json:11` `verify` = typecheck + test.

---

## 1. App.tsx structure

File: `/home/sprime01/projects/cognate-workbench/src/ui/App.tsx` (6151 lines).

### 1.1 Top-level declarations (start line; range ends at the next declaration)

| Line | Name | Purpose |
|---|---|---|
| 139 | `interface WorkspaceRow` | Workspace row shape from projections |
| 150 | `interface ChatMessage` | Transcript message (`steerId` for steer credit) |
| 194 | `export interface ToolEntry` | One tool call in a run timeline |
| 204-215 | `PlanTodo`, `PlanStateRow` | Plan/todo projection shapes |
| 216 | `ModelConfigRow` | `model-config` "current" row |
| 227-254 | `useCurrentWorkspaceId`, `useWorkspaces`, `useSessions` | Projection hooks |
| 255-283 | `SessionTaskBindingRow`, `useSessionTaskBinding`, `usePlanState` | Task binding and plan projections |
| 284-322 | `SubagentRowView`, `useSubagents`, `usePlanReviewPendingSessions` | Subagent and plan-review projections |
| 323-335 | `useModelConfig` | Reads `model-config` |
| 336-353 | `useGeneralSettings` | Reads Settings -> General via `resolveGeneralSettings` |
| 354-376 | `useRealityTracePlugin` | Plugin toggle via `settings.changePlugin` |
| 377-396 | `useTheme(appearance)` | Resolves light/dark/system, sets `data-theme` on `<html>` (see 2.4) |
| 398-407 | `useOnboardingDismissed(step)` | Reads `onboarding` projection row for `notice` / `apikey` |
| 409-430 | `relativeTime` | "2m" / "3h" formatting |
| 431-487 | `export SessionRowButton` | Sidebar session row (`role="treeitem"`) |
| 488-546 | `FOCUSABLE_SELECTOR`, `OPEN_MODAL_STACK`, `useModalFocus` | Modal focus trap and Escape stack (see 1.4) |
| 547-584 | `FirstRunNotice` | Onboarding step 1: welcome/notice modal |
| 585-620 | `FirstRunApiKey` | Onboarding step 2: single API-key field (see 3c) |
| 621-631 | `FirstRunDialogs` | Sequences steps 1 and 2 from `onboarding` projection |
| 632-702 | `WorkspaceChooser` | Center-column workspace picker; mounts `DirectoryField` at 671 |
| 703-719 | `THIRD_PARTY_PRESETS` | Provider presets (OpenAI, OpenRouter, Azure, Groq, Mistral, Together, Fireworks, Anthropic) |
| 720-739 | `API_PROTOCOL_OPTIONS`, `protocolToWire`, `wireToProtocol` | Protocol display <-> wire mapping |
| 740-751 | `interface ModelRow` | Model list row |
| 752-857 | `DropdownMenuItem`, `DropdownMenu` | Generic menu |
| 858-909 | `FullAccessConfirmDialog` | Confirmation before full-access permission |
| 910-942 | `SHORTCUT_FIXED_REGIONS` | Fixed shortcut table for the shortcuts dialog |
| 943-1147 | `export ShortcutsDialog` | Keyboard shortcut editor (`onChangeShortcuts`, chord capture at 1002-1034) |
| 1148-1209 | `SettingMenu<T>` | Generic select used in Settings -> General |
| 1210-1251 | `APP_VERSION`, `SESSION_PLUGIN_CATALOG`, `GLOBAL_PLUGIN_CATALOG`, `PRESET_DETAILS` | Constants for plugins/presets panes |
| 1252-1352 | `BuiltInPluginsPane` | Settings -> Plugins (inspect-only) |
| 1353-1445 | `AgentPresetsPane` | Settings -> Agent presets |
| 1446-1584 | `GeneralPane` | Settings -> General (`settings.change*` calls) |
| 1585-1594 | (doc comment for ConfigFileDialog) | |
| 1595-1700 | `export ConfigFileDialog` | "Configuration file" stacked dialog (see 3a) |
| 1701-2234 | `SettingsModels` | Settings modal body: nav sections, provider list, add-provider wizard (see 3c) |
| 2235-2246 | `RetryInfo`, `TurnFailure` | Streaming types |
| 2247-2327 | `useStreamingTurn`, `useElapsedSeconds` | Run streaming state (`client.startRun` runs) |
| 2328-2385 | `useToolTimeline` | Tool timeline from run projection |
| 2386-2463 | `toolActionLabel`, `ToolActivity`, `RetryDisclosure`, `FailureBlock` | Tool/retry/failure rendering |
| 2464-2556 | `export ApprovalBar` | Docked approval card (Enter/Escape) |
| 2557-2584 | `TodoWidget` | Plan todos |
| 2585-2612 | `export SubagentTree` | "Subagent sessions" disclosure |
| 2613-2646 | `RightPanel` | Right-panel subagent detail (`<aside className="right-panel">`, 2615) |
| 2647-2719 | `PlanReviewCard` | Plan-review continuation card |
| 2720-2761 | `EditDiff` | Diff block |
| 2762-3078 | `export ReviewPanel` | Right-hand split diff review panel |
| 3079-3122 | `CodeBlocks` | Code block enhancement |
| 3123-3385 | `export Composer` | Message composer, queue/steer, access mode |
| 3386-3430 | `export ToolGroup` | Collapsed tool-call group |
| 3431-3454 | `verboseStepLabel`, `AuthorityNotice` | Labels |
| 3455-3575 | `MessageBubble` | Transcript bubble |
| 3576-3604 | `ContainmentInspection`, `WorkspaceInvoke` types | |
| 3605-3720 | `export LocalWorkspaceForm` | Add-workspace local tab; execution-mode radios; `workspace.select` / `workspace.contained.select` (3596-3599) |
| 3721-3785 | `AddWorkspaceDialog` | "Add workspace" modal (tabs: This computer / SSH / WSL) |
| 3786-3841 | `RenameWorkspaceDialog` | Rename via `workspace.rename` (3800) |
| 3842-3899 | `PresetMenu` | Per-session preset menu |
| 3900-4090 | `export PluginsPanelBody` | Presentational plugins panel body |
| 4091-4185 | `PluginsPanel` | Sidebar plugins panel wrapper |
| 4186-4254 | `STATUS_LABELS`, `AddPluginDialog` | Plugin install dialog |
| 4255-4263 | `useSessionTrace` | Trace projection |
| 4264-4341 | `toolDurationMs`, `requestDurationMs`, `buildTrajectoryTimeline` | Trajectory helpers |
| 4342-4456 | `TrajectoryView` | Session "trajectory" tab |
| 4457-4663 | `TraceDetailsPanel` | Right-panel "Event details" (`aside.right-panel.trace-details`, 4504) |
| 4664-4786 | `HeroLanding` | Empty-state "Start a session" hero |
| 4787-4796 | `WorkbenchIcon` | Icon |
| 4797-6150 | `export App` | Root shell: all state hooks, handlers, JSX |

### 1.2 Top-level view and route state

There is no router. Center-column views are switched by booleans inside `App()` (4797+):

- Settings modal: `showSettings` state (4831), opened by sidebar "Settings" button (5903-5905, `setShowSettings(true)`), rendered at 6138 as `{showSettings && <SettingsModels .../>}`. Inside `SettingsModels`, the section is `section` state (1721, default `"models"`, values `general | models | plugins | presets | governance`), nav buttons at 1936-1975. Governance uses `GovernancePane` (imported at 13 of App.tsx, file `src/ui/GovernancePane.tsx`).
- Experts & Teams: `expertsPanelOpen` (4869). Toggled from the global panel button at 5589-5608. Rendered at 5911-5919 in `center-column` (replaces the conversation).
- Workbench: `workbenchOpen` (4914). Toggled at 5618-5622; rendered at 5920-5950 (`workbenchOpen && currentWorkspaceId ? ...`). Auto-closed when a new session is created (5206).
- Plugins panel: `pluginsPanelOpen` (toggled 5608).
- Conversation (default): the `else` branch of the center-column ternary. Session tab: `sessionTab: "chat" | "trajectory"` (4924).
- Right-side panels (mutually exclusive by state, all `aside.right-panel`): `ReviewPanel` (`openReview`, state 5013, rendered ~6080s), `TraceDetailsPanel` (`traceDetail`, 4925), subagent `RightPanel` (`openChildToolCallId`, 5009, render line 6136 region), and `CognitiveFrame` (default when no subagent row is open; `src/ui/CognitiveFrame.tsx`).
- Sidebar collapse: `collapsed` (4830).

Central JSX root: `<div className="app-shell" data-theme={theme}>` at 5547; sidebar `sidebar-top` 5549, `sidebar-bottom` 5902, `main.center-column` 5910.

### 1.3 Modal system

- Backdrop: `.modal-backdrop` (CSS `app.css:2011`), `.modal` (2021), `.modal.settings-panel` (2035, 760px wide, zero padding). Stacked variant `.modal-backdrop-stacked` used by `ConfigFileDialog` (1632 region) and `AddWorkspaceDialog` (3728).
- Focus and Escape: `useModalFocus(dialogRef, onEscape?)` at `App.tsx:502`. Module-level `OPEN_MODAL_STACK` (495) lets only the top-most modal react to Escape and Tab. Every modal calls it.
- Modal list rendered at the end of `App()` (6138-6151): `SettingsModels`, `ShortcutsDialog`, `AddWorkspaceDialog` (6146 region), `RenameWorkspaceDialog`, `FirstRunDialogs` (6149).
- `ConfigFileDialog` is opened from inside Settings (`configFileOpen` local state inside `SettingsModels`, ~1928-1934).

Dialog close-button markup in use (relevant to 3b):

| Dialog | Markup | Location |
|---|---|---|
| Settings | `.settings-titlebar` flex row: `h2` (flex:1), "Open configuration file" button, `.icon-btn` "x" last | `App.tsx:1919-1927`, CSS `app.css:2041-2056` |
| Configuration file | `h2` then `.icon-btn` "x" (no banner wrapper) | `App.tsx:1630-1634` |
| Keyboard shortcuts | `.dialog-banner` wrapping `h2` and `.icon-btn` "x" | `App.tsx:1054-1058` |
| Add workspace | `.dialog-banner` wrapping `h2` and `.icon-btn` "x" | `App.tsx:3733-3737` |
| Rename workspace | `.icon-btn` "x" | `App.tsx:3811` |
| Plugins panel / Add plugin / Details | `.icon-btn` "x" | `App.tsx:3968`, `4217`, `4514` |

### 1.4 Existing side panel, drawer, inspector

- `.right-panel` (`app.css` shared class) is used by: subagent `RightPanel` (`App.tsx:2615`), `TraceDetailsPanel` (4504), and the ReviewPanel tab bar (2877). `CognitiveFrame.tsx` is the default right panel (cognitive navigation). There is no generic drawer component. A config side viewer would reuse the `aside.right-panel` pattern used by `RightPanel` (2613-2646) and `TraceDetailsPanel` (4457-4663), with tabs in `.right-panel-tabs`.
- Width handling: `@media (max-width: 1100px) { .cognitive-frame { width: 300px; } }` (`app.css:3095`). Mobile collapse rules at `app.css:2575` and `2593`.

### 1.5 Theme handling

- `useTheme(appearance)` at `App.tsx:377-395`: listens to `prefers-color-scheme`, resolves `system|light|dark`, sets `document.documentElement` `data-theme`. Also `data-theme={theme}` on `.app-shell` (5547).
- Setting source: `settings.changeAppearance` (`src/capabilities/settingsChange.ts`, descriptor at ~line 43), read through `useGeneralSettings` (336).
- CSS: `:root` light tokens at `app.css:10-69`; dark at `app.css:70-102` (`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`) and `103-117` (`:root[data-theme="dark"]`). See 5.

### 1.6 Keyboard shortcuts

- Action registry and pure logic: `src/shortcuts.ts`. `SHORTCUT_ACTIONS` at line 20 has four actions: `open-shortcuts` (default `Ctrl+/`), `new-session`, `toggle-sidebar`, `open-settings` (the last three are unbound by default). Helpers: `effectiveChord` 43, `chordFromKeyboardEvent` 64, `validateChord` 119, `detectConflict` 138, `resolveAll` 173, `isTypingTarget` 184, `resolveKeypress` 195.
- UI: the dialog at `App.tsx:943-1147`. Chord capture uses window capture-phase keydown at `App.tsx:1002-1034`. Escape cancels editing (1006-1013). The shortcut table is read via `effectiveChord` at 1039 and 1071.
- **Finding:** `resolveKeypress` (`src/shortcuts.ts:195`) has no production caller. `grep` finds it only in its definition and in `test/workbench-shortcuts.test.ts`. There is no global `keydown` listener that dispatches `new-session`, `toggle-sidebar`, or `open-settings`, and `open-shortcuts` is not wired either. The only global keydown handlers in `App.tsx` are the modal Escape/Tab handler (532), the Escape handler at 789, and the capture handler at 1033. So user-configured shortcuts are stored and validated but do nothing at runtime. **(verified by grep; confirm by pressing Ctrl+/ in the app)**

---

## 2. Client-server wiring and build

### 2.1 Client APIs

- Client hook: `useCognate()` from `@godspeedai/cognate-react` (`App.tsx:4`), used at 355, 622 and throughout.
- Projections: `useProjection(name)` (imported from the same package). Examples: `onboarding` (`App.tsx:399`), `model-config` (`useModelConfig`, 323), `settings` (`useGeneralSettings`, 336-352), `sessions`, `workspaces`, `session-task-bindings`, `plan-state`, `subagents`, `model-config`, trace projections (4255).
- Streaming and continuations: `useContinuations` (import, App.tsx:4); `useStreamingTurn` (2247) and `useToolTimeline` (2328) read run projections for `runId`. Runs start with `client.startRun` (documented in `src/ui/README.md`).
- Mutations: `client.invoke(capabilityId, input)`. Call sites include `onboarding.dismiss` (626), `workspace.select` (645, 5241), `settings.changePreset` (666, 1382), `settings.changePlugin` (364, 4178), `model.configure` (1825, 1847), `model.catalog` (1892), `provider.delete` (1872), `config.path` (1931), `session.create` (5208, 5293), `session.task.bind` (4958, 5309), `session.setArchived` (5778), `workspace.rename` (3800), `workspace.delete` (5877), `settings.changeShortcuts` (6142), `execution.containment.inspect` (3626), `observation.record` (4628), `governance.approval.resolve` (5067), `run.invocation.reconcile` (5046), `settlement.status` (5078), `session.history` (5150).
- Capability definitions: `src/capabilities/*.ts`, index in `src/capabilities/README.md`. Relevant files: `configPath.ts`, `settingsChange.ts`, `modelConfigure.ts`, `providerManage.ts`, `onboardingDismiss.ts`, `workspaceDirectorySuggest.ts`, `workspaceSelect.ts`, `containedWorkspace.ts`, `secretPut.ts`.

### 2.2 Server

- `src/server.ts`: single `Bun.serve` on `127.0.0.1` (around line 854). Routes: `/health`; `/cognate.v1.RuntimeService/*` (Connect RPC, 866-869); `/remote/*` (phone bundle, 874); `/app.js` (873, `no-store`); `/astryx.css`, `/theme.css`, `/app.css` (875-877, `appCss` in memory); `/` returns `indexHtml()` (878+).
- Capability registration: `src/server.ts` around lines 517-525 (`containedWorkspaceComponent`, `workspaceDirectorySuggestComponent` with `protectedHome: home`).

### 2.3 Browser bundle: how it is built and served

- `BROWSER_ENTRY_TEMPLATE` at `src/server.ts:308-357`. It writes an entry module importing `App` from `../src/ui/App.tsx` and injects `<script type="module" src="/app.js">` (357). The boot-token placeholder is substituted at boot.
- Development path (`src/server.ts:786-797`): the server writes `resourcePath(".generated")/entry.tsx` (793-794) and runs `Bun.build({ entrypoints: [entryPath], target: "browser", format: "esm" })` (795-797). The output is held in memory as `bundleJs`.
- Packaged path (`786-789`): reads a prebuilt `dist/web/app.js` from the install share directory. `scripts/package.ts:54` builds that file with `Bun.build(... minify: true)`.
- **After editing a `.tsx` file in development:** the bundle is built once at server start. There is no watcher in `src/server.ts` (grep found none). The change appears only after restarting the server (`bun run dev` = `bun src/cli.ts start`, `package.json:7`), then reloading the browser tab. `/app.js` is `no-store`, so a plain reload is enough after restart. CSS: `app.css` is read into `appCss` at server start (`/app.css` 877), so CSS edits also need a restart. **(verified by reading the code path; not run)**
- For packaged builds: `scripts/package.ts` must be re-run and the executable rebuilt.

---

## 3. Root causes for reported bugs

### 3a. "Open configuration file" shows a popup, not an editable side viewer

- Button: `App.tsx:1928-1930` inside `.settings-titlebar`, class `.open-config-file-btn` (CSS `app.css:2057-2065`). It sets local state `configFileOpen` (inside `SettingsModels`).
- Popup: `ConfigFileDialog` at `App.tsx:1595-1700`. It calls `onResolve()` (the prop is wired at 1931 to `client.invoke("config.path", {})`) and shows:
  - Facts list: home, config file path, whether the file exists (dl at ~1644-1652).
  - Button "Copy path" (~1660) and button that downloads `cognate.config.json` through `downloadTextFile` (1666). The bytes come from `info.export`.
  - `<pre>` of `info.settings` (1670-1676).
  - Environment table `config-file-env` (1678-1694). Sensitive values are redacted.
  - Note line: "Secrets are never included in this view or in the download." (1699).
- Capability: `src/capabilities/configPath.ts` (`configPathComponent`, line 29; result type `ConfigPathResult` at 17-27). It uses `access()` to test existence (import line 6) and never reads the file body. It builds `export` with `buildConfigExport` / `renderConfigExport` from `src/configFile.ts`.
- Helpers in `src/configFile.ts`: `RECOGNIZED_ENV_VARS` (12), `isSensitiveEnvVar` (28), `describeEnvironment` (41), `resolveConfigFilePath(home)` = `home + "/cognate.config.json"` (55-56), `buildConfigExport` (72), `renderConfigExport` (94).
- **Is there a read or write capability for config file contents?** No. grep of `src` for `readFile` / `writeFile` shows none against `cognate.config.json`. The file is only named in `configFile.ts` (56, 85) and in the download at App.tsx 1666. Durable settings are written through `settings.change*` (`src/capabilities/settingsChange.ts`, descriptor list at ~40-47, each with a `validate` guard), model config through `model.configure`, and secrets through `secretPut.ts`. So the file on disk is not a source of truth that the app reads back.
- What an editable side panel needs:
  1. `config.file.read` capability: resolve path via `resolveConfigFilePath(home)` (no caller-supplied path), return `{ text, exists, version }` where `version` is a content hash. Redact recognised secret keys (reuse `isSensitiveEnvVar` and the secrets exclusion). Never return `secrets.json`.
  2. `config.file.write` capability: input `{ text, expectedVersion }`. Parse JSON, validate against a schema (reuse the `settingsChange.ts` validators), reject any key that names a secret, reject on version mismatch (conflict), write to temp + rename with mode 0600 (pattern in `src/secrets.ts:26`), and append a durable event. Decide whether the file is authoritative (then the server must re-read and apply it, which is a larger change) or an export/import mirror (then the UI should say so).
  3. UI: a `.right-panel`-style aside (pattern: `App.tsx:2613-2646`) with a `<textarea>` or code editor, inline validation errors from the capability, Save/Revert, dirty state, and `Escape` handled by `useModalFocus` if it stays modal.
  4. Tests: a J-CFG journey test already exists (`test/J-CFG-config-path.test.ts`). Extend it with read, invalid write, and conflict cases.

### 3b. Settings close "x" is on the left

- Settings markup: `App.tsx:1919-1927`. `.settings-titlebar` is `display:flex; align-items:center; gap:12px` (`app.css:2041-2046`). Its `h2` has `flex:1` (2048-2055). The "Open configuration file" button comes next, and the `.icon-btn` "x" is last (1925-1927). Static CSS therefore puts the x on the right. I did not find an overriding rule in the mobile block (2634-2645). **Could not reproduce from code alone; needs a screenshot (see section 4 for `screenshots/`).**
- Likely real cause for left-placed close buttons: `.dialog-banner` has **no base rule** in `app.css`. The only rule is `.workspace-dialog .dialog-banner { display:flex; justify-content:space-between }` (`app.css:3133`). The Keyboard shortcuts dialog (`App.tsx:1054-1058`) and Add workspace (`App.tsx:3733-3737`) use `.dialog-banner`, so outside `.workspace-dialog` the `h2` and `×` stack as block elements and the × sits on the left under the title. **(strong candidate; confirm in a screenshot)**
- Other dialogs (Configuration file at 1630-1634, Rename at 3811, Plugins at 3968) use a bare `.icon-btn` with no flex wrapper, so their placement depends on the parent `.modal` flex column (`app.css:2021-2034`, `flex-direction: column`). A bare button in a column is left-aligned by default.
- Pattern to adopt: one shared header component (`title` + right-aligned `icon-btn` "x", `aria-label="Close <name>"`) used by all modals, with `.modal-header { display:flex; justify-content:space-between; align-items:center }` in app.css. Current conventions use `aria-label="Close"`, `"Close settings"`, `"Close keyboard shortcuts"`, etc. (see 1.3 table).

### 3c. First-run onboarding: API-key step lacks provider fields

- Step order: `FirstRunDialogs` (`App.tsx:621-631`) shows `FirstRunNotice` (547-584, "Continue" dismisses `notice`), then `FirstRunApiKey` (585-620) if the `apikey` step is not dismissed and no `model-config` row exists.
- `FirstRunApiKey` (585-620): one `<input type="password" aria-label="API key">` (~603), "Configure later" and "Save and continue" (both call `onDismiss` => `onboarding.dismiss` with step `apikey`). The comment (577-584) states the entered key is **not persisted** and provider setup happens later in Settings -> Models. So the step collects a key and discards it.
- Full provider form that should be reused: `SettingsModels` (`App.tsx:1701-2234`).
  - Presets: `THIRD_PARTY_PRESETS` (703-718), `API_PROTOCOL_OPTIONS` (720), wire mapping `protocolToWire` / `wireToProtocol` (725-739).
  - Wizard state (1726-1735): `view: "list" | "wizard"`, `addTab: "third-party" | "custom"`, `thirdParty`, `providerId`, `displayName`, `baseURL`, `protocol`, `apiKey`, `models`, `modelError`. Wizard transitions at 1775-1780, back to list at 1832.
  - Save calls `model.configure` at 1825 and 1847. Model catalog via `model.catalog` at 1892 (Fetch models). Delete via `provider.delete` at 1872 (two-step).
  - Wizard render: "Add model provider" dialog body under the `view === "wizard"` branch (approximately 2000-2212; search `Add model provider` in the file).
- Capabilities: `src/capabilities/modelConfigure.ts` (`modelConfigureComponent`, line 27; `model.configure` provider at 38; writes `model.configured` at 47). `src/capabilities/providerManage.ts` (`providerManageComponent`, line 34; provides `provider.delete` and `model.catalog`, 42-43; reads `model-config` at 53).
- Recommended fix: extract the wizard (provider id/name, baseURL, protocol, API key, Fetch models, Save) from `SettingsModels` into a shared `ProviderWizard` component (new file under `src/ui/`), use it in both `FirstRunApiKey` and Settings -> Models, and have `FirstRunDialogs` call `onboarding.dismiss` only after `model.configure` succeeds (or on "Configure later"). `FirstRunDialogs` already skips the step when `modelConfig` exists (`App.tsx:629`).

### 3d. Add workspace directory autocomplete

Client:
- `src/ui/DirectoryField.tsx` (219 lines). Constants: `DEBOUNCE_MS = 180` (line 42), `SUGGEST_LIMIT = 8` (43).
- Trigger (lines 67-100): query fires only when `value.trim() !== ""` **and `value.startsWith("/")`** (68). Otherwise it clears options and closes the list. Requests are debounced 180 ms (77) and `workspace.directory.suggest` is invoked with `{ worldId, typedPath: value, limit: 8 }` (78). A sequence number discards stale responses (80, 89).
- Keys (114-160): ArrowUp/Down move `activeIndex`; Tab completes the active option (134-139); Enter completes an active option, otherwise submits (141-149); Escape closes.
- Callers: `WorkspaceChooser` at `App.tsx:671` and `AddWorkspaceDialog`/`LocalWorkspaceForm` at `App.tsx:3666`, both with `worldId="local"`.

Server (`src/capabilities/workspaceDirectorySuggest.ts`):
- `splitTypedPath` (47-54): trims trailing slashes; `"/a/b"` -> parent `/a`, prefix `b`; `"/a/b/"` -> parent `/a/b`, prefix `""`. A root-level prefix such as `/ho` gives parent `/`, prefix `ho`.
- Handler (68-103): requires an absolute path (startsWith `/`, else throws at 77). Resolves the execution world (`registry.get`). Throws if the local world's parent is inside `protectedHome` (`isUnder`, 40-45 and 82). Calls `provider.fileSystem.list(parent)` (85) only, a single directory level. Maps errors to readable messages (86-96).
- Filter (97-101): `entry.kind === "directory" && entry.name.startsWith(prefix)`. Sort by `localeCompare`, slice to `limit` (max 100, default 20, lines 20-21). Result `{ name, path, kind }` only.
- Header comment (lines 14-15) states symlinked directories never appear, because `readdir` reports them as neither file nor directory.

Why partial names do not match until the exact path is typed (hypotheses, ordered by likelihood; **not reproduced**):
1. Symlinked folders are excluded (header comment 14-15, filter 97). Many home folders and mounted project roots are symlinks, so they never appear as suggestions even with a correct prefix.
2. Only `/`-rooted input queries. Typing `~/proj`, a relative path, or a Windows drive path (`C:\...`) yields no suggestions at all (DirectoryField 68).
3. Matching is case-sensitive `startsWith` on the name (97). `Proj` does not match `projects`.
4. The suggestion list is capped at 8 (client 43) and sorted lexically, so a common prefix can hide the target folder.
5. Errors (protected home, EACCES) replace the list with an error string; the user sees no list at all (DirectoryField 90-96).

Proposed algorithm (for an implementer):
- Normalize input on the client and the server: expand `~` to the world's home (get it from the world provider, not from `process.env` in the browser), accept `\` and drive letters for Windows worlds, collapse duplicate separators, resolve `.` and `..`.
- Split into parent + fragment as now, but list the parent once and cache the listing per parent for the dialog's lifetime (short TTL).
- Match in tiers: (a) case-insensitive prefix on the name, (b) case-insensitive substring, (c) fuzzy subsequence match (e.g. `cgw` matches `cognate-workbench`), with score = tier, then segment-boundary bonus, then recency.
- Include symlinked directories after a `stat` follow (`stat` each symlink; keep those that resolve to a directory), with a cap on the number of stats.
- Recents: store the last N selected workspace roots in a projection row (not browser storage) and show them first when the field is empty or focused.
- Empty fragment after a trailing slash lists children; the field should show "no match in <parent>" instead of silently closing.
- Keep the protected-home rule; keep the server as the only source of listings (already true).
- Tests: add a `test/ui-*.test.tsx` case for tier ordering and a server test for symlinks and `~` (the existing suggest test lives in the workspace tests; search `workspace.directory.suggest` in `test/`).

### 3e. Windows binary: console window opens, no UI

What the installed shortcut runs:
- NSIS script in `scripts/installers.ts`, `buildWindowsInstaller` (122-160). Shortcut `Start Cognate Workbench.lnk` (line 143) targets `$INSTDIR\bin\cognate-workbench.exe` with argument `start`, and uses the same exe as its icon (`... "start" "$INSTDIR\bin\cognate-workbench.exe" 0`). The "Diagnose" shortcut (144) runs the same exe with `doctor`. Installs per user, HKCU only (line 133 `RequestExecutionLevel user`).
- Build: `scripts/package.ts:84`: `bun build --compile --target bun-windows-x64 src/cli.ts --outfile bin/cognate-workbench.exe`. No `--windows-hide-console`, `--windows-icon`, or `--windows-title` flags. That is why the console is visible and the icon is the Bun icon. The window title is the process/shortcut name (the report says "start cognate workbench"; the exact title source is **(unverified)**).
- Start path: `src/cli.ts` `start()` (88-140). It acquires a home lock (`acquireHomeLock`, 65-78), asserts the port is free (79-86), optionally starts pg0, calls `startServer({ port, home })` (114), and prints `listening on <url>` (around line 131). **There is no code that opens a browser.** A grep of `src` and `scripts` for `xdg-open`, `explorer`, `open` as a spawn target, and `start ""` found nothing. The macOS installer text (installers.ts:101) tells the user to open `http://127.0.0.1:3180` by hand.
- Resources: `src/resources.ts`. `packaged` is true when `import.meta.url` contains `$bunfs` or `~BUN` (line 8-9). Resources resolve to `<exe>/../share/cognate-workbench`. Default home on Windows is `%LOCALAPPDATA%\CognateWorkbench` (line 26).
- Second-launch behavior: `acquireHomeLock` (65-72) refuses a second instance. With a hidden console and no browser, a second Start click gives no visible feedback.

Options:

| Option | What changes | Files | Feasibility and cost | Notes |
|---|---|---|---|---|
| (i) Auto-open the default browser on start | After `listening`, `Bun.spawn` the platform opener: `explorer.exe <url>` (Windows, avoids `cmd` quoting), `open <url>` (macOS), `xdg-open <url>` (Linux). Env opt-out `COGNATE_NO_OPEN=1`. Skip when stdout is not a TTY or in CI (test harness). | `src/cli.ts` (after line ~131), optional test in `test/` | Low: about 20 lines plus a unit test that stubs `Bun.spawn`. Cross-platform. | Does not hide the console. Fixes the "nothing happens" symptom on every OS. WSL: `xdg-open` may not exist; fall back silently and print the URL. |
| (ii) Hide the console window | Compile with `--windows-hide-console` (Bun 1.4.0 flag, confirmed by `bun build --help`). Bun docs: `node_modules/bun-types/docs/bundler/executables.mdx` and `docs/snippets/cli/build.mdx`. | `scripts/package.ts:84` (add flag only for `win`), plus `--windows-icon` and `--windows-title` for branding | Low for the flag. But one exe serves `start` and `doctor`, so `doctor` output also disappears. No console means no log output and no obvious way to stop the server (only Task Manager). | Combine with (i) and add a stop path (e.g. `cognate-workbench stop` using the home lock pid file from `acquireHomeLock`). Add a separate `doctor` shortcut that uses a console build or a `doctor.cmd`. |
| (iii) App-mode window via Edge or Chrome | Launch `msedge.exe --app=<url> --user-data-dir=<home>\browser` (Chrome equivalent) after start. Find the binary via App Paths registry key or known install path. | `src/cli.ts`, new `src/launchWindow.ts` | Medium: browser discovery, fallback to (i) when not found, a process that is not owned by the server (closing the window does not stop the server, which is probably desired but must be explained). Edge ships with Windows 10/11. | Gives a chromeless window with a taskbar entry. Keep the console hidden via (ii) if wanted. |
| (iv) Native wrapper (Tauri / WebView2 / Electron) | New shell that starts the Bun sidecar and hosts the page in a WebView; new build, signing and update pipeline. | New repo or `desktop/` package, `scripts/installers.ts` changes | High: new toolchain (Rust or Electron), separate signing, larger install. The server already binds `127.0.0.1` with a boot token served in the page, so a WebView would work, but that is weeks of work. | Only justified if native menus, tray, or notifications are required. |

Recommendation for a fast fix: ship (i) now, add (ii) with a stop path, and treat (iii) as a follow-up. (iv) is out of scope for now.

---

## 4. UI tests

- Runner: `bun test --timeout 15000 test` (`package.json:9`). Smoke: `test:smoke` (line 12).
- Real-browser tests import `chromium` from `playwright-core` (13 files, found by grep): `test/E2E-workbench.test.ts`, `E2E-experts.test.ts`, `E2E-experts-debt.test.ts`, `E2E-expert-model-parallel.test.ts`, `E2E-expert-workspace-admission.test.ts`, `E2E-team-admission.test.ts`, `E2E-checkout.test.ts`, `E2E-cognitive-console.test.ts`, `E2E-contained-workspace.test.ts`, `E2E-remote-workspaces.test.ts`, `E2E-mobile-remote.test.ts`, `E2E-red-journeys-evidence.test.ts`, `E2E-workspace-session-ux.red.test.ts`. Each calls `chromium.launch()` inside the test (several per file), so there is no shared browser.
- Helpers:
  - `test/helpers.ts`: `withTempHome` (48), temp home and store schemas.
  - `test/wb-helpers.ts`: `seed` (76), `seedWorkspaceOnly` (86), `createTask` (121), `acceptTask` (130), `waitUntil` (26, 8 s default), `waitForCompletion` (46), `allEvents` (53), `gitIn` (150).
  - `test/expert-helpers.ts`: `withExpertApp` (48), `configureDefaultRoutes` (119), `waitForState` / `waitForAssignment` / `waitForRun` (144-162, 20 s default).
  - `test/support/remote-authenticator.ts`: software WebAuthn authenticator (CBOR, COSE) for the remote/mobile tests.
  - Jest-style UI unit tests: `test/ui-*.test.tsx`, 15 files (e.g. `ui-contained-workspace`, `ui-runtime-execution`). Not inspected further; check whether they use a DOM shim.
- Duration: **not measured** (tests were not run). Per-test timeout is 15 s; expert helper waits go to 20 s.
- Screenshots: each Playwright test writes PNGs via a local `shot(page, name)` helper, e.g. `E2E-workbench.test.ts:13` -> `join(SHOTS, `${name}.png`)`. Output directories under `/home/sprime01/projects/cognate-workbench/screenshots/`: `workbench` (1.8 MB), `red-journeys` (724 KB), `experts-debt` (648 KB), `concurrency` (444 KB), `experts` (388 KB), `containment` (180 KB). Naming: `<area>/<journey>-<step>.png` (follow the existing `E2E-workbench` names).
- Note: no existing Playwright test covers the Settings close button, the config dialog, or the first-run flow. `J-CFG-config-path.test.ts` and `J-CFG-model-provider.test.ts` cover the capabilities only.

---

## 5. Design tokens inventory

File: `/home/sprime01/projects/cognate-workbench/src/ui/app.css` (3563 lines).

### 5.1 Defined tokens

- Light `:root` block: `app.css:10-69`. 42 custom properties:
  - Surfaces and text: `--cg-bg`, `--cg-surface`, `--cg-surface-raised`, `--cg-surface-sunken`, `--cg-border`, `--cg-border-strong`, `--cg-text`, `--cg-text-muted`, `--cg-text-faint`.
  - Accent and states: `--cg-accent`, `--cg-accent-contrast`, `--cg-accent-interactive`, `--cg-accent-interactive-contrast`, `--cg-danger`, `--cg-danger-bg`, `--cg-success`, `--cg-hover`, `--cg-active`.
  - Messages and code: `--cg-message-bubble-bg`, `--cg-message-bubble-text`, `--cg-code-bg`.
  - Elevation: `--cg-shadow`, `--cg-shadow-consequential`.
  - Graphite: `--cg-graphite`, `--cg-graphite-ink` (defined, **never referenced**).
  - Radii: `--cg-radius-xs`, `-sm`, `-md`, `-lg`, `-xl`, `--cg-radius-panel`.
  - Layout: `--cg-sidebar-width`, `--cg-sidebar-min`, `--cg-sidebar-max`, `--cg-sidebar-collapsed`, `--cg-center-min`, `--cg-chat-column-max-width`.
  - Type: `--cg-font-display`, `--cg-font`, `--cg-font-mono`. Motion: `--cg-ease-out`.
- Dark overrides: `app.css:70-102` (media query, guarded by `:root:not([data-theme="light"])`) and `103-117` (`:root[data-theme="dark"]`). About 25 unique properties are overridden; the rest inherit from light.

### 5.2 Referenced but never defined (falls back to the `var()` fallback, or to nothing)

These appear in `var(--...)` with no definition in `app.css` (checked by grep): `--cg-fg-muted` (12 uses), `--cg-muted` (3), `--cg-focus` (3), `--cg-paper-2` (2), `--cg-panel` (1), `--cg-mono` (1), `--cg-fg` (1), `--cg-radius` (1), `--cg-danger-text` (1), `--cg-danger-border` (1), `--cg-content-font-size` (1), `--cg-accent-soft` (1), `--cg-accent-hover` (1). Any use without a fallback renders with the initial value (usually transparent or inherit). Fix: alias them to real tokens or remove them.

### 5.3 Hard-coded colors

- `var(--...)` fallbacks with a literal: 146 occurrences of `var(--cg-x, #hex)`. Most common fallbacks: `#6b7280` (muted text, 28 literals outside `:root`), `#d7dbe0` (border, 29), `#2f6feb` (focus accent, 10), `#9aa0a6` (faint text), `#f3f4f6` / `#f6f8fa` (hover), `#d1d5db` (border), `#4176e6`, `#0a84ff`, `#c0392b` (danger), `#1f2328`, `#1b1d22`, `#33393f`, `#f4f6f8`, `#b07b10` (warning, not tokenized).
- Literal colors outside `:root` (lines 118 onward): `#fff`/`#ffffff` (24 total), `rgba(27,29,34,0.08)` (7), `rgba(15,17,21,0.4)` (modal backdrop, `app.css:2012` region), `oklch(0% 0 0 / 0.5)` and `/0.4`, `oklch(72% 0.15 152)`, `oklch(68% 0.17 25)`, `oklch(52% 0.15 305)`, `oklch(28% 0.05 256)`, `rgba(198,40,40,...)`, `rgba(217,48,37,0.08)`, `rgba(26,127,55,0.08)`, and similar one-offs.
- Summary: the token system is partly bypassed. The fallback hex values duplicate the token values (for example `#d7dbe0` equals the light `--cg-border` family but is not the same oklch value, so the two can drift). Dark mode is not checked for fallback-only colors; in dark mode `var(--cg-border, #d7dbe0)` resolves to the defined token, but any color missing from `:root` stays light.
- Reference: `DESIGN.md` documents the intended tokens (not reviewed in detail here).

---

## 6. Five root causes (summary)

1. **Config viewer is a download-and-facts popup, not an editor.** `ConfigFileDialog` (`src/ui/App.tsx:1595-1700`) calls `config.path` (`src/capabilities/configPath.ts:29`), which only reports existence and a generated export. No capability reads or writes `cognate.config.json`. An editable side panel needs `config.file.read` and a validated, versioned `config.file.write` (section 3a).
2. **Settings and modal close buttons are placed inconsistently.** `.dialog-banner` has no base CSS (`app.css` only scopes it at 3133), so the shortcuts and add-workspace dialogs stack the x under the title on the left. Settings uses a flex titlebar (`app.css:2041`) but no shared header component exists (section 3b; verify with a screenshot).
3. **First-run API-key step discards its input and lacks the provider form.** `FirstRunApiKey` (`src/ui/App.tsx:585-620`) only captures a password, and its "Save and continue" does not persist it. The full provider form lives in `SettingsModels` (`App.tsx:1701-2234`) and is backed by `model.configure` (`src/capabilities/modelConfigure.ts:27`) and `provider.delete` / `model.catalog` (`src/capabilities/providerManage.ts:34`). Extract a shared `ProviderWizard` and reuse it (section 3c).
4. **Directory autocomplete is single-level, case-sensitive, and skips symlinks and non-`/` paths.** `src/ui/DirectoryField.tsx:68` gates on `startsWith("/")`, and `src/capabilities/workspaceDirectorySuggest.ts:97` filters `kind === "directory"` with `startsWith(prefix)` on one listed level (section 3d; reproduce before fixing).
5. **Windows launch opens a console and no browser.** The NSIS shortcut runs `cognate-workbench.exe start` (`scripts/installers.ts:143`), built without `--windows-hide-console` (`scripts/package.ts:84`), and `src/cli.ts` `start()` never opens a browser. Fix first with cross-platform auto-open (option i), then hide the console (ii) with a stop path (section 3e).

Additional finding (outside the five, but relevant to production readiness): user-configurable keyboard shortcuts are stored and validated, but `resolveKeypress` (`src/shortcuts.ts:195`) has no production caller, so `new-session`, `toggle-sidebar`, `open-settings`, and `open-shortcuts` do not fire from the keyboard.
