# Subsystem: agents

## Purpose

Give the runtime three bodies to execute. A run does work by invoking capabilities and emitting
events. Agents never own state and never talk to the filesystem, the network, or the model except
through a capability.

## Responsibilities

| Agent | Does |
|---|---|
| `agent.coding` | The conversational tool loop. One run per user turn. |
| `agent.config` | Emits domain events. No I/O, no randomness, replay-safe by construction. |
| `agent.cognitive` | Records cognitive facts (Case, criterion, world, verification, method). |

## Non-responsibilities

Agents do not validate. Validation lives in capabilities. Agents do not persist; they emit and the
runtime records. `agent.config` in particular does no I/O at all — its comment is explicit that every
side effect happened in the capability handler *before* the run was started.

## Position in the system

Invoked by the runtime, which is asked to start them by the UI (`agent.coding`, `agent.cognitive`) or
by capability handlers (`agent.config`). They call into capabilities via `ctx.invoke`.

## Core abstractions

`AgentDefinition` from `@godspeedai/cognate-runtime-api`. The `RunContext` (`ctx`) is the entire API
surface:

| Method | Purpose |
|---|---|
| `ctx.emit(type, payload)` | Record an event |
| `ctx.invoke(capability, input)` | Call another capability |
| `ctx.step(key, fn)` | Wrap a non-deterministic effect so it replays deterministically |
| `ctx.waitFor(type, opts)` | Park the run on a durable human wait |
| `ctx.progress({ kind: "text", text })` | Stream a delta into `run.invocation.progress` |
| `ctx.runId`, `ctx.actor`, `ctx.tenant` | Identity of the current execution |

### `agent.coding` input

```ts
{ sessionId, workspaceId, message, mode?, preset?, caseId?, taskId? }
```

`mode` and `preset` ride the turn event so projections can fold them. `caseId` adds the four shared-
attention tools. `taskId` scopes the authority plane.

### Presets

```ts
standard: read, edit, bash, todo_write, exit_plan_mode, subagent
ptc:      standard + run_code
minimal:  bash
```

A run without a preset keeps the full catalog, so direct API callers and older tests are unaffected.
A call for a tool outside the preset fails closed with `Error: unknown tool "<name>"` — and the
event is emitted before the check, so a rejected call still leaves a visible entry in the transcript.

## Internal operation

```
run starts
  emit session.turn.started { sessionId, workspaceId, message, mode?, preset? }
  invoke plan.state
    ├─ "/plan off" → emit plan.mode.changed { on: false }; emit message.completed; return
    └─ leading "/plan " and not already on → emit plan.mode.changed { on: true }
  invoke session.history { excludeRunId: ctx.runId }
  invoke workspace.path { workspaceId }
  loop:
    invoke model.generate   ← streams via ctx.progress
      ├─ plain answer → emit message.completed; return { text }
      └─ tool_calls → for each:
           emit tool.call.started
           preset check (fail closed)
           if tool in {edit, bash}: invoke authority.check → deny ⇒ tool.call.failed, feed refusal
           approvalGate({ tool, args, mode })
           if tool == bash and not already gated: invoke risk.assess (mediation)
           if gated: ctx.waitFor(`approve:${toolCallId}`, { type: "tool-approval" })
           invoke tool.<name>
           emit tool.call.completed | tool.call.failed
           append { role: "tool", content } to messages
    until MAX_TOOL_STEPS (20)
```

Determinism note: `readFiles` is the only non-deterministic local state, and it is a plain `Set`
rebuilt identically on every replay from the same recorded `tool.read` results. Every disk check
that matters is wrapped in `ctx.step`.

## State

Reads: `session.history`, `workspace.path`, `plan.state`, authority verdicts.
Writes: `session.turn.started`, `tool.call.*`, `message.completed`, `plan.*`,
`subagent.spawned`, `workbench.protection.blocked`, model-error and retry events.

## Lifecycle

One run per turn. A run may block indefinitely on a continuation (approval, plan review). Blocking
is durable — the run is `waiting`, not suspended.

## Failure modes

| Symptom | Cause | Where |
|---|---|---|
| `Error: unknown tool "run_code"` | Preset excludes it | preset check in the tool loop |
| `Error: blocked by authority (protected-evidence)` | Protected path | `authority.check` |
| `Error: blocked by approval (denied)` | Operator denied | `approvalDeniedToolResult` |
| Model error surfaces with a retry badge | Classified provider error | retry loop with backoff; `MODEL_RETRY_BACKOFF_MS` overrides the base delay |
| Run stalls after restart | Waiting on a continuation | Expected; resolve it from the UI |

## Extension points

A new agent is an `AgentDefinition` registered in `src/server.ts`. Add its id to
`GRANTED_CAPABILITIES` only if it is invoked by the client; server-invoked runs do not need a grant.

Keep new agents emit-only where possible. Any I/O belongs in a capability.

## Source trail

- `src/agents/agentCoding.ts` — `agentCodingAgent`, `AGENT_CODING`, `TOOL_DEFS`, `UI_TOOL_DEFS`,
  `AgentPreset`, `PRESET_TOOLS`, `isAgentPreset`, `toolsForPreset`
- `src/agents/agentConfig.ts` — `agentConfigAgent`, `AGENT_CONFIG`, `AgentConfigInput`
- `src/agents/agentCognitive.ts` — `agentCognitiveAgent`, `COGNITIVE_EVENT_TYPES`
- `src/domain/approvalGate.ts` — `approvalGate`, `approvalDeniedToolResult`
- `src/domain/planGate.ts` — `isPlanOffCommand`, `splitPlanPrefix`, `extractPlanHeading`
- `test/J-B-basic-session.test.ts`, `test/J-C-tool-execution.test.ts`, `test/J-D-approval.test.ts`,
  `test/J-H-cancellation.test.ts`, `test/J-H-provider-error.test.ts`, `test/J-E-plan.test.ts`