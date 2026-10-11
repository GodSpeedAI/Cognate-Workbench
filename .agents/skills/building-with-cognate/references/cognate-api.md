# Cognate API Reference (for application developers)

Dense, code-verified reference for building an application ON Cognate. Every name below exists in
the cited source file; where docs and code disagreed, code wins (noted inline). CLI install/invoke
details live only in `cli.md` — this file just says `cognate create` / `cognate dev`.

**Reading source citations:** paths like `@godspeedai/cognate-runtime-api/src/types.ts` point into
the *installed* npm package (published as `@godspeedai/cognate-*`, [ADR-0012](../../../docs/decisions/ADR-0012-cognate-package-naming.md)) —
look in `node_modules/@godspeedai/cognate-runtime-api/src/types.ts`, or on npm for the versioned
package page. No Cognate checkout is needed; the same files ship inside every published tarball.

**`docs/*.md` links** point into the Cognate repository's documentation tree (private repo):
they are supplementary; this file plus the npm package READMEs carry the operational content.

## Contents

1. Mental model (10 lines)
2. Starting an app
3. Defining agents: `AgentDefinition`, `RunContext`
4. Capabilities: `Component`, contracts, policy
5. `RuntimeService` methods
6. Capability selection: eligibility, ranking, UCB1
7. Shared state
8. Client (`@godspeedai/cognate-client`) and React hooks
9. AG-UI, Connect, MCP, A2A
10. Stores: memory vs sqlite
11. Projections
12. Artifacts
13. RealityTrace evidence (optional)
14. Testing
15. Pitfalls

---

## 1. Mental model

An append-only event log (SQLite, one writer process) is the only truth; every run status, UI
view, and cognitive index is a fold/projection over it — delete a projection and rebuild it, lose
nothing. A **run** is the durable execution of one `AgentDefinition`; it is not a coroutine. Every
re-entry (after suspend, crash, or retry) re-reads the run's stream from position 0 and re-executes
the agent function from the top. Each `RunContext` call (`step`, `emit`, `invoke`, `artifact`,
`waitFor`, `recall`, `state`) is keyed by a deterministic step id (`invoke:1`, `wait:approve`,
`state:cart`); if a recorded result exists, it is returned instead of redoing the work. **Rule for
agent authors: anything non-deterministic (clock, `Math.random()`, model output) must go through
one of those calls — never call it bare.** A `Component` declares an id, `requires`, `provides`
(capability contracts), and `activate`; mounting it produces a live **fiber** owning its effects,
unwound in reverse on unload. Eligibility (`isCompatible`: same capability id, compatible semver,
matching required attributes) is deterministic and separate from authorization (`Policy`,
default-deny, checked at invocation time) and from ranking (adaptive, can narrow the eligible set,
never widen it). Unfinished work is a durable `Continuation`, not an in-memory promise — human
approval is one specialization of it, not a separate mechanism. `correlationId` threads a whole
causal chain (AG-UI uses `agui-thread:<id>`, harness sessions use `session:<id>`); pass one
explicitly when an app-level concept (a thread, a ticket) should tie multiple runs together.
Source: `docs/mental-model.md`, `docs/concepts.md`.

## 2. Starting an app

CLI usage (`cognate create`, `cognate dev`, flags, distribution mode) is documented once, in
`cli.md` — read that before scaffolding anything. Do not duplicate its install steps here.

What matters for application code:

- A generated app has `cognate.config.ts` (`export default { profile: "copilot" | "harness",
  instructions?: string }`) and a `domain/*.sea` directory. `cognate dev` parses `domain/*.sea`
  through the DomainForge adapter (§13, `idm-to-cognate.md`) before serving anything.
- State persists at `.cognate/app.sqlite`. Routes: `GET /health`, Connect `RuntimeService` at
  `/cognate.v1.RuntimeService/*`, `POST /agui` (copilot only), `GET /` (Astryx chat shell for
  copilot, health JSON for harness). Source: the generated app itself and the installed
  `@godspeedai/cognate-cli` (`src/index.ts`).
