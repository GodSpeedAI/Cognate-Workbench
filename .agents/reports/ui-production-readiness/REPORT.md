# UI production readiness: proof report

Branch `feat/ui-production-readiness`, cut from `51e579b`. Date: 2026-11-01.

Every claim below points to something you can open or re-run: a screenshot, a test file, a command's output, or a log. Paths are relative to this folder unless they start with `test/`, `src/` or `scripts/`.

The app is **not production hardened**: the single-operator development authenticator is still a known limitation (see AGENTS.md).

## 1. Verdict

| Check | Result | Evidence |
|---|---|---|
| Full gate (`just verify`: typecheck, then all tests) | 1564 tests in 185 files: 1551 pass, 13 skip, 0 fail, at commit `04f648d` | `evidence/verify-final.txt` |
| Interaction model (`domainforge validate`) | 0 violations, already formatted (DomainForge 0.21.2, commit `04f648d`) | `evidence/domainforge-validate.txt`; `.sea/interaction/validation/conformance-2026-10-31.md` |
| Contrast audit (`UI_SHOTS_CONTRAST=1`) | no enabled control below 4.5:1 on any captured screen, light and dark | `evidence/final/INDEX.md` header; `scripts/ui-shots.ts` |
| Final screenshots | 135 PNGs (all re-captured at commit 1c559b6; later commits change no visible UI except a hover tooltip), desktop 1440x900 and mobile 390x844, light and dark | `evidence/final/` |
| Independent screenshot audits | A1 (mid-way), A2 (final, Haiku, screenshots only) | `recon/A1-parity-audit.md`, `recon/A2-final-audit.md` |
| Real agent CLIs | Claude Code and Codex answered; OpenCode refused cleanly (not signed in) | `evidence/harness/real-smoke-*.json` |
| Packaged Linux build launches as an app window | yes, then shuts down when the window closes | `evidence/package/` |
| Windows desktop exe has no console | Subsystem 2 (GUI) | `evidence/package/pe-subsystem.txt` |

It took six full runs to get a clean one. Each of the first five failed exactly one or two tests, each a different one; every failure is accounted for below and in section 4:

| Run | Failure | Cause | Fix |
|---|---|---|---|
| 1 | `E2E-checkout` | regression: stale projection row after removing a checkout | `1c559b6` (product fix) |
| 2 | `ui-contained-workspace` | test pinned the old jargon message | `9726eda` (host reason moved to the hover tooltip) |
| 3 | `J-CFG-provider-switch` | a POST with no model reached the test server once; not reproduced in 9 runs | `667252f` (test counts model calls only); recorded in `.agents/DEBT.md` |
| 4 | `J-CFG-provider-test`, `E2E-remote-workspaces` | saving a provider returned before it could be read; `wsl.exe` slower than 15 s under load | `8686b7a` (product fix; WSL wait 30 s) |
| 5 | `E2E-cognitive-console` | test read the agent context before the click re-rendered | `04f648d` (test polls) |
| 6 | none | | |

A2 called the build "not at parity, not production-ready" and listed six blocking defects. All six were fixed in the F2 pass (section 4), and each fix has a re-captured screenshot.

## 2. Your original complaints

