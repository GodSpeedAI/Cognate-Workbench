# DeepSeek Harness reconstruction — Cognate app (tranches T5-T8)

A Cognate app that reconstructs the DeepSeek Harness Web UI's "first use" surface plus tool
execution and approvals: configure a model, choose a workspace, run a session, watch it stream, let
the agent read/edit/run inside the workspace, and gate a privileged escalation behind a human
decision. Model: `.sea/interaction/`. Method: `.agents/skills/building-with-cognate/SKILL.md`.

## Workbench (unified harness experience model v2)

The app also hosts the *Capability-Native Agent Workbench* described in
`.agents/plans/unified_harness_experience_model_v2.md`: tasks with an explicit contract
(Context, Goal, Skills, Authority, Executors, Budget, Invariants, Acceptance), a workflow graph and a Skill OS
(contract, implementation, executor), an evidence ledger and review gate, protected evidence enforced in the
tool loop, automations that separate dispatched from complete, steering of a live run, and one deterministic
meaning for "this". Open it from the sidebar's **Workbench** button.

- Status per validation trace, gaps and framework proposals: `WORKBENCH-DEVIATIONS.md`. Plan: `WORKBENCH-PLAN.md`.
- Model: 11 `J-WB-*` journeys in `.sea/interaction/` (validated with `domainforge validate`). Bindings: `BINDINGS.md`.
- Code: pure domain modules in `src/workbench/`; capabilities in `src/capabilities/workbench.ts`; public
  projection `workbench`; cockpit in `src/ui/workbench/` (rules in `src/ui/workbench/UX.md`).
- Tests: `test/workbench-*.test.ts` (units), `test/ui-*.test.tsx` (components), `test/J-WB-*.test.ts` (journeys on
  the real runtime), `test/E2E-workbench.test.ts` (real Chromium; screenshots in `screenshots/workbench/`).
- Donors consulted (none is a dependency): `../primitive-provenance.md` §4, `../donor-manifest.json`.

## Remote Workspaces (SSH / WSL)

A workspace is `(executionWorldId, root)`: the model-facing tools, the agent loop, sessions, plans and
approvals never learn whether it is local, an SSH host, or a WSL distribution — the world's *provider*
answers `filesystem.*` / `process.exec` (`@cognate/execution`, `-ssh`, `-wsl`). Add one from
**Add workspace → SSH / WSL**: for SSH you verify the host (its fingerprint is shown and must be
explicitly trusted, and is compared with `~/.ssh/known_hosts`), authenticate by agent, key file or
password, then pick a folder on that machine. A connection can be reused for more workspaces; a remote
workspace is badged in the sidebar; and if its world becomes unreachable a banner says so and why —
nothing ever runs on this computer instead. Secrets (password, key passphrase) live only in the 0600
`secrets.json`; durable state carries safe metadata and the pinned fingerprint. Journeys:
`J-RW-ssh-workspaces` (ten catalog journeys), `E2E-remote-workspaces` (browser); the live gate
`just remote-workspaces-live` runs against a real OpenSSH `sshd` and a real WSL distribution.

## Cognitive navigation (proof, 2026-10-03)

The console can hold a **Case** around a human's desired difference: a settled world, a frozen
criterion, candidate worlds forked into disposable execution worlds, mediated consequential
operations (Sentinel over RiskPreflight over lower-trust mods), verified candidates, and a
human-only settlement. Everything shown in the Cognitive Frame is derived server-side from durable
events (`case.derive`); the agent's narrative never authors it. See `DEVIATIONS.md` ("Cognitive-
navigation proof") for the mechanism table, state classification and limits, and
`.agents/specs/cybernetic-navigation-proof.md` for the spec. Journeys: `J-COG-cleanup`,
`J-COG-attention`, `J-COG-search`, `J-COG-liveverify`, `J-COG-realitytrace`,
`E2E-cognitive-console` (browser), plus unit suites `cognitive-semantics` and `cognitive-focus`.

## Tool loop and approvals (T7-T8)

`agent.coding` (`src/agents/agentCoding.ts`) runs a deterministic model/tool loop: `model.generate`
(with `read`/`edit`/`bash`/`run_code` tool definitions) -> for each returned tool call, invoke
`tool.<name>` (`src/capabilities/tools.ts`, path-contained to the session's workspace root, resolved
via `workspace.path`) -> the result goes back to the model as a `role: "tool"` message -> repeat
until the model answers in plain text or `MAX_TOOL_STEPS` (20) is hit. `edit` enforces a
read-before-edit guard for files that already exist on disk (journey `J-C-tool-execution`'s
`fs_not_observed` variant), boxed in `ctx.step` so the disk check itself replays deterministically.

