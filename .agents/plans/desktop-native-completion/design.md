# Design — Desktop-native completion of Cognate Workbench

Draft built from `.agents/plans/desktop-native-completion/concepts_brief.md` (six-lens Goldfish
brainstorm, 2026-11-06). Sections are appended as they are approved.

## The Problem

Cognate Workbench is an operator's cockpit for accountable agent work: the operator declares what a
task may do, watches the work happen, grants or refuses consequential actions, and settles results
on evidence. That job happens at a desk, for hours, while something consequential is in flight
(PRODUCT.md). The application already does the accountable part well. What it does not yet do is
behave like desktop software on the machine it runs on.

Three things are wrong, in order of weight:

1. **The shell's lifecycle can destroy work silently.** Closing the window stops the backend, the
   bundled database, and every in-flight agent run, with no confirmation and no cue when the window
   is unfocused. On macOS this collides with the platform convention that closing a window is not
   quitting the application. For a product whose user is supervising consequential work, this is
   the single worst failure a desktop shell can have — and it is verified, shipped behavior today.

2. **The shell is deaf and mute by design, and half the planned native integration presumed it was
   not.** The webview is deliberately a zero-IPC remote context (no web content can call a shell
   API). That is the right security posture, but it means native menu actions cannot reach the app,
   external links do nothing, and there is no attention path when the operator is needed. The
   previous plan listed these features without naming the channel problem they all share.

3. **The remaining product surface is honest but unfinished, and unproven where it matters.** The
   A2 audit left open rows (D-9 … D-34) plus 42–43 native `<select>` controls that clash with the
   design system, no session Pin, and remote diagnostics that evaporate on restart. CI builds the
   standalone server packages for five platforms but has never compiled or exercised the Tauri
   shell; the one device the operator actually owns (Jetson AGX Orin) has never run it.

The consequence of stopping here: a product that works but does not feel like an application —
browser panels in a native frame, one accidental keystroke from losing an agent run, shipping on
five platforms on the strength of a build succeeding.

## Overview

This design completes the Tauri 2 desktop shell as the primary Cognate Workbench surface and
converges the product to a finished, cohesive desktop application. It does not redesign the
product, replace the architecture, or chase donor features: the capability/event/authority model,
the Cobalt design system, and the CLI + browser-access surfaces are preserved as-is.

The design rests on four decisions (each argued in Alternatives Considered):

1. **One seam, zero grants.** All web↔shell traffic rides the two mechanisms that already exist
   without any Tauri capability grant — host-side script dispatch into the app's own action
   handlers, and same-origin hash-route navigation. The zero-IPC posture is preserved and guarded
   by a test.
2. **A desktop contract instead of a chrome list.** Close/quit semantics per platform, in-flight
   work protection, an attention cue, working external links, and one shortcut source of truth —
   these, not a longer list of integrations, are what make it native.
3. **Dispositions before code.** Every remaining defect (A2 rows, native selects, Pin, remote
   diagnostics) gets a recorded decision — fix, redesign, defer, or remove — before any fix code
   lands, batched per panel so each commit stays green.
4. **Tiered, honest qualification.** A packaged-app smoke harness built once, run on all five CI
   platforms at release-candidate time, plus a gated manual Jetson runbook. Every claim names the
   engine and platform it was verified on.

## Goals

1. Closing the window can never silently destroy in-flight work; the operator is asked, warned, or
   cued depending on platform and state.
2. The packaged app launches, runs, and shuts down correctly on all five CI platform targets, with
   the shutdown/restart contract proven by the smoke harness rather than asserted.
3. The shell↔web seam exists as one documented, tested protocol; the zero-IPC posture is enforced
   by a permanent guard.
4. External links, menus, and shortcuts behave per platform convention with a single source of
   truth for shortcuts.
5. Every open A2 defect row and every native `<select>` control has an explicit, evidence-backed
   disposition, executed in green-suite batches.
6. Session Pin and durable remote diagnostics exist as real capabilities (or their absence is a
   recorded decision, not an omission).
7. Notifications, if shipped, are summons-only: they never carry authority actions and never claim
   unearned completion.
8. The Jetson AGX Orin qualification has a runbook, an operator-authorized prerequisite list, and a
   defined evidence path — executed by the operator, not silently skipped or silently claimed.
9. Documentation (status, READMEs, contract READMEs, architecture doc) agrees with the code.

## Non-Goals

- Auto-update (unsigned artifacts; manual download + SHA256SUMS is the documented posture).
- Crash-reporting service (local-first posture; the watchdog error window and shell log are the
  surface).
