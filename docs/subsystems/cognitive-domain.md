# Subsystem: cognitive navigation

## Purpose

Make a change to the world a first-class, inspectable object: identify what should differ, freeze
what counts as correct, run the correction somewhere disposable, observe the result, and settle it
only with recorded evidence and a human decision.

This is a local proof of a framework idea, and the code says so. See
[Why the cognitive layer exists](../explanation/why-cognitive-layer.md).

## Responsibilities

- World identity: hash a consequential manifest, so "the same world" is computable.
- Lineage: record baseline freeze, candidate freeze, settlement, and rejection as durable events.
- Case projection: derive desired outcome, base and candidate hashes, criterion, deviation,
  authority, evidence, unknowns, affordances, blocked affordances and settlement conditions.
- Affordance resolution: separate what is *possible* from what is *currently available*.
- Mediation: run interceptors in trust tiers around a capability invocation.
- Representation: return structured Surfaces from a closed grammar rather than markup.

## Non-responsibilities

It does not own the execution world's lifetime. Fork directories are disposable and lineage is the
truth. It does not write to the workspace directly — every read or exec goes through the execution
world's capabilities. It does not accept its own recommendations.

## Position in the system

```
src/cognitive/*  (pure: hashes, folds, mediation, grammar)
   ▲                            ▲
   │ invokes                    │ returns Surfaces
src/capabilities/cognitive.ts ───▶ src/ui/CognitiveFrame.tsx
   │                    │
   │ emits cognitive   │ mediated
   ▼                    ▼
 event log      Sentinel / RiskPreflight / LiveVerify
```

## Core abstractions

### World manifest

Only consequential state is hashed: workspace file digests, repo SHA, semantic-model / policy /
environment hashes, criterion hash, method hash. Lineage metadata — origin case, origin run, parent,
status, timestamps — rides on events and is deliberately excluded, so a candidate promoted to settled
keeps the same `worldHash`.

`repoSha` is a field of the manifest. It is not the identity. The `.agents/specs/` source makes the
distinction explicit: `repoSha != worldHash`.

### Case

`deriveCase(events)` returns a `CaseProjection` with no store of its own. It is recomputed from the
event log on demand.

### Criterion

`freezeCriterion` produces a deep-frozen `FrozenCriterion` bound to its hash. A revision is a new
criterion with a new hash and requires human authority. Observer coverage is part of the criterion,
so a green run states what it actually proved.

### Affordance

`resolveAffordances(possible, facts)` returns `Affordance[]` (with `whyNow`, `authorityRequired`,
and at most one `successor`) and `BlockedAffordance[]` (with `blockedBy` and the move that would
unblock). Payment is supplied only when evidence supports it; omitted means unknown, never zero.

### Mediation

```ts
interface MediatorSpec { tier: "governance" | "system" | "product" | "user" | "core"; ... }
```

`createMediationHost()` runs the chain in tier order, supports `next`, `next.beneath` (a trusted
subchain without recursion), `origin`, and a trace, and unwinds nested chains without leaks.

**Sentinel** is the governance mediator: it observes, lets the lower chain run, inspects the result
and the trace, and intervenes only for declared invariants. Lower tiers cannot weaken human approval;
agents cannot synthesise approval; mediators cannot gain undeclared capability; protected evidence is
immutable; irreversible actions cannot skip preflight and recovery. Findings become durable events.

**RiskPreflight** derives impact for a consequential shell operation (target, impact facts,
recovery, authority) and composes a `preflight` Surface. Its "core" is a pure destructive-command
classification with no side effects, which is what lets Sentinel compare against
`next.trusted`.

**LiveVerify** is a long-lived mediator that watches consequential results, debounces, and runs the
affected observer. Healthy transitions are silent; only a verdict change surfaces, and it updates one
representation rather than appending messages.

### Surface

`validateSurface` is strict: unknown block types, unknown keys and non-string leaves are rejected.
Block types: `callout`, `entity`, `table`, `compare`, `timeline`, `preflight`, `ask`. `timeline` and
`compare` are deliberately distinct — ordered consequential history versus A/B difference.

