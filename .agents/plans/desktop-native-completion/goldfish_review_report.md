# Goldfish Annotated Review Report

**Target:** `.agents/plans/desktop-native-completion/design.md` (full file)
**Status:** resolved 2026-11-06 — 17 PROPOSE FIX items applied to design.md; 1 ESCALATE (C17)
decided by the owner: D-track stays in-mission, E3 closes on desktop qualification with D rows
carried.

## Prioritized Findings & AI Suggestions

Findings are consolidated in `consolidated_review_report.md` (C1–C18 + Nits); this report records
the Elephant's adjudication of each.

### [C1] Close guard fail-open + contract scoping — Severity: 🔴 Blocker
* **Affected Scope:** Goal 1, §1 channel 2, §2 close semantics, §3, B4/B5 rows
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Verified by four independent lenses against the code; the design's own
  Goal 1 declares this failure impossible. The converged mechanism (`/health` machine authority,
  fail-closed; title demoted to cue; per-owner close contract; `lib.rs` as the close hook;
  `/health` extended with state counts) is simpler than the heartbeat alternative and uses only
  mechanisms the design already ships.
* ***Proposed Edit:*** Rewrite Goal 1, §1 channel framing ("no capability grants to web content"
  invariant + canonical channel list), §2 close contract (per-owner scoping + fail-closed rule +
  `--app` fallback decision), B4 backend/lib rows, B5 server row (`/health` state fields);
  add T1 harness rows (kill web app mid-run → confirm; reused-owner close).

### [C2] Title channel is net-new work; needs sentinel + parser + tests — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — restate channel 2 as new construction (title owner, versioned
  sentinel + human suffix, strict parser, format guard test, notification bodies from parsed
  fields only).

### [C3] Ctrl+N default — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — keep Ctrl+Alt+N as the global default; reopen the reservation
  per-surface inside Tauri only; name the mechanism and the exact test changes.

### [C4] Downloads disposition missing — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — ledger inputs gain downloads + DnD; disposition names the
  shell-mediated fix (Rust fetch + dialog save) or REMOVE/DEFER; explicitly reject the loopback
  endpoint as a fix (same dead webview path).

### [C5] Deb package identity undecided — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — decide the exact distinct package name in-document, state the
  productName ripples, version plumbing, runbook glob, harness coexistence step.

### [C6] Missing Risks & Open Questions sections — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — add both sections; enumerate the named risks with tranche
  owners; assign the two unowned decisions (notification v2 gate, Windows attempt) and add
  session-end close rows.

### [C7] No acceptance criteria — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — per-tranche "proves" column; goals made testable; the sibling
  acceptance matrix named with adopted rows.

### [C8] Ground-truth errors in the implementation tables — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — all items verified by primary source this session: revisions
  (start 40, close 41 — 39 exists), tokens.css absent (use app.css; add DESIGN.md drift to the
  A-tranche), ContractEditor path, the three real selectOption E2E files + zero automation/contract
  coverage today, remove `appimage` from bundle.targets, close handling in lib.rs, find_sidecar
  done, "New" markers, not-touched qualifications.

### [C9] B1/B2 sequencing + harness contract — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — stage the rows; harness gets a raw-binary mode; relaunch step
  asserts clean respawn + lock re-created; second-instance focus verified where stated.

### [C10] T2 has no mechanism — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — add a `COGNATE_TEST_SIDECAR=<path>` mode row in B2 or scope
  T2 down honestly.

### [C11] Channel enumeration + "Navigate to view" — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — canonical channel list stated once and quoted; v1 menu map
  carries only actions that exist (drop "Navigate to view" or specify new ids + shortcut-table
  consequences).

### [C12] ui-dispatch items inert when webview is down — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — disable until the `/health`/watchdog liveness signal;
  rust-only items always work.

### [C13] Disposition vocabulary + evidence class — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — five values + BUILD (or a feature column); evidence classes
  defined.

### [C14] Goal language + Pin definition — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — Goal 1 restated to the uniform contract; Goal 6 → "real,
  shipped features"; Pin behavior defined and linked to D-23.

### [C15] Evidence tense + MSRV command — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — future/imperative for planned checks; deadlines marked
  "to be measured"; one MSRV command everywhere (cargo build).

### [C16] Sub-milestone labels — Severity: 🟡 Major
* ***AI Suggestion:*** PROPOSE FIX — label B1..B5, E1..E3; name the review sources.

### [C17] D-track scope bundling — Severity: 🟡 Major
* ***AI Suggestion:*** ESCALATE — keep the D track in-mission (the owner's brief explicitly
  includes it) with E3 explicitly able to close on desktop qualification while D rows carry, or
  split D into its own mission. The owner decides; this report carries both options.

### [C18] Terminology/pointer/precision hygiene — Severity: 🟡 Major (bulk)
* ***AI Suggestion:*** PROPOSE FIX — applied as one editorial pass (donor definition, superlative
  replaced, EGM/pg0/mobile glosses, notification authorship, macos-14 matrix value, "honest"
  mechanisms, watchdog numbers, named surfaces, per-platform rows, unified terms, preamble
  wording).

### Nits (S5/S6/S7/S8/S9 remainder)
* ***AI Suggestion:*** PROPOSE FIX — folded into C8/C13–C18 edits.

## Resolution summary

- PROPOSE FIX: 17 consolidated items (+ nits folded)
- ESCALATE: 1 (C17 — owner decision)
- CONTEST: none (disputed facts were verified against primary sources; the reviewers were right)
- DECLINE: none
