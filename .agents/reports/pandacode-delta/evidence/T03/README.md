# T03 — Compact approvals: evidence

Date: this session. Target repo @ `6fc51ab` + T03 changes; donor `.tmp/donor/pandacode` 0.3.56 @ `ceed919`.

## Scope actually shipped

Two mechanisms. The donor's **third** — "N approvals needed / Approve all" — is **excluded, with a
reason**, not deferred:

> `pendingApproval` is a single `.find()` over `toolEntries`
> (`toolEntries.find((e) => e.approval?.status === "pending")`) and the tool loop is sequential, so
> two approvals can never be pending at once. A group header for a state that cannot occur would be
> dead code that also implies unsupported behaviour. Recorded in `delta-matrix.md` §3.3.

| File | Change |
|---|---|
| `src/approvalSummary.ts` | **new** — `APPROVAL_SUMMARY_LIMIT`, `summarizeApproval`, `approvalNeedsDisclosure` |
| `src/ui/App.tsx` | `ApprovalBar` gains an in-flight guard (`deciding`) and a long-text disclosure; `ToolEntry` exported for tests |
| `src/ui/app.css` | `.approval-summary-line`, `.approval-full-text`, `.approval-disclosure` |
| `test/approval-summary.test.ts` | **new** — 12 tests |
| `test/approval-bar-render.test.tsx` | **new** — 6 tests |

No existing test was modified. No permission, gate, or `PermissionMode` semantics were touched.

## Gate

```
just typecheck → exit 0
bun test test/approval-summary.test.ts test/approval-bar-render.test.tsx test/ui-observability.test.tsx
                → 18 pass, 0 fail
```

## Teeth (from the plan) — each one, with its resolution

1. **Activate Approve twice before the first promise resolves → exactly one
   `resolveContinuation` call.**
   Guarded by `deciding` in `ApprovalBar.decide`, which is the single funnel for *both* the buttons
   and the Enter/Escape keys — the keyboard path re-checks it, otherwise Enter+click would still be a
   double submit.
   **Honest limit:** proving "exactly one call" needs a live render with a controllable promise; this
   repo has no DOM-testing dependency (static markup only). The guard is therefore argued from the
   code path rather than asserted by a test. Recorded in `remaining-opportunities.md`.
   **Deliberate asymmetry, flagged for review:** the guard is *not* reset in a `finally`. The bar
   unmounts when the continuation resolves (a new `entry` replaces it), and resetting on completion
   would re-enable the buttons in the window between resolution and unmount — the exact double-submit
   window the guard exists to close. If the decision *fails*, the buttons stay disabled, which is the
   safe direction (a reload restores them). The plan asked for a `finally` reset; this deviates, on
   the reasoning above.

2. **An approval whose `surface` is present → no disclosure wrapper; structured content in full.**
   `approvalNeedsDisclosure(summary, structured)` returns `false` whenever `structured` is true, and
   `ApprovalBar` renders `<SurfaceView>` in a branch that precedes the disclosure branch entirely.
   Asserted twice: in `approval-summary.test.ts` ("TEETH: a structured surface suppresses the
   disclosure entirely") and in `approval-bar-render.test.tsx` ("TEETH: a structured surface is
   rendered in full and never wrapped in a disclosure"), which checks the absence of
   `approval-disclosure`, `approval-summary-line` and the "Show full request" label.

3. **A 500-char justification with backticks → summary ≤ 240 chars, backticks gone, full text
   reachable.**
   `summarizeApproval` clips *before* appending `…`, so the rendered line is ≤ 240 + 1, not 240 + 1
   on top of an already-full 240. Boundary tests cover exactly-at-limit (not truncated) and
   one-over-limit (truncated). Backtick stripping is asserted at the pure level and the fallback for
   all-backticks input is covered. Full-text reachability is asserted in the render test via the
   `title` attribute, matching the donor (`approval-bar.ts:24`).

## Correction made during implementation

The first render-test version asserted `expect(html).not.toContain(long)` — that the full 500-char
string appears nowhere in the markup. It failed, correctly: the full text **is** in the `title`
attribute, which is deliberate and donor-faithful, and is one of the two ways the full request stays
reachable. The test was wrong, not the component. It now asserts the *visible* summary is bounded and
ellipsised, and separately that the full text is reachable via `title`.

## Honest limits

- **No automated test for the double-activation guard** (see tooth 1). This is the single biggest
  evidentiary gap in this slice and is called out rather than papered over.
- **Only the plain-text path is compacted.** With a `surface`, the compacting is skipped by design, so
  a long *structured* approval is as long as it was. That is the intended trade: clipping rich diff
  content would hide exactly the detail the approval is about.
- **The summary is computed from a composed sentence**, not from the raw justification alone
  (`Allow this operation with <permission> permissions: <justification>.`), so the 240-char budget is
  shared. A very long permission name would eat into the justification's share. Permission names are
  short constants in practice; worth knowing if one is ever made configurable.
