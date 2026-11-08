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

## B5 — Lifecycle hardening (2026-11-06)

- **Startup budgets**: first boot (no `database/` in the data home) gets 180 s, steady 60 s;
  readiness logs `backend ready on port N after Xs (<budget>s budget, first|steady boot)`.
  **Measured on this host**: first boot with a fresh data home (bundled database
  initialization included) reached `/health` in **4 s** — the budgets have large headroom;
  the measured number is recorded here per the design's "measured, not assumed" rule. The
  timed-out backend is now asked to stop cleanly (SIGTERM + the 30 s database-stop grace)
  before a kill — SIGKILLing it mid-initdb would orphan pg0 exactly the way the old 10 s
  shutdown window did — and the error surface carries the sidecar's own stderr tail.
- **Watchdog**: every 5 s `/health` probe with a two-failure threshold; covers the reused
  backend (its death surfaces the error window instead of a silent zombie window); the exit
  watchdog is unchanged for the shell-owned child. The recovery surface names what happened,
  who owns the lock (shell-owned vs external owner), and the relaunch move.
- **Handle-before-wait**: `BackendHandle`/`BackendPort` are managed empty at launch and
  filled by the backend thread — an early quit during the health wait always has a kill path.
- **Log rotation**: `desktop-shell.log` rotates at 5 MB (one `.1` file retained); raw
  `/health` bodies are logged when a parseable response is not ok.
- **`/health` machine inputs**: `shell` (from `COGNATE_SHELL` via `shellKindForEnv`),
  `runsInFlight` and `pendingApprovals` folded from the sessions projection — verified live:
  a plain boot reports the counts and no shell field; `COGNATE_SHELL=tauri@test` reports
  `shell: tauri@test`. A failed projection read leaves the counts absent (the guard reads
  unknown → fail-closed); the watchdog's liveness reads only `ok`, so a projection hiccup
  never flaps the menus.
- **Close guard switched to the machine authority**: `close_requested` now reads
  `backend::health_state(port)` — healthy + counts present + both zero → close proceeds;
  anything else (in-flight, missing counts, dead backend) → the confirm dialog. The B4
  interim title signal is retired; the title remains the attention/notification cue only.
- **Package identity**: `productName` "Cognate Workbench Shell" + explicit
  `mainBinaryName cognate-workbench-shell` (window title unchanged — the builder sets it);
  `appimage` removed from `bundle.targets` (the linuxdeploy/FUSE failure stays recorded in
  the B2 log and known-gaps); the bundle version comes from package.json via
  `src-tauri/tauri.conf.override.json` (regenerated by `tauri-sidecar.ts`, gitignored, passed
  with `--config` in both the `tauri:build` script and the CI workflow).
- **Proven**: rebuilt shell deb reports `Package: cognate-workbench-shell`;
  `just tauri-smoke --bundle … --coexist <cli-deb>` → **PASS end to end**: full launch/close
  rows plus `packages distinct: cognate-workbench-shell vs cognate-workbench` and
  `no overlapping file paths between the packages` — the B2-evidenced collision is closed.
- **`--app` surface identity**: `cli.ts launch` sets `COGNATE_SHELL=chromium-app@<version>`
  (from package.json, `resolveJsonModule` enabled) before starting the server.
- **Jetson runbook drafted**: `docs/jetson-qualification.md` (operator-executed in E2;
  prerequisites, T1 steps, the DMABUF disposition, the evidence format, the gate rule).
- Rust gates: fmt clean, clippy 0 warnings, `cargo test` 7/7 (re-confirmed on resume).
- Full `just verify` at this milestone boundary (2026-11-07, resumed session, host quiet):
  **1586 pass / 1 fail** — the one failure `J-EXPERT-WORKSPACE-ADMISSION` (capacity text
  not visible within the 22 s E2E deadline under full-gate load) **passes isolated in
  9.76 s** — the documented host-concurrency flake class, not a product bug. The previous
  boundary run (before the `postgresUrl()` coupling fixes) was 1582/5; the fixes closed
  the three environment-coupled failures and two host-load flakes passed on re-run.

## D track — S1–S9 MenuSelect conversion (2026-11-07)

