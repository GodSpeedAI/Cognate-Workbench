# Reference: UI surfaces

Which component shows what, and the contract every cockpit component obeys.

## The shell

`src/ui/App.tsx` is a single large file (~4,000 lines) holding the sidebar, the transcript, the
composer, the settings surfaces, the approval and plan-review cards, the diff review panel, and the
subagent child view. It is **not** decomposed; that is the current state, not an endorsed structure.

It subscribes with `useProjection` and `useContinuations`, and calls `createClient` / `startRun` /
`resolveContinuation`. It has no privileged path to durable state.

## The cockpit

`src/ui/workbench/` — fourteen presentational components plus a view-model shaper. Each receives data
and callbacks as props and holds no runtime hooks.

| Component | Shows |
|---|---|
| `Workbench.tsx` | Assembles the cockpit. Reads the `workbench` projection; every decision goes through a capability. |
| `ContractBar.tsx` | One chip per contract field, marking which are unsatisfied |
| `ContractEditor.tsx` | Editing a contract field |
| `AuthorityPlane.tsx` | What the task may do: grants per axis, protected paths, and elevation. Invokes `authority.check`; offers elevation |
| `LedgerPanel.tsx` | Acceptance criteria and evidence in one table; records evidence; shows what is proven |
| `DoneLadder.tsx` | The `DoneLevel` taxonomy and where the work currently sits |
| `ReviewCard.tsx` | The review decision. `Enter` accepts, `Escape` requests changes |
| `WorkerReturnForm.tsx` | Recording a worker's return against the contract |
| `TaskList.tsx` | The board |
| `WorkflowGraph.tsx` | The node graph with `needs` / `after` edges and node status |
| `NodeInspector.tsx` | One workflow node: transitions, evidence requirements, guards |
| `CapabilityList.tsx` | The capability catalog and its bindings |
| `AutomationPanel.tsx` | Automations and their lifecycle state |
| `RuntimeStrip.tsx` | Compact runtime state: status, task progress, elapsed, steps, tokens, cost |
| `ComposerBar.tsx` | The task-scoped composer |
| `data.ts` | View-model shaping for the above |

## The cognitive frame

`src/ui/CognitiveFrame.tsx` is the conditional right-hand region for the cognitive layer.

Its attention order is **not equal cards**: DESTINATION, PRESENT, DEVIATION, NEXT MOVE, SETTLEMENT,
then conditionally AUTHORITY, SEARCH, METHOD RECOMMENDATION and the recorded REALITY.

`SurfaceView` validates before rendering. An invalid Surface renders a `role="alert"` "Representation
rejected" message rather than anything close to its content.

## WebMCP

`src/ui/webmcp.ts` projects shared attention into a small, **focus-dependent** tool set exposed via
`navigator.modelContext` when the browser provides it.

- Every tool is a thin call into the same server capabilities the human's clicks use
  (`ui.context`, `ui.request`, `ui.focus.publish`).
- **None reads the DOM.**
- **None can mutate truth.** A mutating action is proposed to the human for confirmation and never
  executed by the agent.

## CSS

The server concatenates, in this order:

```
src/ui/app.css
src/ui/workbench/base.css
src/ui/workbench/contract.css
src/ui/workbench/tasks.css
src/ui/workbench/review.css
src/ui/workbench/skills.css
src/ui/workbench/workflow.css
src/ui/workbench/automation.css
src/ui/workbench/cockpit.css
```

and serves the result at `/app.css`. Components never import CSS. Astryx's stylesheets are served
separately at `/astryx.css` and `/theme.css`.

## The component contract

`src/ui/workbench/UX.md` is binding for everything in that directory. Its hard rules, which are what
a reviewer checks:

1. **Presentational only.** Props in, callbacks out. No projection hooks, no client calls, no
   `fetch`, no `Date.now()` for facts.
2. **Vocabulary.** Compose the primitives from `base.css`. Own classes are `wb-<component>-` and do
   layout only. Do not restyle primitives.
3. **Tokens only.** Colours, radii, fonts and shadows come from `var(--cg-*)`. No hex or oklch
   literals.
4. **One filled-accent button per surface.** Everything else is `wb-btn`.
5. **No decoration.** No side-stripe borders, no gradients, no gradient text, no glass, no shadows
   except `wb-consequential`, no nested cards, no icon libraries, no emoji. Marks are text glyphs
   that always travel with a word.
6. **State is words, not colour alone.**
7. **Disabled controls explain themselves in visible text** next to the control, never in a tooltip
   alone. A control that does nothing must not render.
8. **Empty states teach** — say what the thing is and the one action that creates it.
9. **Honesty.** Render `unknown` or `n/a` for an unreported number. Never render a zero as if it were
   measured.
10. **Copy.** Short, concrete, sentence case. No em dashes or double hyphens. No exclamation marks.
11. **Accessibility.** Semantic elements; every control has an accessible name; keyboard operable;
    status changes in a `role="status"` or `aria-live="polite"` element; visible focus from
    `base.css`.
12. **Motion.** None required. If used: 150–250 ms on opacity or colour only, reduced-motion
    respected.
13. **Responsive.** Works from 360 px; wrap, never overflow the page horizontally.

### Code conventions

React 19 function components, named exports, `import type` for types, explicit extensions in
relative imports. Strict TypeScript with `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore`. Domain
types from `src/workbench/types.ts`. Each file opens with a short comment saying what it shows and
which journey it serves.

## The visual system

`DESIGN.md` at the repository root is the locked visual system. It defines the Cobalt theme, three
surface registers (ambient, consequential, graphite), the type scale, spacing tokens, the component
voice, motion philosophy, density, CTA hierarchy and responsive contract.

The **consequential** register — the one deliberate shadow — exists for exactly the surfaces
`PRODUCT.md`'s principle 2 cares about: approval gates and plan review. That is the visual expression
of a product principle, and it should not be spent elsewhere.

## Known conflict

`App.tsx` currently renders **21 disabled controls** whose only explanation is a `title` attribute.
That violates contract rule 7 and `PRODUCT.md` principle 3. It is recorded rather than silently
accepted; see [Known gaps](../known-gaps.md).

## Source trail

- `src/ui/App.tsx` — the shell
- `src/ui/workbench/` — all cockpit components, `data.ts`, `UX.md`
- `src/ui/workbench/base.css` … `cockpit.css` — the nine concatenated sheets
- `src/ui/CognitiveFrame.tsx` — `SurfaceView`, `BlockView`
- `src/ui/webmcp.ts` — `toolsForFocus`, `publishToWebMcp`
- `src/ui/markdown.ts` — `renderMarkdown` (headings, lists, inline code/bold/links, fenced code)
- `src/ui/icons.tsx` — the hand-rolled icon set
- `src/ui/RemoteWorkspaceForm.tsx` — the connection form
- `src/server.ts` — the CSS concatenation order and the generated entry template
- `DESIGN.md`, `PRODUCT.md`, `src/ui/workbench/UX.md` — the three documents this layer serves
- `test/ui-*.test.tsx` (6), `test/E2E-*.test.ts` (3)