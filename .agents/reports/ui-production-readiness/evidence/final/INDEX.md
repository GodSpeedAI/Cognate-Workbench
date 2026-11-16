# Final screenshots (HEAD, branch feat/ui-production-readiness)

135 screenshots, all re-captured from commit 1c559b6 on 2026-11-01. First-run states (`t2-welcome`, `t2-provider-step`, `t2-folder-step`, `t2-empty-state`) were captured on fresh homes; `t2-folder-step` and `t2-empty-state` each on their own. Naming: `<state>.<viewport>.<theme>.png` (desktop 1440x900, mobile 390x844). Captured by `bun scripts/ui-shots.ts` (`UI_SHOTS_CONTRAST=1` contrast audit: every enabled control at or above 4.5:1 on every captured screen, both themes). Real scrollbars are shown (the harness no longer passes `--hide-scrollbars`). First-run states were captured on fresh homes (`--fresh`).

| File | Tranche | What it shows |
|---|---|---|
| `add-workspace-dialog.desktop.light.png` | t1a | Add workspace dialog header (desktop, light) |
| `agent-chip-menu.desktop.dark.png` | u5 | Composer Agent chip menu open (Claude Code listed with its status) (desktop, dark) |
| `agent-chip-menu.desktop.light.png` | u5 | Composer Agent chip menu open (Claude Code listed with its status) (desktop, light) |
| `agent-chip-menu.mobile.dark.png` | u5 | Composer Agent chip menu open (Claude Code listed with its status) (mobile, dark) |
| `agent-chip-menu.mobile.light.png` | u5 | Composer Agent chip menu open (Claude Code listed with its status) (mobile, light) |
| `agents-settings.desktop.dark.png` | u5 | Settings > Agents (desktop, dark) |
| `agents-settings.desktop.light.png` | u5 | Settings > Agents (desktop, light) |
| `agents-settings.mobile.dark.png` | u5 | Settings > Agents (mobile, dark) |
| `agents-settings.mobile.light.png` | u5 | Settings > Agents (mobile, light) |
| `f1-add-workspace-protected.desktop.light.png` | f1 | Add workspace with a path inside the app's protected home: plain refusal, no raw error (desktop, light) |
| `f1-diff-view.desktop.dark.png` | f1 | Inspector Changes tab populated: the diff opened from the card's Open diff (desktop, dark) |
| `f1-diff-view.desktop.light.png` | f1 | Inspector Changes tab populated: the diff opened from the card's Open diff (desktop, light) |
| `f1-experts-form.desktop.light.png` | f1 | Experts and Teams: New Expert form alignment (desktop, light) |
| `f1-experts-spending.desktop.light.png` | f1 | Experts and Teams: spending status (desktop, light) |
| `f1-plugin-detail.desktop.light.png` | f1 | Plugins page: a plugin opened for detail (desktop, light) |
| `f1-turn-changes.desktop.dark.png` | f1 | After an edit turn: the 'Files changed during this turn' card in the conversation (desktop, dark) |
| `f1-turn-changes.desktop.light.png` | f1 | After an edit turn: the 'Files changed during this turn' card in the conversation (desktop, light) |
| `f1-turn-changes.mobile.dark.png` | f1 | After an edit turn: the 'Files changed during this turn' card in the conversation (mobile, dark) |
| `f1-turn-changes.mobile.light.png` | f1 | After an edit turn: the 'Files changed during this turn' card in the conversation (mobile, light) |
| `f1-workbench-workflows.desktop.light.png` | f1 | Workbench Workflows tab (DAG inside its card) (desktop, light) |
| `harness-approval.desktop.dark.png` | u5 | Harness session mid-approval (desktop, dark) |
| `harness-approval.desktop.light.png` | u5 | Harness session mid-approval (desktop, light) |
| `harness-approval.mobile.dark.png` | u5 | Harness session mid-approval (mobile, dark) |
| `harness-approval.mobile.light.png` | u5 | Harness session mid-approval (mobile, light) |
| `harness-auth-error.desktop.dark.png` | u5 | Harness turn failed: sign-in hint (desktop, dark) |
| `harness-auth-error.desktop.light.png` | u5 | Harness turn failed: sign-in hint (desktop, light) |
| `harness-auth-error.mobile.dark.png` | u5 | Harness turn failed: sign-in hint (mobile, dark) |
| `harness-auth-error.mobile.light.png` | u5 | Harness turn failed: sign-in hint (mobile, light) |
| `model-picker.desktop.dark.png` | u5 | Composer model picker with three providers (desktop, dark) |
| `model-picker.desktop.light.png` | u5 | Composer model picker with three providers (desktop, light) |
| `model-picker.mobile.dark.png` | u5 | Composer model picker with three providers (mobile, dark) |
| `model-picker.mobile.light.png` | u5 | Composer model picker with three providers (mobile, light) |
| `palette-filtered.desktop.dark.png` | t1a | Command palette filtered by 'sett' (desktop, dark) |
| `palette-filtered.desktop.light.png` | t1a | Command palette filtered by 'sett' (desktop, light) |
| `palette-open.desktop.dark.png` | t1a | Command palette, empty query (desktop, dark) |
| `palette-open.desktop.light.png` | t1a | Command palette, empty query (desktop, light) |
| `plugins-panel.desktop.light.png` | t1a | Plugins page header (close X right) (desktop, light) |
| `providers-azure.desktop.light.png` | u5 | Add provider: Azure fields (desktop, light) |
| `providers-card-test.desktop.light.png` | u5 | Providers: active card expanded with a passing test (desktop, light) |
| `providers-list.desktop.dark.png` | u5 | Settings > Providers list (desktop, dark) |
| `providers-list.desktop.light.png` | u5 | Settings > Providers list (desktop, light) |
| `providers-list.mobile.dark.png` | u5 | Settings > Providers list (mobile, dark) |
| `providers-list.mobile.light.png` | u5 | Settings > Providers list (mobile, light) |
| `providers-wizard.desktop.light.png` | u5 | Add provider: grouped presets (desktop, light) |
| `providers-wizard.mobile.light.png` | u5 | Add provider: grouped presets (mobile, light) |
| `remote-dialog.desktop.light.png` | t1a | Control from your phone dialog (X on the right) (desktop, light) |
| `rename-workspace-dialog.desktop.light.png` | t1a | Rename workspace dialog (desktop, light) |
| `settings-about.desktop.light.png` | t1a | Settings > About (desktop, light) |
| `settings-appearance.desktop.dark.png` | t1a | Settings > Appearance (desktop, dark) |
| `settings-appearance.desktop.light.png` | t1a | Settings > Appearance (desktop, light) |
| `settings-general.desktop.dark.png` | t1a | Settings > General (desktop, dark) |
| `settings-general.desktop.light.png` | t1a | Settings > General (desktop, light) |
| `settings-general.mobile.dark.png` | t1a | Settings > General (mobile, dark) |
| `settings-general.mobile.light.png` | t1a | Settings > General (mobile, light) |
| `settings-governance.desktop.dark.png` | t1a | Settings > Governance & evidence (desktop, dark) |
| `settings-governance.desktop.light.png` | t1a | Settings > Governance & evidence (desktop, light) |
| `settings-governance.mobile.dark.png` | t1a | Settings > Governance & evidence (mobile, dark) |
| `settings-governance.mobile.light.png` | t1a | Settings > Governance & evidence (mobile, light) |
| `settings-models-wizard.desktop.light.png` | t1a | Settings > Models > Add model provider (custom) (desktop, light) |
| `settings-models-wizard.mobile.light.png` | t1a | Settings > Models > Add model provider (custom) (mobile, light) |
| `settings-models.desktop.dark.png` | t1a | Settings > Models (desktop, dark) |
| `settings-models.desktop.light.png` | t1a | Settings > Models (desktop, light) |
| `settings-plugins.desktop.dark.png` | t1a | Settings > Plugins (desktop, dark) |
| `settings-plugins.desktop.light.png` | t1a | Settings > Plugins (desktop, light) |
| `settings-presets.desktop.dark.png` | t1a | Settings > Agent presets (desktop, dark) |
| `settings-presets.desktop.light.png` | t1a | Settings > Agent presets (desktop, light) |
| `settings-shortcuts.desktop.dark.png` | t1a | Settings > Keyboard shortcuts (reached via Ctrl+/) (desktop, dark) |
| `settings-shortcuts.desktop.light.png` | t1a | Settings > Keyboard shortcuts (reached via Ctrl+/) (desktop, light) |
| `shell.desktop.dark.png` | t1a | Main shell, workspace with sessions (desktop, dark) |
| `shell.desktop.light.png` | t1a | Main shell, workspace with sessions (desktop, light) |
| `shell.mobile.dark.png` | t1a | Main shell, workspace with sessions (mobile, dark) |
| `shell.mobile.light.png` | t1a | Main shell, workspace with sessions (mobile, light) |
| `t1b-first-run.desktop.light.png` | t1b | Main shell with a workspace configured and its sessions listed, composer ready (not an empty-workspace state) (desktop, light) |
| `t1b-inspector-changes.desktop.dark.png` | t1b | Inspector open on Changes (empty state) (desktop, dark) |
| `t1b-inspector-changes.desktop.light.png` | t1b | Inspector open on Changes (empty state) (desktop, light) |
| `t1b-inspector-context.desktop.light.png` | t1b | Inspector open on Context (desktop, light) |
| `t1b-inspector-details.desktop.light.png` | t1b | Inspector open on Details (empty state) (desktop, light) |
| `t1b-inspector-wide.desktop.light.png` | t1b | Inspector resized wide with the keyboard (desktop, light) |
| `t1b-mobile-drawer.mobile.dark.png` | t1b | Mobile: sidebar drawer open with scrim (mobile, dark) |
| `t1b-mobile-drawer.mobile.light.png` | t1b | Mobile: sidebar drawer open with scrim (mobile, light) |
| `t1b-mobile-inspector.mobile.light.png` | t1b | Mobile: inspector as a full-screen sheet (mobile, light) |
| `t1b-running-turn.desktop.dark.png` | t1b | Session with a running turn: context bar shows RUNNING (desktop, dark) |
| `t1b-running-turn.desktop.light.png` | t1b | Session with a running turn: context bar shows RUNNING (desktop, light) |
| `t1b-running-turn.mobile.dark.png` | t1b | Session with a running turn: context bar shows RUNNING (mobile, dark) |
| `t1b-running-turn.mobile.light.png` | t1b | Session with a running turn: context bar shows RUNNING (mobile, light) |
| `t1b-session-row-menu.desktop.dark.png` | t1b | Sidebar session row hover with the actions menu (desktop, dark) |
| `t1b-session-row-menu.desktop.light.png` | t1b | Sidebar session row hover with the actions menu (desktop, light) |
| `t1b-settings-inspector.desktop.light.png` | t1b | Settings page with the inspector open beside it (desktop, light) |
| `t1b-shell.desktop.dark.png` | t1b | Shell: header view switch, sidebar, hero with context bar, inspector (Context) (desktop, dark) |
| `t1b-shell.desktop.light.png` | t1b | Shell: header view switch, sidebar, hero with context bar, inspector (Context) (desktop, light) |
| `t1b-shell.mobile.dark.png` | t1b | Shell: header view switch, sidebar, hero with context bar, inspector (Context) (mobile, dark) |
| `t1b-shell.mobile.light.png` | t1b | Shell: header view switch, sidebar, hero with context bar, inspector (Context) (mobile, light) |
| `t1b-task-menu.desktop.light.png` | t1b | Context bar: task chip menu (desktop, light) |
| `t1b-view-experts.desktop.light.png` | t1b | Header view switch on Experts & Teams (desktop, light) |
| `t1b-view-workbench.desktop.light.png` | t1b | Header view switch on Workbench (desktop, light) |
| `t2-empty-state.desktop.light.png` | t2 | Configure later: friendly empty state (--fresh) (desktop, light) |
| `t2-empty-state.mobile.light.png` | t2 | Configure later: friendly empty state (--fresh) (mobile, light) |
| `t2-folder-step.desktop.light.png` | t2 | First run: Choose a folder (--fresh) (desktop, light) |
| `t2-model-picker.desktop.dark.png` | t2 | Composer model picker open (desktop, dark) |
| `t2-model-picker.desktop.light.png` | t2 | Composer model picker open (desktop, light) |
| `t2-provider-step.desktop.dark.png` | t2 | First run: Connect a model provider (--fresh) (desktop, dark) |
| `t2-provider-step.desktop.light.png` | t2 | First run: Connect a model provider (--fresh) (desktop, light) |
| `t2-provider-step.mobile.dark.png` | t2 | First run: Connect a model provider (--fresh) (mobile, dark) |
| `t2-provider-step.mobile.light.png` | t2 | First run: Connect a model provider (--fresh) (mobile, light) |
| `t2-welcome.desktop.dark.png` | t2 | First run: Welcome step (--fresh) (desktop, dark) |
| `t2-welcome.desktop.light.png` | t2 | First run: Welcome step (--fresh) (desktop, light) |
| `t2-welcome.mobile.dark.png` | t2 | First run: Welcome step (--fresh) (mobile, dark) |
| `t2-welcome.mobile.light.png` | t2 | First run: Welcome step (--fresh) (mobile, light) |
| `t3-files-tree.desktop.dark.png` | t3 | Files tab with `src` expanded and `index.ts` open; the inspector is narrow, so the file shows alone and the tree is reached via the workspace tab (desktop, dark) |
| `t3-files-tree.desktop.light.png` | t3 | Files tab with `src` expanded and `index.ts` open; the inspector is narrow, so the file shows alone and the tree is reached via the workspace tab (desktop, light) |
| `t3-files-tree.mobile.dark.png` | t3 | Files tab with `src` expanded and `index.ts` open; the inspector is narrow, so the file shows alone and the tree is reached via the workspace tab (mobile, dark) |
| `t3-files-tree.mobile.light.png` | t3 | Files tab with `src` expanded and `index.ts` open; the inspector is narrow, so the file shows alone and the tree is reached via the workspace tab (mobile, light) |
| `t3-settings-config.desktop.dark.png` | t3 | Settings > Open configuration file opens the editable Config tab beside the page (desktop, dark) |
| `t3-settings-config.desktop.light.png` | t3 | Settings > Open configuration file opens the editable Config tab beside the page (desktop, light) |
| `t4-config-tab.desktop.dark.png` | t4 | Config tab: header path, status chip, framed editor, sticky footer (desktop, dark) |
| `t4-config-tab.desktop.light.png` | t4 | Config tab: header path, status chip, framed editor, sticky footer (desktop, light) |
| `t4-config-tab.mobile.dark.png` | t4 | Config tab: header path, status chip, framed editor, sticky footer (mobile, dark) |
| `t4-config-tab.mobile.light.png` | t4 | Config tab: header path, status chip, framed editor, sticky footer (mobile, light) |
| `t4-delete-workspace.desktop.dark.png` | t4 | Delete workspace confirmation (desktop, dark) |
| `t4-delete-workspace.desktop.light.png` | t4 | Delete workspace confirmation (desktop, light) |
| `t4-experts.desktop.dark.png` | t4 | Experts and Teams (desktop, dark) |
| `t4-experts.desktop.light.png` | t4 | Experts and Teams (desktop, light) |
| `t4-governance.desktop.light.png` | t4 | Settings > Governance with plain-language copy (desktop, light) |
| `t4-inspector-tabs.desktop.dark.png` | t4 | Inspector with all five tabs at 340px (icon-only except the selected) (desktop, dark) |
| `t4-inspector-tabs.desktop.light.png` | t4 | Inspector with all five tabs at 340px (icon-only except the selected) (desktop, light) |
| `t4-view-options.desktop.dark.png` | t4 | Sidebar view options popover (desktop, dark) |
| `t4-view-options.desktop.light.png` | t4 | Sidebar view options popover (desktop, light) |
| `toast-undo.desktop.dark.png` | t1a | Session archived toast with Undo (desktop, dark) |
| `toast-undo.desktop.light.png` | t1a | Session archived toast with Undo (desktop, light) |
| `dir-suggest-empty.desktop.light.png` | d4 | Add workspace: empty field focused, home folders offered (desktop, light) |
| `dir-suggest-fragment.desktop.light.png` | d4 | Add workspace: fragment 'pro' suggests projects (desktop, light) |
| `dir-suggest-tilde.desktop.light.png` | d4 | Add workspace: '~/' lists the home folders (desktop, light) |
| `dir-suggest-fuzzy.desktop.light.png` | d4 | Add workspace: '~/projects/cgw' fuzzy-matches cognate-workbench (desktop, light) |
| `dir-suggest-drilldown.desktop.light.png` | d4 | Add workspace: Tab completes 'wo' to work/ and lists alpha and beta (desktop, light) |
| `t3-files-split.desktop.light.png` | t3 | Files tab, inspector widened: tree stays beside the open file (desktop, light) |