The ledger's global gate landed first (`d5ec3fd`): MenuSelect's trigger accessible name now
carries the current value (`Label: Value`), with the full keyboard contract (Enter/Space/
ArrowDown/ArrowUp open with the disabled guard, arrows/Home/End move, Enter/Space pick via
explicit activation with the native-click double-fire prevented, Esc/Tab close and return
focus, click-outside closes) pinned by `test/ui-menu-select.test.tsx` (New, 12 tests,
happy-dom + Testing Library per the `remote-dialog-focus` idiom).

Then the nine batches, one commit each, in ledger order:

- **S1** `133876b` — ContractEditor, 13 selects (9 authority grants through a shared
  `GrantField`, executor role/kind, invariant kind, acceptance kind); MenuSelect gains the
  optional trigger `id` so `<label htmlFor>` association survives.
- **S2** `a24cbb0` — ExpertsTeamsPanel, 8 selects (Add Specialist and Mention-a-Specialist
  keep a placeholder row as action pickers; Conversation history; Review verdict; Knowledge
  kind; Team memory visibility; Memory scope; Observed outcome). E2E drivers rewritten to
  the open-and-pick idiom; history rows found by marker text; the trigger name carries the
  current message count.
- **S3** `7b2d19b` — AutomationPanel, 6 selects (Source task/Repeat/Runner in both form
  copies) + the ledger's new coverage: a component test asserting the announced values and
  no native select.
- **S4** `f154453` — SchedulesPanel, 5 selects; the create handler's existing `targetId`
  guard replaces the redundant HTML5 `required`.
- **S5** `56f96ff` — Workbench, 3 selects (Workflow picker resets instance+node; Instance;
  Move destination with placeholder and conditional rows) — closes D-28's selects.
- **S6** `4a10f37` — LedgerPanel, 3 selects; the E2E independent-check step drives the
  announced names.
- **S7** `48280c7` — ExpertEditor, 2 selects (Configured provider, Protocol).
- **S8+S9** `5b894b9` — AmbiguousStepCard observed outcome + CheckoutChip start-from-branch,
  and the ledger's closing guard `test/native-select-guard.test.ts` (New): the suite fails
  if any component renders `<select>` again outside MenuSelect.tsx.

**Gate fallout, classified and fixed** (`c41b919`): the a11y gate's value announcement
changes every MenuSelect trigger's accessible name, which broke three exact-name test
lookups — the ui-experts static route-options assertion (a closed menu renders only the
announced value; route options are proven interactively by the E2E provider-route journey),
onboarding's exact `getByLabel("API protocol")`, and remote-workspaces' exact
`[aria-label="WSL distribution"]` attribute selector. All three fixed to the announced-name
idiom; all three suites pass isolated (5/5, 10/10, 5/5).

**S-track boundary gate** (2026-11-07, second full run after the fallout fixes): **1600 pass /
1 fail** — `J-CFG-provider-switch` (local/no-Authorization-header row) fails under full-gate
parallel load and **passes isolated 6/6**: the documented host-concurrency class. Combined with
the first run (1598/3, all three fixed as `c41b919`), the S-track boundary is green.

## D track — D-row fixes (2026-11-07)

All 17 open A2 rows dispositioned, five fix commits plus three recorded as already landed:

- **e3907ff** — D-15 (curly-quote pair in the delete-workspace title), D-19 (disclosure
  buttons become section headings, no link-style underline), D-22 (the streaming status
  names the running tool's action from the trace projection, elapsed seconds stay in the
  accessible text).
