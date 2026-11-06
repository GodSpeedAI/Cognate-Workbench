# Design — Desktop-native completion of Cognate Workbench

* **Status:** reviewed and resolved — five EGM review stages applied; this file supersedes
  `design_draft.md` (removed).
* **Date:** 2026-11-06
* **Process:** drafted from `concepts_brief.md` (six-lens Goldfish brainstorm); reviewed by five
  fresh-context stages (zoom-out, comprehension, critic ×3, intermediate zoom-out, implementation
  readiness ×3); findings consolidated in `consolidated_review_report.md` (C1–C18) and adjudicated
  in `goldfish_review_report.md`; all fixes applied here.

## The Problem

Cognate Workbench is an operator's cockpit for accountable agent work: the operator declares what a
task may do, watches the work happen, grants or refuses consequential actions, and settles results
on evidence. That job happens at a desk, for hours, while something consequential is in flight
(PRODUCT.md). The application already does the accountable part well. What it does not yet do is
behave like desktop software on the machine it runs on.

Three things are wrong, in order of weight:

1. **The shell's lifecycle can destroy work silently.** Closing the window stops the backend, the
   bundled database (pg0, the pinned embedded PostgreSQL distribution the server starts and stops),
   and every in-flight agent run, with no confirmation and no cue when the window is unfocused. On
   macOS this collides with the platform convention that closing a window is not quitting the
   application. For a product whose user is supervising consequential work, this is the most
   consequential failure a desktop shell can have — and it is verified, shipped behavior today.

2. **The shell cannot exchange state with the app it hosts, and half the planned native
   integration presumed a channel exists.** The webview is deliberately a zero-IPC remote context
   (no web content can call a shell API). That is the right security posture, but it means native
   menu actions cannot reach the app, external links do nothing, and there is no attention path
   when the operator is needed. The previous plan listed these features without naming the channel
   problem they all share.

