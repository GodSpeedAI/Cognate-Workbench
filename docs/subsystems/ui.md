# Subsystem: user interface

## Purpose

Present what the runtime derived, and let the operator start runs and resolve continuations. The UI
is a reader. It has no privileged path to durable state.

## Responsibilities

- Subscribe to projections with `useProjection`, and to open continuations with
  `useContinuations`.
- Start runs and resolve continuations through the Cognate client.
- Render the chat shell, the workbench cockpit, the cognitive frame, and the settings surfaces.
- Obey the visual system in [`DESIGN.md`](../../DESIGN.md) and the component contract in
  [`UX.md`](../../src/ui/workbench/UX.md).

## Non-responsibilities

It does not validate domain input — capabilities do. It does not decide whether a state change is
allowed. It does not compute anything durable.

## Position in the system

```
built from a generated entry: .generated/entry.tsx  (written at boot, bundled by Bun.build)
   └── src/ui/App.tsx        shell: sidebar, transcript, composer, settings, right panel
         ├── src/ui/workbench/*   cockpit (15 components + data.ts + 9 CSS sheets)
         ├── src/ui/CognitiveFrame.tsx
         ├── src/ui/webmcp.ts
         └── src/ui/{markdown,icons,RemoteWorkspaceForm}.ts(x)
```

## Core abstractions

`App.tsx` is a single large component file (~5,700 lines). It is not decomposed, and that is the
current state rather than an endorsed structure. The cockpit under `src/ui/workbench/` *is*
decomposed, into pure presentational components that take data and callbacks as props and hold no
runtime hooks of their own.

The component contract for anything in `src/ui/workbench/` is `UX.md`, enforced by convention in
`AGENTS.md`. Its hard rules, which matter when you add a surface:

1. Presentational only: props in, callbacks out. No projection hooks, no `fetch`, no `Date.now()`
   for facts.
2. Compose the shared primitives from `base.css`. Own classes are `wb-<component>-` and do layout
   only.
3. Tokens only — colours, radii, fonts, shadows from `var(--cg-*)`. No hex or oklch literals.
4. One filled-accent button per surface.
5. No side-stripe borders, gradients, gradient text, glass, nested cards, icon libraries or emoji.
6. State is words, not colour alone.
7. Disabled controls explain themselves in visible text next to the control.
8. Empty states teach: say what the thing is and the one action that creates it.
9. Honesty: render `unknown` or `n/a` for an unreported number. Never render a zero as if measured.
10. Semantic elements, accessible names, `role="status"` or `aria-live="polite"` for status changes.
11. Motion optional, 150–250 ms on opacity or colour only, reduced-motion respected.
12. Works from 360 px wide; wide content scrolls inside its own container.

## Internal operation

### Data flow

`useProjection(name, { tenant })` subscribes to a projection and re-renders on fold.
`useContinuations()` surfaces durable human waits; each maps to an approval card or a plan-review
card with the keyboard contract `Enter` = affirmative, `Escape` = negative.

The transcript is built from the tool timeline, which keys entries off `tool.call.started`. That is
why the agent emits `tool.call.started` *before* deciding whether the call needs approval — emitting
it afterwards would leave a pending approval with no visible tool card to hang state on.

### CSS assembly

The server concatenates `app.css` then the workbench sheets in the order
`base, contract, tasks, review, skills, workflow, automation, cockpit`, and serves the result at
`/app.css`. Components never import CSS. Astryx's stylesheets are served separately at `/astryx.css`
and `/theme.css`.

### WebMCP

`src/ui/webmcp.ts` projects shared attention into a small, **focus-dependent** tool set exposed via
`navigator.modelContext` when the browser provides it. Every tool is a thin call into the same
server capabilities the human's clicks use (`ui.context`, `ui.request`, `ui.focus.publish`). None
reads the DOM. None can mutate truth: a mutating action is proposed to the human for confirmation and
never executed by the agent.

## State

Subscribes to all sixteen projections as needed. Holds ephemeral view state only: open panels, active
tab, focus context, diff view mode.

## Failure modes

| Symptom | Cause | Where |
|---|---|---|
| A disabled control explains itself only on hover | `title={NOT_IMPLEMENTED}` | 21 occurrences in `App.tsx`; recorded in [Known gaps](../known-gaps.md) |
| Stats footer shows `0 turns 0 steps` | No accounting implemented | `App.tsx` |
| An approval card appears with no tool entry | Should not happen; `tool.call.started` precedes gating | `agentCoding.ts` |
| A Surface shows "Representation rejected" | Data violated the closed grammar | `CognitiveFrame.tsx` |

## Extension points

- **A cockpit surface**: a pure component in `src/ui/workbench/`, a `wb-`-prefixed class, a CSS
  sheet appended to the concatenation order in `src/server.ts`, and a `test/ui-<name>.test.tsx`
  that asserts the visible words, roles and aria attributes carrying meaning.
- **A Surface block**: extend the union and `validateSurface` together, then add the renderer branch.
- **A WebMCP tool**: add it to `toolsForFocus` as a read, or route it through `proposeMutation`.

## Source trail

- `src/ui/App.tsx` — the shell
- `src/ui/workbench/Workbench.tsx` — cockpit assembly; serves the `J-WB-*` journeys
- `src/ui/workbench/{ContractBar,ContractEditor,AuthorityPlane,LedgerPanel,DoneLadder,ReviewCard,WorkerReturnForm,TaskList,WorkflowGraph,NodeInspector,RuntimeStrip,ComposerBar,CapabilityList,AutomationPanel}.tsx`
- `src/ui/workbench/{base,contract,tasks,review,skills,workflow,automation,cockpit}.css`
- `src/ui/workbench/UX.md` — the component contract
- `src/ui/workbench/data.ts` — cockpit view-model shaping
- `src/ui/CognitiveFrame.tsx` — `SurfaceView`, `BlockView`
- `src/ui/webmcp.ts` — `toolsForFocus`, `publishToWebMcp`, `AttentionBackend`
- `src/ui/markdown.ts` — `renderMarkdown` (a small hand-rolled subset: headings, lists, inline
  code/bold/links, fenced code)
- `src/server.ts` — the CSS concatenation order and the generated entry template
- [`DESIGN.md`](../../DESIGN.md) — the visual system
- `test/ui-*.test.tsx` (6), `test/E2E-*.test.ts` (3)