- To compose a runtime by hand instead of through a profile, call `createRuntime(options)` from
  `@godspeedai/cognate-runtime-bun` directly — see §3's worked example and the [`@godspeedai/cognate`](https://www.npmjs.com/package/@godspeedai/cognate) umbrella package's README.

## 3. Defining agents: `AgentDefinition`, `RunContext`

```ts
// @godspeedai/cognate-runtime-api/src/types.ts
interface AgentDefinition {
  readonly id: string;        // the capability id, e.g. "agent.refund"
  readonly version: string;
  run(input: Json, context: RunContext): Promise<Json>;
}
```

`RunContext` members (`@godspeedai/cognate-runtime-api/src/types.ts`; replay behavior in
`docs/reference/runtime-service-and-agents.md`):

| Member | Records | Replay behavior |
|---|---|---|
| `runId`, `agent`, `tenant`, `scopeId`, `correlationId`, `actor` | — | constants |
| `signal` | — | aborted on cancellation; the only non-durable member |
| `step<T>(id, fn)` | `run.step.completed` under `step:<id>` | returns recorded result |
| `emit(eventType, payload)` | that event under `emit:<n>` | skipped on replay |
| `invoke(capability, input, { version? })` | `run.invocation` under `invoke:<n>` | returns recorded result, or throws `InvocationFailedError` |
| `artifact(input)` | `run.artifact` under `artifact:<n>` | returns recorded artifact id |
| `waitFor(id, spec)` | `run.waiting` → `run.resumed`/`run.wait.closed` under `wait:<id>` | returns resume input, or throws `ContinuationClosedError` |
| `recall(id, { text, k })` | `run.recall` under `recall:<id>` | returns recorded result |
| `state(id)` | `run.step.completed` under `state:<id>` | returns value read at that point |

`emit` rejects an `eventType` starting with `run.` (reserved for the runtime).

Minimal worked example (adapted from `docs/tutorials/run-your-first-agent.md`,
`examples/shared-state/index.ts`):

```ts
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import type { CapabilityContract, Component } from "@godspeedai/cognate-kernel-api";
import { createRuntime } from "@godspeedai/cognate-runtime-bun";
import { createClient } from "@godspeedai/cognate-client";
import { allowCapabilities } from "@godspeedai/cognate-kernel-api";

const contract: CapabilityContract = { id: "billing.quote", version: "1.0.0", attributes: { currency: "usd" } };
const billingQuote: Component = {
  id: "billing", version: "1.0.0", provides: [contract],
  activate(fiber) {
    fiber.provide(contract, async (input, ctx) => {
      const { amount } = input as { amount: number };
      if (amount <= 0) throw new Error("amount must be positive"); // -> InvocationFailure{kind:"failed"}
      return { total: Math.round(amount * 1.2), currency: "usd", by: ctx.actor.id };
    });
  },
};

const refundAgent: AgentDefinition = {
  id: "agent.refund", version: "1.0.0",
  async run(input, ctx) {
    await ctx.emit("message.delta", { text: "Looking into your refund…\n" });
    const amount = (input as { amount: number }).amount;
    const quote = (await ctx.invoke("billing.quote", { orderId: 7, amount })) as { total: number };
    const ticket = await ctx.step("ticket", () => `REF-${Math.floor(Math.random() * 1e6)}`); // non-determinism boxed
    return { ticket, total: quote.total };
  },
};

const runtime = await createRuntime({
  store: "./app.sqlite",
  policy: allowCapabilities("app", ["billing.quote"]),
  actions: { authorize: () => ({ allow: true, reason: "local" }) },
  agents: [refundAgent],
  components: [billingQuote],
});
const client = createClient({ service: runtime.service, caller: { actor: { id: "alice", kind: "user" }, tenant: "tenant-a" } });
const { runId } = await client.startRun("agent.refund", { amount: 100 });
```