3. **The remaining product surface is unfinished, and unproven where it matters.** The A2 audit
   left open rows (the reconciled open set in `.agents/DEBT.md`: D-9, D-12, D-13, D-15–D-19,
   D-21, D-22, D-24–D-30, D-34) plus 42 native `<select>` controls across 9 files that clash with
   the design system's MenuSelect primitive, no session Pin, and remote diagnostics that evaporate
   on restart. CI builds the standalone server packages for five platforms but has never compiled
   or exercised the Tauri shell; the Jetson AGX Orin (the operator's own device) has never run it.

The consequence of stopping here: a product that works but does not feel like an application —
browser panels in a native frame, one accidental keystroke from losing an agent run, shipping on
five platforms on the strength of a build succeeding.

## Overview

This design completes the Tauri 2 desktop shell as the primary Cognate Workbench surface and
converges the product to a finished desktop application. It does not redesign the product, replace
the architecture, or chase donor features — **donor** is PandaCode, the third-party reference app
whose UX was rebuilt here without copying code, and the standing rule is that an affordance may be
ported from it only when a real Cognate capability exists behind it. The capability/event/authority
model, the Cobalt design system (DESIGN.md), and the CLI + browser-access surfaces are preserved
as-is. This design extends the desktop-terminal-browser mission (`.agents/plans/
desktop-terminal-browser/`): it supersedes that plan's open T12 platform rows and corrects its
architecture doc; everything it settled remains settled.

The design rests on four decisions (each argued in Alternatives Considered):

1. **No capability grants to web content — ever, in this design.** The Tauri ACL stays empty and a
   CI guard enforces it. All web↔shell traffic rides the sanctioned channels enumerated in §1
   (host-side dispatch; the window-title cue; the shell's own `/health` probes), none of which
   requires a grant.
2. **A desktop contract instead of a chrome list.** Close/quit semantics per backend ownership
   with a fail-closed confirmation, an attention cue, working external links, and one shortcut
   source of truth — these, not a longer list of integrations, are what make it native.
3. **Dispositions before code.** Every remaining defect gets a recorded decision — FIX, REDESIGN,
   DEFER, REMOVE, or KEEP-NATIVE (features carry BUILD) — before any fix code lands, batched per
   panel so each commit stays green.
4. **Tiered, honest qualification.** A packaged-app smoke harness built once, run on all five CI
   platforms at release-candidate time, plus a gated manual Jetson AGX Orin runbook. Every claim
   names the engine and platform that verified it.

## Goals

1. Closing the window destroys nothing silently: on the shell-owned backend, close exits the shell
   and stops the backend only after a confirmation whenever server state shows work in flight — or
   state is unknown; on a reused backend, the shell exits and the backend stays with its owner.
2. The packaged app installs, launches, runs, and shuts down correctly on all five CI platform
   targets, with the shutdown/restart contract demonstrated by the smoke harness rather than
   asserted.
3. The shell↔web seam exists as the documented, tested protocol of §1; the zero-grant posture is
   enforced by a permanent guard.
4. External links, menus, and shortcuts behave per platform convention with one shortcut source of
   truth (the operator-editable shortcut table).
5. Every open A2 defect row and every native `<select>` control has an explicit, evidence-backed
   disposition, executed in green-suite batches.
6. Session Pin and durable remote diagnostics ship as real, implemented features (or their absence
   is a recorded decision, not an omission).
7. Notifications, if shipped, are summons-only: they never carry authority actions and never claim
   unearned completion.
8. The Jetson AGX Orin qualification has a runbook, an operator-authorized prerequisite list, and a
   defined evidence path — executed by the operator, not silently skipped or silently claimed.
9. Documentation (status, READMEs, contract READMEs, architecture doc) agrees with the code.

## Non-Goals

- Auto-update (unsigned artifacts; manual download + SHA256SUMS is the documented posture).
- Crash-reporting service (local-first posture; the watchdog error window and shell log are the
  surface).
- Any Tauri capability grant to webview content (the zero-grant posture holds in this design).
- Global OS shortcuts, tray/minimize-to-tray, multi-window attachment (single-instance focus stays).
- App-wide native file dialogs (the world-aware server-side directory picker stays the universal
  path; at most a first-run local "Browse…" is considered through the ledger).
- Cloud sandboxes, skills/rules settings, GitHub integration (no matching capabilities exist; the
  donor rule above binds).
- Removing the Chromium `--app` fallback or the CLI/browser access modes (supported surfaces; the
  fallback's close limitation is recorded, see §2).
- Multi-user hardening (the single-operator development authenticator remains the documented
  limitation).

## Technical Plan

### 1. The seam: sanctioned channels, zero capability grants

The webview stays a zero-grant remote Tauri context: no capability file ships in this design, and a
CI guard asserts the generated ACL grants nothing to web content. The posture budget rule —
"plugins are invoked from Rust only; any web-invoked capability would require a named, per-command
capability file plus a recorded justification" — is written into `src-tauri/README.md`.

The canonical channel list (stated once here; Decision 1 and Goal 3 quote it):

- **Shell → web: host-side dispatch.** The web app exposes one documented entry point,
  `window.__wbShell.dispatch(message)`, routing to its existing action handlers (the same handlers
  the command palette and shortcut table use). The Rust side invokes it through `window.eval` —
  the mechanism already used for Reload. Messages carry only action ids and arguments — never
  content, never tokens. One committed **menu map** (`src-tauri/src/menu.rs` is the mapping
  artifact) classifies every menu item as `rust-only` (no web dependency: reload, zoom, close,
  quit, open log folder, about) or `ui-dispatch` (New Session and the existing action inventory).
  v1 ships **only actions that exist** — the six `SHORTCUT_ACTIONS` ids; "Navigate to view" is
  dropped (no addressable action exists; main navigation is boolean view state, not hash-routed —
  the only hash route today is the plugins deep-link). **Menu liveness rule:** ui-dispatch items
  are disabled until the shell has both a `/health` liveness signal and a dispatch-readiness
  signal from the bridge; rust-only items always work. A menu item without a real action does not
  ship (PRODUCT.md principle 3).
- **Web → shell (human cue): the window title.** The web app gains a **title owner** (new work:
  a `setTitle` helper composing base name + machine-readable status suffix, reconciling the three
  currently-divergent title strings — the server template's static `<title>`, the Rust window
  builder's, and the served page). The suffix uses a **versioned machine-readable sentinel**
  prefix with the human text separate, composed under PRODUCT.md copy rules (counts and states
  only — approval-waiting count, running marker, ambiguous-step marker; never session content,
  never secrets). The Rust shell reads the title (it already can) and acts on it for the attention
  cue and notification triggers only — **the title is never the close guard** (see §2): a missed
  cue is harmless; a wrong guard is not. A web-side format guard test and a strict Rust parser
  (non-conforming titles parse as "unknown") enforce the contract.
- **Shell → server (machine): `/health` probes.** The shell already probes `/health` over
  loopback (auth-free by design, `src/server.ts:1045`); this design extends the response with
  `runsInFlight` and `pendingApprovals` counts (server-side projections already hold the state;
  same file B5 touches for `COGNATE_SHELL`). This is the **machine authority** for the close
  guard (§2) and the menu liveness rule above — fail-closed: probe failure or unknown state means
  "confirm" / "disable".
- **Standard web APIs** (`window.close()`, platform close paths) reach Tauri as `CloseRequested`
  without any grant; nothing in the web app uses them today, so this channel is a smoke-suite
  probe, not a dependency.

Guard: a CI test asserts the generated Tauri ACL grants nothing to the remote URL (the capability
manifest stays empty), and the smoke suite re-asserts it per platform.

Boundary rule (recorded in `docs/known-gaps.md`): shell-side affordances (menus, close confirm,
notifications, external links, window chrome) are **shell-local**, outside the Cognate capability
model — they exercise no server authority. Anything touching durable state or authority keeps
routing through governed capabilities exactly as today.

```
┌──────────────────────────── Tauri shell (Rust) ───────────────────────────┐
│  menu map ──► rust-only items (reload/zoom/close/quit/log/about)          │
│             └► ui-dispatch items (existing actions only; disabled until   │
│                /health liveness + bridge readiness) ──► window.eval ──►   │
│                window.__wbShell.dispatch                                  │
│  title reader (human cue only) ──► attention / notification triggers      │
│  /health prober (machine authority) ──► close guard, menu liveness        │
│  navigation handler ──► loopback stays in-app; other hosts → opener       │
│  sidecar lifecycle: port, health, watchdog(health), SIGTERM, 30s grace    │
└──────────────┬────────────────────────────────────────────────────────────┘
               │ spawns with PORT, COGNATE_NO_WINDOW=1, COGNATE_RESOURCE_DIR,
               │ COGNATE_SHELL=tauri@<version>          (no other env, no token)
┌──────────────▼────────────────────────────────────────────────────────────┐
│  Cognate server (Bun sidecar) — unchanged authority model                 │
│  /health (now reports shell identity + runsInFlight + pendingApprovals)   │
│  Connect RPC · same-origin WS · /app.js carries the boot token (unchanged)│
└───────────────────────────────────────────────────────────────────────────┘
```

### 2. Desktop contract

**Close/quit semantics — one decision, scoped by backend ownership.** Close = shell exit on all
platforms; no tray. On `CloseRequested` (handled in the `lib.rs` run-event path, where close
handling lives today):

- **Shell-owned backend** (the shell spawned it): probe `/health`. `runsInFlight > 0`, or
  `pendingApprovals > 0`, or the probe fails / state is unknown → a **native Rust-side
  confirmation** names what will stop ("A run is in flight. Quit and stop it?"). Fail-closed: a
  dead or wedged webview can never suppress the confirm, because the signal comes from the
  server, not the page. Confirmed → SIGTERM with the existing 30 s grace.
- **Reused backend** (attached via lock file — a CLI-`start`ed or `--app`-launched server under
  its own owner): the shell exits; the backend is untouched. Its owner governs its lifetime; the
  existing "a reused server keeps its owner" behavior is preserved and becomes the documented
  contract, not an accident.
- **macOS convention** (close-window ≠ quit) is deliberately not adopted: the shell-owned
  backend's owner is the shell process, and a backend that outlives its window recreates the
  orphaned-database class this project just fixed. Dock Quit takes the same path.

**The `--app` fallback surface.** Today the fallback's window exit unconditionally stops the
server (`src/cli.ts:192`, "app window closed") with no confirmation possible from browser chrome.
Decision: the fallback adopts a `beforeunload` confirmation **conditioned on
`COGNATE_SHELL=chromium-app`** (so it never double-confirms inside the Tauri webview), verified in
Chromium where the fallback actually runs; if it cannot be made reliable, the limitation is
recorded in `docs/known-gaps.md` instead. Either way the fallback never ships a silent close
claimed as confirmed — the surface's behavior is stated exactly as implemented.

**Attention when unfocused.** When the title sentinel shows a waiting marker while the window is
unfocused, the shell calls `request_user_attention` (taskbar flash on Windows, dock bounce on
macOS; on Linux it is a WM-dependent hint and may no-op — recorded per platform in the honesty
matrix). Rust-side, no plugin. This is the v1 attention cue.

**Notifications — summons-only, gated on evidence.** v1 ships the title cue. The notification
plugin ships only if the B4 attention cue proves insufficient for the approval-waiting path (the
gate and its owner are in Open Questions). When shipped: invoked **from Rust** via the plugin's
Rust API (no webview grant), triggered by title-sentinel transitions while unfocused, body text
**authored by the web app** under PRODUCT.md copy rules and passed through verbatim — the Rust
shell never composes or reformats notification text, and bodies derive only from parsed sentinel
fields (never the raw title string). Activation focuses the window and dispatches to the approval
card; no approve/deny actions and no "done" claims exist in the OS surface. Where no notification
daemon exists (WSLg, minimal WMs), the feature is off — the title cue and in-app state remain
canonical.

**External links.** A Rust-side navigation/new-window handler: loopback URLs stay in-app; every
other host opens in the system browser via the opener plugin's Rust API (no grant), http(s) only.
`markdown.ts` and the three `target="_blank"` usages are checked against this path; the shell
smoke includes an external-link probe.

**Downloads.** The Blob/`anchor.download` export path (`src/ui/download.ts`, backing the config
export) is expected to be dead in WebKitGTK (no embedder handler wired). It enters the
dispositions ledger; the shell-mediated fix if the disposition is FIX: Rust-side fetch of the
export URL plus save via the dialog plugin (registered in B4) — **not** a loopback server
endpoint, which rides the same webview and re-enters the bug. Otherwise REMOVE/DEFER with the
limitation recorded.

**Shortcuts — one source of truth.** The operator-editable shortcut table stays the single
registry, and **Ctrl+Alt+N remains the New Session default on every surface** — `RESERVED_EXACT`
(`src/shortcuts.ts:117`) exists precisely so the shortcut never lies on any supported surface, and
the `--app` fallback keeps that rule true. What changes is the reservation's scope, not the
default: inside the Tauri webview the reservation could be reopened per-surface, and the design
records that as unnecessary in v1 (no evidence the modifier chord hurts there). The menu map
carries **no domain accelerators** (labels only), so the table cannot diverge from the menus; the
"same conflict rules" contract is untouched and `validateChord` behavior is unchanged. The
`J-PREFS-shortcuts` test is unchanged — nothing about the table changes in v1.

**OS theme.** Already solved in the web layer (`useTheme` system mode + `prefers-color-scheme`,
durable setting). Remaining work is chrome-only: `color-scheme` set to `light` or `dark` from the
theme setting in `src/ui/app.css` (`:root` and theme blocks) so form controls and scrollbars
follow the theme, and per-platform window chrome theming from Rust where the platform supports
it. No second theme channel is created.

### 3. Lifecycle hardening (shell)

- **Startup budget:** first boot (pg0 initialization) and steady boot get distinct deadlines —
  budgets of 180 s first boot / 60 s steady, **to be measured during this tranche and recorded in
  the verification log, not assumed**; the wait surface shows elapsed time and the latest log
  phase instead of a silent poll.
- **Startup timeout is not a SIGKILL:** the timed-out sidecar gets SIGTERM with the same 30 s
  grace the shutdown path uses; only a wedged process is then killed; the error surface includes
  the sidecar's own stderr tail. On Windows, where no portable SIGTERM exists, the startup-timeout
  path hard-kills — recorded as a parallel qualification row ("forced kill qualifies orphan
  cleanup + restart recovery"), same honesty rule as the close path.
- **Watchdog:** the existing exit-watchdog gains a periodic `/health` probe (every 5 s) and
  covers **reused** backends: two consecutive failures (≈10 s) open the honest error surface —
  which states what happened, notes the lock file's owner, and offers relaunch; the wedged
  process is left to its owner unless shell-owned. The backend handle is registered before the
  health wait so an early quit always has a kill path.
- **Health parsing:** log the raw response body when the probe fails (new work — `probe_health`
  currently returns a bare bool). (`find_sidecar` host-triple matching is already implemented —
  commit `9b6bb21`, with unit tests; struck from the work list.)
- **Log discipline:** `desktop-shell.log` gets a size-capped rotation (5 MB cap, one rotated
  file retained); the Remote panel's existing diagnostics section (`src/ui/RemotePanel.tsx`)
  surfaces the log location.
- **Shell identity:** the shell passes `COGNATE_SHELL=tauri@<version>` (the `--app` fallback
  passes `chromium-app@<version>`); the server records it in `/health` and one boot log line,
  closing the "works in browser, dead in the app" triage class.
- **Windows shutdown honesty:** the graceful-termination attempt (close request → WM_CLOSE /
  `taskkill` without `/F` first) is attempted by the B5 implementer with a recorded artifact
  either way; the default disposition remains the honest record ("forced close qualifies orphan
  cleanup + restart recovery; clean shutdown is a platform limitation"). No shutdown-parity claim
  on Windows in either case.

### 4. Qualification: one harness, tiered surfaces

`scripts/qualify-tauri.sh` (+ `qualify-tauri-lib.sh`, following the `qualify-lib.sh` pattern) is
parameterized by **target**: a bundle path (install/extract) or a raw binary path +
`COGNATE_RESOURCE_DIR` (the debug-build mode the per-commit job uses). Platform-independent rows:
launch → parse the port from `desktop-shell.log` → `/health` poll → close → assert sidecar exit +
pg0 stopped + lock released → relaunch → assert **clean respawn and lock re-created** → close.
Gated rows, enabled by the tranche that implements them: shell-identity marker (B5),
close-guard rows — kill the web app mid-run and assert the shell still confirms; close on a
reused backend and assert it survives (B4), dispatch round-trip + external-link probe (B3/B4),
second-instance focus check (B2, from the original brief). **Coexistence/uninstall pass:**
install the shell deb and the standalone deb together, verify both binaries and entries exist,
uninstall one, verify the other survives and no data home is orphaned. The zero-IPC guard and the
harness itself run everywhere.

- **T1 (every platform, RC-gated):** the harness above against the platform bundle
  (deb, NSIS, app+dmg); per-commit on Linux against the debug binary.
- **T2 (every platform):** the existing Chromium journey suite pointed at the *packaged sidecar*
  binary with its staged resources — proving the shipped backend and UI, not the dev server.
  Mechanism (new, B2): a `COGNATE_TEST_SIDECAR=<path>` mode in `test/helpers.ts` that spawns the
  binary and polls `/health` instead of calling `startServer` in-process.
- **T3 (where honestly feasible):** Windows — WebView2 CDP smoke; Linux — xvfb + WebKitGTK DOM
  checks; macOS — a scripted manual checklist with committed evidence. Playwright cannot drive
  WKWebView or WebKitGTK; `tauri-driver` (WebDriver via WebKitWebDriver/msedgedriver) is recorded
  as the considered standard alternative and rejected for v1 — WebDriver against a remote-URL
  webview carries its own setup cost and the T1/T2 rows already cover the contract. Claims name
  the engine they were verified on (the repo's platform-honesty rule).

CI shape: `verify.yml` gains a per-commit Linux Tauri job (fmt, clippy, cargo test, debug build —
**the smoke step lands in B2 when the harness exists**); the five-platform Tauri matrix (build +
bundle + T1 + T2) runs on release candidates and tags with runners **macos-15** (Apple Silicon —
an upgrade from package.yml's macos-14, per the owner's platform table), macos-15-intel,
ubuntu-22.04, ubuntu-22.04-arm, windows-2022. The DomainForge binding build is extracted into a
composite action shared by both workflows; the verify.yml domainforge pin (0.21.1 vs 0.21.2) is
aligned in the same tranche. AppImage: **removed from `bundle.targets`** in B5, with the
linuxdeploy/FUSE failure recorded in known-gaps — the deb covers both Linux arches.

### 5. Defect closure: ledger first, batches per panel, guard last

The **dispositions ledger** (`.agents/plans/desktop-native-completion/dispositions-ledger.md`) is
produced before any fix code. Its inputs: the reconciled open A2 row set from `.agents/DEBT.md`
(D-9, D-12, D-13, D-15–D-19, D-21, D-22, D-24–D-30, D-34), every native `<select>` with file:line
(42 across 9 files — the reconciled count this ledger owns), **the downloads affordance**,
**drag-and-drop**, session Pin, and the remote diagnostics gap. Each row carries a disposition —
FIX / REDESIGN / DEFER / REMOVE / KEEP-NATIVE for defect rows, BUILD for feature rows — and an
**evidence class**: one of `audit-row` (the A2 row it resolves), `code-citation` (path:symbol
observed), `measurement` (a recorded number), or `journey` (a named test that will prove the
fix). The reconciled inventory replaces "~35" in DEBT.md.

MenuSelect carries an accessibility gate before any conversion (screen-reader value announcement
and the full keyboard contract, proven in a new `test/ui-menu-select.test.tsx`) because the native
select renders in the OS with the platform's keyboard and screen-reader support and needs no
custom ARIA to announce its value — properties a custom control must match before conversion.
**KEEP-NATIVE is a first-class disposition** with a recorded rationale. Conversion batches run
per panel — ContractEditor (13, may split), ExpertsTeamsPanel (8), AutomationPanel (6),
SchedulesPanel (5), then the five-file tail — each batch shipping its E2E updates in the same
change. **The three real `selectOption` files are `test/E2E-experts.test.ts`,
`test/E2E-experts-debt.test.ts`, and `test/E2E-workbench.test.ts`**; the automation and contract
panels have no select-driving E2E today, so their conversions **add** coverage per the ledger
instead of updating it. A mechanical guard test ends the track: no `<select` outside
`MenuSelect.tsx` without a ledger-recorded exception. The suite's known flakes (font-route
blocking, concurrency cap — both sized S in DEBT.md) land before the batches so a red suite means
a real regression. Sequencing note: the bridge and title-manager live in new files (B3), and D's
`App.tsx` batches run after B3 merges — one rewrite surface at a time.

Session Pin and durable remote diagnostics are **features** and follow the model-first rule.
**Session Pin: a session row-menu action that pins the session to the top of the sidebar list,
independent of sort order, durable across restarts — realizing the pin half of donor-parity row
D-23** (the donor menu's pin/rename/copy-path/delete; rename, copy path, and archive already
exist). Tranche: `J-SESSION-pin` journey validated first; then capability + event +
reducer/projection + row-menu entry in one commit. Remote diagnostics: a bounded
`workbench.remote.*` event family folded into the existing workbench projection, rendered by the
Remote panel — transitions only (state changes, pairing, errors), never the 2 s/5 s polls. If
their ledger rows return DEFER instead of BUILD, the recorded decision governs and the designs
here lapse. Drag-and-drop, if its ledger row returns BUILD: HTML5 DnD calling the existing
governed workspace capabilities with its own `.sea` journey; drops originating from a remote
(SSH/WSL) session fall back to the typed path.

### 6. Jetson qualification runbook

A committed runbook (operator-executed; the device stays read-only to this effort until the
operator acts): prerequisites the operator authorizes (`libwebkit2gtk-4.1-0` via
`apt install ./<shell-deb>.deb` dependency resolution — the exact artifact name decided in §4's
package identity), then the T1 harness against the arm64 deb produced by CI, including the
compositing check (the window renders a known UI frame under the device's actual
compositor/session, verified by the operator's screenshot); if the WebKitGTK DMABUF renderer
misbehaves on the NVIDIA driver, `WEBKIT_DISABLE_DMABUF_RENDERER=1` is recorded as a supported
configuration, not a surprise. Evidence (environment fingerprint: JetPack/L4T version, WebKitGTK
version, session type, compositor; command log; screenshot) lands in the verification log. The
MSRV gate is a CI job step (`cargo build` of `src-tauri` under Rust 1.95 — a real compile, not a
check) running before the runbook promises the build works there. The Jetson is never a CI
platform; a red Jetson run is a release blocker for the Jetson target only.

### 7. Milestones and tranches

- **A — Recovery & architecture (this document's process).** Drift report
  (`2026-11-06_DRIFT_REPORT.md`, this directory) ✅; six-lens brainstorm brief ✅; this design ✅
  (reviewed by five EGM stages; findings resolved); owner approval → **A1** doc-recovery tranche
  (CURRENT_STATUS reconcile, src-tauri README, src/README, three EGM — Elephant–Goldfish Model —
  contract READMEs, architecture.md corrections, DESIGN.md tokens-reference correction) and
  **A3** the dispositions ledger.
- **B — Desktop foundation.** **B1** CI scaffold (composite action; `tauri-linux` job with
  fmt/clippy/test + debug build; pin alignment) → **B2** smoke harness + T2 sidecar mode + guards
  → **B3** seam protocol (`__wbShell` bridge, menu map v1, title owner + sentinel, zero-IPC
  guard) → **B4** desktop contract (fail-closed close-confirm, attention, links, downloads
  disposition, per-surface shortcuts untouched, color-scheme chrome) → **B5** lifecycle hardening
  (startup budgets, watchdog, rotation, package identity, AppImage removal).
- **C — Native UX convergence (against B's outcomes).** Per-platform menu conventions verified
  and divergences corrected; notifications only if the Open Questions gate fires; per-platform
  chrome polish; the desktop-contract acceptance rows (adopted from
  `.agents/plans/desktop-terminal-browser/acceptance-matrix.md`) verified on WSLg and recorded
  per platform — verified where the engine permits, `implemented-per-docs` otherwise.
- **D — Functional & debt closure (parallel track, starts after the ledger).** Per-panel select
  batches + A2-row fixes; Pin; remote diagnostics; flake remediations first.
- **E — Release qualification.** **E1** five-platform Tauri matrix run (T1+T2 everywhere, T3
  where feasible) → **E2** Jetson runbook execution → **E3** final report + status revision.
  **Scope statement (owner decision):** the D track stays in this mission; E3 may close when the
  desktop qualification is complete, with any unfinished D rows carried as recorded debt — the
  desktop release does not wait on the full defect track.

Critical path: A → B1 → B2 → B3 → B4/B5 → E1; C and D are parallelizable against B's outcomes;
E2 hangs off E1's arm64 artifact with an explicit blocked state, never silently.

## Risks & Mitigations

| Risk | Mitigation | Owner |
|---|---|---|
| Close guard confirms too often (fail-closed friction) | Thresholds tuned against `/health` counts; T1 rows assert both directions (in-flight → confirm; idle → close) | B4 |
| Title channel fragile or spoofed | Sentinel + strict parser (non-conforming = unknown); title carries counts/states only, enforced by format guard test; title is cue-only — a wrong title can never authorize a close | B3 |
| Downloads dead in the packaged shell | Ledger disposition with the shell-mediated save; verify row in the harness | B4/D |
| Deb package-name collision (shell vs standalone) | Distinct identity decided in §4; coexistence/uninstall pass in the harness | B5 |
| MenuSelect a11y gate fails mid-conversion | Gate lands before any conversion; KEEP-NATIVE disposition absorbs a failure without violating WCAG 2.2 AA | D |
| Startup deadlines wrong | Measured during B5 and recorded; budgets adjusted on evidence | B5 |
| WebKitGTK version skew; NVIDIA DMABUF failures on Jetson | Minimum version recorded; DMABUF fallback documented as supported; engine named per claim | E2 |
| Windows forced close / forced startup kill | Honest qualification rows; graceful attempt priced once with a recorded artifact | B5/E1 |
| Watchdog recovery leaves a wedged backend | Recovery behavior specified (§3): surface, owner note, relaunch offer | B5 |
| Notifications absent where no daemon exists | Feature off; title cue + in-app state canonical | C |
| CI matrix cost explodes | Tiered T1/T2/T3; full matrix RC-gated; per-commit Linux-only shell job | B1/E1 |
| Parallel work collides in `App.tsx` (6,183 lines) | Bridge/title-manager in new files; D batches sequenced after B3; per-panel commits | B3/D |

## Open Questions

| # | Question | Deciding authority & trigger |
|---|---|---|
| OQ1 | Ship the notification plugin (v2) or stay with the title cue? | The operator, after B4 ships: the trigger is the title cue proving insufficient for the approval-waiting path in the operator's own use. |
| OQ2 | Adopt the Windows graceful-shutdown mechanism or record the limitation? | The B5 implementer, one bounded attempt during B5; the verification log records the outcome either way; the default is the honest record. |
| OQ3 | Close behavior at OS session end (logout/restart/shutdown) per platform? | The T3/manual checklist: one row per platform — confirm suppressed and loss recorded, or confirm attempted; blocking at session end is a hazard to avoid. |
| OQ4 | D-track scope (in-mission vs split) | Decided by the owner 2026-11-06: in-mission; E3 closes on desktop qualification with D rows carried (see §7-E). |

## Acceptance Criteria

| Goal | Checkable criterion | Verified by |
|---|---|---|
| G1 | T1 rows: kill web app mid-run → shell confirms; close on reused backend → backend survives; idle close → no confirm | `qualify-tauri.sh` per platform |
| G2 | 5/5 matrix jobs green (T1+T2) on the RC tag | `tauri.yml` run |
| G3 | `just tauri-guards` green; bridge protocol tests green | CI + `just` recipe |
| G4 | Menu-map cargo tests green (every item has a channel and a real target); external-link probe passes; shortcuts table unchanged and green | CI + harness |
| G5 | Ledger 100% dispositioned; `test/native-select-guard.test.ts` green; `UI_SHOTS_CONTRAST=1` clean on re-captured shots | CI + screenshots |
| G6 | `J-SESSION-pin` and the remote-diagnostics journey green — or their known-gaps rows recorded | `bun test` |
| G7 | Honesty matrix carries the notification row; no authority action exists in any OS surface (test asserts the notification payload) | harness + test |
| G8 | Jetson runbook executed with evidence and environment fingerprint — or an explicit blocked state recorded as the Jetson-target release blocker | verification log |
| G9 | Drift re-run clean on every doc touched in A1; the three contract READMEs exist | drift pass |

## Alternatives Considered

1. **Selective Tauri capability grants to the loopback URL** (rich web↔shell IPC: plugins' JS APIs
   exposed to the webview). Rejected: the largest possible security-posture change available;
   contradicts the shell's documented promise; every new feature re-litigates a security decision
   and scatters grants across the codebase. Rust-side plugin invocation achieves the same features
   with no grant.

2. **A shell-authenticated server channel** (shell token issued at spawn; or a third same-origin
   WebSocket surface for shell consumption). Rejected for v1: a new auth surface and actor concept
   in a codebase that just completed an adversarial security review; the web app already receives
   every event the shell could need, and `/health` extension covers the shell's machine needs.
   Revisit only when a shell-side feature genuinely cannot ride these channels, with its own
   `.sea` journey and threat review.

3. **Static Rust-side menu accelerators.** Rejected: creates a second, non-editable shortcut
   source of truth that diverges per platform and from the operator-editable shortcut table —
   exactly the "control that lies" failure PRODUCT.md forbids. Menus carry labels; the table stays
   authoritative.

4. **Rust-side notification/event tap** (shell subscribes to StreamEvents). Rejected: duplicates
   protocol knowledge in a second language, needs an auth story, and re-derives state the web app
   already holds. The title-sentinel trigger is coarse but the failure mode is harmless (a missed
   cue), unlike a wrong close guard.

5. **Native file dialogs app-wide.** Rejected: the server-side directory picker is journey-tested,
   world-aware (SSH/WSL/contained), symlink-conservative, and identical across browser/CLI/shell
   surfaces. Native dialogs fork UX for one world only, resist E2E, and add portal dependencies.
   At most a first-run local "Browse…" may be considered through the ledger if the typed path is
   the friction point; the default stays the picker.

6. **tauri-plugin drag events.** Rejected: delivered through an IPC grant (posture change). HTML5
   drag-and-drop works in WebKit without any grant and pairs with the existing governed workspace
   capabilities.

7. **Per-commit five-platform packaged journey tests.** Rejected: not honestly achievable for
   webview apps in CI (Playwright cannot drive WKWebView/WebKitGTK; WebView2 CDP is Windows-only),
   and the flake-prone suite under five more platform dimensions would drown real regressions.
   Tiered T1/T2/T3 with the five-platform matrix gated to release candidates gives deeper evidence
   per claim and names the verifying engine per platform.

8. **AppImage as a primary Linux artifact.** Rejected: bundling already fails on
   linuxdeploy/WSL2-FUSE (recorded), needs FUSE handling on CI, and duplicates deb coverage for
   both Linux arches. Removed from `bundle.targets`; the deb is the Linux artifact, x86-64 and
   arm64.

9. **Windows graceful shutdown via WM_CLOSE / taskkill-without-/F.** Retained as Open Question
   OQ2; the default disposition is the honest record ("forced close qualifies orphan cleanup +
   restart recovery; clean shutdown is a platform limitation") unless the bounded attempt produces
   a robust mechanism. Either way, no shutdown-parity claim on Windows.

10. **macOS close-window ≠ quit (platform convention).** Rejected deliberately: the shell-owned
    backend's owner is the shell process; a backend that outlives its window recreates the
    orphaned-database class this project just fixed. Close = exit on all platforms, with the
    fail-closed confirmation as the operator's protection. Recorded as a product decision, not an
    oversight.

11. **Chromium `--app` removal.** Rejected: it stays the CLI fallback (`cognate-workbench launch`
    without Tauri installed) and its launch journey is the regression harness for the fallback
    surface.

12. **Keep native `<select>` everywhere (accessibility-first blanket).** Considered seriously: the
    native select renders in the OS with platform keyboard and screen-reader support and needs no
    custom ARIA. Rejected as a blanket rule because the A2 audit found the inconsistency itself a
    defect (same control, two visual languages), but the disposition ledger keeps **keep-native as
    a first-class outcome** per control, gated on the MenuSelect a11y pass — conversion is
    per-panel and reversible, not ideological.

13. **Do nothing more to the shell (ship the current Linux-verified state).** Rejected: it fails
    the operator on the close contract, ships dead external links, has no platform evidence beyond
    Linux, and leaves the defect ledger unadjudicated — the exact gap this effort exists to close.

14. **Title-marker heartbeat as the close guard** (confirm unless a recent idle marker arrived).
    Considered as the Stage-7 fix for the fail-open guard; rejected in Stage 8: it turns a
    state-driven human string into a liveness protocol (rewrite timer, recency window, versioned
    sentinel, collision rules) — hand-rolled IPC over a display string, the exact class
    Alternatives 1–2 reject. `/health` is the machine authority; the title stays a cue.

15. **tauri-driver (WebDriver) for T3 engine checks.** Considered as the standard Tauri testing
    tool; rejected for v1 — WebDriver against a remote-URL webview carries setup cost per engine,
    and T1/T2 already cover the shell contract; revisited only if T3 needs deeper DOM assertions
    than the xvfb checks provide.

## Detailed Implementation

Every row names its target and its change. Verification commands per tranche follow the repo's
existing gates: `bun run typecheck`, targeted `bun test`, `just smoke` before milestones,
`just verify` at milestone boundaries, `cargo fmt --check`/`clippy`/`test` in `src-tauri/`,
`domainforge validate` + `fmt --check` for any `.sea` change, and `scripts/qualify-tauri.sh` for
packaged tranches. Model-first rule: any capability-touching tranche lands its `.sea` journey
first, validated, before code. Each tranche's done-state is its "Proves" line.

### A — Recovery, plan, ledger (docs-only) — *Proves: drift re-run clean on every touched doc*

| Target | Change |
|---|---|
| `CURRENT_STATUS.md` + `.agents/CURRENT_STATUS.jsonl` | Revision 40: reconcile revs 37–39 into the markdown (the markdown sits at 36, the ledger at 39); record this mission's start. Revision 41 lands at E3. |
| `src-tauri/README.md` | Fix the stale 10 s shutdown-grace text (actual: 30 s + 45 s failsafe); add the posture budget rule, the close/quit semantics per §2, and the title-sentinel constraints. |
| `src/README.md` | Correct component/projection counts; add terminal/browser/preview subsystem map entries. |
| `src/terminal/README.md`, `src/browser/README.md`, `src/preview/README.md` | New EGM-compliant contract READMEs (Overview/Interface/Invariants/Side Effects/Verification), per the revision-34 bootstrap convention. |
| `.agents/plans/desktop-terminal-browser/architecture.md` | Correct stale baseline claims: `WORKBENCH_EVENTS` count (code has 38 today; post-Pin/remote-diagnostics it moves when D lands — the doc states the current count and the tranche that moves it), App.tsx size, "attaches a second window" → the implemented single-instance focus behavior. |
| `DESIGN.md` | Correct the stale `src/ui/tokens.css` reference (tokens live in `src/ui/app.css`; no tokens file exists). |
| `docs/known-gaps.md` | New rows: shell-local-affordance boundary rule; Windows shutdown limitation (close + startup-timeout paths); title-sentinel constraints; Jetson prerequisite status; AppImage removal record; `--app` fallback close behavior (per §2's outcome). |
| `.agents/DEBT.md` | Update the select count (~35 → 42 across 9 files per the ledger), annotate rows as the ledger adjudicates them. |
| `.agents/plans/desktop-native-completion/dispositions-ledger.md` | New: the reconciled A2 row set, all 42 selects (file:line), the downloads affordance, drag-and-drop, Pin, remote diagnostics — each with FIX/REDESIGN/DEFER/REMOVE/KEEP-NATIVE (BUILD for features) + evidence class. |
| `.agents/plans/desktop-native-completion/plan.md`, `verification.md` | New mission tranche table and append-only verification log (the desktop-terminal-browser format). |

### B1 — CI scaffold — *Proves: `tauri-linux` CI job green (build + gates only; smoke lands in B2)*

| Target | Change |
|---|---|
| `.github/actions/domainforge-binding/action.yml` | New composite action extracting the existing per-platform napi binding build from `package.yml` (clone pinned tag, cargo build, install beside the JS loader). |
| `.github/workflows/package.yml` | Consume the composite action; otherwise unchanged (working infrastructure is not rewritten). |
| `.github/workflows/verify.yml` | Align the domainforge pin to 0.21.2 (the justfile's version); add a per-commit `tauri-linux` job: bun + Rust setup, `libwebkit2gtk-4.1-dev` install, `cargo fmt --check` + `clippy` + `test` in `src-tauri/`, debug `tauri build`. The xvfb smoke step is added in B2 when the harness exists. |
| `.github/workflows/tauri.yml` | New: five-platform matrix (macos-15 for darwin-arm64 — an upgrade from package.yml's macos-14 per the owner's platform table — macos-15-intel, ubuntu-22.04, ubuntu-22.04-arm, windows-2022), dispatch/tag-gated; per job: composite binding action, `bun scripts/tauri-sidecar.ts <target>`, release `tauri build` (deb / nsis / app+dmg), T1 harness, T2 journey suite via the sidecar mode, artifacts + checksums uploaded. Includes the MSRV job (`cargo build` of src-tauri under Rust 1.95) gating the Jetson claim. |

### B2 — Packaged smoke harness + guards — *Proves: harness green on Linux (debug binary + deb); guards green; T2 sidecar mode green*

| Target | Change |
|---|---|
| `scripts/qualify-tauri.sh` (+ `qualify-tauri-lib.sh`) | New parameterized harness (bundle path or raw binary + `COGNATE_RESOURCE_DIR`; optional xvfb; port base): platform-independent rows per §4; gated rows enabled by their owning tranches (§4); coexistence/uninstall pass; zero-IPC guard. |
| `test/helpers.ts` | New `COGNATE_TEST_SIDECAR=<path>` mode: spawn the packaged binary, poll `/health`, point the client at it — T2's mechanism. |
| `justfile` | `tauri-smoke` recipe wrapping the harness; `tauri-guards` recipe asserting no `src-tauri/capabilities/*.json` and no web-invoked grants in the generated ACL. |
| `test/J-DESKTOP-launch.test.ts` | Unchanged (it guards the `--app` fallback and must stay green). |

### B3 — Seam protocol — *Proves: protocol conformance tests green; menu map v1 (existing actions only) shipped; zero-IPC guard green; title owner + sentinel format test green*

| Target | Change |
|---|---|
| `src/ui/shell/desktopBridge.ts` | New: registers `window.__wbShell` with a typed dispatch (action id + args), routed to the existing action-handler inventory; no-op in browser/CLI contexts; emits the bridge-readiness signal the menu liveness rule consumes. |
| `src/ui/titleStatus.ts` | New title owner: composes base name + versioned sentinel suffix per PRODUCT.md copy rules; reconciles the three existing title strings (server template, Rust builder, served page); format guard lives in its test. |
| `src/server.ts` | Reconcile the static `<title>` template to the same base name (one string everywhere). |
| `src/ui/App.tsx` | Wire the bridge to the existing handlers; drive the title owner from the existing state (approval-waiting count, running marker, ambiguous-step marker). |
| `src-tauri/src/lib.rs` + new `src-tauri/src/menu.rs` | Extract the menu into the committed menu map (item → rust-only or ui-dispatch → existing action id; "Navigate to view" dropped); ui-dispatch items disabled until `/health` liveness + bridge readiness; `handle_menu_event` dispatches through the documented eval protocol. |
| `test/ui-desktop-bridge.test.tsx` | New: protocol conformance, unknown-action refusal, browser no-op, liveness disable behavior. |
| `test/ui-title-status.test.tsx` | New: sentinel format, collision priority, content-exclusion constraint. |
| `src-tauri` cargo tests | Menu-map classification (every item has a channel and a real target); sentinel parser accepts conforming titles and treats all others as unknown. |

### B4 — Desktop contract — *Proves: fail-closed close-confirm verified (webview killed mid-run → confirm; reused close → backend survives; idle → close); attention + external-link probes pass; downloads dispositioned; theme chrome lands*

| Target | Change |
|---|---|
| `src-tauri/src/lib.rs` | `CloseRequested` handling in the run-event path (where close handling lives): probe `/health` of the shell-owned backend — in-flight, pending approvals, or probe failure/unknown → native Rust-side confirmation (dialog plugin from Rust, no grant); confirmed → exit. Reused backend → exit without touching it. Title watcher (unfocused + sentinel → `request_user_attention`); navigation/new-window handler (loopback in-app; other hosts → opener plugin Rust API, http(s) only); register opener + dialog plugins Rust-side. |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-opener`, `tauri-plugin-dialog` (Rust-invoked only). |
| `src/ui/download.ts` disposition | Ledger row executed: FIX → Rust-mediated export (fetch + dialog save via a menu/keyboard affordance), or REMOVE/DEFER with the known-gaps row. |
| `src/ui/markdown.ts` | Normalize external links (explicit external targets) so the shell's handler and browser behavior agree. |
| `src/cli.ts` (`--app` path) | `beforeunload` confirmation in the fallback entry, conditioned on `COGNATE_SHELL=chromium-app`; verified in Chromium; else the known-gaps row records the limitation. |
| `src/ui/app.css` | `color-scheme` set to `light` or `dark` from the theme setting on the existing `:root`/theme blocks (no token changes; `tokens.css` does not exist). |
| `docs/known-gaps.md` | The `--app` close outcome recorded per §2. |

### B5 — Lifecycle hardening — *Proves: startup budgets measured and recorded; watchdog rows verified (incl. reused-backend death → error surface); rotation capped; package identity distinct; AppImage target removed*

| Target | Change |
|---|---|
| `src-tauri/src/backend.rs` | First-boot vs steady startup budgets (180 s / 60 s, measured during this tranche and recorded); progress surface with elapsed + log phase; startup timeout → SIGTERM with 30 s grace before kill, stderr tail in the error surface (Windows: hard-kill row recorded); watchdog gains the 5 s `/health` probe, two-failure threshold, reused-backend coverage, and the §3 recovery behavior (surface + owner note + relaunch offer); handle registered before the health wait; `desktop-shell.log` rotation (5 MB cap, one rotated file); raw health body logged on probe failure. |
| `src-tauri/src/lib.rs` | Register the watchdog `/health` timer, the title watcher, and the startup-progress emitter on the boot path (implements the §3 rows above). |
| `src/server.ts` | Read `COGNATE_SHELL` (`kind@version`), include it in `/health` and one boot log line; extend `/health` with `runsInFlight` and `pendingApprovals` counts (the close guard's machine inputs). |
| `src/desktopWindow.ts` | Pass `COGNATE_SHELL=chromium-app@<version>` for the fallback path (the single exception to the untouched CLI surface). |
| `src-tauri/tauri.conf.json` + `scripts/tauri-sidecar.ts` | Distinct desktop package identity: the shell deb's name decided at implementation from the productName-derived default, verified distinct from the standalone deb's `cognate-workbench` (if the derived name collides, productName becomes the knob and the binary/window/desktop-entry ripples are stated); version sourced from `package.json` via a build-time config override; remove `appimage` from `bundle.targets`; the harness coexistence/uninstall pass uses the concrete names. |
| `docs/jetson-qualification.md` (drafted here, executed in E2) | The runbook skeleton with the concrete deb name and prerequisites. |

### D — Parallel defect track (starts after the ledger) — *Proves: each batch lands with its E2E delta and the suite green; guard test green; Pin + diagnostics journeys green (or their DEFER rows recorded)*

| Target | Change |
|---|---|
| `test/helpers.ts` (+ the E2E files' browser-context setup) | Flake remediation: route-block web fonts in E2E contexts (DEBT closure, size S). |
| `package.json` (`test` script) | Concurrency cap for constrained hosts (DEBT closure, size S). |
| `src/ui/shell/MenuSelect.tsx` + `test/ui-menu-select.test.tsx` (New) | Accessibility gate: screen-reader value announcement, full keyboard contract — before any conversion. |
| `src/ui/workbench/ContractEditor.tsx` (13), `src/ui/experts/ExpertsTeamsPanel.tsx` (8), `src/ui/workbench/AutomationPanel.tsx` (6), `src/ui/experts/SchedulesPanel.tsx` (5), `src/ui/workbench/Workbench.tsx` (3, D-28), `src/ui/workbench/LedgerPanel.tsx` (3), `src/ui/experts/ExpertEditor.tsx` (2), `src/ui/AmbiguousStepCard.tsx` (1), `src/ui/workbench/CheckoutChip.tsx` (1) | Per-panel select conversion per the ledger dispositions (largest panel first; ContractEditor may split). |
| `test/E2E-experts.test.ts`, `test/E2E-experts-debt.test.ts`, `test/E2E-workbench.test.ts` | The three files that drive `selectOption` today — updated in the same commits as their panel conversions. The automation and contract panels have no select-driving E2E today; their conversions add coverage per the ledger. |
| `test/native-select-guard.test.ts` (New) | Mechanical guard: no `<select` outside `MenuSelect.tsx` without a ledger-recorded exception. |
| D-series fixes | The FIX dispositions the ledger records for the reconciled open rows; one commit per row, each re-capturing its screenshot and naming its test. Targets per A2: `src/ui/App.tsx` (D-9 header, D-13 tabs/stray icon, D-15 quote typography, D-17 disabled contrast, D-19 label style, D-24 badges, D-25 turn counter, D-26 toolbar collapse, D-29 dark Cancel border, D-22 status copy surfacing the current step), `src/ui/models/ProviderWizard.tsx` (D-12 footer, D-16 card clamp), `src/ui/GovernancePane.tsx` (D-18), `src/components/modelProvider.ts` (D-21 redesign — render once per group), `src/ui/DirectoryField.tsx` (D-27), `src/ui/inspector/ConfigTab.tsx` (D-30), `src/ui/models/ModelPicker.tsx` (D-34). |
| Pin feature: `.sea/interaction/interaction-model.sea`, `domain/index.ts`, `src/workbench/types.ts`, `src/workbench/reducer.ts`, `src/workbench/state.ts`, `src/projections/sessions.ts`, `src/capabilities/workbench.ts`, `src/server.ts` (GRANTED_CAPABILITIES + binding), `src/ui/App.tsx` (row menu), `test/J-SESSION-pin.test.ts` (New) | Model-first: `J-SESSION-pin` journey validated first; then capability + event + projection + row-menu entry (behavior per §5's definition) in one tranche. |
| Remote diagnostics: `.sea` model journey, `src/workbench/types.ts` (`workbench.remote.*` bounded family), reducer/projection, `src/remote/*` (inject the stop-recorder into the existing remote clients), `src/ui/RemotePanel.tsx` (render the folded events), journey test (New) | Bounded transition events only (state changes, pairing, errors) — never the 2 s/5 s polls. |
| Drag-and-drop (only if its ledger row returns BUILD): the Add-workspace dialog, `.sea` journey | HTML5 DnD calling the existing governed workspace capabilities; drops from a remote (SSH/WSL) session fall back to the typed path. |

### C — Native UX convergence (against B's outcomes) — *Proves: per-platform menu conventions verified with divergences corrected; notification gate decided and recorded; adopted acceptance rows recorded per platform*

| Target | Change |
|---|---|
| `src-tauri/src/lib.rs` + `menu.rs` | Verify the committed menu map per platform (macOS app menu shape, About placement); correct divergences found. |
| `src-tauri/Cargo.toml` + `src-tauri/src/*` | Notifications only if the OQ1 gate fires: notification plugin from Rust, title-sentinel triggers, web-app-authored body passed verbatim (bodies from parsed fields only), activation → focus + ui-dispatch deep link; disabled where no daemon answers. |
| `src-tauri/src/lib.rs` | Window chrome theming per platform (dark titlebar where supported). |
| `.agents/plans/desktop-native-completion/verification.md` | The adopted desktop-contract rows from `.agents/plans/desktop-terminal-browser/acceptance-matrix.md` verified per platform where the engine permits; `implemented-per-docs` otherwise. |

### E — Release qualification — *Proves: 5/5 matrix green; Jetson evidence (or explicit blocked state); report + revision 41 landed*

| Target | Change |
|---|---|
| `.github/workflows/tauri.yml` | Final shape: five-platform T1+T2 (+T3 where feasible: WebView2 CDP on Windows, xvfb WebKitGTK DOM checks on Linux), artifacts + SHA256SUMS, no signing (recorded). |
| `docs/jetson-qualification.md` | Executed runbook: operator-authorized prerequisites, T1 harness execution, DMABUF fallback documented as a supported configuration, environment fingerprint + evidence format, explicit "red = Jetson-target release blocker" rule. |
| `.agents/reports/desktop-native-completion/REPORT.md` + `evidence/` (New) | Final report: platform-honesty matrix (per platform × per feature: CI-proven / host-verified / implemented-per-docs), artifact checksums, limitations, EGM reconciliation note. |
| `scripts/ui-shots.ts` re-run | Re-captured screenshots for every touched UI, with the contrast audit (`UI_SHOTS_CONTRAST=1`) clean. |
| `CURRENT_STATUS.md` / `.agents/CURRENT_STATUS.jsonl` / `DEBT.md` / `docs/known-gaps.md` | Revision 41; ledger rows closed or carried; gaps updated. |
| EGM closure | Post-implementation drift report against this design + independent verification pass. |

### Explicitly not touched

`src/store.ts` persistence model; the Cognate SDK dependency boundary (`@godspeedai/cognate-*`
0.8.0 pins); `.sea/interaction/interaction-model.sea` semantic IDs (only additive journeys: Pin,
remote diagnostics, optionally DnD); the standalone packaging pipeline (`scripts/package.ts`,
`scripts/installers.ts`, the existing `qualify-*.sh` scripts — the new `qualify-tauri*` harness is
in scope per B2); the CLI command surface (`src/cli.ts` commands; the `--app` launcher's
shell-identity env in `src/desktopWindow.ts` is the single exception, per B4/B5); the
mobile/phone entry (the mobile remote-control surface, `docs/REMOTE.md`).