| # | Complaint | Before | After | Executable proof |
|---|---|---|---|---|
| a | "Open configuration file" opened a popup; should open in the side viewer and be editable | `evidence/before/10-B-settings-open-config-click.png` | `evidence/final/t3-settings-config.desktop.light.png` and `.dark.png` (file open in the inspector beside Settings, editable) | `test/J-CFG-config-edit.test.ts` (edit, apply atomically, reject invalid JSON); `test/E2E-ui-production.test.ts` (in a real browser: edits the appearance setting in the Config tab, saves, and the UI theme changes) |
| b | Settings close X was on the left | `evidence/before/05-B-settings-open.png` | `evidence/final/settings-general.desktop.light.png` (X at top right); the same position in `remote-dialog`, `rename-workspace-dialog`, `add-workspace-dialog` | `test/E2E-ui-shell.test.ts` (asserts "Close settings" is the right-most header control) |
| c | After the banner, first run asked only for an API key | `evidence/before/02-A02-after-continue.png`, `04-A04-after-save-apikey.png` | `evidence/final/t2-welcome.*` → `t2-provider-step.*` (full provider form: presets, name, base URL, protocol, key, model, Test connection) → `t2-folder-step.*` → `t2-empty-state.*` | `test/E2E-onboarding.test.ts` (J-A-first-use, 4 tests including Back and Configure later) |
| d | Add-workspace autocomplete found folders only with the exact path | `evidence/before/13-…-type-proj.png` to `23-…-work-partial2.png` | `evidence/final/dir-suggest-empty`, `-fragment` (`pro`), `-tilde` (`~/`), `-fuzzy`, `-drilldown` (`.desktop.light.png`) | `test/J-WS-directory-suggest-matching.test.ts`, `test/J-WS-directory-discovery.red.test.ts`, `test/ui-directory-field.test.tsx` |
| e | Windows binary opened a Bun terminal, not the UI | n/a | `evidence/package/packaged-launch-first-run.png` (the packaged Linux binary, launched as `cognate-workbench launch`, opened an app window on the first-run wizard) | `evidence/package/window-argv.json` (browser got `--app=…` and its own profile); `evidence/package/launch.txt` ("app window closed: closing the application", database stopped); `evidence/package/pe-subsystem.txt` (desktop exe Subsystem=2 GUI, CLI exe Subsystem=3); `test/J-DESKTOP-launch.test.ts` |

Later requests:

| Request | Proof |
|---|---|
| Support PandaCode's model providers with the same UX | 21 presets in `src/ui/models/providerCatalog.ts`, grouped Popular / Open-model hosts / On this computer / Enterprise / Custom (`evidence/final/providers-wizard.*`, `providers-azure.*`, `providers-list.*`, `providers-card-test.*`, `model-picker.*`). Tests: `test/E2E-providers.test.ts`, `test/J-CFG-provider-switch.test.ts`, `test/J-CFG-provider-test.test.ts`, `test/J-CFG-provider-delete.test.ts`. |
| API keys in the OS secret store | `src/secrets.ts` uses `Bun.secrets` (Windows Credential Manager, Secret Service, Keychain) with a probe and a file fallback; capability `secrets.backend.describe`. Tests: `test/J-SECRETS-storage.test.ts`, `test/secrets-store.test.ts`. |
| Use and detect any installed agent CLI | 12 CLIs in `src/agents/harness/catalog.ts` (Claude Code, Codex, OpenCode, Kimi, GitHub Copilot, Grok, Cline, Kilo, Devin, Command Code, Gemini, Qwen). Screens: `evidence/final/agents-settings.*`, `agent-chip-menu.*`, `harness-approval.*`, `harness-auth-error.*`. Tests: `test/J-HARNESS-{detect,session,approval,cancel,unavailable,remote}.test.ts`, `test/E2E-harness.test.ts`. Real CLIs: `evidence/harness/real-smoke-claude.json` (reply "READY", 5.1 s), `real-smoke-codex.json` ("READY", 9.1 s), `real-smoke-opencode.json` (failed with AUTH_REQUIRED and a sign-in instruction). |
| Build changes as Cognate capabilities | New capabilities: `config.file.read`/`apply`, `workspace.files.list`, `workspace.file.read`, `secrets.backend.describe`, `provider.list`/`activate`/`test`, `agent.harness.list`, `session.harness.bind`/`resolve`, `session.rename`. Each has a journey in `.sea/interaction/interaction-model.sea` and a test named after it; `domainforge validate` reports 0 violations. |

## 3. Parity with PandaCode

Donor shots: `evidence/donor/` (58). Row-by-row comparison with file names: `recon/A2-final-audit.md` section 1. Summary, updated for the F2 fixes:

