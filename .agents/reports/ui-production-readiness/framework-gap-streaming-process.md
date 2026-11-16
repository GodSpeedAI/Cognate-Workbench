# Framework gap: a streaming process port for the Cognate execution layer

Status: proposal for upstream (`@godspeedai/cognate-execution`). Not implemented in Cognate.
Raised by: Cognate Workbench external agent-harness sessions (J-HARNESS-*), 2026-11-01.

## Problem

`ProcessPort` has one method, `exec(spec: ExecSpec, options?: ExecOptions): Promise<ExecResult>`:
argv in, `{ stdout, stderr, exitCode, timedOut }` out, all buffered, after the process ends.
There is no stdin, no incremental output, no process identifier, and cancellation
(`ExecOptions.signal`) terminates only the spawned process (the local provider calls `proc.kill()`),
not its descendants.

External agent-harness CLIs need all four:

- Claude Code: a bidirectional `stream-json` session. Prompts and permission answers are written to
  stdin while stdout streams events; a permission request blocks the CLI until we reply.
- Codex: `codex app-server`, JSON-RPC both ways over stdio.
- ACP agents (OpenCode, Kimi, Copilot CLI, ...): JSON-RPC both ways; `session/request_permission`
  is a request from the agent that must be answered.
- Stop: a protocol interrupt, then stdin close, then the whole process group.

A buffered `exec` cannot show live text, cannot answer a permission request, and cannot stop a
process tree. Passing the prompt in argv is a quoting / ARG_MAX hazard.

## Workaround in the Workbench (and what it costs)

`src/agents/harness/hostProcess.ts` spawns on the server host with `Bun.spawn`, outside the
execution-world registry. It is used only for workspaces in a world of kind `local`. Consequences,
all stated in the model (`J-HARNESS-session`) and refused or labelled in the product:

- no remote, contained (bubblewrap), SSH or WSL harness sessions;
- it is outside the contained-posture guard and the aggregate containment ledger;
- the CLI's own tool calls are not seen by `authority.check`, protected-evidence blocking or
  settlement.

## Proposal

Add an optional port beside `exec`, in `@godspeedai/cognate-execution`:

```ts
interface SpawnSpec extends ExecSpec { /* argv, cwd, env */ }

interface SpawnedProcess {
  readonly pid: number | undefined;            // undefined where the world cannot expose one
  /** Write bytes/lines to stdin; resolves when flushed. */
  write(data: string | Uint8Array): Promise<void>;
  closeStdin(): Promise<void>;
  /** stdout as an async iterable of UTF-8 lines (bounded line length, error on overflow). */
  readonly lines: AsyncIterable<string>;
  /** Bounded tail of stderr. */
  stderrTail(): string;
  /** Resolves with the exit code (null when killed by a signal). */
  readonly exited: Promise<number | null>;
  /** Signal the whole tree: process group on POSIX, `taskkill /T /F` on Windows, equivalent in ssh/wsl. */
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
}

interface ProcessPort {
  exec(spec: ExecSpec, options?: ExecOptions): Promise<ExecResult>;
  spawn?(spec: SpawnSpec, options?: { signal?: AbortSignal }): Promise<SpawnedProcess>;   // optional
}
```

Contract notes:

1. `spawn` is optional so existing providers keep working; a world without it is reported as
   "cannot host interactive sessions" rather than failing at use time.
2. The posture guard and aggregate containment ledger wrap `spawn` exactly as they wrap `exec`
   (`UncontainedEffectRefusedError` for uncontained local worlds), so a harness session is governed
   like any other effect.
3. Providers: local (`Bun.spawn`, detached process group / job object), bubblewrap (same, confined
   argv), SSH (`client.exec` with a persistent channel and stdin), WSL (a dedicated process, not
   the shared marker shell).
4. Conformance kit: `spawn` must pass tests for stdin round-trip, line streaming, large-line
   rejection, kill-of-tree (a grandchild dies), signal-abort, and exit-code reporting.
5. A recorded wrapper for agents: a helper that turns a `SpawnedProcess` into the
   "advance until the next decision point" capability used here, so replay returns recorded
   outputs and never respawns the CLI.

## What the Workbench does when this lands

Replace `hostProcess.ts` with the port, route harness sessions through the workspace's execution
world, drop the "local world only" refusal, and put the CLI process under the same containment
and aggregate-ledger rules as `tool.bash`. The agent, adapters and event mapping are unchanged.
