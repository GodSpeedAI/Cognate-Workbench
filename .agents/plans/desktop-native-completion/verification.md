# Verification log — desktop-native-completion

Append-only. Every entry: date, exact command, result, evidence notes.

## Milestone A — EGM sequence (2026-11-06)

- Scoped drift pass → `2026-11-06_DRIFT_REPORT.md`: doc-status drift only (stale counts, stale
  src-tauri grace text, missing contract READMEs, sibling-plan baseline staleness).
- `egm-brainstorm`: six lenses dispatched, three returned + three retried after a concurrency
  limit, **6/6 completed** (design, codebase-details, zoom-out, comprehension,
  implementation-readiness, structural). Synthesized into `concepts_brief.md`.
- `egm-draft`: `design.md` drafted section-by-section, each section owner-approved (Overview &
  Goals, Technical Plan, Alternatives, Detailed Implementation), brief-vs-draft reconciliation
  audit clean.
- `egm-review`: five stages, all fresh contexts — Stage 5 zoom-out (full file), Stage 6
  comprehension (FeatureRange + DetailedRange), Stage 7 critics (egm-design, egm-structural,
  egm-style on FeatureRange), Stage 8 intermediate zoom-out (full file, prior reports in scope),
  Stage 9 implementation-readiness + codebase-details + style (DetailedRange). Every requested
  reviewer reported. Reports: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`,
  `intermediate_zoom_out_report.md`; consolidated `consolidated_review_report.md` (C1–C18).
- `egm-resolve`: adjudication in `goldfish_review_report.md` — 17 PROPOSE FIX, 1 ESCALATE (C17,
  decided by the owner 2026-11-06: D-track in-mission, E3 closes on desktop qualification with D
  rows carried), 0 CONTEST (disputed facts verified against primary sources: `WORKBENCH_EVENTS` =
  38 in `src/workbench/types.ts:175`, revision 39 exists in `.agents/CURRENT_STATUS.jsonl`,
  `src/ui/tokens.css` absent, ContractEditor at `src/ui/workbench/`), 0 DECLINE. All fixes applied
  to `design.md`; status marked resolved.
- Post-resolution verification pass (fresh codebase-details context): C1–C18 verified incorporated
  with repo ground-truth checks; **one new Major found and fixed** (the resolved text wrongly said
  the contract panel's selects had no driving E2E — `test/E2E-workbench.test.ts:82-83` drives
  `#auth-fs-write`/`#auth-shell-run`, `:157-159` drives the ledger form; the design now updates
  those drives in their batches and only AutomationPanel's conversion adds coverage). Small
  cross-reference fixes applied (Decision 1 channel parenthetical, §6 → B5 pointer, `cli.ts:197`,
  not-touched exceptions). **No new Blocker.** Record: `verification-pass.md`.
- Commits: `36cecea` (pre-resolution artifacts), `e72723b` (resolution), `f133139` (verification).

## A1 — Doc recovery (2026-11-06)

- `CURRENT_STATUS.md`: revision 40 prepended, reconciling JSONL revs 37–39 (markdown sat at 36)
  and recording the EGM Milestone A completion; `.agents/CURRENT_STATUS.jsonl` revision 40
  appended.
- `src-tauri/README.md`: shutdown text corrected to the implemented behavior (30 s grace + 45 s
  wedge failsafe, with the orphaned-pg0 observation and fixing commit named).
- `src/README.md`: counts corrected to the verified numbers (38 mounted capability components —
  counted from the `components:` array in `createRuntime`; 18 public projections — counted from
  the `projections:` array) and subsystem entries added for `src/terminal/`, `src/browser/`,
  `src/preview/` (alphabetical positions).
- `src/terminal/README.md`, `src/browser/README.md`, `src/preview/README.md`: new EGM-compliant
  contract READMEs (Overview/Interface/Invariants/Side Effects/Verification), grounded in the
  module exports (`TerminalService`, `TerminalPort` adapters, `terminalWsController`;
  `BrowserProvider`, `agentBrowserProvider`, `BrowserService`, `INSPECT_SCRIPT_SOURCE`,
  `browserWsController`; `PreviewService`, `openSshForward`).
- `.agents/plans/desktop-terminal-browser/architecture.md`: baseline corrections —
  `WORKBENCH_EVENTS` 28 → 38 (with the growth note), App.tsx 6075 → 6,183 (audited), the
  "no terminal/browser/iframe code" line marked historical (T7/T9 landed), "attaches a second
  window" → the implemented single-instance focus behavior.
- `DESIGN.md`: the nonexistent `src/ui/tokens.css` export reference corrected to the
  `:root`/`[data-theme]` blocks in `src/ui/app.css`, with the earlier-revision note.