- **d187434** — contrast tokens: D-29 (dark `--cg-border-strong` 36%→45%; the dark Cancel
  read borderless), D-18 (a `--cg-placeholder` token + global rule; the GovernancePane
  grey-on-dark), D-17 (workspace chooser's disabled state via tokens, not 0.5 opacity),
  D-30 (real `.cfg-btn` styles — the config Save was UA-default and read differently per
  theme).
- **6f2dee0** — responsive: D-9 (full tab labels kept, breadcrumb collapses to the last
  crumb, trail tightens), D-24 (title prefixes that duplicated the row badge removed;
  titles wrap to two lines), D-26 (review toolbar's toggles + open-actions collapse into
  one Options menu with checkable items), D-12 (wizard footer stacks at phone widths),
  D-27 (form errors get air before the footer divider).
- **a6c9e6b** — D-25 (one turn counter: the review header counts assistant turns from the
  same ordinal map as the composer's "N turns"), D-21 REDESIGN (settlement causes render
  once above the reservation list, distinct).
- **102cdbb** — D-13 (tab labels show at the default 340px inspector width; the 460px
  container threshold made everything icon-only; icon-only only below 330px with scroll).
- Recorded as already landed, no re-fix: **D-16** (two-line clamp, b0bbd87), **D-34**
  (one focus ring, fb14932), and D-13's stray theme icon (removed by d918589).

`DEBT.md` reconciled; F1 (session Pin) and F2 (remote diagnostics durability) remain the
ledger's open BUILD rows.

**D-row boundary gate** (2026-11-07, classification CORRECTED 2026-11-08): **1599 pass /
2 fail** — `J-EXPERT-WORKSPACE-ADMISSION` is the documented host-concurrency flake (isolated
PASS, twice). But the failure titled "J-WS-delete E2E workspace delete confirmation" was
**misclassified here as a host-load flake**: the isolated re-run used the wrong file —
`test/J-WS-delete.test.ts` passes, while the actual failure was `test/E2E-ui-production.test.ts`
whose copy of the journey matches the dialog by a straight-quote regex that D-15's curly-quote
title broke. A real regression, carried undetected through the S-track and F-track gates
(their "J-WS-delete flake" rows are the same misclassification) and surfaced by CI's full
suite. Fixed with the regex (and the CI rustfmt/clippy component gap found in the same run);
`test/E2E-ui-production.test.ts` green locally after the fix. Lesson recorded: an isolated
re-run must re-run the file that failed, identified by the log's error location, not by the
test title.

## F track — the two BUILD rows (2026-11-07)

Both feature rows landed model-first, per the ledger's first steps and the building-with-cognate
sequence (validated journey → explicit binding → capability → projection → surface → journey test):

- **F1 Session Pin** (`3596abc`) — `J-SESSION-pin` validated in the SEA model (0 violations);
  `session.setPinned` anchored on `Session` (`bindSessionPin`); the deterministic `agent.config`
  run records `session.pinned`, which the `sessions` projection folds and carries across the
  turn-rebuild folds exactly like the archive flag; `orderSessions` floats pinned sessions to
  the top of their list under both sort orders (recency-ordered within the pinned block); the
  row menu gains Pin to top/Unpin with a quiet pinned glyph. `test/J-SESSION-pin.test.ts` (New)
  proves durability across restart, reversibility, sort-independent ordering (both orders
  asserted) and unknown-id refusal.
- **F2 Durable remote diagnostics** (`b9c7d9b`) — `J-REMOTE-diagnostics` validated with a new
  `RemoteControl` entity beside the collaboration surfaces (the anchor probe showed no `Workbench`
  entity exists — the model gained the honest one); bounded `workbench.remote.state`/`.error`
  family folded into the workbench projection's `remote/control` row (state, device label, bounded
  last error, 8-transition ring); the recorder injects into `MobileRemote` via `RemoteHost.record`
  at start/refresh/stop/pairing/pairing-refusal only — never the 2 s/5 s polls, never a secret,
  link, challenge or credential; `workbench.remote.record` validates the family boundary; the
  Remote dialog renders the durable history (surviving dialog close and restart) with the
  in-memory notes as the live fallback. `test/J-REMOTE-diagnostics.test.ts` (New) proves the
  transitions record, the polls record nothing, and the history survives a full restart.

The settled context rows are thereby closed: Pin is no longer the donor-parity gap, and remote
diagnostics are no longer dialog-memory-only. F3 (downloads) and F4 (drag-and-drop) remain
recorded DEFERs.

**F-track boundary gate** (2026-11-07, classification CORRECTED 2026-11-08): **1603 pass /
2 fail** — `J-CHECKOUT-lifecycle` (2 s deadline under full-gate load) **passes isolated 7/7**
(genuine flake). The "J-WS-delete" failure was the D-15 regression misclassified at the
D-row boundary (see the corrected entry above), not a flake. With the regression fixed, the
F track is green; the ledger's BUILD rows are closed.

## C — Native UX convergence (recorded 2026-11-07)

