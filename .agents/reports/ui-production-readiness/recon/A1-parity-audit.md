# A1 Parity audit: Cognate Workbench AFTER vs PandaCode exemplar

Scope: screenshots only (plus R1/R2/R3 text). Colour and brand differences are ignored. Settings close X on the right is treated as intended.

Coverage (be aware of this when reading the findings):
- AFTER: about 100 of the 135 PNGs were opened and viewed. Every `autocomplete-*` shot and every `t3/` shot was viewed. The ~35 not opened are mostly light/dark or mobile twins of screens that were opened (for example, the remaining `t1a/settings-*.mobile|dark` variants and `t1b/*.dark` variants). Their claims rest on the twin.
- DONOR: 6 of 58 were opened directly (01, 06, 07, 17, 21, 35). The other donor claims rest on the R2 descriptions.
- BEFORE: not re-opened. R3 text is used as the baseline.

Shorthand: `A/` = `evidence/after/`, `D/` = `evidence/donor/`, `B/` = `evidence/before/`. Paths are relative to `.agents/reports/ui-production-readiness/`.

---

## 1. Parity matrix

Status key: parity, better, partial (what is missing), missing.

| # | Surface | PandaCode (donor evidence) | Cognate AFTER (evidence) | Status |
|---|---|---|---|---|
| 1 | Shell grid (sidebar / main / inspector) | D/01, D/07 | A/t1a/shell.desktop.light.png, A/t1b/t1b-inspector-changes.desktop.light.png | parity |
| 2 | Header (breadcrumb, view switch, mode, inspector toggle, task menu) | D/01: view switch, Deploy, browser, terminal, "..." task menu | A/t1b/t1b-view-experts.desktop.light.png, A/t1b/t1b-task-menu.desktop.light.png | partial: no browser or terminal toggle, no Deploy-type actions, no header task "..." menu. The task dropdown is a native `<select>` in A/t1a/shell.desktop.light.png. |
| 3 | Sidebar: project groups, session status, timestamps | D/01: project groups with status icons (`#131`, spinner, `K`) | A/t1b/t1b-running-turn.desktop.light.png (blue running dot + "now"), A/t1a/shell.desktop.light.png | partial: no status icons per session beyond a dot, no PR/issue chips, three identical "New Session / now" rows, workspace badges truncated |
| 4 | Sidebar row menu (session) | D/23 task menu: pin, rename, archive, copy path, worktree, delete | A/t1b/t1b-session-row-menu.desktop.light.png: "Archive" only | partial: no rename, pin, delete or copy path |
| 5 | Sidebar workspace row menu / rename / delete | D/02 filter menu, D/03 sort/view | A/t1a/rename-workspace-dialog.desktop.light.png, A/t4/t4-delete-workspace.desktop.light.png, A/t4/t4-delete-confirm.png | parity (rename and delete both confirm) |
| 6 | Sidebar filter / sort / group popover | D/03: sort tasks, sort projects, per-project count, group | A/t4/t4-view-options.desktop.light.png and .dark.png (Group by / Order by / Filter with check marks) | partial: no sort-projects, no per-project count |
| 7 | Sidebar collapsed (rail) | D/05, D/53 (58 px rail) | A/t1a/shell.mobile.light.png (icon rail, 390 px) | parity |
| 8 | Inspector tabs + "+" add | D/07: Changes (3), Files, +, icon tools | A/t4/t4-inspector-tabs.desktop.light.png, A/t4/t4-inspector-tabs.desktop.dark.png, A/t3/t3-files-tree.desktop.light.png | partial: tabs are icon-only except the active one, no "+" add-a-view menu, strip clips at default width (see defect 6) |
| 9 | Inspector resize | D/01 (fixed width panel) | A/t1b/t1b-inspector-wide.desktop.light.png (drag edge is visible) | parity |
| 10 | Files viewer / tree | D/07: tree with type icons and git state, D/08 | A/t3/t3-files-tree.desktop.light.png (tab strip + code view, Wrap, copy), A/t4/t4-inspector-tabs.desktop.dark.png (tree with "Filter loaded files") | partial: tree has icons but no git state; tree is not visible next to the open file in the desktop shot; no search |
| 11 | Diff / changes (changed-files card, changes list, diff dialog) | D/06 Changed files dialog (Unified/Split/Wrap), D/01 changed-files card, D/04 | A/t1b/t1b-inspector-changes.desktop.light.png shows "No changes yet" only. No AFTER shot has a populated diff, a changed-files card or a diff dialog. | partial (unverified): empty state is clear, but no populated diff is in the evidence, so the diff viewer cannot be judged |
| 12 | Conversation: tool activity group + changed-files card | D/04, D/01, D/30 | A/t1b/t1b-running-turn.desktop.light.png ("Editing files · hello.txt" line), A/t2/08-first-reply.png (markdown rendering OK) | missing (no changed-files card in AFTER) |
| 13 | Settings layout (left nav, title, sections, close) | D/35 (Back, left nav, 11 sections) | A/t1a/settings-general.desktop.light.png (left nav, title, description, row cards, close X on right) | parity for layout; partial for nav (no "Back", 8 sections vs 11) |
| 14 | Settings: General | D/35 (interface size stepper, compact, toggles, quick launcher, projects list) | A/t1a/settings-general.desktop.light.png (Permission, Language, Work details, Performance, Coding tools, Send behaviour) | partial: no interface-size control, no projects list, no quick launcher. Styled dropdowns are good. |
| 15 | Settings: Appearance | D/36 (theme row, accents, VS Code themes, wallpaper) | A/t1a/settings-appearance.desktop.light.png and .dark.png (theme segmented control, font size stepper) | parity for theme and font size; partial (no accent or theme import; that is brand, so ignored) |
| 16 | Settings: Models and providers | D/38, D/46 (Connections cards: Claude, GLM, MiMo, expand/collapse) | A/u5/providers-list.desktop.light.png, A/u5/providers-card-test.desktop.light.png (expanded card with protocol, base URL, model, Test connection), A/t1a/settings-models.desktop.light.png | parity for provider CRUD and status pills. Missing: per-harness login/connection cards (Claude login, sign-in checks). |
| 17 | Provider add wizard | D/38 (cards by category) | A/u5/providers-wizard.desktop.light.png (POPULAR / OPEN-MODEL HOSTS / ON THIS COMPUTER / ENTERPRISE / CUSTOM), A/u5/providers-azure.desktop.light.png, A/t2/03-provider-validation.png | better: categories, inline validation ("not a url"), Test connection. Partial: card descriptions truncated (defect 22), buttons are unstyled (defect 4/5). |
| 18 | Agents / external CLIs | D/37 (default agent, installed list with status), D/47 | A/u5/agents-settings.desktop.light.png, A/u5/agents-settings.mobile.dark.png, A/u5/agent-chip-menu.desktop.light.png | parity (installed/not installed, versions, install commands, sign-in hints). Better on transparency of location and protocol. |
| 19 | Plugins / tools / presets | D/40 (tools table, capability matrix), D/41 skills | A/t1a/settings-plugins.desktop.light.png, A/t1a/settings-presets.desktop.light.png, A/t1a/plugins-panel.desktop.light.png | partial: no skills and rules library, no capability/cache table. Plugin cards are clear. |
| 20 | Skills & rules, Cloud sandboxes, GitHub, Remote access (Settings sections) | D/41, D/42, D/44, D/43 | A/t1a/remote-dialog.desktop.light.png (a single "Turn on remote control" dialog) | missing (skills/rules, cloud sandboxes, GitHub) and partial (remote is a one-button dialog, no diagnostics or routes) |
| 21 | Agent teams / experts | D/39 (team setup, lead guidance) | A/t1b/t1b-view-experts.desktop.light.png, A/t4/t4-experts.desktop.light.png, A/t4/t4-experts.desktop.dark.png | partial: teams and experts exist with clear ownership, but no lead-guidance editor (not evidenced) |
| 22 | Model picker | D/17 (harness + model groups, context size, descriptions, reasoning slider), D/52, D/57 | A/u5/model-picker.desktop.light.png (grouped by provider, Active tag), A/t2/11-model-picker.png (stuck loading) | partial: no context size, no description, no reasoning-effort control, search has a double focus ring, and the list can stick on "Loading the provider's models…" (defect 2) |
| 23 | Composer toolbar (attach, mode, team, saver, send) | D/01, D/32 (mode menu: Standard / Ask / Plan / Full access), D/33 (Team toggle) | A/t1b/t1b-running-turn.desktop.light.png (Local, No task, running chip, Workspace Write, model chip, stop), A/t1a/shell.desktop.light.png | partial: no attach "+", no mode menu with descriptions, no Team toggle, permission is a native `<select>` in t1a/t2 builds (defect 1). The t1b build uses a styled chip, so the two builds disagree. |
| 24 | Composer context bar (repo, locality, harness, branch) | D/15, D/01 (orbit, Local, branch chip) | A/t1b/t1b-running-turn.desktop.light.png (cognate-sample, Local, No task), A/t4/t4-failure-block.png (proj-a, Local, Cognate (native), No task) | parity for workspace, locality and harness; partial: no branch chip. |
| 25 | Approvals bar | Not captured in donor (R2: approval bar is not emitted in preview) | A/u5/harness-approval.desktop.light.png, .dark.png, A/u5/e2e-harness-approval.png (Waiting for approval, Reject, Allow once, APPROVALS 1 pill) | can't tell against donor (no donor shot); AFTER is clear and specific. |
| 26 | Command palette ("Go to anything") | D/18 (Commands list, shortcuts, footer hints), D/19 (filter) | A/t1a/palette-open.desktop.light.png, A/t1a/palette-open.desktop.dark.png, A/t1a/palette-filtered.desktop.dark.png | parity (sections, shortcut chips, footer hints, Esc). Minor: "Keyboard shortcuts" is listed under SETTINGS. |
| 27 | Toasts | Not in donor shots | A/t1a/toast-undo.desktop.light.png and .dark.png ("Session archived / Undo"), A/t4/t4-delete-done.png ("Removed workspace") | better (undo on archive; confirmations). Defect 27 (overlaps composer). |
| 28 | Keyboard shortcuts | D/35 (Record / Save in General); D/18 chips | A/t1a/settings-shortcuts.desktop.light.png and .dark.png (sections, editable rows, chips, search) | better: full editable table, no donor equivalent captured. |
| 29 | Onboarding / first run | None in donor (R2) | A/t2/t2-welcome.desktop.light.png, A/t2/02-provider-step.png, A/t2/05-folder-step / t2-folder-step.desktop.light.png, A/t2/t2-empty-state.desktop.light.png | better: 3-step flow with clear copy; the R3 dead end is gone. Defect 5 (footer buttons) and the dark "Configure later" contrast drag it down. |
| 30 | Open project / folder picking | D/22 (plain text field, placeholder /Users/you/...), D/34 (no autocomplete) | A/t1a/add-workspace-dialog.desktop.light.png (empty state), A/autocomplete-1..5 (suggestions, fuzzy, drill-down, no-match), A/t2/06-folder-suggestions.png | better: autocomplete with drill-down and "No folders match" copy. Defect 16 (tiny × glyph) and defect 2 (native header select in the same modal backdrop). |
| 31 | Mobile / narrow (390 px) | D/53 (58 px rail), D/54 (hidden), D/55 (inspector full width), D/56 (settings cramped) | A/t1a/shell.mobile.light.png (rail), A/t1b/t1b-mobile-drawer.mobile.light.png (drawer with scrim), A/t1b/t1b-mobile-inspector.mobile.light.png (full-width inspector), A/t1a/settings-general.mobile.light.png | parity on structure; better on the drawer (R3 defect 9 fixed). Partial: settings tab strip clipped, conversation header tabs cramped (defects 11, 24). |
| 32 | Dark mode | D/01 (dark, wallpaper), D/28 | A/t1a/shell.desktop.dark.png, A/t1a/settings-governance.desktop.dark.png, A/t4/t4-experts.desktop.dark.png | parity for surfaces. Partial on contrast: wizard footer button (defect 5), session placeholders, governance textarea placeholder (defect 30). |

