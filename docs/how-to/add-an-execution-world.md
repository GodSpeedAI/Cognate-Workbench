# How-to: add an execution world

## Goal

Make a workspace live somewhere other than this computer — a container, a remote host, a VM — without
the agent loop learning that fact.

## The contract

An execution world answers four capabilities:

```
filesystem.resolve     a relative path → an absolute path in this world
filesystem.readText    read a file
filesystem.list        enumerate a directory
process.exec           run a command, with a result carrying stdout/stderr/exitCode/timedOut
```

If your world answers those four, the agent loop, the tools, sessions, plans and approvals work
against it unchanged. That is the whole point: a workspace is `(executionWorldId, root)`, and
nothing above the world knows what kind it is.

## Procedure

### 1. Implement the provider

Write an execution world provider. Model it on `localExecutionWorld()` from
`@godspeedai/cognate-execution`, which is the reference implementation for a local directory.

Whatever you return, preserve these properties:

- **Path containment.** `filesystem.resolve` must not let a path escape the world root, except
  where the task's `filesystem.outsideWorkspace` grant explicitly allows it.
- **No silent fallback.** If the world is unreachable, fail. Never run the command somewhere else.
- **Result shape.** `ExecResult` carries `exitCode`, `timedOut`, `stdout` and `stderr`. The
  verification path treats `exitCode === 0 && !timedOut` as a pass, so both fields must be truthful.

### 2. Register it

In `src/server.ts`:

```ts
const executionWorlds = createExecutionWorldRegistry([
  localExecutionWorld(),
  myExecutionWorld(),
]);
```

### 3. Grant the capabilities

Framework execution capability ids are already granted through `EXECUTION_CAPABILITY_IDS` in
`GRANTED_CAPABILITIES`. If your world introduces new ids, add them there.

### 4. Make it connectable

For a *remote* world, add connect / probe / check / disconnect handling in
`src/capabilities/executionWorlds.ts`, following the SSH and WSL paths:

- `probe` reads a host key (or equivalent) and **stops**. It authenticates nothing. The human sees
  the fingerprint and decides to trust it.
- `connect` verifies the world is usable, stores secrets, and records only safe metadata: the auth
  *kind*, a key *path*, and the pinned fingerprint. Never a password, passphrase, or key material.
- `check` reports whether the live connection is usable now, reconnecting lazily.
- `disconnect` releases the world and deletes its secrets, and is **refused while a workspace still
  uses it**.

### 5. Make it durable

The `execution-worlds` projection stores exactly what is needed to rebuild the provider after a
restart. Add whatever your `connect` needs to that record — and nothing more.

Secrets go to `secrets.json`, never to the event log.

### 6. Surface it in the UI

A remote workspace should be badged in the sidebar, and an unreachable world should produce a banner
saying so and why. Both are trust affordances, not decoration.

## Validation

```bash
just typecheck
bun test test/executionWorlds.test.ts
just test
```

Then add a workspace pointing at the new world and send a turn that reads and edits a file. Confirm
the agent's tool calls succeed without any change to `agent.coding`.

## Security notes

- The world's provider answers `filesystem.*` and `process.exec`. Treat it as the highest-trust code
  you write.
- Path containment is normalised workspace-relative checking, not an OS sandbox. If your world can
  enforce containment at the kernel or container level, do that instead — but do not assume it, and
  do not describe the current mechanism as a sandbox.
- A fingerprint that the human is asked to trust is only useful if it is compared against a known
  source. Do not let a connect path skip that comparison.

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| Tools fail with "no provider" for the world id | Not registered at boot | Step 2 |
| Workspace works, then is unreachable after a restart | The durable record lacks what `connect` needs | Step 5 |
| `disconnect` refused | A workspace still uses the world | Move the workspace first |
| Commands run in the wrong place after a failure | A fallback path | Remove it; never fall back to local |

## Rollback

Unregister the world from the registry. Existing workspaces pointing at it become unreachable, which
is the correct and visible failure. Their durable records stay in `execution-worlds`; drop them
yourself if you want them gone.

## Source trail

- `src/server.ts` — `createExecutionWorldRegistry`, the mount, and the `dispose()` on stop
- `src/capabilities/executionWorlds.ts` — `executionWorldsManageComponent`, `restoreExecutionWorlds`
- `src/projections/executionWorlds.ts` — `WorldRecord`, the durable shape
- `src/capabilities/workspaceSelect.ts`, `workspacePath.ts` — `(executionWorldId, root)` resolution
- `src/ui/RemoteWorkspaceForm.tsx` — the connection form
- `src/capabilities/cognitive.ts` — `world.fork`, a world used for isolation
- `package.json` — `@godspeedai/cognate-execution`, `-ssh`, `-wsl`
- `test/executionWorlds.test.ts`, `test/J-RW-ssh-workspaces.test.ts`,
  `test/E2E-remote-workspaces.test.ts`