- Not done here, deliberately: decision rows for `docs/known-gaps.md` (boundary rule, Windows
  limitations, AppImage record, `--app` close outcome) land with their implementing tranches
  (B3/B4/B5) so known-gaps records gaps that exist, not decisions pending approval.

## B1 + B2 — CI scaffold + packaged smoke harness (2026-11-06)

- B1 (`6b7ac38`): shared DomainForge binding composite action; `package.yml` consumes it;
  `verify.yml` gains the per-commit `tauri-linux` job (cargo fmt/clippy/test in `src-tauri/` +
  `bun run tauri build --debug --no-bundle`) with the domainforge pin aligned to 0.21.2; new
  `tauri.yml` five-platform RC matrix (macos-15 for darwin-arm64 per the owner's platform table)
  with the Rust 1.95 MSRV Jetson gate. Local proof of the exact CI commands: `cargo fmt --check`
  clean, `cargo clippy --all-targets` 0 warnings (after moving `backend.rs`'s test module to the
  file end and `cargo fmt`), `cargo test` 2/2, and the debug build built
  `src-tauri/target/debug/cognate-workbench-shell`.
- B2: `scripts/qualify-tauri.sh` (single file — the `qualify-tauri-lib.sh` split is deferred
  until a second consumer exists; recorded deviation), `just tauri-guards`, `just tauri-smoke`,
  and the T2 `COGNATE_TEST_SIDECAR` mode in `test/helpers.ts` (facade `app`: url/stop/token/
  runtime.service; deeper AppServer surface honestly absent).
- `just tauri-guards` → "generated capability manifest empty (zero-grant)".
- `just tauri-smoke --shell src-tauri/target/debug/cognate-workbench-shell` → PASS end to end:
  launch, port parsed from desktop-shell.log, /health ok with the semantic model, second
  instance exited while the first kept serving (single-instance focus), SIGTERM → sidecar down
  + bundled pg0 stopped + server.lock released, relaunch → clean respawn with the lock
  re-created, final close clean. (Harness fixes while proving: the data home is pinned via
  COGNATE_WORKBENCH_HOME because debug builds hardcode the checkout's `.data`; the health
  probe returns the body, not the port; the deb binary finder excludes the resources tree.)
- T2 proof: `bun scripts/tauri-sidecar.ts` staged the compiled sidecar + resources;
  `COGNATE_TEST_SIDECAR=…/cognate-workbench-x86_64-unknown-linux-gnu COGNATE_TEST_SIDECAR_RESOURCES=… bun test test/E2E-terminal.test.ts`
  → **1 pass / 0 fail in real Chromium against the packaged backend** (19.3 s).
- Bundle mode: `bun run tauri build --bundles deb` → `Cognate Workbench_0.1.0_amd64.deb`
  (71.86 MiB); `just tauri-smoke --bundle …` → PASS (all launch/close rows, packaged shell).
- **Coexistence pass fails as designed-predicted**: both the Tauri deb and the standalone CLI
  deb claim `Package: cognate-workbench` (verified with `dpkg-deb -f` on both artifacts). This
  is the B5 package-identity row's evidence; the row fixes it by giving the shell deb a
  distinct identity, after which this pass goes green.
- Also proven this tranche: `bun scripts/package.ts bun-linux-x64 linux-x64` still produces the
  standalone package (sha256 `87d5c5c9…`) — the standalone pipeline is untouched.

## B3 — Seam protocol (2026-11-06)

- **Web side**: `src/ui/shell/desktopBridge.ts` (New) registers the frozen `window.__wbShell`
  entry point — one documented dispatch protocol (`{v:1, action, args?}`), live handler-map
  lookup, unknown/malformed refused with a console warning, at-most-once registration, no-op
  without a window. `src/ui/titleStatus.ts` (New) is the title owner: the v1 grammar
  (`Cognate Workbench [— running|waiting for you|needs reconciliation|N approval(s) waiting]`),
  precedence (approval > reconciliation > waiting > running), strict parser. App.tsx registers
  the bridge and drives the title from the existing state (pendingApproval / plan- /
  governance-continuations / ambiguousContinuation / streaming). `src/server.ts:396` title
  template reconciled to "Cognate Workbench" (one base name across the server template, the
  Rust window builder, and `src-tauri/dist/index.html`).
- **Shell side**: `src-tauri/src/menu.rs` (New) is the committed menu map — the Workbench menu
  with exactly the six `SHORTCUT_ACTIONS` ids as ui-dispatch items (no accelerators), the
  dispatch_script protocol, and bidirectional tests (every menu item maps to a real action; no
  dead actions). `src-tauri/src/title.rs` (New) is the strict two-sided grammar parser
  (consumer lands in B4; `#[allow(dead_code)]` annotated). `backend.rs` exposes the managed
  `BackendPort` + `PageReady` (set by the webview's page-load-finished hook) and a public
  `probe_health`; `lib.rs` adds the **liveness rule** — a 2 s thread flips the ui-dispatch
  menu items enabled only when `/health` is ok AND the page has loaded; rust-only items
  (File/Edit/View/Window) are untouched; menu events route through
  `window.__wbShell.dispatch` only while live.
- **Deliberate deviation recorded**: the drafted "versioned sentinel prefix in the title bytes"
  is dropped — the titlebar is operator-visible, so the machine contract lives in the grammar
  + format tests pinned on BOTH sides (web `test/ui-title-status.test.tsx`, shell
  `src-tauri/src/title.rs`). The bridge-readiness signal is the shell's page-load observation
  (not a web-authored flag): indistinguishable-from-builder-title made a title-based readiness
  signal unsound at startup.
- **Gates**: `bun test test/ui-title-status.test.tsx test/ui-desktop-bridge.test.tsx` → 10 pass
  (grammar round-trip, strict refusal incl. content-bearing titles, precedence, live handler
  rebinding, args passthrough, malformed refusal, single registration, browser no-op).
  `cargo fmt --check` clean; `cargo clippy --all-targets` 0 warnings; `cargo test` 7/7.
  `test/E2E-desktop-bridge.test.ts` (New) → 1 pass in real Chromium: bridge registered,
  unknown/malformed dispatch refused silently, dispatched new-session creates a session row,
  idle title reads "Cognate Workbench".
- Regression: `test/J-DESKTOP-launch.test.ts` + `test/J-PREFS-shortcuts.test.ts` +
  `test/ui-terminal.test.tsx` → 13 pass; `test/E2E-ui-shell.test.ts` → 2 pass; `just smoke` →
  73 pass; `bun run typecheck` clean; `just tauri-guards` → capability manifest empty.

## B4 — Desktop contract (2026-11-06)

- **Fail-closed close guard** (`lib.rs close_requested`): scoped by `backend::shell_owned_backend`
  (New — the reuse path closes the shell and leaves the backend with its owner, exactly the
  implemented reuse semantics now contractual). Shell-owned: `/health` probe + the in-flight
  signal; confirm dialog (plugin-dialog, Rust-invoked, no webview grant) on in-flight OR
  probe-failure OR unknown state; confirmed → `window.destroy()` → the normal ExitRequested
  shutdown (SIGTERM, pg0 stop, lock release); declined → `prevent_close`. **Interim signal
  recorded**: until B5 lands the `/health` run counts, in-flight is the window title's B3 state
  grammar with unknown → in-flight — fail-closed under both readings; known-gaps row added.
- **Attention cue**: the shell-watch thread (renamed from liveness-rule) reads the window title
  each 2 s; a strict-parsed waiting-on-you state while unfocused raises
  `request_user_attention` on the transition only. Title parse failure = no cue (fail-open by
  contract for cues).
- **External links**: `on_navigation` — loopback stays in-app, every other host opens in the
  system browser via tauri-plugin-opener (Rust-invoked) and the navigation is blocked;
  `on_new_window` — no in-app popups, external hosts open externally, blob/foreign schemes
  denied (the web app's honest fallback text covers them).
- **`--app` fallback close**: the entry template gains `SHELL_KIND_PLACEHOLDER`
  (substituted at boot from `COGNATE_SHELL` in both composition paths — dev rebuild and the
  packaged bundle) and installs a beforeunload guard conditioned on `chromium-app`, consulting
  `window.__wbInFlight` (maintained by App.tsx next to the title cue). `shellKindForEnv` (New)
  parses the env; package.ts stages the placeholder.
- **Downloads**: ledger F3 revised to DEFER with the honest data-flow rationale (the export
  content is client-held, not URL-addressable; moving content web→shell would breach the
  channel rules); known-gaps row added. `color-scheme` was already present on both theme
  blocks (verified `app.css:12,:121`) — no change needed.
- **Gates**: `cargo fmt --check` clean, clippy 0 warnings, `cargo test` 7/7; `bun run
  typecheck` clean; smoke 73/73; `test/E2E-desktop-bridge.test.ts` + `test/J-DESKTOP-launch.test.ts`
  7 pass; smoke harness re-run PASS (the guard leaves idle SIGTERM closes untouched — the
  dialog only guards the window-close path).
- **Real-window pass (WSLg, X11-forced)**: the debug shell maps a real window
  (`xwininfo`: `0x600004 "Cognate Workbench"` with the expected class), spawns the sidecar,
  backend ready; title reads the composed idle form. **Recorded for the C-tranche manual
  row**: menu-click and dialog-interaction passes need xdotool (absent here); whether the
  page title propagates to the GTK window title on a state change (idle → running) is
  observable only with such a pass — implemented-per-code until then, per the platform
  honesty rule. Note: the shell only maps a window under `GDK_BACKEND=x11` in this WSLg
  session (default Wayland attempt renders no X11 mapping) — recorded for the E2 Jetson run.