Counts (32 rows): parity 11, better 5, partial 13, missing 2 (rows 12 and 20), can't tell 1 (row 25). Row 11 (diff) is partial because the diff viewer is unverified.

---

## 2. R3 issues (26): status and proof

| R3 # | Issue | Status | AFTER proof |
|---|---|---|---|
| 1 | Folder autocomplete misses paths (relative, `~`, children) | FIXED | A/autocomplete-1-empty-focus.png (Documents, Downloads, projects, work with `~/` paths); A/autocomplete-2-partial-pro.png; A/autocomplete-3-fuzzy-cgw.png (`~/projects/cgw` → cognate-workbench); A/autocomplete-4-drilldown-after-tab.png (`.../projects/` lists children); A/t2/06-folder-suggestions.png |
| 2 | Raw error JSON in Add workspace; 400 per keystroke | CAN'T TELL | No shot of the protected-home path. The no-match state is clean (A/autocomplete-5-no-match.png). The 400 count is not visible in screenshots. |
| 3 | Suggestion dropdown dark, low contrast, duplicated | FIXED | Light surface, one row per folder, path right-aligned (A/autocomplete-2-partial-pro.png, A/autocomplete-4-drilldown-after-tab.png) |
| 4 | "Open configuration file" is a stacked modal with left X | PARTIAL | X is now on the right (A/t1a/config-dialog.desktop.light.png). It is still a second centred modal stacked on Settings. |
| 5 | First-run API key step dead end | FIXED | A/t2/t2-welcome.desktop.light.png → A/t2/t2-provider-step.desktop.light.png (full provider form) → A/t2/t2-folder-step.desktop.light.png; "No model provider connected" CTA on A/t2/t2-empty-state.desktop.light.png |
| 6 | Failing model call looks like a hang | FIXED | A/t4/t4-retry-card.png ("Can't reach mock — retrying (1/5)", NETWORK_ERROR, Stop, Open model settings); A/t4/t4-failure-block.png ("This turn failed", Retry). Defect 3 (stray band). |
| 7 | Delete workspace with no confirm; raw-id row | FIXED | A/t4/t4-delete-confirm.png (names the workspace, the file path and says files are untouched); A/t4/t4-delete-done.png (toast; row removed) |
| 8 | Experts cost copy contradicts itself | PARTIAL | Fixed in A/t4/t4-experts.desktop.light.png ("Booked cost … unknown"). Still contradicts in A/t1b/t1b-view-experts.desktop.light.png ("USD 0.000000 … 1 reservation(s) have unknown prices"). |
| 9 | Mobile: expanded sidebar squeezes conversation | FIXED | A/t1b/t1b-mobile-drawer.mobile.light.png (drawer overlays with scrim; conversation is not squeezed) |
| 10 | Governance "Declare proof" clipped | FIXED | A/t1a/settings-governance.desktop.light.png and .dark.png (button fully inside the card); A/t4/t4-governance.desktop.light.png |
| 11 | Close affordances inconsistent | FIXED (glyph still differs, see defect 16) | Settings, config, remote, rename, provider and add-workspace dialogs all show a right-side X (A/t1a/remote-dialog.desktop.light.png, A/t1a/rename-workspace-dialog.desktop.light.png) |
| 12 | Composer model chip looks like a control but is not | FIXED | Chip has a chevron and opens a picker: A/t2/t2-model-picker.desktop.light.png, A/u5/model-picker.desktop.light.png |
| 13 | Native and unstyled controls | NOT FIXED | Settings General is fixed (A/t1a/settings-general.desktop.light.png). Still native in the composer permission `<select>` (A/t1a/shell.desktop.light.png, A/t1a/shell.mobile.dark.png), the header task `<select>` (A/autocomplete-*), Session plugins `<select>` (A/t1a/settings-plugins.desktop.light.png), and unstyled provider buttons (A/u5/providers-azure.desktop.light.png, A/t2/03-provider-validation.png). |
| 14 | Settings modal height jumps between sections | FIXED | The frame is the same on every section: A/t1a/settings-general, settings-models, settings-appearance, settings-presets, settings-shortcuts all show the title at the same y and a full-height modal. |
| 15 | Internal names and jargon in user copy | NOT FIXED (partial improvement) | Experts header now reads "Read-only · set when the host starts" (A/t4/t4-experts.desktop.light.png). Still present: COGNATE_GOVERNANCE, COGNATE_REALITYTRACE_* in A/t1a/settings-governance.desktop.light.png; env variable table in A/t1a/config-dialog.desktop.light.png; raw JSON env names in A/t4/t4-config-dirty.png; "No case in focus" copy (defect 14). |
| 16 | Archive control uses a backspace glyph | FIXED | Archive shows a box icon on hover: A/t1a/toast-undo.desktop.dark.png; "Archive" menu item in A/t1b/t1b-session-row-menu.desktop.light.png |
| 17 | View options popover hard to read | FIXED | A/t4/t4-view-options.desktop.light.png and .dark.png: "Workspace" vs "Folder tree", check marks, bold selected values |
| 18 | No keyboard shortcuts or palette | FIXED | A/t1a/palette-open.desktop.light.png; A/t1a/settings-shortcuts.desktop.light.png |
| 19 | Experts & Teams alignment (form indented) | CAN'T TELL | The Create Expert form is not in the AFTER set. The team pane aligns with the header in A/t4/t4-experts.desktop.light.png. |
| 20 | Workflow DAG overflows its card | CAN'T TELL | No Workflows tab shot in AFTER (A/t1b/t1b-view-workbench.desktop.light.png shows the Tasks tab only). |
| 21 | Plugin detail is a dead end | CAN'T TELL | Plugins list is in A/t1a/plugins-panel.desktop.light.png; no detail shot. |
| 22 | Mobile collapsed rail hides navigation | FIXED | Drawer reaches Experts, Plugins, Remote, Workbench in one tap: A/t1b/t1b-mobile-drawer.mobile.light.png. The rail itself is still icon-only with no labels (A/t1a/shell.mobile.light.png). |
| 23 | First run shows an error before user action | FIXED | A/t2/t2-welcome.desktop.light.png shows "No workspace selected" and a neutral card, not "Unable to create default workspace" |
| 24 | Sidebar workspace badges truncate | PARTIAL | t1b build shows just "LOCAL" (A/t1b/t1b-first-run.desktop.light.png). t1a/t2 builds still truncate "LOCAL · UNCONTA…" and "LOC…" (A/t1a/shell.desktop.light.png, A/t1a/toast-undo.desktop.light.png). |
| 25 | Add workspace: home-subtree refusal unexplained | CAN'T TELL | No shot of the protected-home path. |
| 26 | "Customized settings" link is a 15 px target | NOT FIXED | Still a small underlined text link: A/t1a/settings-models.desktop.dark.png (approximately x508–623, y305–318). |

