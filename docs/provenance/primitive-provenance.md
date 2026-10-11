# Phase 9 — Primitive Provenance Report

DeepSeek Harness reconstruction on Cognate. Branch `cognate/harness`. Verified by reading
`validation/reconstructions/deepseek-harness/cognate/{src,domain}` against
`reference-behavior-matrix.md`'s P0/P1 rows (§1–§9) and `.agents/plans/deepseek-harness-reconstruction.md`.
Paths below are relative to `validation/reconstructions/deepseek-harness/cognate/` unless noted.

## 1. Primitive provenance table

| Reference behavior (matrix §) | Cognate primitives | Implementing files (path:symbol) | Packages | Special case? | Notes |
|---|---|---|---|---|---|
| Token-in-URL handoff, session cookie (§1) | Client projection + provider auth (dev-token) | `src/server.ts:devTokenAuthenticator` (framework), `src/server.ts:LOCAL_OPERATOR` | `@cognate/protocol-connect-bun` | No | Uses the framework's dev-token handoff, not production auth (documented); not a bypass — it's the framework's own supported dev path. |
| First-run dialogs, no-workspace alert (§1) | Event + Projection (Component/Capability) | `src/capabilities/onboardingDismiss.ts:onboardingDismissComponent`, `src/projections/onboarding.ts:onboardingProjection`, agent `src/agents/agentConfig.ts:agentConfigAgent` (`onboarding.dismissed` case) | app | No | Dismissal is a durable `agent.config` run, folded by a projection — absence of a row is what reproduces "per-`DSH_HOME` persistence." Matches the interpretation table's "session" ≈ Event stream + projection idea, applied to onboarding state instead. |
| App shell / composer gating (§1) | Client Projection (React reads `workspaces`/`onboarding`/`model-config`) | `src/ui/App.tsx` (composer `disabled` derivation) | app (`@cognate/react`) | No | UI-only gating; no server capability of its own — matches "UI conversation node/tool card -> client Projection/Artifact renderer." |
| Settings → Models: provider create, redaction, hot-swap (§2) | Capability (`model.configure`) + Component (`streamingProviderComponent`) + Fiber (mount/dispose) + provider replacement | `src/capabilities/modelConfigure.ts:modelConfigureComponent`, `src/components/providerRegistry.ts:ProviderRegistry.swap`, `src/components/modelProvider.ts:streamingProviderComponent` | `@cognate/kernel-api`, `@cognate/provider-openai-compatible` | No | `swap` mounts a new fiber and disposes the old one (`kernel.mount` / `handle.dispose`) — exactly "provider replacement" in the spec's interpretation table. |
| Write-only API key contract (§2) | Capability (`secret.put`) + client-invoke (unrecorded) | `src/capabilities/secretPut.ts:secretPutComponent`, `src/secrets.ts:secretStore` | app | No | `model.configure`/`secret.put` are invoked via `client.invoke`/`RuntimeService.invoke`, which the framework does not record as an event — verified directly in `README.md` "Secrets" and cross-checked against `src/capabilities/modelConfigure.ts` (the API key never reaches `ctx.emit`). |
| Model-select-without-restart (§2) | provider replacement (Fiber swap), no continuation needed | `src/components/providerRegistry.ts:ProviderRegistry.swap` (`hot-swap to provider …`) | app | No | Confirmed: `swap` disposes/remounts without touching the runtime or restarting the process. |
| Choose workspace, workspace ↔ session relationship (§3) | Capability (`workspace.select`) + Event (`workspace.added`/`workspace.selected`) + Projection (`workspaces`) | `src/capabilities/workspaceSelect.ts:workspaceSelectComponent`, `src/agents/agentConfig.ts:agentConfigAgent`, `src/projections/workspaces.ts:workspacesProjection` | app | No | Matches the plan's table row exactly: "`agent.config` emits `workspace.added`/`workspace.selected`; public projection `workspaces`." |
| Composer path containment (§3) | scoped Capability (workspace-root-bound `tool.*`) | `src/capabilities/tools.ts:resolveInWorkspace`, `src/capabilities/workspacePath.ts:workspacePathComponent` | app | No | Every `tool.<name>` call takes `workspaceRoot` from `workspace.path` and rejects any resolved path outside it (`PathEscapeError`). |
| Session create/history/switch/reload (§4) | Correlation (`session:<id>`) + Event (`session.turn.started`/`message.completed`) + Projection (`sessions`) | `src/agents/agentCoding.ts:agentCodingAgent`, `src/projections/sessions.ts:sessionsProjection` | app | No | One `agent.coding` run per turn, correlated `session:<id>`; `sessions` projection folds title/status. Matches the plan row: "correlation `session:<id>` … Public projection `sessions`." |
| Session title = literal first message (§4) | Projection derivation | `src/projections/sessions.ts:titleFrom`, `sessionsProjection` (`session.turn.started` branch) | app | No | Verified: title is set from the turn-start event's message, not overwritten by `message.completed` — matches the critic-round-1-fixed behavior documented in `DEVIATIONS.md`. |
| History folded into model context (§4/§5) | Capability (`session.history`) invoked via `ctx.invoke` | `src/capabilities/sessionHistory.ts:sessionHistoryComponent` | app | No | Closes over `RuntimeService.listRuns`/`readProjection`; invoked through `ctx.invoke`, so the fold itself is recorded/replayable (matches plan row "invoked via `ctx.invoke`, so it is recorded"). |
| Streaming assistant response (§5) | HandlerContext progress channel (G1) -> `run.invocation.progress` Event, folded per run | `src/components/modelProvider.ts:streamingProviderComponent` (`ctx.progress`), kernel `packages/runtime-bun/src/executor.ts` | app + `@cognate/runtime-bun` | No | Verified: `streamingProviderComponent` calls `provider.stream` and forwards deltas via `ctx.progress`, which the kernel appends as durable, replay-safe `run.invocation.progress` events (G1, see §2 below). |
| Tool execution: read/edit/bash/run_code, workspace mutation (§6.1) | Capability (`tool.read`/`tool.edit`/`tool.bash`/`tool.run_code`) + owned reversible Effect (subprocess/file I/O boxed in the capability handler) | `src/capabilities/tools.ts:toolCapabilitiesComponent` | app | No | Verified real disk mutation (`writeFile` in the `edit` handler) and Bun subprocess spawn (`bash`/`run_code`), all invoked via `ctx.invoke` from `agentCoding.ts`. |
| Read-before-edit guard (§6.1, `fs_not_observed`) | Effect boxed in `ctx.step` (deterministic replay of a disk check) | `src/agents/agentCoding.ts:invokeTool` (`ctx.step(\`edit-exists:${call.id}\`, …)`) | app | No | The filesystem `stat` is boxed in `ctx.step`, not called bare — replay returns the recorded answer instead of re-touching disk, as the README states. |
| Approval-gated `run_code` escalation (§6.2) | policy gate (pure function) + Continuation (`ctx.waitFor`, type `tool-approval`) + Event (`tool.approval.requested`/`.decided`) | `src/domain/approvalGate.ts:approvalGate`, `src/agents/agentCoding.ts` (`ctx.waitFor(\`approve:${call.id}\`, …)`) | app | No | `approvalGate` is a pure `(tool, args, mode) -> decision` function, not a `CapabilityContract` (deliberately unbound — see `BINDINGS.md` "Not bound"); the actual gating primitive is the `ctx.waitFor` continuation. Matches the spec's "approval = policy gate + Continuation" row precisely. |
| Approval survives reload and full restart (§6.2, deviated) | durable Continuation (SQLite-backed `run.waiting`) | `test/J-D-approval.test.ts` ("a pending approval survives a full server restart") | app + `@cognate/runtime-bun` | No | Cognate's continuation durability is a kernel guarantee (event history authoritative), used as-is; the reconstruction intentionally does **not** reproduce the reference's restart-loses-the-approval behavior (see Deviations doc; recorded below as a mapping/behavior difference, not a primitive special case). |
| Plan mode / To-dos / plan review (§6.3) | app Event (`plan.mode.changed`/`plan.todos.updated`/`plan.review.*`) + Projection (`plans`) + Continuation (`ctx.waitFor`, type `plan-review`) | `src/domain/planGate.ts`, `src/agents/agentCoding.ts` (`todo_write`/`exit_plan_mode` branches), `src/projections/plans.ts:plansProjection`, `src/capabilities/planState.ts:planStateComponent` | app | No | `exit_plan_mode` uses a **distinct continuation type** (`"plan-review"`, not `"tool-approval"`) — same waterfall shape as approval, deliberately not the same `CapabilityContract`/type. See "Mapping differences" §3 below (plan is not modeled as Artifact). |
| Subagent delegation, fire-and-forget (§6.4) | Capability (`subagent.start`) + child Component execution (scoped run, distinct correlation) + Projection (`subagents`) | `src/capabilities/subagentStart.ts:subagentStartComponent`, `src/agents/agentCoding.ts` (`subagent` tool branch, `ctx.invoke("subagent.start", …)`), `src/projections/subagents.ts:subagentsProjection` | app | No | Child run correlated `subagent:<parentRunId>:<toolCallId>`, excluded from `sessions` by correlation-prefix guard. No continuation/watcher (fire-and-forget matches the reference exactly — corrected from an earlier synchronous-await pass per `DEVIATIONS.md`/F2 below). |
| Subagent result reaches parent on its next turn (§6.4) | Projection read by Capability (`session.history` reads `subagents`) | `src/capabilities/sessionHistory.ts:sessionHistoryComponent` (`subagentRows` fold) | app | No | Verified: `session.history` appends a synthetic user-role message per completed child, sourced from the `subagents` projection, not from any parent-emitted event. |
| Cancellation ("Stop generating") (§7) | Fiber/lease cancellation via `AbortSignal` propagation | `src/components/modelProvider.ts` (`ctx.signal` -> `provider.stream(request, ctx.signal)`), `packages/kernel-cordis/src/lease.ts`, `packages/provider-openai-compatible/src/index.ts` (`AbortSignal.any`) | app + `@cognate/kernel-cordis` + `@cognate/provider-openai-compatible` | No | `RunContext.signal` threads through `HandlerContext.signal` to the live `fetch` abort — pre-existing kernel plumbing, unchanged by this reconstruction except for D2's error-mapping fix (below). |
| Provider error + automatic retry (§8) | app-level retry loop (Event `model.request.retried`) over `ctx.invoke("model.generate", …)`, each attempt its own recorded step | `src/agents/agentCoding.ts:invokeModelGenerate`, `classifyModelFailure` | app | No | Retries are explicit application logic (`for` loop over `ctx.invoke`), not a kernel-level retry primitive — each attempt is its own durable `ctx.invoke` step, so replay never re-runs a completed attempt. Failure classification now reads structured `failure.details` (F3, below) with message-regex fallback. |
| Structured failure detail on recorded invocation failures (§8, F3) | Event (`run.invocation` failure payload) carrying JSON-safe `code`/`details` | `packages/runtime-bun/src/invoker.ts:failureJson` (framework fix) | `@cognate/runtime-bun` | No | Verified via `git show d93250d`: `failureJson` now preserves `error.name`/`details`; `packages/runtime-bun/test/invoker.test.ts:"records error name and details from thrown error"` is the regression test. `agentCoding.ts:classifyModelFailure` consumes `failure.details.status`/`.kind` first. |
| Theme (Light/Dark/System) (§9) | Client-only UI state (no server capability) | `src/ui/App.tsx` (theme toggle) | app | No | P1, UI-local; not persisted server-side (matrix §9 "not explicitly re-verified", `DEVIATIONS.md`), but this is a documented scope gap, not an architectural bypass. |

