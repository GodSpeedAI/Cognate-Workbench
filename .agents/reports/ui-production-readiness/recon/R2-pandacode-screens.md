# R2: PandaCode donor screens (browser preview)

Donor: `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode` (v0.3.56, Tauri + Vite).
Screenshots: `/home/sprime01/projects/cognate-workbench/.agents/reports/ui-production-readiness/evidence/donor/` (58 PNGs, `NN-description.png`).

## How the app was run

- `npm ci --ignore-scripts` in the donor dir (succeeded, no bun fallback needed).
- `npx vite --host 127.0.0.1 --port 1420 --strictPort`, served the browser preview with no Tauri backend. The preview module (`src/preview.ts`) supplies sample projects, tasks, and replies, and the header shows the "Browser preview · sample data" label on every screen. The label was left visible.
- Driver: `playwright-core` from the cognate-workbench `node_modules`, using the Chromium in `~/.cache/ms-playwright`. The donor's own `scripts/screenshots/capture.spec.ts` was not used: it targets a system Chrome path, writes to `docs/screenshots` and `/tmp`, and hides preview labels. Its sample states (`?sections` and the `showcase.js` task set) informed the flows below.
- Viewport 1440x900 at DPR 1 unless noted. Narrow screens use 390x844.
- Theme: `localStorage['pandacode.theme']` set to `dark` or `light` before load (`src/theme.ts`).
- Helper scripts: `/tmp/claude-1000/-home-sprime01-projects-cognate-workbench/d3716090-fd73-45cd-a4b7-a5539e33a75a/scratchpad/r2/` (`capture.mjs`, `capture2.mjs`, `capture3.mjs`, `capture4.mjs`, `capture5.mjs`, `capture6.mjs`, probes).
- Dev server stopped at the end.

Clicks named below are on-screen labels. Keys are Ctrl on Linux (the app shows Ctrl and Meta as CommandOrControl).

## Screenshot index

### Main shell, sidebar, conversation

| File | How reached | What is visible |
|---|---|---|
| `01-main-shell-dark-conversation.png` | Fresh load, dark theme, no clicks. | Three-column layout. Left sidebar (PandaCode title; New task Ctrl N, New chat, Search Ctrl K; "All projects" header with sort, download, and + icons; "Filter tasks" field; project groups orbit and pandacode with task rows; Bots bar near bottom; footer icons for help, usage, archive, settings, theme). Center: header with breadcrumb "orbit", view switch (Conversation / Board / GitHub), Deploy, moodboards, browser, terminal, inspector toggle, and "..." task menu. The user message, a collapsed "Tool activity" row, a "3 changed files +6 −2" card with an "Open diff" button, and a composer at the bottom (model chip Claude Sonnet 5, Standard, Team, Saver, send). Right: inspector with the Changes tab selected and a per-file diff list. |
| `02-sidebar-project-filter-menu.png` | Click "Filter projects" (the "All projects" dropdown under the sidebar title). Escape. | Sidebar menu anchored under the dropdown. |
| `03-sidebar-sort-and-view-menu.png` | Click "Sort and view" (sort icon beside "All projects"). Escape. | Popover with Sort tasks (Manual selected, Recent activity, Created), Sort projects (Recent activity selected, Added, Name, Manual), "Show per project" segmented control (3, 6 selected, 10, 15), and Group (By project selected, Flat list). |
| `04-conversation-tool-activity-expanded.png` | Click the "Tool activity" summary row in the transcript. | Expanded group shows the assistant intro text, "Read 1 file", the reply text, and "Ran 1 command and used 1 tool". The reply's markdown (### heading, bullets, code fence) appears as one run-on paragraph with literal `###`, `**`, and backticks. This may be the preview's seeded string rather than the renderer; not verified. |
| `05-sidebar-collapsed.png` | Click "Hide sidebar" (top-left icon, `#sidebar-toggle`). | Sidebar removed. Header gains a sidebar toggle at far left, and the conversation widens. |
| `28-main-shell-theme-toggled-conversation.png` | From the dark start, click the sun/moon theme button in the sidebar footer (`data-action="toggle-theme"`). | Light theme: light background, dark text, same layout. Confirmed light by mean luminance (about 221/255). |
| `49-light-main-shell-conversation.png` | Fresh load with `pandacode.theme=light`. Click "Tool activity". | Light version of the main shell, expanded tool activity, changed-files card, and right-hand changes list. |
| `53-narrow-390-main-shell.png` | Fresh load at 390x844, dark. | Sidebar collapses to a 58px icon rail (toggle, new, search, bots, and footer icons). Header is condensed with the view switch as icons. Composer is compact: model chip shows "C." (truncated), with the Saver and send controls. |
| `54-narrow-390-sidebar-hidden.png` | At 390 px, click the rail's "Hide sidebar" (`#sidebar-toggle`). | Rail disappears completely (sidebar width 0). Button label changes to "Show sidebar". A full-width sidebar was not reached at 390 px. |
| `55-narrow-390-inspector-open.png` | At 390 px, click the inspector toggle in the header. | Inspector covers the full width: Changes tab with "+", "All changes" header, and diffs stacked vertically, replacing the conversation. |

