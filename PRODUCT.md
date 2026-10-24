# Product

<!-- impeccable:product-schema 1 -->

Strategic truth for Cognate Workbench. `DESIGN.md` is the visual system this product serves and
`src/ui/workbench/UX.md` is the per-component contract. Neither is a substitute for this file: when
they conflict with a principle here, this file wins and the other is amended.

Brand voice is inherited from the GodSpeed brand voice master document
(`godspeed-growth/brand/voice/godspeed-brand-voice.md`). This file does not restate it; it records
how that voice lands on this surface.

## Register

product

## Users

Developers who want to shape how their coding agents work, not just choose which model answers the
next prompt. They arrive from one of two places: a terminal-driven coding agent they have outgrown,
or a platform team that was handed autonomy before it was handed an operating layer.

Their day looks like this: bind a task to a real workspace, state the outcome and the non-goals,
declare which capability scopes the task may use, name the acceptance criteria, then let executors
run. They watch rather than type. Most of their attention is spent deciding: what is still open,
what is proven, what did that cost, and what is the next move that is actually permitted.

They are fluent in the best tools in the category. They notice when a button looks different in two
places, when a panel claims a number that was never measured, or when a control is rendered but does
nothing. Trust here is earned by consistency and honesty, not by reassurance.

Context of use: at a desk, for hours, often while something consequential is in flight. The interface
is a cockpit, not a landing page and not a notification feed.

## Product Purpose

Cognate Workbench is the operating surface for agent work that somebody is accountable for. It is a
developer platform in the direct sense: a place where meaning, capability, authority, world
identity, evidence and settlement are declared and then enforced, so that autonomy runs inside
boundaries a person agreed to in advance.

The system under it is a durable, event-sourced runtime. A task is a contract (context, goal, skills,
authority scopes, executors, budget, invariants, acceptance criteria). Authority exists before
autonomous action: the agent cannot widen its own grants, and an approval is a durable fact that
survives reload and restart. Execution is not settlement. A candidate world is forked, run, and
promoted only when its evidence says so and a human says so. "Done" is a taxonomy, not a single
event.

Success is a developer being able to hand the agent real filesystem, shell and network access in
their own repository, and being able to answer, at any moment and without reading logs: what is
running, what it is allowed to do, what has been proven, what has not, what it cost, and what
happens next.

What this product is not, in its own words: a chatbot with a badge.

## Brand Personality

**Instrument, not concierge.** Calm, precise, engineered. It reports; it does not perform.

- **Practitioner-first.** The operator should recognize their own situation in the screen. Mechanism
  over vibe: every claim on screen points at something real (a capability, a scope, an evidence
  record, a cost).
- **Radically candid.** Name the failure patterns this product exists to prevent, by their actual
  names. "It is asking to run this" beats "Approve this action?"
- **Quietly authoritative.** Confidence comes from what is enforced, not from what is claimed.
- **Executive-safe.** Nothing in the product copy would embarrass a person who screenshotted it for
  a governance review.

Register selection: this is a governance and architecture surface, so it defaults to Journey Mode
(calm, precise, mechanism-first, evidence-disciplined). Speed Mode is permitted only on
developer-attention edges (first-run dialogs, one-line callouts that name a real absurdity) and never
inside the cockpit itself. Sharpness without trust reads as noise inside a surface whose entire job
is trust.

The three perceptions this product should reinforce, in order of weight: **governed** (authority
before action), **provable** (evidence after action), **compounding** (settled work becomes
reusable capability).

Copy rules that bind: no em dashes or double hyphens in UI strings, sentence case, short and
concrete, no exclamation marks. Never claim "done", "verified", "accepted", or "settled" unless the
data behind those words is on screen. Where a number is not reported, render `unknown` or `n/a`,
never a zero.

## Anti-references

What this product must never look or sound like:

- **The prompt-shaped agent chat.** A transcript column as the whole product, with the governance
  hidden behind a settings link. That is the reference reconstruction this app deliberately outgrew.