Row count: **24** feature rows spanning the matrix's §1–§9 P0/P1 material (the matrix's own P0/P1
count is 8 P0 sections + 2 P1 items; this table splits each section into its constituent
observable behaviors per the spec's "one row per feature" instruction). **All 24 rows are `Special
case? No`.**

## 2. Framework changes surfaced by this test

All four are on this branch's commits touching `packages/`: `6f94df5` (D1, G1, D2) and `d93250d` (F3).

- **D1 — replay-safe emits inside `ctx.step` (defect repair of an existing primitive).**
  `RunContext.step` (`packages/runtime-bun/src/executor.ts`) previously let a boxed function's own
  `ctx.emit` calls consume `emit:<n>` ids from the same counter used outside the step; on replay the
  step's body is skipped (its result is already recorded) but the outer counter wasn't advanced to
  account for the emits that happened *inside* it, so a later, unrelated emit could collide with one
  recorded inside the step. Domain-independent: nothing about tool-loop/session semantics is
  involved, purely event-id bookkeeping in the executor. Regression test:
  `packages/runtime-api/src/conformance.ts:"a step's internal emits survive replay: no collision, no
  drop, correct order (D1)"`, run against every runtime implementation via the shared conformance
  kit. **Defect repair**, not a new capability — the primitive (`ctx.step`) already existed and was
  supposed to be replay-safe.

