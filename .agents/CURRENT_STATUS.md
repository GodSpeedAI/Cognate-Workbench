# Current status

Revision 37, 2026-11-01. Branch `feat/ui-production-readiness` (cut from `51e579b` on `feat/standalone-packages`; PR #22 still pending there). Nothing on this branch is pushed.

Plan: `.agents/plans/20261031_ui-production-readiness.plan.yaml`.
Proof report: `.agents/reports/ui-production-readiness/REPORT.md`.

## What changed

- Desktop: `cognate-workbench launch` opens an Edge/Chrome app window (own profile, single instance, quits with the window). Windows ships a GUI-subsystem `cognate-workbench-desktop.exe` for the shortcuts.
- UI adopts PandaCode's layout and flows with Cognate's identity: full-page Settings (close X on the right), command palette and global shortcuts, toasts, main header with view switch, resizable inspector (Context, Changes, Files, Config, Details), mobile drawer and sheets.
- First run: Welcome, then the full provider form, then folder choice.
- Providers: 21 presets with test, switch, delete; keys in the OS secret store (file fallback).
- External agent CLIs: 12 detected (Claude Code, Codex, ACP agents), bound per session, approvals bridged.
- Folder autocomplete handles fragments, `~`, fuzzy matches and drill-down.
- The config file opens editable in the inspector.
- New capabilities each have a journey and a test: `config.file.*`, `workspace.files.list`, `workspace.file.read`, `secrets.backend.describe`, `provider.*`, `agent.harness.list`, `session.harness.*`, `session.rename`.

## Verified

- `just verify` at `04f648d`: 1564 tests, 1551 pass, 13 skip, 0 fail.
- DomainForge validate: 0 violations.
- 135 final screenshots with a contrast audit; two independent screenshot audits (A1, A2), A2's blocking defects fixed.
- Real CLI turns: Claude Code and Codex answered; OpenCode refused cleanly when not signed in.
- Packaged Linux build launched as an app window; Windows desktop exe is Subsystem 2 (GUI).

## Limits

- Not production hardened: single-operator development authenticator.
- Not run on real Windows or macOS; Windows installer not built here (no `makensis`).
- Open UI polish and platform debts are listed in `.agents/DEBT.md` (2026-11-01 entries).

## Next

1. Run the packaged build on Windows and macOS hosts.
2. Work through the remaining A2 P2/P3 rows.
3. Merge PR #22, then open a PR for this branch.
