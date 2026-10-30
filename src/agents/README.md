# agents (Cognate Agent Definitions)

## Overview

Durable Cognate agent run bodies for the Cognate Workbench. Each file exports an
`AgentDefinition` (from `@godspeedai/cognate-runtime-api`) whose `run` is a
deterministic, replay-safe event-recording body: it emits durable domain events
via `ctx.emit`, waits on durable human-approval continuations via `ctx.waitFor`,
and invokes capability handlers via `ctx.invoke`. All I/O (secret writes,
provider hot-swap, filesystem access, hashing, observers) happens in the
capability handlers before or beside these runs; the run bodies only record
facts. `agentCoding.ts` is the coding engine: one run per user turn, folding
history and driving a model -> tool_calls -> capability invocation loop.
`agentExpert.ts` wraps `agentCodingAgent` for governed durable Expert runs.

## Interface

- [agentCoding.ts:AGENT_CODING] — agent id `"agent.coding"`; exported from [agentCoding.ts:agentCodingAgent] (`AgentDefinition`, version `"1.0.0"`).
- [agentCoding.ts:AgentCodingInput] — run input: `{ sessionId, workspaceId, message, mode?, preset?, caseId?, taskId?, expertExecution? }`.
- [agentCoding.ts:AgentPreset] — `"standard" | "ptc" | "minimal"`; [agentCoding.ts:PRESET_TOOLS] maps each preset to its allowed tool names; [agentCoding.ts:isAgentPreset] is the type guard; [agentCoding.ts:toolsForPreset] filters a catalog by preset (absent preset keeps the full catalog).
- [agentCoding.ts:TOOL_DEFS] — standing tool catalog (`read`, `edit`, `bash`, `todo_write`, `exit_plan_mode`, `subagent`, `run_code`).
- [agentCoding.ts:UI_TOOL_DEFS] — shared-attention tools (`ui_context`, `ui_timeline`, `ui_compare`, `ui_inspect`), offered only while a Case is open.
- [agentCoding.ts:EXPERT_TOOL_DEFS] — Expert-only tools (`team_delegate`, `team_message`, `expert_memory_read`, `expert_memory_write`, `expert_return`).
- [agentConfig.ts:AGENT_CONFIG] — agent id `"agent.config"`; exported from [agentConfig.ts:agentConfigAgent] (`AgentDefinition`, version `"1.0.0"`).
- [agentConfig.ts:AgentConfigInput] — discriminated union of configuration commands (`model.configured`, `workspace.added`, `workspace.contained.added`, `workspace.selected`, `workspace.renamed`, `workspace.deleted`, `provider.deleted`, `plugin.installed`, `plugin.uninstalled`, `session.archived`, `session.created`, `session.recorded`, `execution.world.connected`, `execution.world.disconnected`, `onboarding.dismissed`, `workbench.recorded`, `settings.changed`).
- [agentConfig.ts:SESSION_EVENTS] — the session-event recording gate (`["session.task.bound"]`), with type [agentConfig.ts:SessionEventType].
- [agentCognitive.ts:AGENT_COGNITIVE] — agent id `"agent.cognitive"`; exported from [agentCognitive.ts:agentCognitiveAgent] (`AgentDefinition`, version `"1.0.0"`).
- [agentCognitive.ts:COGNITIVE_EVENT_TYPES] — `ReadonlySet` of cognitive event types the agent may record (`case.opened`, `criterion.frozen`, `world.baseline.frozen`, `world.candidate.frozen`, `world.candidate.rejected`, `world.settled`, `verification.observed`, `sentinel.finding`, `experiment.round.completed`, `method.recommended`, `method.accepted`).
- [agentCognitive.ts:AgentCognitiveInput] — `{ eventType, payload }`.
- [agentExpert.ts:agentExpert] — `AgentDefinition` (id `EXPERT_AGENT` from `../experts/types.ts`), version `"1.0.0"`; resolves trusted context via the `expert.context` capability, delegates to [agentCoding.ts:agentCodingAgent], and writes a receipt via `ctx.artifact`.
- Private (not exported): [agentCoding.ts:invokeModelGenerate] (retrying `model.generate`/`expert.model.generate` invocation), [agentCoding.ts:classifyModelFailure] (maps `InvocationFailedError` to `{ code, message }`), [agentCoding.ts:toolsForExpert], [agentCoding.ts:invokeTool], [agentConfig.ts:validateSettingsPatch].

## Invariants

