# R1: PandaCode UX inventory (for adapting its UI/UX into another agent-harness app)

Source studied: `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode` (v0.3.56, Tauri 2 + Vite + vanilla TypeScript).
Method: static reading of `src/*.ts`, `src/*.css`, `src-tauri/tauri*.json`, `src-tauri/src/*.rs` (leanrea "explain a feature from source" method). No code was run. No source file was modified.

Conventions:
- All refs are relative to the donor root. `src/main.ts:312` means `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode/src/main.ts` line 312.
- "Not found" means a grep of `src/*.ts` and `src/*.css` returned nothing. It is not a claim about behaviour in other code paths.
- "Seen" = read in source. "Inferred" = deduced from naming or structure, not executed.
- The app is a single imperative DOM app. `src/main.ts` (5067 lines) builds the whole shell as one template string at `src/main.ts:312-333` and then drives it with `morph()`/`innerHTML` renders. Most feature modules are self-contained "mount" functions that take a host element and return a controller with `dispose()`.

---

## 0. Architecture facts that shape the UX

| Fact | Ref |
|---|---|
| Entry dispatches on `?view=`: `launcher` (overlay), `tray` (menu-bar popover), default (full workspace). | `src/entry.ts:1-10` (seen) |
| Shell markup is one template literal assigned to `#app`. | `src/main.ts:312-333` |
| `index.html` is an empty `<div id="app">` plus `/src/entry.ts`. Title "PandaCode", theme-color `#1c1c1b`. | `index.html` (seen, 1 line) |
| Feature panels are "mount" modules (`mountSettings`, `mountDiffViewer`, `openProjectPicker`, `showChoices`, `mountChangesView`, `createFileTabs`, ...). Each owns its DOM and listeners. | e.g. `src/settings.ts:116`, `src/diff-viewer.ts:62`, `src/project-picker.ts:15`, `src/choice-menu.ts` |
| Global menus share one "pending menu" epoch so opening one closes the others. | `src/main.ts:886-895` |
| Single modal host `<dialog id="dialog">` is reused for almost every modal, via `modal(title, body, cls)`. | `src/main.ts:3438-3451`, shell `src/main.ts:333` |
| Browser preview mode (no Tauri) is a real mode: `preview = !('__TAURI_INTERNALS__' in window)`. It shows "Browser preview · sample data" and uses fixed sample data. | `src/bridge.ts:3`, `src/main.ts:325` (header), `src/preview*.ts` |

---

## 1. App shell and layout regions

### 1.1 Overall grid (three columns + bottom drawer)

Shell markup (seen): `src/main.ts:312-333`.

```
.workspace (CSS grid, height 100%)
 ├─ aside#workspace-sidebar.sidebar        column 1: --sidebar-width
 ├─ main.main-pane                         column 2: minmax(--conversation-min-width, 1fr)
 │   ├─ header.workspace-header            55px tall (--titlebar-height)
 │   ├─ .work-area                         board / github / conversation sections
 │   └─ #terminal-drawer.terminal-drawer   bottom drawer, inside main-pane
 ├─ section#settings-page                  full-page overlay (hidden unless open)
 └─ aside#inspector.inspector              column 3: --inspector-width
#toast (fixed), dialog#dialog (modal)
```

Grid definitions:
- Base: `grid-template-columns: var(--sidebar-width, var(--sidebar-default-width)) minmax(var(--conversation-min-width),1fr) var(--inspector-width,302px)`. `src/styles.css:30`.
- Inspector closed: two columns only. `src/styles.css:31`.
- Breakpoints (`src/styles.css:494-516`, `src/sidebar-resize.css:16-21`):

| Viewport | Sidebar default | Conversation min | Inspector default | Notes |
|---|---|---|---|---|
| >=1450px | 250px | 420px (base) | 330px | `styles.css:494-496` |
| base (921-1449) | 235px (JS default) | 420px | 302px | `styles.css:30`, `src/sidebar-resize.ts:73` |
| <=1100px | 205px | 365px | 270px | `styles.css:499-501` |
| <=920px | 195px | 330px | none in grid; inspector becomes an absolute overlay (`top:55px; bottom:28px; right:0; z-index:8; box-shadow:-20px 0 40px rgb(0 0 0/.07)`) | `styles.css:507-510` |
| <=650px | grid column 58px (icon rail look); `.brand` height 65px centred; inspector `min(320px, 100vw-59px)` | | | `styles.css:514-516, 547` |

Collapsed sidebar: `.workspace.sidebar-collapsed` removes the sidebar column. `src/sidebar-resize.css:16-21`.

### 1.2 Title bar / header row (55px)

- Height `var(--titlebar-height)` = `calc(55px / var(--page-zoom,1))`. `src/styles.css:1`. Header rule `src/styles.css:94`.
- The native macOS title bar is an overlay: `titleBarStyle: "Overlay"`, `hiddenTitle: true`, traffic lights at `x:14, y:29.5`. `src-tauri/tauri.conf.json` (window block). `--traffic-light-gutter: calc(104px / var(--page-zoom,1))` reserves space left of the header when the sidebar is collapsed (`src/sidebar-resize.css:18`, `src/styles.css:1`).
- Regions are marked `data-tauri-drag-region` (window drag). Header uses `data-tauri-drag-region="deep"`. `src/main.ts:325`.

Header contents, left to right (seen, `src/main.ts:325`):
1. **Sidebar toggle** (`#sidebar-toggle`, aria "Hide sidebar", `aria-keyshortcuts="Meta+B Control+B"`, 28x28, icon 17px). Toggles `state.sidebarCollapsed`, persisted in `pandacode.sidebarCollapsed`. `src/main.ts:1934-1941`.
2. **Breadcrumb** `#breadcrumb`: chat icon + "Chat", or folder icon + project-name button (`data-action="select-project"`), or bot crumb. `src/main.ts:1209`.
3. Right cluster `.header-actions`:
   - Preview badge "Browser preview · sample data" (preview mode only).
   - `#update-status` pill "Restart to update" (hidden until an update is staged).
   - **View switch** segmented group `role=group aria-label="Workspace view"`: Conversation (chat icon), Board (board icon), GitHub (github icon). Each has `aria-pressed`. `src/main.ts:325`.
   - **Run** (`#run-project-button`, play icon + "Run", `hidden` until the project has a run script). `src/main.ts:325`, runner in `src/run-project.ts`.
   - **Deploy** (`#deploy-button`, upload icon). `src/main.ts:325`.
   - divider, **Moodboards** (images icon), **Browser** (`#browser-toggle`, globe icon), **Terminal** (`#terminal-toggle`, terminal icon, tooltip "Toggle terminal (⌘ J)", `aria-controls=terminal-drawer`), divider, **Inspector** (`#inspector-toggle`, panel icon, tooltip "Toggle inspector (⌘ ⇧ B)"), **Task actions** (`#task-menu-trigger`, "more" icon, `aria-haspopup=dialog`).
   - Icons only, labels only through `title`/`aria-label`. Source: `src/main.ts:325`, `src/dom.ts:97` (`button()` helper).

### 1.3 Left sidebar ("Projects and tasks")

Markup: `src/main.ts:313-323`. Width is user-resizable (section 1.6).

Top to bottom:
1. **Brand** `.brand` with "PandaCode" (`.brand-name`). Height 65px at <=650px. `src/main.ts:314`, `src/styles.css:1,515`.
2. **Action row** `.sidebar-actions`:
   - `New task` (primary yellow `.new-task-button`, plus icon, `<kbd>⌘ N</kbd>`).
   - `New chat` (`.new-chat-button`, chat icon, title "New chat (no project)").
   - `Search` (`.search-trigger`, search icon, `<kbd>⌘ K</kbd>`). Opens the command palette ("Go to anything", section 9.1).
3. **Project row** `.sidebar-projects`:
   - `#project-filter` dropdown label "All projects" (or the chosen project with its app icon). Opens a searchable project picker (section 5.3).
   - `#sidebar-sort` icon button (aria "Sort and view", `SORT_ICON` swap arrows), opens a choice menu (section 6.4).
   - Import conversations (download icon, `#import-trigger`).
   - Open project (plus icon, `data-action="add-project"`, aria "Open project").
4. **Task filter** `.sidebar-search`: search icon, `<input#sidebar-filter type=search placeholder="Filter tasks" maxlength=200 aria-keyshortcuts="/">` and a clear button (close icon) that appears when non-empty. `src/main.ts:317`.
5. `#navigation.navigation`: the task list (sections in section 6).
6. `#sidebar-note`: one-line note ("N more in other projects · Show all") when a project filter hides tasks. `src/main.ts:1156`.
7. `#sidebar-bots-panel` / `#sidebar-bots`: bots (separate feature, not inventoried in depth).
8. **Bottom bar** `.sidebar-bottom` (icon buttons, 4 fixed plus theme), `src/main.ts:322`:
   - Help & support (`#support-button`, help icon).
   - Agent usage (`#agent-usage-button`, activity icon).
   - Archived tasks (`#archive-toggle`, archive icon, toggles `.archive-view`).
   - Settings (gear icon, tooltip "Settings (⌘ ,)").
   - Theme toggle (`#theme-toggle`, sun/moon, `aria-pressed`).
   At <=650px `.sidebar-bottom` stacks vertically. `src/styles.css:808`.

Sidebar styling: background is `var(--sidebar)` with a subtle accent radial gradient on top (190px). `src/styles.css:32, 748`.

Collapse behaviour: when collapsed the sidebar column disappears and the header gets `--traffic-light-gutter` padding on macOS (`src/sidebar-resize.css:18`). The inspector is unaffected. Focus moves out of a hidden sidebar. `src/main.ts:1934-1941`.

Empty state: no project and no chats: text "Open a project to get started." `src/main.ts:1163`.

### 1.4 Main conversation pane (`.conversation-pane`)

Inside `.work-area` (`src/main.ts:326`), in this order:
1. `#file-tabs.file-tabs` (role=tablist, 34px tall; "Conversation" tab first, then one tab per open file). Section 2.3.
2. `#file-view.file-view` (role=tabpanel, hidden unless a file tab is active; covers the conversation but keeps it mounted).
3. `#task-details-heading`.
4. `#subagents-host` (sub-agent progress panel).
5. `#transcript.transcript` (role=log, aria "Conversation", `overflow-y:auto`, padding `28px 36px 25px`, width capped by `.composer-area` at 950px). `src/styles.css:106`.
6. `#composer-area.composer-area` (approval bar, context bar, queue, composer form, footnote). Section 4.
7. `#composer-live` (sr-only status).

Board view replaces the conversation pane (`#project-board`, section 7.3). GitHub view replaces it with `#github-hub` (section 7.4).

### 1.5 Bottom drawer: terminal

- `#terminal-drawer.terminal-drawer`, inside `main.main-pane` below the work area. Default height 245px, min 150px, max 50vh, `flex-shrink:0`, `border-top:1px solid var(--border)`. `src/styles.css:413`.
- Heading `.drawer-heading` 37px tall, `padding:0 16px`, background `#f7f7f5` (dark: `var(--panel)`). `src/styles.css:414, 784`.
  - Left: terminal icon + project name (muted, `.muted`).
  - Middle: `role=tablist` `.terminal-tabs` (one per shell).
  - Right: buttons with `data-terminal-action`: `new` (plus, "New terminal"), `minimize` (minimize icon, "Minimize terminal"), `close` (X, "Close terminal", `aria-haspopup=dialog`). `src/main.ts:327`.
- Body `#terminal-host` is xterm (`@xterm/xterm`, `@xterm/addon-fit`). `package.json` dependencies.
- Toggle: header button or Command/Ctrl+J (`src/main.ts:4937`, global keydown at `src/main.ts:4929`).
- Terminal tabs keyboard: `src/terminal-panel.ts:33`.
- Closing a task deletes its terminal tabs ("Its terminal tabs close and running commands may stop"), `src/main.ts:3992`.

### 1.6 Resize handles

Same module for both side panels: `src/sidebar-resize.ts:1-178` (`initializeSidebarResizing(workspace, sidebar, right)`).