Lifetimes: `while-condition`, `until-settled`, `session`, `persistent-if-human-pinned`.

## State

Durable: cognitive events only. The `cognitive` projection is a change *signal*; the Case itself is
always derived.

Reconstructible after restart: the Case, Reality, the affordance field, lineage, search state, the
active `methodHash`.

Ephemeral and explicitly not truth: `FocusContext`, requested Surfaces held in memory, view state,
hover and animation state.

Disposable: fork directories.

## Lifecycle

```
case.open ──▶ criterion.freeze ──▶ world.freeze (baseline)
                                        │
                                        ▼
                            world.fork ──▶ (work in the fork)
                                        │
                                        ▼
                              world.freeze (candidate)
                                        │
                                        ▼
                                 verification.run
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                   pass → world.settle          fail → experiment.round
                        (human only)                  (bounded, frozen criterion)
```

`world.settle` and `method.accept` throw if `ctx.runId` is set and require a `user` actor. Settlement
additionally needs reachable mandatory conditions, a current parent, and recorded evidence.

## Failure modes

| Symptom | Cause | Where |
|---|---|---|
| `verification.run: no frozen criterion for this case` | Criterion not frozen, or the wrong case | `capabilities/cognitive.ts` |
| `verification.run: <id> is not in the frozen criterion` | Check invented after freezing | `criterion.ts` |
| `method.accept: promotion is a human act and cannot be invoked from a run` | A run tried to accept | intended |
| `world.fork` provider gone after restart | The in-memory fork registry does not survive | `world.attach` re-registers an existing directory |
| A Surface renders as "Representation rejected" | The data violated the closed grammar | `surface.ts`, `CognitiveFrame.tsx` |
| Risk assessment never asks for authority | The command is outside the classified families | `preflight.ts`; unknown is not the same as safe |

## Extension points

Add a Surface block by extending the union and `validateSurface` together, then adding a renderer
branch in `CognitiveFrame.tsx`. Both halves must move together: an unrenderable or an unvalidatable
block is a defect.

Add a mediation tier by registering a `MediatorSpec`. Adding below `governance` cannot raise
authority; adding above changes what Sentinel can guarantee, so treat it as a framework-level change.

Add a cognitive concept as: pure module → event constant → fold → capability → (if representative)
Surface.

## Source trail

- `src/cognitive/world.ts` — `WorldManifest`, `worldManifest`, `worldHash`, `foldLineage`,
  `checkPromotion`, `WORLD_EVENTS`, `Lineage`, `WorldRecord`
- `src/cognitive/case.ts` — `CASE_EVENTS`, `deriveCase`, `reality`, `CaseProjection`
- `src/cognitive/criterion.ts` — `CriterionSpec`, `freezeCriterion`, `FrozenCriterion`
- `src/cognitive/affordance.ts` — `PossibleOperation`, `Facts`, `Affordance`, `BlockedAffordance`
- `src/cognitive/mediation.ts` — `MediatorSpec`, `createMediationHost`, `Outcome`, `EffectsLike`
- `src/cognitive/sentinel.ts` — `sentinel`, `Finding`, `SentinelConfig`
- `src/cognitive/preflight.ts` — `classifyDestructive`, `composePreflight`, `Impact`
- `src/cognitive/liveverify.ts` — the debounced observer
- `src/cognitive/surface.ts` — `validateSurface`, `Surface`, `Block`, `Intent`, `Lifetime`
- `src/cognitive/experiment.ts`, `method.ts`, `focus.ts`, `canonical.ts`
- `src/capabilities/cognitive.ts` — every `cognitiveComponent` handler
- `src/ui/CognitiveFrame.tsx` — `SurfaceView`, `BlockView`
- `test/cognitive-semantics.test.ts`, `test/cognitive-focus.test.ts`,
  `test/J-COG-*.test.ts` (6), `test/E2E-cognitive-console.test.ts`
- `.agents/specs/cybernetic-navigation-proof.md` — the design source