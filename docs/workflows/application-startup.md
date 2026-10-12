# Workflow: application startup

## Summary

`just dev` runs `bun src/server.ts`. The module's `import.meta.main` block reads the port and the
home directory from the environment, calls the exported `startServer()`, and prints the URL and the
dev bearer token. `startServer` does ten things in a fixed order, then `Bun.serve` binds a socket on
loopback.

## Sequence

1. **Resolve environment.** `port = PORT ?? 3180`.
   `home = COGNATE_WORKBENCH_HOME ?? COGNATE_HARNESS_HOME ?? <repo>/.data`.
   The second variable is legacy and still accepted for migration.
2. **Prepare the home.** `mkdir(home, { recursive: true })`.
3. **Select the store.** `storeConfigFor(home, "harness")`:
   - `COGNATE_POSTGRES_URL` set → `{ postgres: { url, schema } }`
   - otherwise → `{ postgresPg0: { name: COGNATE_PG0_NAME ?? "cognate-dev", schema } }`
   where `schema = "cognate_harness_" + sanitised(home)` — so the same home always maps to the same
   schema, and each test's temp home maps to an isolated one.
4. **Open the secret store** at `<home>/secrets.json`.
5. **Load the semantic model.** `loadDomain()` reads
   `.sea/interaction/interaction-model.sea` via DomainForge, logs the object count and digest, and
   **throws on a parse error**. Nothing mounts until the model is valid.
6. **Bind capabilities.** Every tranche in `domain/index.ts` runs `bindCapabilities` and asserts its
   expected contract count.
7. **Create the runtime** with the store, the outbox hook, the policy, the action policy, every
   component, every projection, and every agent.
8. **Mount components** in groups: tools and workspaces, execution worlds, cognitive, secrets,
   session history, model configure, settings, onboarding, plans, subagents, workbench, observations.
9. **Remount the provider.** Read `model-config`; if a row exists, rebuild the provider and mount it.
   Required: a run resumed after a restart needs a live `model.generate`.
10. **Wire RealityTrace** if a binary resolves (`SXR_BIN`, else the pinned local path). If not, log
    the warning and leave observations queued. Mount the read-side observation component either way.
11. **Build the UI.** Write `.generated/entry.tsx`, run `Bun.build` for the browser target, and
    concatenate `app.css` with the workbench sheets in the order
    `base, contract, tasks, review, skills, workflow, automation, cockpit`.
12. **Serve.** `Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0 })` with a `fetch` handler
    for `/health`, the Connect service, `/app.js`, `/app.css`, `/astryx.css`, `/theme.css`, `/`, and
    a 404 for everything else.

Then the module prints:

```
[cognate-workbench] listening on http://127.0.0.1:3180 (home: …)
[cognate-workbench] dev auth: Authorization: Bearer …
```

## Detailed path

| Step | Symbol |
|---|---|
| 1 | `src/server.ts` module tail, under `import.meta.main` |
| 3 | `storeConfigFor`, `schemaFor` in `src/store.ts` |
| 4 | `secretStore` in `src/secrets.ts` |
| 5 | `loadDomain` re-exported from `domain/index.ts` |
| 6 | `bindTranche5`, `bindTranche7`, `bindTranche9`, `bindTranche10`, `bindExecutionWorlds`, `bindUsage2`, `bindUsage3`, `bindWorkbench` |
| 7 | `createRuntime` from `@godspeedai/cognate-runtime-bun` |
| 8 | `runtime.kernel.mount(...)` calls |
| 9 | `runtime.service.readProjection(LOCAL_OPERATOR, { name: "model-config" })` then mount |
| 10 | `wireObservations`, `defaultSxrBin` in `src/observations.ts` |
| 11 | `BROWSER_ENTRY_TEMPLATE`, `stylesheetPaths()`, the `WORKBENCH_CSS` list |
| 12 | `Bun.serve` |

## State changes

Created: the home directory; `secrets.json` if secrets are written; `.generated/entry.tsx`;
one or more PostgreSQL schemas.

Read: nothing durable at boot except the `model-config` projection and, during step 10, the plugin
gate.

Started: a background loop folding `workspace.added` into a known-workspace set; the RealityTrace
drain loop if wired.

## Failure branches

| Branch | Symptom | Cause |
|---|---|---|
| DomainForge parse error | Boot aborts before anything mounts | `.sea` syntax |
| Binding count mismatch | Boot throws naming the tranche | A capability was removed from a component without updating `bind*` |
| No provider row | No provider mounted; the agent cannot call the model until one is configured | First run, or a fresh home |
| No SXR binary | `realitytrace: SXR binary not found; observations stay queued` | Optional dependency absent |
| Port in use | `EADDRINUSE` | Another instance; set `PORT` |

## Shutdown

`AppServer.stop()` in order: abort the events controller, stop observations, stop the HTTP server,
`runtime.close()`, then `executionWorlds.dispose()`. The last step is not cosmetic — it is what
closes the SSH/SFTP connections and WSL sessions this process opened.

## Sequence diagram

```mermaid
sequenceDiagram
    participant OP as operator
    participant M as src/server.ts
    participant DF as DomainForge
    participant RT as Cognate runtime
    participant PG as PostgreSQL / pg0
    participant SXR as RealityTrace (optional)

    OP->>M: just dev
    M->>PG: ensure schema for the home
    M->>DF: loadDomain(.sea/interaction/interaction-model.sea)
    DF-->>M: objects + digest (throws on parse error)
    M->>RT: bind every tranche (count-asserted)
    M->>RT: createRuntime + kernel.mount(components, projections, agents)
    M->>PG: read model-config
    opt a provider was configured before
        M->>RT: mount the provider (so resumed runs can call model.generate)
    end
    opt SXR_BIN or the pinned binary exists
        M->>SXR: prepare, start the drain loop
    else absent
        M->>M: log "observations stay queued"
    end
    M->>M: write .generated/entry.tsx, Bun.build, concatenate CSS
    M-->>OP: listening on http://127.0.0.1:3180
```

## Source trail

- `src/server.ts` — `startServer`, `ServerOptions`, `AppServer`, `BROWSER_ENTRY_TEMPLATE`,
  `indexHtml`, `LOCAL_OPERATOR`, `SYSTEM_CALLER`, the mount sequence, the `stop()` body
- `src/store.ts` — `schemaFor`, `storeConfigFor`, `postgresUrl`
- `src/secrets.ts` — `secretStore`
- `src/observations.ts` — `wireObservations`, `defaultSxrBin`
- `domain/index.ts` — `loadDomain`, every `bind*`
- `justfile` — `dev`, `db-setup`, `db-up`, `db-status`, `db-down`
- `package.json` — `dev`, `start`
- `test/helpers.ts`, `test/wb-helpers.ts` — how tests boot a real server per suite