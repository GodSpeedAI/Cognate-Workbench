# Zoom Out Report — Stage 5 (Initial Zoom Out Review)

**Target:** `.agents/plans/desktop-native-completion/design.md` (full file)
**Reviewer:** egm-zoom-out (fresh context)
**Date:** 2026-11-06

Reviewed against PRODUCT.md, DESIGN.md, the desktop-terminal-browser architecture, the concepts
brief, DEBT.md, and the codebase (src-tauri/src, src/server.ts, src/shortcuts.ts,
src/workbench/types.ts, src/ui/App.tsx, .github/workflows, gen/schemas). Context sufficiency
passes: objective, motivation, and baseline are stated and verifiable. The four load-bearing
decisions are individually coherent and mutually consistent with the zero-IPC posture. Findings
only.

---

**1. Severity: Major — The close-confirm gate rides the most fragile available signal while a
robust one is already inside this design's own plan.**
- Affected scope: §1 channel 2 (lines ~110–117), §2 Close/quit semantics (~149–158), §3 watchdog (~197–203).
- Discrepancy: The design declares silent close "the single worst failure a desktop shell can
  have," then gates the fix on parsing a human-readable window title written by the webview. Two
  failure modes: (a) fail-open — if the webview is still loading, crashed, or the marker write
  lags, `CloseRequested` sees no marker and quits, silently destroying in-flight work, i.e., the
  exact failure the design exists to eliminate; (b) a consequential shell decision (block/allow
  quit) becomes coupled to UI copy composition. Meanwhile the design already has the shell talking
  to the sidecar over unauthenticated loopback `/health` (watchdog probe in §3, shell identity in
  §5); `src/server.ts:1045` shows `/health` is auth-free, loopback-gated, and already returns
  structured state. Run-in-flight and pending-approval counts are server-side state (projections
  live in the server process).
- Rationale & recommendation: A single `/health` probe at `CloseRequested` (one loopback
  round-trip, fresh, webview-independent) is simpler and strictly more robust than title parsing,
  adds no auth surface and no capability grant, and is not the rejected Alternative 2 (no token, no
  WS, no new actor). Make `/health` the authoritative machine signal for close-confirm (and
  optionally attention/notification triggers); keep the title as the human-readable cue. At
  minimum, record the fail-open window and argue why title-only is acceptable.

