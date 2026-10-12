# Why the cognitive layer exists

## The claim

The cognitive layer exists to make a change to the world an inspectable object: to know which world
you are reasoning about, what "correct" meant before you started, what actually happened, and what
has not been observed. It is explicitly a **local proof** of a framework idea, and the code says so
in more than one place.

## The gap it addresses

Without it, the system can do all of this: run an agent, gate its tools, record what happened, and
show a transcript. What it cannot do is answer:

- *Which version of the workspace is this reasoning about?*
- *What did "correct" mean before we started?*
- *What did the change actually do, as distinct from what the agent said it did?*
- *What have we not checked?*
- *Who decided this was good enough?*

A transcript answers none of them. The agent's own account of what it did is a *narrative*, and this
system treats narrative as distinct from reality throughout.

## The five moves, and the problem each solves

| Object | Problem it solves |
|---|---|
| **World manifest and `worldHash`** | "Which world?" A git SHA is not enough: policy, criterion, the semantic model, and uncommitted files all change what the agent is reasoning over. |
| **Frozen criterion** | "Correct, as decided in advance." Once frozen it is deep-frozen and hash-bound, so evidence cannot be reinterpreted afterwards. |
| **Forked candidate world** | "Try it somewhere that is not the thing I care about." The parent is never overwritten. |
| **Case projection** | "What do I currently know, and what is still open?" Derived from events, so it cannot drift. |
| **Settlement** | "Who decided this was good enough?" A human act, structurally enforced. |

## The design choices worth arguing about

### Identity excludes lineage

`worldHash` covers consequential state only. Origin case, origin run, parent, status and timestamps
ride on events and are excluded.

This is not a simplification; it is what makes settlement coherent. If lineage were in the hash, a
promoted candidate would have a *different* identity from the candidate, and "the settled world is
the head every candidate must descend from" would become a bookkeeping convention rather than a
computable fact.

### Observation is not authority

`risk.assess` observes and classifies. `world.settle` decides. The separation is enforced: Sentinel
compares against `next.trusted`, a re-run of the chain at or above its own tier against a shadow
core, so a lower-trust mediator cannot lower a trusted approval requirement.

### Affordance is not possibility

An operation is offered only when its preconditions hold, a capability and provider exist, the lease
permits it, and its observer or recovery is reachable. Otherwise it is blocked, and a blocked
affordance must name what blocks it and the move that would unblock it. This is the difference
between a UI that shows you your options and one that shows you every identifier in the database.

### Representation is governed

Surfaces come from a closed grammar, strictly validated, and rendered by a matching renderer. A
mediator returns data in a known shape or it is rejected. Representation cannot become an injection
channel, and adding a block type requires editing the union *and* the validator *and* the renderer —
three deliberate acts rather than one.

### The executor does not evaluate

A frozen criterion requires human authority to revise. Once frozen, verification runs against it and
records the criterion hash with the result. Evidence is bound to both the criterion and the candidate
it was observed under, so "this passed" carries its conditions.

## Why a whole subsystem, rather than a better transcript

Because these are five different kinds of question, and they need five different kinds of durable
object. A transcript can be rendered to look like any of them, which is precisely the problem: a
surface that *looks* like evidence but is narration is worse than no surface, because it invites
trust it has not earned.

The design refuses that. `Reality` is "derived only from durable events/results/lineage/receipts;
agent language cannot author it." A green observer never implies an unobserved settlement. Repeated
evidence is not write authority.

## What it costs

**Complexity.** This is a substantial subsystem — thirteen pure modules plus roughly twenty
capabilities — for a capability that may not survive in this form.

**Unbound capabilities.** The `case.*`, `world.*`, `criterion.*`, `verification.*`, `experiment.*`,
`method.*` and `ui.*` families are executable but not bound to the semantic model, because the `.sea`
file carries another tranche's uncommitted edits. Recorded as a gap in
[Known gaps](../known-gaps.md).

**A weak sandbox.** `world.fork` copies a directory. It is isolation from accident, not from an
adversary. The code states this rather than implying otherwise.

**No promotion.** Three candidates were identified for promotion into the framework — world identity
and lineage, around-mediation with a trusted subchain, and the closed Surface grammar — and each is
recorded with the deficit it would need to fill and the evidence that would justify promoting it.
None was promoted.

## How to read the "proof" label honestly

The label is doing real work. It means: this is implemented enough to demonstrate the idea and to
have tests that observe it, and it is not claiming to be a finished framework capability. Several
distinctions in the spec are covered by tests; several spec items are not implemented; the sandbox is
a copy. Anyone planning work here should read [Known gaps](../known-gaps.md) before planning.

## Confidence

The mechanisms and their rationale are **verified** from the code and its header comments.

The "what problem does it solve" framing is **strong inference** from the invariants the code
enforces, though it is consistent with the design source in `.agents/specs/`.

The comparisons to alternatives (a better transcript, richer transcripts) are **my analysis**. The
repository does not record them as rejected options.

## Source trail

- `.agents/specs/cybernetic-navigation-proof.md` — the design source; the thesis and the
  distinctions-that-must-hold list
- `src/cognitive/world.ts` — the manifest, the hash, the lineage fold, and why lineage is excluded
- `src/cognitive/case.ts` — `deriveCase`, `reality`
- `src/cognitive/criterion.ts` — `freezeCriterion`, observer coverage, `executor != evaluator`
- `src/cognitive/affordance.ts` — possibility vs affordance, `blockedBy`, payment-unknown
- `src/cognitive/mediation.ts`, `sentinel.ts` — tiers, trusted subchain, the declared invariants
- `src/cognitive/preflight.ts`, `liveverify.ts` — risk derivation and debounced verification
- `src/cognitive/surface.ts` — the closed grammar and strict validation
- `src/capabilities/cognitive.ts` — the capabilities and the human-only guards
- `src/ui/CognitiveFrame.tsx` — the renderer; `src/ui/webmcp.ts` — the attention projection
- `test/cognitive-semantics.test.ts`, `test/J-COG-*.test.ts`, `test/E2E-cognitive-console.test.ts`
- `.tmp/reconstruction/DEVIATIONS.md` — the cognitive-navigation proof section, including the three
  promotion candidates and their recorded deficits (recovered; see
  [Evolution and provenance](evolution-and-provenance.md))