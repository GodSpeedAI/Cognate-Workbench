# Workflow: restart and recovery

## Summary

There is nothing to recover, because there is nothing mutable. The event log is the truth, the
projections are derived from it, and continuations are durable. A restart is therefore a
non-event for application state — and that claim is worth testing rather than asserting, so it is.

## What comes back

| Thing | Survives? | Why |
|---|---|---|
| Sessions and their turns | yes | Events; `sessions` folds them |
| Tool calls and their outputs | yes | Events; `session-trace` folds them |
| A pending approval | yes | The continuation is a durable `run.waiting` state |
| A pending plan review | yes | Same mechanism, `plan-review` continuation type |
| Task contracts, evidence, workflows | yes | `workbench.*` events |
| Cognitive Case, lineage, world hashes | yes | Cognitive events; the Case is re-derived |
| The model provider | yes, by reconstruction | `model-config` is durable; the handle is not |
| Execution worlds | yes, by reconstruction | `execution-worlds` holds what is needed to reconnect |
| Secrets | yes | `secrets.json` on disk |
| Observations not yet delivered | yes | Durable outbox; delivery is at-least-once |
| Fork directories | no | Disposable; lineage is the truth |
| The provider component handle | no | In memory; remounted at boot |
| Live SSH/WSL sessions | no | Closed on stop; rebuilt from the durable record |

## The boot-time reconstruction

Two things exist only in memory and must be rebuilt from durable state. Both are handled explicitly in
`src/server.ts`.

**The model provider.** `model.generate` is not durable; only the `model.configured` event is. The
server reads `model-config` and re-mounts the last provider. Without this, a run resumed from an open
approval would reach its next model call with no provider and fail.

**The execution world registry.** Rebuilt from `execution-worlds`, which stores exactly what is needed
to reconnect — the world kind, a label, safe metadata, and the connection details. Secrets come back
from `secrets.json`.

## Approvals across a restart

This is the case worth reading carefully, because the reference product this app was reconstructed
from behaved differently and the divergence is deliberate.

The reference kept a pending approval across a page *reload* but **not** across a full process
restart — after a restart it silently finalised the turn, with no approval card and no answer.
Reproducing that would have meant treating a durable event history as something to paper over.

This app does the opposite. A run's open continuations are durable by construction, so after
`stop()` and a fresh `startServer()` against the same store:

- the continuation is still `OPEN`,
- the run is still `waiting`,
- resolving it still completes the run normally.

`test/J-D-approval.test.ts` asserts exactly this, and `test/J-G-persistence.test.ts` covers the wider
persistence surface.

## Shutdown

`AppServer.stop()` runs in order:

1. abort the events controller,
2. stop observations,
3. stop the HTTP server,
4. `runtime.close()`,
5. `executionWorlds.dispose()` — closes every SSH/SFTP connection and WSL session this process
   opened.

Step 5 exists because leaking remote sessions across a restart is a real failure mode, not a
tidiness issue.

## Failure branches

| Branch | Behaviour |
|---|---|
| A run was waiting on an approval | It is still waiting. Resolve it or stop the run |
| A provider was never configured | No provider is mounted; resumed runs fail at their next model call |
| An execution world is unreachable after restart | The UI's reachability banner says so. Nothing silently falls back to local execution |
| Observations were queued when the process stopped | Delivery resumes from the durable outbox on the next boot |
| A fork directory was deleted | `world.attach` re-registers an existing directory; lineage never depended on it |

## What "recovery" would even mean here

The failure mode this design removes is the reconciliation problem: a system with mutable state must
reconcile that state against reality after a crash, and that reconciliation is usually where bugs
live. Here, reality is the log, and everything else is a function of it.

The trade is that every read is a fold, and folds cost something. The design accepts that cost rather
than the reconciliation risk. See
[Why the event log is authoritative](../explanation/why-event-sourcing.md).

## Source trail

- `src/server.ts` — the boot remount and the ordered `stop()`
- `src/store.ts` — `schemaFor`, which makes the home path determine the schema
- `src/projections/sessionTrace.ts` — the authoritative trace fold
- `src/capabilities/modelConfigure.ts`, `src/components/providerRegistry.ts` — provider restoration
- `src/capabilities/executionWorlds.ts` — `restoreExecutionWorlds`
- `src/observations.ts` — durable outbox and at-least-once delivery
- `test/J-G-persistence.test.ts`, `test/J-D-approval.test.ts`, `test/J-WS2-multi-workspace.test.ts`
- `test/helpers.ts`, `test/wb-helpers.ts` — how tests start and stop a real server