- **Per-platform menu conventions** — verified against the code and the Tauri 2 platform
  contract: the macOS-required predefined Edit roles (undo/redo/cut/copy/paste/select-all)
  and Window roles ship (`lib.rs:182-196`); macOS adds about/quit items; devtools gate per
  platform; Windows/Linux carry the same menu structure in-window. The no-accelerator
  deviation is documented (menu.rs:5-7): the operator-editable shortcut table stays the
  single source of truth, so the menus cannot diverge from it. Divergences to correct: none
  found.
- **Desktop-contract acceptance rows per platform** — the B4 real-window pass on WSLg
  (X11-forced) remains the one real-window verification: window mapping, class, sidecar
  spawn, backend readiness, composed idle title. Menu-click and dialog-interaction rows need
  xdotool, which is **absent on this host and requires passworded sudo** — recorded BLOCKED
  for this environment, explicitly, per the honesty rule (not silently skipped); they stay
  `implemented-per-code` until a real interaction pass (E-phase device pass or an
  operator-installed xdotool).
- **Notifications (Open Question OQ1)** — deliberately **OPEN, owner's call** per the
  design: the notification plugin ships only if the operator finds the B4 title cue
  insufficient for the approval-waiting path in their own use. Nothing is implemented
  pre-gate; the known-gaps row carries the current truth.

## E1 — Five-platform matrix on tag v0.1.0-rc1 (2026-11-08)

