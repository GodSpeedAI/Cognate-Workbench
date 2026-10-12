# Why one Bun process

Two questions, one page: why does `src/server.ts` compose its own runtime instead of running
`cognate dev`, and why is the Connect service served in-process rather than through a second proxied
server?

The short answer to both: this app is a *single-tenant, single-operator application*, and every
design choice below follows from keeping it one process with one event log.

## Why not `cognate dev` / `createHarness`

The framework ships a harness profile and a CLI dev server. This app does not use them, and its own
configuration file says why:

```ts
// cognate.config.ts
// Not consumed by `cognate dev` (this app's `src/server.ts` composes its own runtime …).
// Kept for shape-parity with the `cognate create --profile harness` starter and as a single
// documented place for app metadata.
```

`src/server.ts` composes `createRuntime` by hand instead. The reasons visible in the code:

**The component set is specific.** This app mounts a particular set of components, a particular
policy, a particular action policy, and a particular outbox hook. `createHarness` would assemble a
general-purpose harness shape. The trade-off is that every change here is a change to application
code rather than to configuration.

**The boot sequence has app-specific requirements.** The semantic model must load and validate before
anything mounts. The last-configured provider must be remounted from durable state after the
components are up. The provider registry, the execution world registry and the observation wiring all
need specific construction order. Expressing that as a harness preset would be a fight.

**The trust configuration is app-specific.** `GRANTED_CAPABILITIES` is an explicit list — 51 literal
ids plus two spreads, `EXECUTION_CAPABILITY_IDS` from the execution package and the 23
`WORKBENCH_CAPABILITY_IDS` — handed to the dev authenticator. `buildPolicy` grants the operator
principal
everything and states in a comment that default-deny lives at the capability layer, one level down.
That is a deliberate, reviewable configuration for a single-operator app, and it reads clearly as a
list in source.

**`cognate.config.ts` still exists.** It is kept for shape parity with the generated starter and as a
single place for app metadata. It is not a runtime input. This is worth knowing so you do not go
looking for behaviour in it.

## Why the Connect service is served in-process

The framework's `serveRuntime` pattern, as used by the CLI's `dev()`, mounts a second Bun server and
proxies to it with `fetch()`. This app does not. The comment at the call site records what was
observed:

> that double `Bun.serve` hop was observed to leave `internal.stop()` hanging after an error
> response reached the outer proxy in this app's tests.

So the fix was to build the fetch handler directly with the same public calls `serveRuntime` uses
internally:

```ts
const connectRouter = createConnectRouter({});
registerRuntimeService(connectRouter, runtime.service, { authenticate: devTokenAuthenticator, maxJsonSize });
const connectHandler = createFetchHandler(connectRouter, { httpVersion: "1.1" });
```

…and route `/cognate.v1.RuntimeService/*` at it from the same `Bun.serve` that returns the UI.

The result is a genuinely single process with no proxy layer to hang.

## Why that matters beyond tidiness

A single process means:

- **One event loop and one store handle.** No IPC, no second connection pool, no ordering question
  between two servers.
- **One shutdown path.** `stop()` aborts the events loop, stops observations, stops the HTTP server,
  closes the runtime, and disposes the execution world registry. Nothing runs in another process that
  has to be found and killed.
- **One thing to bind.** The server listens on `127.0.0.1` and nothing else. There is no second
  port to accidentally expose.
- **A UI that is always the same version as the API.** The bundle is rebuilt on every boot from the
  working tree. There is no build/deploy skew.

The trade is honest: a long-running tool call occupies the same process that serves the UI. For a
single-operator desktop-style tool this is the right trade. It would not be for a multi-tenant
service, which is one more reason the current authenticator is described as a development boundary
and not a production one.

## What a rebuild actually costs

At boot the server writes `.generated/entry.tsx`, runs `Bun.build` for the browser target, and
concatenates the CSS. So editing UI code needs a server restart to take effect; there is no dev-mode
watch. For an app where a change usually means a change to a capability or the domain model, that is
a reasonable cost.

`.generated/entry.tsx` is a generated artifact. It is written on every start and is not source.

## Confidence

Both answers are **verified**: the reasoning is in comments at the call sites in `src/server.ts`, and
the observed hang is described in the comment directly above the router construction. The migration
notes contain the same explanation, so the two agree.

What is **not** recoverable from this repository is whether the alternative was ever benchmarked.
The hang is an observation from tests; there is no performance comparison on record.

## Source trail

- `src/server.ts` — the `import.meta.main` block, `createConnectRouter`, `registerRuntimeService`,
  `createFetchHandler`, the in-process comment, `Bun.serve`
- `cognate.config.ts` — the "not consumed by `cognate dev`" note
- `src/server.ts` — `GRANTED_CAPABILITIES`, `buildPolicy`, `buildActionPolicy`
- `package.json` — `@godspeedai/cognate-cli` is a dependency for metadata parity, not for the dev
  server
- `test/helpers.ts` — how tests boot the same `startServer`
- `.tmp/reconstruction/README.md` — the pre-existing statement of both rationales (recovered; see
  [Evolution and provenance](evolution-and-provenance.md))