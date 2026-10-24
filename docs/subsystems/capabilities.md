# Subsystem: capabilities

## Purpose

Be the only place anything consequential happens. A capability is a named, leased unit of effect:
it validates input, checks authority, performs the effect, and records the result.

## Responsibilities

- Validate every input against a projection or a pure module before acting.
- Refuse, with a specific reason, when preconditions fail.
- Perform the effect (I/O, provider call, filesystem or shell access).
- Start a run to record the outcome. Capabilities do not append events directly.

## Non-responsibilities

Capabilities hold no state between invocations. They do not decide product policy beyond their own
contract. They do not own domain rules — those live in the pure islands (`src/workbench/`,
`src/cognitive/`, `src/domain/`).

## Position in the system

Mounted on `runtime.kernel` by `src/server.ts`. Invoked by agents via `ctx.invoke`, by other
capabilities via the same path, and by the UI directly through the RPC for read-side and
client-invoked capabilities.

## The families

| File | Provides | Notes |
|---|---|---|
| `src/capabilities/tools.ts` | `tool.read`, `tool.edit`, `tool.bash`, `tool.run_code` | Path-contained to the workspace root; `edit` has a read-before-edit guard |
| `src/capabilities/workbench.ts` | 23 `task.*`, `evidence.*`, `authority.*`, `workflow.*`, `skill.*`, `automation.*`, `usage.*`, `parallelism.*`, `steer.*`, `feedback.*` | Human-only decisions require a `user` actor |
| `src/capabilities/cognitive.ts` | `case.*`, `criterion.*`, `world.*`, `verification.run`, `risk.assess`, `experiment.*`, `method.*`, `ui.*` | Settlement and acceptance are human-only |
| `src/capabilities/modelConfigure.ts` | `model.configure` | Writes the secret, then starts `agent.config` |
| `src/capabilities/secretPut.ts` | `secret.put` | The only writer of `secrets.json` from a capability |
| `src/capabilities/sessionHistory.ts` | `session.history` | Folds prior turns per call from `listRuns` |
| `src/capabilities/workspaceSelect.ts` | `workspace.select` | |
| `src/capabilities/workspacePath.ts` | `workspace.path` | Resolves `(executionWorldId, root)` |
| `src/capabilities/workspaceManage.ts` | `workspace.rename`, `workspace.delete` | Validates against the live `workspaces` projection |
| `src/capabilities/executionWorlds.ts` | `execution.world.probe/connect/check/disconnect`, `execution.wsl.list` | Probe authenticates nothing; the human trusts the fingerprint |
| `src/capabilities/planState.ts` | `plan.state` | Read side for the plan projection |
| `src/capabilities/subagentStart.ts` | `subagent.start` | Starts the child run; the parent records only that it started |
| `src/capabilities/settingsChange.ts` | 10 `settings.change*` | One field per capability, all realised by one component |
| `src/capabilities/onboardingDismiss.ts` | `onboarding.dismiss` | Durable per-home UI-flow state |
| `src/observations.ts` | `observation.status`, `observation.record` | Unrecorded read side over the receipt store |

The framework also supplies a spread of `filesystem.*` and `process.exec` capabilities that the
cognitive component depends on; those come from `@godspeedai/cognate-execution`, not from this
repository.

## Internal operation: the write path

Every durable change follows one shape:

```
capability handler
  ├─ read the live projection
  ├─ validate → on failure: throw with a specific reason (no state written)
  ├─ perform the effect (write a secret, mutate a file, call a provider)
  └─ service.startRun({ agent: "agent.config", input: { kind, ... } })
        └─ agent.config emits the event
              └─ projection folds
                    └─ UI re-renders
```

The consequence — reads immediately after a write can lag the projection by a moment — is documented
and deliberate. See [Why `agent.config` is the write path](../explanation/why-agent-config-is-the-write-path.md).

`RuntimeService.startRun` is itself not recorded as an event. The *domain* event the run emits is.

## State

Reads: `workspaces`, `workbench`, `settings`, `model-config`, `execution-worlds`, `plans`,
`cognitive`, event history via `listRuns`.
Writes: durable events (through runs); `secrets.json` (through `secret.put` and `model.configure`);
execution world registrations (in-memory, rebuilt from `execution-worlds`).

## Lifecycle

Stateless per invocation. Mounted at boot, disposed on stop. `ProviderRegistry` hot-swaps one
provider handle at a time and rolls back cleanly if the replacement never reaches `ACTIVE`.

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| Handler throws with a validation message | Precondition failed | Read the message; it names the field |
| Provider missing after a restart | `model-config` had no row | Configure a provider |
| Hot-swap failed before activation | New handle never went `ACTIVE` | Previous provider stays mounted and usable; retry |
| `execution.world.disconnect` refused | A workspace still uses the world | Remove or move the workspace first |
| A write seems to not stick | Projection fold is asynchronous | Wait on the durable row, not a sleep |

## Extension points

See [Add a capability](../how-to/add-a-capability.md) for the full procedure.

Non-negotiables when writing one:

1. Validate before you act.
2. Never keep state between invocations.
3. Record through a run.
4. Refuse, do not silently no-op.
5. If a human must be involved, require a `user` actor.

## Source trail

- `src/capabilities/` — all 27 files listed above
- `src/capabilities/tools.ts` — `PathEscapeError`, `ToolReadResult`, `ToolEditResult`,
  `ToolBashResult`, `ToolRunCodeResult`
- `src/capabilities/workbench.ts` — `WORKBENCH_CAPABILITY_IDS`, `workbenchComponent`
- `src/capabilities/cognitive.ts` — `cognitiveComponent`, `CognitiveOptions`
- `src/server.ts` — `GRANTED_CAPABILITIES`, the mount sequence
- `domain/index.ts` — the semantic binding for every published capability
- `test/workbench-authority-bypass.test.ts` — proves the authority plane cannot be stepped around