**2. Severity: Major — The Ctrl+N default contradicts the design's own supported surfaces and the
shortcut table's stated invariant.**
- Affected scope: §2 Shortcuts (~180–183); B4 table row `src/shortcuts.ts` (~430); Non-Goals and Alternative 11 (keeping the Chromium `--app` fallback).
- Discrepancy: The design argues "the Ctrl+N browser-reservation rationale is void inside Tauri"
  and makes Ctrl+N/Cmd+N the New Session default — while simultaneously keeping the `--app`
  Chromium fallback as a supported surface whose launch journey is retained as a regression
  harness. In the fallback, Ctrl+N is browser-reserved. `src/shortcuts.ts:118` puts
  `Ctrl+N`/`Meta+N` in `RESERVED_EXACT` with the explicit rationale "the shortcut would lie"; the
  current default is Ctrl+Alt+N (`src/shortcuts.ts:28`). Either the "single source of truth" table
  gets a per-surface exception (weakening the very invariant the design's Alternative 3 defends),
  or the shipped default lies on a supported surface — the "control that lies" failure PRODUCT.md
  forbids.
- Rationale & recommendation: Keep a non-reserved default, make the default surface-aware, or
  record the fallback limitation as a known gap. The B4 row says the test is "updated, not
  weakened" — it needs to say which, because today's test enforces the reservation the design is
  overriding.

**3. Severity: Major — The scope bundles two missions; the defect-closure track is severable and
inflates the desktop-native effort.**
- Affected scope: Problem statement item 3 (~28–36), §5 (~243–264), §7-D (~292–293), Detailed Implementation D table (~445–458).
- Discrepancy: Roughly half the implementation rows are UI product polish unrelated to the shell:
  42–43 select conversions across 10 files, ~16 A2 defect rows, two new features (Pin, remote
  diagnostics), and flake remediation. The critical path correctly excludes D, but the mission's
  definition of done (E3 report, ledger rows closed, CURRENT_STATUS revision) does not — the
  desktop release is hostage to a large UI-refactor track with its own a11y gate, E2E rewrites, and
  a guard test.
- Rationale & recommendation: The brief folded this in, and there is a real through-line
  ("converges to a finished product"), but the zoom-out question is whether this is the simplest
  shape that solves the root problem. The dispositions ledger is precisely the handoff artifact
  that makes D its own mission. Either split D out, or state explicitly that E3 can close with D
  rows carried and the desktop qualification unaffected. As written, an enormous single
  review/merge surface is created for one release.

**4. Severity: Nit — Parallel tranches concentrate edits in a 6,183-line App.tsx with no stated
conflict discipline.**
- Affected scope: B3 (bridge wiring, title-marker manager), B4 (theme chrome), D (nine defect rows, Pin row menu, DnD); §7 "C and D are parallelizable."
- Discrepancy: B and D both declare parallelism yet both edit `src/ui/App.tsx` heavily (verified
  6,183 lines today).
- Rationale & recommendation: One sentence of sequencing discipline (or pushing the title-marker
  manager and bridge wiring into the new-file candidates B3 already creates) would remove the merge
  hazard the milestone structure otherwise invites.

**5. Severity: Nit — Reuse claims about the seam's "existing mechanisms" are overstated.**
- Affected scope: Overview decision 1 (~47–50), §1 channels 1–2 (~104–117).
- Discrepancy: (a) "Same-origin hash-route navigation" is presented as already existing; the only
  hash route in the app is the `plugins/<id>` deep-link (`src/ui/App.tsx:4454–4465`) — the main
  navigation is boolean `currentView` state. (b) "The web app already owns `document.title`" is
  false as a baseline: the title is static (`<title>Cognate Console</title>`, `src/server.ts:396`);
  nothing writes it dynamically. Both mechanisms are partly new construction.
- Rationale & recommendation: Baseline accuracy matters in a document whose pitch is honesty about
  what exists versus what is asserted. Also a YAGNI angle: the ui-dispatch channel alone covers
  every item in the menu map (dispatch can navigate and deep-link), so generalizing a hash-route
  vocabulary may be unnecessary in v1 — scope it out or gate it on the ledger.

**6. Severity: Nit — The docs-correction row cites an event count that matches neither the doc nor
the code.**
- Affected scope: Detailed Implementation A-table, `architecture.md` row (~389): "Correct stale baseline claims: WORKBENCH_EVENTS count (44)."
- Discrepancy: The architecture doc being corrected says 28; the code
  (`src/workbench/types.ts:175–224`) has 38. If 44 anticipates the Pin and `workbench.remote.*`
  event families, say so and when it becomes true; a docs-only tranche landing a wrong "correction"
  recreates the drift it exists to fix.
- Rationale & recommendation: State the current count (38), the post-D count, and which tranche
  moves it.

**7. Severity: Nit — T3 hand-rolls engine-level probes without considering the Tauri ecosystem's
standard testing tool.**
- Affected scope: §4 T3 (~227–230).
- Discrepancy: T3 is justified by "Playwright cannot drive WKWebView/WebKitGTK" — true for
  Playwright, but `tauri-driver` (WebDriver via WebKitWebDriver on Linux, msedgedriver on Windows)
  is the standard Tauri answer and is not considered; the design proposes bespoke xvfb DOM checks
  and WebView2 CDP smoke instead.
- Rationale & recommendation: Record it as a considered alternative even if rejected (WebDriver
  against a remote-URL webview has its own caveats). The tiered, engine-honest structure itself is
  sound.

**8. Severity: Nit — The Detailed Implementation file tables duplicate the plan.md this design
creates.**
- Affected scope: "Detailed Implementation" (~372–478) vs A-table row creating `plan.md` (~393).
- Discrepancy: The design carries a full per-file tranche mapping while also commissioning a
  mission plan document with a tranche table — two authoritative places for the same inventory,
  which will drift.
- Rationale & recommendation: Keep one authoritative tranche table (plan.md); the design should
  stop at tranche boundaries and acceptance rows. Above the anti-weeds bar today (no helpers or
  loop variables), but at the duplication threshold.

---

Not flagged (checked and found sound, listed only for the record): close = exit on all platforms
(deliberately decided, rationale recorded, consistent with backend ownership and the
orphan-database fix); zero-IPC posture (verified `gen/schemas/capabilities.json` = `{}`; guard
proportionate); summons-only notifications (matches PRODUCT.md anti-references; gated on evidence —
good YAGNI discipline); ledger-before-code and model-first sequencing (consistent with AGENTS.md's
model → capability → journey → evidence rule); the smoke harness mirroring the existing
`qualify-*.sh` pattern (correct reuse); the menu-map extraction (grounded — `handle_menu_event` at
`src-tauri/src/lib.rs:141`, `window.eval` reload at :148); the domainforge pin discrepancy
(verified: verify.yml 0.21.1 vs justfile 0.21.2); no Tauri job in any workflow (verified).
