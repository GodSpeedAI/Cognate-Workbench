# Comprehension Report — Stage 6

**Target:** `.agents/plans/desktop-native-completion/design.md` (FeatureRange 1–371, DetailedRange 372–486)
**Reviewer:** egm-comprehension (fresh context, no document standard)
**Date:** 2026-11-06

## What this proposes

**Feature range (lines 1–371).** Cognate Workbench is an operator's cockpit for accountable agent
work, and a Tauri 2 desktop shell already wraps its loopback server; this design finishes that
shell so the packaged app behaves like real desktop software, without touching the
capability/authority model, the Cobalt design system, or the CLI/browser surfaces. It rests on four
decisions: (1) all web↔shell traffic rides two grant-free mechanisms — Rust-side script dispatch
into the web app's own action handlers (`window.__wbShell.dispatch`) and the web app publishing
status through the window title — with CI tests keeping the Tauri capability manifest empty; (2) a
"desktop contract" instead of a chrome list: close always exits the app but confirms first when a
run is in flight, an attention cue when unfocused, optional summons-only OS notifications, external
links to the system browser, and one operator-editable shortcut registry; (3) every remaining
defect (A2 rows D-9…D-34, 42–43 native `<select>` controls, Session Pin, remote diagnostics) gets a
recorded disposition in a ledger before any fix code; (4) tiered, honest qualification — one
packaged-app smoke harness run on all five CI platforms at release-candidate time, a manual
operator-run Jetson AGX Orin runbook, and claims that name the engine and platform verified.

**Detailed range (lines 372–486).** The Detailed Implementation turns each decision into
per-tranche file tables: docs-only recovery and the dispositions ledger (A), CI scaffold and the
packaged smoke harness plus zero-IPC guards (B1–B2), the seam protocol with a desktop bridge, menu
map, and tests (B3), the desktop contract in named shell and UI files (B4), lifecycle hardening
(B5), a parallel defect track (flake fixes, MenuSelect accessibility gate, per-panel select
conversion with in-change E2E updates, D-series fixes, and model-first Session Pin and
remote-diagnostics features) (D), native UX convergence (C), and release qualification ending in a
platform-honesty report (E). It closes with an explicit untouched list (store persistence, SDK
pins, `.sea` semantic IDs, standalone packaging, CLI, the mobile/phone entry).

## How the existing system works, per this document

**Feature range.** Today a Tauri 2 shell spawns the Bun-compiled Workbench server as a sidecar on
a shell-picked port (bundled database, pg0) and reuses a live instance via lock file and `/health`;
the webview is a deliberate zero-IPC remote context — no capability file ships, web content can
call no shell API. That posture is why native menu actions cannot reach the app, external links are
dead, and closing the window silently stops the backend, the database, and every in-flight run —
verified, shipped behavior. CI builds standalone server packages for five platforms but has never
compiled or exercised the Tauri shell, and the Jetson AGX Orin (the one device the operator owns)
has never run it. The web layer already solves theme, clipboard, zoom, and window management; the
authority model, editable shortcut table, server-side directory picker, CLI, and Chromium `--app`
fallback are preserved as-is.