### Right panel / inspector / file viewer

| File | How reached | What is visible |
|---|---|---|
| `07-inspector-files-tab.png` | Click the "+" (Open a view, `.inspector-tab-add`) in the inspector tab strip, then choose "Files". | Inspector tabs now read Changes (3), Files (active), +. File tree rooted at "orbit": src, public, index.html, package.json, README.md, tsconfig.json, report.pdf, proposal.docx, budget.xlsx, screenshot.png, each with a type icon. |
| `08-readme-click-opens-changed-files-dialog.png` | With Files open, click `README.md` in the tree. | Opens the "Changed files" modal (not a file preview) with README.md selected, showing Unified/Split toggle, Wrap, and a line-level diff. Because README.md is changed, the file tree opens the diff rather than the file. A plain (unchanged) file preview was not reached. |
| `10-inspector-search-tab-empty.png` | Open "Search" from the + menu. Typing "buildIndex" went into the **sidebar** "Filter tasks" field (it matched first), not the inspector. | Inspector Search panel: search field with Aa, ab, and regex toggles, and the hint "Search file names and text in this project." Empty state, no results. The sidebar shows "No tasks match". Inspector search input was not reached. |
| `11-inspector-browser-local-servers.png` | Click "Open browser" (globe icon in the header). | Browser inspector tab. URL bar placeholder "Enter URL or localhost port", navigation buttons, and a "Local servers" list: node (localhost:3000) and vite (localhost:5173), each with a status dot. |
| `12-terminal-drawer-open.png` | Click "Toggle terminal" (terminal icon). | Bottom drawer with "orbit" and "Terminal 1" tabs, plus add, minimize, and close. Output says "PandaCode browser preview / A real PTY is available in the desktop app." |
| `06-open-diff-dialog.png` | Click "Open diff" on the changed-files card in the conversation. Escape. | "Changed files" modal. Left list with search.ts, search-index.ts, README.md (each with +/- counts). Right pane shows the file's diff: Unified/Split toggle, Wrap, close X at top-right, and "Saved at turn completion". |
| `01` (also `15`, `16`, `30`) | Changes is the default inspector tab on load. | Changes list with "All changes", "3 files +9 −6", and collapse/expand-all and "..." controls. Each file has its own header row with a status tag: Modified or Untracked. |

### Board, GitHub, new task, new chat

| File | How reached | What is visible |
|---|---|---|
| `13-board-view.png` | Click "Board view" (segmented control in header). | Kanban titled "All projects", with a "Project board" breadcrumb. Columns: Pending (2 cards with Start buttons), In progress (empty, "Work happens here"), Review (2 cards), Completed (empty, "Finished and filed"). Header actions: folder+, archive, Import from GitHub, Add task. Footer: "Completed tasks archive after 7 days." |
| `14-github-view.png` | Click "GitHub view". | Left repo list (orbit, orbit-api, dotfiles, meadow, Other). Main header "orbit-labs/orbit", Public · TypeScript · main, description, project path chip. Tabs: Threads 3, Pull requests 4, Issues 5, Actions 7, plus search. Composer "Ask an agent to work on orbit…". Thread rows with status (Review, Pending) and PR chip #131. |
| `15-new-task-welcome.png` | Click "New task" in the sidebar (Ctrl N). | Centered "What should we build in orbit?" with the leaf mark. Composer footer chips: orbit, This computer, Local, feat/instant-search, Claude Sonnet 5, Full access, Team, Saver. |
| `16-new-chat-no-project.png` | Click "New chat". | "What's on your mind?" with "Move to project…" link. Composer placeholder "Ask anything…". Sidebar shows a Chats section with "New conversation". Header breadcrumb "Chat". |

