# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Working name

**Cognate Console** — proposed by Impeccable init, not yet confirmed with the operator. This
surface had no independent product name; it was built and known internally only as "the DeepSeek
Harness reconstruction." Now that pixel/behavior parity with that reference is retired as this
surface's goal (`.agents/evidence/2026-09-27-deepseek-harness-redesign-decision.md`), it needs a
name that isn't a third-party product's. "Cognate Console" is a placeholder in the same texture as
this app's own internal naming (a Cognate app, an operate-mode dashboard/console for an AI coding
agent); trivial to replace everywhere it appears if the operator prefers something else.

## Users

Developers running an AI coding agent against their own workspace: configure a model provider,
pick a workspace, hold a conversation with the agent, watch it stream responses, let it read/edit
files and run shell/code inside that workspace, and gate privileged actions (e.g. arbitrary code
execution) behind an explicit human approval. Same user profile as Claude Code / DeepSeek Harness /
similar coding-agent web UIs: technical users who want visibility into what the agent is doing and
control over what it's allowed to do, not a general consumer chat audience.

## Product Purpose

A web UI for driving a tool-using coding agent: session-based conversations where the agent can
call `read`/`edit`/`bash`/`run_code`, escalate through a human-approval gate before doing anything
irreversible, work through multi-step plans with visible to-dos, and delegate sub-tasks to
fire-and-forget subagents. Success is a user trusting what's on screen enough to hand the agent
real filesystem/shell access in their own workspace, with full visibility into tool calls, streaming
output, and pending decisions.

## Positioning

Built on the Cognate framework (durable event-sourced runtime, SQLite-backed continuations, derived
projections) rather than an in-memory/ad-hoc agent loop — every pending approval, plan review, and
in-flight tool call survives a server restart and replays deterministically. That durability
guarantee (proven in `test/J-D-approval.test.ts`, `test/J-G-persistence.test.ts`) is this product's
actual differentiator versus a typical agent-chat UI, even though it isn't currently visible to a
user anywhere in the interface. Whether/how to surface that durability as a user-facing trust signal
is open — see below.

## Operating Context

- Runs as a single Bun process (`bun run dev`, `src/server.ts`) serving both the Connect RPC API and
  the UI from one `Bun.serve`; state lives in `$COGNATE_HARNESS_HOME` (SQLite + a `secrets.json`).
- A session is scoped to one workspace directory on disk; tool calls (`read`/`edit`/`bash`/
  `run_code`) are path-contained to that workspace root.
- Model providers are configured in Settings → Models (OpenAI-compatible provider today); switching
  providers hot-swaps without a server restart.
- `run_code`'s sandbox permission (`read-only < workspace-write < full-access`) is currently a fixed
  session default, not user-adjustable from the composer (`DEVIATIONS.md` "Approval-gate access mode
  is a fixed default").
- Four "Work details" verbosity levels (compact/standard/detailed/verbose) control how much of each
  tool call renders in the transcript; durable per-install setting.

## Capabilities and Constraints

**Implemented and real** (backed by durable events + passing journey tests, not just UI chrome):
session create/history/switch/reload; streaming assistant responses; tool loop with read-before-edit
guard and real workspace mutation; human-approval gate for privileged tool calls, durable across
reload and full restart; plan mode with a to-dos widget and a plan-review approval step; fire-and-
forget subagent delegation with results folding into the parent's next turn; cancellation
("Stop generating"); provider-error classification with automatic retry; light/dark/system theme;
work-details verbosity setting.

**Present in the DOM but non-functional** (`DEVIATIONS.md` catalogs these — they were kept only to
match the reference's accessible-name/DOM structure for the now-retired parity score, and are a
known cognitive-friction problem this redesign should resolve, not preserve): Settings → General
"Built-in plugins" / "Agent presets" nav items; the sidebar "Plugins" panel; per-session header
actions; a "Trajectory" tab; per-message "Good/Bad response" / "Branch" / "Usage" actions; the
composer's permission-mode and model dropdowns (single fixed value); the composer's stats footer
("N turns · N tok/s · N% context") — always renders zeros, no accounting is computed yet.

**Constraints:**
- No native mobile app; mobile web is in scope (`Platform: web` covers it) but not yet designed for.
- No markdown table/math/CJK/gallery rendering (`src/ui/markdown.ts` is a small hand-rolled subset:
  headings, lists, inline code/bold/links, fenced code blocks).
- No turn/step/token/context accounting exists yet, so any UI that implies it (the stats footer)
  is currently misleading and should either compute real numbers or not claim them.
- Current implementation is a single ~2,300-line `App.tsx` / ~2,000-line `app.css` with no component
  decomposition and no shared design-token layer — expect to introduce both during this redesign
  rather than treating the file split as out of scope.
- Depends on `@cognate/ui-astryx` (a reference Astryf-over-`@cognate/react` component package) being
  present in the monorepo, but this app's current UI does not consume its components directly (it
  loads Astryx's CSS but hand-rolls its own shell) — worth resolving one way or the other during
  `extract`/componentization rather than leaving both half-adopted.

## Brand Commitments

None confirmed yet beyond the working name above. No logo, no locked color/typeface, no existing
external users whose expectations constrain a rename. The prior "Cognate reconstruction of the
DeepSeek Harness Web UI" framing in the onboarding dialog and `app.css` header comment is legacy
copy from the parity-fixture era and is open for revision now that an independent identity was
chosen.

## Evidence on Hand

- `validation/reconstructions/deepseek-harness/reference/screenshots/` — real reference-product
  screenshots (desktop + laptop, ~24 states). These remain useful as *behavioral* evidence of what a
  mature coding-agent UI's states look like (empty, streaming, tool-running, approval-pending, plan
  review, error, cancelled, theme variants, work-details verbosity) even though they are no longer a
  visual target to match.
- `validation/reconstructions/deepseek-harness/cognate/screenshots/` — this app's own captured
  screenshots (desktop/laptop/dev/smoke) from its own Playwright capture scripts
  (`screenshots/capture.ts`), reusable as before/after evidence for this redesign.
- `reference-behavior-matrix.md`, `critic/round-1..7*.md` — dense documented history of what each
  screen/state is supposed to do and prior review findings; useful for understanding intent, not
  for visual conformance.
- No real user research, testimonials, or usage data exists. Do not fabricate any.

## Product Principles

1. Visibility over cleverness: what the agent is doing (which tool, what arguments, streaming
   output) is always legible before it's summarized or hidden.
2. Approval gates read as consequential, not as a modal-dialog formality — the user should be able
   to tell at a glance what they're allowing and why it's being asked.
3. No control renders that doesn't do something. A disabled-looking or dead affordance is worse than
   no affordance (directly targets the "present but inert" catalog above).
4. Durability is a real property of this system (SQLite-backed continuations survive restarts) —
   the redesign may choose to make that legible to the user, but must not claim it where it isn't
   true (e.g., the static stats footer).
5. One coherent visual/interaction language across every surface (chat, settings, approvals, plan
   review, subagent panel) — consistency comes from shared primitives, not from making functionally
   different surfaces look identical.

## Accessibility & Inclusion

No formal standard was named. `validation/reconstructions/deepseek-harness/cognate/observations/aria/`
and `reference/observations/aria/` record the reference's accessible-name/role tree in detail,
which this app's DOM was built to match — treat that as a strong existing accessibility baseline
(real ARIA roles/names throughout, not an afterthought) to preserve and extend, not a constraint
to relitigate. Keyboard-only and screen-reader operability should be treated as required, consistent
with the existing aria-observation discipline, even though no explicit standard (e.g. WCAG level)
was specified.