- Any Tauri capability grant to webview content (the zero-IPC posture holds in this design).
- Global OS shortcuts, tray/minimize-to-tray, multi-window attachment (single-instance focus stays).
- App-wide native file dialogs (the world-aware server-side directory picker stays the universal
  path; at most a first-run local "Browse…" is considered through the seam).
- Cloud sandboxes, skills/rules settings, GitHub integration (no matching capabilities exist; the
  standing donor rule binds).
- Removing the Chromium `--app` fallback or the CLI/browser access modes (supported surfaces).
- Multi-user hardening (the single-operator development authenticator remains the documented
  limitation).

## Technical Plan

### 1. The seam: one protocol, zero capability grants

The webview stays a zero-IPC remote Tauri context: no capability file ships, ever, in this design.
All web↔shell traffic rides mechanisms that need no grant. Three sanctioned channels exist, in
order of importance:

1. **Host-side dispatch (Rust → web).** The web app exposes one documented entry point,
   `window.__wbShell.dispatch(message)`, routing to its existing action handlers (the same handlers
   the command palette and shortcut table use) and to hash-route navigation. The Rust side invokes
   it through `window.eval` — the mechanism already used for Reload. One committed **menu map**
   classifies every menu item as `rust-only` (no web dependency: reload, zoom, close, quit, open
   log folder, about) or `ui-dispatch` (New Session, Open Command Palette, Open Settings, Navigate
   to view). Messages carry only action ids and arguments — never content, never tokens.
2. **The window title (web → shell, coarse and human-readable).** The web app already owns
   `document.title`; this design makes the title the *one* sanctioned shell-visible signal. The web
   app keeps it honest: a bounded status suffix (for example `"(1) approval waiting"`, `"● running"`)
   written under PRODUCT.md copy rules. The Rust shell reads the title (it already can) and acts:
   close-time confirmation, unfocused attention (`request_user_attention`), and the notification
   trigger below. The title carries counts and states only — never session content, never secrets;
   this constraint is documented next to the protocol.
3. **Standard web APIs that already work.** `window.close()` from script and the platform close
   paths reach Tauri as `CloseRequested` without any grant (verified per engine in the smoke
   suite; WKWebView specifics handled in the macOS checklist).

Guard: a CI test asserts the generated Tauri ACL grants nothing to the remote URL (the capability
manifest stays empty), and the smoke suite re-asserts it per platform. The posture budget rule —
"plugins are invoked from Rust only; any web-invoked capability requires a named, per-command
capability file plus a recorded justification" — is written into `src-tauri/README.md`.

Boundary rule (recorded in `docs/known-gaps.md`): shell-side affordances (menus, close confirm,
notifications, external links, window chrome) are **shell-local**, outside the Cognate capability
model — they exercise no server authority. Anything touching durable state or authority keeps
routing through governed capabilities exactly as today.

