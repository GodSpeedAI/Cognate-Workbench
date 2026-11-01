# A2 Final audit: Cognate Workbench final screenshots vs PandaCode exemplar

Scope: the 129 shots in `evidence/final/` (all viewed, desktop and mobile, light and dark), donor shots in `evidence/donor/` (12 opened: 01, 03, 04, 06, 07, 13, 15, 17, 18, 22, 23, 35, 38, 39, 40, 43, 53, 55 cited; 41, 42, 44 cited by R2 only), R3 issue list, and the five operator complaints. A1 was treated as a claim list to re-check, not as evidence. Intended differences (Cobalt identity, no wallpaper, Settings close X on the right, Skills/cloud/GitHub settings absent) are not counted as defects.

Limit of this audit: screenshots prove appearance and static state. They do not prove typing, network behaviour, timing, or the desktop window.

Donor shorthand: `D01` = `donor/01-main-shell-dark-conversation.png`, and so on. Final shorthand: files are under `evidence/final/`.

---

## 1. Parity matrix (A1 section 1, 32 rows)

Status: parity, better, partial, missing, can't tell.

| # | Surface | Status | Final evidence | Donor evidence | Note |
|---|---|---|---|---|---|
| 1 | Shell grid (sidebar / main / inspector) | parity | shell.desktop.light.png, t1b-inspector-changes.desktop.light.png | D01, D07 | |
| 2 | Header (breadcrumb, view switch, mode, inspector toggle, task menu) | partial | shell.desktop.light.png, t1b-task-menu.desktop.light.png | D01 | No browser, terminal or Deploy control; no header "..." task menu; mode is plain text "STANDARD". |
| 3 | Sidebar: project groups, session status, timestamps | partial | shell.desktop.light.png, t1b-running-turn.desktop.light.png | D01 | No per-session status icons or PR/issue chips. Duplicate untitled "New Session / now" rows. Workspace badges truncate (D-24). |
| 4 | Sidebar session row menu | partial | t1b-session-row-menu.desktop.light.png | D23 | "Archive" only. Donor has pin, rename, copy path, worktree, delete. |
| 5 | Workspace rename / delete | parity | rename-workspace-dialog.desktop.light.png, t4-delete-workspace.desktop.light.png | D02 | Both confirm. Title quote glyph wrong (D-15). |
| 6 | Sidebar sort / filter / group popover | partial | t4-view-options.desktop.light.png, t4-view-options.desktop.dark.png | D03 | Clear and checked. No sort-projects, no per-project count. |
| 7 | Collapsed rail | parity | shell.mobile.light.png, t1b-mobile-drawer.mobile.light.png | D05, D53 | |
| 8 | Inspector tabs and "+" add | partial | t4-inspector-tabs.desktop.light.png, t3-files-tree.desktop.light.png | D07 | Icon-only except active tab; no "+" add-view; unlabelled theme icon (D-13). |
| 9 | Inspector resize | parity | t1b-inspector-wide.desktop.light.png | D01 | Drag edge visible; labels appear at wide width. |
| 10 | Files tree and viewer | partial | t3-files-tree.desktop.light.png, t3-files-tree.mobile.light.png | D07, D08 | Tree is a tab and hidden while a file is open (D-14). No git-state colours. |
| 11 | Diff and changes (changed-files list, diff view, dialog) | partial | f1-diff-view.desktop.light.png, f1-turn-changes.desktop.light.png, t1b-inspector-changes.desktop.light.png | D06, D08 | Populated diff now shown with Unified/Split/Line-wrap icons. Diff lives in an inspector "Review" tab, not a dialog. Toolbar wraps to two rows at 340 px (D-26). |
| 12 | Conversation: tool activity group + changed-files card | parity | f1-turn-changes.desktop.light.png, f1-turn-changes.mobile.light.png | D04, D01 | A1 said missing. Now present ("1 file changed this turn +1 -1", Open diff). Fixed. |
| 13 | Settings layout (left nav, title, sections, close) | parity | settings-general.desktop.light.png, settings-about.desktop.light.png | D35 | Left nav, title, row cards, close X on right (operator intent). No "Back" link. Nine nav sections vs eleven in donor. |
| 14 | Settings: General | partial | settings-general.desktop.light.png | D35 | No interface-size stepper, compact-conversation toggle, quick launcher or projects list. Selects are styled. |
| 15 | Settings: Appearance | parity | settings-appearance.desktop.light.png, settings-appearance.desktop.dark.png | D36 | Theme segmented control and font-size stepper. Accents and wallpaper are brand exclusions. |
| 16 | Settings: Providers | partial | settings-models.desktop.light.png, providers-list.desktop.light.png, providers-card-test.desktop.light.png | D38, D46 | CRUD, status pills and Test connection are good. No per-harness login cards (Claude connection, Check login). |
| 17 | Provider add wizard | better | providers-wizard.desktop.light.png, providers-azure.desktop.light.png, settings-models-wizard.desktop.light.png | D38 | Category groups. Native protocol select (D-1) and truncated card text (D-16) hold it back. |
| 18 | Agents and external CLIs | parity | agents-settings.desktop.light.png, agents-settings.desktop.dark.png | D37 | Installed/verified state, location, protocol, approvals, sign-in hints, install commands. |
| 19 | Plugins, tools, presets | partial | settings-plugins.desktop.light.png, settings-presets.desktop.light.png, plugins-panel.desktop.light.png | D40, D41 | No capability/cache table. "Session plugins" rendered as a link (D-19). Native "Standard mode" select (D-2). |
| 20 | Remote access (and Skills, cloud, GitHub) | partial | remote-dialog.desktop.light.png | D43 | Remote is a one-button dialog. No diagnostics, connection state, routes or events (D-31). Skills, cloud and GitHub are intended exclusions per operator. |
| 21 | Agent teams / experts | partial | t4-experts.desktop.light.png, t1b-view-experts.desktop.light.png, f1-experts-form.desktop.light.png | D39 | No lead-guidance editor. Ledger lines repeat "settled conservatively" (D-21). |
| 22 | Model picker | partial | model-picker.desktop.light.png, t2-model-picker.desktop.light.png | D17 | No context size, description or reasoning-effort control. "Checking for more models..." under the active model (D-5). Search double ring. |
| 23 | Composer toolbar (attach, mode, team, saver, send) | partial | shell.desktop.light.png, harness-approval.desktop.light.png | D01, D32, D33 | No "+" attach, no mode menu with descriptions, no Team toggle. Permission is a styled chip in these builds (native select gone). |
| 24 | Composer context bar | partial | shell.desktop.light.png, t1b-running-turn.desktop.light.png | D15, D01 | Workspace, Local and harness chips present. No branch chip. |
| 25 | Approvals bar | can't tell | harness-approval.desktop.light.png, harness-approval.desktop.dark.png | none captured | Clear and specific ("Waiting for approval", Reject, Allow once). No donor shot to compare. |
| 26 | Command palette | parity | palette-open.desktop.light.png, palette-filtered.desktop.light.png | D18, D19 | Sections, shortcut chips, footer hints. |
| 27 | Toasts | better | toast-undo.desktop.light.png, toast-undo.desktop.dark.png | none | Top-right, undo on archive. |
| 28 | Keyboard shortcuts | better | settings-shortcuts.desktop.light.png, settings-shortcuts.desktop.dark.png | D35 (partial) | Full editable table with search. |
| 29 | Onboarding / first run | better | t2-welcome.desktop.light.png, t2-provider-step.desktop.light.png, t2-folder-step.desktop.light.png | none | Three-step flow. Provider step scrolled so its title is hidden (D-3). Dead end from R3 #5 is gone. |
| 30 | Open project / folder picking | can't tell | add-workspace-dialog.desktop.light.png, t2-folder-step.desktop.light.png, f1-add-workspace-protected.desktop.light.png | D22, D34 | No final shot shows suggestions for any partial input. Autocomplete unproven in the final set (D-4). |
| 31 | Mobile / narrow (390 px) | partial | shell.mobile.light.png, t1b-mobile-drawer.mobile.light.png, t1b-mobile-inspector.mobile.light.png, settings-general.mobile.light.png | D53, D54, D55, D56 | Structure matches. Drawer with scrim is better than donor. Header, composer chips and settings tab strip clip (D-9 to D-11). |
| 32 | Dark mode | parity | shell.desktop.dark.png, settings-governance.desktop.dark.png, t4-experts.desktop.dark.png | D01 | Two small contrast misses (D-17, D-18). |

