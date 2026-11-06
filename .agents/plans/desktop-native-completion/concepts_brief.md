# Finish Cognate Workbench as a native desktop product (Tauri 2)

* **Author:** Elephant (ZCode), from the six-lens Goldfish brainstorm
* **Date:** 2026-11-06
* **Status:** pre-draft — feeding `egm-draft`

## Glossary (one-time, per the comprehension review)

- **Cognate capabilities** — the product's authority model: declared scopes a task may use, granted before action (`GRANTED_CAPABILITIES`, `src/server.ts:218`). **Tauri capabilities** — the shell's IPC allowlist for web content, which stays empty for this product's webview. Two different machines; this brief keeps them distinct.
- **Donor** — PandaCode, the third-party reference app whose UX was rebuilt here without copying code. The standing rule: an affordance may be ported only when a real capability exists behind it.
- **Donor-parity defect rows** — the open rows of the A2 audit table, `.agents/reports/ui-production-readiness/recon/A2-final-audit.md` §3 (ids D-9 … D-34).
- **Sidecar** — the Bun-compiled Workbench server binary the Tauri shell bundles and launches. **Lock-file reuse** — `server.lock` `{pid, port}` + a `/health` probe, so a second launch attaches instead of spawning a duplicate backend.
- **Boot token** — the operator session token the server injects into the served `/app.js` at boot; a webview loading the loopback URL is authenticated with no token file or URL parameter (architecture decision 1 of the desktop-terminal-browser plan).
- **Settlement** — the product's governed act of concluding work as done on corroborated evidence plus a human decision; not a single "done" event.
- **Model-first** — a user journey must exist in the `.sea` interaction model (DomainForge) before its capability code is written; see `.sea/interaction/` and the domainforge-sea skill.
- **Cobalt** — the locked design system in `DESIGN.md`; visual changes extend it, never invent a competing system.
- **Single-operator development authenticator** — the known security limitation (AGENTS.md); retained as a documented limitation, not presented as hardening.

## Overview

Cognate Workbench is an operator's cockpit for accountable agent work: declared task contracts, authority before action, evidence after action, settlement on a human decision. It runs as a loopback-only local server with a bundled database, and its Tauri 2 desktop shell already exists and works on Linux — sidecar lifecycle, single-instance, window-state, basic menus, verified SIGTERM cleanup.

What remains is convergence, not invention: make the packaged app behave like real desktop software on every platform it ships for, close the product's remaining dishonest affordances with recorded decisions, and qualify the packaged app with evidence rather than aspiration. Six independent Goldfish reviews (design/architecture, codebase-details, zoom-out, comprehension, implementation-readiness, structural) stress-tested this concept; their findings are folded in below.

## Analysis

**1. The shell↔web seam is the single gating decision (blocker, four lenses).**
The shell's defining, verified property is that the webview is a *remote* Tauri context with zero IPC: web content can call no shell API. Every planned native integration that needs web↔shell traffic (menu actions that do more than reload/zoom, notification click-through, drag-dropped folder paths, any shell-side app awareness) collides with this. Options: (a) selective Tauri capability grants to the loopback URL — the largest security-posture change available, rejected by every lens; (b) a shell-authenticated server channel (new token, new auth surface — heavyweight for v1); (c) host-side dispatch through the two mechanisms that already exist and need no grant: Rust→web `window.eval` (already used for reload) and same-origin hash-route navigation (rides the existing router). The converged direction: **(c) as the only v1 channel, one documented dispatch protocol, every menu item classified Rust-only vs UI-dispatched in a committed menu map; server-fed data (approvals waiting, run state) stays in the web app, which already receives the event stream.** Anything that would weaken the zero-IPC posture needs its own recorded justification first.

