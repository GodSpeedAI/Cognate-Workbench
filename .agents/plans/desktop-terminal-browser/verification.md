# Verification log — desktop-terminal-browser

Append-only. Every entry: date, exact command, result, evidence notes.

## T1 — Baseline (2026-11-03)

- `bun run typecheck` → exit 0.
- `bun run test:smoke` → 73 pass / 0 fail (274 expects).
- Repo maps recorded in `architecture.md` §Baseline (backend, UI, packaging maps from three
  exploration passes + external-tech research pass with sources).
- Toolchain check: bun 1.4.0, rustc/cargo 1.98.0, webkit2gtk-4.1 + gtk3 present,
  `.tmp/domainforge/bin/domainforge` present, `.tmp/pg0/pg0` present, COGNATE_POSTGRES_URL unset.

## T2 + T3 — Tauri shell skeleton + model (2026-10-31 → 2026-11-03)

- Commits `4ac47c1` (Tauri 2 shell with managed backend lifecycle; J-TERMINAL/J-BROWSER/J-PREVIEW
  journeys in `.sea` + bindings), `9b6bb21` (sidecar selection skips the shell binary; devtools
  gated to debug builds).
- `.tmp/domainforge/bin/domainforge validate --format human .sea/interaction/interaction-model.sea`
  → "Validation succeeded: 0 violations total" (re-run 2026-11-03 after the browser.control model
  revision); `fmt --check` → "already formatted".
- Not yet exercised on this host per the acceptance matrix: packaged/debug Tauri launch pass,
  second-window single-instance, close-cleanup, failure surface. Recorded as open T12 rows.

## T4 + T5 — Terminal local PTY + SSH/WSL adapters (2026-11-03)

- Commit `be49122` (PTY service: local Bun.Terminal, WSL via wsl.exe, SSH via ssh2 with host-key
  fingerprint re-verification and stored secrets; process-group termination discipline verified
  empirically), `be03c68` (strict tsc conformance in the journey test).
- `bun test test/J-TERMINAL-session.test.ts` → 3 pass / 0 fail: interact, resize (`stty size`
  honors the PTY size, with a tolerant retry for the shell's SIGWINCH redraw), detach keeps the
  process, reattach restores scrollback, terminate kills the group, durable rows fold,
  anonymous/wrong-token/foreign-identity attach refused, dead session ids report dead, cwd
  escapes refused.
- SSH journey: not exercised against a live sshd on this host (recorded limitation); WSL paths
  are Windows-host-only by design.

## T6 + T7 — Dock + terminal UI (2026-11-03)

- Commit `dd5f7b1` (docked terminal panel: xterm.js over the authenticated websocket, boot-token
  first-message auth, tabbed sessions, maximize + persisted height, xterm.css served in dev and
  packaged builds).
- `bun test test/E2E-terminal.test.ts` → pass in real Chromium: open, type, executed result
  distinct from the echo, maximize/restore, close+reopen replays scrollback, shell-idle wait
  before typing.
- Deviation from the T6 row as planned: the dock was added directly in `App.tsx`; the planned
  center-view registry extraction was not performed. Existing E2E stayed green. Recorded as debt
  to fold into T12 hardening rather than a separate refactor.

## T8 + T9 — agent-browser spike, shared browser service + UI (2026-11-03)

- Decision (spike, evidence in the session transcript): agent-browser is the backend. Verified
  ops: `open`, `eval`, `snapshot -i`, `get box`, `get cdp-url`, `screenshot`, `stream status /
  enable --json` (results wrapped `{success, data, error}` — the adapter unwraps), raw daemon
  websocket frames (base64 JPEG `frame` messages, `url`/`console` events), and `input_mouse`
  injection executing a real click. `AGENT_BROWSER_EXECUTABLE_PATH` exists for browser discovery.
- Commit `ec7fc4d`: provider contract + CLI adapter, BrowserService (owner-checked attach,
  base64→bytes frame decode, url/console relay, daemon plumbing kept internal), named control
  handoff (`browser.control`; human input refused while the agent holds control and vice versa,
  reads stay available), `/browser/stream` websocket sharing one Bun websocket with the terminal
  via a surface tag, BrowserPanel with letterbox-corrected input mapping, header globe toggle.
- `bun test test/J-BROWSER-session.test.ts` → 2 pass / 0 fail (open, navigate, stream, human
  click, control handoff, close folds one durable record; foreign-identity attach and dead
  sessions answer honestly).
- `bun test test/E2E-browser.test.ts` → pass in real Chromium: dock opens, first real frame
  (bitmap ≥ streamed viewport), address-bar navigation, fixture document awaited before the
  canvas click (the daemon reports the url at navigation start; an earlier commit of the click
  landed on the old page — the test now waits for the fixture to be readable through
  `browser.snapshot`), letterbox-corrected click activates the fixture, effect read through
  `browser.snapshot`.
- Regression: `bun run typecheck` → 0 errors; `bun test` J-TERMINAL + J-BROWSER + E2E-terminal +
  E2E-browser → 7 pass / 0 fail; `bun run test:smoke` → 73 pass / 0 fail;
  `bun test test/workbench-contract.test.ts` → 16 pass / 0 fail. Full `bun run verify` recorded
  below when it completes.

### Full verify at ec7fc4d (2026-11-03)

- `bun run verify` → 1571 tests across 189 files: 1556 pass, 13 skip, 2 fail, 9383 expects
  (1181 s wall).
- The 2 failures are load flakes, not regressions: `J-CFG-provider-switch` (Azure header probe —
  mock-server assertion race) and `J-EXPERT-WORKSPACE-ADMISSION` (waitFor 15 s exceeded under
  full-suite parallelism). Both pass in isolation immediately after the run
  (`bun test test/J-CFG-provider-switch.test.ts` → 6 pass; `bun test
  test/E2E-expert-workspace-admission.test.ts` → 1 pass). Neither file touches the terminal or
  browser surface.
