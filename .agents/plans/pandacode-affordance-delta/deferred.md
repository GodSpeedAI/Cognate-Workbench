# Deferred and excluded — what this mission did not build

Every donor affordance evaluated in `delta-ledger.md` has a disposition; none was
silently ignored. This file carries the ones that remain future work, with the
prerequisite that must be true before each is started, and the exclusions with their
reasons. Debt discovered *while* building the shipped slices lives in `.agents/DEBT.md`
instead — the two new entries there (checkout refusal under the contained posture on
local workspaces; the chip's stale facts after external commits) are limits of what was
built, not future slices.

## T07 — Durable steering queue (write-only `queue-next` channel)

Not started, exactly as the plan gated it (own replay/idempotency analysis required
first). The durable path exists and is tested at the unit level, but nothing in
production drains it: `steer.enqueue({mode:"queue-next"})` persists a message that is
acked, shown as queued, and never delivered. `.agents/DEBT.md` prescribes the closure —
consume `steer.pending().queued` at the agent's turn boundary, emit
`workbench.steer.consumed` per id, derive the composer queue from the `inbox/`
projection, and retire the now-dead `drainTurn`/`drainStep` helpers. Do not adopt those
helpers: they have no production callers and would fork a second consumption mechanism.
Prerequisite: the mid-session extra turn this creates must be analyzed for replay
idempotency (an operator queueing during a live run can change what that run observes),
and the UI must be repointed in the same change, or the regression the debt entry
describes (today's in-memory ref does deliver once the run goes idle) ships silently.
Size M.

## T08 — GitHub integration (thin `gh` adapter)

Not started (Priority B, gated on T05/T06 settling clean). The delta ledger constrains
the design: argument arrays only, no credential storage (`gh` owns auth), all PR/issue
content treated as untrusted input, and PR creation from a task branch surfaces as a
consequential, operator-gated action beside `git.checkout.merge` — never an agent-side
default. Prerequisite: none technical; it was sequencing only. Surface: connection
status, issue→task suggestion, PR from a task checkout, PR link on the task. Size M.

## Turn-attributed diffs (`pandacode_track_files` handshake)

DEFER, unchanged from the ledger. The donor's begin/complete write handshake plus frozen
patch storage is the only honest form of attribution; a `git status` after a turn is
*not* attribution (donor's own `turn-changes.md` agrees), and Workbench's review flow
already carries changed-lists and patches at `worker.return` without claiming
byte-level per-turn credit. Prerequisite before starting: an attribution-correctness
design — which capability records the handshake, where immutable patches live, and how
replayed turns keep identical attribution. Until then no per-turn diff claims exist in
this app. Size L.

## Integrated terminal

DEFER. An interactive terminal is a new governed surface (pty streaming, scrollback,
containment posture, risk assessment for free-form operator commands) — a different
safety argument from the governed agent shell, whose every command passes
`risk.assess`. The operator's real shell already exists outside the app, so nothing is
missing for work to happen; what would be added is convenience, and it must not be
added as an ungoverned hole. Prerequisite: a containment story for operator-typed
commands and a decision on whether they are recorded. Size L.

## In-app browser grounding and local-server detection

DEFER for the browser engine itself is wrong to say — the ledger classifies the browser
engine as EXCLUDED (a browser engine in the app is out, mission §7); what stays DEFER
is thin, engine-free grounding: detecting a dev server the agent started and linking
it. Prerequisite: the agent tools that start servers must record the bound port
(checkouts make the URL→path mapping non-trivial), and the link must not execute
content. Size M. **iOS simulator: EXCLUDE** — off Workbench's product axis.

## Bots / external channels (Telegram, Slack)

DEFER. Outbound channel connectors conflict with the single-operator security posture
(the dev authenticator is a known limitation per `AGENTS.md`) until external auth exists.
Native schedules are already verified (`J-SCHEDULE`). Prerequisite: durable revocable
multi-user sessions with per-tenant authority — i.e. the production trust boundary
closure that `.agents/DEBT.md` tracks as still open.

## Clean-VM / cloud sandboxes

ADAPT later, at the framework level: new execution-world provider kinds are
`@godspeedai/cognate-exec` additions, not app features. The world registry already
accepts new kinds, and the checkout gate (`WORKTREE_CAPABLE_WORLD_KINDS`) will need each
new kind's worktree capability decided explicitly — that list must not grow by
accident. Recorded; not started.

## Wallpaper / background customization

EXCLUDE — mission directive §8. Not a mechanism, not ported, not mourned.

## Small deferred repairs found during the live walkthrough

- The checkout chip re-observes `git.checkout.status` only on mount, binding change and
  its own actions; external commits leave it stale until reload. Server-side re-checks
  keep every action safe, so this is presentation-only. DEBT entry with closure: S.
- Under the default contained posture, the operator Git capabilities inherit the
  agent-effects refusal on uncontained `local` worlds with a message aimed at agent
  runs. Either an operator-exec path or a checkout-specific message plus a journey test
  covering the refusal. DEBT entry with closure: M.