Totals: FIXED 15 (rows 1, 3, 5, 6, 7, 9, 10, 11, 12, 14, 16, 17, 18, 22, 23). PARTIAL 3 (4, 8, 24). NOT FIXED 3 (13, 15, 26). CAN'T TELL 5 (2, 19, 20, 21, 25).

---

## 3. New visual and UX defects in AFTER

Severity: P0 blocks or loses data; P1 visible break or broken state in a core flow; P2 visible polish, consistency or contrast issue.

P0: none found.

### P1 (11)

1. **Native `<select>` in composer permission control (t1a/t2 builds).** `A/t1a/shell.desktop.light.png` around x619–742, y568–585; the same in `A/t1a/shell.desktop.dark.png`, `A/t1a/shell.mobile.light.png` (x111–234, y568–584), `A/t1a/shell.mobile.dark.png`, `A/t1a/toast-undo.desktop.dark.png`. The t1b build shows a styled chip (`A/t1b/t1b-shell.desktop.light.png`), so the builds disagree. Fix: ship the styled dropdown (`Workspace Write ▾`) from the t1b build in all states.

2. **Model picker stuck on "Loading the provider's models…".** `A/t2/11-model-picker.png` (y424–440), `A/t2/t2-model-picker.desktop.light.png`, `A/t2/t2-model-picker.desktop.dark.png`. The mock provider has a model, but the picker still shows the loading line under `mock-model-1`. Fix: on load failure or timeout show an error and retry; on success show the list; never show "Loading" when a model is already selected.

