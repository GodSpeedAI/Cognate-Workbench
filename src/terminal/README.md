# terminal — human-surface PTY sessions

## Overview

Interactive terminal sessions for the operator: a local PTY on this machine, a WSL
distribution shell on a Windows host, or an SSH shell channel to a remote world.
Sessions are a human surface, not an agent surface — agents keep `tool.bash`; a PTY
must not become an agent authorization bypass. Everything durable about a session is
metadata (identity, owner, world, label, lifecycle transitions) folded into the
workbench projection through `workbench.terminal.*` events; stream bytes are never
persisted.

## Interface

- [service.ts:TerminalService] — the session store and authority surface: open
  (owner-checked, world-resolved), attach (authenticated, owner-checked), resize,
  input, terminate, dispose; dead session ids answer honestly. Errors:
  [service.ts:TerminalAccessError], [service.ts:TerminalUnknownError].
- [types.ts:TerminalPort] (exported via [local.ts:localTerminalPort]'s re-export) —
  the adapter contract each backend implements: spawn with
  [types.ts:TerminalSpawnSpec]/[types.ts:TerminalSpawnCallbacks], resize, kill.
- [local.ts:localTerminalPort] — local PTY via `Bun.Terminal` (Windows ConPTY
  supported). [local.ts:wslTerminalPort] — WSL via `wsl.exe` under a local PTY
  (Windows-host only).
- [ssh.ts:sshTerminalPort] — SSH shell channel over ssh2; re-verifies the host key
  with the SDK's `probeHostKey` against the same known-hosts store the execution
  worlds use, and reads credentials from the existing `execution-world:<id>:*` secret
  keys ([ssh.ts:SshConnectionFacts]).
- [wsController.ts:terminalWsController] — the same-origin `/terminal/stream`
  websocket surface: first-message boot-token authentication, one surface tag shared
  with the browser stream controller in `src/server.ts`.
- Capability surface: `terminalComponent` in `src/capabilities/terminal.ts` (the
  `terminal.*` family; creation is operator-only).

## Invariants

- **Operator-only creation**: `terminal.*` creation requires `ctx.actor.kind ===
  "user"`; the contained posture constrains agent effects, not the operator's own
  machine — this distinction is deliberate and recorded in the
  desktop-terminal-browser architecture decisions.
- **No stream bytes in the event log**: only metadata events are emitted; scrollback
  is a bounded in-memory ring, never durable.
- **Group discipline**: explicit terminate kills the process group (children
  included); detach keeps the process running for reattach.
- **Refusals are honest**: unauthorized attach (bad token, foreign identity) is
  refused before any byte moves; cwd escapes are refused; dead sessions report dead.
- SSH host keys are re-verified on every connection — a changed fingerprint fails
  closed.

## Side Effects

- Spawns and owns PTY processes/process groups (local, `wsl.exe`, ssh2 channels);
  kills them with group discipline.
- Emits `workbench.terminal.*` events (metadata only).
- Reads execution-world secret keys for SSH credentials; never writes secrets.

## Verification

- `bun test test/J-TERMINAL-session.test.ts` — interact, resize (`stty size` honors
  the PTY size), detach keeps process, reattach restores scrollback, terminate kills
  the group, durable rows fold, anonymous/wrong-token/foreign-identity attach
  refused, dead ids report dead, cwd escapes refused.
- `bun test test/E2E-terminal.test.ts` — real Chromium: open, type, executed result
  distinct from echo, maximize/restore, close+reopen replays scrollback.
- Recorded limitations: the SSH journey was not exercised against a live sshd on the
  WSL host (recorded in the desktop-terminal-browser verification log); WSL paths are
  Windows-host-only by design.