Counts: parity 10, better 4, partial 16, missing 0 in this matrix, can't tell 2. Donor surfaces with no Cognate counterpart at all (not in A1's 32 rows): Board view (D13), GitHub view (D14), Bots panel (D48), Skills and rules (D41), Cloud sandboxes (D42), GitHub settings (D44), Settings "Tools" capability/cache table (D40). Skills, cloud and GitHub are intended exclusions. Board view and Bots are not listed as intended and are counted as missing (D-32).

---

## 2. R3 issues (26): status with proof

Status counts: fixed 16, partial 2, not fixed 2, can't tell 6.

| R3 # | Issue | Status | Proof (final shot) |
|---|---|---|---|
| 1 | Folder autocomplete misses most typed paths | can't tell | No final shot shows any suggestion list. Only the empty input (add-workspace-dialog.desktop.light.png) and the protected-path popover (f1-add-workspace-protected.desktop.light.png). |
| 2 | Raw JSON error text and 400 per keystroke | fixed (copy) | f1-add-workspace-protected.desktop.light.png shows plain text "The Workbench's own application folder is protected...". Request count not visible in a screenshot (can't tell). |
| 3 | Dark, low-contrast, duplicated suggestion dropdown | can't tell | No dropdown in final shots. |
| 4 | "Open configuration file" is a stacked modal | fixed | t3-settings-config.desktop.light.png: Config opens in the right inspector, framed editor with "Not yet written" chip, Revert and Save. Typing not provable. |
| 5 | First-run dead end, key-only step | fixed | t2-provider-step.desktop.light.png shows the full provider form (display name, base URL, protocol, key, model). Title is hidden by scroll (D-3). |
| 6 | Failing model call looks like a hang | can't tell | No final shot of an unreachable provider. The auth path now shows a clear error card (harness-auth-error.desktop.light.png, "This turn failed ... Retry"). |
| 7 | Delete workspace has no confirm | fixed | t4-delete-workspace.desktop.light.png confirm dialog with explanation. |
| 8 | Experts cost copy contradicts itself | fixed | t4-experts.desktop.light.png, t1b-view-experts.desktop.light.png: "Cost unknown (no price configured)". No "USD 0.000000" anywhere. |
| 9 | Mobile expanded sidebar squeezes conversation | fixed | t1b-mobile-drawer.mobile.light.png: drawer overlays with scrim. |
| 10 | Governance "Declare proof" clipped | fixed | settings-governance.desktop.light.png: button inside card, fully visible. |
| 11 | Close affordances inconsistent | fixed | Right-side X in settings-general, remote-dialog, rename-workspace-dialog, plugins-panel. Config panel X is on the right. |
| 12 | Composer model chip does nothing | can't tell | Chip present in shell.desktop.light.png. No hover or click state captured. |
| 13 | Native and unstyled controls | not fixed | Native select in t2-provider-step.desktop.light.png (API protocol), providers-azure.desktop.light.png, settings-plugins.desktop.light.png ("Standard mode"), f1-workbench-workflows.desktop.light.png. Settings General buttons are styled now. |
| 14 | Settings modal height jumps | fixed | Settings is a full panel now (settings-general.desktop.light.png). Nothing re-centres. |
| 15 | Internal names and jargon in copy | partial | Env var names gone from Governance copy (settings-governance.desktop.light.png). Remaining: "host containment configuration is unavailable" (add-workspace-dialog.desktop.light.png), "Read-only - set when the host starts". |
| 16 | Archive control shows backspace glyph | can't tell | Session row menu shows "Archive" text (t1b-session-row-menu.desktop.light.png). Sidebar hover icon not captured. |
| 17 | View options popover hard to read | fixed | t4-view-options.desktop.light.png: Group by, Order by, Filter sections with check marks. |
| 18 | No keyboard shortcuts or palette discoverable | fixed | palette-open.desktop.light.png, settings-shortcuts.desktop.light.png. |
| 19 | Experts form misaligned | fixed | f1-experts-form.desktop.light.png: form aligned with header. |
| 20 | Workflow DAG overflows its card | partial | f1-workbench-workflows.desktop.light.png shows a horizontal scrollbar. The workflow select has no visible arrow. |
| 21 | Plugin detail is a dead end | fixed | f1-plugin-detail.desktop.light.png: "Configure in Settings -> Providers" button. |
| 22 | Mobile collapsed rail hides navigation | fixed | t1b-mobile-drawer.mobile.light.png: Experts, Plugins, Remote, Workbench reachable in drawer. |
| 23 | First run shows an error before user action | fixed | t2-welcome.desktop.light.png: background reads "No workspace selected", not "Unable to create default workspace". |
| 24 | Sidebar badges truncate | not fixed | harness-approval.desktop.light.png: "Waiting for appr... APPROVAL". |
| 25 | Home-subtree refusal unexplained | fixed | f1-add-workspace-protected.desktop.light.png explains why the folder is protected. |
| 26 | Customized settings link is a 15 px target | can't tell | Link not visible in any final shot (settings-models.desktop.light.png). |

---

## 3. Operator complaints

| Complaint | Status | Proof |
|---|---|---|
| (a) "Open configuration file" opens in a side viewer and is editable | resolved (typing not provable) | t3-settings-config.desktop.light.png and .dark.png: side inspector with editor, Save and Revert. t4-config-tab.mobile.light.png: full-width sheet. Save looks disabled in light and enabled in dark with no edits (D-30). |
| (b) Settings close X on the right | resolved | settings-general.desktop.light.png (X at about x 1071), remote-dialog.desktop.light.png, rename-workspace-dialog.desktop.light.png. Two X controls appear when inspector and Settings are both open (D-6). |
| (c) First run goes to a full third-party provider form, not an API-key-only step | resolved, with defect | t2-welcome.desktop.light.png (step 1 of 3), then t2-provider-step.desktop.light.png (display name, provider ID, base URL, API protocol, API key, model, Test connection, Configure later, Save and continue). The modal is scrolled so its title is hidden (D-3). |
| (d) Add workspace autocomplete finds folders from partial input | not proven | No final shot shows suggestions for a partial path. Source exists (src/capabilities/workspaceDirectorySuggest.ts, src/ui/DirectoryField.tsx) but evidence is missing. Add shots for "proj", "~/Doc", and "<dir>/" before accepting. |
| (e) Desktop app window | cannot be proven by screenshots | Screenshots are browser captures. Window chrome, native menus, and the desktop shell need a desktop-level capture or a manual check. |

---

## 4. Remaining defects

Severity: P0 blocks release, P1 blocks production readiness, P2 polish or parity gap. No P0 is proven by screenshots.

| ID | Sev | Where (file / location) | Evidence | Defect | Fix |
|---|---|---|---|---|---|
| D-1 | P1 | src/ui/models/ProviderWizard.tsx:327 (API protocol `<select>`) | t2-provider-step.desktop.light.png, .dark.png; providers-azure.desktop.light.png | Native select with default triangle inside a styled form; the first-run path uses it. | Replace with src/ui/shell/MenuSelect.tsx or the General pane's styled select. |
| D-2 | P2 | src/ui/App.tsx (Plugins pane, near line 1040); src/settings.ts:99 | settings-plugins.desktop.light.png, .dark.png | Native "Standard mode" select. | Use MenuSelect. |
| D-3 | P1 | src/ui/models/ProviderWizard.tsx (dialog scroll container) | t2-provider-step.desktop.light.png, .dark.png, .mobile.light.png, .mobile.dark.png | First-run modal opens scrolled; title and stepper header are hidden. | Reset scroll on open, or move header out of the scroll region. |
| D-4 | P1 | src/capabilities/workspaceDirectorySuggest.ts; src/ui/DirectoryField.tsx | none (no final shot) | Complaint (d) unproven. R3 #1 root causes (relative, ~, child listing) not shown fixed. | Add final shots for partial input. Fix if they fail. |
| D-5 | P1 | src/ui/models/ModelPicker.tsx:221 | model-picker.desktop.light.png, t2-model-picker.desktop.light.png | "Checking for more models..." under the active model. Stuck state can't be ruled out. | Show the note only while the fetch is in flight; add a timeout and a final state. |
| D-6 | P2 | src/ui/App.tsx (Settings X and inspector X) | settings-shortcuts.desktop.light.png, t1b-settings-inspector.desktop.light.png | Two close X controls in one viewport. | Keep one close target per surface. |
| D-7 | P2 | Session title defaulting (src/projections/sessions.ts and the sidebar) | shell.desktop.light.png; agent-chip-menu.desktop.light.png | Three identical untitled "New Session / now" rows. | Auto-title from the first prompt; show a placeholder title otherwise. |
| D-8 | P2 | Harness test fixtures (scenario titles) | f1-add-workspace-protected, agent-chip-menu, f1-turn-changes, f1-experts-form, f1-workbench-workflows, harness-approval (sidebar) | Sidebar shows "[[scenario:edit]] change ..." titles. Evidence hygiene, but it reads as product text. | Rename harness sessions before capture. Confirm real titles are derived from prompts. |
| D-9 | P2 | Header in src/ui/App.tsx (mobile breakpoint) | shell.mobile.light.png, t1b-running-turn.mobile.light.png | Workspace truncated to "cognate-sa...", session title "Start a se...", "Experts & Teams" shortened to "Experts" and clipped at right edge. | Collapse secondary header items on narrow widths; keep full tab labels. |
| D-10 | P2 | Composer chip row (mobile) | shell.mobile.light.png; harness-approval.mobile.light.png; harness-auth-error.mobile.light.png | Chips wrap to two rows. Long info text takes space in composer. | Move long info text into the card above the composer. |
| D-11 | P2 | src/ui/App.tsx:1440 (settings-nav tab strip) | settings-general.mobile.*, settings-governance.mobile.*, agents-settings.mobile.dark.png, settings-models-wizard.mobile.light.png | Tab strip scrolls with no fade; edge tabs cut mid-word. | Add an edge fade or scroll affordance. |
| D-12 | P2 | ProviderWizard.tsx footer | t2-provider-step.mobile.light.png, .dark.png | Footer buttons wrap to two or three lines. | Stack or shorten labels on mobile. |
| D-13 | P2 | Inspector tab strip (src/ui/App.tsx) | t1b-inspector-changes.desktop.*, t4-inspector-tabs.desktop.* | Icon-only tabs except the active one; unlabelled theme icon at strip end. | Label tabs at default width; remove stray theme icon. |
| D-14 | P2 | Files panel (src/ui/App.tsx) | t3-files-tree.desktop.light.png, .mobile.light.png | Tree is a tab and hidden while a file is open. The INDEX description (folder expanded plus file open) is wrong. | Show tree beside the open file, or as a collapsible left pane. Correct INDEX. |
| D-15 | P2 | src/ui/App.tsx:3187 (DialogHeader title) | t4-delete-workspace.desktop.light.png | Title shows a closing curly quote in place of the opening quote. Source uses straight quotes, so a typography transform may be involved. | Check CSS or text transform; use the same quote style as the rest of the app. |
| D-16 | P2 | ProviderWizard.tsx card descriptions | providers-wizard.desktop.light.png; settings-models-wizard.desktop.light.png | Descriptions truncated with ellipsis (Z.ai GLM, Xiaomi MiMo, Azure "Needs the deployment UR..."). | Allow two-line clamp or shorten copy. |
| D-17 | P2 | Choose workspace control (src/ui/App.tsx:4150) | t2-empty-state.desktop.light.png | Disabled "Choose workspace" is pale on pale; low contrast. | Use a disabled style with enough contrast. |
| D-18 | P2 | GovernancePane placeholder (src/ui/GovernancePane.tsx) | settings-governance.desktop.dark.png | "bun test" placeholder is grey and low contrast on dark. | Raise placeholder contrast. |
| D-19 | P2 | src/ui/App.tsx:1040-1053 | settings-plugins.desktop.light.png | "Session plugins" rendered as an underlined link-style label. | Use a heading style. |
| D-20 | P2 | src/capabilities/containedWorkspace.ts:108 (reason string); src/capabilities/executionWorlds.ts:110 | add-workspace-dialog.desktop.light.png | "host containment configuration is unavailable" is internal jargon in user copy. | Replace with user-facing copy and a next step. |
| D-21 | P2 | src/components/modelProvider.ts:86, :95 | t4-experts.desktop.light.png; f1-experts-spending.desktop.light.png | "settled conservatively; provider usage unreported" repeated on ten run lines. | Show once per group, or move to a tooltip. |
| D-22 | P2 | src/ui/App.tsx:1592-1693 ("Deep diving for Ns") | t1b-running-turn.desktop.light.png | Status copy is vague. | Show the current step or model name. |
| D-23 | P2 | Session row menu (src/ui/App.tsx) | t1b-session-row-menu.desktop.light.png | Menu offers only "Archive". | Add pin, rename, copy path, delete (donor D23). |
| D-24 | P2 | Sidebar workspace row badges | harness-approval.desktop.light.png | "Waiting for appr... APPROVAL" truncated. | Shorten badge text; allow the title to wrap. |
| D-25 | P2 | Diff header vs composer | f1-diff-view.desktop.light.png | Header says "Review - turn 2"; composer says "1 turn". Unverified. | Use one turn counter. |
| D-26 | P2 | Diff toolbar in inspector (src/ui/App.tsx) | f1-diff-view.desktop.light.png, .dark.png | Toolbar wraps to two rows at 340 px. | Collapse extra actions into a menu. |
| D-27 | P2 | Add workspace error (src/ui/DirectoryField.tsx) | f1-add-workspace-protected.desktop.light.png | Red error text sits against footer divider. | Add spacing above the footer. |
| D-28 | P2 | Workflow select (src/ui/workbench/Workbench.tsx:461, :480) | f1-workbench-workflows.desktop.light.png | Native-looking select, no visible arrow. | Use MenuSelect. |
| D-29 | P2 | Delete dialog (src/ui/App.tsx:3194) | t4-delete-workspace.desktop.dark.png | Dark "Cancel" has no visible border. | Add border in dark theme. |
| D-30 | P2 | Config editor Save button | t3-settings-config.desktop.light.png vs .dark.png | Save looks disabled in light and enabled in dark with no edits. | Make disabled state consistent across themes. |
| D-31 | P1 | Remote access (src/ui/App.tsx remote dialog) | remote-dialog.desktop.light.png vs donor D43 | No connection state, routes, last error or event log. Operators cannot diagnose a relay failure. | Add a diagnostics view (Connection, Routes, Events, Copy report). |
| D-32 | P2 | Missing features (not intended) | donor D13 (Board), D48 (Bots), D01/D32/D33 (composer and header controls), D35 (interface size, launcher, projects list), D38 (harness login cards), D39 (lead guidance), D03 (sort projects, counts), D17 (per-model context and reasoning) | Parity gaps listed in section 1. | Prioritise: composer mode and Team toggle, harness login checks, lead guidance, model reasoning control. Board and Bots need a product decision. |
| D-33 | P2 | Evidence index (evidence/final/INDEX.md) | t1b-first-run.desktop.light.png | INDEX says "No workspace: Choose folder"; image shows a configured workspace with a session. | Correct INDEX; re-capture if the intended state was empty. |
| D-34 | P2 | Model picker (src/ui/models/ModelPicker.tsx) | model-picker.desktop.light.png | Search input shows a double focus ring. | Use one focus ring. |

---

## 5. Verdict

**UX parity: not at parity.** Of 32 A1 rows, 10 are parity, 4 better, 16 partial, 2 can't tell. The shell, settings layout, providers, agents, palette, toasts and shortcuts are close to the donor. The conversation, changes, and first-run paths are much better than the previous build. Parity gaps remain in the composer (no mode menu, no Team toggle, no attach), the model picker (no context or reasoning), the header, the Files tree, and remote diagnostics. The Board view and Bots are not covered at all.

**Production readiness: not ready on screenshot evidence.** Blocking reasons:

1. **First-run provider form (D-1, D-3).** It is the first thing a new user sees. It uses a native select, and it opens scrolled so its title and step header are hidden.
2. **Folder autocomplete unproven (D-4, complaint d).** Nothing in the final set shows the feature working, so the operator's own complaint is not closed.
3. **Model picker state unproven (D-5).** "Checking for more models..." appears under the active model. A stuck state would be a production bug.
4. **Remote access cannot be diagnosed (D-31).** The donor shows diagnostics; Cognate shows a one-button dialog.
5. **Desktop window unproven (complaint e).** Needs a desktop-level capture or manual check.
6. **Evidence hygiene (D-8, D-33).** Harness scenario titles appear in product screenshots, and the INDEX mislabels one shot. Final evidence should be re-captured before sign-off.

Top P2 defects to fix first: D-6 (double close X), D-7 (duplicate untitled sessions), D-9 and D-11 (mobile header and tab clipping), D-14 (Files tree hidden), D-23 (session menu gaps).
