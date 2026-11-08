# Dispositions ledger — desktop-native-completion

Produced before any fix code (design §5). Every row carries a disposition —
FIX / REDESIGN / DEFER / REMOVE / KEEP-NATIVE for defect rows, BUILD for feature rows — and an
evidence class: `audit-row` (the A2 row it resolves), `code-citation` (path:symbol observed),
`measurement`, or `journey` (a named test that will prove the fix). Batches execute only against
settled rows; a row's disposition may be changed by recording the new decision here with a date.

Global gate: the MenuSelect accessibility pass (`test/ui-menu-select.test.tsx`, New —
screen-reader value announcement + full keyboard contract) lands before any CONVERT executes. A
failed gate flips the affected rows to KEEP-NATIVE with the recorded rationale (WCAG 2.2 AA is
mandatory; the native select renders in the OS with platform keyboard and screen-reader support
and needs no custom ARIA).

## 1. Native `<select>` inventory (42 controls, 9 files — reconciled; replaces "~35" in DEBT.md)

| Row | File (lines) | Count | Disposition | Evidence | Tests touched at conversion |
|---|---|---|---|---|---|
| S1 | `src/ui/workbench/ContractEditor.tsx` (323, 344, 365, 389, 410, 434, 458, 482, 503, 552, 591, 725, 798) | 13 | CONVERT (largest batch; may split in two commits) | code-citation | `test/E2E-workbench.test.ts` drives `#auth-fs-write` (:344) and `#auth-shell-run` (:389) with selectOption — updated in this batch; other 11 add coverage per row |
| S2 | `src/ui/experts/ExpertsTeamsPanel.tsx` (321, 388, 408, 445, 509, 510, 524, 621) | 8 | CONVERT | code-citation | `test/E2E-experts.test.ts` / `test/E2E-experts-debt.test.ts` where they drive these panels |
| S3 | `src/ui/workbench/AutomationPanel.tsx` (201, 217, 260, 592, 608, 651) | 6 | CONVERT + add coverage (no select-driving E2E exists for this panel today) | code-citation | New assertions in `test/E2E-workbench.test.ts` or a component test, per the batch |
| S4 | `src/ui/experts/SchedulesPanel.tsx` (73, 74, 76, 80, 82) | 5 | CONVERT | code-citation | `test/E2E-experts*.test.ts` schedule journeys |
| S5 | `src/ui/workbench/Workbench.tsx` (461, 480 — the D-28 workflow selects; 626 — Move destination) | 3 | CONVERT (D-28 closes here) | audit-row + code-citation | `test/E2E-workbench.test.ts` |
| S6 | `src/ui/workbench/LedgerPanel.tsx` (157, 175, 190) | 3 | CONVERT | code-citation | `test/E2E-workbench.test.ts:157-159` drives the ledger form — updated in this batch |
| S7 | `src/ui/experts/ExpertEditor.tsx` (75 route, 84 protocol) | 2 | CONVERT | code-citation | `test/E2E-experts.test.ts` |
| S8 | `src/ui/AmbiguousStepCard.tsx` (43 outcome) | 1 | CONVERT | code-citation | Component/journey suites that drive the card — verified at conversion |
| S9 | `src/ui/workbench/CheckoutChip.tsx` (232 start-from-branch) | 1 | CONVERT | code-citation | `test/E2E-checkout.test.ts` / `test/J-CHECKOUT-*` if UI-driving — verified at conversion |

Guard: `test/native-select-guard.test.ts` (New) fails the suite if any `<select` exists outside
`MenuSelect.tsx` after the track ends, unless this ledger records a KEEP-NATIVE exception for it.

## 2. Open A2 audit rows (reconciled set from `.agents/DEBT.md`)