- Run bodies only emit; all I/O happens in capability handlers before the run starts (stated and enforced in [agentCognitive.ts:agentCognitiveAgent] and [agentConfig.ts:agentConfigAgent] file headers; e.g. `provider.deleted` requires the handler to remove the stored secret before the run records the deletion).
- [agentConfig.ts:validateSettingsPatch] rejects unknown settings fields and requires every present field to validate exactly as the `settings.change*` capability writers validate them, so an unvalidated field never becomes durable.
- [agentConfig.ts:agentConfigAgent] allows `workbench.recorded` only for event types in `WORKBENCH_EVENTS` plus [agentConfig.ts:SESSION_EVENTS], and `session.recorded` only for `SESSION_EVENTS`; anything else throws.
- The `settings.changed` case re-validates the patch through [agentConfig.ts:validateSettingsPatch] even if a caller bypassed the capability layer (second validation gate).
- [agentCoding.ts:MAX_TOOL_STEPS] is `20` and [agentCoding.ts:MAX_MODEL_RETRIES] is `5` (1 initial attempt + 5 retries); the loop always returns or throws — `BUDGET_EXCEEDED` and exhausted retries emit `turn.failed` and throw; a cancelled run (`ctx.signal.aborted`) stops retrying immediately.
- Read-before-edit guard in [agentCoding.ts:invokeTool]: editing a pre-existing file without a prior `read` fails with `fs_not_observed`; the file-existence check is boxed in `ctx.step` so replay returns the recorded answer.
- A tool call for a tool outside the turn's preset-scoped catalog fails closed with `Error: unknown tool "<name>"` (in [agentCoding.ts:agentCodingAgent]).
- `edit`/`bash` calls pass through the `authority.check` capability first; a `deny` verdict blocks the tool and, for `protected-evidence` rules, emits `workbench.protection.blocked`.
- A read-only Expert execution cannot inherit workspace-wide tool grants: `edit`/`bash`/`run_code` are forced to require human approval ([agentCoding.ts:agentCodingAgent]); Expert tools never include the generic `subagent` tool ([agentCoding.ts:toolsForExpert]); `expert_return` is always exposed to Expert runs.
- [agentCognitive.ts:agentCognitiveAgent] throws on any `eventType` not in [agentCognitive.ts:COGNITIVE_EVENT_TYPES].
- The effective task association is resolved once per turn, validated against the session's available tasks via `task.list`, and frozen into the turn's `session.turn.started` evidence; an unbound turn's evidence carries no `taskId` (in [agentCoding.ts:agentCodingAgent]).
- `readFiles` is the only non-deterministic-looking local state; it is a plain `Set` rebuilt identically on every replay from recorded `tool.read` results (file header of [agentCoding.ts:agentCodingAgent]).
- `tool.call.started` is emitted up front for every call, before approval checks, so a pending approval always has a visible tool entry (in [agentCoding.ts:agentCodingAgent]).

## Side Effects

- Emits durable domain events via `ctx.emit`: `session.turn.started`, `message.completed`, `plan.mode.changed`, `plan.todos.updated`, `plan.review.requested`, `plan.review.decided`, `tool.call.started`/`tool.call.completed`/`tool.call.failed`, `tool.approval.requested`/`tool.approval.decided`, `model.request.retried`, `turn.failed`, `workbench.usage.recorded`, `workbench.task.activity`, `workbench.task.status.changed`, `workbench.steer.consumed`, `workbench.protection.blocked`, `sentinel.finding`, `subagent.spawned`, plus all [agentConfig.ts:AgentConfigInput] event kinds.
- [agentCoding.ts:invokeModelGenerate] invokes `model.generate` (or `expert.model.generate` for Expert runs) — network calls to model providers — with recorded backoff steps (`Bun.sleep` inside `ctx.step`, duration from `MODEL_RETRY_BACKOFF_MS`, default 300 ms).
- Capability invocations through `ctx.invoke` (their handlers perform real work): `task.list`, `task.checkout.resolve`, `plan.state`, `workspace.path`, `session.history`, `steer.pending`, `authority.check`, `risk.assess`, `ui.context`, `ui.request`, `case.observe`, `subagent.start`, `filesystem.resolve`, `filesystem.stat`, `tool.<name>`, `expert.tool.invoke`, `team.delegate`, `team.message`, `expert.memory.read`, `expert.memory.write`, `team.handoff`, `team.inbox.consume`, `expert.context`.
- Durable waits on human decisions via `ctx.waitFor`: `approve:<toolCallId>` (tool approvals), `plan-review:<toolCallId>` (plan review), `expert-assignment:<assignmentId>` (delegation handoff).
- [agentCoding.ts:agentCodingAgent] `subagent` tool starts a durable child `agent.coding` run via `subagent.start` (fire-and-forget; no `ctx.waitFor`).
- [agentConfig.ts:agentConfigAgent] and [agentCognitive.ts:agentCognitiveAgent] perform no I/O beyond `ctx.emit`.
- [agentExpert.ts:agentExpert] writes a JSON artifact (`expert-<assignmentId>-attempt-<attempt>.json`) via `ctx.artifact`.

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-C-tool-execution.test.ts` (tool loop, read-before-edit), `test/J-D-approval.test.ts` (approval gates), `test/J-E-plan.test.ts` (plan mode), `test/J-F-delegation.test.ts` (`subagent`), `test/J-H-provider-error.test.ts` and `test/J-H-cancellation.test.ts` (retry/cancellation), `test/expert-model-routing.test.ts` and `test/J-TASK-expert-provenance.red.test.ts` (Expert path), `test/J-CFG-config-path.test.ts` and `test/J-SET-settings.test.ts` (`agent.config`). All files verified present under `test/`.
