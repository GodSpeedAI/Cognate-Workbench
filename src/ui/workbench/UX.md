# Workbench UX contract

Applies to every component in `src/ui/workbench/`. Extends `../../../DESIGN.md` (Cobalt) and serves
`../../../PRODUCT.md` (principles 1, 2, 3, 5). Register: product. Colour strategy: restrained.

## Who and when
A developer supervising agent work who must trust what is on screen. They scan, then decide. The
cockpit answers, at a glance: where am I, what must stay true, what may the system do, what is
proven, what is still open, what does it cost, and what is the next decision.

## Hard rules
1. **Presentational only.** Components receive data and callbacks as props. No projection hooks, no
   client calls, no `fetch`, no `Date.now()` for facts (accept times as props).
2. **Vocabulary.** Compose the classes in `base.css` (`wb-btn`, `wb-btn primary`, `wb-chip`,
   `wb-section`, `wb-field`, `wb-list`, `wb-mark`, `wb-empty`, `wb-consequential`, `wb-graphite`).
   Your own classes are prefixed `wb-<component>-` and only do layout. Do not restyle primitives.
3. **Tokens only.** Colours, radii, fonts, shadows come from `var(--cg-*)`. No hex or oklch literals.
4. **One filled-accent button per surface.** Everything else is `wb-btn` (ghost). Never two
   `primary` buttons visible in one component.
5. **No decoration.** No side-stripe borders (border-left/right wider than 1px as an accent), no
   gradients, no gradient text, no glass, no shadows except `wb-consequential`, no nested cards,
   no icons from libraries, no emoji. Marks are text glyphs (`✓ ✗ ○ →`) that always travel with a word.
6. **State is words, not colour alone.** Every status shows its name as text. Colour only reinforces.
7. **Disabled controls explain themselves in visible text** next to the control (never a tooltip
   only). A control that does nothing must not render.
8. **Empty states teach**: say what the thing is and the one action that creates it.
9. **Honesty.** Show `n/a` or an em-free placeholder like `unknown` when a number is not reported.
   Never render a zero as if it were measured. Never claim verified/accepted without the data saying so.
10. **Copy.** Short, concrete, sentence case. No em dashes or double hyphens. No exclamation marks.
11. **Accessibility.** Semantic elements (`ol`, `ul`, `table` with `th scope`, `button`, `fieldset`
    with `legend`). Every control has an accessible name. Keyboard operable (Enter/Space on buttons;
    arrow keys not required). Status changes live in an element with `role="status"` or
    `aria-live="polite"`. Visible focus comes from `base.css`.
12. **Motion.** None required. If used: 150 to 250 ms on opacity or color only, respects
    reduced motion (base.css already neutralises it).
13. **Responsive.** Works from 360px wide: wrap, never overflow the page horizontally (wide
    content scrolls inside its own container).

## Code conventions
- React 19 function components, named exports, `import type` for types, `.ts`/`.tsx` extensions in
  relative imports. Mirror the import header of `../CognitiveFrame.tsx`.
- Strict TypeScript with `noUncheckedIndexedAccess`: guard or `!` only where provably in range. No
  `any`, no `@ts-ignore`.
- Domain types: `../../workbench/types.ts`, `state.ts`; pure helpers in `../../workbench/*.ts`.
- Each component file starts with a 2 to 4 line comment: what it shows and which journey it serves.
- A component test `test/ui-<name>.test.tsx` renders with `renderToStaticMarkup` from
  `react-dom/server` and asserts the visible words, roles and aria attributes that carry meaning
  (including the honest-empty and disabled-with-reason states). Run with `bun test <file>`.
- Verify with `bun run typecheck` (never `bunx`). Fix only errors in your own files.