3. **Empty pink band above error cards.** `A/t4/t4-failure-block.png` (full-width strip y223–242, error card below it only 958 px wide while the conversation is 1060 px). Same in `A/u5/harness-auth-error.desktop.light.png` (strip y195–213). Fix: remove the empty wrapper and align the card to the conversation column.

4. **Provider wizard footer and form buttons use browser defaults.** `A/t2/03-provider-validation.png` footer y840–863 ("Test connection", "Configure later", "Save and continue"); `A/u5/providers-azure.desktop.light.png` ("Fetch models" x912–1014 y733–768, "Test connection" x319–439 y805–828, "Cancel" / "Create provider" x827–1015 y805–828). Fix: use the shared Button component (border, radius, token colours, focus ring).

5. **Dark-mode contrast on wizard secondary button.** `FAILED-t2-provider-step.desktop.dark.png` footer, "Configure later" (x756–868, y840–862) is grey text on grey fill, far below 4.5:1. The mobile dark twin shows the same (`FAILED-t2-provider-step.mobile.dark.png`, y788–806). Fix: token for secondary button text and fill in dark; test with the contrast validator.

6. **Session titles collapse to one glyph when badges appear.** `A/u5/harness-approval.desktop.dark.png` sidebar rows at y440 and y510: title shows "V" then "Claude Co" truncated, with the APPROVAL pill and agent icon taking the width. Same rows in `A/u5/e2e-harness-approval.png` ("Waiting…"). Fix: put the status pill on its own line or drop the agent icon; reserve a minimum title width of about 8 characters.

