# Design — Cognate Console

A locked design system for this app, produced by a Hallmark redesign pass. Every subsequent visual
change reads this file first. Do not invent a competing system — extend or amend this file when it
needs to grow. See `PRODUCT.md` for product truth this system serves, and `redesign/hallmark-audit.md`
for why the previous system (a forensic reconstruction of a third-party reference) was replaced.

**Scope note**: this is a single-shell app (chat + settings + approval/plan review + subagent
panel), not a multi-page marketing site. There is one page family — **App** — not the marketing/
app/content split Hallmark's template assumes for a multi-page site. Per Hallmark's own app-page
allowance: function carries the page, no enrichment (no hero art, no marketing imagery).

## Genre

**modern-minimal** — this is a developer tool driving a coding agent (`PRODUCT.md`: read/edit/bash/
run_code tool calls, API provider configuration, approval gates). Confident sans display, generous
but not decorative whitespace, monochrome-with-one-signal-accent, restrained motion.

## Theme

**Cobalt**, re-targeted from Hallmark's marketing-page spec to this app's actual surfaces (no hero,
no code-demo landing, no pricing — those macrostructures don't apply to an app shell). What carries
over is Cobalt's *voice*: cool engineered paper, hairlines instead of boxed cards, exactly one
electric-cobalt signal accent, code/data treated as the visually "hero" element wherever it appears
(tool calls, diffs, JSON), and tight technical radii. This voice was picked because the product
*is* the thing Cobalt's spec names as its target category — "API · SDK · CLI · dev tool ·
developer platform... webhooks... ship" — almost verbatim `PRODUCT.md`'s own description of this
app.

```
--color-paper       oklch(98.5% 0.004 250)   /* cool engineered near-white */
--color-paper-2     oklch(96.5% 0.006 250)   /* sidebar / sunken surfaces */
--color-ink         oklch(24%   0.02  258)   /* primary text — cool charcoal, never #000 */
--color-ink-2       oklch(34%   0.018 257)   /* secondary/body text */
--color-muted       oklch(52%   0.014 257)   /* tertiary text, timestamps, hints */
--color-rule        oklch(88%   0.008 255)   /* hairline borders */
--color-rule-2      oklch(80%   0.010 255)   /* stronger hairline (focus-adjacent, dividers) */
--color-accent      oklch(52%   0.19  256)   /* electric cobalt, darkened from Cobalt's 58% to
                                                 clear WCAG 4.5:1 with white button text */
--color-accent-ink  oklch(99%   0.006 256)   /* text/icon color on filled accent */
--color-graphite    oklch(22%   0.016 260)   /* the one dark band: code/diff/tool-call surfaces */
--color-graphite-ink oklch(94%  0.01  258)   /* text on graphite */
--color-danger      oklch(52%   0.19   25)   /* errors — kept out of the blue family on purpose */
--color-danger-bg   oklch(96%   0.03   25)
--color-success     oklch(55%   0.14  152)
--color-focus       oklch(52%   0.19  256)   /* = accent; one ring color, not a second signal */
```

Dark mode: same hues throughout (never rehue), paper drops to `oklch(16% 0.012 258)`, ink rises to
`oklch(94% 0.008 258)`, graphite becomes the *lighter* elevated surface per Hallmark's dark-mode
recipe (higher surfaces are lighter, not darker) at `oklch(26% 0.018 260)`, accent chroma −0.03 /
lightness +8% to stay legible on dark paper.

## Typography

- **Display** — Space Grotesk 500/600, tight tracking (`-0.02em`). Used for the brand mark, section
  headings (`h2`/`h3` in Settings, modal titles), and nothing else — this is a UI, not a magazine;
  display type stays reserved for genuine headings, not every label.
- **Body** — Inter 400/500 (Cobalt's own explicit choice, an exception to Hallmark's general
  "avoid Inter" default — this theme spec calls for it deliberately as the technical/engineered
  body face, paired against Space Grotesk display and JetBrains Mono, not used alone).
- **Mono** — JetBrains Mono 400/500, used for: all code/diff content, tool-call arguments and
  results, the composer's stats footer, and small UPPERCASE meta labels (status chips, mode badges)
  at `0.06em` tracking — the "machine-readout" register that marks *system-observed fact* as
  distinct from *written UI copy*.
- Two families used broadly (display, body) plus mono as the outlier role, applied consistently
  (data/code contexts only) — three families total, at the ceiling, per Hallmark's 2+1 rule.
- Scale: 1.25 ratio from a 16px body (`--text-xs` 12.8px … `--text-2xl` 24.4px); this is a UI, not
  a marketing page, so no `--text-display` hero size is defined — the largest text in the app is a
  modal `<h2>` at `--text-xl`.

## Spacing / rhythm

4pt scale, named tokens only (no raw px in component CSS):
`--space-3xs 4px · -2xs 8px · -xs 12px · -sm 16px · -md 24px · -lg 32px · -xl 48px · -2xl 64px`.

## Surface / elevation register

This is the structural fix the Hallmark audit called for (`redesign/hallmark-audit.md` finding 5):
**three distinct registers, not one flat one**, so different kinds of space read differently:

1. **Ambient** (sidebar, message stream background, settings body) — `--color-paper`/`-2`, hairline
   borders only, no shadow. This is where the user reads and scans.
2. **Consequential** (approval gate, plan-review card) — `--color-paper`, a `--color-rule-2`
   (stronger-than-ambient) hairline border on all sides, plus `--cg-shadow-consequential` (a
   deliberately stronger lift than ambient cards). The signal that this card is different comes from
   the header's accent-colored dot + label and the lift, not a colored edge — an earlier draft used
   an accent-colored left border here and Impeccable's mechanical detector correctly flagged it as
   the "side-tab accent border" AI-slop tell, so it was removed. This is the one place a shadow is
   used deliberately, to make the one place `PRODUCT.md`'s Product Principle #2 cares about
   ("approval gates read as consequential") actually read that way.
3. **Graphite** (tool-call args/results, diffs, code blocks, JSON) — `--color-graphite` background,
   mono type, per Cobalt's "code is the hero" signature move. This is the *only* place a dark-on-light
   inversion happens in light mode, and it's deliberate: it marks "this is the agent's own output/
   observation," distinct from both UI chrome and human-authored chat text.

Radii: **6px** on buttons/inputs/controls, **10px** on cards and the graphite code surface — Cobalt's
"drawn with a ruler" tight technical radius, replacing the old 4/8/12/16/20/28 six-step scale
inherited from the reference.

## Component voice

- **Buttons**: solid `--color-accent` fill for the single primary action per surface (Send, Allow
  once, Approve, Save), 6px radius, no pill shape. Everything else is a bordered/ghost button —
  hairline border, transparent fill, ink text. No secondary-button color competing with the accent.
- **Disclosures** (new shared primitive, resolves backlog item "no shared disclosure primitive"):
  one component, one visual pattern — a ghost button with a chevron that rotates on
  `aria-expanded`, mono-label text. Used by Settings' "Customized settings," plan review's "View
  full plan," and the subagent tree's row affordance alike.
- **Status/mode chips** (session mode badge, approval-pending badge, work-details label): mono,
  uppercase, `0.06em` tracking, bordered pill — the "machine-readout voice" applied consistently
  instead of ad hoc per-surface styling.
- **Modals**: all three (Settings, both first-run dialogs) share one contract now — `aria-modal`,
  a focus trap, Escape-to-close, and focus-return to the trigger on close (resolves the technical
  audit's inconsistency finding).

## Navigation conventions

Unchanged IA (sidebar sessions tree / center transcript / conditional right panel) — this was
judged structurally sound in `redesign/hallmark-audit.md` and is preserved. What changes is that
every control in it must do something: the inert-control catalog (36 disabled `NOT_IMPLEMENTED`
buttons) is resolved per-control in the refinement pass, either by wiring it, removing it, or (rare)
keeping it disabled with a real, specific reason shown in visible text, never a tooltip-only
explanation.

## Interaction conventions

- One keyboard contract for every "the agent is waiting on you" card: `Enter` = affirmative action,
  `Escape` = negative action, applied to both `ApprovalBar` and `PlanReviewCard` (today only
  `ApprovalBar` has it).
- `aria-live="polite"` on the streaming message region and on status-pill transitions (Deep diving →
  Took Ns) — resolves the audit's highest-severity accessibility finding (zero live regions
  anywhere).
- Loading is always visible, never only a disabled button: a small inline spinner/progress
  affordance accompanies every `busy` state.

## Motion philosophy

Minimal, composed, never decorative — matches Cobalt's own stance and this being an Operate-mode
tool where motion competes with legibility of live agent output. Reveals are off entirely (nothing
fades in on scroll — this isn't a landing page). The only motion that survives:
- Streaming text itself (inherent, not a UI animation).
- A single opacity+8px-rise transition (`--ease-out`, 180ms) on new message bubbles and disclosure
  expand/collapse — never on layout-affecting properties.
- Reduced-motion drops even that to an instant state change.

## Density

Comfortable, not compact — this is a reading/reviewing surface (transcripts, diffs, tool output),
not a data-dense dashboard. Body line-height 1.5. Table/list rows (session tree, models list) use
`--space-sm` vertical padding, not the tighter `-xs`.

## CTA hierarchy

Exactly one filled-accent action visible at a time per surface (Send in the composer, Allow once in
the approval card, Approve in plan review, Save/Apply in settings). Every other action on that
surface is a bordered/ghost button. No two filled-accent buttons ever compete in the same view.

## Color usage

Accent (`--color-accent`) stays under Hallmark's ~5% surface-coverage discipline: it appears only
on the one primary button per view, focus rings, the active nav/tab indicator, and mono status
chips' text (never their fill). It never becomes a background fill covering a card or panel.

## Responsive principles

(Executed in Phase 7, recorded here as the target contract.) Three registers: desktop (current
3-pane layout, ≥1024px), collapsed-sidebar (1024px → 768px, existing rail-collapse behavior kept),
and narrow (<768px): sidebar becomes an overlay/drawer instead of a persistent rail, the right panel
becomes a full-screen overlay instead of a third column, the chat column's fixed 790px max-width
becomes fluid with a `min()`-based cap.

## Recurring macro-layout families

Only one family exists in this app (there is no marketing/content split): **App** — sidebar +
center column + conditional right panel, unchanged from before this redesign. Every screen in this
product (chat, settings modal, approval gate, plan review, subagent panel) is a state within this
one family, not a separate macrostructure — consistency comes from the shared token/component layer
above, not from every state reinventing layout.

## Per-surface allowances

- No enrichment anywhere (no hero art, no illustration, no marketing imagery) — function carries
  every surface, per Hallmark's app-page rule.
- The graphite/mono "code is the hero" treatment is reserved for actual agent-observed data (tool
  args/results, diffs, JSON) — never applied decoratively to plain UI chrome.

## Exports

### tokens.css

See `src/ui/tokens.css`, generated alongside this file and imported by `app.css`. Canonical values
live there; this file documents intent, `tokens.css` is the enforced source.

## Stamp

```
/* Hallmark · genre: modern-minimal · theme: cobalt (app-adapted, no marketing macrostructure)
 * scope: single-page app · designed-as-app · surfaces: ambient / consequential / graphite */
```