Human approval and continuations (`docs/tutorials/human-in-the-loop.md`):

```ts
const decision = (await ctx.waitFor("approve", {
  type: "refund-approval",
  condition: { kind: "human_approval" },
  payload: { amount, account },
})) as { approved: boolean; by?: string };
```

Resolve from a client: `client.resolveContinuation(continuationId, "resume", { approved: true, by: "alice" })`
(mints its own idempotency key, returns the unwrapped `ContinuationView`); for the
`{outcome, continuation}` envelope or your own idempotency key/`expectedVersion`, call
`runtime.service.resolveContinuation(caller, { continuationId, action, input, idempotencyKey, expectedVersion? })`.

Artifacts from an agent: `const id = await ctx.artifact({ name, mediaType, bytes, readers?, representations? })`
(`ArtifactInput` in `@godspeedai/cognate-runtime-api/src/types.ts`); read with `client.artifact(id)`.

Child/multi-agent (durable subagent spawning, harness profile only —
`examples/multi-agent/index.ts`):

```ts
import { createHarness, LOCAL_OPERATOR, spawnSubagent } from "@godspeedai/cognate-profile-harness";
// inside a parent agent's run(input, ctx):
const childOutput = await spawnSubagent(ctx, "child-1", "agent.child", { n });
```

`spawnSubagent` durably resumes across restarts — it is not a bare async call.

## 4. Capabilities: the extension surface

There is one extension mechanism: publish a `CapabilityContract` from a `Component.activate`.
See `docs/how-to/add-a-capability.md` (full walkthrough with symptoms table) and
`docs/reference/capability-and-architecture-contracts.md` (types below).

```ts
// @godspeedai/cognate-kernel-api/src/types.ts
interface CapabilityContract { id: string; version: string; attributes?: Attributes; semanticRef?: SemanticRef }
interface Requirement       { capability: string; version?: string; attributes?: Attributes }
interface Component {
  id: string; version?: string;
  requires?: readonly Requirement[];
  provides?: readonly CapabilityContract[];
  activate(fiber: FiberContext): ...;   // fiber.provide(contract, handler) IS the publication
  retry?: { maxAttempts?: number; timeoutMs?: number; backoffMs?: number };
}
```

`isCompatible(requirement, contract)` (`@godspeedai/cognate-kernel-api/src/compat.ts`): same id; same major
version with minor/patch ≥ required; every required attribute equal.

Policies (`@godspeedai/cognate-kernel-api`, `@godspeedai/cognate-kernel-api/src/policy.ts`):

```ts
const denyAll: Policy;                                          // the default — no authority
function rulePolicy(policyId, rules): Policy;                    // first matching rule decides
function allowCapabilities(policyId, capabilities): Policy;      // tests/profiles
```

Two separate gates exist and both must be configured: `ctx.invoke` / `RuntimeService.invoke` go
through the kernel `Policy`; `run.start`, `run.cancel`, `continuation.resume`,
`continuation.cancel`, `run.state.update` go through the `ActionPolicy` passed to `createRuntime`.

Mount in a hand-composed runtime via `createRuntime({ components: [...] })`; in a profile, add a
`ComponentEntry` to its registry (`@godspeedai/cognate-profile`, §"Profiles" below).

Call it: `ctx.invoke(capability, input, { version? })` from an agent (recorded, replayable), or
`client.invoke(capability, input)` / `runtime.service.invoke(caller, { capability, input })` from
outside a run (not recorded as an event).

## 5. `RuntimeService` methods

`@godspeedai/cognate-runtime-api/src/types.ts` (contract), `@godspeedai/cognate-runtime-bun/src/service.ts` (reference
impl), full reference: `docs/reference/runtime-service-and-agents.md`.