| Area | Status | Cognate evidence (`evidence/final/`) |
|---|---|---|
| Shell: sidebar, main, resizable inspector | parity | `t1b-shell`, `t1b-inspector-wide` |
| Header: breadcrumb, view switch, task menu | parity | `t1b-task-menu`, `t1b-view-experts` |
| Sidebar status, timestamps, filter/sort popover | parity | `shell`, `t4-view-options` |
| Session row menu | partial: Rename, Copy workspace path, Archive (no Pin) | `t1b-session-row-menu` |
| Inspector tabs: changes, files, config | parity | `t4-inspector-tabs`, `t3-files-split`, `t4-config-tab` |
| Changed files card and diff view | parity | `f1-turn-changes`, `f1-diff-view` |
| Settings page layout | parity (close X on the right on purpose) | `settings-*` |
| Providers and model picker | parity on providers; partial on picker (no context size or reasoning control) | `providers-*`, `model-picker` |
| External agent CLIs | parity | `agents-settings`, `agent-chip-menu` |
| Approvals | better (donor shows none in preview) | `harness-approval` |
| Command palette and shortcuts | parity / better (editable shortcut table) | `palette-open`, `palette-filtered`, `settings-shortcuts` |
| First run | better (donor has none) | `t2-*` |
| Folder picking | better (donor has a plain text field) | `dir-suggest-*` |
| Remote access diagnostics | partial: connection, route, last error, recent events, Copy report; no server-side event log | `remote-dialog` |
| Mobile 390 px | partial: drawer and sheets work; workspace and session names still truncate in the header | `t1b-mobile-drawer`, `shell.mobile.*` |
| Skills/rules, cloud sandboxes, GitHub settings | not built: no matching Cognate capabilities | — |

## 4. Defects found by the independent audits and what happened

Defects found by A2 (`recon/A2-final-audit.md`) and fixed in the F2 pass:

| Id | Defect | Fix proof |
|---|---|---|
| D-1 | Native select for API protocol in first-run form | `t2-provider-step.desktop.light.png` (styled menu) |
| D-3 | First-run provider modal opened with its title scrolled away | `t2-provider-step.*` (stepper, title and Back stay pinned) |
| D-4 | Autocomplete not shown in final evidence | `dir-suggest-*` (five states) |
| D-5 | "Checking for more models…" stuck under the active model | `test/ui-model-picker.test.tsx` (note clears once the lookup settles; 8 s timeout); `model-picker.*` |
| D-31 | Remote dialog had no diagnostics | `remote-dialog.desktop.light.png`; `test/ui-remote-diagnostics.test.tsx` |
| D-8, D-33 | Fixture titles in shots; mislabelled index row | `shell.desktop.light.png`; `final/INDEX.md` |
| D-6 | Two close X controls in one view | `t1b-settings-inspector.desktop.light.png` |
| D-7 | Repeated untitled "New Session" rows | sessions take their first prompt as title; New Session reuses an empty draft |
| D-11 | Settings tabs cut mid-word on mobile | `settings-general.mobile.light.png` (edge fade) |
| D-14 | File tree hidden while a file is open | `t3-files-split.desktop.light.png` |
| D-23 | Session menu offered only Archive | `t1b-session-row-menu.desktop.light.png`; `test/J-SESSION-rename.test.ts` |
| D-20 | Internal text "host containment configuration is unavailable" in Add workspace | `dir-suggest-fragment.desktop.light.png` ("Contained mode isn't set up on this computer. Choose Local to open the folder.") |

Found by the full gate rather than the audits: removing a task checkout showed "task … has no checkout binding" instead of "Checkout removed". A projection read that started before the removal could return the old row while the remove call was still running. It came in with commit `fb14932` (found by checking out earlier commits; `1f0d61e` passes). Fixed in `1c559b6`; `test/E2E-checkout.test.ts` passed 3 of 3 runs after the fix.