Approval (T8) is a policy gate, not a special construct: `approvalGate`
(`src/domain/approvalGate.ts`, named after `.sea/interaction/interaction-model.sea`'s `Entity
"ApprovalGate"`) is a pure function of `(tool, args, mode)` — required exactly when `tool ===
"run_code"` and its `sandbox_permissions` ranks above the session's access mode (`read-only <
workspace-write < full-access`; see `DEVIATIONS.md` for the mode default). When required,
`agent.coding` opens `ctx.waitFor("approve:<toolCallId>", { type: "tool-approval", condition: {
kind: "human_approval" }, payload: { tool, args, permission, justification } })` and blocks. The UI
resolves it via `client.resolveContinuation(continuationId, "resume", { approved })`. On denial, the
tool call's result fed back to the model is the reference's exact wording (`approvalDeniedToolResult`
in `approvalGate.ts`; evidence: `reference/observations/aria/12-approval-resolved-deny`). A pending
approval survives reload and a full server restart (SQLite-backed durable continuations —
`test/J-D-approval.test.ts` proves both the persistence and, deliberately unlike the reference here,
that restart does *not* silently finalize the run — see `DEVIATIONS.md`).

Journeys covered: `J-C-tool-execution` (`test/J-C-tool-execution.test.ts`), `J-D-approval`
(`test/J-D-approval.test.ts`, allow/deny/restart-while-pending/replay-safety).

## Plan mode and to-dos (T9)

Plan mode is session state, not a capability the UI invokes — it is app events
(`plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`, `plan.review.decided`) emitted
directly by `agent.coding`, folded by the public `plans` projection (`src/projections/plans.ts`) and
read back at the start of every turn via `plan.state` (`src/capabilities/planState.ts`, bound to the
IDM's `PlanMode` entity — see `BINDINGS.md`). A leading `"/plan "` prefix on the user's message
(reference-behavior-matrix.md §6.3's composer literal-insertion) turns plan mode on for this and
following turns; `"/plan off"` is a pure control command `agent.coding` handles without a model round
trip. `todo_write` is recorded as `plan.todos.updated` regardless of plan mode (the reference's
To-dos widget works "under Standard mode" too). `exit_plan_mode` is the same
`PreToolDecision`/human-approval waterfall as `run_code`'s sandbox escalation (`approvalGate.ts`),
applied to a different tool and modeled as a *distinct* continuation type — `ctx.waitFor("plan-
review:<toolCallId>", { type: "plan-review", ... })`, not `"tool-approval"` — because its
payload/outcome shape differs (a plan heading/markdown to review, not a permission to allow/deny).
Calling `exit_plan_mode` while the session is not genuinely in plan mode fails closed with the
reference's exact text (`Error: exit_plan_mode is only available in plan mode`,
`src/domain/planGate.ts`). On Approve, plan mode exits and the model is fed back the reference's
exact reflection text verbatim (`reference-behavior-matrix.md` §6.3); "Request changes" (the
journey's deny-equivalent) was not exercised against the pinned reference build, so its wording is
this app's own invention — see `DEVIATIONS.md`.

UI: `TodoWidget`/`PlanReviewCard` (`src/ui/App.tsx`) dock the same way `ApprovalBar` does — the plan
review card replaces the composer while a `plan-review` continuation is open; the To-dos widget sits
above it and persists after plan mode exits. The sidebar prefixes a session's title with "Plan
awaiting review " while its review is pending. The reference also auto-opens the plan in a
right-sidebar tab; this tranche has no right sidebar at all (already inert per `DEVIATIONS.md`), so
the full plan renders inline via "View full plan" instead — see `DEVIATIONS.md` for the resulting
visual gap.

Journey covered: `J-E-plan` (`test/J-E-plan.test.ts`: todos progression, the `plan-review`
continuation opening with the plan's heading/markdown, Approve; plus `exit_plan_mode` failing closed
outside plan mode).

## Subagents/delegation (T10)

The `subagent` tool (`{description, prompt, run_in_background?}`) is **fire-and-forget**, matching
the reference exactly (reference-behavior-matrix.md §6.4): `agent.coding` calls
`ctx.invoke("subagent.start", { agent: AGENT_CODING, input, key: "<parentRunId>:<toolCallId>" })` —
this app's own capability (`src/capabilities/subagentStart.ts`), which starts a durable child
`agent.coding` run correlated `subagent:<parentRunId>:<toolCallId>` (both so it is queryable as a
subagent run, and so `sessions.ts`'s "only `session:`-correlated runs" guard excludes it from the
top-level session list) — and returns *immediately*, without waiting on the child. The tool result
fed back to the model is the reference's exact reflection text: `started subagent <childRunId>`. The
child is a plain `agent.coding` run (fresh history, the delegated `prompt` as its message, same
workspace as the parent).

Nothing watches for the child's completion on the parent's behalf (no continuation, no watcher — an
earlier pass of this tranche synchronously awaited the child via `spawnSubagent`
(`@cognate/profile-harness`), which does not match the reference; corrected). Instead, the `subagents`
projection (`src/projections/subagents.ts`) observes the child's own events directly: it parses the
`subagent:<parentRunId>:<toolCallId>` correlation back off the child's `message.completed`/
`run.failed` events to update that child's row to `"completed"`/`"failed"` with its output — no
parent-side emission needed. `session.history` (`src/capabilities/sessionHistory.ts`) reads this same
projection and, for each parent run, appends a synthetic context message for any subagent it spawned
that has since completed — so the result durably "returns to the parent" on the session's *next*
turn, per the matrix's "the parent's next model turn ... would see the child's result as its tool
output."

UI: the session banner's "N subagent(s)" disclosure (reference-behavior-matrix.md §6.4) opens a
`tree "Subagent sessions"` with rows `"<title> · <desc> · continuable · <status> · 0 tok · 0s"`. "Open
`<title>` in sidebar" opens a small new right-hand panel (`RightPanel`, `src/ui/App.tsx`) showing the
child's prompt + final answer as a two-message transcript, sourced entirely from its `subagents` row
(no separate child-session/transcript capability exists, or is needed, since children are not
sessions). While a `subagent` call is in flight, the tool activity indicator reads "Coordinating
subagents · `<description>`" (`toolActionLabel`).

Journey covered: `J-F-delegation` (`test/J-F-delegation.test.ts`: the child is started and the parent
completes immediately with the reflection text, the child completes independently, its result appears
in the parent session's next-turn history, and the child is excluded from `sessions`; plus a
restart-mid-delegation test asserting no duplicate child run).

## Settings → General → Work details (P1, reference-behavior-matrix.md §10a)

"Choose how much detail to show for tool calls" — four modes (`compact`, `standard`, `detailed`,
`verbose`), default `standard`, same option set/default/description as the reference. Durable the
same way every other setting in this app is: `settings.changeWorkDetails`
(`src/capabilities/settingsChange.ts`, a `client.invoke` capability) starts a deterministic
`agent.config` run (`src/agents/agentConfig.ts`'s `"settings.changed"` command), which emits
`settings.changed`, folded by the public `settings` projection (`src/projections/settings.ts`) into
a single `"current"` row — absence of a row (a fresh `COGNATE_HARNESS_HOME`) is what makes the UI
default to `standard`. `test/J-I-work-details.test.ts` asserts this survives a full runtime restart
against the same SQLite store, not just a client reload.

Effect on tool-card rendering (`src/ui/App.tsx`), ported from the reference's own presentation
policy (`.tmp/ref/deepseek-harness/packages/client/ui-chat/src/client/presentation-policy.ts`):
- **Verbose** (`foldCompletedTurns: false`): a completed turn's tool calls each render as their own
  ungrouped line ("Read · `<path>`", "Bash · `<description>`", "Edit · `<path>`", a failed step in
  red with its error inline) instead of folding behind the "Took Ns" line — see `verboseStepLabel`
  and the `message.steps` snapshot `ChatMessage` carries for the turn that just finished in this
  browser session (not persisted across a reload/session-switch — `session.history` only returns
  `stepCount`, not per-step detail, so a reloaded historical turn falls back to the folded view even
  under Verbose; a documented gap, not a silent inaccuracy).
- **Compact/Standard/Detailed** all fold identically at this app's single-turn depth (confirmed
  against the reference's own captures — the reference's `stepGrouping: "collapsed"` vs `"history"`
  distinction between these three only affects multi-turn session-history grouping, which neither
  system's `multi` scenario exercises).
- The *running* tool-activity label's "· `<detail>`" suffix (`toolActionLabel`) is separately gated
  on `showsLiveProcessDetail` (compact/verbose hide it, standard/detailed show it), taken directly
  from the reference's `liveProcessDetail` policy field.

Screenshots: `cognate/screenshots/desktop/21-work-details-{compact,standard,detailed,verbose}.png`
(`tests/capture/cognate.capture.ts`), paired against the reference's own in
`diffs/desktop/21-work-details-*.png` (`tests/visual/compare.ts`).

## Run it

```bash
# from the repo root, after `bun install`
cd validation/reconstructions/deepseek-harness/cognate
bun run dev            # http://127.0.0.1:3180, data in ./.data (git-ignored)
bun test test          # this app's journey tests
bun run typecheck      # this app's own tsconfig (extends the repo root's)
```

`COGNATE_HARNESS_HOME` overrides the data directory (tests use isolated temp dirs); `PORT`
overrides the port. On start, the server prints a dev `Authorization: Bearer <tenant>:<actor>`
token — the same dev-token handoff `cognate dev` uses (`devTokenAuthenticator`); it is **not**
production auth.

## Why `createRuntime`, not `createHarness`

`@cognate/profile-harness`'s `createHarness` bundles its own opinions about sessions, storage, and
tools (`Harness.send`/`Harness.session`, a `storage.kv` capability, a fixed `agent.loop`) that don't
match this reconstruction's bespoke session model: one `agent.coding` run per turn correlated by
`session:<id>`, a custom `session.history` capability that folds prior runs instead of an
in-memory/`storage.kv` transcript, and a streaming `model.generate` provider that forwards deltas
through `HandlerContext.progress` (which `createHarness`'s `providerComponent` does not do — it only
calls `generate`). Reusing `createHarness` here would mean fighting its built-ins more than using
them, so this app hand-composes `createRuntime` directly, the same shape as `examples/*/index.ts`.
`streamingProviderComponent` (`src/components/modelProvider.ts`) is deliberately parallel to
`profile-harness`'s `providerComponent`, not a copy — see its doc comment.

## Why the Connect service is served in-process, not via a second `serveRuntime`

`packages/cli/src/index.ts`'s `dev()` runs `serveRuntime` on an internal `Bun.serve` and proxies to
it with `fetch()` from the outer server. Copying that pattern here, `internal.stop()` was observed
to hang forever after any invocation that returned a Connect error response reached the outer proxy
(reproduced in isolation while building this tranche; not yet filed as a framework issue — flagging
here since it affects any app copying the CLI's exact proxy shape). `src/server.ts` instead builds
the Connect fetch handler in-process with the same public APIs `serveRuntime` uses internally
(`createConnectRouter` + `registerRuntimeService` + `createFetchHandler`, all from
`@connectrpc/connect`/`@cognate/protocol-connect`) and serves it from the same `Bun.serve` as the UI
and CSS — genuinely one process, no proxy hop to hang.

## Domain wiring

`domain/index.ts` reads `.sea/interaction/interaction-model.sea` directly (no copy, no symlink —
see its top comment for why) via `loadSemanticProjection`, logs the object count and digest, and
fails fast on a parse error. `tranche5Bindings`/`bindTranche5` bind exactly the capabilities this
tranche publishes — see `BINDINGS.md`.

## Secrets

`$COGNATE_HARNESS_HOME/secrets.json`, mode `0600`. The only writer is `secret.put`
(`src/capabilities/secretPut.ts`); the only reader is `ProviderRegistry.swap` when building a live
provider. `model.configure` (`src/capabilities/modelConfigure.ts`) is invoked via `client.invoke` /
`RuntimeService.invoke`, which the framework does **not** record as an event — so the API key
argument never touches the durable event log. `test/J-CFG-model-provider.test.ts` scans the SQLite
`payloads`, `events.metadata`, `records`, and `projection_state` tables directly to prove it.

## Journeys covered

J-A-first-use (composer gating), J-CFG-model-provider (configure + hot-swap), J-WS-select (choose a
workspace), J-B-basic-session (one streamed turn, history into the next), J-C-tool-execution
(read/bash/edit tool loop), J-D-approval (escalation approval: allow/deny/restart/replay). Tests:
`test/J-CFG-model-provider.test.ts`, `test/J-WS-select.test.ts`, `test/J-B-basic-session.test.ts`,
`test/J-G-persistence.test.ts`, `test/J-C-tool-execution.test.ts`, `test/J-D-approval.test.ts`.

## Known gaps vs. the reference product

(resolved progressively: plan mode/subagents T9–T10, cancel/retry T11 — see the tranches below
and DEVIATIONS.md for what remains intentionally different)
- The UI does not reproduce the reference's exact Astryx shell geometry (sidebar drag-resize, right
  sidebar) — it is a minimal shell using `@cognate/react` hooks with the Astryx CSS loaded but not
  its component primitives, styled to the same rough proportions (`src/ui/app.css`); the sidebar's
  1024px auto-collapse breakpoint itself matches the reference (critic round-1 P0-2 — see
  `DEVIATIONS.md`). A full Astryx-shell rebuild is a larger UI-only follow-up.
- `renderMarkdown` (`src/ui/markdown.ts`) is a small hand-rolled subset (headings, lists, inline
  code/bold/links, fenced code blocks) — enough for the scenario fixtures' plain replies, not the
  reference's full CJK/table/math/gallery markdown feature set (product-characterization.md §6).
- Session title is the literal first human message text, truncated, set immediately at turn start
  (matches the reference — see `src/projections/sessions.ts` and `DEVIATIONS.md`, critic round-1
  P0-3); the reference's separate `all-prompts` LLM re-titling cadence is not implemented.
- Composer stats ("`N turns N steps · N tok/s`", "`N% of context used`") are present but static
  (`0`) — no turn/step/token/context accounting is computed yet. See `DEVIATIONS.md`.

## Usage-harness features (usage plan U0–U6, 2026-09-30)

`.agents/plans/deepseek-harness-usage-features.md` — the operator-commissioned pass that turns the
settled parity reconstruction into a usable harness. Journeys: `J-SET-settings`,
`J-WS2-multi-workspace`, `J-PLG-panels`, `J-T-trajectory`, `J-RT-realitytrace`, `J-AIM-aimock`
(`test/`). Characterization: `reference-behavior-matrix.md` §11–15 (pinned reference, checkpoints
22*–26*); deviations per surface: `DEVIATIONS.md`. Highlights:

- **Model endpoint: `@copilotkit/aimock` (`llmock`)** — the simulated OpenAI endpoint for every
  test, capture, and `just harness-up` (`fixtures/aimock/fixtures.json`; the hand-written mock
  server is retired). J-AIM proves fixture matches, tool round-trips, and that unmatched messages
  surface as failed runs.
- **Settings → General, full inventory** (`settings.ts`): Permission (with the Full-access
  confirm dialog; the composer's per-session access-mode dropdown feeds `approvalGate` via
  `AgentCodingInput.mode`), Language, Appearance (Light/Dark/System), Font size (floor 12), Work
  details, Performance & usage, Coding Tools, Keyboard shortcuts (Ctrl / opens the dialog), Send
  behavior while busy (Queue parks; Steer cancels+sends; Cmd/Ctrl+Enter uses the other behavior).
- **Sidebar Workspaces section**: every workspace is a treeitem with its own sessions; header
  search + view options (grouping/ordering) + Add workspace; composer-area "Choose workspace"
  dropdown; per-workspace hover actions — New session in <name>, Rename, Delete workspace
  (`workspace.rename`/`workspace.delete` → `agent.config` events → the `workspaces` projection).
- **Built-in plugins + Agent presets**: an honest inspect-only inventory of this app's own
  capabilities, and three behavioral presets (Standard/PTC/Minimal — `PRESET_TOOLS` scopes each
  turn's tool catalog; `settings.changePreset` is the durable new-task default; the session
  header's mode badge is the per-session selector; out-of-catalog tool calls fail closed with the
  reference's `Error: unknown tool` wording).
- **Developer tools**: the Chat/Trajectory tab strip (gated on Coding Tools) over the public
  `session-trace` projection — USER rows, ASSISTANT `Request #N` rows (one per recorded
  `model.generate` invocation), TOOL rows with args/results/durations; Event details panel with
  Summary/Payload/Result/Schema/Timing (requests: Summary/Options/Timing); collapse-turns +
  live search. Durable: re-folds from the same SQLite store after a full restart (J-T).
- **RealityTrace enrichment (Option A)**: trace-worthy events get observation intents committed
  atomically (`outboxFor`), delivered at-least-once by `ObservationDelivery` to the pinned SXR
  CLI v0.3.0; the Event details panel's RealityTrace tab shows receipts (state, observation id,
  ledger position) and the SXR record drill-down (CEP `extensions.cognate`). Without the binary
  the harness runs unchanged — observations stay queued, traces stay event-sourced (J-RT).

## UI fidelity pass (T5b)

`src/ui/App.tsx` / `src/ui/app.css` / `src/ui/icons.tsx` were rebuilt for structural + visual parity
with the pinned reference (light-by-default theme with a dark toggle, Cognate branding, sidebar
geometry from `product-characterization.md` §2, session header with Chat/Trajectory tabs, message
meta lines + code-block Wrap-lines/Copy controls, composer card with mode/model dropdowns and a
stats footer, a two-pane Settings > Models panel). Every reference control that is out of scope this
tranche is still present in the DOM/aria tree (disabled, reference accessible name) rather than
omitted — see `DEVIATIONS.md` for the full list and why.

### Parity capture (Cognate side)

`../tests/drivers/cognate.ts` implements the shared `Driver` interface
(`../tests/drivers/types.ts`) against this app; `../tests/capture/cognate.capture.ts` mirrors
`reference.capture.ts`'s checkpoint names/viewports/animation-disabling and writes
`../cognate/screenshots/<viewport>/NN-name.png` + `../cognate/observations/aria/*.txt`.
`../tests/visual/compare.ts` (pixelmatch + pngjs, pinned in `../tests/package.json`) diffs every
checkpoint present on both sides into `../diffs/<viewport>/NN-name.png` (reference | cognate | pixel
diff) plus `../diffs/summary.md`. Run:

```bash
# from validation/reconstructions/deepseek-harness/tests, with the mock model already running
# on 127.0.0.1:4010 (aimock/llmock serving fixtures/aimock/fixtures.json — `just harness-up`
# from the repo root boots exactly that):
bun run capture/cognate.capture.ts desktop 1440 900 /tmp/cg-home-desktop 3182 /tmp/cg-ws-desktop
bun run capture/cognate.capture.ts laptop 1024 768 /tmp/cg-home-laptop 3183 /tmp/cg-ws-laptop
bun run visual/compare.ts
```

As of this pass (6 capture/compare/fix rounds, most recently addressing `critic/round-2-visual-a.md`
and `critic/round-2-visual-b.md` — see `critic/round-2-disposition.md` for the full item list): every
checkpoint from `04-workspace-selected` onward sits at 1.5-6% differing pixels (timestamps, static
stats, and font-metric antialiasing account for the remainder). `01-first-launch`/`03-no-workspace`
and the `02*-model-settings` family still carry a large, expected diff even after the round-1 fixes —
both now have the reference's full control structure (first-run dialog pair; provider-list +
add-provider wizard), but the *content* differs by design: Cognate's own branded copy for the
dialogs, and a short original third-party-provider preset list instead of the reference's ~35-entry
DeepSeek-branded one (see `DEVIATIONS.md`, critic round-1 P0-1/P0-4). Diff percentage was not used as
pass/fail evidence for these two families, per the critic's own instructions — read the triptychs in
`diffs/{desktop,laptop}/02*.png` and `01-first-launch.png` instead.

T9's `13-plan-active`/`13b-plan-review-prompt`/`13c-plan-completed` (1 capture/compare round) sit at
3.4-5.3% differing pixels — in the same range as the rest of the T5b-T8 checkpoints, with the largest
contributor being the missing right-sidebar plan tab (see `DEVIATIONS.md` "Plan mode (T9)") rather
than any missing control.

T10's `14-subagent-active`/`14b-subagent-completed-panel` (1 capture/compare round) sit at 3.2-4.8%
differing pixels, same range again. The banner button, "Subagent sessions" tree, row format, and
"Open ... in sidebar" button all match the reference's structure; the main content difference is the
completed turn's reflected text (this app's child-output text vs. the reference's "started subagent
`<uuid>`" — see `DEVIATIONS.md` "Subagents (T10)").

T11's `18-error`/`19-cancelled` (1 capture/compare round) sit at 3.0%/2.9% (desktop) and 3.9%/3.4%
(laptop) differing pixels — in the same range as the rest. `18-error` uses the mock's
`[[scenario:error]]` marker (a deterministic HTTP 500) rather than the reference's own genuine-network-
timeout trigger (this mock has no timeout scenario), and shows this app's honest `"Internal server
error" / HTTP_500` mapping instead of the reference's `"Request timed out." / TIMEOUT` — see
`DEVIATIONS.md` "Cancellation and provider error/retry (T11)". `19-cancelled` shows the "Stopped"
status pill with the partial streamed content retained and no duration badge, matching
reference-behavior-matrix.md §7.
