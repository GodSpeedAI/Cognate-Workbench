# Concept: cognitive navigation

The cognitive layer answers one question: *how do I know this change is right, and how do I prove
it?* Everything else in this repository answers a smaller version of it.

This page explains the concepts. For the design rationale, read
[Why the cognitive layer exists](../explanation/why-cognitive-layer.md). For the mechanism, read the
[subsystem page](../subsystems/cognitive-domain.md).

## The problem it solves

An agent can change a workspace. That is the easy part. The hard parts are:

- knowing which version of the world you are reasoning about,
- knowing what "correct" meant *before* you started,
- running a speculative change somewhere that is not the thing you care about,
- observing the result without the observation being something the agent authored,
- and promoting the change only when a person says so.

A chat transcript answers none of these. The cognitive layer gives each one a durable object.

## The five objects

### World manifest and worldHash

A manifest of consequential state: workspace file digests, repo SHA, semantic-model / policy /
environment hashes, criterion hash, method hash. `worldHash` is its SHA-256.

The manifest deliberately **excludes** lineage metadata — origin case, origin run, parent, status,
timestamps. Those ride on events. The reason is exact: a candidate promoted to settled keeps the same
`worldHash`, so identity is stable across settlement.

Two distinctions the code insists on:

- `repoSha != worldHash`. A commit is one field of the manifest, not the identity.
- A git commit does not capture what the agent is actually reasoning over — policy, criterion, the
  semantic model, uncommitted files all matter. The manifest does.

### Case

The derived state of one unit of intended change. `deriveCase` folds events into a `CaseProjection`:

desired outcome · base world hash · candidate world hash · criterion · deviation · authority ·
evidence · unknowns · affordances · blocked affordances · settlement conditions ·
`settlementReachable` · remaining affordances.

A Case has **no store of its own**. It is recomputed on demand. That is why a restart cannot
desynchronise it from reality.

### Criterion

A frozen evaluation definition: required check ids, consequences, observer coverage. `freezeCriterion`
deep-freezes it and binds it to a hash. A revision is a new criterion with a new hash, and requires
human authority.

This encodes `executor != evaluator authority`: the thing being evaluated does not get to define the
evaluation, and once defined the evaluation does not move.

### Candidate world

A disposable execution world forked from the settled world, plus the change being trialled in it.
`world.fork` copies the directory and registers it as its own world id. A candidate never overwrites
its settled parent. A stale parent is detected.

Fork directories are disposable and may vanish; the lineage events are the truth.

### Settlement

Human promotion of a candidate to the settled world. `world.settle` requires: a human actor, no
enclosing run, reachable mandatory conditions, a current parent, and recorded evidence. It throws
otherwise.

## Affordances

`affordance.ts` draws a line that most agent tooling blurs: **possibility is not affordance.**

An operation is currently available only if its preconditions hold, a capability and provider exist,
the lease permits it, and the observer or recovery it needs is reachable. Otherwise it is a *blocked*
affordance, which must say what blocks it (`blockedBy`) and name the move that would unblock it.

Each available affordance carries `whyNow`, whether it needs human `authorityRequired`, and at most
one `successor` — the single operation that becomes reachable if it succeeds. Payment is supplied
only when evidence supports it; omitted means unknown, never zero.

## Mediation

A capability invocation passes through an ordered chain of interceptors, tiered
`governance > system > product > user > core`. `createMediationHost()` supports `next`, a trusted
subchain via `next.beneath` (no recursion), `origin`, and a trace, and unwinds nested chains cleanly.

**Sentinel** sits in the governance tier. It observes, lets the lower chain run, inspects the result
and the trace, and intervenes only for its declared invariants. It cannot be outvoted from below,
because it compares against `next.trusted` — the chain re-run at or above its own tier against a
shadow core with no side effects.

**RiskPreflight** derives impact for a consequential shell operation and composes a `preflight`
Surface. **LiveVerify** is a long-lived mediator that debounces verification of consequential
results: healthy transitions are silent, and a verdict change updates one representation rather than
appending another message.

## Representation as a governed capability

`surface.ts` defines a closed grammar — `callout`, `entity`, `table`, `compare`, `timeline`,
`preflight`, `ask`. `validateSurface` is strict: unknown block types, unknown keys and non-string
leaves are rejected.

The point is that a mediator or component returns *data in a known grammar*, never markup. A
malformed or arbitrary payload is rejected rather than rendered. Representation cannot become an
injection channel, and adding a block type is a deliberate act on both the union and the validator.

`timeline` and `compare` are distinct on purpose: ordered consequential history versus A/B difference.
Lifetimes are `while-condition`, `until-settled`, `session`, `persistent-if-human-pinned` — a
representation appears while a distinction is live and recedes when settled. It is not durable truth.

## Shared attention and WebMCP

`FocusContext` describes what the human is looking at. It is ephemeral and **never confers
authority**: `focus.ts`'s comment is explicit that focus never confers authority, and `planInvoke`
only *describes* the capability a consequential follow-up must travel through.

`src/ui/webmcp.ts` projects this into a small focus-dependent tool set for a browsing agent. Every
tool is a thin call into the same server capabilities the human's clicks use. None reads the DOM.
Mutating actions are proposed to the human; the agent never executes them.

Capability exposure to the agent is the smallest neighbourhood derived from the Case and the focused
field, and it never hides recovery or diagnostic tools.

## The distinctions that must hold

From `.agents/specs/cybernetic-navigation-proof.md`, each of which needs a test to be believed:

```
repoSha != worldHash · candidate != settled · execution != settlement
observation != authority · recommendation != decision · agent narrative != Reality
green observer != whole feature proven · settlementReachable != decision to settle
installed != visible != authorized != executed != settled
repeated evidence != write authority · executor != evaluator authority
```

## What this layer is not

It is a **local proof**, explicitly labelled as one in the code. Several capabilities are unbound to
the semantic model, several spec items are unimplemented, and the fork provider is a directory copy
rather than a hardened sandbox. Three candidates were identified for promotion into the framework
and none was promoted. See [Known gaps](../known-gaps.md).

## Source trail

- `.agents/specs/cybernetic-navigation-proof.md` — the design source and the distinctions list
- `src/cognitive/world.ts` — `WorldManifest`, `worldHash`, `foldLineage`, `checkPromotion`
- `src/cognitive/case.ts` — `CASE_EVENTS`, `deriveCase`, `reality`, `CaseProjection`
- `src/cognitive/criterion.ts` — `freezeCriterion`, `FrozenCriterion`
- `src/cognitive/affordance.ts` — the resolver and its blocked form
- `src/cognitive/mediation.ts`, `sentinel.ts`, `preflight.ts`, `liveverify.ts`
- `src/cognitive/surface.ts` — the closed grammar and `validateSurface`
- `src/cognitive/experiment.ts`, `method.ts`, `focus.ts`, `canonical.ts`
- `src/capabilities/cognitive.ts` — the capabilities, including the human-only guards
- `src/ui/CognitiveFrame.tsx`, `src/ui/webmcp.ts` — the renderers
- `test/cognitive-semantics.test.ts`, `test/cognitive-focus.test.ts`, `test/J-COG-*.test.ts`,
  `test/E2E-cognitive-console.test.ts`