# Experts and Teams donor translation

This note records the behavioral affordances examined in DeepSeek-Bot and how Workbench should realize them in Cognate. It is a translation guide, not an endorsement of importing the donor runtime.

## Provenance

- Donor: [Fei2411/DeepSeek-Bot](https://github.com/Fei2411/DeepSeek-Bot)
- Examined version: `ds-bot` 0.1.5, tag `v0.1.5`
- Commit: `20ebc9213cbbde7249d71786765f86be00dc6663`
- License: Apache-2.0; donor root and package both include `LICENSE`. Root `NOTICE` records third-party notices and explicitly says the listed project inspirations contain no copied code. This Workbench note describes behaviors and no donor source was copied. If later changes adapt donor source, retain the applicable Apache notices and mark modified files as required.
- Examined checkout: temporary `.tmp/donor/deepseek-bot` (not a runtime or build input).

The donor is `ds-bot`, a plugin for DeepSeek Harness 0.2.1-alpha.1. Its Sessions, message inboxes, tool registration, approvals, schedules, storage, provider catalog, and desktop client are Harness-specific. Workbench must keep Cognate's published SDK/runtime, capabilities, event contracts, projections, and existing UI as its substrate.

## Translation matrix

| Donor mechanism and user intention | Classification | Cognate-Workbench realization / evidence | Missing behavior or boundary |
| --- | --- | --- | --- |
| `host/roster.js`: create, edit, copy, delete persistent identities; Main Bot role; group membership; model and permission settings | Adapt Donor Pattern | Keep editable Expert definitions and persistent Expert instances distinct from Cognate agent/run IDs. Record mutations through the `agent.config`/typed Workbench event path and project roster views. Existing `agent.config` is the established durable write agent. | Donor stores roster state separately and creates Harness Sessions; neither is suitable. Enforce exactly one Orchestrator in Workbench mutation transactions, including concurrent replacements. |
| `host/groups.js`: ordered group rounds, member-specific group Sessions, @mentions, pass/abstain, per-member turn caps, late replies and visible failures | Adapt Donor Pattern | Use distinct solo, Team, and Expert-in-Team conversation scopes; maintain attributable messages and bounded round/handoff policy. Use typed abstention and assignment outcomes. | Group rounds in the donor run through Harness Sessions and an in-process round loop. They do not establish crash-durable Workbench orchestration; durable assignment records and correlated Cognate runs are needed. |
| `host/tools.js`: `message_bot`, now/queue steering, reply routing, `stop_bot`, roster/group/memory controls | Adapt Donor Pattern | Expose named Cognate capabilities with typed inputs and explicit Expert/Team authority checks. Queued addressed messages can be durable Workbench events. Cancellation should use run controls and record late-result reconciliation. | Donor's “now” inserts into a live Harness agent's next step; this depends on its inbox and `steer` API. Workbench should report queued delivery unless Cognate exposes equivalent supported steering. Do not let tool prompts grant authority. |
| `host/delivery.js`: addressed delivery, exchange IDs, sender/recipient, reply destination, hop tracking, restart/resend annotations | Adapt Donor Pattern | Persist sender, recipient, scope, assignment/run correlation, causation, idempotency key, and delivery status in typed events. Return results to the Orchestrator through durable correlation and idempotent projection/settlement. | Donor appends exchange metadata in its own mutable state and then adds a Harness user message; delivery is not an exactly-once durable event transaction. Cognate return/recovery semantics must be verified. |
| `host/parts.js` and `host/steward.js`: token-window thresholds, compact-versus-switch decision, handoff note, checkpoint with preserved recent messages and older-history lookup | Adapt Donor Pattern | Use Cognate conversation/run history and evidence artifacts as the record; add bounded context selection and checkpoints only through supported APIs. Keep commitments, remaining work, exact identifiers, and provenance in summaries. | Donor depends on Harness compaction/session history. Workbench must not imply full tool-result history or automatic compaction where its projections do not preserve those facts. |
| `host/memory.js`: isolated per-Bot and team memory, topic index, provenance metadata, review/promote/forget workflow, secret filtering, frozen per-Session prompt snapshot | Adapt Donor Pattern | Store memory as rebuildable derived state from durable events, explicitly scoped to Expert or Team, with source references and access checks. Never treat model statements as automatically trusted knowledge; exclude credentials. | Donor uses filesystem Markdown/journal/indexes and Harness prompt hooks. Workbench should use existing PostgreSQL/event/projection mechanisms and establish its own provenance and promotion rules. |
| `host/permissions.js`: per-Bot permission preset applied to its Sessions | Reuse Existing Cognate | Bind allowed Workbench/Cognate capabilities at invocation and preserve existing policy, approval, and human-only settlement checks. Expert membership can further restrict the actor's effective authority. | Harness preset names and Session mutation APIs do not transfer. The Orchestrator cannot elevate itself or approve protected effects. |
| `host/schedules.js`: schedule records attached to Harness Sessions and delivered as due prompts | Defer with Justification | Workbench automation records currently express intent; use them only if an actual durable scheduler/execution contract is present and verified. | Current `src/workbench/automation.ts` records automation but does not itself supply a durable background scheduler. Do not surface autonomous schedules as working until a durable Cognate-compatible executor exists. |
| `host/prompt.js`: stable identity/role/instructions, operational messaging rules, coordination boundaries | Adapt Donor Pattern | Compose prompts from persisted Expert definitions and the active Team membership, while passing capabilities independently and enforcing authority in code. | Prompt text is explanatory, not authorization. Avoid embedding live roster assumptions in a cached prompt; provide a current, scoped projection/capability. |
| Donor client: roster, group settings, model menu, memory panel, schedule panel, statuses, activity | Adapt Donor Pattern | Extend Workbench's existing React/Astryx navigation, chat, trace, and approval surfaces from projections and real capability outcomes. | Do not transplant the desktop client or render inert controls; unsupported scheduling/steering must be visibly absent or accurately queued. |

## Workbench contracts observed during examination

- `src/agents/agentConfig.ts` documents `agent.config` as the deterministic durable event-write path; capability handlers perform external I/O before the event run, whose body only emits validated events.
- `src/capabilities/subagentStart.ts` starts a genuine `agent.coding` child with an idempotency key and `subagent:<parentRunId>:<id>` correlation. Its source explicitly describes the operation as fire-and-forget: the parent does not wait for child completion. This is useful for Cognate subagent execution and observability, but is not by itself a durable Team handoff/return contract.
- `src/components/providerRegistry.ts` owns a single current provider handle and swaps it globally. That is a real constraint for simultaneous per-Expert routes; switching this singleton around individual calls would risk rerouting active runs. Per-Expert model routing needs an explicit provider-selection contract at execution time, not a global hot-swap workaround.
- Workbench projections in `src/projections/` are the read-model pattern. New Experts and Teams should follow the typed event and projection boundaries rather than introduce a donor-like independent store.

## Behavioral findings and limits

The donor's group conversations intentionally serialize speaking slots, let work continue after a round advances, and post late results. It bounds extra turns and per-member turns, tracks failures, and offers typed-ish `[PASS]` detection. Its cross-member message tool separately caps message-chain depth and unread requests, and its stop control cancels active sessions before delivering a follow-up. These are useful limits to preserve, but the host inbox and live-run controls are Harness-specific.

The delivery layer gives every exchange a UUID and stores request/reply roles, sender and recipient, return routing, hop count, and restart/retry annotations. Restart recovery is coordinated by donor modules around persisted team state and Harness Sessions. A durable Cognate implementation should make redelivery logically idempotent and recover through persisted assignment/run state; an in-memory callback or browser turn is not equivalent.

Memory is separately scoped to a Bot or shared team directory. Entries have metadata and source text; write, review, and read paths reject likely secrets and enforce who may edit team or another member's memory. The general provenance and scoping ideas transfer. The donor's filesystem journal, per-session frozen prompt files, and SQLite-derived search inspiration do not need to transfer into Workbench.

## Examined donor tests

The donor has focused tests in `ds-bot/test/roster.test.js`, `groups.test.js`, `group-work.test.js`, `bot-messages.test.js`, `memory.test.js`, `permissions.test.js`, `schedules.test.js`, `steward.test.js`, `prompt.test.js`, and related files. They exercise roster creation and model selection, mention parsing and pass handling, bounded group work, addressed message and stop behavior, scoped memory and secret rejection, schedule routing, checkpoint decisions, and identity prompt composition. These tests are behavioral references only; Workbench must prove its own contracts against its runtime and persistence.

## Explicit non-transfer

Do not add `@deepseek-ai/*`, DeepSeek Harness, Cordis/DSH plugins, donor state/storage, a donor scheduler, or donor client code to production Workbench. Use only the product behaviors in the matrix, expressed with published Cognate packages and Workbench's typed capabilities, durable events, projections, and UI.

## Native reconstruction outcomes

| Donor affordance | Implemented Workbench realization | Evidence |
| --- | --- | --- |
| Reusable roster and role membership | Editable Expert definitions/instances, copies, draft/active Teams, atomic sole-Orchestrator replacement, idempotent seeds | `test/J-EXPERT-management.test.ts`, `test/J-TEAM-security.test.ts` |
| Group work and bounded speaking | Typed bounded Assignments and serialized genuine Cognate runs; Orchestrator chooses Specialists | `test/J-TEAM-execution.test.ts`, `test/J-TEAM-bounds.test.ts` |
| Addressed messages and durable delivery | Scoped messages with deterministic request identities, queued delivery, recipient-filtered model context and one logical return | `src/experts/service.ts`, `bridge.ts`; interruption journey in `test/J-TEAM-execution.test.ts` |
| Return routing and continuity | Native parent continuations, terminal-run completion bridge, restart scans and idempotent resolution | `test/experts-runtime-scheduling.test.ts`, subprocess SIGKILL recovery test |
| Private/shared knowledge and context stewardship | Provenance/classification, personal/private-Team/Team boundaries, bounded lexical retrieval, pinned facts and unresolved commitments | `test/J-EXPERT-memory.test.ts`; `ExpertsService.context` |
| Identity-specific tools and prompt composition | Frozen model/tool/context specification, existing coding gates, native commitments for effects, typed abstention | `test/expert-model-routing.test.ts`, `test/expert-effect.test.ts` |
| Roster/group/client management | Native React sidebar, editors, conversations, history, evidence, approvals, memory and human decisions | `test/ui-experts.test.tsx`, `test/E2E-experts.test.ts`; `screenshots/experts/` |
| Schedules and live steering | Deferred. Existing automation records do not execute; addressed communication is explicitly queued | `docs/known-gaps.md` |

The task-acquired donor checkout was deleted after examination and native implementation. No donor source was copied or adapted; behavior descriptions and provenance are retained here. No donor file entered the index.

Dependency audit found an existing SDK-internal dependency: Cognate 0.2.0's runtime depends on
`@godspeedai/cognate-kernel-cordis`, which depends on `cordis`. This predates the task and remains
unchanged in `bun.lock`. Workbench adds no direct Cordis use or donor plugin/runtime. A literal
ban on all transitive Cordis conflicts with retaining the prescribed published Cognate SDK.
The operator explicitly approved keeping that existing SDK-internal dependency, with no direct
Cordis imports or donor runtime integration added by Workbench.