- **G1 — invocation progress channel (new general capability, operator-approved).** Before this
  branch, a capability handler had no way to publish incremental progress (e.g. streamed model
  token deltas) into the run that invoked it — `HandlerContext` had no `progress`/`emit`-like
  channel. This is the **honest architectural gap this test found**: streaming through a
  policy-gated, hot-swappable `model.*` capability was not expressible in the framework at all.
  The operator's decision (`.agents/plans/deepseek-harness-reconstruction.md`, "G1 decision (operator,
  2026-09-26)") was to add it as a domain-independent primitive rather than route around it in the
  app. Implementation: `InvocationContext`/`HandlerContext.progress` appends `run.invocation.progress`
  events keyed by the invoking step id with attempt/sequence numbers (`packages/kernel-api/src/types.ts`,
  `packages/runtime-bun/src/executor.ts`), used by this app's `src/components/modelProvider.ts:streamingProviderComponent`.
  Regression test: `packages/runtime-api/src/conformance.ts:"a handler's progress calls are durable,
  ordered, and never repeated on replay (G1)"`. **New general capability**, not a defect repair —
  called out here as required rather than folded silently into the "No special case" table above,
  because it changed the kernel's `HandlerContext` surface to make this reconstruction possible.

- **D2 — provider-openai-compatible stream/abort error mapping (defect repair of an existing
  primitive).** `provider-openai-compatible` advertised `stream: true` in its published capability
  features but its `stream()` implementation did not map mid-stream abort/network failures to the
  typed `ModelProviderError` the rest of the framework expects — an abort during a streaming call
  either hung or surfaced an untyped error. Domain-independent: this is a transport/provider-contract
  bug unrelated to any DeepSeek Harness concept. Regression tests:
  `packages/provider-openai-compatible/test/provider.test.ts:"stream aborts on the caller's signal
  without hanging"` and `"stream surfaces an HTTP error before any bytes are read, typed and without
  the credential"`. **Defect repair.**