```
┌──────────────────────────── Tauri shell (Rust) ────────────────────────────┐
│  menu map ──► rust-only items (reload/zoom/close/quit/log/about)           │
│             └► ui-dispatch items ──► window.eval ──► __wbShell.dispatch    │
│  title watcher ──► close confirm / request_user_attention / notification   │
│  navigation handler ──► loopback stays in-app; other hosts → system browser│
│  sidecar lifecycle: port, health, watchdog(health), SIGTERM, 30s grace     │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ spawns with PORT, COGNATE_NO_WINDOW=1, COGNATE_RESOURCE_DIR,
               │ COGNATE_SHELL=tauri@<version>          (no other env, no token)
┌──────────────▼─────────────────────────────────────────────────────────────┐
│  Cognate server (Bun sidecar) — unchanged authority model                  │
│  /health (now reports shell identity) · Connect RPC · same-origin WS       │
│  /app.js carries the boot token for the webview UI (unchanged)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Desktop contract

**Close/quit semantics — one decision for all platforms: close = exit.** No tray, no
minimize-to-continue (recorded non-goal): the bundled database's owner is the shell process, and a
backend that outlives its window is exactly the orphan class this project just fixed. On
`CloseRequested`, the shell reads the title marker: if in-flight work is present, a **native
(Rust-side) confirmation** names what will stop ("A run is in flight. Quit and stop it?") and only
a confirmed close proceeds. No web round-trip is needed for the dialog. macOS convention
(close-window ≠ quit) is deliberately not adopted, and the design doc records why; dock Quit takes
the same confirmed path.

**Attention when unfocused.** When the title marker appears while the window is unfocused, the
shell calls `request_user_attention` (taskbar flash on Windows, dock bounce on macOS) — Rust-side,
free, no plugin. This is the v1 attention cue.

**Notifications — summons-only, gated on evidence.** v1 ships the title cue. If the operator
experience justifies more, the shell may raise OS notifications **from Rust** via the notification
plugin's Rust API (no webview grant needed): body text is the web app's own marker string passed
through verbatim (server-authored copy; never Rust-formatted), activation focuses and deep-links to
the approval card via the ui-dispatch channel, and the notification never carries approve/deny or
"done" claims. Triggers: approval-waiting marker appearing while unfocused, and ambiguous-step
markers. Where no notification daemon exists (WSLg, minimal WMs), the feature is off — the title
cue and in-app state remain canonical.

**External links.** A Rust-side navigation/new-window handler: loopback URLs stay in-app; every
other host opens in the system browser via the opener plugin's Rust API (no grant), http(s) only.
`markdown.ts` and the three `target="_blank"` usages are verified against this path; the shell
smoke includes an external-link probe.

**Shortcuts — one source of truth.** The app's editable shortcut table stays the single registry.
v1 native menus carry **no domain accelerators** (labels only), so the table cannot diverge from
the menus. The Ctrl+N browser-reservation rationale is void inside Tauri: the shortcut table's
default for New Session becomes Ctrl+N/Cmd+N (still operator-editable, same conflict rules). A
menu→action mapping table in the repo documents every item against the existing action inventory —
a menu item without a real action does not ship (PRODUCT.md principle 3).

**OS theme.** Already solved in the web layer (`useTheme` system mode + `prefers-color-scheme`,
durable setting). Remaining work is chrome-only: `color-scheme` CSS so scrollbars/form controls
follow the theme, and per-platform window chrome theming from Rust where the platform supports it.
No second theme channel is created.

### 3. Lifecycle hardening (shell)

- **Startup budget:** first boot (pg0 initialization) and steady boot get distinct deadlines
  (180 s first, 60 s steady), measured not guessed; the wait surface shows elapsed time and the
  latest log phase instead of a silent poll.
- **Startup timeout is not a SIGKILL:** the timed-out sidecar gets SIGTERM with the same 30 s
  grace the shutdown path uses; only a wedged process is killed. The error surface includes the
  sidecar's own stderr tail.
- **Watchdog:** the existing exit-watchdog gains a periodic `/health` probe and covers **reused**
  backends: if a reused owner dies or stops answering health, the window gets an honest error
  surface instead of zombie webview. The backend handle is registered before the health wait so an
  early quit always has a kill path.
- **Health parsing:** log the raw response when the probe fails; `find_sidecar` matches the host
  triple explicitly instead of lexicographic-first.
- **Log discipline:** `desktop-shell.log` gets a size-capped rotation; the diagnostics dialog
  surfaces its location (it already exists in the Remote panel work).
- **Shell identity:** the shell passes `COGNATE_SHELL=tauri@<version>` (the `--app` fallback passes
  its own); the server records it in `/health` and a boot log line, closing the "works in browser,
  dead in the app" triage class.
- **Windows shutdown honesty:** either a graceful mechanism (close request → WM_CLOSE /
  `taskkill` without `/F` first) is priced and adopted, or the qualification row records "forced
  close qualifies orphan cleanup + restart recovery; clean shutdown is a platform limitation". The
  draft's default is the honest record; the graceful mechanism is attempted only if it survives a
  day of implementation without platform hacks.

### 4. Qualification: one harness, tiered surfaces

`scripts/qualify-tauri.sh` (parameterized: bundle path, port base, display) proves, per platform:
extract/install bundle → launch (xvfb-run on Linux CI) → parse the port from `desktop-shell.log` →
`/health` poll → shell log markers (backend ready, shell identity) → SIGTERM/close → assert
sidecar exit, pg0 stopped, lock released → relaunch → assert lock reuse → close. Plus the
**zero-IPC guard** and an external-link/dispatch round-trip probe. Built once, run everywhere.

- **T1 (every platform, RC-gated):** the harness above against the platform bundle
  (deb, NSIS, app/dmg).
- **T2 (every platform):** the existing Chromium journey suite pointed at the *packaged sidecar*
  binary with its staged resources — proving the shipped backend and UI, not the dev server.
- **T3 (where honestly feasible):** Windows — WebView2 CDP smoke; Linux — xvfb + WebKitGTK DOM
  checks; macOS — a scripted manual checklist with committed evidence. Playwright cannot drive
  WKWebView or WebKitGTK; claims name the engine they were verified on (the repo's platform-honesty
  rule).

CI shape: `verify.yml` gains a per-commit Linux Tauri job (fmt, clippy, cargo test, debug build,
xvfb T1 smoke); the five-platform Tauri matrix (build + bundle + T1 + T2) runs on release
candidates and tags, mirroring `package.yml`'s matrix (ubuntu-22.04, ubuntu-22.04-arm, macos-15,
macos-15-intel, windows-2022). The harness checklist also carries the **verify-only rows** the
brief scoped: clipboard round-trip (`navigator.clipboard` in each shipped engine) and OS-theme
following (`prefers-color-scheme` + `color-scheme` chrome) — no new code expected; a failed row is
a finding. The DomainForge binding build is extracted into a composite action
shared by both workflows; the verify.yml domainforge pin (0.21.1 vs 0.21.2) is aligned in the same
tranche. AppImage: dropped with the recorded linuxdeploy/FUSE failure — deb covers both Linux
arches.

### 5. Defect closure: ledger first, batches per panel, guard last

The **dispositions ledger** (`.agents/plans/desktop-native-completion/dispositions-ledger.md`) is
produced before any fix code: every open A2 row (D-9 … D-34), every native `<select>` with
file:line, session Pin, and the remote diagnostics gap — each with disposition FIX / REDESIGN /
DEFER / REMOVE / KEEP-NATIVE and an evidence class. The reconciled select count replaces "~35" in
DEBT.md.

MenuSelect carries an accessibility gate first (screen-reader value announcement, full keyboard
contract test) because native selects are the most accessible control that exists; **keep-native is
a first-class disposition** with a recorded rationale. Conversion batches run per panel —
ContractEditor (13, may split), ExpertsTeamsPanel (8), AutomationPanel (6), SchedulesPanel (5),
then the five-file tail — each batch shipping its E2E updates (selectOption → menu journeys) in
the same change. A mechanical guard test ends the track: no `<select` outside `MenuSelect.tsx`
without a recorded exception. The suite's known flakes (font-route blocking, concurrency cap —
both sized S in DEBT.md) land before the batches so a red suite means a real regression.

Session Pin and durable remote diagnostics are **features** and follow the model-first rule:
`J-SESSION-pin` (capability + event + reducer/projection + sidebar menu entry) and a bounded
`workbench.remote.*` event family folded into the existing projection, rendered by the Remote
panel — never polls-as-events. Drag-and-drop, if the ledger admits it, is HTML5 DnD calling the
existing governed workspace capabilities with its own `.sea` journey.

### 6. Jetson qualification runbook

A committed runbook (operator-executed, device read-only until they act): prerequisites the
operator authorizes (`libwebkit2gtk-4.1-0` install or `apt install ./cognate-workbench-*.deb` —
the deb's dependency resolution handles it), then the T1 harness against the arm64 deb produced by
CI, including a real-compositing check; if the WebKitGTK DMABUF renderer misbehaves on the NVIDIA
driver, `WEBKIT_DISABLE_DMABUF_RENDERER=1` is recorded as a supported configuration, not a
surprise. Evidence (environment fingerprint: JetPack/L4T version, WebKitGTK version, session type,
compositor; command log; screenshot where tooling permits) lands in the verification log. An MSRV
check (`cargo build` under the Jetson's Rust 1.95) runs in CI before the runbook promises the
build works there. The Jetson is never a CI platform; a red Jetson run is a release blocker for
the Jetson target only.

### 7. Milestones (user's A–E order, corrected by the dependency analysis)

- **A — Recovery & architecture (this document's process):** drift report ✅, brief ✅, this draft
  → Goldfish review → resolve → approval. Then: doc-recovery tranche (CURRENT_STATUS reconcile,
  src-tauri README grace fix, src/README counts, three EGM contract READMEs, architecture.md
  corrections) and the dispositions ledger.
- **B — Desktop foundation:** CI scaffold (composite action, Linux Tauri job) → smoke harness
  (T1/T2, zero-IPC guard) → seam protocol (`__wbShell` + menu map + guard) → lifecycle hardening
  (§3) → desktop contract (§2 close-confirm, attention, links, menus, chrome theming).
- **C — Native UX convergence:** menu map execution end to end; summons-only notifications if
  evidence demands; per-platform chrome polish; the desktop-contract acceptance rows from the
  original matrix (window behavior, menus, dialogs, shortcuts) finally verified rather than
  asserted.
- **D — Functional & debt closure (parallel track, starts after the ledger):** per-panel select
  batches + D-series fixes; Pin; remote diagnostics; flake remediations first.
- **E — Release qualification:** five-platform Tauri matrix run (T1+T2 everywhere, T3 where
  feasible) → Jetson runbook execution → final report with the platform-honesty matrix, re-captured
  screenshots, `just verify` + `domainforge validate` + cargo gates, CURRENT_STATUS revision.

Critical path: A → B1 → B2 → B3 → B4/B5 → E1; C and D are parallelizable against B's outcomes;
E2 hangs off E1's arm64 artifact with an explicit blocked state, never silently.

## Alternatives Considered

1. **Selective Tauri capability grants to the loopback URL** (rich web↔shell IPC: plugins' JS APIs
   exposed to the webview). Rejected: the largest possible security-posture change available;
   contradicts the shell's documented promise; every new feature re-litigates a security decision
   and scatters grants across the codebase. The reviews ranked this the option most likely to
   silently turn a hardened surface into a permissive one. Rust-side plugin invocation achieves
   the same features with no grant.

2. **A shell-authenticated server channel** (shell token issued at spawn; or a third same-origin
   WebSocket surface for shell consumption). Rejected for v1: a new auth surface and actor concept
   in a codebase that just completed an adversarial security review; the web app already receives
   every event the shell could need, and the title protocol covers the shell's actual needs (state
   markers, counts). Revisit only when a shell-side feature genuinely cannot ride the web app, with
   its own `.sea` journey and threat review.

3. **Static Rust-side menu accelerators.** Rejected: creates a second, non-editable shortcut
   source of truth that diverges per platform and from the operator-editable shortcut table —
   exactly the "control that lies" failure PRODUCT.md forbids. Menus carry labels; the table stays
   authoritative; the Ctrl+N reservation is reopened inside Tauri through the table itself.

4. **Rust-side notification/event tap** (shell subscribes to StreamEvents). Rejected: duplicates
   protocol knowledge in a second language, needs an auth story, and re-derives state the web app
   already holds. The title-marker trigger is coarse but honest, and the web app authors the copy.

5. **Native file dialogs app-wide.** Rejected: the server-side directory picker is journey-tested,
   world-aware (SSH/WSL/contained), symlink-conservative, and identical across browser/CLI/shell
   surfaces. Native dialogs fork UX for one world only, resist E2E, and add portal dependencies.
   At most a first-run local "Browse…" may be considered through the seam if the ledger shows the
   typed path is the friction point; the default stays the picker.

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
   both Linux arches. Dropped with the failure recorded; the deb is the Linux artifact, x86-64 and
   arm64.

9. **Windows graceful shutdown via WM_CLOSE / taskkill-without-/F.** Retained as an option; the
   default disposition is the honest record ("forced close qualifies orphan cleanup + restart
   recovery; clean shutdown is a platform limitation") unless the graceful mechanism survives a day
   of implementation without platform hacks. Either way, no shutdown-parity claim on Windows.

10. **macOS close-window ≠ quit (platform convention).** Rejected deliberately: the backend's
    owner is the shell process; a backend that outlives its window recreates the orphaned-database
    class this project just fixed. Close = exit on all platforms, with the in-flight confirmation
    as the operator's protection. Recorded as a product decision, not an oversight.

11. **Chromium `--app` removal.** Rejected: it stays the CLI fallback (`cognate-workbench launch`
    without Tauri installed) and its launch journey is the regression harness for the fallback
    surface.

12. **Keep native `<select>` everywhere (accessibility-first blanket).** Considered seriously: the
    native select is the most accessible control that exists, and MenuSelect's menu-role pattern on
    form controls is semantically debatable. Rejected as a blanket rule because the A2 audit found
    the inconsistency itself a defect (same control, two visual languages), but the disposition
    ledger keeps **keep-native as a first-class outcome** per control, gated on the MenuSelect
    a11y pass — conversion is per-panel and reversible, not ideological.

13. **Do nothing more to the shell (ship the current Linux-verified state).** Rejected: it fails
    the operator on the close contract, ships dead external links, has no platform evidence beyond
    Linux, and leaves the defect ledger unadjudicated — the exact gap this effort exists to close.

## Detailed Implementation

Every file below is listed with what changes and why. Verification commands per tranche follow the
repo's existing gates: `bun run typecheck`, targeted `bun test`, `just smoke` before milestones,
`just verify` at milestone boundaries, `cargo fmt --check`/`clippy`/`test` in `src-tauri/`,
`domainforge validate` + `fmt --check` for any `.sea` change, and the new `scripts/qualify-tauri.sh`
for packaged tranches. Model-first rule: any capability-touching tranche lands its `.sea` journey
first, validated, before code.

### A — Recovery, plan, ledger (docs-only)

| File | Change |
|---|---|
| `CURRENT_STATUS.md` + `.agents/CURRENT_STATUS.jsonl` | Revision 39: reconcile revs 37–38 into the markdown; record this mission's start. Revision 40 lands at E3. |
| `src-tauri/README.md` | Fix the stale 10 s shutdown-grace text (actual: 30 s + 45 s failsafe); add the posture budget rule and the close/quit semantics; document the title protocol constraint. |
| `src/README.md` | Correct component/projection counts; add terminal/browser/preview subsystem map entries. |
| `src/terminal/README.md`, `src/browser/README.md`, `src/preview/README.md` | New EGM-compliant contract READMEs (Overview/Interface/Invariants/Side Effects/Verification), per the revision-34 bootstrap convention. |
| `.agents/plans/desktop-terminal-browser/architecture.md` | Correct stale baseline claims: `WORKBENCH_EVENTS` count (44), App.tsx size, "attaches a second window" → the implemented single-instance focus behavior. |
| `docs/known-gaps.md` | New rows: shell-local-affordance boundary rule; Windows shutdown limitation; title-protocol constraints; Jetson prerequisite status. |
| `.agents/DEBT.md` | Update the select count (~35 → reconciled 42–43), annotate rows as the ledger adjudicates them. |
| `.agents/plans/desktop-native-completion/dispositions-ledger.md` | New: every open A2 row, every native `<select>` (file:line), Pin, remote diagnostics — each with FIX/REDESIGN/DEFER/REMOVE/KEEP-NATIVE + evidence class. The reconciled select inventory lives here. |
| `.agents/plans/desktop-native-completion/plan.md`, `verification.md` | New mission tranche table and append-only verification log (the desktop-terminal-browser format). |

### B1 — CI scaffold

| File | Change |
|---|---|
| `.github/actions/domainforge-binding/action.yml` | New composite action extracting the existing per-platform napi binding build from `package.yml` (clone pinned tag, cargo build, install beside the JS loader). |
| `.github/workflows/package.yml` | Consume the composite action; otherwise unchanged (working infrastructure is not rewritten). |
| `.github/workflows/verify.yml` | Align the domainforge pin to 0.21.2 (the justfile's version); add a per-commit `tauri-linux` job: bun + Rust setup, `libwebkit2gtk-4.1-dev` install, `cargo fmt --check` + `clippy` + `test` in `src-tauri/`, debug `tauri build`, xvfb T1 smoke via the new harness. |
| `.github/workflows/tauri.yml` | New: five-platform matrix (ubuntu-22.04, ubuntu-22.04-arm, macos-15, macos-15-intel, windows-2022), dispatch/tag-gated; per job: composite binding action, `bun scripts/tauri-sidecar.ts <target>`, release `tauri build` (deb / nsis / app+dmg), T1 harness, T2 journey suite against the packaged sidecar, artifacts + checksums uploaded. Includes the MSRV check job (cargo check under Rust 1.95) gating the Jetson claim. |

### B2 — Packaged smoke harness + guards

| File | Change |
|---|---|
| `scripts/qualify-tauri.sh` (+ `qualify-tauri-lib.sh` following `qualify-lib.sh`) | New parameterized harness (bundle path, port base, optional xvfb): install/extract → launch → parse port from `desktop-shell.log` → `/health` → shell-identity marker → close → assert sidecar exit + pg0 stopped + lock released → relaunch → assert reuse → close. Includes the zero-IPC guard (capability manifest empty) and the dispatch round-trip + external-link probes where the platform allows. |
| `justfile` | `tauri-smoke` recipe wrapping the harness; `tauri-guards` recipe asserting no `src-tauri/capabilities/*.json` and no web-invoked grants in the generated ACL. |
| `test/J-DESKTOP-launch.test.ts` | Unchanged (it guards the `--app` fallback and must stay green). |

### B3 — Seam protocol

| File | Change |
|---|---|
| `src/ui/shell/desktopBridge.ts` | New: registers `window.__wbShell` with a typed dispatch (action id + args), routed to the existing action-handler inventory and hash-route navigation; no-op in browser/CLI contexts. |
| `src/ui/App.tsx` | Wire the bridge to the existing handlers; add the title-marker manager (status suffix composed under PRODUCT.md copy rules: approval-waiting count, running marker, ambiguous-step marker). |
| `src-tauri/src/lib.rs` + new `src-tauri/src/menu.rs` | Extract the menu into a committed **menu map** (item → rust-only or ui-dispatch → action id); `handle_menu_event` dispatches ui-dispatch items through the documented eval protocol; rust-only items keep native handling. Menu labels only — no domain accelerators. |
| `test/ui-desktop-bridge.test.tsx` | New: protocol conformance, unknown-action refusal, browser no-op. |
| `src-tauri` cargo tests | Menu-map classification (every item has a channel and a real target). |

### B4 — Desktop contract

| File | Change |
|---|---|
| `src-tauri/src/backend.rs` | `CloseRequested` handling: read the window title marker; in-flight → native Rust-side confirmation (plugin dialog from Rust, no grant); confirmed → exit. |
| `src-tauri/src/lib.rs` | Title watcher (unfocused + marker → `request_user_attention`); navigation/new-window handler (loopback in-app; other hosts → opener plugin Rust API, http(s) only); register the opener + dialog plugins Rust-side. |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-opener`, `tauri-plugin-dialog` (Rust-invoked only). |
| `src/ui/markdown.ts` | Normalize external links (explicit external targets) so the shell's handler and browser behavior agree. |
| `src/shortcuts.ts` + `test/J-PREFS-shortcuts.test.ts` | Default New Session chord becomes Ctrl+N/Cmd+N (browser reservation void in Tauri); operator-editable, same conflict rules; test updated, not weakened. |
| `src/ui/App.tsx` (theme chrome) | `color-scheme` CSS integration so form controls/scrollbars follow the theme (the `useTheme` machinery itself is untouched). |
| `src/ui/app.css` + `src/ui/tokens.css` | `color-scheme: light dark` per theme; no token changes. |

### B5 — Lifecycle hardening

| File | Change |
|---|---|
| `src-tauri/src/backend.rs` | First-boot vs steady startup budgets (measured, 180 s / 60 s); progress surface with elapsed + log phase; startup timeout → SIGTERM with 30 s grace before kill, stderr tail in the error surface; watchdog gains periodic `/health` probes and covers reused backends; backend handle registered before the health wait; `desktop-shell.log` size-capped rotation; `find_sidecar` matches the host triple; raw health body logged on probe failure. |
| `src-tauri/src/lib.rs` | Wire the new lifecycle paths; log shell version at boot. |
| `src/server.ts` | Read `COGNATE_SHELL` (format `kind@version`), include it in `/health` and one boot log line. |
| `src/desktopWindow.ts` | Pass `COGNATE_SHELL=chromium-app@<version>` for the fallback path. |
| `src-tauri/tauri.conf.json` + `scripts/tauri-sidecar.ts` | Distinct desktop package identity (explicit deb package name so the Tauri and standalone debs cannot collide), version sourced from `package.json`; the coexistence/uninstall test is part of the harness. |
| `src-tauri/src/backend.rs` (Windows) | Attempt graceful close-request termination; if it cannot be made robust, record the honest limitation row (per §3) instead of shipping a fragile path. |

### D — Parallel defect track (starts after the ledger)

| File | Change |
|---|---|
| `test/helpers.ts` (+ E2E contexts) | Flake remediation: route-block web fonts in E2E contexts (DEBT closure, size S). |
| `package.json` (`test` script) | Concurrency cap for constrained hosts (DEBT closure, size S). |
| `src/ui/shell/MenuSelect.tsx` + `test/ui-menu-select.test.tsx` | Accessibility gate: screen-reader value announcement, full keyboard contract, before any conversion. |
| `src/ui/ContractEditor.tsx` (13), `src/ui/experts/ExpertsTeamsPanel.tsx` (8), `src/ui/workbench/AutomationPanel.tsx` (6), `src/ui/experts/SchedulesPanel.tsx` (5), `src/ui/workbench/Workbench.tsx` (3, D-28), `src/ui/workbench/LedgerPanel.tsx` (3), `src/ui/experts/ExpertEditor.tsx` (2), `src/ui/AmbiguousStepCard.tsx` (1), `src/ui/workbench/CheckoutChip.tsx` (1) | Per-panel select conversion per the ledger dispositions (largest panel first; ContractEditor may split), each batch with its E2E updates (selectOption → menu journeys) in the same change. |
| The `selectOption`-driving E2E files per panel (`test/E2E-experts*.test.ts`, workbench/automation/contract suites) | Updated locators/journeys in the same commits as their panel conversions. |
| `test/native-select-guard.test.ts` | New mechanical guard: no `<select` outside `MenuSelect.tsx` without a ledger-recorded exception. |
| D-series fixes per the ledger: `src/ui/App.tsx` (D-9 header, D-13 tabs/stray icon, D-15 quote typography, D-17 disabled contrast, D-19 label style, D-24 badges, D-25 turn counter, D-26 toolbar collapse, D-29 dark Cancel border), `src/ui/models/ProviderWizard.tsx` (D-12 footer, D-16 card clamp), `src/ui/GovernancePane.tsx` (D-18), `src/components/modelProvider.ts` (D-21 redesign — render once per group), `src/ui/App.tsx` D-22 status copy (surface the current step), `src/ui/DirectoryField.tsx` (D-27), `src/ui/inspector/ConfigTab.tsx` (D-30), `src/ui/models/ModelPicker.tsx` (D-34) | Small, individually verifiable commits; each re-captures its screenshot and names its test. |
| Pin feature: `.sea/interaction/interaction-model.sea`, `domain/index.ts`, `src/workbench/types.ts`, `src/workbench/reducer.ts`, `src/workbench/state.ts`, `src/projections/sessions.ts`, `src/capabilities/workbench.ts`, `src/server.ts` (GRANTED_CAPABILITIES + binding), `src/ui/App.tsx` (row menu), `test/J-SESSION-pin.test.ts` | Model-first: `J-SESSION-pin` journey validated first; then capability + event + projection + UI in one tranche. |
| Remote diagnostics: `.sea` model journey, `src/workbench/types.ts` (`workbench.remote.*` bounded family), reducer/projection, `src/remote/*` recorder injection, `src/ui/RemotePanel.tsx` (render the fold), journey test | Bounded transition events only (state changes, pairing, errors) — never the 2 s/5 s polls. |
| Drag-and-drop (only if the ledger admits it): `src/ui/App.tsx` or the Add-workspace dialog, `.sea` journey | HTML5 DnD calling the existing governed workspace capabilities; remote-world drops handled honestly (fallback to the typed path). |

### C — Native UX convergence (against B's outcomes)

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` + `menu.rs` | Menu map executed end to end; per-platform menu conventions verified (macOS app menu, About placement). |
| `src-tauri/Cargo.toml` + `src-tauri/src/*` | Notifications (gated on B4 evidence): notification plugin from Rust, title-marker triggers, verbatim server-authored body, activation → focus + ui-dispatch deep link; disabled where no daemon answers. |
| `src-tauri/src/lib.rs` | Window chrome theming per platform (dark titlebar where supported). |
| `.agents/plans/desktop-native-completion/verification.md` | Acceptance rows from the original desktop matrix (resize/maximize/minimize/focus, state restore, platform close semantics) verified on WSLg and recorded honestly per platform. |

### E — Release qualification

| File | Change |
|---|---|
| `.github/workflows/tauri.yml` | Final shape: five-platform T1+T2 (+T3 where feasible: WebView2 CDP on Windows, xvfb WebKitGTK DOM checks on Linux), artifacts + SHA256SUMS, no signing (recorded). |
| `docs/jetson-qualification.md` | New runbook: operator-authorized prerequisites (`libwebkit2gtk-4.1-0` via deb dependency resolution), T1 harness execution, DMABUF fallback documented as a supported configuration, environment fingerprint + evidence format, explicit "red = Jetson-target release blocker" rule. |
| `.agents/reports/desktop-native-completion/REPORT.md` + `evidence/` | Final report: platform-honesty matrix (per platform × per feature: CI-proven / host-verified / implemented-per-docs), artifact checksums, limitations, EGM reconciliation note. |
| `scripts/ui-shots.ts` re-run | Re-captured screenshots for every touched UI, with the contrast audit (`UI_SHOTS_CONTRAST=1`) clean. |
| `CURRENT_STATUS.md` / `.agents/CURRENT_STATUS.jsonl` / `DEBT.md` / `docs/known-gaps.md` | Revision 40; ledger rows closed or carried; gaps updated. |
| EGM closure | Post-implementation drift report against this design + independent verification pass. |

### Explicitly not touched

`src/store.ts` persistence model; the Cognate SDK dependency boundary (`@godspeedai/cognate-*`
0.8.0 pins); `.sea/interaction/interaction-model.sea` semantic IDs (only additive journeys: Pin,
remote diagnostics, optionally DnD); the standalone packaging pipeline (`scripts/package.ts`,
`scripts/installers.ts`, `qualify-*.sh`) beyond consuming the composite action; the CLI surface;
the mobile/phone entry.
