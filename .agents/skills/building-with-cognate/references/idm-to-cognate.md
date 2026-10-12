# From an Interaction Domain Model (`.sea`) to Cognate

Bridges a validated IDM in `.sea/interaction/` (see
`.agents/skills/deriving-interaction-domain-models/references/output-and-validation.md`) to real
Cognate constructs. Grounded in what `@godspeedai/cognate-domainforge` actually does — read the installed
package (its `src/` ships in the npm tarball) before trusting this table for anything it doesn't cover.

Source citations like `@godspeedai/cognate-runtime-api/src/types.ts` point into the *installed*
npm package (`node_modules/...`), not a Cognate checkout — the same files ship in every published
tarball ([ADR-0012](https://github.com/GodSpeedAI/Cognate/blob/main/docs/decisions/ADR-0012-cognate-package-naming.md)).

## What `@godspeedai/cognate-domainforge` actually does

`loadSemanticProjection(source, { uri })` (the installed `@godspeedai/cognate-domainforge` package, `src/index.ts`) calls
`Graph.parse(source)` from the pinned `@godspeedai/domainforge@0.19.0` binding — **not** a
DomainForge CLI subprocess; the adapter links the Rust/native binding directly. It walks
`graph.allEntities() / allResources() / allFlows() / allRoles() / allRelations() / allInstances()`
and produces a `SemanticProjection`: a flat list of read-only `SemanticObject`s (`{ ref, kind,
name, namespace, fields }`) plus `SemanticRelation`s (`flow.from`, `flow.to`, `flow.resource`,
`relation.subject`, `relation.object`, `relation.via`). Each object's `ref` is a `SemanticRef`
(`{ namespace, id, kind, source: { uri, digest }, projectionVersion }`) — the framework-owned,
opaque handle DomainForge concepts get before touching anything else in Cognate
(the installed `@godspeedai/cognate-kernel-api` (`src/types.ts`)).

The installed DomainForge 0.19.0 binding exposes every SEA-declared Graph collection to Cognate as
read-only objects: Policy, Metric, Dimension, Unit, Mapping, Projection,
Pattern, ConceptChange, and SEA `EntityInstance` (DEBT-003 closed 2026-09-26);
`Instance` remains the programmatic `ResourceInstance` collection and has no SEA declaration. `External` is only a
semantic-pack enum value, not a SEA grammar/AST/Graph declaration, so it remains unmapped.
Policy stays a referenced constraint, never a capability or permission.

`bindCapabilities(projection, bindings)` is the **only** path from a `SemanticObject` to a
`CapabilityContract`, and it is 100% explicit: pass `{ semanticId, capability: {id, version} }`
pairs by hand; nothing is inferred. An unbound semantic object produces nothing. This is
deliberate (spec §19, enforced by an architecture test): **no capability is ever created
implicitly from a semantic projection.**

`SemanticRegistry` (same file) archives projections by source digest and resolves a `SemanticRef`
back to its object; a rename mints a new identity, never silently reinterpreted — renames need an
explicit, reviewed `alias()`.

None of this reads `.sea/interaction/*.sea` automatically. An app's `domain/*.sea` is parsed the
same way at `cognate dev` startup (`docs/getting-started.md`); nothing distinguishes an
"interaction model" `.sea` file from any other — you point `domain/` at (or re-export from)
`.sea/interaction/interaction-model.sea` yourself.

## Mapping table

| IDM concept | Cognate construct | Where it lives | Status |
|---|---|---|---|
| Actor / role | `Role` → `SemanticObject{kind:"Role"}` | `@godspeedai/cognate-domainforge` (`graph.allRoles()`) | **enforced by `@godspeedai/cognate-domainforge`** |
| Actor / role, at invocation time | `Caller.actor: Principal`, `RunContext.actor` | the installed `@godspeedai/cognate-runtime-api` (`src/types.ts`) | convention (you map an IDM role to a `Principal.kind`/id scheme) |
| Intention / job | agent id (`AgentDefinition.id`), or a run's `correlationId` thread | the installed `@godspeedai/cognate-runtime-api` (`src/types.ts`) | convention |
| Affordance | `Requirement` (what a step may ask for) | the installed `@godspeedai/cognate-kernel-api` (`src/types.ts`) | convention |
| Canonical journey | one `AgentDefinition.run` plus a stable `correlationId` scheme across the runs that compose it | `@godspeedai/cognate-runtime-api` | convention |
| Journey step | `ctx.step(id, fn)` or `ctx.invoke(capability, input)` — one deterministic step id per journey step | `RunContext`, the installed `@godspeedai/cognate-runtime-api` (`src/types.ts`) | convention |
| Capability / action | `CapabilityContract` published by a `Component`, optionally carrying the step's `SemanticRef` via `bindCapabilities` | the installed `@godspeedai/cognate-kernel-api` (`src/types.ts`), `@godspeedai/cognate-domainforge/src/index.ts` | binding mechanism enforced by `@godspeedai/cognate-domainforge` (explicit only); the `Component` itself is hand-authored |
| State transition | an event type (`ctx.emit(type, payload)`, or `state.changed`) | `@godspeedai/cognate-events/src/types.ts` | convention |
| Artifact / resource | `Resource` → `SemanticObject{kind:"Resource"}` for the *modeled* resource; `ArtifactService`/`ctx.artifact()` for a *produced* file/receipt | `@godspeedai/cognate-domainforge` for the model; `@godspeedai/cognate-artifacts/src/index.ts` for the runtime artifact | modeled resource: **enforced by `@godspeedai/cognate-domainforge`**; produced artifact: convention (you decide which journey outputs become artifacts) |
| Policy / authority | DomainForge `Policy` declaration (unmapped — referenced constraint only, never executable) vs. Cognate `Policy` (`denyAll`/`rulePolicy`/`allowCapabilities`) | `.sea` source (unread by the adapter); `@godspeedai/cognate-kernel-api/src/policy.ts` | DomainForge side: **not mapped at all** (unsupported kind); Cognate side: convention, hand-authored to match the IDM's stated authority rules |
| Outcome / evidence | run `output`, plus an optional RealityTrace observation correlated by `SemanticRef` | `RunView.output`; `@godspeedai/cognate-realitytrace/src/index.ts` | convention; evidence delivery mechanics enforced by the realitytrace adapter once you wire it |
| Settlement | `CommitmentService` (`INTENT → PREPARE → COMMIT → OBSERVE`, `commitment.intended`/`.reconciled` events) | `@godspeedai/cognate-continuations/src/commitments.ts` | convention (you decide what counts as settlement) |
| Decision / next affordance | `ContinuationView` open on a run (`waitingOn`), resolved via `resolveContinuation` | the installed `@godspeedai/cognate-runtime-api` (`src/types.ts`), `@godspeedai/cognate-continuations` | convention |
| Material payment | an external commitment, `CommitmentRecord` (idempotency key, attempt count, `UNKNOWN_RECONCILIATION_REQUIRED`) | `@godspeedai/cognate-continuations/src/types.ts`, `commitments.ts` | convention |
| Failure / recovery | `InvocationFailure{kind:"failed"|"denied"|"unavailable"|...}`, `ContinuationClosedError`, `run.failed` | the installed `@godspeedai/cognate-kernel-api` (`src/types.ts`), the installed `@godspeedai/cognate-runtime-api` (`src/types.ts`) | convention, but the failure *shape* is enforced by the runtime type system |
| UI surface for an affordance/decision | `ApprovalCard`/`Approvals` (Astryx), or a client-served frontend capability | `@godspeedai/cognate-ui-astryx/src/index.tsx`, `@godspeedai/cognate-client.provideCapability` | convention |

**Read this table honestly, not optimistically.** The only row where DomainForge *enforces*
anything Cognate-side is the supported kinds becoming read-only `SemanticObject`s with a
`SemanticRef`, and the rule that `bindCapabilities` never runs on its own. Every other row is a
convention you establish and must keep consistent by hand — there is no compiler check that your
`agent.refund`'s steps correspond one-to-one to the IDM's canonical journey steps.

## Traceability rule

1. **Name capability ids after the IDM, not the other way round.** If the canonical journey
   catalog calls a step "approve refund," the capability id should be `refund.approve`
   (matching the pattern already used in this repo's own fixtures — see
   `docs/reference/capability-and-architecture-contracts.md`'s capability table), and the
   `CapabilityContract` should carry `semanticRef` from `bindCapabilities` pointing at the IDM
   object that names it.
2. **Every `NewEvent` for a journey step should carry the same `SemanticRef`** the capability
   contract carries, via the event's optional `semanticRef` field
   (`@godspeedai/cognate-events/src/types.ts`). This is how an event in the durable log can be traced back
   to the exact `.sea` object and source digest that justified it — not just a string that
   happens to match today.
3. **One test file per canonical journey**, named after the journey, asserting the event sequence
   and the final `RunView.output`/artifact/commitment state the IDM's catalog entry declares as
   its outcome and settlement criteria. Put it next to the app's other tests; there is no
   framework-provided journey-test harness (unlike the kernel/runtime conformance kits in
   `cognate-api.md` §14) — you write these by hand against `createRuntime` + `createClient`, the
   same shape as `examples/*/index.ts`.
4. **Verify settlement with evidence, not with a green test alone**, when the IDM's completion
   standard requires it: correlate the journey's `SemanticRef`/`eventId`/`runId` through
   `readCorrelation(targetRef)` (`docs/evidence.md`) if RealityTrace is wired in, or through the
   artifact/commitment record otherwise. A passing unit test proves the code path ran; it does
   not by itself prove the IDM's settlement condition was observed.
5. **Update the IDM's `source-translation-map.md` when a capability id, event type, or test name
   changes.** The map's job (per `output-and-validation.md`) is to make every source statement's
   disposition checkable; a renamed capability that is not re-linked there is exactly the kind of
   silent drift that skill's completion standard forbids.
6. **A rename in `.sea` mints a new `SemanticRef` identity** (different source digest). Do not
   quietly repoint an existing capability id's `semanticRef` at the new object — call
   `SemanticRegistry.alias(from, to, { reviewedBy, meaningCheck })` and update the traceability
   map, so old events keep resolving against the projection that was actually current when they
   were recorded.

## Worked example

`examples/domainforge/index.ts` is the smallest real instance of the whole chain, end to end:

```ts
import { bindCapabilities, loadSemanticProjection, mappingTable, serializeProjection } from "@godspeedai/domainforge";

const source = `
Entity "Warehouse" in logistics
Entity "Factory" in manufacturing
Resource "Cameras" units in equipment
Flow "Cameras" from "Warehouse" to "Factory" quantity 10
`.trim();

const { projection } = loadSemanticProjection(source, { uri: "example:///logistics.sea" });
// projection.objects includes { ref: { id: "logistics::Warehouse", kind: "Entity", ... } }

// No implicit capability. Bind exactly one, by hand, with provenance:
const [contract] = bindCapabilities(projection, [
  { semanticId: "logistics::Warehouse", capability: { id: "warehouse.read", version: "1.0.0" } },
]);
// contract.semanticRef.id === "logistics::Warehouse"  — the traceability link
```

Reading this as an IDM fragment: `Warehouse` is an actor/resource role in a canonical "camera
resupply" journey; the `Flow` is a journey step (a transfer); `warehouse.read` is the capability a
Cognate `Component` would publish (you still write that `Component` and its `activate` by hand —
`docs/how-to/add-a-capability.md`); an agent's `ctx.invoke("warehouse.read", ...)` step would carry
`contract.semanticRef` forward into `run.invocation`'s metadata, closing the trace from `.sea`
source line to durable event.

## Gaps

- `.sea` policies arrive only as read-only semantic objects; they are not evaluated or converted into kernel `Policy` rules, and no semantic object grants authority.
- There is no canonical `.sea/interaction/` → `domain/*.sea` wiring step in the CLI or the
  `domainforge` package; you decide how a generated app's `domain/` directory relates to the IDM's
  canonical location (copy, symlink, or re-export) and should record that decision in the app's
  own docs, not assume the skill or the adapter does it for you.
- No framework-level "journey test" or "settlement gate" tool exists in this repository; §"Traceability
  rule" above is a convention this skill recommends, not a proven `CG-*` requirement.
