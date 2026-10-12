# Spec — Cognate as cybernetic navigation substrate (harness proof)

Target: `validation/reconstructions/deepseek-harness/cognate` on `cognate/harness`.
This spec states what must become true. The route is in
[../plans/cybernetic-navigation-proof.md](../plans/cybernetic-navigation-proof.md) and may change;
this spec may not be reinterpreted to ease implementation (SPEC != PLAN; criterion != route).

## Thesis

Cognate makes intelligence replaceable by making the field around intelligence durable: meaning,
capability, authority, world identity, case state, candidate transformations, consequence, evidence,
settlement and developmental history live in Cognate, not in the model.

## Distinctions that must hold (each needs a test)

repoSha != worldHash · candidate != settled · execution != settlement · observation != authority ·
recommendation != decision · agent narrative != Reality · green observer != whole feature proven ·
settlementReachable != decision to settle · installed != visible != authorized != executed != settled ·
repeated evidence != write authority · executor != evaluator authority.

## Requirements

- **W1 World identity.** `worldHash = SHA-256(canonical, versioned serialization of the consequential
  manifest)`. Deterministic; volatile metadata excluded; Git SHA is one field, not the identity.
- **W2 Lineage.** baseline freeze, candidate freeze, settlement promotion are durable events in the
  existing Cognate event log; a read model is rebuildable; a candidate never overwrites its settled
  parent; promotion needs recorded evidence and human authority; a stale parent is detected.
- **W3 Fork seam.** Candidate execution runs in a disposable execution world forked from a settled
  world through `@cognate/execution`; sandbox lifetime is not truth; `sandboxId/parentWorldHash/
  candidateWorldHash/caseId/runId` are correlated durably. A provider that is absent is reported as
  absent (no claim of CubeSandbox support without a live provider).
- **C1 Criterion.** A frozen criterion has `criterionHash`; the executor cannot mutate it; a revision
  makes a new hash; rounds stay bound to the criterion they ran under; observer coverage
  (observed / unobserved) is explicit and a green result never implies unobserved settlement.
- **C2 Case.** A derived `CaseProjection` (no store of its own): desired outcome, baseWorldHash,
  candidateWorldHash, criterion, deviation, authority, evidence, unknowns, affordances, blocked
  affordances, settlement conditions, `settlementReachable`, optional remaining affordances.
- **A1 Affordances.** A pure resolver derives current/blocked affordances from visible, reachable,
  capability, authority, payment, recovery, observer conditions. Blocked ones carry `blockedBy` and
  the reachable move that unblocks. At most one primary; one successor shown; unknown payment stays
  unknown. Capability exposure to the agent is the smallest neighbourhood derived from Case+field and
  never hides recovery/diagnostic tools.
- **M1 Mediation.** A local MediationHost over existing capability invocation: tiers
  (governance > system > product > user > core), deterministic cross/same-tier order, nested unwind,
  `next`, `next.beneath`/trusted subchain without recursion, `origin`, `trace`, cleanup without leaks.
- **M2 Sentinel.** A governance mediator that observes, runs the trusted subchain, and intervenes only
  for declared invariants: lower tiers cannot weaken human approval; agents cannot synthesise approval;
  mediators cannot gain undeclared capability; protected evidence is immutable; irreversible actions
  cannot skip preflight/recovery. Findings become durable evidence.
- **S1 Surface.** Representation is a governed capability. Closed grammar: callout, entity, table,
  compare, timeline, preflight, ask. Malformed or arbitrary UI is rejected. Timeline is distinct from
  compare (ordered consequential history vs. A/B difference). Lifetime: appears while a distinction is
  live, recedes when settled; not durable truth.
- **R1 Reality.** Derived only from durable events/results/lineage/receipts; agent language cannot author it.
- **P1 RiskPreflight / L1 LiveVerify.** One real mediator each (preflight Surface + durable
  continuation + restart survival; debounced verification that is quiet when healthy and updates one
  representation when failing).
- **E1 Bounded search.** Offered only when the Case earns it (frozen criterion, isolated candidates,
  observer, budget, bounded scope). Rounds carry parent/candidate/criterion/method hashes, result and
  decision; failed candidates are discarded; best retained; settlement never automatic.
- **E2 Method review.** Outer observation yields evidence-bearing MethodRecommendations only; the
  active `methodHash` is unchanged until an explicit authorised decision; the observer cannot edit
  AGENTS.md, criterion, spec or active method.
- **U1 Frame.** Console right region shows DESTINATION, PRESENT, DEVIATION, NEXT MOVE, SETTLEMENT
  (+ AUTHORITY, RECOVERY conditionally); one dominant maneuver, alternatives visible; blocked ops
  explain why; candidate visibly distinct from settled; method recommendation visibly not active; no
  progress theater.

- **U2 Shared attention (WebMCP).** The live Console exposes a small semantic WebMCP surface
  (`ui.context/focus/inspect/compare/timeline/explain/invoke`, names revisable). The human's
  selection is an ephemeral `FocusContext` keyed by stable semantic refs (`case:`, `world:`,
  `candidate:`, `evidence:`, `affordance:`, `experiment:`, `tool-call:`), never CSS/DOM paths.
  `ui.context` returns only the focused neighbourhood (focused ref, case, meaning, world, related
  refs, available semantic actions); deictic utterances ("this", "why did this fail?") resolve from
  it; agent-requested focus/inspect/compare/timeline render existing Surfaces. Tools are exposed per
  focused Surface kind, not as a permanent catalog. Focus and inspection change no authoritative
  state; `ui.invoke` is not a mutation API: it routes through a Cognate capability, policy/lease,
  mediation/Sentinel and a continuation when human authority is required. Invariant: human
  attention becomes machine-readable context without becoming authority or truth.

## Out of scope (do not add)

DecisionState/personas; product Opportunity; workflow engine; `.sea` grammar changes; new
dependencies; gamification; autonomous method or criterion mutation.

## Done means

Every requirement has a deterministic test or an explicit, recorded unmet-gate entry in
`.agents/DEBT.md` / the plan's deviations; verification results are reported exactly.