| Method | Signature | Notes |
|---|---|---|
| `startRun` | `(caller, { agent, input, idempotencyKey, correlationId?, state? })` → `RunView` | one transaction: `run.started`, optional seeded `state.changed`, `runs` record, `run.execute` outbox intent |
| `getRun` | `(caller, { runId })` → `RunView` | `not_found` cross-tenant |
| `cancelRun` | `(caller, { runId, reason, idempotencyKey })` → `RunView` | aborts `ctx.signal`, cancels open continuations |
| `events` | `(caller, { afterPosition?, runId?, signal?, follow? })` → `AsyncIterable<StoredEvent>` | resume by position; no gaps/dupes |
| `listContinuations` | `(caller, { runId?, status? })` → `ContinuationView[]` | tenant-scoped |
| `resolveContinuation` | `(caller, { continuationId, action, input?, reason?, idempotencyKey, expectedVersion? })` → `{ outcome, continuation }` | `outcome`: `transitioned \| duplicate \| already_terminal` |
| `invoke` | `(caller, { capability, input, correlationId?, idempotencyKey?, deadline? })` → `Json` | no event recorded |
| `getArtifact` | `(caller, { artifactId, representation? })` → `{ id, name, mediaType, contentHash, bytes }` | denied/tombstoned/absent all → `not_found` |
| `readProjection` | `(caller, { name })` → `{ key, value }[]` | only `public` projections; tenant-prefix stripped |
| `listRuns` | `(caller, { correlationId?, agent? })` → `RunView[]` | served from the indexed `runs` collection |
| `updateState` | `(caller, { runId, update, idempotencyKey, expectedVersion? })` → `{ state, version }` | see §7 |

`Caller { actor: Principal; tenant: string }` is set by the transport authenticator — never read
from a request body. `ServiceError` codes: `not_found | permission_denied | invalid_argument |
failed_precondition | unavailable | deadline_exceeded | already_exists | unauthenticated |
resource_exhausted` (`@godspeedai/cognate-runtime-api/src/types.ts`).

`createRuntime(options)` (`@godspeedai/cognate-runtime-bun`, `@godspeedai/cognate-runtime-bun/src/index.ts`):
`store` (path | `":memory:"` | `{ store }`), `policy`, `actions: ActionPolicy`, `agents`,
`components`, `cognition?`, `projections?`, `outboxFor?`, `tickMs` (default 10), `system?`.

Conformance: `runtimeServiceConformance(name, factory, { persistent })` from
`@godspeedai/cognate-runtime-api/conformance`, plus fixtures `alice`, `mallory`, `bob`, `kitAgents(counters)`.
Any `RuntimeService` implementation (in-process, Connect remote) must pass it unchanged.

## 6. Capability selection: eligibility, ranking, UCB1

`@godspeedai/cognate-capabilities` (`@godspeedai/cognate-capabilities/src/index.ts`, `selector.ts`). Two phases —
eligibility never widened by ranking (`CG-CAP-002`, "adaptive containment"):

```ts
createSelector(options).select(request)   // runs every EligibilityRule against every Candidate first
compatibilityRule                          // the standard isCompatible-based rule
recordSelection(...) / recordOutcome(...)  // durable facts: capability.selected / capability.outcome
outcomeProjection()                        // per-(capability, provider) success/total counters
createOutcomeRanker(store)                 // UCB1: successRate + sqrt(2 ln N / n); untried first, ties by providerId
```

An entry that is unknown, ineligible, duplicated, or non-finite is dropped from ranking; a missing
or throwing ranker falls back to deterministic `providerId` order. `ModelProvider` (from
`@godspeedai/cognate-capabilities/src/model.ts`) is a capability contract like any other:
`modelContract(provider)` derives its `CapabilityContract`; features are boolean flags `generate`,
`stream`, `tool_use`, `structured_output`, `multimodal_input`, `context_limit`.