- **F3 — structured failure details preserved through the kernel's JSON boundary (defect repair of
  an existing primitive).** `packages/runtime-bun/src/invoker.ts`'s `failureJson` reduced any thrown
  error to `{ kind: "failed", message }`, discarding fields like `ModelProviderError.kind`/`status`,
  so an agent could only classify a failed invocation by regexing the message string. Fixed
  (`d93250d`) to preserve `error.name` and a JSON-safe `details` object. Domain-independent: applies
  to any capability's thrown error, not specific to model providers. Regression test:
  `packages/runtime-bun/test/invoker.test.ts:"records error name and details from thrown error"`.
  `src/agents/agentCoding.ts:classifyModelFailure` now prefers `failure.details.status`/`.kind`,
  falling back to message-regex matching only for compatibility. **Defect repair.**

- **F2 — not fixed, by design.** `spawnSubagent` is exported from `@cognate/profile-harness`, but the
  `run_completion` continuation resolver it depends on lives inside `createHarness`'s own closure —
  an app that composes `createRuntime` directly (as this reconstruction does; see README.md "Why
  `createRuntime`, not `createHarness`") cannot reuse `spawnSubagent` without copying that resolver.
  This reconstruction does not need the fix: delegation in the reference is fire-and-forget
  (matrix §6.4), so an earlier pass that used `spawnSubagent` to synchronously await the child was
  itself a **mismatch with the reference**, corrected in `f3fa09a` ("fire-and-forget subagent
  delegation matching the reference") by dropping `spawnSubagent` entirely in favor of this app's own
  `subagent.start` capability (`src/capabilities/subagentStart.ts`) with no completion watcher at all.
  F2 remains an open framework finding (candidate fix: export a standalone
  `watchSubagentCompletions(runtime, caller)`), not touched on this branch — correctly so, since fixing
  it was never on the reconstruction's critical path once delegation semantics were corrected.

## 3. Mapping differences from the spec's interpretation table

- **"plan" is not modeled as Artifact/projection over durable events, in the sense of a Cognate
  `Artifact` primitive** — the reconstruction uses plain app **Events + Projection + Continuation**
  instead (`plan.mode.changed`/`plan.todos.updated`/`plan.review.*`, folded by `plansProjection`,
  gated by a `"plan-review"` `ctx.waitFor`). No `Artifact` type is created or referenced anywhere in
  `src/`. Reason (see `BINDINGS.md` "Not bound"): the reference's plan is not a document with its own
  lifecycle independent of the conversation — it is session state (on/off, todos, one pending
  review) that the UI reads the same way it reads any other projection. Modeling it as a durable
  `Artifact` would add a second persistence mechanism for something the existing event
  stream/projection pair already expresses completely; the plan's markdown itself lives in a single
  event payload (`plan.review.requested`), not as a separately versioned/addressable artifact object.
- **"workspace" is not modeled as its own bespoke capability tree** but as **`agent.config` events +
  a `workspaces` projection**, matching the plan document's own stated composition
  (`.agents/plans/deepseek-harness-reconstruction.md`'s architecture table row) — verified in code:
  `workspaceSelectComponent` starts an `agent.config` run that emits `workspace.added`/
  `workspace.selected`, folded by `workspacesProjection`. This matches the interpretation table's
  generic "workspace = durable application/domain state + scoped capabilities" row exactly (the
  "scoped capabilities" being `tool.*`'s workspace-root containment) — no deviation from the spec
  here, just a specific instantiation.
- **"approval" and "plan review" use two distinct `Continuation` types** (`"tool-approval"` vs.
  `"plan-review"`), not one generic "approval" continuation, because their payload/outcome shapes
  differ (a permission to allow/deny vs. a plan heading/markdown to review) — see
  `src/domain/planGate.ts`'s header comment and `BINDINGS.md`. This is a refinement within the
  spec's "approval = policy gate + Continuation" row, not a contradiction of it.
- **"subagent" is not bound as a `CapabilityContract` for the delegation act itself** — only the leaf
  `subagent.start` capability that actually starts the child run is bound; the decision to delegate
  and the fire-and-forget semantics live in `agent.coding` itself (`BINDINGS.md` "Not bound": "the
  `subagent` tool itself is not a `CapabilityContract`"). This matches the spec's "subagent = scoped
  agent Component/child execution" row (the child is a real, separately-correlated `agent.coding`
  run/Component instance), while explicitly not over-modeling the orchestration decision as a
  capability of its own — same shape choice as `ApprovalGate`/`PlanMode`.
- **"session history"** is realized as a capability (`session.history`) that *reads* the durable
  event history through `RuntimeService.listRuns`/`readProjection`, rather than a separate
  `EventStore projection` object exposed to the UI directly — the spec's "session history = durable
  EventStore projection" row is satisfied one level removed: the projection folding happens inside
  the capability's fold logic (per-call, over `listRuns`), not as a standing named `Projection` the UI
  subscribes to. This is a legitimate instantiation (the plan document's table calls it "a component
  closing over `runtime.service`"), not a deviation the report needs to flag as wrong, but it is
  worth noting the interpretation table's literal phrasing ("EventStore projection") undersells that
  this fold is capability-side, not projection-side.

## 4. Special cases / escape hatches audit

Searched `src/` and `domain/` (the app's own code, not vendored `node_modules` or `packages/`) for:
direct SQLite access, direct store writes bypassing capabilities, bare `Date.now()`/`Math.random()`
or I/O inside agent code outside `ctx.step`/`ctx.invoke`, direct fetches around capabilities, and
secrets in events.

| Hit | Location | Verdict |
|---|---|---|
| `sqlite` string match | `src/server.ts:131` — `const storePath = join(home, "app.sqlite")` | **Not a bypass.** This is the path handed to `createRuntime`'s own store configuration (the framework's supported persistence backend); the app never opens this file itself or touches its tables. `test/J-CFG-model-provider.test.ts` (per README) scans the SQLite tables directly, but only as a **test assertion** proving the secret never entered the durable log — that is verification tooling, not app-code that reads/writes the store outside the framework's API, so it does not make any feature "Special case? Yes." |
| `fetch(` | `src/server.ts:254` (`Bun.serve({ ...,  fetch(request) {…} })`) | **Not a bypass.** This is the HTTP server's own request handler signature (Bun's `serve` API), not an outbound fetch call around a capability. No outbound `fetch`/`http.request` exists anywhere in `src/`. |
| `Date.now()` (7 occurrences) | `src/ui/App.tsx` only (relative-time labels, elapsed-duration timers for the "Took Ns"/"Deep diving for Ns" UI) | **Not a bypass.** All occurrences are in the browser-side React UI, which is presentation code outside the replay-determinism boundary (it is not part of any `AgentDefinition.run`, `ctx.step`, or capability handler) — using wall-clock time for a live countdown label is exactly what client UI is for. No `Date.now()`/`Math.random()` appears anywhere under `src/agents/`, `src/capabilities/`, `src/components/`, `src/domain/`, or `src/projections/`. |
| `Math.random()` | none found under `src/`, `domain/` | No hit. All ids (`randomUUID()` from `node:crypto`) are used only in capability handlers for `idempotencyKey`s passed to `startRun` (e.g. `workspaceSelect.ts`, `modelConfigure.ts`, `onboardingDismiss.ts`) — outside any agent's replayed `run()` body, so non-determinism there is harmless (each `startRun` call is itself the non-replayed, one-shot boundary). |
| Filesystem I/O outside `ctx.step`/`ctx.invoke` | `src/capabilities/tools.ts` (`readFile`/`writeFile`/`Bun.spawn`), `src/domain/../capabilities/workspaceSelect.ts` (`stat`), `src/secrets.ts` (`readFile`/`writeFile`) | **Not a bypass.** All of this I/O lives inside capability handlers (`fiber.provide(...)`), invoked exclusively via `ctx.invoke` from `agent.coding`/`agent.config` — never called bare from inside an `AgentDefinition.run` body. The one place raw I/O runs from *inside* an agent's own `run()` is `src/agents/agentCoding.ts:invokeTool`'s `fileExists` check, and that is explicitly boxed in `ctx.step` (see the "Read-before-edit guard" row in §1), which the code comment calls out by name as the reason it stays replay-safe. |
| Secrets in events | `src/capabilities/secretPut.ts`, `src/capabilities/modelConfigure.ts`, `src/agents/agentConfig.ts` (`model.configured` case) | **Verified clean.** `secret.put`/`model.configure` are invoked via `client.invoke`/`RuntimeService.invoke` (not `ctx.invoke` from inside a recorded run), which the framework does not record as an event; the only event this path emits, `model.configured`, carries `{ providerId, baseURL, protocol, model }` — no `apiKey` field (confirmed by reading `agentConfigAgent`'s `model.configured` case and `ModelConfigureInput`/`AgentConfigInput` type definitions side by side: the API key is destructured out before `ctx.emit`). |
| Direct store writes bypassing capabilities | none found | Every projection (`sessions`, `plans`, `subagents`, `workspaces`, `model-config`, `onboarding`) is a pure `apply(event, state)` fold registered as a `Projection`; no code anywhere writes to a projection's backing store directly. |

**No special-case/escape-hatch hits were found that make any feature depend on a bypass.** Every row
in §1's table is correctly `Special case? No` — the audit found nothing that should flip any of them
to `Yes`.


## 4. External donors (workbench tranche, 2026-10-05)

Machine-readable record: `donor-manifest.json` (same folder). Shallow clones live in `.tmp/ref/` (gitignored)
and can be deleted: nothing imports them, and the architecture tests (`tests/architecture/no-reference-imports`,
`no-copied-source`) guard that. Ported logic is re-implemented in TypeScript and carries an attribution header
(donor, path, commit). Licences: MIT, Apache-2.0, or operator-owned.

| Donor | Licence | Commit | Use | Cognate files |
|---|---|---|---|---|
| `Hexagon/croner` | MIT | `713ee72` | ported-logic | `src/workbench/automation.ts` |
| `micromatch/picomatch` | MIT | `9fab7bf` | ported-logic | `src/workbench/glob.ts` |
| `openai/codex` | Apache-2.0 | `7aa8f51` | ported-logic | `src/workbench/shellSafety.ts` |
| `anomalyco/opencode` | MIT | `7723920` | ported-logic | `src/workbench/shellSafety.ts` |
| `aaif-goose/goose` | Apache-2.0 | `104ddde` | reviewed-only | none |
| `dagrejs/dagre` | MIT | `32e7f30` | reviewed-only | none |
| `deepseek-ai/deepseek-harness` | see reference-manifest.json | `477b4f4` | pattern-only | `src/workbench/workflow.ts`, `src/workbench/steering.ts` |
| `operator:gs-term` | none declared (operator-owned) | `working` | adapted | `src/workbench/focus.ts` |

Deliberate differences from donors are recorded next to each port (`glob.ts`: dotfiles matchable by `*`;
`shellSafety.ts`: no Windows analysis, extra SQL and device-redirect fallbacks; `automation.ts`: strictly-after
semantics and an explicit gap rule). Where a donor was reviewed and nothing was taken, the manifest says so.
