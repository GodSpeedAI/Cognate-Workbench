# preview — governed dev-server previews

## Overview

A governed surface for agent-built dev servers: the agent registers a URL it serves
through the explicit, agent-invocable `preview.register` capability; the service
probes readiness over HTTP (stdout regex detection is only a convenience), records
the registration durably against the owning session/task and world, and hands the
URL to the shared browser. Stopping is governed and durable: the owning session
ending (or an explicit `preview.stop`) kills the owned process with the terminal's
process-group discipline and folds the transition.

## Interface

- [service.ts:PreviewService] — registration, readiness probing, view URL
  resolution, stop with owner-ended cleanup; durable records via
  [service.ts:PreviewRegistration]/[service.ts:PreviewView]. Errors surface the
  reason (an unreachable port is refused with the reason and nothing recorded).
- [sshForward.ts:openSshForward] — SSH worlds are reached through a REAL
  direct-tcpip local forward over the world's ssh2 connection (host-key fingerprint
  re-verified), the view URL served on an ephemeral local port,
  [ssh.ts:SshForward]/[ssh.ts:SshForwardError] carrying close semantics. WSL worlds
  use the host's loopback forwarding (Windows-host feature, documented).
- Capability surface: `previewComponent` in `src/capabilities/` (`preview.register`
  is agent-invocable; `preview.stop` is operator/system).

## Invariants

- **Explicit registration only**: nothing is guessed into the registry; readiness is
  probed over HTTP before a preview is marked ready.
- **Unreachable is refused, not recorded**: a port that will not answer produces a
  refusal with the reason and no durable row.
- **Cleanup is durable, not memory-only**: the stop recorder is injected and shared
  by every stop path (owner-ended cleanup folds the same transition as an explicit
  stop); the owned pid is killed with group discipline.
- **No credentials in durable records**: the SSH forward path never writes password
  material into events or projections; local forwards bind ephemeral loopback ports,
  never public interfaces.
- Archiving the owning session stops the preview and the process (reason
  "owner ended").

## Side Effects

- Spawns nothing itself; it governs processes the agent started and kills owned ones
  (group discipline, liveness polled).
- Opens and closes SSH direct-tcpip local forwards for remote worlds.
- Emits `workbench.preview.*` events (metadata only).

## Verification

- `bun test test/J-PREVIEW-register.test.ts` — local-world lifecycle (explicit
  registration, readiness probe, the managed browser opens the URL, stop kills the
  owned process with group discipline), unreachable port refused with the reason and
  nothing recorded, owner-ended cleanup durable, and an SSH world preview reached
  through a REAL local forward (fingerprint re-verified, forward close actually
  closes, no password material in the durable record).
- `bun test test/E2E-mission.test.ts` — the end-to-end journey: the agent serves an
  app through governed bash, the preview is registered and readiness-probed, the
  operator inspects and annotates in the shared browser, the agent's edit lands, and
  an explicit refresh shows the change.
- WSL forwarding is documented, not tested on this host (WSL2 loopback forwarding is
  a Windows-host feature).