7. **Inspector tab strip clipped at default width.** `A/t3/t3-files-tree.desktop.light.png` top bar x1101–1440: the first tab label is cut to "…text" at the left edge and "Details" is clipped against the "Files" tab; `A/t3/t3-settings-config.desktop.light.png` top-right "(" is clipped after "Details". Fix: icon-only tabs with tooltips, or an overflow menu, below about 360 px.

8. **Config JSON is clipped with no horizontal scroll cue.** `A/t3/t3-settings-config.desktop.light.png` lines 2–40 run off the right edge (x1101–1440), and the path header is cut to "…ness-t5-DsCsFk/cognate.config.json/". `A/t4/t4-config-dirty.png` and `A/t4/t4-config-saved.png` also clip. The user cannot read the values they are editing. Fix: wrap long lines or show a visible horizontal scrollbar; widen the inspector when the Config tab is active.

9. **Header task `<select>` is native.** `A/t1a/shell.desktop.light.png` x501–697, y8–41 ("No task (no contract applies)"), repeated in every `A/autocomplete-*` shot behind the Add workspace dialog. The t1b build uses a styled "No task ▾" chip. Fix: same styled chip as t1b in all builds.

10. **Error copy wording on Experts still contradicts in one state.** `A/t1b/t1b-view-experts.desktop.light.png` y446–478: "Booked cost at operator-configured prices: USD 0.000000. 1 reservation(s) have unknown prices." Fix: show "unknown" in place of the number when any reservation has an unknown price (the t4 state already does this).

