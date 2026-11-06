# Consolidated Review Report — design.md

**Stages:** 5 zoom-out, 6 comprehension, 7 critic (design/structural/style), 8 intermediate
zoom-out, 9 implementation readiness (implementation-readiness/codebase-details/style) — all
completed, fresh contexts. Full findings per stage:
`zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`,
`intermediate_zoom_out_report.md`, and the Stage 9 reports (captured in the session; their
findings are consolidated below — stage-9 content folded into `implementation_readiness_report.md`
as well).

**Verdict:** the design's architecture survives review — zero-IPC posture, tiered qualification,
ledger-first closure, and model-first sequencing were independently confirmed sound by every lens.
One Blocker and a set of Majors must be resolved before implementation: the close-guard mechanism
as specified is fail-open and its implementation rows would rebuild it; several file/path/count
claims fail ground-truth checks; and the document needs Risks, Open Questions, and acceptance
criteria to be executable.

## 🔴 Blocker

| # | Finding | Stage refs |
|---|---|---|
| C1 | **Close guard is fail-open as specified.** Title-marker presence gates confirmation; a crashed/loading webview yields no marker and the shell closes silently — the exact failure Goal 1 forbids. Resolution direction (converged across four lenses): **`/health`, extended with runs-in-flight and pending-approval counts, is the machine authority for the close guard, fail-closed** (probe fails or state unknown → confirm). Title demoted to human cue + attention/notification trigger (fail-open is harmless there). No heartbeat machinery. Decision 1's invariant restated as "no capability grants to web content" (channels: shell→web eval dispatch; web→shell title + standard close paths + the shell's own `/health` probes). Close contract scoped per backend ownership (shell-owned → confirm+SIGTERM; reused → shell exits, backend untouched — wired via the `COGNATE_SHELL`/identity field B5 already adds). `--app` fallback's silent close decided and recorded (known-gaps row; optional beforeunload mitigation). B4/B5 rows amended to match (close handling lives in `lib.rs`'s run-event path, not `backend.rs`; server row extends `/health`). | S5-1, S7-B7-1, S7-2, S8-1, S8-2, S8-3, S9-1, S9-cb-1 |

## 🟡 Majors (consolidated)

