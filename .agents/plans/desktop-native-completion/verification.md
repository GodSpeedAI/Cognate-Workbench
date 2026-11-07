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