11. **Mobile conversation header is cramped and tabs cut.** `A/t1b/t1b-running-turn.mobile.dark.png` header y10–35: title "Summarise t…", tabs row "Experts" touches the right edge; composer "Steer" chip wraps. Fix: collapse view tabs into a menu under about 420 px.

### P2 (19)

12. **Sidebar duplicate untitled sessions.** `A/t1a/shell.desktop.light.png` y409–473 (three "New Session / now" rows). Repeated in `A/t1b/t1b-first-run.desktop.light.png`, `A/t4/t4-view-options.desktop.light.png`, `A/t2/t2-model-picker.desktop.light.png`. Fix: auto-title from the first prompt, and hide or merge empty sessions.

13. **Workspace badges truncate.** `A/t1a/shell.desktop.light.png` y308 ("LOCAL · UNCONTA…") and y373 ("LOC…"); `A/t1a/toast-undo.desktop.light.png` y373 ("LOC…"). The t1b build shows "LOCAL" only. Fix: use "LOCAL" with a tooltip for the detail, everywhere.

14. **Inspector default copy uses jargon.** `A/t1b/t1b-inspector-context.desktop.light.png` (x1110–1440, y110–190): "No case in focus … recorded checks, next move and settlement appear here." Fix: "Nothing selected. Pick a task to see its contract and checks."