### Models, commands, composer menus

| File | How reached | What is visible |
|---|---|---|
| `17-model-picker-open.png` | Click "Choose harness and model" (model chip in composer). | Floating menu above the composer: search "Search harnesses and models…", grouped by Claude Code, Codex, Kimi Code, OpenCode (slider for reasoning effort at the bottom). Each row shows name, context size, and a description. |
| `52-light-model-picker.png` | Same as 17 in light theme. | Same menu in light. |
| `57-narrow-390-model-picker.png` | Same as 17 at 390 px. | Menu spans the narrow width. |
| `18-command-palette-go-to-anything.png` | Press Ctrl+K. | "Go to anything" modal. Search "Search tasks and commands…" with Commands list: New task (Ctrl N), New chat (no project), Open project, Open browser, Toggle terminal (Ctrl J), Settings (Ctrl ,), Agent usage, Bots, Import conversations, Create worktree, GitHub. Footer: navigate, open, esc to close. |
| `19-command-palette-filtered.png` | Type "set" in the palette. | Filtered list shows only Settings (Ctrl ,). |
| `20-composer-slash-command-menu.png` | Type "/" in the composer. | "Commands" popover above the composer: /new, /model, /permissions, /settings, /theme, /help, /skills, /diff, /status, /context, with "24 commands" and footer hints. |
| `21-composer-file-mention-menu.png` | Type "@" in the composer. | "Files and GitHub" popover: .gitignore, design notes.md, index.html, package.json, favicon.svg, README.md, search.test.ts, search.ts, and a partial row. Footer: "12 files · 4 on GitHub". |
| `32-composer-mode-menu.png` | Click "Standard" chip in the composer. | Menu with Standard (checked), Ask when needed, Plan mode, Full access, each with an info icon. |
| `33-composer-team-toggle-on.png` | Click "Team" in the composer. | Team chip in a selected state. Composer otherwise unchanged. |

### Task and project dialogs

| File | How reached | What is visible |
|---|---|---|
| `22-open-project-dialog.png` | Click "Open project" (sidebar header button). | "Open project" modal: "Project folder" label with an info icon, text field with placeholder /Users/you/Projects/my-app, footer buttons Browse…, Cancel, and a primary "Open project". No autocomplete. |
| `34-open-project-path-typed.png` | Same dialog, type `/home/sprime01/projects/cog`. | Typed path in the field. No suggestions appear, so no path autocomplete exists in the preview. Browse… opens the native picker, which needs Tauri and cannot be reached here. |
| `23-task-actions-menu.png` | Click "Task actions" (the "..." in the header). | Menu: Pin task, Rename task, Browser tests with Jev, Archive task, Open harness console, Copy project path, New task in a worktree…, Delete task… (last item in red). |
| `24-archived-tasks-sidebar.png` | Click "Archived tasks" (archive icon in sidebar footer). | Not a modal. The sidebar switches to an "Archived" section with count 0 and "No archived tasks". |
| `25-agent-usage-dialog.png` | Click "Agent usage" (chart icon, sidebar footer). | Modal with tabs Overview, Claude, Codex, Kimi, OpenCode, GLM, Grok, MiMo. Estimated API cost $628.35 (42 sessions, 30 days), average limit use 64%, Agents list with per-agent cost and a Week/Month/Year toggle. |
| `26-help-support-click-after-archived.png` | Click "Help & support" (? icon, sidebar footer). | No in-app dialog opened. The sidebar still shows the Archived view from step 24, so this is the state after the Help click, not a help screen. The Help link is probably external. |
| `27-add-bot-dialog.png` | Expand the "Bots" bar, click "Add bot". | "Bots" modal, left column "No bots yet" with a + button. Right: "New bot" form with presets (Chief of staff, Researcher, Dev On-call, Inbox Triage, Watcher, Blank), an icon picker, Name, Role, Instructions, a Soul markdown area with "Import soul.md…", and an Agent section with a Harness select (Claude Code). |
| `48-bots-panel-sidebar.png` | Click the "Bots" bar at the sidebar bottom. | Sidebar in Bots view: "Search" field, "Add a bot" button, empty list. The Bots footer is highlighted. |