**Matrix run 42430168441 (tag `v0.1.0-rc1` = `10ecd0f`): 6/6 green** — linux-x64,
linux-arm64, darwin-arm64, darwin-x64, windows-x64, and the msrv Jetson gate (the shell
compiles under the device's Rust 1.95). **PR verify run 42432136501 (`e6d45d8`): green**
(full suite on CI's ubuntu host, 15m52s). clean-install green on every ref. Artifacts
uploaded per platform (30-day retention); downloaded checksums (SHA256):

- linux-arm64 `Cognate Workbench Shell_0.1.0_arm64.deb`
  `5e6d822b4d6d7082a213bf904c28c40f6ef6c5c4bce0578de0cb76ffcc267ae3`
- linux-x64 `Cognate Workbench Shell_0.1.0_amd64.deb`
  `c7626b801b12b47a77653e937a715395076fe1881fd3a24e7123cebc8e6a0eca`
- windows-x64 `Cognate Workbench Shell_0.1.0_x64-setup.exe`
  `ace3be30c2c6223834ccc61e637c1702833850bb44542da1650b7b66d688a5f3`
- darwin-arm64 `Cognate Workbench Shell_0.1.0_aarch64.dmg`
  `8cea43cbcd0cf7a5b1be389f442077ffc3c075189051b62209d862a76fd3e492`
- darwin-x64 `Cognate Workbench Shell_0.1.0_x64.dmg`
  `cd2d7124370077041ba89073bdd5f246c5bc5e800b71d04b728d2a1b031808a4`

**E1's gate deltas, fixed in flight** (all first-seen in CI, each reproduced and understood):
(1) 895 MB of committed `dist-package/` artifacts blocked the push — history rewrite of the
unpushed range + gitignore (the packaging output never belongs in git). (2) ssh2's optional
`cpu-features` resolves to an unbuilt `.node` on fresh installs — the sidecar compile
externalizes it (`bb40f99`). (3) `tauri.conf`'s externalBin contract needs the staged sidecar
for any cargo step — msrv and verify.yml's tauri-linux gained staging steps (`bb40f99`,
`e6d45d8`). (4) CI's minimal Rust profile lacks rustfmt/clippy — components added
(`10ecd0f`). (5) The D-15 curly-quote regression surfaced by CI's full suite — fixed and the
verification log's earlier misclassification corrected (`10ecd0f`).

**Recorded honestly:** the matrix jobs prove compile + bundle + artifact per platform; the
T1/T2 packaged smoke rows per platform remain local-Linux-only (the yml ships the skeleton;
per-platform smoke steps are the next E-phase work). Jetson E2 awaits the operator's device
pass with the arm64 deb above.

## E1 phase two — T1/T2 smoke in the matrix (2026-11-08, matrix run 42446953932)

The matrix jobs grew the packaged smoke: **T1** (the B2 harness: launch → health → identity →
single-instance → close-cleanup → respawn → final close) on Linux under one shared Xvfb and on
macOS from the dmg, and **T2** (the E2E-terminal journey against the packaged sidecar, not the
dev server) on Linux. Results at `a4eff7b`:

- **linux-arm64: T1 + T2 fully green** — the Jetson-target artifact is smoke-proven on
  ubuntu-22.04-arm.
- **windows-x64 + msrv: green** (Windows T1/T2 remain bundle-only, recorded honestly).
- **linux-x64: every T1 row green except the final close** — consistently across three runs:
  the backend's clean stop exceeded the shell's 30 s stop grace under runner load, so the
  grace SIGKILL fired and the lock file orphaned (row 3's close passes; only the final one,
  ~30 s after a fresh respawn on a cold runner, trips it). This is a **real shutdown-grace
  finding** of the same class `96f7fb0` fixed, needing a product decision (the grace and the
  45 s wedge failsafe are coupled timers — raising one without the other needs the design's
  call), not a harness workaround. Recorded, not masked.
- **darwin (both): T1 launches the .app but the readiness row times out** — the harness
  extracts the .app from the dmg and launches it (bash 3.2 + BSD-find fixes landed in
  `6614ff1`/`a4eff7b`); the process starts but never writes the backend port to
  desktop-shell.log within 90 s. Most plausible: Gatekeeper/quarantine on the unsigned,
  hdiutil-mounted binary, or a session-window-server constraint on runners — needs an
  iterative macOS debugging pass this environment cannot reproduce. Recorded BLOCKED.

**Harness fixes landed in this phase**: deterministic main-binary selection (the deb also
installs the triple-stripped externalBin sidecar as bare `cognate-workbench`; B5's local pass
had been order-lucky), NUL-safe glob resolution for the product name's spaces, the T2
extraction against the real deb layout (`usr/bin/cognate-workbench` +
`usr/lib/Cognate Workbench Shell/resources`), one shared Xvfb per run (per-launch displays
made the second WebKitGTK instance abort mid single-instance handshake — misread as
focus-exit), crash-vs-focus-exit detection, lock-release waits, and the bash 3.2/BSD-find
portability.

## E1 phase three — the two findings resolved (2026-11-08, matrix run 42503577625: 6/6 green)

**The linux-x64 final-close mechanism, named and fixed.** The failure forensics (the harness
now dumps both shells' output, the sidecar log tail, the lock contents and the process table
on every row failure) showed: backend and postgres alive, lock intact, shell gone, and none
of the sidecar's shutdown lines. A watchdog thread had panicked **while holding the
BackendHandle mutex** (it opens its error window off the main thread), poisoning it — after
which every shutdown's `if let Ok(lock)` silently skipped the backend stop. Fix: all lock
sites recover the poisoned guard (`poisoned.into_inner()`), so the stop is unconditional.
Green on the next run and the run after. The 60 s/90 s timers from the earlier finding stand
(they address the cold-start duration; the poison fix addresses the orphaning mechanism).

**The darwin readiness mechanism, named and fixed.** Two layers:
1. The bundler ad-hoc signs the .app's main binary but **not the externalBin sidecar**
   (tauri-apps discussion #2269) — an unsigned sidecar refuses to exec on modern macOS,
   reading exactly like the observed readiness timeout. The harness strips quarantine and
   ad-hoc deep re-signs the extracted bundle before launching.
2. With the sidecar execing, the run failed one level deeper: **Tauri's `resource_dir()`
   itself returned "unknown path"** on the CI runner (named by the probe's own log once the
   data home was pre-created for it) — the shell passed no `COGNATE_RESOURCE_DIR`, the
   sidecar fell back to the standalone `Contents/share/` layout and reported pg0 missing.
   The bundle-layout dump (now in the harness log) showed the tree at
   `Contents/Resources/resources/cognate-workbench`. Fix: resource resolution probes
   relative to the running executable (Tauri dir, both .app layouts, the standalone share/
   layout), first MANIFEST.json wins, every outcome logged — no dependency on the Tauri
   path API.

**Result: matrix run 42503577625 — 6/6 green**, T1 on all four POSIX platforms (identity row
included), T2 on both Linux platforms, Windows bundle-only, msrv green. The harness fixes
landed in this phase: NUL-safe glob resolution, shared Xvfb, crash-vs-focus-exit detection,
lock-release waits, bash 3.2/BSD-find portability, stderr-routed forensics, the bundle-layout
dump, and the deterministic main-binary selection.