**2. The desktop contract, not the chrome list, is what makes it feel native (blocker, zoom-out lens).**
The verified close behavior ends the process: window closed → "closing the application" → database stopped → lock released. For an operator whose work is "often consequential and in flight," an accidental close kills agent runs with no confirmation and no unfocused-window cue — and on macOS close-window ≠ quit by platform convention. This, plus external links (currently dead in the shell: `target="_blank"` links do nothing), plus the shortcut sovereignty split (the app's editable shortcut table vs static Rust menu accelerators), is the actual "desktop contract": lifecycle semantics per platform, attention when unfocused (title suffix / taskbar), honest single-source shortcuts, working external links. If only one work item survives triage, it is this.

**3. The web layer already solves more of the native list than assumed (re-scope build→verify).**
OS theme detection: implemented (`useTheme` resolves light/dark/**system** with live `prefers-color-scheme`; `app.css` media query) — only window-chrome theming per platform remains. Clipboard: works (secure context, `navigator.clipboard` + native Edit menu). Menus/zoom/window-state/single-instance: real. Auto-update: already off (`createUpdaterArtifacts: false`) — surface as a made decision, not an accident. Scope these as verification rows, not builds.

**4. Lifecycle and watchdog gaps are product bugs, not polish (major).**
The startup path SIGKILLs the sidecar at 60 s (orphaning pg0 — the exact class of bug just fixed for SIGTERM; Windows runners wait up to 900 s for health, so first boots can exceed 60 s). The watchdog polls process exit only: a hung sidecar or a *reused* backend dying leaves a dead window with no surface. Required: first-boot-aware startup budget, SIGTERM-first on startup timeout, health-based watchdog covering reused backends, an honest "backend stopped/hung" surface, a progress surface instead of a silent poll, log rotation for `desktop-shell.log`, and `COGNATE_SHELL=tauri@version` recorded in `/health` for triage.

**5. Platform honesty and CI economics (major).**
CI currently builds and qualifies *standalone server packages* only; nothing compiles or exercises the Tauri shell. The honest per-platform test surface is tiered: T1 shell smoke (install, launch, health, close→pg0 stopped→lock released, relaunch reuse, second-instance focus, zero-IPC guard asserting the capability set stays `{}`) — scriptable everywhere; T2 the existing Chromium journey suite pointed at the packaged sidecar (proves the shipped backend+UI, not the webview engine); T3 webview-engine checks only where feasible (WebView2 via CDP on Windows, xvfb+WebKitGTK DOM checks on Linux, scripted manual checklist on macOS). Full five-platform Tauri packaging gates to release candidates; per-commit CI keeps server qualification + a Linux shell smoke. Playwright cannot drive WKWebView/WebKitGTK — claims name the engine they were verified on.

**6. Windows and WebKitGTK realities (major).**
Windows: no portable SIGTERM exists, so every shell close is currently a hard kill — the qualification criterion is restated honestly ("forced close qualifies orphan cleanup + restart recovery; clean shutdown recorded as a platform limitation") unless a graceful mechanism is funded. Linux/WebKitGTK: version skew across jammy/WSLg/Jetson (2.4x vs 2.50.4), and the DMABUF renderer has a known failure class on NVIDIA drivers — the Jetson is exactly that hardware; the qualification must exercise real compositing and record `WEBKIT_DISABLE_DMABUF_RENDERER=1` as a supported configuration, not a discovered surprise.

**7. Defect closure needs a ledger before code (major).**
The real native `<select>` count is 42–43 across 10 files (ContractEditor 13, ExpertsTeamsPanel 8, AutomationPanel 6, SchedulesPanel 5, Workbench 3, LedgerPanel 3, ExpertEditor 2, AmbiguousStepCard 1, CheckoutChip 1), not ~35. Conversion breaks every `selectOption`-based E2E and has an accessibility price (MenuSelect's `role="menu"` pattern on form controls is semantically debatable; screen-reader value announcement unproven). So: **dispositions first** (per control: convert / keep-native-with-a11y-rationale / wire / remove), then conversion batched **per panel** with its E2E updates in the same change, ending with a mechanical guard (no native `<select` outside MenuSelect without a recorded exception). Session Pin is a feature, not a fix (capability + event + projection + `.sea` journey, or recorded defer); server-side remote diagnostics is a bounded event family folded into the existing projection (never polls-as-events); D-21 is a redesign, the rest are fixes with named files.

**8. Notifications are summons, never authority (major, three lenses converged).**
Approvals are the product's highest-stakes surface; an OS notification with approve/deny actions would be governance theater exported outside the governed app, and a bare "Task complete" notification is the banned proof-free-completion pattern. Rule: notifications state what is being asked in server-authored copy and clicking focuses the window and deep-links to the approval card; the approving act stays in-app; delivery is best-effort (disabled rather than half-working where no daemon exists); triggers limited to `tool.approval.requested`, `run.invocation.ambiguous`, run terminal states. The cheap attention cue (title suffix) ships first; the notification plugin only if the cue proves insufficient.

**9. Reuse the existing picker; decline the blanket native-dialog retrofit (converged, three lenses).**
The server-side directory-suggestion flow is journey-covered, world-aware (SSH/WSL/contained), symlink-conservative, and identical across browser/CLI/shell surfaces. Native dialogs fork UX for one world, resist E2E, and add portal dependencies. Disposition: keep suggestions as the universal picker; at most a first-run local "Browse…" affordance through the seam, or decline entirely with this rationale recorded.

**10. Small verified fixes inside the shell.**
External links: `tauri-plugin-opener` invoked from Rust only (no capability grant), https-only, loopback stays in-app; normalize `markdown.ts` links. Downloads/blob popups: probe in the shell smoke (WebKitGTK needs embedder support; Tauri wires none by default) — redesign through a server endpoint if dead. Drag-and-drop: HTML5 DnD only (Tauri's drag interception would need an IPC grant), paired with existing governed capabilities and a `.sea` journey since it creates workspaces. Health-probe brittleness and `find_sidecar` triple-matching: log raw responses, match host triple. Package identity: the Tauri deb and standalone deb currently collide (`cognate-workbench` vs productName-derived) — distinct package name and version sourced from package.json, or one deb wins. Jetson: not a CI target — a manual, operator-gated qualification runbook (webkit install is an operator-authorized device change; MSRV check in CI; DMABUF documented); the pre-Tauri Jetson qualification covers none of the shell. Verify.yml's domainforge pin (0.21.1) lags the justfile (0.21.2).

## Goals vs. Non-Goals

**In-scope goals:**
1. Shell↔web seam decided and implemented as one documented, tested protocol (eval-dispatch + hash-route; zero-IPC posture preserved and guarded by a test).
2. Desktop contract: per-platform close/quit semantics (proposal: close = exit everywhere, no tray; in-flight work confirmed; attention cue via window title), external links in system browser, single-source shortcut contract (menu map derived from the app's own action inventory; revisit Ctrl+Alt+N in Tauri).
3. Lifecycle hardening: startup budget + progress surface + SIGTERM-first startup timeout; health-based watchdog incl. reused backends; log rotation; shell identity in `/health`.
4. CI: Tauri scaffold (fmt/clippy/test + debug build) on all five platforms; tiered packaged smoke (T1/T2/T3) with the zero-IPC guard; release-candidate-gated full matrix; per-platform engine honesty rows.
5. Defect closure with a dispositions ledger first (A2 rows + 42-43 selects + Pin + remote diagnostics), per-panel batches, E2E updates in-change, a11y gate, mechanical guard test.
6. Notifications as summons-only (title cue first, plugin gated on evidence).
7. Gated Jetson qualification runbook (operator-authorized webkit install; DMABUF documented; evidence to the verification log).
8. Documentation reconciliation (CURRENT_STATUS revision, src-tauri README grace fix, src/README counts, three missing EGM contract READMEs or recorded decision, stale architecture.md claims: events count, second-window wording, App.tsx size).

**Out-of-scope non-goals (recorded, not silent):**
- Auto-update (unsigned artifacts make the updater unusable; manual download + SHA256SUMS is the documented posture).
- Crash-reporting service (local-first posture; watchdog + log path is the surface).
- Tauri capability grants to the webview (posture change rejected for v1).
- Global shortcuts (YAGNI for a focused cockpit).
- Blanket native file dialogs (server-side suggestions stay the picker).
- Cloud sandboxes / skills-rules settings / GitHub integration (no matching capabilities; the standing donor rule).
- Multi-window attachment (single-instance focus is the recorded behavior; architecture doc amended to match).
- Tray/minimize-to-tray (close = exit for this effort).

## Alternatives Weighed

- **Selective Tauri capability grant to the loopback URL** (bridge mechanism) — rejected: largest possible security-posture change; contradicts the documented zero-IPC promise; per-feature grants re-litigate security seven times.
- **Shell-authenticated server channel (shell token / third WS surface)** — rejected for v1: new auth surface and actor concept; the web app already receives every event the shell would need; revisit only if a shell-side feature genuinely cannot ride the web app.
- **Static Rust-side menu accelerators** — rejected: second, non-editable shortcut source of truth; diverges per platform; violates the product's honesty principles.
- **Rust-side notification/event tap** (shell subscribes to StreamEvents) — rejected: duplicates protocol knowledge in a second language; new auth surface; the title-cue path is free.
- **Native file dialogs app-wide** — rejected: world-unaware, E2E-hostile, divergent; only the first-run local step is even arguable.
- **tauri-plugin drag events** — rejected: requires an IPC grant; HTML5 DnD + governed capabilities does the job.
- **Per-commit five-platform packaged journey tests** — rejected: not honestly achievable for webview apps in CI; flaky-suite noise would drown real regressions; tiered T1/T2/T3 with RC-gated full matrix instead.
- **AppImage as a primary Linux artifact** — rejected: fails on WSL2/linuxdeploy already, duplicates deb coverage for both Linux arches; dispositioned as drop-or-defer with the failure recorded.
- **Windows graceful shutdown via WM_CLOSE/taskkill-without-/F** — retained as an option the draft must price; otherwise the qualification row records the limitation honestly.
- **Chromium --app removal** — rejected: stays as the CLI fallback path; supported surface.

## Key Decisions & Staging for Next Steps

1. Bridge = eval-dispatch + hash-route only; menu map committed before menu code; zero-IPC guard test added.
2. Close = exit on all platforms (no tray), with in-flight confirmation and a title-based attention cue; macOS dock-reopen via lock reuse; Windows row honestly recorded.
3. Dispositions ledger precedes all defect code; per-panel batching; a11y gate on MenuSelect with keep-native as a first-class disposition.
4. CI scaffold and the tiered smoke harness are foundation deliverables (built once, run at RC time), not closing milestones.
5. Jetson is a gated manual runbook with an operator-authorized prerequisite, not a CI platform.
6. Tranche skeleton (from the structural lens): A1 doc-recovery → A2 architecture addendum + this mission's plan → A3 dispositions ledger → B1 CI scaffold → B2 packaged smoke harness → B3 bridge seam (empty) → B4 shell-only native features → B5+ bridge features (parallel) → D1..Dn parallel defect track → E1 five-platform matrix run → E2 Jetson run → E3 report + status revision.