| # | Finding | Stage refs |
|---|---|---|
| C2 | Title channel is **net-new web work**, not existing behavior being tuned: no `document.title` setter exists; three title strings disagree. Needs a named title owner, versioned machine-readable sentinel + human suffix, strict parser (non-conforming = unknown → feeds the fail-closed guard), web-side format guard test, notification bodies derived only from parsed fields. | S7-2, S7-3 |
| C3 | **Ctrl+N default must stay Ctrl+Alt+N globally**; the reservation reopens per-surface only inside Tauri, with the mechanism named (surface-aware default/reservation keyed on shell identity; `RESERVED_EXACT`/`validateChord` treatment spelled; test changes enumerated, not weakened). `--app` surface never ships a dead default. | S5-2, S7-4, S9-5 |
| C4 | **Downloads affordance has no disposition** (`src/ui/download.ts` backs the config export; dead in WebKitGTK). Ledger inputs gain downloads (and DnD); disposition names the shell-mediated fix (Rust-side fetch + dialog-plugin save) or REMOVE/DEFER with the limitation recorded — a loopback server endpoint does NOT fix it (rides the same webview). | S7-5, S8-5, S9-2 |
| C5 | **Deb package identity must be decided in-document:** exact distinct package name, the productName ripple (binary name, window identity, desktop entry), version plumbing from package.json, Jetson runbook glob, harness coexistence/uninstall step. | S7-6, S9-6, S9-sty-3 |
| C6 | Add **Risks & Mitigations** section (fail-open close, title fragility/spoofing, downloads, deb collision, watchdog recovery, MenuSelect a11y gate mid-conversion, startup-deadline basis) and an **Open Questions** section (notification v2 gate owner+threshold; Windows graceful-shutdown attempt owner; session-end close behavior per platform). | S7-7, S7-9, S8-7 |
| C7 | Add **acceptance criteria**: per-tranche "proves" column mirroring the sibling plan's format; goals made testable; the external acceptance matrix named with adopted rows (`.agents/plans/desktop-terminal-browser/acceptance-matrix.md`). | S7-8, S9-7 |
| C8 | **Fix ground-truth errors in the tables:** revision numbering (39 exists; start = 40, close = 41); `tokens.css` doesn't exist (use `app.css`; add DESIGN.md drift to A-tranche); ContractEditor path is `src/ui/workbench/`; `selectOption` E2E files are exactly three (E2E-experts, E2E-experts-debt, E2E-workbench) and automation/contract panels have **zero** select-driving tests today (add coverage, don't "update" it); remove `appimage` from `bundle.targets` (+ known-gaps row); close handling in `lib.rs`; strike the done `find_sidecar` clause; mark new files "New"; not-touched list qualified (CLI surface vs `desktopWindow.ts` env exception; new qualify-tauri scripts vs existing `qualify-*.sh`). | S9-9..15, S9-cb-2..9, S7-19, S7-26 |
| C9 | **B1/B2 sequencing contradictions:** B1's job can't run the B2 harness; B2's harness asserts B3/B5 features. Stage the rows (B1 = build+gates only; harness probes gated behind owning tranches) and fix the harness input contract (raw-binary mode for debug builds; relaunch step asserts clean respawn + lock re-created; state where second-instance focus is verified). | S9-3, S8-4 |
| C10 | **T2 has no mechanism:** the journey suite starts the server in-process; add a `COGNATE_TEST_SIDECAR=<path>` mode in `test/helpers.ts` (B2 row) or scope T2 down honestly. | S9-4 |
| C11 | **Channel enumeration restated once** (fixes M7-10/S5-5): decision 1 and Goal 3 quote §1's canonical channel list; hash-route demoted to what exists (plugins view) — "Navigate to view" menu item dropped from v1 (no action id exists; the action inventory is the six `SHORTCUT_ACTIONS`) or specified with new ids and their shortcut-table consequences. | S7-10, S9-8, N7-26 |
| C12 | **ui-dispatch menu items disabled until liveness** (webview down = inert native controls): disable until the `/health`-derived or watchdog liveness signal; rust-only items always work. | S8-6 |
| C13 | **Disposition vocabulary:** five values at first use + BUILD for feature rows (Pin, remote diagnostics) or a separate feature column; "evidence class" defined (audit-row reference, code citation, measurement, journey evidence). | S7-11, S7-12, S6-7/8 |
| C14 | **Goal language fixed:** Goal 1 restated to the uniform contract ("confirmed before close when server state is in flight or unknown; cued when unfocused"); Goal 6 → "real, shipped features"; Pin behavior defined at first mention (top-of-sidebar independent of sort, durable across restarts; donor-parity D-23 linked). | S7-14, S7-18, S6-1 |
| C15 | **Evidence tense:** planned checks in future/imperative; "verified" reserved for completed runs; startup deadlines "to be measured in this tranche"; MSRV gate one command everywhere (cargo build, matching §6's intent — corrected in the table). | S7-13, S9-sty-2/7 |
| C16 | **Sub-milestones labeled** (B1..B5, E1..E3) so the critical path and "E3" references resolve; "The reviews ranked" → named stages. | S7-15, S9-sty-1 |
| C17 | **Scope statement for the D track:** E3 can close with D rows carried and the desktop qualification unaffected (ESCALATE to the owner: keep D in-mission vs split out). | S5-3 |
| C18 | Terminology and pointer hygiene: "donor" defined at first use; "most accessible control that exists" replaced with concrete properties; EGM expanded + drift report linked; pg0 glossed; mobile entry glossed; notification authorship reworded (web app authors under PRODUCT.md rules; Rust never reformats); matrix runner value corrected (`macos-14` today — or the runner upgraded and stated); self-applied "honest" replaced with mechanisms; watchdog recovery behavior + numbers specified (probe interval, failure threshold, log cap/keep); diagnostics surface named (`src/ui/RemotePanel.tsx` section); compositing check defined; per-platform attention-cue row; Windows startup-timeout row; session-pin/"row menu" naming unified; preamble/column wording ("Target"). | S5-4/6/7/8, S6-2..5/9/10, S7-16/17/20..41, S8 nits, S9-sty-4..15 |

## 🟢 Nits

All remaining Nit-level findings are captured in C8/C13–C18 and the stage reports; the traceability
below maps each consolidated item to its sources.

## Traceability matrix

| Consolidated | Sources |
|---|---|
| C1 | S5-1 · S7-B7-1 · S7-2 · S8-1 · S8-2 · S8-3 · S9-1 · S9-cb-1 |
| C2 | S7-2 · S7-3 · S9-sty-8 |
| C3 | S5-2 · S7-4 · S9-5 · S6-5 |
| C4 | S7-5 · S8-5 · S9-2 · S9-cb-15 |
| C5 | S7-6 · S9-6 · S9-sty-3 |
| C6 | S7-7 · S7-9 · S8-7 |
| C7 | S7-8 · S9-7 |
| C8 | S9-9/10/12/13/15 · S9-cb-2/3/4/5/6/7/8/9 · S7-19 · S7-26 |
| C9 | S9-3 · S8-4 |
| C10 | S9-4 |
| C11 | S7-10 · S9-8 · N7-26 · S5-5 |
| C12 | S8-6 |
| C13 | S7-11 · S7-12 · S6-7 · S6-8 |
| C14 | S7-14 · S7-18 · S6-1 · S7-7(Goal1) |
| C15 | S7-13 · S9-sty-2 · S9-sty-7 |
| C16 | S7-15 · S9-sty-1 · S9-sty-19 |
| C17 | S5-3 |
| C18 | S5-4/6/7/8 · S6-2/3/4/5/9/10 · S7-16/17/20/21/22/23/24/25/27/28/29/30/31/32/33/34/35/36/37/38/39/40/41 · S8-4/5/6/7 · S9-sty-4/5/6/9/10/11/12/13/14/15 · S9-cb-9 |

(S-numbers refer to the findings in the stage report files listed above.)