### Conversation states

| File | How reached | What is visible |
|---|---|---|
| `29-streaming-reply-in-progress.png` | Open "Add keyboard shortcuts", type "Make every navigation action reachable from the keyboard" in the composer, press Enter, capture about 0.9 s later. | User bubble on the right. "Ran 1 command" row, then the reply streaming. Sidebar row "Add keyboard shortcuts" shows "now" and #131. Composer footer shows a "#131 Open" chip. |
| `30-reply-after-stream.png` | Same flow, about 4 s later. | Completed reply ("This is the browser preview…"), changed-files card, and the composer with "Default model". |
| `31-message-hover-actions.png` | Hover the last assistant message. | Copy and branch icons under the reply. The rest is the same as 30. |
| `58-sections-task-waiting-approval.png` | Load `/?sections`, click the "Migrate settings storage" task (`status: waiting_approval`). | Sidebar Active section lists four tasks (Speed up the search index, Migrate settings storage, Upgrade the build toolchain marked Failed, Profile startup time marked Limited). Main pane shows "What would you like to do?" with "Explore this project" and "Review my changes". No approval bar appears. |

### Settings (every section)

Opened with the gear in the sidebar footer. Settings has a left nav with Back (Esc) and a tab list: General, Appearance, Agents, Providers, Agent teams, Tools & add-ons, Skills & rules, Cloud sandboxes, Remote access, GitHub, About & updates.

| File | How reached | What is visible |
|---|---|---|
| `35-settings-general.png` | Settings gear (opens on General). | "General" page. Interface size with A−/100%/A+/Reset. Compact conversation and Expand tool activity toggles. Quick launcher toggle (on), keyboard shortcut field `CommandOrControl+Shift+Space` with Record, Save, Open. Projects list (orbit, pandacode) with Remove buttons. |
| `36-settings-appearance.png` | Click "Appearance" (`#settings-tab-appearance`). | Theme row ("Dark … Use light"), daily wallpapers toggle, accent swatches (Wallpaper, Classic, Blue, Green, Purple, Pink, Orange, Teal, Custom), VS Code theme list (PandaCode selected, GitHub Light Default), import .vsix field, wallpaper preview and sliders. |
| `37-settings-agents.png` | Click "Agents". | Default agent (Claude Code) and Default model (Claude Sonnet 5) dropdowns, Agent updates with Check updates, "Project checks after turns" toggle. Installed agents list with status: Claude Code, Codex, Kimi Code, OpenCode, Grok Build, Pi, DeepSeek, Command Code, Cline, Kilo Code installed; Antigravity Not installed. |
| `38-settings-providers.png` | Click "Providers". | Connections card with Add connection. Claude Code (Claude connection dropdown "Use current environment", Saved Claude login, Check login). GLM Coding Plan (Z.ai API key field, Save key disabled). MiMo Token Plan (Endpoint select, red "Required before MiMo tasks can start" note, MiMo API key field, Save key, Token Plan link). |
| `46-settings-providers-first-card-expanded.png` | Click the first provider summary in Providers. The view scrolled to the MiMo / OpenCode cards. | MiMo Token Plan at top. OpenCode card expanded with "Executable location" (path field with folder button, Apply). Antigravity collapsed. Grok Build with a sign-in note. |
| `39-settings-teams.png` | Click "Agent teams". | "Classic team setup" toggle, "Agent teams" with "+ New team", "Lead guidance" textarea with Save. |
| `40-settings-tools.png` | Click "Tools & add-ons". | Tools & integrations (Manage), Jev optional add-on (Set up Jev), "Capability and cache alignment" with Refresh: a capability table (Native, Discovered, Missing per harness) and a cache alignment table (Supported or Partial per harness). |
| `41-settings-skills.png` | Click "Skills & rules". | Import row (Skill, Local folder or file, User scope only, path field, Import). Catalogs (owner/name, default branch, Scan, Find my skill repositories). Library with entries "No force push" (Rule) and "Release notes" (Skill), each with harness checkboxes. "By harness" table below. |
| `42-settings-cloud.png` | Click "Cloud sandboxes". | Claude login for cloud agents (token field, Save token). Provider rows with Connect: Daytona, Cloudflare, AWS, Vercel, Railway, Google Cloud, E2B, Modal, CodeSandbox, Runloop, Blaxel, Tensorlake, Freestyle. |
| `43-settings-remote.png` | Click "Remote access". | PandaCode Connect with "Sign in with GitHub". Diagnostics (Refresh, Reconnect now, Copy report). Connection checklist (Signed in, Relay connected, Device online, Direct route, Encrypted session, all OK). Routes table (Studio iMac direct, Travel laptop relay failed with "That computer is offline."). Events log. |
| `44-settings-github.png` | Click "GitHub". | One row: GitHub, "Connected as you · orbit-labs/orbit", toggle on. |
| `45-settings-about.png` | Click "About & updates". | About PandaCode (Version Preview), License, Updates (Releases), Source code (GitHub repository, Issues), Resource usage (sample mode notice; native core memory, active agents 0, open terminals 0, local database), Help & support (Open issues), App details. |
| `47-settings-agents-default-agent-menu.png` | In Agents, click the "Default agent" dropdown. | Menu of harnesses with Claude Code checked: Codex, Kimi Code, OpenCode, GLM Coding Plan, Antigravity, Grok Build, MiMo Token Plan, Pi, DeepSeek, Command Code, Cline, Kilo Code, Oh My Pi, and more (cut off). |
| `56-narrow-390-settings.png` | At 390 px, click Settings. | Settings General with the nav column at left. Controls are cramped (for example, "Compact conversation" text is clipped). |