**Detailed range.** The detailed range treats the current repo as substrate to amend, not rewrite:
existing CI (`package.yml`'s five-platform matrix, `verify.yml`'s domainforge pin at 0.21.1 versus
the justfile's 0.21.2, the per-platform DomainForge napi binding build) is consumed or extracted
into a composite action, and existing gates (`bun run typecheck`, `just smoke`/`just verify`,
cargo fmt/clippy/test, `domainforge validate`) remain the verification vocabulary. Existing code
owns the behavior being changed: `src-tauri`'s backend/lib own sidecar lifecycle and menus,
`App.tsx` owns the handlers and will own the title marker, `shortcuts.ts` is the editable registry
whose New Session default moves to Ctrl+N/Cmd+N, `MenuSelect.tsx` is the conversion target, and
the Remote panel already carries a diagnostics surface. Existing bookkeeping sets the conventions:
CURRENT_STATUS revisions (37–38 unreconciled into the markdown), DEBT.md's stale ~35 select count,
the desktop-terminal-browser plan/verification format, and the A2 audit rows.

## Findings

**1. Major — Session Pin is named everywhere but never behaviorally defined.**
Affected scope: Goal 6 (lines 73–74), §5 (lines 260–262), Pin feature row (line 456).
A fresh reader can recite the recipe (capability + event + reducer/projection + sidebar menu entry
+ row menu in `App.tsx` + `J-SESSION-pin` journey) but cannot say what pinning a session actually
does — keep it fixed at the top of the sidebar list regardless of sort? durable across restarts?
Different guesses build different features, so this instruction can produce the wrong thing. Repo
cross-check: it is donor parity — A2-final-audit.md D-23 ("Menu offers only 'Archive'. Add pin,
rename, copy path, delete") and the donor inventory's pinned group that "keeps manual order
whatever the sort" — but the design links neither, and it carves Pin out of the D-series fix list
without saying so.
Gloss needed: one sentence at first mention, e.g. "Session Pin: a session row-menu action that
pins the session to the top of the sidebar list independent of sort order, durable across restarts
(realizes the pin half of donor-parity row D-23)", plus a pointer to the ledger row that owns it.

**2. Nit — "EGM" and two process-artifact references are unresolvable from the baseline.**
Affected scope: lines 281–284 (milestone A), 388, 393, 475, 478.
"EGM" appears four times and is expanded nowhere in the design, the baseline, or the repo. "Drift
report ✅" (line 281) and "per the revision-34 bootstrap convention" (line 388) reference artifacts
the reader must guess at; the drift report exists as `2026-11-06_DRIFT_REPORT.md` in the same
directory but the design never names or links it.
Gloss needed: expand at first use and link the drift report file name in milestone A.

**3. Nit — "the mobile/phone entry" is a dangling scope exclusion.**
Affected scope: line 486 ("Explicitly not touched").
Neither the design nor the baseline mentions a mobile surface anywhere until the closing list
suddenly excludes "the mobile/phone entry". It does exist (the mobile remote control, per
README.md:157 and docs/REMOTE.md), but the design never says so.
Gloss needed: "the mobile/phone entry (the mobile remote-control surface, docs/REMOTE.md)".

**4. Nit — Notification body authorship is self-contradictory.**
Affected scope: lines 165–168 (§2 Notifications), against 417 and 426–427 (B3/B4 rows).
"the web app's own marker string passed through verbatim (server-authored copy; never
Rust-formatted)" — "server-authored" points the reader at the Bun server, which per this design
never authors the string; the web app (client) composes it in `App.tsx`. An implementer could
wrongly route copy composition to the server.
Gloss needed: reword to "authored by the web app under PRODUCT.md copy rules; the Rust shell never
composes or reformats notification text".

**5. Nit — The Ctrl+N "browser-reservation rationale" is presupposed, and the scope of the default
change is unstated.**
Affected scope: line 183 (§2 Shortcuts) and line 430 (B4 row).
Assumes the reader knows the current default and why it exists (`src/shortcuts.ts:23-28`); cannot
tell whether the new Ctrl+N/Cmd+N default is global for the shared table or scoped to the shell —
in the `--app` fallback the browser still owns Ctrl+N.
Gloss needed: one clause stating the current default's origin and the per-surface scoping.

**6. Nit — Drag-and-drop's "if the ledger admits it" refers to a row that cannot exist.**
Affected scope: lines 246–248 (§5 ledger inputs) versus 263–264 (§5) and 458 (D table).
The ledger's enumerated inputs do not include drag-and-drop, so the admission mechanism is
undefined.
Gloss needed: add DnD to the ledger's enumerated inputs or reword the condition.

**7. Nit — Disposition set is inconsistent between the Overview and §5.**
Affected scope: lines 55–56 (Overview decision 3) versus 247 and 392 (§5 and the A table).
Overview says four dispositions; §5 and Alternative 12 add KEEP-NATIVE as first-class.
Gloss needed: use the five-value set in the Overview.

**8. Nit — "evidence class" is required but never defined.**
Affected scope: lines 248 and 392.
No allowed values or meaning are given for the ledger's evidence class.
Gloss needed: one clause enumerating or exemplifying the classes, or a pointer to the ledger
template that defines them.

**9. Nit — pg0 is leaned on but never glossed.**
Affected scope: lines 20, 192, 199, 219, 408, 438.
First boot is "pg0 initialization" but pg0 is never named as the bundled embedded PostgreSQL
distribution (README.md:73 glosses it).
Gloss needed: at first use.

**10. Nit — Three small ambiguities in the lifecycle and qualification text.**
Affected scope: lines 204–205; line 270; lines 442–443 versus 408 and 217–221.
(a) "the diagnostics dialog … (it already exists in the Remote panel work)" has no antecedent; the
actual surface is a section inside `src/ui/RemotePanel.tsx`. (b) "real-compositing check" has no
operational definition. (c) B5 says "the coexistence/uninstall test is part of the harness" but the
harness step lists in §4 and B2 never include it.
Gloss needed: name the real surface; define the check; add the coexistence/uninstall step to the
harness step list.