15. **Delete-workspace dialog: typographic and copy errors.** `A/t4/t4-delete-confirm.png` title (x525–760, y371) uses a closing quote ” at the start of "alpha-proj"; body (y405) says "and its 0 conversations". Fix: correct opening quote, and pluralise or omit the count when zero.

16. **Add-workspace close glyph is a tiny "×" text character.** `A/autocomplete-1-empty-focus.png` etc. (x728–737, y209) versus the icon X in `A/t1a/add-workspace-dialog.desktop.light.png` (x895–907, y277). Fix: use the same IconButton everywhere.

17. **Two close controls in one viewport.** `A/t1b/t1b-settings-inspector.desktop.light.png`: Settings X at x1071, y24, next to "Open configuration file", and inspector X at x1415, y25. Also in `A/u5/providers-list.desktop.light.png`, `A/u5/agents-settings.desktop.light.png`. Fix: each surface owns one close; the inspector X should not sit in the modal's top bar.

18. **Icon-only inspector tabs with no labels.** `A/t4/t4-config-dirty.png` (x1118–1310, y25) and `A/t4/t4-inspector-tabs.desktop.light.png` (x1118–1305): five icons, only the active tab shows text. Fix: add tooltips, and labels at wide widths.

19. **Environment table in config dialog has an empty Value column.** `A/t1a/config-dialog.desktop.light.png` (x830–862, y590–740): every row blank. Fix: show "unset" or "hidden (secret)" in the Value column.

20. **Governance copy is jargon-heavy and uses code font for env names.** `A/t1a/settings-governance.desktop.light.png` y215–390 (COGNATE_GOVERNANCE=sea-forge, COGNATE_REALITYTRACE_BIN, _DATA_HOME, _STATE_HOME); `A/t4/t4-governance.desktop.light.png` y365–390. Fix: plain-language description, env names in an "Advanced" disclosure.

21. **Approval title ends in a stray colon.** `A/u5/harness-approval.desktop.dark.png` y813: "Allow this operation with workspace-write permissions: ." Fix: omit the path or the colon when no path is present.

22. **Provider card descriptions truncated.** `A/u5/providers-wizard.desktop.light.png`: Z.ai GLM ("Anthropic-compatible…", x436–552, y560–600), Xiaomi MiMo ("plan and…", x505–653, y575–600), Azure OpenAI ("Needs the deployment UR…", x329–478, y740–790). Fix: allow two lines or drop the clamp; move the detail into the card detail.

23. **Model picker search has a double focus ring.** `A/t2/11-model-picker.png` (x600–884, y342–364) and `A/u5/model-picker.desktop.light.png` (x600–904, y78–101): input border inside a wider blue outline. Fix: a single focus ring on the input.