- Sidebar handle: separator element appended inside `.sidebar`, class `.sidebar-resize-handle`, role=separator, aria-orientation vertical. Label "Resize sidebar". `src/sidebar-resize.ts:10-21`.
- Inspector handle: same, class `.inspector-resize-handle`, label "Resize right sidebar". Occupies the left edge of the inspector (`inset:0 auto 0 0`, inner line `inset:8px auto 8px 0`). `src/sidebar-resize.css:23-24`.
- Limits: sidebar 190..440px. Inspector 270px..(remaining viewport minus a 420px conversation minimum), hard cap 10000. `src/sidebar-resize.ts:5-6, 89-96`.
- Pointer: drag with pointer capture. Cursor `col-resize` while dragging. Esc cancels a drag. `src/sidebar-resize.ts:127-148`, `src/sidebar-resize.css:4`.
- Keyboard: Left/Right arrows move 8px; Shift = 32px steps; Home/End go to min/max. Escape cancels a drag. `src/sidebar-resize.ts:150-165`.
- Double-click resets to the responsive default. `src/sidebar-resize.ts:166`.
- Persistence: `pandacode.sidebarWidth`, `pandacode.inspectorWidth` (localStorage). `src/sidebar-resize.ts:6-8`.
- Hidden when: viewport <=650px (sidebar handle only), board view, or the sidebar is hidden. `src/sidebar-resize.css:6`, `src/sidebar-resize.ts:83-88`.
- Inspector default width after a reset is "wider Browser default" when a browser tab is open. `src/sidebar-resize.ts:102-104`.

### 1.7 Close (X) placement rules

| Surface | Where the X sits | Ref |
|---|---|---|
| Modal dialog (`#dialog`) | Top-right of the heading row (`.dialog-heading`, flex, space-between). Icon button 26x26, aria "Close dialog". | `src/main.ts:3441-3443`, `src/styles.css:427-431` |
| Settings | Not an X. A **Back** button at top-left of the settings nav ("Back to the workspace", tooltip "Back (Esc)"). | `src/settings.ts:118` |
| Inspector tab | X inside the tab chip, on its right edge, shown only when 2+ tabs are open. Last tab cannot be closed. | `src/main.ts:3225-3232`, `src/inspector-tabs.ts` (closeTab), `src/main.ts:1921-1927` |
| Inspector panel | "Hide inspector" icon at the right end of the inspector strip (`.inspector-hide`). | `src/main.ts:330` |
| Editor (file) tab | X on the right of each file tab, aria "Close <name>", tooltip "Close (Delete)". | `src/file-tabs.ts:71` |
| Terminal drawer | X at the right end of the drawer heading, aria "Close terminal". | `src/main.ts:327` |
| Launcher (overlay) | X at the top-right of the launcher heading, aria "Close launcher". | `src/overlay.ts:17` |
| Model/project/choice menus | No X. Dismiss by Esc or outside pointer. | `src/model-picker.ts:399-428`, `src/project-picker.ts:143-169` |
| Browser panel | "Close browser" X at the right of the location bar (`data-browser-action="close"`). | `src/browser.ts:44` |

Consistent rule: X buttons are **right-aligned** in every heading, tab and drawer. Dialog footers put Cancel to the left of the primary action.

### 1.8 Modal host and overlays

- `dialog#dialog` is one element reused for every modal. `modal(title, body, cls)` sets `aria-label`, writes the heading + X + body, and calls `showModal()`. Long descriptions move behind an info mark. `src/main.ts:3438-3452`.
- Scrim and plate: `installDialogMotion()` adds `.dialog-scrim` and `.dialog-plate` siblings with spring motion. `src/motion.ts:352`.
- Dialog size: `width: min(475px, 100vw-32px)`, `max-height:85vh`, padding `20px 22px 18px`, radius `var(--sheet-radius,3px)`, transparent native chrome. `src/styles.css:425`.
- Backdrop click closes the dialog (only when the press started and ended outside the plate). `src/main.ts:4993-4997`.
- Closing the dialog runs `closeMenus()` and disposes settings views. `src/main.ts:3473`.
- Floating menus (`.floating-menu`, `position:fixed; z-index:80; width:360px; max-height: calc(100vh - 24px); padding:6px`). `src/styles.css:639`.

### 1.9 Toast and status

- `#toast.toast` is fixed at `bottom:45px`, centred, `width:fit-content`, role=status, `hidden` by default. `src/main.ts:333`, `src/styles.css:420`.
- Auto-hide 4.5s; 5s when it carries an Undo. `src/main.ts:844-855`.
- Undo button `.toast-undo` (aria-keyshortcut Meta+Z / Control+Z). Cmd/Ctrl+Z triggers it while the toast is up. `src/main.ts:3939-3942`.
- Only one toast at a time: a new `notify()` replaces the text and bumps `toastGeneration`. `src/main.ts:845`.
- Errors route through `report(error)` which logs and calls `notify(message)`. `src/main.ts:861`.

### 1.10 Resize of the whole UI (zoom)

- Interface size: 80%..160% in 10% steps. Command/Ctrl + `+` / `-` zoom, Command/Ctrl + `0` resets. In the native app it calls `webview.setZoom()`; in browser preview it scales only the root font. `src/ui-size.ts:4-27, 52-56` (seen), CSS `src/ui-size.css:1`.
- Root font is `calc(14px * var(--ui-scale,1))`. `src/ui-size.css:1`.
- Settings row "Interface size" with an output field `-` `+` buttons. `src/ui-size.ts` (`uiSizeControls`).

---

## 2. Right-side viewer / inspector panel

### 2.1 Panel shell

- `aside#inspector.inspector` (aria "Project inspector"). Column 3 of the grid. Default width 302px; see 1.1 for breakpoints. Background `var(--panel)`, border-left `1px solid var(--border)`. `src/main.ts:330`, `src/styles.css:510, 547`.
- Visibility: `state.inspector` plus `inspectorChosen`. Toggle header button or Cmd/Ctrl+Shift+B (`src/main.ts:4943-4946` region, global keydown `src/main.ts:4929`).

### 2.2 Inspector strip (tab bar, 55px high)

Markup: `src/main.ts:330`. Layout CSS: `src/inspector-bar.css:1-12`.

- `.inspector-strip`: 55px tall (`var(--titlebar-height)`), `padding: 0 4px 0 6px`, bottom border.
- `nav.inspector-tabs` (role nav, aria "Panel views"): horizontally scrollable, scrollbar hidden. Each tab is a `.inspector-tab` (26px tall, radius 4px) containing:
  - `.inspector-tab-button` with icon (14px) and label (hidden on narrow widths, text in `.inspector-tab-label`). Selected tab: `background: color-mix(text 9%)` + inset 1px ring.
  - `.inspector-tab-close` X (only if 2+ tabs open).
- Eight possible views, in menu order (`src/inspector-tabs.ts`, `INSPECTOR_VIEWS`), with titles and icons from `src/main.ts:96-98`:

| View id | Title | Icon | Availability | Ref |
|---|---|---|---|---|
| files | Files | file | all | `main.ts:96` |
| search | Search | search | all | `main.ts:96` |
| changes | Changes (count badge `#changes-count`) | branch | all | `main.ts:96` |
| browser | Browser | globe | all | `main.ts:96` |
| pull | Pull request | pull | only when the task has a linked PR and GitHub is on | `main.ts:3237-3238` |
| simulator | Simulators (tooltip "iOS & Android simulators") | phone | macOS or Windows only | `main.ts:99` |
| vm | Virtual machines | monitor | macOS only | `main.ts:99` |
| design | Design (tooltip "Design canvas") | sketch | all | `main.ts:96-98` |

- `+` button `#inspector-add-tab` ("Open a view", aria-haspopup dialog) appears only if some views are closed. It opens a choice menu titled "Open view" (width 240) listing the closed views with icons. `src/main.ts:3244-3247`.
- Tabs persist per device: `pandacode.inspector.tabs`. Default is `{open:['changes'], selected:'changes'}`. Unknown or unavailable views are dropped. `src/inspector-tabs.ts:1-45`.
- Closing a tab hands selection to the right neighbour, else the left. The last tab cannot close. `src/inspector-tabs.ts:closeTab`.
- Closing the selected tab with focus returns focus to the new selected tab. `src/main.ts:3209-3241` (closeInspectorTab).
- Tab overflow: the strip scrolls so the selected tab stays in view. `src/main.ts:3225` (renderInspectorTabs).
- Right side of strip: `#inspector-refresh` ("Refresh project", refresh icon) and "Hide inspector" (`.inspector-hide`, panel icon). `src/main.ts:330`.

Hidden `h2#inspector-title.sr-only` holds the active view name for assistive tech. `src/main.ts:330`.

### 2.3 Content area

`#inspector-content.inspector-content` (flex 1, scrolls). Child panels are shown or hidden by view: `#browser-panel`, `#simulator-panel`, `#vm-panel`, `#design-panel`. `src/main.ts:330`.

#### Files view (tree)

- Tree rows: `div.file-row` with `--depth` indentation; a folder is a button with `data-action="toggle-file-folder"`, a file is `open-file` (or `preview-file` for previewable documents that do not open in a tab). `src/main.ts:3273-3278`.
- Open folders list children inline (VS Code style). Folder open state is in `state.openFolders`; children cached in `state.folderFiles`. `src/main.ts:3280-3300`.
- Focus is restored to the same folder row after the tree redraws. `src/main.ts:3284-3287`.
- Icons: material-icon-theme file-type icons (`src/file-icons.ts:3`, `src/dom.ts` `fileIcon`).
- Empty folder: "This folder is empty." No project: "Open a project to browse files and review changes." `src/main.ts` (inspector-empty strings).
- Clicking a file opens it as an editor tab in the conversation (section 2.4). Right-click / context menu on files: **Not found**.

#### Search view

- Form with input `aria-label="Search in files"`, `placeholder="Search"`, `maxlength=512`. `src/search-panel.ts:51`.
- Toggles (buttons with `aria-label`/`title`): **Match case** (`Aa`), **Match whole word** (`ab`), **Regex**. `src/search-panel.ts:20`.
- Results split into "Matching file names" and "Text matches" (`src/search-panel.ts:102-103`).
- Debounce 250ms (`src/search-panel.ts:19`). Enter/submit runs immediately (`src/search-panel.ts:54`).
- Escape closes the search (`src/search-panel.ts:22`).
- States: "Searching…" (`src/search-panel.ts:93`); truncated results note; no separate empty copy located.

#### Changes view (git/jj)

Mounted by `mountChangesView` (`src/changes-view.ts`). Details:
- Header `.cv-header`: scope button (branch icon + scope label + caret, aria-haspopup menu), counts (files, additions, deletions), optional branch label, spacer, **Collapse all** (fold icon, toggles `aria-pressed`), **More actions** (kebab). `src/changes-view.ts:~95-106`.
- Commit form `.cv-commit` (its `hidden` attribute is toggled by code; the exact condition was not traced): input `placeholder`/`aria-label="Commit message"` and `Commit` submit. `src/changes-view.ts:98-106`.
- Body `.cv-body` with file groups.
- Per-file menu (choice menu): Stage file / Unstage file / Open file (disabled for deleted files) / Copy path. `src/changes-view.ts:401-404`.
- More-actions menu: Stage all (disabled if none unstaged), Unstage all, Commit… (disabled if not a repo), Refresh, Create isolated worktree… (only when git). `src/changes-view.ts:435-439`.
- States: "Loading changes…", "Not a Git repository", "Working tree clean". `src/changes-view.ts:307-311`.
- Diff loading: "Loading diff…". `src/changes-view.ts:200, 216`.
- Clicking a file opens its diff via `git_diff` and the Diff viewer (2.5) when the panel is in changes mode. Open file goes to the Files tab.

#### Browser view

Section 2.6.

#### Pull request view

Section 7.4 (GitHub). Shown in inspector only for tasks with a linked PR.

#### Simulators, Virtual machines, Design

- Simulators: iOS & Android simulator stage, duo view, 3D hardware (`src/simulator*.ts`). macOS or Windows only.
- VM: remote VM panel with a screen and `right_click` forwarding (`src/vm-panel.ts:210`). macOS only.
- Design: design canvas with pick, comment, select (`src/design-canvas.ts:165, 230`). Escape cancels pick/comment (`src/design-canvas.ts:230`).

### 2.4 Editor tabs (files opened from the tree, search, or file links)

Source: `src/file-tabs.ts` (187 lines). Mounted as `#file-tabs` and `#file-view` inside the conversation pane.