| Row | Defect (A2 §3) | Disposition | Evidence | Landing |
|---|---|---|---|---|
| D-9 | Mobile header truncates workspace/session names, clipped tabs | FIX — collapse secondary header items at narrow widths; keep full tab labels | audit-row | D batch (App.tsx) |
| D-12 | ProviderWizard footer wraps on mobile | FIX — stack or shorten labels | audit-row | D batch |
| D-13 | Inspector tab strip icon-only; stray theme icon | FIX — label tabs at default width; remove the stray icon | audit-row | D batch |
| D-15 | DialogHeader shows a closing curly quote for the opening quote | FIX — hunt the typography transform; unify quote style | audit-row | D batch |
| D-16 | ProviderWizard card descriptions truncated mid-word | FIX — two-line clamp or shorter copy | audit-row | D batch |
| D-17 | Disabled "Choose workspace" pale-on-pale | FIX — token-level disabled style with sufficient contrast | audit-row | D batch |
| D-18 | GovernancePane placeholder low contrast on dark | FIX — raise placeholder contrast | audit-row | D batch |
| D-19 | "Session plugins" rendered as a link-style label | FIX — heading style | audit-row | D batch |
| D-21 | "settled conservatively; provider usage unreported" repeated on ten run lines | REDESIGN — render once per group (or move to the group header) | audit-row | D batch (`src/components/modelProvider.ts`) |
| D-22 | Vague status copy ("Deep diving for Ns") | FIX — surface the current step or model name (step data exists in the trace projection) | audit-row | D batch |
| D-24 | Sidebar workspace badges truncate ("Waiting for appr…") | FIX — shorten badge text; allow title wrap | audit-row | D batch |
| D-25 | Diff header vs composer turn counter disagree | FIX — one counter source | audit-row | D batch |
| D-26 | Diff toolbar wraps to two rows at 340 px | FIX — collapse extra actions into a menu | audit-row | D batch |
| D-27 | Add-workspace error text sits against the footer divider | FIX — spacing above the footer | audit-row | D batch |
| D-29 | Dark "Cancel" has no visible border | FIX — border token in dark theme | audit-row | D batch |
| D-30 | Config editor Save disabled-state inconsistent across themes | FIX — consistent disabled state | audit-row | D batch |
| D-34 | Model picker search shows a double focus ring | FIX — one focus ring | audit-row | D batch |

Each FIX lands as one commit with its re-captured screenshot and named test; the contrast audit
(`UI_SHOTS_CONTRAST=1`) re-runs over re-captured shots.

## 3. Feature rows (BUILD / DEFER decisions)

| Row | Item | Disposition | Evidence | First step |
|---|---|---|---|---|
| F1 | Session Pin (design §5 definition: row-menu action; top of sidebar, sort-independent, durable; the pin half of donor row D-23) | BUILD — **landed 2026-11-07** (`3596abc`; journey validated, capability, projection, menu entry, `test/J-SESSION-pin.test.ts` green) | journey | Done |
| F2 | Durable remote diagnostics (bounded `workbench.remote.*` transition family folded into the workbench projection; rendered by RemotePanel) | BUILD — **landed 2026-11-07** (`b9c7d9b`; `RemoteControl` entity, bounded family, `RemoteHost.record` injection, durable rendering, `test/J-REMOTE-diagnostics.test.ts` green) | journey | Done |
| F3 | Blob/`anchor.download` exports (`src/ui/download.ts`) — expected dead in WebKitGTK (no embedder download handler wired by Tauri) | DEFER (revised 2026-11-06 during B4): the drafted shell-mediated fix (Rust fetch of an export URL) does not fit the actual data flow — the export content is client-held (a Blob the web app composes), not URL-addressable, and moving content web→shell would breach the channel rules. The working paths stay: clipboard copy (verified working in the shell's secure context) and the browser/CLI surfaces where anchor.download works. Limitation recorded in docs/known-gaps.md; revisit if the operator reports a real export job | code-citation + `measurement` (T1 harness probe of the anchor path per engine, when the ledger revisits) | known-gaps row landed with B4 |
| F4 | Drag-and-drop folder → Add-workspace | DEFER — no operator complaint on record; the world-aware typed path + suggestions already cover folder selection; HTML5 DnD adds an E2E and journey cost with no evidenced job; revisit on demand (this row's reversal is the ledger's to record) | code-citation (no DnD handlers exist in `src/ui/`) | None (row stays settled) |

## 4. Settled context rows (recorded so reviewers stop re-raising them)

- Session Pin, rename, copy path, archive exist as the session row menu's current actions; Pin is
  the only donor-parity gap (D-23's remainder) → F1.
- The remote diagnostics dialog already collects connection/route/last-error/recent-events
  client-side; F2 adds durability only.
- The one-live-provider-route and per-Expert-route limitations are separate DEBT rows outside this
  mission's ledger (they need SDK-adjacent decisions, not UI fixes).
