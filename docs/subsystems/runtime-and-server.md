# Subsystem: runtime and server

## Purpose

Boot one process that serves the UI, serves the RPC API, and hosts the Cognate runtime; and shut all
of it down cleanly.

## Responsibilities

`src/server.ts` owns process lifecycle: directory creation, store selection, secret store opening,
semantic-model loading, capability binding, runtime construction, component mounting, provider
restoration, optional RealityTrace wiring, UI bundling, HTTP serving, and ordered shutdown.

It also owns the trust configuration: `LOCAL_OPERATOR`, `SYSTEM_CALLER`, the policy, and
`GRANTED_CAPABILITIES` — the explicit allow-list handed to the dev authenticator.

## Non-responsibilities

It does not implement domain rules, hold application state, or make policy decisions. `buildPolicy`
grants every capability to the operator principal and states in a comment that default-deny is
enforced one layer down, at the capability layer. `buildActionPolicy` returns `{ allow: true }` for
the same reason: the real gate is the capability's own validation.

## Position in the system

Called by `import.meta.main` (the `bun src/server.ts` / `just dev` path) and directly by tests
through the exported `startServer()`. Nothing else imports it.

It imports `storeConfigFor` from `src/store.ts`, every binding from `domain/index.ts`, every agent
from `src/agents/`, and every component from `src/capabilities/` and `src/components/`.

## Core abstractions

```ts
export interface ServerOptions {
  readonly port: number;
  readonly home: string;
  readonly forkRoot?: string;
  readonly extraMediators?: readonly MediatorSpec[];
}

export interface AppServer {
  readonly url: string;
  readonly runtime: Runtime;
  stop(): Promise<void>;
}

export const LOCAL_OPERATOR = { actor: { id: "operator", kind: "user" as const }, tenant: "local" };
const SYSTEM_CALLER = { actor: { id: "system", kind: "system" as const }, tenant: "local" };
```

`extraMediators` exists so tests can register a lower-trust mediator under the host's user tier.

## Internal operation

Boot order matters, and three steps in particular are load-bearing:

**The domain model loads before anything is constructed.** `loadDomain()` parses the `.sea` file,
logs the object count and digest, and throws on a parse error. A malformed semantic model stops the
process at boot rather than producing a half-mounted runtime.

**The provider is remounted from durable state.** After the components mount, the boot reads the
`model-config` projection and re-mounts the last configured provider. `model.generate` is not itself
durable; only the `model.configured` event is. Without this, a run paused on an open approval
continuation and resumed after a restart would have no provider to call.

**RealityTrace is wired if present and read always.** If `SXR_BIN` or the pinned local binary
resolves, the observation delivery is started. If not, the boot logs
`observations stay queued (dev tools unaffected)`. Either way the read-side observation component is
mounted, so the inspector shows honest queued states instead of erroring.

Shutdown is ordered and complete: abort the events loop, stop observations, stop the HTTP server,
close the runtime, and dispose the execution world registry — the last step is what closes SSH/SFTP
connections and WSL sessions this process opened.

## State

Reads: `model-config`, `execution-worlds` projections at boot.
Owns at runtime: the HTTP server, the events background loop, the provider handle, the execution
world registry, the RealityTrace delivery loop.
Writes: `.generated/entry.tsx`, the home directory, PostgreSQL schemas.

## Lifecycle

```
bun src/server.ts
  └─ import.meta.main
       └─ startServer({ port, home })
            ├─ mkdir(home) · storeConfigFor · secretStore
            ├─ loadDomain()                      ← fails fast on a bad .sea
            ├─ bindTranche5/7/9/10/ExecutionWorlds/Usage2/Usage3/Workbench
            ├─ createRuntime(...)
            ├─ kernel.mount(...) × N
            ├─ remount provider from model-config
            ├─ wireObservations()  (optional)
            ├─ build UI bundle + concatenate CSS
            └─ Bun.serve({ hostname: "127.0.0.1", port })
```

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| Boot aborts with a DomainForge parse error | `.sea` syntax error | Fix the model; the process will not start in a degraded state |
| `EADDRINUSE` on 3180 | Another instance | Set `PORT` |
| Run resumes but cannot call `model.generate` | No provider configured in `model-config` | Configure a provider in Settings |
| Observations stay queued forever | No SXR binary | [Install RealityTrace](../how-to/install-realitytrace.md) |
| SSH worlds fail after restart | Registry is in-memory and rebuilt from `execution-worlds` | Reconnect if the durable record alone was not enough |

## Extension points

- **A new capability family**: write the component, mount it here, add its ids to
  `GRANTED_CAPABILITIES`.
- **A new execution world kind**: add it to `createExecutionWorldRegistry([...])` here. It must
  provide `filesystem.resolve`, `filesystem.readText`, `filesystem.list`, and `process.exec`.
- **A new entry point**: call the exported `startServer()`.

## Source trail

- `src/server.ts` — the whole subsystem; key symbols `startServer`, `GRANTED_CAPABILITIES`,
  `buildPolicy`, `buildActionPolicy`, `BROWSER_ENTRY_TEMPLATE`, `indexHtml`, `LOCAL_OPERATOR`,
  `SYSTEM_CALLER`
- `src/store.ts` — `storeConfigFor`, `schemaFor`, `postgresUrl`
- `cognate.config.ts` — app metadata only; explicitly not consumed at runtime
- `justfile`, `package.json` — the commands that reach this subsystem
- `.github/workflows/verify.yml` — the CI sequence that exercises it