- Tab strip `.file-tabs`: `height:34px`, horizontally scrollable, scrollbar hidden. Tabs `max-width:220px`, right border. `src/file-tabs.css:2-3`.
- First tab is always **Conversation** (chat icon) and maps to `#transcript`. `src/file-tabs.ts:72`.
- Each file tab: `role=tab`, file-type icon, file name (`title` = full path), and an X (`data-file-tab="close"`, aria "Close <name>", tooltip "Close (Delete)"). `src/file-tabs.ts:71`.
- Tabs are per task: `Thread` entries keyed by workspace (`src/file-tabs.ts:Thread`). Switching tasks restores the task's tabs.
- Keyboard on the strip: Left/Right move between tabs (wraps), Home/End jump to first/last, Delete closes the active file tab. `src/file-tabs.ts:141-150`.
- The file view covers the conversation (which stays mounted but inert) so the transcript scroll position is kept. `src/file-tabs.ts:1-3`.

File view header `.file-view-header` (`src/file-tabs.ts:77`):
- Path (`.file-view-path`, `title` attribute holds full path).
- **Preview in browser** (globe icon, only for previewable files: `isPreviewableFile`).
- **Copy file** (copy icon, text files only).
- **Attach** (`data-file-tab="attach"`, paperclip icon + "Attach"), shown when `canAttach(context)` (task shown and attachments allowed).

Body (`.file-view-body`):
- Loading: "Loading file…" (`role=status`). Error: "This file could not be opened: <message>" (`role=alert`). `src/file-tabs.ts:79, 93`.
- Text and code: `renderDocument()` (section 2.5, `src/document-viewer.ts:99`).
- PDF, Word (docx), spreadsheets (xlsx/xlsm/xls/ods), images (png/jpe?g/gif/webp/avif/bmp/ico/svg): lazily loaded `office-viewer` (`src/file-tabs.ts:20-24, 82-88`, `src/office-viewer.ts`).
- SVG opened from a link shows as text (`source` flag). `src/file-tabs.ts:12`.

**Editable?** No. The file viewer is read-only. There is no editor component (no textarea, Monaco, or CodeMirror was found; `grep contenteditable|monaco|codemirror` returned nothing in `src`). The only write path back into the code is **Attach** (adds the file as context to the next message, max 5 files, see 4.4). Save: not applicable. Not found in source: a way to save or edit a file from PandaCode.

### 2.5 Document renderer (what the file view shows)

`renderDocument(host, path, content, imageLoader)` (`src/document-viewer.ts:99-107`):
- Code files: `codeLines()`, line-numbered raw view, wrap toggle.
- Markdown: rendered article (`doc-reader markdown`) with a view toggle (rendered or raw). `views` map per kind.
- Plain text: paragraphs (`doc-reader doc-plain`).
- Toolbar per document: view toggle, wrap toggle, copy (`toolbar(kind, view, wrap, content)`). `src/document-viewer.ts:107`.
- Images referenced from markdown load through `workspace_image` (workspace-scoped, `src/file-tabs.ts:43-44`).

### 2.6 Diff viewer

`mountDiffViewer(host, input)` (`src/diff-viewer.ts:62-...`):
- Two layout buttons, `role=group aria-label="Diff layout"`: **Unified** and **Split**; plus a **Wrap lines** toggle. `src/diff-viewer.ts:82-95`.
- Split is disabled when the panel is narrower than 680px (`SPLIT_MIN_WIDTH`, `src/diff-viewer.ts:29`). Tooltip: "Widen the panel to use a split diff". `src/diff-viewer.ts:157-162`.
- Keyboard on layout buttons: Left/Home select unified, Right/End select split. `src/diff-viewer.ts:187-190`.
- Long patches show "Preview shortened to keep the app responsive." `src/diff-viewer.ts:150-152`.
- Reduced motion respected (`src/diff-viewer.css:103`).
- Plain-text fallback `pre` labelled "Plain text patch". `src/diff-viewer.ts:150`.
- Tool-call diffs in the transcript use a separate renderer, `tc-diff` rows with line numbers (`src/tool-cards.ts:232-236`).

### 2.7 Turn changes (in the conversation)

`src/turn-changes.ts`: after an agent turn, a card "Files changed during this turn" (`section.turn-changes`, `aria-label` as given). It shows +/- counts (`change-additions`, `change-deletions`), a folder tree of changed files (`details.turn-change-folder`, `button.turn-change-file` with `data-action="open-turn-diff"`), a **Run**-style action "Open diff" (`edit` icon), and an info mark for tracking notices. `src/turn-changes.ts:7, 28-44`.

---

## 3. Settings

### 3.1 How it is reached

- Sidebar bottom gear button (`data-action="settings"`, tooltip "Settings (⌘ ,)"). `src/main.ts:322`.
- Keyboard: Cmd/Ctrl+, (`src/main.ts:4947`). Command palette item "Settings" (`src/main.ts:4712`).
- `showSettings(section?)` (`src/main.ts:4035`) opens the page, optionally at a section. Also called from inside dialogs ("Back to settings").

### 3.2 Layout: full-page takeover (not a modal)

- `#settings-page` (`section`, aria "Settings") is a sibling of `.main-pane` and `.inspector`. When open, `.workspace.settings-open` hides the sidebar, main pane, inspector and resize handles (`visibility:hidden`). `src/styles.css:906`, `src/main.ts:4035-4049` (sets `.settings-open`).
- Grid: `.settings-page-root { grid-template-columns: var(--sidebar-width) minmax(0,1fr) }`. The left column reuses the sidebar width. `src/settings.css:3`.
- Left nav `.settings-nav` (panel background, right border): head row with **Back** button (`data-settings-close`, aria "Back to the workspace", tooltip "Back (Esc)"), title "Settings" (1.25rem, weight 650), then a vertical `role=tablist` `aria-label="Settings"` with one tab per section (icon + label, 32px tall). `src/settings.ts:118-122`, `src/settings.css:4-20`.
- Content `.settings-content` (scrolls). Each panel is `.settings-panel` (max 760px, centred, padding `44px 0 72px`), with a heading `h2` (1.6rem) and a description `p` (muted). `src/settings.css:21-26`, `src/settings.ts:123`.
- Keyboard: Up/Down move between tabs (wrap), Home/End jump; selection follows focus. `src/settings.ts:249-253`.
- Esc closes Settings when no dialog and no floating menu is open. `src/main.ts:4956`.
- Lazy: panels mount on first show; sections that fail to load show "This section couldn’t load. Close Settings and try again." `src/settings.ts:228`.

### 3.3 Sections (exact labels and descriptions, `src/settings.ts:57-68`)

| # | Label | Icon | Description (verbatim) |
|---|---|---|---|
| 1 | General | settings | Text size, conversation density and the quick launcher. |
| 2 | Appearance | sun | Theme, accent colors and wallpapers. |
| 3 | Agents | bot | Your default agent and the agent harnesses installed on this computer. |
| 4 | Providers | server | Sign-ins, API keys and plans such as GLM Coding Plan and MiMo Token Plan, each for the agent it belongs to. |
| 5 | Agent teams | grid | Named teams of models, and the classic team setup. |
| 6 | Tools & add-ons | widget | App tools, MCP servers, skills and Jev. |
| 7 | Skills & rules | widget | Import skills and rules once, turn them on per harness, and check for drift. |
| 8 | Cloud sandboxes | globe | Daytona, Cloudflare and AWS machines for your agents. |
| 9 | Remote access | server | Reach your other computers with PandaCode Connect, end-to-end encrypted. |
| 10 | GitHub | github | Issues, pull requests and repositories through the GitHub CLI. |
| 11 | About & updates | info | Version, updates, resource usage, license and support. |