- **Governance theater.** Control panels that look authoritative and enforce nothing; approval gates
  that are a formality the agent never actually hits.
- **Dashboards as decoration.** Metric tiles, progress rings, and animated counters that summarize
  rather than expose. Telemetry is not visibility.
- **Proof-free completion.** Green checkmarks, confetti, "all done" states, success toasts with no
  named acceptance criterion behind them.
- **The confident intern.** An agent with root access, no policy gate, and a friendly voice
  papering over it.
- **Inert affordance.** Any control that renders and does nothing, or a disabled control whose only
  explanation lives in a tooltip.
- **Vague AI register.** "Leverage", "seamless", "next-generation", "unlock", glowing brain or robot
  imagery, unattributed superlatives, crypto-hype energy, emoji as iconography.
- **Generic SaaS polish.** Purple-blue gradient heroes, glassmorphic panels, floating cards,
  shadow-stacked everything. This product is an instrument.

Reference posture: the operator's real comparison set is Linear, Raycast, and a well-configured
terminal, not consumer AI chat products. Build to that bar of earned familiarity.

## Design Principles

1. **Visibility over cleverness.** What the agent is doing, which capability it invoked, with what
   arguments, and what it produced is legible before it is summarized, collapsed, or decorated.
   Any compression the product introduces must be reversible and visibly marked.

2. **Authority and approval read as consequential.** Grants, blocked affordances, and approval gates
   are the product's highest-stakes moments and must look like it. The user should be able to tell
   at a glance what they are allowing, why it is being asked, and what would happen if they said no.
   This is also where "done" and "settled" claims are either earned or absent.

3. **Every control has a real purpose.** A dead affordance is worse than no affordance. Every
   enabled control performs a real action; every disabled one states its specific reason in visible
   text next to it; every blocked affordance names the condition blocking it and the move that would
   unblock it.

4. **Honesty is the trust mechanism.** Never render an unmeasured value as a measured one. Never
   present a candidate, a recommendation, an execution, or an observation as a decision, an
   authority, a settlement, or a proof. This product's durability is real and is allowed to be said;
   anything not yet true is not. Claims are separated from ambition in the UI as rigorously as in
   the copy.

5. **One language, many surfaces.** Chat, settings, approval gates, plan review, the workbench
   cockpit, and the cognitive surface share a single vocabulary of primitives, tokens, and
   interaction contracts. Consistency comes from shared primitives, not from making functionally
   different surfaces look identical.

6. **Compounding is the finish line.** A settled task should leave behind reusable capability, not
   just a closed ticket. Surfaces that help a settled result become a template, a contract, a skill,
   or a criterion are higher priority than surfaces that help start another run.

## Accessibility & Inclusion

**WCAG 2.2 AA is the target, and keyboard plus screen-reader operability is required, not optional.**

- The existing ARIA discipline (real roles and accessible names across the DOM, `aria-live` regions
  on streaming output and status transitions, focus traps and focus return in dialogs) is the
  baseline to preserve and extend, not a constraint to relitigate.
- Every interactive element carries a complete state set: default, hover, focus, visible, active,
  disabled, loading, error. Visible focus comes from the shared token layer, never removed.
- Status is never carried by color alone. Every state names itself in text; color only reinforces.
- The status vocabulary is the product's own (grants, affordances, blocked, evidence pass/fail/
  pending, task status, done level). Where these map to unfamiliar concepts for a screen-reader user,
  the accessible name carries the plain-language meaning, not the internal id.
- Reduced motion is respected globally; the product's motion is minimal by design and must not
  convey anything that reduced-motion mode drops.
- Works from 360px wide without horizontal page overflow. Wide content scrolls inside its own
  container.
- Development authentication is a single-operator development authenticator. That is a known security
  limitation, not a solved one; no surface may imply production hardening or multi-tenant readiness.