Hot-swap a provider live (`examples/capability-hot-swap/index.ts`): mount provider A, dispose it,
mount provider B — no agent or caller code changes, in-flight callers see the new provider on the
next invocation.

## 7. Shared state

Bidirectional: an agent writes state via `ctx.emit("state.changed", { snapshot })` or
`{ patch: [...] }` (RFC 6902); a caller writes it via `RuntimeService.updateState(caller, {
runId, update, idempotencyKey, expectedVersion? })`, which appends to the **separate**
`run-state-<id>` stream so a caller write cannot race the executor. `expectedVersion` is the count
of caller writes so far (not agent emits). `startRun(..., { state })` seeds a run's initial state.
A suspended agent observes a caller write on resume through `ctx.state(id)`. Client-side:
`client.updateState(runId, update, options?)`; React: `useSharedState(runId)`. See
`docs/workflows/shared-state.md`, `examples/shared-state/index.ts`.

## 8. Client (`@godspeedai/cognate-client`) and React

`@godspeedai/cognate-client` (`@godspeedai/cognate-client/src/index.ts`) is a headless client over any `RuntimeService`,
no React dependency:

```ts
createClient(options: ClientOptions): CognateClient
```

`CognateClient` surface: `run(runId)` → live `RunState` (`{ text, state, status, openContinuations,
artifacts, output, position }`, a fold over durable events — `message.delta`, `state.changed`,
etc.), `updateState`, `subscribe({ afterPosition })` (resumable, `status`:
`connecting|live|reconnecting|closed`), `provideCapability(name, handler)` (serves a frontend
capability by resolving an open `frontend_capability` continuation locally; returns an unregister
function — a reversible effect), `projection(name)`, `invoke`, `artifact`, `startRun`, `cancelRun`,
`resolveContinuation`, `close`.

