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

## T10 — Inspect + annotate (2026-11-03)

- Commit `4d12704`.
- `bun test test/J-BROWSER-inspect.test.ts` → 3 pass / 0 fail: select-without-activate (the
  capture-phase click kill is load-bearing — preventDefault on mousedown alone still activates
  buttons, which the journey caught and the script now handles), full structured capture (tag,
  role, name, text, rect, viewport, candidates of all four kinds, ancestry, styles, timestamp),
  evidence screenshot on disk, durable fold with the staleness token, stale-after-navigation,
  resolve-after-SPA-update (both directions proven), the submitted message reaching the model's
  own aimock journal with the payload intact and the untrusted-input fence present, and inspect
  refused under agent control with the reason.
- `bun test test/E2E-browser.test.ts` → 2 pass / 0 fail incl. the dock inspect flow: toggle,
  hint, click-to-card, durable "Record only", card clears.
- `test/ui-viewport-math.test.ts` → 9 pass: the letterbox mapping matrix (both axes, exact fit,
  the real failing dock shape, extreme ratios, resize, HiDPI invariance, margin clamping,
  pre-frame fallback, fractional rounding).

## Flake characterization (2026-11-03) — evidence, not normalization

Three full `bun run verify` runs, one on the pre-desktop baseline, two on this branch:

| Run | Commit | Failures (of ~1570) |
|---|---|---|
| baseline | `448a095` | `J-RW-ssh-workspaces` (SSH coexist) — 1 |
| HEAD #1 | `ed81cde` | `J-CFG-provider-switch` (Azure headers), `J-EXPERT-WORKSPACE-ADMISSION` (15s UI wait) — 2 |
| HEAD #2 | `4d12704` | `J-CFG-provider-test` (keyless), `J-EXPERT-WORKSPACE-ADMISSION` (again) — 2 |

- Both reported HEAD-#1 flakes pass in isolation immediately after the run (provider-switch: 6
  pass; workspace-admission: 1 pass) and again in the targeted regression set.
- `J-RW-ssh-workspaces` failed ONLY on the baseline — the suite has pre-existing load flakiness
  independent of this branch.
- `J-EXPERT-WORKSPACE-ADMISSION` failed on both HEAD runs but not the baseline: not proven
  pre-existing, so treated as aggravated by this work. The aggravation vector identified is the
  initial page-load weight: the dock panels (including the xterm renderer) were statically
  imported into `App.tsx`. Fixed in `d2119a2` (React.lazy + Suspense; Bun.build defers the module
  init). HEAD #3 (`d2119a2`) is the controlled re-run: its result is recorded below when done —
  if the admission test still fails there, the fix is wrong and stays open as debt.
- The provider-suite failures rotate (`switch`/`test` in different runs; both pass in isolation
  and on the baseline): pre-existing mock-server timing races under 189-file parallelism.

## T11 — Preview registration + forwarding (2026-11-03)

- Commit `d2119a2`.
- `bun test test/J-PREVIEW-register.test.ts` → 4 pass / 0 fail: local-world lifecycle (explicit
  registration, readiness probe before ready, the managed browser opens the registered URL,
  stop kills the owned process — group discipline, liveness polled), unreachable port refused
  with the reason and nothing recorded, archiving the owning session stops the preview and the
  process (reason "owner ended"), and an SSH world's preview reached through a REAL local
  forward (direct-tcpip over the genuine ssh2 fixture connection, fingerprint re-verified,
  view URL on an ephemeral local port, forward close actually closes, no password material in
  the durable record).
- Product bugs found and fixed while proving it: the execution-world connection resolver's
  key matcher could never match (silent SSH terminal breakage, now fixed + bounded over the
  async fold), and owner-ended cleanup was not durable (the stop recorder is now injected and
  shared by every stop path).
- WSL forwarding documented, not tested here: WSL2's loopback forwarding is a Windows-host
  feature; this host is Linux.

## T12 — Mission journey + native shell (2026-11-03)

- Commit `d2119a2`: `test/E2E-mission.test.ts` — 1 pass. The original success criterion, end to
  end in one run: the agent (real aimock-driven loop, real bash tool) writes and serves a web
  app (setsid-detached so the tool returns and the server survives; content-type correct — the
  missing header rendered the page as literal text, which the journey caught); the preview is
  registered governed and readiness-probed; the operator opens it in the shared browser dock,
  arms inspect, selects the heading (a click that cannot activate), annotates with a note; the
  model's journal shows the structured payload with the untrusted-input fence; the agent's edit
  lands in the served file; an explicit refresh in the SAME browser workspace shows the change.
  Port note: the fixture authors the bash, so the mission port (47190) is fixed; the test
  reclaims it before and after.
- Tauri shell: `cargo check` in `src-tauri` → clean (2m24s). `J-DESKTOP-launch` (real launch
  path with a fake browser: app window opens, quits with it, second launch reuses the running
  instance) passes in both HEAD full runs (~4.6s).
- Still open for T12: release packaged build + real-window pass on WSLg, sidecar-failure surface
  probe, package scripts; platform validation on Windows/macOS remains blocked on hosts (below).

### Tauri packaging + failure surface (2026-11-03, after d2119a2)

- `bun run tauri:build` → release shell compiled (1m22s); **deb bundle produced**
  (`Cognate Workbench_0.1.0_amd64.deb`, 75 MB, sidecar + resources staged at commit d2119a2).
  AppImage bundling fails at linuxdeploy — the known WSL2/FUSE limitation from the
  standalone-packages tranche; recorded, not silently dropped.
- Packaged-layout launch pass (deb extracted to a clean prefix, `DISPLAY=:0`, WSLg): the shell
  started, spawned the sidecar, the bundled pg0 came up ("database: bundled pg0 … port 5435"),
  the domain loaded, the backend reached `backend ready` (durable session posture, contained
  execution). Pixel-level window verification is not possible on this host (no xdotool/wmctrl);
  the window lifecycle is covered by `J-DESKTOP-launch` (passes).
- **Failure-surface bug found and fixed**: an external SIGTERM orphaned the bundled pg0. The
  chain was shell→sidecar SIGTERM→clean stop, but the shell's 10 s terminate grace SIGKILLed
  the sidecar mid-cleanup (app teardown + database stop can exceed 10 s). Grace is now 30 s
  (wedge failsafe 45 s). Verified against the repackaged deb: SIGTERM → `[shell] signal 15` →
  sidecar `closing the application` → `bundled database "…" stopped (owned by this data home)`
  → shell, sidecar and pg0 all gone.
- Recovery path observed working: the second launch reused the interrupted owner's database
  ("recovering from an interrupted owner (pid …); its database is reused, not reinitialised").
