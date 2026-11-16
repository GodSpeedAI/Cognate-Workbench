# Drift report — desktop completion mission, scoped pass

Date: 2026-11-06. Scope: the design documents that govern the desktop-native
completion effort. Not a whole-repository pass (the revision-34 bootstrap pass
covered the 18 contract READMEs; this pass targets what changed since and what
this mission's decisions depend on).

Method: each document read, its specific file/symbol/count claims located in
source, current source read, differences reported. Only differences are listed.

## CURRENT_STATUS.md (file header) vs .agents/CURRENT_STATUS.jsonl

- The markdown file's newest entry is "revision 36" (standalone packages
  qualified in CI, commit `ea7255a`). The JSONL ledger carries revisions 37
  (ui-production-readiness-verified) and 38 (desktop-terminal-browser T4–T9)
  that were never folded into the markdown. A reader of `CURRENT_STATUS.md`
  alone does not know the Tauri shell, terminal, browser, and preview work
  exists. This mission must land a revision-39 entry reconciling both.

## src-tauri/README.md vs src-tauri/src/backend.rs

- README ("How the backend is managed" → "Shutdown"): "the spawned child gets
  SIGTERM (10 s grace, then SIGKILL)". `backend.rs:417-427` grants 30 s grace
  with a SIGKILL after, and `lib.rs:70-75` adds a 45 s wedge failsafe. The 10 s
  figure is the pre-`96f7fb0` behavior; the README documents the bug the commit
  fixed (10 s SIGKILLed the sidecar mid-database-stop and orphaned pg0).
- README ("Watchdog"): accurate (error window on unexpected backend exit,
  `backend.rs:362-390`).
- README ("Security posture"): accurate — no capability files shipped, the
  webview is a remote context with no Tauri IPC (`tauri.conf.json` ships no
  capabilities; `gen/schemas/capabilities.json` shows only the default schema).

## src/README.md vs src/server.ts

- "four agents, 30 mounted capability components plus observation/settlement
  wiring": the mounted component list at `src/server.ts:611` now includes
  `terminalComponent`, `browserComponent`, and `previewComponent` (plus three
  new service modules) — the count and the component inventory are stale.
- "17 public projections": `projections: [` at `src/server.ts:680` registers 18.
- The README's subsystem map predates `src/terminal/`, `src/browser/`,
  `src/preview/`; those directories exist with service, capability, and
  transport code but no listing in the src contract.
- Unchecked here (out of scope for this pass): the remaining symbol citations
  in `src/README.md`; the revision-34 reverse-export inventory predates these
  subsystems.

## EGM contract READMEs (bootstrap convention) vs src/ tree

- `src/terminal/`, `src/browser/`, `src/preview/` have no `README.md` at all.
  The revision-34 bootstrap convention gives every `src/**` code directory an
  EGM-compliant contract (Overview / Interface / Invariants / Side Effects /
  Verification). Three code directories are undocumented in the very format the
  repository committed to. This is missing documentation, not wrong
  documentation — but the mission's spec must either create them or record the
  decision not to.

## .agents/plans/desktop-terminal-browser/architecture.md vs implementation

- The "Baseline facts this design builds on (verified 2026-11-03)" section
  states "No terminal/browser/xterm/iframe code exists in the UI" and "App.tsx
  (6075 lines)". Both were true at T1 and are historical now (terminal/browser
  panels exist; App.tsx grew). The document labels these as baseline facts the
  design builds on, not current state, and the component-boundary sections it
  defines are implemented as written. Reported for awareness only: a future
  reader should not treat the baseline section as present-tense truth.
- The acceptance matrix rows still open are recorded honestly in
  `verification.md` §T12 (packaged release pass, sidecar-failure surface probe,
  platform validation on Windows/macOS, AppImage bundling failure on WSL2/FUSE)
  — no drift between matrix and verification log was found.