Section contents (seen, `src/settings.ts:77-115`):
- **General**: Interface size control; switch "Compact conversation" (`#compact-mode`, "Less space between messages."); switch "Expand tool activity" (`#expand-tool-activity`, "Show grouped activity expanded by default."); heading "Quick launcher" (`#launcher-settings`); heading "Projects" (`#projects-settings`) when projects are passed.
- **Appearance**: Theme row (button "Use light/dark"); switch "Daily wallpapers"; heading "Colors" (summary of colors) with an embedded colors editor (`data-embed="colors"`); heading "Wallpapers" with an embedded gallery (`data-embed="wallpapers"`). Imported VS Code themes keep their own colors.
- **Agents**: "Default agent" (select button with provider logo, opens a dialog picker); "Default model" (select button); "Agent updates" row with a "Check updates" button (opens agent-updates dialog); switch "Project checks after turns" (runs the project's own test/check command at turn end; a failure queues one fix); per-harness diagnostic rows (`details.provider-diagnostic`, status dot, "Installed" / "Not installed", version or "Not reported") and a refresh button. `src/settings.ts:83-92`, `src/settings.ts:140-155`.
- **Providers**: per-harness panels (section 3.5).
- **Agent teams**: team configuration (`src/team-profiles.ts`, `src/agent-teams.ts`).
- **Tools & add-ons**: row "Tools & integrations" with a **Manage** button → modal "Tools & integrations" (`showAgentIntegrations`, `src/main.ts:4143-4149`, `src/integrations.ts`). Shows Jev as "Jev · Optional add-on" and MCP servers.
- **Skills & rules**: `#skills-library` (`src/skills-library.ts`), import, per-harness toggles, drift findings.
- **Cloud sandboxes**: Daytona, Cloudflare, AWS setup (`src/cloud-settings.ts`), "Set up sandboxes", "Claude login for cloud agents".
- **Remote access**: PandaCode Connect pairing (`src/remote-settings.ts`), code display "Enter this code at …", copy-code button (`data-copy`).
- **GitHub**: GitHub CLI status and sign-in hints (`src/github*.ts`).
- **About & updates**: version, "Check now" / "Install" / "Restart now", update mode, resource usage, license, support link (`src/about-settings.ts:21, 45, 62-65`), "Help & support" row "Open an issue on GitHub." (`src/settings.ts:111`).

### 3.4 "Open config file" / JSON editing

Not found as a feature. Specifically:
- No "Open config file", "Edit JSON", "settings.json", or "open in editor" action exists in `src/*.ts` (grep).
- Structured editors used instead:
  - **Named connections** form (per harness setup): Harness (select, disabled when editing), Name (required, max 60, placeholder "Claude Work"), Executable (placeholder "Leave empty to use the harness's executable"), Extra arguments (one per line, textarea), Config folder (placeholder like `/Users/you/.claude-work`, with a live env-var hint), Environment (rows of NAME / VALUE with a secret toggle and "Add variable"), footer Cancel / Save connection. `src/connections.ts:20-36`.
  - **Recipes** (workflow recipes) have a raw JSON textarea (`textarea.recipe-json`, aria "Recipe JSON") with Edit / Delete / Run and Save / Cancel. `src/recipes.ts:41-56`. This is the only raw-JSON editor in the UI.
  - Bots: instructions/soul/goals textareas (`src/bots.ts:230-249`).

### 3.5 Providers panel (keys and sign-ins)

Source: `src/provider-settings.ts` (228 lines), `src/settings.ts`.

Built-in harness panels (`src/provider-settings.ts:51-85`), each a `section` with an `h3` (provider logo + name):
Claude Code · GLM Coding Plan · MiMo Token Plan · OpenCode · Antigravity · Grok Build · Pi · Oh My Pi · DeepSeek · Command Code · Cline · GitHub Copilot CLI · Devin CLI · Kilo Code · Muse Code.

Field types seen:
- **API key form** (`keyForm`, `src/provider-settings.ts:41`): label (e.g. "MiMo API key"), `input type=password`, placeholder "Enter API key", autocomplete off, maxlength 4096, primary **Save key** submit. Status line `role=status` "Checking connection…", then a **Remove saved key** secondary button (hidden until a key is saved). Keys are stored by the native side (`provider_save_<id>_key`), never echoed back.
- **Claude connection mode** select (`#claude-connection-mode`) + **Check login** button (`data-check-claude`). `src/provider-settings.ts:52-54`.
- **Endpoint** select (MiMo) with placeholder "Choose your cluster…" and hint text (`#mimo-endpoint`, `aria-describedby` hint). `src/provider-settings.ts:65-67`.
- **Executable** field + "Choose…" (native file dialog, title "Choose agent executable") + **Apply** (`src/provider-settings.ts:191, 227`).
- **Named connections** (see 3.4).
- External link to the provider plan page with a forward icon (e.g. "Token Plan").

Validation seen: key length max 4096; connection name required and max 60; the executable path is chosen by the native dialog. Test connection: the key form checks the connection after save (status "Checking connection…"). A generic "Test connection" button with an arbitrary base URL does **not** exist.

### 3.6 Agents section specifics

- Default agent select opens a dialog picker (`#default-provider`, aria "Default agent for new tasks", haspopup dialog). Default model select (`#default-model`). `src/settings.ts:86-88`.
- Diagnostic rows show "Installed" / "Not installed" with a version string, expand on click (`<summary>` with aria "<name> details, Installed|Not installed"). `src/settings.ts:150-155`.

---

## 4. Composer (prompt area)

### 4.1 Structure (seen, `src/main.ts:1762`, insertion order `src/main.ts:1763-1790`)

Composer area `#composer-area` contains, top to bottom:
1. `#approval-bar` (approval requests, section 5.4). Inserted at the top of the area, so it is above everything else. `src/main.ts:1765`.
2. **Context bar** `.composer-context` (`worktrees.contextBar`, `src/worktrees.ts:68-84`): project chip (`#composer-project`, folder icon + name, button only for a new task so the project can be changed), computer chip (remote device, when applicable), local/worktree label (terminal or worktree icon + checkout name), branch chip (`#branch-chip`, branch icon, aria "Branch and worktree actions", menu), issue/PR chips for linked work.
3. Stacked notices above the form: cloud strip, remote start strip, remote-missing note, composer inline note, **limit banner** (usage limit with reset time and alternatives, only when not running), queue panel (section 4.5). `src/main.ts:1766-1768`.
4. `form#composer.composer` (radius 6px, shadow, `:focus-within` ring). Then `.browser-context-attachments` (browser element/screenshot chips) inside the form. `src/styles.css:246, 764`; `src/main.ts:1781-1783`.
5. Inside the form:
   - `#attachments.attachments`: attachment chips (images, documents, folders), each with a Remove button (aria "Remove <name>").
   - `textarea#prompt` (rows=2, aria "Message your coding agent"; aria-description changes per state).
   - `.composer-toolbar` (padding `0 10px 10px`), two groups:
     - Left `.composer-tools`:
       1. **Attach** (`button` "+" icon, aria/title "Attach files for context").
       2. **Model picker** `#model-picker-trigger.model-picker`: provider logo + model label + team model count + caret. Title "Choose harness and model" (or "Choose team profile and models" in team mode). Disabled when the model is locked.
       3. Separator.
       4. **Approval mode picker** `#mode-picker-trigger.mode-picker`: mode icon + label (e.g. "Standard", "Plan mode", "Accept edits", "Approve for me", "Full access", "Read only", "Ask when needed"). Disabled while running.
       5. Team button (`teamButton`, `src/main.ts:261`).
       6. Token-saver button (`tokenSaver.button`, `src/token-saver.ts`).
     - Right: **Steer** (only while running and not in team mode; spark icon + "Steer"; title "Send into the running turn (Enter)") then the **send control**:
       - idle: `.send-button` (arrow icon, aria "Send message", title "Send message (Enter)").
       - running: `.send-button.stop-button` (stop icon, aria "Stop task", title "Stop task (Esc)"; disabled while stopping → "Stopping…").
       - remote check / offline: "Checking…" or **Retry** (aria "Retry connection"; "Reconnecting…" while busy).
6. `.composer-footnote` (only for archived tasks: "Archived task"; plus context-usage indicator `.context-indicator`). `src/main.ts:1775-1780`.

### 4.2 Placeholders and labels (state-dependent)

Placeholder (`composerPlaceholder`, `src/main.ts:1218`):
- Bot thread: "Message <bot name>…"
- Chat (no project): "Ask anything…"
- Task: "Describe a task…"
- While running: "Queue a follow-up · ⌘↩ steers now" (team mode: "Queue a follow-up…") (`src/main.ts:1762`).

`aria-description`: "Enter to send. Shift Enter for a new line." when idle; "Enter to queue for when the agent finishes. Command Enter to steer the running turn." while running; appended "Type @ to mention a project file, issue, or pull request." when GitHub is connected (`src/main.ts:1781-1782`).

### 4.3 Keyboard (global handler `src/main.ts:4929-4958`, prompt-specific)

| Key | Context | Action | Ref |
|---|---|---|---|
| Enter | prompt, idle | send | `src/main.ts:4949-4954` |
| Enter | prompt, running | queue the message | same |
| Cmd/Ctrl+Enter | prompt, running | steer the running turn | `src/main.ts:4951` |
| Enter | prompt, finishing a stream | queue | `src/main.ts:4953` |
| Shift+Enter | prompt | newline (not intercepted) | `src/main.ts:4949` |
| Esc | running, terminal closed | stop task | `src/main.ts:4958` |
| Cmd/Ctrl+Enter | queue edit field | save edit | `src/main.ts:4955` |
| `/` at the very start of input | prompt | slash command menu | `src/slash-commands.ts:32` |
| `@` after whitespace or an opening bracket | prompt | file mention menu | `src/file-mentions.ts:25-27` |
| Cmd/Ctrl+V with an image | prompt | attach as image | `src/main.ts:4970` |
| Drag files onto the window | any | attach (images, text docs, folders) | `src/attachments.ts:237-238` |

### 4.4 Attachments

Source: `src/attachments.ts` (256 lines).
- Menu from the **+** button (`src/main.ts:496`, choice menu width 340): "Attach files…" (multi-select native dialog, title "Attach to your message"), "Attach a folder…" (native folder dialog), "Workflow recipes…".
- Limits (`src/attachments.ts:32-34`): 4 images, 5 documents, 3 folders per message. Messages: "Attach up to 4 images per message…", "Attach up to 5 documents per message.", "Attach up to 3 folders per message." (`src/attachments.ts:62-68`).
- Opening the file view's **Attach** adds a file to the message. Limit: 5 files per message. Message: "Attach up to 5 files per message." Duplicate: "File already attached." (`src/main.ts` `attachFile`). Attaching needs a task: "Start a task before attaching files."
- Paste: an image in the clipboard becomes an image chip. Text documents are read inline up to a cap; a binary dropped file shows the note "(dropped file; PandaCode could not read it or find its path)" and is written into the text. `src/attachments.ts:140-160`.
- Each chip shows name; Remove (`aria-label="Remove <name>"`). Chips sit above the textarea inside the composer.
- Toast on success: "Attached <name>" or "Attached N items" (not shown for paste). `src/attachments.ts:158`.
- Reading the transcript later: attachments appear as read-only chips under the message ("File context", "Document context", "Folder context", "GitHub context", "Browser element context", "Attached image"). `src/main.ts:1404-1412` (CONTEXT_BOUNDARY), `src/message-attachments.ts:77`.

### 4.5 Message queue (`src/message-queue.ts`, 29px-tall CSS rows)

Shown above the composer while there are queued messages, with header "Queued" and a count, and a hold label. Each row (numbered):
- Preview text (`title` = full text).
- **Steer** (spark icon, title "Send into the running turn", aria "Steer now: <preview>") while the agent runs and steering is available.
- **Send now** (arrow icon, aria "Send now: <preview>").
- **Edit** (edit icon, aria "Edit queued message N"). Edit mode is an inline textarea (`.queue-edit`, aria "Edit queued message") with **Save** and **Cancel**. Cmd/Ctrl+Enter saves.
- **Move up** / **Move down** (arrow icons, aria "Move queued message N up/down").
- **Remove** (close icon, aria "Remove queued message N").
- Busy state "Steering…" with a spinner.

### 4.6 Model picker (`src/model-picker.ts`, 463 lines)

- Floating menu `.model-menu.floating-menu`, width 380px (`src/styles.css:650`), anchored under the trigger, flips above if no room. Positioning in `src/project-picker.ts`-style code: `src/model-picker.ts`.
- Top: search input (aria "Search harnesses and models", placeholder "Search harnesses and models…").
- List grouped by harness (provider logo + name as a group heading, `h3`). Items: model name + description; "Use custom model" option for free text (`.model-menu-custom-label`).
- Recent models first, per harness (`RECENT_LIMIT`, localStorage keys per provider). `src/model-picker.ts:34-42`.
- Agent teams group ("Agent team · <name>") when teams exist. `src/model-picker.ts:261`.
- Reasoning effort control (`.effort-control`): a slider track `input.effort-range` with a "particles" animation, values from the model's `reasoningEfforts`, "Use the harness's saved settings." default. Only for models that report efforts. `src/model-picker.ts:153-170`, `src/styles.css:608` (reduced motion).
- Settings footer `.model-menu-settings` (links to provider settings).
- Keyboard: Up/Down move between enabled options (focus follows), Enter on search selects the active option, Esc closes. `src/model-picker.ts:399-428`.
- Loading: "Loading…" while model catalogs load; catalog errors shown in `.model-menu-catalog-error`; per-provider errors. Pending state `.model-menu-pending`.

### 4.7 Approval mode picker (`src/approval-modes.ts`)

Menu (choice menu) lists the modes the current harness supports; each has icon, label, description. The label is harness-specific. Examples (seen):
- Standard (`ask`): "Use the harness's normal rules. Ask you when approval is needed." Codex, Copilot, Grok, Devin, Pi and others have their own sentences.
- Accept edits (`auto`): "Allow file edits automatically. Other actions may still ask you." (Claude family: "Like Standard, and edits outside this project are approved too." etc.)
- Approve for me (`review`): Claude Code auto mode, "its safety reviewer approves routine actions and blocks risky ones". Disabled with an explanation for harnesses without it.
- Plan mode (`plan`): "Read-only ... proposes a plan; edits and commands are declined." (harness-specific wording).
- Full access (`full`).
- Modes that do not apply are not shown. `approvalModes(provider, current)` returns the list.

### 4.8 Slash commands (`src/slash-commands.ts`, 245 lines)

- Trigger: input matches `^\s*/[^\s]*` (`src/slash-commands.ts:32`), i.e. a slash at the start of the message.
- Popover `.slash-menu` (aria "Slash commands"): header (logo, "Commands" label, refresh button "Refresh commands"), list (aria "Available commands"), status line (`role=status`), footer. Each row: command name + hint + source (`command.source`).
- States: loading "Loading commands…"; slow after 4s "Waiting for the harness to start…"; timeout after 75s: "Command discovery took too long. Retry to load harness commands."; empty "No commands are available for this agent."; error with **Retry commands**. Results are cached per session and provider (`contextKey`).
- Keys: Arrow Up/Down (wrap), Enter or Tab to choose, Esc closes (`src/slash-commands.ts:195-202`). Tab with no matches closes.

### 4.9 @ file mentions (`src/file-mentions.ts`, 236 lines)

- Trigger: `@` preceded by start, whitespace, `(`, `[` or `{` (`src/file-mentions.ts:25-27`). Quoted paths supported (`@"path with spaces"`). Email-like text is not a mention.
- Popover `.file-mention-list` (aria "Mention a file"). Status `role=status`: "Searching…", error, or "No matching files in this project".
- Search debounce 110ms (`src/file-mentions.ts:177`). Index covers files in the project; with GitHub connected, issues and pull requests too (per composer aria text).
- Keys: Arrow Up/Down, Enter or Tab inserts `@path`, Esc closes (`src/file-mentions.ts:199-207`).
- Inserted form: `@path` (quoted with JSON when it has spaces or special characters). `src/file-mentions.ts:18`.

### 4.10 Context bar, branch and worktree menus

- Branch chip menu and worktree dialogs (`src/worktrees.ts`):
  - Dialog "Work in a new worktree" (attach mode) or "New task in a worktree" (new mode).
  - Fields: **Branch name** (`#branch-name`, required, pattern `[A-Za-z0-9_\/\-]+`, maxlength 120, placeholder "my-feature", pre-filled with `suggestBranch()` from task title/draft/issue), live preview "Creates <code>branch</code> in <code>…/<project>-worktrees/<branch></code>", invalid state text "Names may use letters, numbers, hyphens, underscores, and slashes.", **Start from** (base branch select), "existing" branch option.
  - Cleanup dialog for removing a worktree: checkbox "Remove the worktree folder" (+ branch delete when merged, else kept until merged), Cancel / "Remove and archive".
  - Titles and descriptions as given (`src/worktrees.ts:157-170, 222-226`).

---

## 5. Workspace, project and folder picking

### 5.1 Add-workspace (open project) dialog

Source: `showOpenProject()` (`src/main.ts:3489-3492`), `addProject()` (`src/main.ts:2347-2370`).

Modal "Open project" (no class):
- `form#open-project-form`.
- Label "Project folder" (`for=project-folder`).
- `input#project-folder name=path`, placeholder `/Users/you/Projects/my-app`, `autocomplete="off"`, `spellcheck=false`, `required`.
- Help text: "Enter a full path or choose Browse."
- Footer (left to right): **Browse…** (secondary, folder icon, `data-action=browse-project`), **Cancel** (secondary), **Open project** (primary, submit).

Behaviour:
- Browse → `chooseFolder()` → native directory dialog titled "Open a project in PandaCode" (`src/bridge.ts:36-39`). In browser preview it returns a fixed sample path (`/Users/you/Projects/new-project`).
- The text field is filled with the chosen path and focused (`src/main.ts:4761-4762`).
- Submit calls the native `add_project` command, reloads `list_projects`, makes the project active, clears the draft, and toasts "Opened <name>". `src/main.ts:2347-2370`.
- Validation: HTML `required` only. No path existence check is visible in the UI code (the native side may validate; not inspected).
- From the new-task flow (`forTask=true`), adding a project moves the current new task to that project (`changeTaskProject`), and closes the dialog. `src/main.ts:2349-2355`.

Path autocomplete / suggestions: **Not found.** No suggestion list, fuzzy matcher, home-directory listing, or recents list exists for the path field (`grep -i suggest|complete_path|list_dir` in `src/` found only unrelated words). The path is typed in full or picked with Browse.

### 5.2 Other folder pickers

- Attach a folder (native folder dialog, title "Attach a folder to your message") for context. `src/bridge.ts:58`.
- Choose agent executable (file, not folder) for provider settings. `src/provider-settings.ts:191`.
- Choose a parent folder to clone a GitHub repo ("Choose where to clone <repo>"). `src/github-hub.ts:230`.
- Export task (save dialog, default `<title>.md`). `src/main.ts:586`.

### 5.3 Project picker (the sidebar filter and the composer project chip)

`openProjectPicker()` (`src/project-picker.ts:15-175`), a floating `section.project-menu.floating-menu` (width `min(360px)`, max height 440px):
- Search input "Search projects…" (aria "Search projects"). Filters on name **and** path.
- List of `button.project-menu-option` (role option, `aria-selected`, aria-label "name — path"). Shows up to 100; then "Showing N of M projects. Refine your search."
- Empty: "No matching projects." or "No projects yet."
- Footer **Open project** button (opens the Open project dialog, section 5.1) and a pending status line.
- Keyboard: arrows move active option, Enter selects, Esc closes and returns focus to the anchor. `src/project-picker.ts:143-169`.
- Selecting a project (same project → just closes). Pending state disables the list while the switch runs. Error text shown inline.
- Placement: below the anchor if room, else above; 12px viewport margin; clamps to viewport. `src/project-picker.ts:58-86`.

Sidebar project filter: "All projects" plus each project (icon + name), with a "Filter projects" button. Choosing a project narrows the sidebar; the `Show all` note restores (`src/main.ts:1156`).

Folder row menu (right-click or `…` on a project folder): **New task**, **Collapse other projects**, **Reveal in Finder** / **Show in Explorer** / **Open folder** (by platform), **Remove project…** (danger). `src/main.ts:3847-3862`.

Remove project confirm: title "Remove <name>?", text "Its tasks are removed from PandaCode. The folder stays on disk.", **Cancel** and **Remove project** (primary, danger class). `src/main.ts:3866-3868`.

### 5.4 Project sort and grouping (sidebar "Sort and view")

Choice menu (`src/main.ts:3873-3890`):
- Heading "Sort tasks": Manual (description "drag to arrange"), Recent activity, Created.
- Heading "Sort projects": Recent activity, Added, Name, Manual (description "drag folders").
- Heading "Group": By project, Flat list.
Also "tasks per project" cap: options 3, 6, 10, 15 (default 6) (`src/sidebar-sort.ts:13-14`).

### 5.5 Empty and first-run states for projects

- No project at all: conversation welcome card "Choose a project" with a primary **Open a project** button (plus icon). `src/main.ts:1278`.
- Project selected, no task: "No task selected" with **Start a task**. `src/main.ts:1278`.
- Sidebar with nothing: "Open a project to get started." `src/main.ts:1163`.
- Inspector without project: "Open a project to browse files and review changes." (inspector-empty).

---

## 6. Session / task list in the sidebar

Source: `renderNavigation()` (`src/main.ts:1009-1180`), `sidebar-sections.ts`, `sidebar-sort.ts`, `thread-order.ts`.

### 6.1 Groups, in render order (`src/main.ts:1163-1170`)

1. **Active tasks** (`section.task-group.sidebar-section.active-group`, aria "Active tasks"). Work that needs you: running or waiting, stopped by a usage limit, or failed while unseen. Order is its own, never dragged. `src/main.ts:1105-1107`, `src/sidebar-sections.ts:44`.
2. **Needs review** (`review-group`, aria "Tasks to review"). Completed-in-the-last-24h tasks not yet viewed (`REVIEW_WINDOW = 24h`, `src/sidebar-sections.ts:6`).
3. **Pinned** (`pinned-group`, aria "Pinned tasks", pin icon). Keeps manual order whatever the sort (`src/main.ts:1111`).
4. **Chats** (`chats-group`, chat icon). Projectless chats, capped like a folder. Hidden when a project filter is set or in flat mode (`src/main.ts:1118-1124`).
5. **Tasks** (flat, `flat-group`) when Group = Flat list: every unpinned task, each row names its project.
6. **Per-project folders** (`folder-group`, `data-thread-group="project:<id>"`) when Group = By project. Each folder heading (`button.folder-heading`, `data-action="toggle-folder"`) collapses/expands; a folder shows "No tasks yet" when empty. Folder ordering = project sort. `src/main.ts:1134-1141`.
7. **Completed** (`completed-group`, `section-toggle`, `aria-expanded`, `aria-controls="completed-tasks"`). Shows the first 10, then "Show more" in pages of 25 (`COMPLETED_FIRST=10`, `COMPLETED_PAGE=25`, `src/main.ts:345`). Open state persists (`pandacode.sidebar.completedOpen`).
- **Archived** view replaces groups with one group "Archived" with a count; rows show Restore and Delete buttons directly. `src/main.ts:1164`.
- Folder/Chat caps: "Show N more" / "Show less" (`button.folder-more`). `src/main.ts:1131`.
- While filtering: all matches show, closed sections and folders open for that draw only (nothing saved). `src/main.ts:1099-1101`.

Section headings: `div.group-heading.section-heading` with a `section-count` badge (count). `src/main.ts:1120`.

### 6.2 Row anatomy (`row()` `src/main.ts:1049-1095`)

Two row styles:
- **Card** (Active, Needs review, Pinned, and "by project" rows in some states): two lines.
  - Line 1 "where": project app icon, checkout name (worktree folder or project name), pin icon, status signals.
  - Line 2 "what": title (`.task-title`), branch (`.task-branch` with worktree/cloud icon), PR/issue chip (`#123`, `.task-link.pull|issue`), project name, provider logo.
- **One-line** (`task-oneline`): title, then worktree icon, PR/issue chip, pin, project label, status, provider logo.
- Flat list rows also show the project icon + project name (`task-project-name`).
- Row height: `.task-item` min-height 61px for card rows, 10px/11px padding, radius 4px, font .86rem. `src/styles.css:54`.
- Selected row: `.selected` (accent ring/background). Unread rows: `.unread` (bold/dot).
- Drag handle: rows in manual order are `draggable` (`src/thread-order.ts:42-61`). Keyboard reorder is advertised on reorderable rows as `aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"` (`src/main.ts:1085`). Verify the handler before relying on it: the grep only found the attribute.

Row actions (outside the button, not Tab stops; reached by keyboard shortcuts or menu key): `.task-check` (complete / reopen, check icon, aria "Mark complete: <title>" / "Reopen: …"), `.task-more` (…, aria "Task actions: <title>", `aria-haspopup=menu`) or in archive view Restore and Delete. Hidden while busy. `src/main.ts:1078-1084`.

### 6.3 Status indicators

`task-indicator` dot + `task-status` word (seen `src/main.ts:1059-1085`):

| State | Dot class | Word shown | Label / tooltip |
|---|---|---|---|
| Needs approval | `attention` | "Approval" | "Needs approval" |
| Needs your answer | `attention` | "Answer" | "Needs your answer" |
| Running | `running` | elapsed clock (e.g. "2m 05s"), no word | "Running" |
| Usage limit | `limited` | "Limited · <reset time>" | "Usage limit · <reset>" |
| Failed | `failed` | "Failed" | "Failed" |
| Interrupted | `failed` | "Interrupted" | "Interrupted" |
| Unread | `unread` (dot only) | none | "Unread" |
| Idle | none | age ("3h", "2d") from last activity | none |

Colours: running / attention / selected dots use the accent (yellow) in dark mode (`src/styles.css:756-757`).

Other row marks: worktree icon (with the worktree path as tooltip), cloud icon ("Runs on a <label> cloud machine"), pin icon ("Pinned"), PR/issue chip, provider logo.

### 6.4 Row interactions

| Input | Result | Ref |
|---|---|---|
| Click row | open task | `data-action="select-task"`, `src/main.ts:1085`, `src/main.ts:4775` (dispatch) |
| Right-click row, or the menu key / Shift+F10 on a focused row | Task actions menu at pointer or at row | `src/thread-order.ts:114-120`, `src/main.ts:3795` |
| `…` button | same menu | `src/main.ts:1083` |
| Drag a manual-order row | reorder within section/folder | `src/thread-order.ts:42-61` |
| Cmd/Ctrl+1..9 | open the Nth visible row | `src/main.ts:3919-3921` |
| Cmd/Ctrl+Shift+[ / ] | previous / next visible row | `src/main.ts:3922-3929` |
| Cmd/Ctrl+Z | undo the last archive/toast | `src/main.ts:3939-3942` |
| Alt+ArrowUp / Alt+ArrowDown on a reorderable row | reorder (advertised by `aria-keyshortcuts`) | `src/main.ts:1085` |
| ⌘↩ on a row | complete the task (per the source comment that names the shortcut; not traced to a handler) | `src/main.ts:~1080-1085` |

### 6.5 Task actions menu (`showSidebarTaskMenu`, `src/main.ts:3795-3830`)

Width 280. Items in order (labels verbatim):
1. Pin task / Unpin task (pin icon).
2. Move up / Move down (only in movable groups: not Active, Needs review or Completed).
3. Rename… (edit icon) — separator.
4. Mark as unread / Mark as read (chat icon) — hidden for archived or the open task.
5. New task from <branch>… (worktree icon) — only with a branch, not archived, not remote.
6. Copy branch name (copy icon) — only with a branch.
7. Copy worktree path / Copy project path (copy icon).
8. Copy task ID (copy icon).
9. Mark complete / Reopen (check or undo icon) — not archived.
10. Archive / Restore (archive or undo icon).
11. Delete task… (trash icon, danger).

Archive is immediate: a toast "Task archived" / "Task restored" with **Undo** (5s). `src/main.ts:3776-3779`.
Delete opens a confirm dialog (section 6.7).
Rename: `showRename()` (`src/main.ts:4016`).

### 6.6 Filter and search

- Sidebar filter (`#sidebar-filter`): matches title and project name (`matchesFilter`, `src/sidebar-sort.ts:95-101`). Typing updates `state.query` and redraws. Esc clears the query (first press), then blurs. `src/main.ts:3912-3916`.
- `/` focuses the filter from anywhere that is not a control (`src/main.ts:3935`).
- No match: "No tasks match" (`.no-tasks.sidebar-no-match`). `src/main.ts:1158`.
- Command palette (⌘K) is a separate, title-only search (section 9.1).

### 6.7 Delete confirm

Modal "Delete task?" (`src/main.ts:3990-3992`): shows the task title; text "Permanently delete this conversation and its worker history from PandaCode? This cannot be undone. Its terminal tabs close and running commands may stop. Project files and worktrees stay."; error line (`role=alert`); footer **Cancel** (secondary) and **Delete task** (secondary with danger class, `.delete-task-confirm`). If the task runs on a remote machine, a second confirmation runs (`confirmDeleteMachine`, `src/main.ts:4496-4503`).

### 6.8 Sidebar empty and loading

- Empty list copy: "Open a project to get started." (no projects, no chats, no pinned). `src/main.ts:1163`.
- The list morphs in place (`morph(nav, html, 5)`) so unchanged rows keep focus and nodes. `src/main.ts:1163`.
- `aria-busy` on the nav while ordering is in progress. `src/main.ts:1177`.

---

## 7. Other workspace views

### 7.1 Conversation (default)

Section 1.4 and 8.

### 7.2 Project board (`src/task-board.ts`, `src/main.ts` board view)

- Entered by the header **Board** button. Sidebar drag-resize is hidden in board view. `src/sidebar-resize.css` (`.board-view .sidebar-resize-handle{display:none}`).
- Columns (task stages, `src/task-board.ts:7, 37`):
  - **Pending**: subtitle "Ideas waiting to begin".
  - **In progress**: "Work happens here".
  - **Review**: "Ready for your feedback".
  - **Completed**.
- Heading: "Project board" eyebrow with bamboo icon. `src/task-board.ts:19`.
- Add task: "Add task" modal `board-task-form` (`src/main.ts:1972`), edit: "Task details".
- Empty conversation in board view: "Start this task when you’re ready. Agent updates and your replies will appear here." (`src/main.ts:1283`).
- Board panel can open beside the task (`state.boardPanel`, Escape returns to the board). `src/main.ts:4957`.

### 7.3 GitHub hub (`src/github-hub.ts`, 379 lines; `src/github-pull.ts`)

- Header **GitHub** view. Left repos list (`--gh-repos-width: 200px`, `src/styles.css:890`), tabs: **Actions**, **Issues**, **Pull requests** (`src/github-hub.ts:39`).
- Keyboard handler on the hub root (`src/github-hub.ts:361`).
- Pull request view (`src/github-pull.ts`): inspector "Pull request" tab. Shows checks ("Checks"), review and refresh actions (`[data-pull-action="refresh"]`). `src/github-pull.ts:165`.
- Create PR: dialog "Push & open pull request" (`src/github.ts:231`).
- Sign-in hint when `gh` is not authenticated: "Sign in to the GitHub CLI by running…" (`src/github-hub-prompts.ts:78`).
- States: loading via `aria-busy`; errors inline. Specific empty copy was not catalogued.

### 7.4 Agent usage, bots, import

- **Agent usage** (`src/agent-usage.ts`, 293 lines): usage ledger per agent, cost/limit chart, heatmap (`src/usage-heatmap.ts`), refresh button with spinner (`usage-refresh[aria-busy]`).
- **Bots** (`src/bots.ts`, `src/bots-panels.ts`, sidebar section): bot tasks with states "Working…", modes ("Ask before acting", "Auto-approve edits", "Approve for me", "Plan only", "Full access"; `src/bots.ts:72`), and a connect wizard (`src/bots-connect.ts`). Not inventoried further.
- **Import conversations** (`src/conversation-import.ts`, dialog from the sidebar Import button): lists conversations from other harnesses; not-installed sources stay listed with an explanation.

---

## 8. Message stream (conversation)

### 8.1 Message layout

Source: `messageHtml()` (`src/main.ts:1398-1421`), `renderTranscript()` (`src/main.ts:1267-1330`).

- User message: `article.message.user-message`. Avatar `span.message-avatar.user-avatar` with the letter "Y", name "You", then `.message-content`. Background: none, text `var(--text)`, font `--thread-font`, line-height 1.75. `src/styles.css:117`.
- Agent message: `article.message.agent-message`. Avatar = provider logo of the author (`historicalProvider`), name = provider name. `src/main.ts:1420`.
- Thread body font: `--thread-font` is set to `0.857143rem` (12px at 14px root) by the last `:root` rule; an earlier `.94rem` rule is overridden. `src/styles.css:1, 537`.
- Compact mode (Settings > General, or `body.compact`): message spacing 18px, line-height 1.65, transcript top padding 20px. `src/styles.css:485-487`, `src/main.ts:4913`.
- Message width: transcript padding 45px sides at >=1450px, 24px at <=1100px, 17px at <=650px. `src/styles.css:497, 502, 525`.
- Turns: messages group into turns (`groupTurns`, `src/turn-activity.ts`): user message, optional coordination/handoff, activity block, errors, final answer.
- Handoff card between providers: `details.provider-handoff` "Conversation carried forward" with both logos and a summary. `src/main.ts:1400`.
- Error message: `.message-error` with alert icon, red-tinted box (`#402b29` dark). `src/styles.css:763`.
- Status message: `renderToolStatus`.

### 8.2 Turn activity (collapsed work log)

- Summary: `details.turn-activity` with label **"Worked for <duration>"** (or "about <duration>" when estimated) or **"Tool activity"** when no duration. `src/turn-activity.ts:97-101`.
- Live turn: `.live-activity` while running (not collapsed).
- Expanded by default when Settings > General > "Expand tool activity" is on (`pandacode.activityExpanded`). `src/main.ts:1350`, `src/main.ts:4916`.
- The chevron rotates with a spring transition (`motion.css:117`). Reduced motion removes it (`src/styles.css:241`).

### 8.3 Tool calls: tool groups, phrasing and cards

Phrasing (`src/tool-trace.ts:20-31`), per kind: running / finished verb:
- shell: Running / Ran ("command", "commands")
- read: Reading / Read ("file")
- edit: Editing / Edited
- write: Writing / Wrote
- search: Searching / Searched ("search", "searches"; summary reads "Ran 2 searches")
- web: Searching / Searched
- fetch: Fetching / Fetched ("page")
- todo: Updating / Updated ("plan")
- agent: Starting / Started ("agent")
- skill: Loading / Loaded ("skill")
- mcp: Using / Used ("tool")
- tool (other): Using / Used

Example summary: "Ran 2 searches and read 3 sources" (`src/tool-trace.ts:223`).

Tool group (`renderToolGroup`, `src/tool-activity.ts:105-113`): `details.tool-group` with a `summary.tool-group-summary`: optional alert icon when a tool failed, label sentence, a stack of tool icons (`tool-trace-stack`), a failure note after " · ", and a chevron. Running groups carry `data-running`. Expanded when the setting is on.

Tool card bodies (`src/tool-cards.ts`, 485 lines):
- Rows (max 6 per card, `ROWS = 6`; MCP rows 3). Each row: leading mark (`span.tc-mark` with icon), bold title, muted meta, right-aligned time, optional second body line, "+N more" overflow. Styles `src/tool-cards.css` (144 lines). `src/tool-cards.ts:1-10`.
- Read/list results: file rows with file-type icons. Search: highlighted matches (`highlight(text, pattern)`, `src/tool-cards.ts:252`).
- Edit results: diff with line numbers (`tc-diff`, `tc-diff-line`, `tc-diff-file`). `src/tool-cards.ts:232-236`.
- Shell: monospace command with output excerpt (`tc-excerpt`, `src/tool-cards.ts:107`).
- Raw trace: a disclosure "tool-trace-raw" shows the untouched input and output (`src/tool-activity.ts:53`).
- Status line per tool: running (spinner/placeholder), completed, failed (alert icon, `.tool-group-status.has-failure`).
- Running card placeholder: "a running card already shows its own placeholder" (`src/tool-activity.ts:39`).
- Approvals appear in the approval bar, not in the card (section 5.4).

### 8.4 Markdown and code

Renderer: `src/enriched-markdown.ts` (165 lines), an md4c-based "Enriched Markdown" engine; `marked` is the fallback (`src/dom.ts:118-132`). Output sanitised with DOMPurify (`src/dom.ts:121`).

- Code blocks: `<pandacode-code>` custom element wraps every fenced block (not generative). It has a **copy button** in a shadow root: icon-only (copy icon), aria/tooltip "Copy code"; on click shows check icon with "Copied" for 1.5s, or alert "Copy failed". Text copied is the code only. `src/generative-ui.ts:90-102`, `src/enriched-markdown.ts:127-130`.
- Generative UI fences `ui`, `chart` (bar/line/pie), `svg`, `html`: `<pandacode-ui>` drawn in a shadow root; HTML/SVG are sanitised; remote images become links. `src/rich-markdown.ts:1-8`, `src/generative-ui.ts:1-8`.
- Math: KaTeX (`LatexMathInline`, `LatexMathDisplay`). `src/enriched-markdown.ts`.
- Task lists: `span.md-checkbox` with role img "Done" / "Not done". `src/enriched-markdown.ts` (ListItem case).
- Admonitions (GitHub-style `> [!TIP]` etc.): tone colours per type (`src/styles.css:168-172`).
- Tables and thematic breaks plain.
- Markdown code styling: `background:#f6f6f4; border:1px solid #e9e9e5; radius 4px; padding 15px 17px; line-height 1.7`, dark `#252522`. `src/styles.css:128, 761`.
- Inline code: `var(--raised)` background (dark `#dfdccb` text). `src/styles.css:762`.
- Links: external links open in the system browser (`src/external-links.ts`, test `tests/external-links.spec.ts`).
- Local file links in messages open files as editor tabs (`src/file-links.ts`), with a context capture for `file:line` references.

### 8.5 Message actions (hover row under each message)

`src/message-actions.ts`:
- Group `.message-actions` (role group, aria "Message actions"), 28px buttons, opacity 0.62 at rest, `margin-top:6px`, indented 31px. `src/message-actions.css:1-4`.
- Buttons: **Copy message** (copy icon; becomes check "Copied"; status "Message copied"), **Fork from here** (fork icon; creates a new task from that point), **Edit and resend** (edit icon; user messages only, `canEdit`). `src/message-actions.ts:5-7, 77-82`.
- Rewind and fork are documented in `docs/rewind.md`, `docs/conversation-presentation.md`.
- Hover reveal: opacity raises on hover/focus (CSS transition 140ms). `src/message-actions.css:1`.

### 8.6 Find in thread (⌘F)

- Bar `.thread-find` at the top of the conversation pane (`src/thread-find.ts`): search icon, input `aria-label="Find in thread"`, placeholder "Find in thread", match counter, next/prev/close.
- ⌘F opens it when a task is shown and the transcript is visible. ⌘G / ⇧⌘G step through matches. `src/main.ts:4931-4935`.
- Keys in the input: Enter next, Shift+Enter previous, Esc closes and restores focus to the prompt. `src/thread-find.ts:129-130`.
- Matches are highlighted in the transcript.

### 8.7 Scrolling

- The transcript sticks to the bottom while new content arrives (`stickToBottom`), using a ResizeObserver. Scrolling up releases the stick. `src/main.ts:609-627`.
- Tool activity focus is preserved while a tool row is focused (`readingTranscriptTool`). `src/main.ts:616`.
- **Jump-to-latest button: Not found.** Users scroll manually once they release the stick.

### 8.8 Sub-agents and teams panels

- `#subagents-host` above the transcript: sub-agent cards with status, progress rows (`src/subagents.ts`, `src/team-progress.ts`, `src/task-board.ts`). Team progress ("Team mode: your selected model becomes the lead…" tooltip, `src/main.ts:259`).

---

## 9. Command palette, shortcuts, toasts, menus, tooltips

### 9.1 Command palette ("Go to anything")

Opened by Cmd/Ctrl+K (`src/main.ts:4923`, global keydown `src/main.ts:4929`) or the sidebar **Search** button.

- Modal (class `command-dialog`) titled "Go to anything" (`src/main.ts:4708-4710`).
- Search input `#command-query`, aria "Search tasks and commands", placeholder "Search tasks and commands…".
- Results `#command-results`:
  - Section "Commands": New task (⌘ N), New chat (no project), Open project, Open browser, Toggle terminal (⌘ J), Settings (⌘ ,), Agent usage, Bots, Import conversations, Create worktree, GitHub (only when GitHub is on). Filter is `label.includes(query)`.
  - Section "Tasks": up to 12 tasks by title, each with provider logo and "project · provider" subline.
  - Empty: "No matching tasks or commands."
- Footer: "↑ ↓ to navigate", "↵ to open", "esc to close".
- Keys: Up/Down move the `command-selected` highlight (wraps, scrolls into view), Enter activates it. Escape closes via the modal. Dialog keys: `src/main.ts:4929-4941`.
- Matching is substring, not fuzzy. Searches titles only (`title.toLowerCase().includes`).

### 9.2 Keyboard shortcuts (complete list found)

Global (`src/main.ts:3909-3935, 4920-4958`; `src/platform.ts:6-8` for the labels; Ctrl replaces ⌘ on Windows/Linux):

| Shortcut | Action | Ref |
|---|---|---|
| ⌘ N | New task (in board view: new board task) | `main.ts:4942` |
| ⌘ K | Command palette ("Go to anything") | `main.ts:4923` |
| ⌘ , | Settings | `main.ts:4947` |
| ⌘ J | Toggle terminal drawer | `main.ts:4937-4938` |
| ⌘ B | Toggle sidebar (on conversation view, outside dialogs) | `main.ts:4920-4923` |
| ⌘ ⇧ B | Toggle inspector | `main.ts:4943-4946` |
| ⌘ F | Find in thread | `main.ts:4931` |
| ⌘ G / ⇧⌘ G | Next / previous find match | `main.ts:4932` |
| ⌘ 1..9 | Open Nth visible task in the sidebar | `main.ts:3919-3921` |
| ⌘ ⇧ [ / ⌘ ⇧ ] | Previous / next visible task | `main.ts:3922-3929` |
| ⌘ Z | Undo the toast's action (archive, etc.) | `main.ts:3939-3942` |
| / | Focus the sidebar task filter (when not typing) | `main.ts:3935` |
| Esc (filter) | Clear filter, then blur | `main.ts:3912-3916` |
| Enter (prompt) | Send or queue | `main.ts:4949` |
| ⌘ Enter (prompt, running) | Steer | `main.ts:4951` |
| Shift Enter | Newline | (native) |
| Esc (running, terminal closed) | Stop task | `main.ts:4958` |
| Esc (settings) | Close settings | `main.ts:4956` |
| Esc (board panel) | Return to board | `main.ts:4957` |
| ⌘ + / ⌘ - / ⌘ 0 | Interface zoom in/out/reset | `src/ui-size.ts` (`initializeUiSizing`) |
| ⌘ / Ctrl + Shift + Space | Launcher (global, system-wide) | `src-tauri/src/overlay.rs:16` |

Modifier handling is `event.metaKey || event.ctrlKey`, so Ctrl works on all platforms. Shortcuts are skipped while a dialog is open (except the command palette keys) and when the event is `defaultPrevented`.

### 9.3 Floating choice menus (context menus)

`showChoices()` (`src/choice-menu.ts`, 270 lines). The one menu component used for context menus, pickers and "more" menus.

- Anchored to the trigger (below or above, gap 4px), or placed at a pointer point (right-click). Constants: `BRIEF_ROW = 48` (details longer than this go behind an info mark), `GAP = 4`.
- Items: `{id, label, icon, description, leading, disabled, danger, separator, heading, selected}`. Headings group items. `selected` renders a check mark. `actions: true` renders an action-style list.
- Width is per call (240 open-view, 260 changes, 280 task actions, 340 attach, 360 project picker).
- Keyboard: Up/Down (wrap), Home/End, Enter chooses (on the search field), Escape closes and restores focus to the trigger. Printable keys do typeahead (700ms window, repeated letters cycle matches, Space excluded). `src/choice-menu.ts:195-243`.
- Only one menu open at a time (`closeMenus`). `src/main.ts:886-895`.
- Right-click on a task row or folder opens it at the pointer. The menu key keeps it on the row.

Typical menus: Task actions (`src/main.ts:3795`), Folder actions (`src/main.ts:3847`), Sort and view (`src/main.ts:3873`), Open view (`src/main.ts:3244`), Change task project, Branch actions (`src/worktrees.ts`), Changes file/more (`src/changes-view.ts:401-439`), Attach (`src/main.ts:496`), Default agent/model pickers (`src/settings.ts` triggers).

### 9.4 Tooltips and info marks

- `src/tooltip.ts`: one shared tooltip for `[data-tip]` elements. Shown on hover, and on keyboard focus only when focus arrived by keyboard (`tooltip.ts:70-81`). Hidden on press, key, scroll, or when the pointer leaves. No show delay constant was found (appears immediate).
- Long explanations use `infoMark(text, label)`: a small info mark beside a title whose text is available to assistive tech (`src/tooltip.ts:8`). Used in dialog descriptions (`src/main.ts:3446+`), settings, turn-changes notices, provider rows.
- Icon-only buttons everywhere also carry a native `title` attribute plus `aria-label` (`src/dom.ts:97` `button()` helper). Example: `title="Toggle terminal (⌘ J)"`.

### 9.5 Notifications and feedback

- Toast: section 1.9.
- Inline status lines (`role=status`) in dialogs and popovers ("Checking connection…", "Searching…", "Loading commands…").
- Inline errors `role=alert` (`.delete-task-error`, `.inspector-empty` error, `.model-menu-error`).
- Approval bar: section 5.4.
- Sidebar dots: section 6.3.
- Dock/title badges: not found (grep `setBadge|badgeCount` in `src/` returned nothing).
- Native notifications: not found (grep `Notification(|sendNotification` in `src/` returned nothing). The tray popover (section 11.2) covers background status.

---

## 10. Onboarding and provider setup (first run)

### 10.1 Honest summary

There is **no multi-step onboarding wizard** in `src/`. First-run is a set of empty states plus the Settings Providers section. Grep for `onboard`, `first run`, `getting started`, `setup wizard` shows only the Jev and Bots connect guides and a launcher sample prompt.

### 10.2 First launch path (inferred from empty states, seen in code)

1. Window opens to the conversation area with the welcome card "Choose a project" and the primary **Open a project** button (`src/main.ts:1278`). Sidebar shows "Open a project to get started." (`src/main.ts:1163`).
2. **Open a project**: Open project dialog, path field or **Browse…** (section 5.1). On success: "Opened <name>" toast and the project's new-task welcome.
3. New task welcome: "What should we build in <project>?" where the project name is a button to change the project (`src/main.ts:1292`). Composer: "Describe a task…" placeholder and model/mode pickers.
4. Agent setup if no agent is installed: Settings > Agents shows "Not installed" rows; Settings > Providers holds sign-ins and keys (section 3.5). No inline install prompt was found in the conversation.
5. Default agent and model: Settings > Agents "Default agent" and "Default model" (`src/settings.ts:86-88`).

### 10.3 Provider / model setup fields (exact)

Built-in harnesses (Settings > Providers) use the fields in 3.5. There is **no generic "add a custom provider" form** with base URL, protocol, model list, or a test-connection button in this source. The closest equivalents:
- **Named connection** (`src/connections.ts:29-36`): Harness (select), Name (required, max 60), Executable, Extra arguments (one per line), Config folder, Environment variables (NAME / VALUE, with secret checkbox), Save connection.
- **Key form** (`src/provider-settings.ts:41`): API key (password, max 4096), Save key, Remove saved key, status.
- **Claude connection mode + Check login** (`src/provider-settings.ts:52-54`).
- **MiMo endpoint** cluster select + key (`src/provider-settings.ts:65-67`).

Validation seen: required name, max lengths, pattern for branch names, key max length. Test connection = Check login (Claude) or the key status check after save.

### 10.4 Launcher onboarding copy

The quick launcher (section 11.1) has the placeholder "What should we work on?" and a "Choose harness and model" control, which lets a user start a task without opening the main window.

---

## 11. Launcher, tray popover, and other windows

### 11.1 Quick launcher (`src/overlay.ts`, separate webview)

- Opened by a global shortcut; default `CommandOrControl+Shift+Space` (`src-tauri/src/overlay.rs:16, 80`). Validation messages if a bad shortcut is entered: "Use a shortcut such as CommandOrControl+Shift+Space." and "Include Command, Control, Option, or Shift in the shortcut." (`src-tauri/src/overlay.rs:122-124`).
- Window: frameless, 650 x 510, title "PandaCode launcher" (`src-tauri/src/overlay.rs:499-507`). Hides when it loses focus (`overlay.rs:527-528`).
- Layout (`src/overlay.ts:17`): heading "PandaCode" (bamboo icon) with a **Close launcher** X; compose box (placeholder "What should we work on?"); footer with "Task project" select, "Choose harness and model" trigger, and **Start task** primary.
- Below: "Search tasks" (placeholder "Find a task") and an "Active agents" list (running/failed/done tasks with status) (`src/overlay.ts:17, 139`). Empty: "No agents working right now." (`src/overlay.ts:143`).
- Keyboard: ArrowDown from search moves into the task list (`src/overlay.ts:185`). Hides on window blur and on `pagehide`, with an `overlay-visibility` event from Rust (`src/overlay.ts:195-200`).
- Settings: General > "Quick launcher" section (`#launcher-settings`), shortcut recorder (click to record a new shortcut; `src/overlay-settings.ts:67`).

### 11.2 Tray / menu-bar popover (`src/tray-popover.ts`)

- Frameless window 340px wide x 420px tall, hides on focus loss (`src-tauri/src/tray.rs:19, 125-151`).
- Header: PandaCode logo and an "Open PandaCode" button (title "Open PandaCode") (`src/tray-popover.ts:31`).
- Lists tasks with status: Running, Failed, Done (aria labels, `src/tray-popover.ts:55-57`); row title and project.

### 11.3 Simulators and VM windows

Inside the inspector (section 2.3); macOS/Windows only.

---

## 12. Visual system

### 12.1 Colour tokens (`src/styles.css:1, 741-746, 567, 712-732, 802`)

Defined on `:root` (light) and `html[data-theme="dark"]` (dark). Also `@media (prefers-contrast: more)` raises borders and muted text.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #ffffff | #1c1c1b | page, conversation |
| `--sidebar` | #f5f5f3 | #232321 | sidebar |
| `--panel` | #fbfbfa | #222220 | inspector, settings nav |
| `--raised` | #f1f1ef | #31312e | chips, code, hover |
| `--border` | #e3e3df | #3b3b36 | dividers |
| `--text` | #242423 | #f3f1e9 | body |
| `--muted` | #656560 | #b1b0a7 | secondary |
| `--faint` | #71716c | #a09f95 | tertiary |
| `--accent` | #ffd43b | #ffd43b | selection, primary, status dots |
| `--accent-dim` | #fff1b6 | #48401e | selected nav row |
| `--accent-tint` | #fffcf1 | #29271f | header gradient |
| `--on-accent` | #242423 | #29230e | text on accent |
| `--focus` | #8b6c00 | #e4be37 | focus ring |
| `--success` | #237345 | #83cf9c | done |
| `--danger` | #b03535 | #ff9e96 | errors, delete |
| `--bamboo` | #577342 | #adbf86 | brand art |

Accent is yellow ("yellow selection, and bamboo details" per the visual thesis comment, `src/main.ts:94`). Primary buttons: yellow fill with dark text.

Theme switch: `data-theme` attribute on `<html>` (`index.html:2` default `dark`, toggled by `#theme-toggle`). Imported VS Code themes supply their own tokens (`src/palette-core.ts:37`, `src/vsix-themes`).

### 12.2 Typography

- Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Mono: `"SF Mono", "Cascadia Code", Consolas, monospace`. No web fonts are loaded (the CSP sets `font-src 'self' data:`). `src/styles.css:1`, `src/styles.css:20` (`--mono`), `src-tauri/tauri.conf.json` (csp).
- Root: `font-size: calc(14px * var(--ui-scale,1))`. `src/ui-size.css:1`.
- Body/thread: `--thread-font: 0.857143rem` (12px at 1x). Sidebar task titles .86rem. Chips .64–.8rem. Dialog title 1.08rem (weight 600, letter-spacing -.015em). Settings page title 1.6rem (weight 650). Welcome title 1.6rem. Settings nav title 1.25rem. `src/styles.css:537, 425-428`.
- Common sizes used in CSS (count): .72rem, .78rem, .8rem, .84–.86rem, 12px, 1.6rem. Many `font-size` values are fractional rem multiples of 14px (for example `0.642857rem` = 9px, `0.571429rem` = 8px).
- Weights: 400 body, 550 selected nav, 600 headings, 650 page titles.
- Line-height 1.5 base; message 1.75 (user), 1.65 (compact).

### 12.3 Spacing, radii and density

- Radii: 2px and 3px dominate (most buttons and nav rows), 4px for rows/cards, 5px agent question card, 6px composer and approval bar, 999px pills, 50% avatars and circular icon buttons. Dialog radius `var(--sheet-radius,3px)`.
- Padding examples: transcript `28px 36px 25px`, composer area `0 30px 17px` (`max-width:950px`), task row `10px 11px`, drawer heading `0 16px`, settings panel `44px 0 72px`, dialog `20px 22px 18px`, agent question `16px`. `src/styles.css:106, 245`, `src/styles.css:54`, `src/styles.css:414`, `src/settings.css:23`, `src/styles.css:425`.
- Header height 55px. Tab/strip heights 26px (inspector tabs), 34px (file tabs), 37px (drawer heading), 32px (settings nav rows), 28px (icon buttons), 61px (card rows).
- Compact mode toggles denser messages (section 8.1).
- Max text column: composer 950px. Settings column 760px. Dialog 475px.

### 12.4 Icon set

- Hand-drawn inline SVG path dictionary in `src/dom.ts:7-78`: `icon(name)` returns `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`. Size via CSS (default 15–17px; 13–14px in tabs/drawer).
- About 80 names: images, play, board, chat, plus, search, arrow, chevron, down, close, folder, folderPlus, file, branch, worktree, terminal, settings, archive, more, check, unlock, plan, activity, spark, bot, panel, sidebar, attach, pause, github, external, stop, refresh, reset, edit, command, leaf, bamboo, moon, sun, copy, alert, info, help, globe, back, forward, camera, select, server, issue, monitor, phone, lock, merge, pull, upload, download, sketch, square, circle, line, minimize, pin, text, undo, redo, trash, move, grid, widget, and arrow-right.
- File-type icons: material-icon-theme JSON (`src/file-icons.ts:3`). Provider logos: `src/provider-logos.ts`. Project app icons: `src/project-icons.ts`.

### 12.5 Motion

Tokens (`src/motion.css:5-7`):
- `--spring: cubic-bezier(.22,1,.36,1)`, `--spring-duration: 340ms`.
- `--spring-fast: cubic-bezier(.2,.9,.3,1)`, `--spring-fast-duration: 240ms`.
- `--spring-bounce: cubic-bezier(.34,1.4,.64,1)`, `--spring-bounce-duration: 380ms`.

Used durations (count of occurrences in CSS): 120ms (button colour), 140ms (row/hover), 160ms (tab colour, composer border), 200–220ms (composer shadow, chips), 240ms (fast spring), 320–340ms (segment thumb, chevron), 800ms and 1.1–1.8s (spinners, pulses).

Interaction motion (JS):
- Dialog entrance: scrim + plate spring (`src/motion.ts:352`).
- Popovers: `materializeIn` (scale .96, y 10px, spring .34) (`src/motion.ts:144`).
- Sidebar and panels glide in/out (`glideIn`/`glideOut`, `src/motion.ts:182-214`).
- List stagger: `cascade()` 22ms per item, max 200ms (`src/motion.ts:222`).
- Toast: `showToast` (`src/motion.ts:231`).
- Segmented control thumb moves with spring (`src/motion.css:83`).
- Composer border and shadow transition on focus (`src/motion.css:109`).
- Task rows lift with fast spring on hover/press (`src/motion.css:102`).

Reduced motion: `@media (prefers-reduced-motion: reduce)` removes spring transitions in motion.css (`:120`), styles (`styles.css:550`), and most components (approval, diff, bots, etc.). Reduced transparency and `prefers-contrast: more` swap glass for solid fills and add outlines (`src/motion.css:123-131`, `src/styles.css:562-566`).

Glass: floating menus and the toast use a translucent background with backdrop blur when not in reduced transparency (`src/styles.css:639, 704`).

### 12.6 Density controls

- Compact conversation (Settings > General). `body.compact`. `src/main.ts:4913`.
- Interface size 80–160% (section 1.10).
- Expand tool activity (Settings > General).
- Per-project task count 3/6/10/15 (section 5.4).

---

## 13. Desktop packaging and run modes

### 13.1 Tauri window and bundle (`src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`)

- `productName` "PandaCode", identifier `ai.pandacode.desktop`, version 0.3.56.
- Main window: title "PandaCode", 1440 x 940 default, min 860 x 580, `backgroundColor #1c1c1b`, `theme Dark`, `titleBarStyle Overlay`, `hiddenTitle true`, `trafficLightPosition {x:14, y:29.5}`.
- macOS override (`tauri.macos.conf.json`): `transparent: true`, `backgroundColor #00000000` (lets native vibrancy/liquid glass show through; CSS has `data-native-material` rules, `src/styles.css:710-731`).
- `app.macOSPrivateApi: true`.
- CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; connect-src ipc: http://ipc.localhost; font-src 'self' data:; object-src 'none'; frame-src 'none'`.
- Bundle: `targets: ["app"]`, category DeveloperTool, macOS min 12.0; DMG window 660 x 400 with app and Applications icon positions.
- Updater: GitHub `latest.json` endpoint, minisign pubkey; Windows install mode passive.
- Dev: `npm run dev` on `http://127.0.0.1:1420` (strictPort); `beforeDevCommand` / `beforeBuildCommand` set in `tauri.conf.json`.

### 13.2 Rust plugins and extra windows (`src-tauri/Cargo.toml`)

- Tauri 2 with `macos-private-api`, `tray-icon`, `image-png`.
- Plugins: `tauri-plugin-dialog` (native file/folder dialogs), `tauri-plugin-single-instance` (second launch focuses the first), `tauri-plugin-global-shortcut` (launcher hotkey), `tauri-plugin-updater`, `tauri-plugin-process`.
- Extra webview windows: launcher (`overlay.rs:499-507`, 650x510, frameless) and tray popover (`tray.rs:125-129`, 340 wide, frameless). Both load `index.html?view=...` (`src/entry.ts:1-10`).
- Browser inside the inspector is a **native child webview** positioned by bounds (`browser_open`, `browser_bounds`, `browser_pick` calls, `src/browser.ts:93-165`; implementation `src-tauri/src/browser.rs`).

### 13.3 Web / browser mode

- Yes, a browser mode exists: `preview = !('__TAURI_INTERNALS__' in window)` (`src/bridge.ts:3`). It runs under `vite` with sample data (`src/preview*.ts`, e.g. `src/preview.ts` mock `read_file`, `list_files`) and shows "Browser preview · sample data" in the header (`src/main.ts:325`).
- Interface size in browser mode scales the root font only (`src/ui-size.ts:21-27`).
- Native dialogs in browser mode return fixed sample paths (`src/bridge.ts:37-39`).
- The app is testable in a browser through Playwright specs (`tests/*.spec.ts`, 124 test files including `ui.spec.ts`, `sidebar-keyboard.spec.ts`, `settings.spec.ts`, `file-mentions.spec.ts`, `attachments.spec.ts`, `model-picker.spec.ts`; `playwright.config.ts`, `playwright.webkit.config.ts`).
- Mobile: a separate Expo app in `mobile/` (not inventoried).
- Website: `website/` (Astro, Cloudflare Wrangler) for the marketing site.

---

## 14. Known gaps and non-features (do not copy)

Checked by grep and found absent or minimal:

| Feature | Status | Note |
|---|---|---|
| Onboarding wizard | Absent | Empty states + Settings only. |
| Custom provider form (base URL, protocol, model list, test connection) | Absent | Only named connections and key forms. |
| Path autocomplete / recent folders | Absent | Text field + Browse. |
| "Open config file" / JSON settings editor | Absent | Use forms; raw JSON only in Recipes. |
| Editable file viewer / save | Absent | Read-only + Attach. |
| Jump-to-latest button | Absent | Auto-stick + manual scroll. |
| Right-click menu in Files tree | Absent | Only Changes view has file menus. |
| Native OS notifications / dock badge | Absent | Toast + sidebar dots + tray popover. |
| Fuzzy command palette | Absent | Substring on titles. |
| Thinking / reasoning block label | Not located | Only "Working…" status strings and "Worked for <time>". Reasoning rendering not confirmed. |
| Inline rename in the row | Not verified | Menu item Rename… calls `showRename()` (`src/main.ts:4016`); whether it is in-place or a dialog was not traced. |

---

## 15. Quick reference: where to look for each UX area

| Area | Primary files |
|---|---|
| Shell markup and layout | `src/main.ts:312-333`, `src/styles.css:30-31, 494-516`, `src/sidebar-resize.css`, `src/sidebar-resize.ts` |
| Sidebar tasks | `src/main.ts:1009-1180, 3795-3830`, `src/sidebar-sections.ts`, `src/sidebar-sort.ts`, `src/thread-order.ts`, `src/styles.css:54-` (task rows) |
| Inspector | `src/main.ts:95-103, 3209-3300`, `src/inspector-tabs.ts`, `src/inspector-bar.css`, `src/file-tabs.ts`, `src/document-viewer.ts`, `src/changes-view.ts`, `src/diff-viewer.ts`, `src/browser.ts` |
| Settings | `src/settings.ts`, `src/settings.css`, `src/provider-settings.ts`, `src/connections.ts`, `src/about-settings.ts`, `src/main.ts:4035` |
| Open project / pickers | `src/main.ts:2347, 3489`, `src/bridge.ts:36-39`, `src/project-picker.ts`, `src/model-picker.ts` |
| Composer | `src/main.ts:1218, 1738-1790, 4929-4960`, `src/worktrees.ts`, `src/attachments.ts`, `src/slash-commands.ts`, `src/file-mentions.ts`, `src/message-queue.ts`, `src/approval-modes.ts` |
| Transcript | `src/main.ts:1267-1420, 609-627`, `src/turn-activity.ts`, `src/tool-activity.ts`, `src/tool-trace.ts`, `src/tool-cards.ts`, `src/turn-changes.ts`, `src/enriched-markdown.ts`, `src/generative-ui.ts`, `src/message-actions.ts`, `src/thread-find.ts` |
| Approvals | `src/approval-bar.ts`, `src/main.ts:1719-1737`, `src/agent-input.ts` |
| Command palette, shortcuts | `src/main.ts:3909-3935, 4708-4712, 4920-4960`, `src/platform.ts` |
| Menus | `src/choice-menu.ts`, `src/main.ts:886-895` |
| Toasts, tooltips | `src/main.ts:844-861`, `src/tooltip.ts`, `src/dom.ts` |
| Visual tokens | `src/styles.css:1, 741-802`, `src/motion.css`, `src/ui-size.css`, `src/dom.ts` (icons) |
| Motion JS | `src/motion.ts` |
| Launcher, tray | `src/overlay.ts`, `src/tray-popover.ts`, `src-tauri/src/overlay.rs`, `src-tauri/src/tray.rs` |
| Desktop config | `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/Cargo.toml`, `src/bridge.ts:3` |

---

## 16. Recommended adaptation notes (for the implementer)

1. Keep the three-column grid with the same breakpoint table (section 1.1). The inspector, not the sidebar, is the place for secondary content, and it collapses to an overlay under 920px.
2. Reuse one dialog host and one floating-menu primitive (`showChoices`). Put close X top-right, Cancel left of primary.
3. Port the task-list model (groups: Active, Needs review, Pinned, Chats, folders, Completed) and its status vocabulary (Running clock, Approval, Answer, Limited, Failed, Interrupted, Unread) as-is. It is the strongest part of the UX.
4. The composer toolbar order is: Attach, Model (harness + model + effort), Approval mode, team, token saver, then Steer and Send/Stop. The placeholder and Enter/Cmd+Enter behaviour changes while running (queue vs send vs steer).
5. For the transcript, keep "Worked for <time>" collapsed activity, tool-group sentences ("Ran 2 searches"), and cards with max 6 rows. Keep the approval bar as a single slim line above the composer, grouping when there are several.
6. Settings is a full-page takeover with a left tablist, not a modal. Keep Back top-left.
7. Keep the file viewer read-only with an Attach action, unless the target app needs editing (then it needs a new component; none exists here).
8. The browser-preview mode (no native host, sample data) is useful for Playwright UI tests. It is a pattern worth copying.
