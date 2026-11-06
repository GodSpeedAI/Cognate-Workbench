# T01 — Collapsed tool activity: evidence

Date: this session. Target repo @ `6fc51ab` + T01 changes; donor `.tmp/donor/pandacode` 0.3.56 @ `ceed919`.

## What changed

| File | Change |
|---|---|
| `src/toolGroups.ts` | **new** — `groupToolRuns`, `summarizeToolRuns`, `TOOL_KINDS`, `toolDetail`, `toolActionLabelFor`, `toolStepLabelFor` |
| `src/ui/App.tsx` | `toolActionLabel` + `verboseStepLabel` reduced to thin wrappers over the table; new exported `ToolGroup`; `MessageBubble` renders groups instead of the flat list |
| `src/ui/app.css` | `.tool-groups`, `.tool-group-header`, `.tool-group-summary`, `.tool-group-failed-mark`, `.tool-group-spinner`, `.tool-group-steps`, `.tool-group-narration` beside the existing `.verbose-step-list` rules |
| `test/tool-groups.test.ts` | **new** — 29 mechanism tests |
| `test/tool-group-render.test.tsx` | **new** — 6 static-markup render tests |

No existing test was modified.

## Gate

```
just typecheck   → tsc -p tsconfig.json, exit 0 (no output)
bun test test/tool-groups.test.ts test/tool-group-render.test.tsx test/ui-observability.test.tsx
                 → 36 pass, 0 fail, 113 expect() calls
```

## Teeth (from the plan) — each one, with its resolution

1. **7 consecutive `read` calls, cap 5 → 2 runs, not 1.**
   `test/tool-groups.test.ts` → "TEETH: 7 consecutive calls with cap 5 produce 2 runs, not 1".
   Asserts lengths `[5, 2]` **and** that the second run's key is `call-5`, i.e. the cap really binds
   rather than the assertion passing on a single run that happens to be reported twice.

2. **`read`, `edit`, narration, `read` → 3 runs; narration never a group child.**
   "TEETH: a narration entry breaks the run and is never a group child" asserts kinds
   `["tools","message","tools"]` and item counts `[2, 1]`, so the narration was absorbed by neither
   neighbour. Also asserted twice over: the narration row's own text is checked to be present.

3. **6 failures in one run → summary contains `6 failed`.**
   "a run that is entirely failed still states the count" asserts the exact string
   `Ran 6 commands · 6 failed`. Separately, "TEETH: failures are appended so the summary cannot read
   as success" pins the mixed case `Ran 2 commands and read 1 file · 2 failed`, and the render test
   confirms the mark reaches static markup (`tool-group-failed-mark`) so it is not colour-only.

4. **Table-driven labels byte-identical to pre-change behaviour.**
   Two independent proofs, because this is the refactor's real risk:
   - `test/tool-groups.test.ts` → "TEETH: table-driven labels reproduce the pre-change strings
     exactly" walks `TOOL_KINDS` and compares against the **verbatim** pre-change fixtures lifted
     from `App.tsx:3208-3218`.
   - "TEETH: live labels are byte-identical to the pre-change behaviour" covers all 7 tools × both
     `showDetail` settings (= all 4 work-details modes) against fixtures from `App.tsx:2349-2365`.

## Correction made during implementation

The first version of the failure-summary test expected `Ran 1 command` for a run of 2 failed
`bash` calls — mine, not the code's, was wrong. The donor groups by **kind**, not by outcome, so
failed calls still populate their clause; the `· N failed` suffix is what stops the line reading as
success. The expectation was corrected to `Ran 2 commands … · 2 failed` and the reason recorded in
the test comment.

## Honest limits

- **Not persisted.** Groups are derived from `message.steps`, which is an in-memory snapshot taken at
  finalize time (`ChatMessage.steps`, `App.tsx:151-157`). A reload loses per-step detail entirely and
  the turn falls back to its `stepCount`. Pre-existing limitation, documented in the `steps` doc
  comment; T01 does not change it and does not claim to.
- **The narration branch is unreachable at today's single call site.** Every `ToolEntry` has a
  `toolCallId`, so `toolStepKey` never returns `undefined` for `message.steps`. The branch exists
  because `groupToolRuns` is written for heterogeneous entries (as the donor's live stream is); it is
  covered by unit tests but not by production data. Noted in-place in `App.tsx` rather than left to
  look load-bearing.
- **No auto-open/close by recency** (donor §1.7). Out of scope by the plan; groups open collapsed, or
  all-open under "Verbose".
- **Cap of 5 is a constant, not a setting.** The donor hard-codes 5 too.

## Notes for the reviewer

- `ToolGroup` is `export`ed only so the static-markup test can render it, following the existing
  convention in this file (`SessionRowButton`, `SubagentTree`, `ReviewPanel`, … are exported the same
  way).
- The disclosure is `<button aria-expanded>` per `TodoWidget` (`App.tsx:2490-2511`), **not**
  `<details>` — the plan's hot_context called this and the codebase agrees.
- `ToolStepLike` is a structural subset of `ToolEntry`, so `message.steps` passes without a cast. If
  `ToolEntry` gains a required field, the assignment still holds; if it changes `tool`/`args`/`status`,
  the compiler catches it at the call site.