Also found by the full gate: right after saving a provider, `provider.test` or `provider.activate` could answer "not a stored provider", because saving returned before the `provider-routes` projection had folded the save. A request log of the test servers showed the follow-up request carried no API key, so no stored key went to another URL. Saving now returns only once the projection shows the change (`8686b7a`); when measured across three provider test files, the wait took 1–26 ms.

Still open (P2/P3, listed in `.agents/DEBT.md`): D-9 (mobile header truncates names), D-12, D-13, D-15 to D-19, D-21, D-22, D-24 to D-30, D-34 (see A2 for each), and about 35 native selects inside the Workbench, Experts and Automation panels.

## 5. Decisions you did not specify

1. **No Tauri, no new dependency.** `cognate-workbench launch` opens Edge or Chrome in `--app` mode with its own profile, single instance, and quits when the window closes. Falls back to the default browser. Windows gets a separate GUI-subsystem `cognate-workbench-desktop.exe` that the Start Menu and Desktop shortcuts use.
2. **Settings close X on the right**, matching the rest of the app, instead of PandaCode's Back at top left.
3. **The configuration file is an editable view** of the stored settings, applied atomically and mirrored to `cognate.config.json` (mode 0600). It opens in the inspector, which stays visible beside Settings.
4. **Cognate's cobalt identity kept**; PandaCode's layout and flows were re-implemented, no code copied (PandaCode's MIT licence carries a fork-attribution condition and Workbench is not a fork).
5. **New-session shortcut is Ctrl+Alt+N** (Ctrl+N is taken by browsers).
6. **Unverified provider presets are flagged** (`verified:false`: Gemini, xAI, DeepSeek, Cerebras, Moonshot, Qwen, Perplexity, Z.ai GLM; MiMo is guidance only).
7. **Agent-CLI sessions run only on this computer, by explicit opt-in**, and outside Cognate's containment. Containment, per-tool authority and settlement guarantees do not apply to them; approvals are bridged where the CLI supports it.
8. **Secrets fall back to an owner-only file** when no OS store answers (this WSL host has no Secret Service).
9. **Deleting a workspace archives its sessions**; files on disk are untouched.
10. **Diff view defaults to unified; toasts sit top-right.**
11. **Remote diagnostics are collected by the dialog**, using the existing `/remote/status` endpoint, rather than a new server event log.
12. **Session titles come from the first prompt**, trimmed to 60 characters; the session menu has no Pin.
13. **Skills, cloud and GitHub settings left out**: no matching capabilities exist.

## 6. Known limits

- Not run on real Windows or macOS: hidden console, Edge app mode, shortcuts and Keychain are proven only by build output and unit tests. The Windows installer (`makensis`) could not be built on this Linux host; the two exes were.
- The macOS `.app` has no icon.
- No OAuth or subscription sign-in for providers.
- One live provider route at a time; editing a non-active provider makes it active.
- Per-Expert routes cannot carry Azure auth.
- Of the 12 agent CLIs, only Claude Code, Codex and OpenCode were run for real; the other nine are matched against their documented protocols.
- Gemini and Qwen presets unverified against live endpoints.
- Real Secret Service round-trip not run (no Secret Service on this host).
- WSL hangs on connections to closed loopback ports, so tests use a listener that drops connections.
- The SDK has no streaming `process.spawn`; agent CLIs run through a host-process runner (`framework-gap-streaming-process.md`).
- Screenshots prove appearance; behaviour is proven by the tests named above.

## 7. Where things are

- `recon/`: R1–R6 donor and Cognate recon, A1 and A2 audits.
- `evidence/before/`, `evidence/final/` (with `INDEX.md`), `evidence/harness/`, `evidence/package/`: committed.
- `evidence/donor/` (58 PandaCode shots, 20 MB) and `evidence/after/` (per-tranche shots superseded by `final/`, 11 MB): kept on disk, not committed, to keep the repository small.
- Re-run the shots: `bun scripts/ui-shots.ts` (see the script header for flags).