24. **Agent chip menu is clipped at the bottom.** `A/u5/agent-chip-menu.desktop.light.png` (y405–416): "Auto review" row cut through its description with no scroll cue. Fix: scroll container with fade, or flip above the chip.

25. **Mobile settings tab strip clipped at both edges.** `A/t1a/settings-general.mobile.light.png` (tabs: "Plug…" cut at right); `A/t1a/settings-governance.mobile.dark.png` ("Agent presets" cut at left, "Keyboard" cut at right). Fix: fade mask and an overflow affordance, or wrap to two rows as R3 #22 suggested.

26. **Customized settings link target is about 15 px.** `A/t1a/settings-models.desktop.dark.png` (x508–623, y305–318). Fix: 32 px minimum hit area.

27. **Toasts overlap the composer.** `A/t2/08-first-reply.png`: "Model provider saved" (x638–802, y800–836) and "Workspace added" (x650–790, y844–880) sit over the composer's right side. Fix: move toasts to top-right, and cap the stack at two.

28. **Disabled primary buttons are low contrast.** `A/t2/t2-empty-state.desktop.light.png` "Choose workspace" (x495–885, y594–630) is pale blue on pale blue. Fix: use the token for disabled text and fill, and check contrast.

29. **Governance textarea placeholder reads as a value and is low contrast.** `A/t1a/settings-governance.desktop.dark.png` (x519–1155, y531–597): "bun / test" in grey on near-black. Fix: show it as an actual default value, or raise placeholder contrast.

30. **Mobile conversation shows raw test title.** `A/t2/08-first-reply.png` sidebar and header show "[[scenario:plain]]". This is a harness artifact, not a product bug. Fix: none for product; note for the evidence set.

(Count: P1 = 11, P2 = 19 including item 30 which is evidence-only. Real product P2 = 18.)

---

## 4. Top 10 defects

1. Native composer permission `<select>` in t1a/t2 builds (`A/t1a/shell.desktop.light.png` y568–585), inconsistent with the styled chip in `A/t1b/t1b-shell.desktop.light.png`. P1.
2. Model picker stuck on "Loading the provider's models…" (`A/t2/11-model-picker.png` y424–440). P1.
3. Empty pink error band above failure cards (`A/t4/t4-failure-block.png` y223–242; `A/u5/harness-auth-error.desktop.light.png` y195–213). P1.
4. Wizard and provider form buttons are browser-default (`A/t2/03-provider-validation.png` footer; `A/u5/providers-azure.desktop.light.png` Fetch models / Test connection / Create provider). P1.
5. Dark "Configure later" grey-on-grey (`FAILED-t2-provider-step.desktop.dark.png` y840–862). P1.
6. Session title collapses to "V" with approval pill and agent icon (`A/u5/harness-approval.desktop.dark.png` sidebar y440). P1.
7. Inspector tab strip clipped at default width (`A/t3/t3-files-tree.desktop.light.png` x1101–1440). P1.
8. Config JSON clipped with no horizontal scroll (`A/t3/t3-settings-config.desktop.light.png` lines 2–40). P1.
9. Header task `<select>` native "No task (no contract applies)" (`A/t1a/shell.desktop.light.png` x501–697, y8–41; same in all `A/autocomplete-*`). P1.
10. Experts cost line still shows "USD 0.000000" next to "unknown prices" (`A/t1b/t1b-view-experts.desktop.light.png` y446–478). P1.

---

## 5. Notes for the operator

- The biggest gap versus PandaCode is not visual. It is the missing surfaces: changed-files card and diff dialog (only empty states are in AFTER), skills/cloud/GitHub settings, model picker detail, and a populated Files tree. Those can't be judged for parity from the evidence set.
- Several P1s are regressions between builds (native composer select present in t1a/t2 but styled in t1b). Confirm which build the release uses before fixing.
- Items marked CAN'T TELL (R3 #2, #19, #20, #21, #25) need one screenshot each to close.