### Light theme and narrow views (remaining)

| File | How reached | What is visible |
|---|---|---|
| `50-light-settings-appearance.png` | Fresh load with light theme, Settings, then Appearance. | Light Appearance page: "Use dark" button, daily wallpapers, accent swatches, VS Code theme list, wallpaper preview. |
| `51-light-board-view.png` | Light theme, click "Board view". | Light Kanban with the same four columns. |

## Not reached, and why

- **Simulators inspector tab**: `INSPECTOR_AVAILABLE` only offers Simulators on macOS or Windows. This runs on Linux, so the tab is never offered. The same gate hides the VM tab.
- **Pull request inspector tab**: offered only when the task has a linked PR and GitHub is enabled. The "Add keyboard shortcuts" task (#131) shows the chip, but the view menu entry did not appear, so the tab was not captured.
- **Approval bar**: the `waiting_approval` sample (`58`) shows only the status. The approval bar renders from live approval events, which the browser preview does not emit. Approve, deny, and details controls are not captured.
- **Onboarding / first run**: no first-run flow exists in the preview. The closest states are the welcome screens (`15`, `16`) and Settings > Providers (`38`, `46`). Sign-in and API-key forms are shown empty.
- **Add project path autocomplete**: none exists. `34` is a plain text field. Browse… calls the native folder picker through Tauri, which is not available in a browser.
- **Full sidebar at 390 px**: the narrow sidebar is a 58px rail, and its toggle hides it entirely. A full-width open sidebar was not reached (`54` shows the hidden state).
- **Unchanged-file preview in the Files tree**: clicking a changed file opens the diff dialog (`08`). A plain file preview was not captured.
- **Inspector Search results**: the search field in the inspector was not reached; `10` shows the empty state.
- **Bot settings (Scout channels tab) and the bot conversation**: the donor spec's bot flow was not run. Only the Add bot form (`27`) and the Bots sidebar (`48`) were captured.
- **Keyboard cheat sheet, moodboards, Deploy, Import conversations, worktree creation, and Skills/Jev dialogs**: not captured. Not part of the requested list.

## Observations

- The header label "Browser preview · sample data" is present on every screen, since the harness hiding was not used.
- The assistant reply in `04` renders as one paragraph with raw markdown tokens. This may come from the preview's seeded text, not the renderer. Not verified.
- Clicking a changed file in the Files tree opens the "Changed files" dialog (`08`), not a file viewer. This may be intended, but the screenshot shows the behaviour.
- At 390 px the sidebar is a 58px icon rail by default. Hiding it removes the rail entirely (`54`), so there is no icon-only path back except the header toggle.
- Screenshot 09 from the first pass was removed because the Changes click did not switch the tab. The Changes view is shown in `04`, `15`, `16`, `30`, and others.
