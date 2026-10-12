# Subsystem: execution worlds, providers and secrets

These three share a property worth naming up front: they are the places where Workbench touches
something outside the process. Together they are the trust surface.

---

# Execution worlds

## Purpose

Let a workspace live somewhere other than this computer without the agent loop learning that fact.

## Responsibilities

- Provide `filesystem.resolve`, `filesystem.readText`, `filesystem.list` and `process.exec` for a
  named place.
- Answer probes about a remote before anything is authenticated.
- Hold safe metadata: the auth *kind*, a key *path*, and a pinned host-key fingerprint.

## Non-responsibilities

It does not decide whether an operation is permitted. That is `authority.check` and the approval
gate. It does not sandbox anything.

## The core idea

A workspace is the pair `(executionWorldId, root)`. Tools, the agent loop, sessions, plans and
approvals never learn whether that world is local, an SSH host, or a WSL distribution. They ask the
world's provider. That is what allows a new kind of world to be added without touching the agent.

`world.fork` in the cognitive layer is the same mechanism used for isolation: a disposable directory
copy registered under its own world id. It is explicitly *not* a hardened sandbox — the lineage
events are the truth, not the directory's lifetime.

## Lifecycle

```
execution.world.probe     read a host key, stop. Authenticates nothing.
                          the human sees the fingerprint and decides to trust it.
execution.world.connect   verify usable, store secrets, record safe metadata + fingerprint
execution.world.check     is the live connection usable now (reconnects lazily)?
                          drives the UI's reachability banner
execution.world.disconnect release, delete secrets. Refused while a workspace uses it.
```

The registry is in memory and rebuilt at boot from the `execution-worlds` projection. That rebuild is
why the durable record stores only what is needed to reconnect, and why secrets live in
`secrets.json` rather than in the record.

## Trust properties

- A remote workspace is badged in the sidebar.
- If a world becomes unreachable, a banner says so and why. Nothing silently falls back to running
  locally.
- A connection can be reused for several workspaces.
- Passwords and passphrases exist only in the 0600 `secrets.json`. The durable record carries the
  auth kind, a key path, and the fingerprint — never key material.

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| "unreachable" banner after restart | The live connection is gone; the record survived | Reconnect |
| `disconnect` refused | A workspace still points at the world | Remove or move the workspace |
| Fingerprint mismatch | `known_hosts` disagrees with the pinned value | Investigate before trusting; do not bypass |

## Source trail

- `src/capabilities/executionWorlds.ts` — `executionWorldsManageComponent`,
  `restoreExecutionWorlds`
- `src/server.ts` — `createExecutionWorldRegistry([localExecutionWorld()])`, the `dispose()` on stop
- `src/projections/executionWorlds.ts` — `WorldRecord`, `executionWorldsProjection`
- `src/capabilities/workspaceSelect.ts`, `src/capabilities/workspacePath.ts`
- `src/ui/RemoteWorkspaceForm.tsx`
- `package.json` — `@godspeedai/cognate-execution`, `-ssh`, `-wsl`
- `test/J-RW-ssh-workspaces.test.ts`, `test/J-WS2-multi-workspace.test.ts`,
  `test/E2E-remote-workspaces.test.ts`, `test/executionWorlds.test.ts`

---

# Model providers

## Purpose

Let the operator bring their own model, change wire protocol without a restart, and keep the API key
out of the event log.

## Responsibilities

- Build a provider from a `ModelConfig` and a secret.
- Publish `model.generate`, forwarding streamed text deltas through `ctx.progress`.
- Hot-swap atomically, rolling back if the replacement never activates.
- Restore the last configured provider at boot.

## Wire protocols

`ModelWireProtocol` is a four-member union — `openai-compatible`, `openai-completions`,
`openai-responses`, `anthropic-messages` — and `buildProvider` switches on it, throwing on anything
unrecognised. `openai-compatible` and `openai-completions` share an implementation; the first is
retained for configurations persisted earlier.

**The protocol table, the streaming mechanism, and the hot-swap sequence are documented in
[Provider hot-swap](../workflows/provider-hot-swap.md).** This page records what the subsystem owns;
that page records what happens, step by step.

## Hot-swap and boot restoration

Two properties that belong to this subsystem rather than to any one request:

**Swap is atomic and rolls back.** `ProviderRegistry.swap` mounts the replacement first and waits for
it to reach `ACTIVE`. Only then does it dispose the previous handle. If activation fails, the new
handle is disposed and the old provider stays mounted and usable — a hot-swap failure must not take
the app down.

**Boot restores from durable state.** `model.generate` is not durable; only the `model.configured`
event is. At boot the server reads `model-config` and remounts the last provider. Without this, a run
resumed from an open approval continuation after a restart would have no provider to call.

## Secrets

| Fact | Location |
|---|---|
| API key | `<home>/secrets.json`, key `model-provider:<providerId>` |
| Provider id, base URL, protocol, model, timestamp | the `model-config` projection |
| Never in the event log | the `model.configured` payload contains no secret — the capability comment says so explicitly |

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| `model.configure: unsupported wire protocol` | Protocol not in the union | Fix the value |
| Hot-swap error, old provider still working | Replacement never reached `ACTIVE` | Reconfigure from Settings |
| Agent returns a provider error with a retry badge | Classified provider error | Retry backoff; `MODEL_RETRY_BACKOFF_MS` overrides the base delay |
| No provider after a restart | `model-config` had no row | Configure one |

## Source trail

- `src/components/providerRegistry.ts` — `ModelWireProtocol`, `ModelConfig`, `buildProvider`,
  `ProviderRegistry.swap`
- `src/components/modelProvider.ts` — `streamingProviderComponent`
- `src/capabilities/modelConfigure.ts` — `modelConfigureComponent`
- `src/capabilities/secretPut.ts` — `secretPutComponent`
- `src/secrets.ts` — `secretStore`, the 0600 file
- `src/projections/modelConfig.ts` — `modelConfigProjection`
- `src/server.ts` — the boot remount and the `writePolicy` comment
- `test/J-CFG-model-provider.test.ts`, `test/providerRegistry.test.ts`