`@godspeedai/cognate-react` (`@godspeedai/cognate-react/src/index.tsx`) wraps it via `useSyncExternalStore`:
`CognateProvider`, `useCognate`, `useRun`, `useAgent`, `useProjection`, `useCapability` (registers
a frontend capability for the component's lifetime, unregistered on unmount), `useSharedState`,
`useContinuations`, `useArtifact`, `useConnectionStatus`. No Astryx dependency.

`@godspeedai/cognate-ui-astryx` (`@godspeedai/cognate-ui-astryx/src/index.tsx`) is the reference renderer:
`CognateShell`, `ChatPanel`, `ApprovalCard`, `Approvals` (renders every open approval continuation
of a run), `ArtifactViewer`, `RunInspector`, `StateInspector`. Astryx types never cross into
`client`/`react` (`CG-UI-003`, enforced by an architecture test).

## 9. AG-UI, Connect, MCP, A2A

**AG-UI** (`@godspeedai/cognate-ag-ui`, `@godspeedai/cognate-ag-ui/src/index.ts`): `createProjector({ threadId, runId,
continuation? })` — stateful per-run projector, feed it `StoredEvent`s in order, get schema-valid
AG-UI events; `matrix` documents all 31 AG-UI event types and support level (never silent
reinterpretation). `createAgUiHandler(options: EndpointOptions)` is an HTTP handler: POST
`RunAgentInput` → SSE. Inbound actions go through `RuntimeService` with the authenticated caller —
same authorization path as native clients. `forwardedProps.cognate.cursor` resumes from a durable
position. `threadCorrelationId(threadId)` builds the `agui-thread:<id>` correlation id.

**Connect** (`@godspeedai/cognate-protocol-connect`, `-bun`): `registerRuntimeService(router, service, {
authenticate, maxJsonDepth })` (server routes; caller from headers only, never the body),
`createRemoteRuntimeService(transport, tokenFor)` (a `RuntimeService` over any Connect transport),
`errorCodes` (the `ServiceError` ↔ Connect code table). `-bun`: `serveRuntime(options)`,
`connectTransport(baseUrl, options?)`, `devTokenAuthenticator` (dev-only `Bearer
<tenant>:<user>`), `devToken(caller)`.

**MCP** (`@godspeedai/cognate-mcp`, `@godspeedai/cognate-mcp/src/index.ts`): `createMcpServer({ service, caller, tools
})` — one MCP tool per `McpToolBinding` (name defaults to the capability id, `.` → `_`), calls go
through `RuntimeService.invoke` as the connection's authenticated caller; a `ServiceError` becomes
`isError: true` with `<code>: <message>`.

**A2A** (`@godspeedai/cognate-a2a`, `@godspeedai/cognate-a2a/src/index.ts`): `createA2AHandler(options:
A2AAdapterOptions)` serves the agent card at `/.well-known/agent-card.json` and JSON-RPC at
`/a2a`. `message/send` starts (or, with a `taskId`, resumes) a durable run — the A2A task id
equals the Cognate run id; an open continuation surfaces as `TASK_STATE_INPUT_REQUIRED`.

## 10. Stores: memory vs sqlite

`@godspeedai/cognate-store-memory` and `@godspeedai/cognate-store-sqlite` both implement `DurableStore` with identical
semantics. `openSqliteStore({ path })` (`@godspeedai/cognate-store-sqlite/src/index.ts`); `path: ":memory:"`
for an ephemeral database. One writer process (DEBT-011 — do not run two processes against the
same file). Append-only triggers in the schema reject `UPDATE`/`DELETE` on `events` even via raw
SQL. Pass `store: "<path>" | ":memory:" | { store: yourDurableStore }` to `createRuntime`.

## 11. Projections

```ts
// @godspeedai/cognate-projections/src/types.ts
interface Projection { name: string; version: string; apply(event: StoredEvent, state: ProjectionState): readonly ProjectionWrite[] }
```

`apply` is pure — return writes, don't commit them; the `ProjectionRunner` commits them with the
checkpoint atomically, in `position` order. A version bump yields `rebuild_required`; `rebuild()`
replays from 0. Register with `createRuntime({ projections: [{ projection, public: true }] })` —
`public: true` makes it readable via `RuntimeService.readProjection` and `client.projection(name)`
/ React `useProjection(name)`; a public projection **must** key state `${event.tenant}/${key}`
(the service strips the tenant prefix). `null` as a write value deletes the key. Handle erasure
explicitly: return `{ key, value: null }` on `erasure.recorded` for any projection that copies
event content. See `docs/how-to/add-a-projection.md` for the full walkthrough and symptoms table.

## 12. Artifacts

`ArtifactService` (`@godspeedai/cognate-artifacts`, `@godspeedai/cognate-artifacts/src/index.ts`) writes content-addressed
bytes before the record and `artifact.created` event commit — never claims availability before
bytes exist. From an agent: `ctx.artifact({ name, mediaType, bytes, readers?, representations?,
metadata? })` (`ArtifactInput`). Read: `client.artifact(artifactId)` or
`RuntimeService.getArtifact(caller, { artifactId, representation? })` → bytes, or `not_found`
(deliberately indistinguishable for denied/tombstoned/absent), or `unavailable` (record present,
bytes gone). `ArtifactViewer` in `@godspeedai/cognate-ui-astryx` renders text/markdown as text, JSON as a
table, other media as a download link.

## 13. RealityTrace evidence (optional)

`@godspeedai/cognate-realitytrace` implements `ObservationPort.record(observation) → DeliveryReceipt`
(`accepted | duplicate`). **A receipt is not evidence and not settlement** — those are separate,
later SXR commands (`evidence create`, `settlement register`) outside this adapter's scope.
Framework execution never blocks on SXR by default (normal mode: outbox delivery,
at-least-once, backoff, then poison for operator reconciliation). Strict mode gates a specific
operation on `isRecorded(eventId)`. Correlation ids round-trip through `realitytrace ingest
--extensions <json>` and are read back with `readCorrelation(targetRef)`. Requires
`SXR_BIN` / `just setup-realitytrace`. See `docs/evidence.md`.

## 14. Testing

- In a Cognate checkout: `bun test` runs every workspace test; `bun test ./packages/<name>`
  scopes to one package (`docs/getting-started.md`). In a generated or consumer app: `bun test`
  runs the app's own suite the same way.
- The **conformance kit** pattern: a framework-owned interface (`RuntimeService`, `KernelFactory`,
  `CognitiveIndex`) ships a reusable test suite that every implementation must pass unchanged —
  `runtimeServiceConformance` (`@godspeedai/cognate-runtime-api/conformance`), `contractSuite` /
  `lifecycleSuite` / `effectsSuite` / `dependenciesSuite` / `scopesSuite` / `authoritySuite`
  (`@godspeedai/cognate-kernel-api/conformance`, plus `fixtures` from `harness.ts`: `system`, `alice`,
  `contract()`, `provider()`, `consumer()`, `until()`). This is how `CG-WIR-003` (transport
  replaceability) and the kernel engine boundary are proven — not by writing new tests per engine.
- Application tests: write against a hand-composed `createRuntime({ store: ":memory:", ... })`
  plus `createClient`, same shape as every example under `examples/*/index.ts` — each one is a
  runnable `bun run example:<name>` script asserting `ok: ...` on exit 0
  (`tests/examples.test.ts`, `CG-EXM-001`).
- `just verify` — the repo's own regression baseline (`check` + `typecheck` +
  `bun scripts/gate.ts --implemented`); relevant when contributing to Cognate itself, not
  required for an app built on it.

