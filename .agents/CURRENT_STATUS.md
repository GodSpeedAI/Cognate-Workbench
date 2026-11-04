# Current status

Revision 38, 2026-11-03. Branch `feat/ui-production-readiness`. Latest work: desktop-terminal-browser tranches T4–T9 (commits `be49122`…`ec7fc4d`). Nothing on this branch is pushed.

Plan: `.agents/plans/desktop-terminal-browser/plan.md`. Verification log: `.agents/plans/desktop-terminal-browser/verification.md`.

## What changed

- Terminal (T4/T5): PTY terminal service — local Bun.Terminal, WSL via wsl.exe, SSH via ssh2 with host-key fingerprint re-verification and the world's stored credentials; process-group termination (group SIGTERM, grace, group SIGKILL); governed `terminal.open`/`terminal.close` capabilities (operator-only, workspace-scoped cwd); `/terminal/stream` websocket with first-message token auth; durable record is `workbench.terminal.*` metadata — stream bytes are never persisted.
- Terminal UI (T6/T7): docked xterm panel under the conversation — tabbed sessions per workspace world, detach keeps the process, reattach replays bounded scrollback, maximize and persisted dock height, header toggle.
- Browser (T8/T9): managed shared browser sessions on the agent-browser provider (isolated Chromium per session). Streamed JPEG viewport over `/browser/stream` (one Bun websocket shared with the terminal via a surface tag), base64 frames decoded to bytes, url/console relayed live. Control is named, never ambient: `browser.control` records the one controller; human input is refused while the agent holds control and vice versa; reads (snapshot/screenshot) stay available either way. Durable record is `workbench.browser.*` metadata.
- Browser UI: canvas panel with address bar through `browser.navigate`, control badge, page-error feed; click/keyboard coordinates map through the object-fit: contain letterbox rect; header globe toggle beside the terminal toggle.
- Interaction model: `browser.control` and the handoff variant added model-first; bindings updated; validate 0 violations.

## Verified

- `bun run typecheck`: 0 errors.
- Journeys/E2E: J-TERMINAL (3), J-BROWSER (2), E2E-terminal, E2E-browser — 7 pass / 0 fail, including real-Chromium passes in both surfaces.
- `bun run test:smoke` 73 pass / 0 fail; `workbench-contract` 16 pass / 0 fail.
- `bun run verify` at `ec7fc4d`: 1571 tests, 1556 pass, 13 skip, 2 fail — both failures are parallel-load flakes (`J-CFG-provider-switch`, `J-EXPERT-WORKSPACE-ADMISSION`) that pass in isolation; neither touches the terminal/browser surface.
- agent-browser spike: every required op verified against the real CLI and daemon websocket before the adapter was written (decision recorded in verification.md).

## Limits

- SSH terminal journey not exercised against a live sshd on this host; WSL paths are Windows-host-only by design and unverified here.
- T6 as planned (center-view registry extraction) was not performed — the dock lives in `App.tsx`; debt folded into T12.
- Tauri acceptance rows (packaged launch pass, second-window single instance, close cleanup, failure surface) still open, scheduled with T12.
- Earlier revision-37 limits still stand: not production hardened (single-operator dev authenticator); packaged builds not exercised on real Windows/macOS hosts.

## Next

1. T10 — inspect + annotate + evidence: injected inspector, structured capture, annotation records, agent receives context.
2. T11 — preview registration + forwarding (`preview.register` journey).
3. T12 — end-to-end mission journey, threat review, Tauri acceptance rows, packaging, docs.