## 15. Pitfalls

- **Non-determinism inside an agent.** A bare `Date.now()`, `Math.random()`, or direct model call
  inside `AgentDefinition.run` breaks replay. Always go through `ctx.step`, `ctx.invoke`, or
  `ctx.recall`.
- **Idempotency keys are required, not optional, on `startRun`, `resolveContinuation`, and
  `updateState`.** The same key with a different fingerprint (different seed state, different
  patch) is `already_exists` / `IdempotencyMismatchError`, not silently merged.
- **`expectedVersion` on `updateState`** counts caller writes only — an agent's own `ctx.emit`
  does not advance it. A stale `expectedVersion` is `failed_precondition` naming the current
  version, not a silent overwrite.
- **`denyAll` is the default kernel `Policy`.** A newly mounted capability is unreachable until
  you explicitly grant it via `allowCapabilities` or `rulePolicy`. Separately, `run.start`,
  `run.cancel`, `continuation.resume/cancel`, `run.state.update` are gated by the `ActionPolicy`
  you pass to `createRuntime` — configuring the kernel `Policy` alone is not enough.
- **Resolution is not authorization.** `kernel.resolve` / eligibility only finds a compatible
  provider; it grants no authority. Every invocation is still checked against `Policy` at call
  time.
- **Tenancy is implicit and load-bearing.** `Caller.tenant` scopes `listRuns`, `readProjection`,
  `run-state-<id>` writes, and artifact access. A public projection that forgets to key
  `${tenant}/${key}` leaks across tenants (see `docs/how-to/add-a-projection.md`'s symptom table).
- **One writer process for SQLite** (DEBT-011) and **serial run execution** (DEBT-015, current
  runtime-bun limits) — do not assume horizontal scaling without checking current status in
  `.agents/CURRENT_STATUS.yaml` / `requirements/ledger.yaml`.

## Gaps

- No published `@godspeedai/*` npm packages yet (DEBT-016); every app is built from a local checkout
  — see `cli.md`.
- `docs/getting-started.md` and `docs/reference/commands-and-configuration.md` both describe
  `cognate create --source <path>`; do not add a second description of that flag here — `cli.md`
  owns it.
