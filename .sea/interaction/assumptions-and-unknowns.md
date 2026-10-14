# Assumptions, Unknowns, and Contradictions

## Native Experts & Teams observations (2026-10-13)

- **Observed:** Cognate 0.2.0 stores durable waits but does not automatically evaluate child-run
  completion conditions. The explicit native completion bridge is tested through process kill and restart.
- **Observed:** SDK dispatch is serialized. Teams expose bounded serialized collaboration, not parallel workers.
- **Observed:** Atomic native shared-thread writes plus command receipts preserve membership and return invariants.
- **Observed:** Side-effect invocation alone is not crash-atomic. Native commitments now prevent
  ambiguous Expert effects from being repeated, and reserve reconciliation for the human.
- **Observed:** Per-Expert model routes work through the installed adapters without global provider swapping.
- **Observed:** Public projections redact private contexts; authorized scoped reads and bounded
  provenance-backed memory preserve the distinctions in the canonical model.
- **Deferred:** Autonomous schedules, vector search and multi-process effect dispatch; the one-process
  deployment remains the supported boundary. See `docs/known-gaps.md`.
- **Resolved authority:** Existing Cognate SDK transitive Cordis dependency predates this work. The
  operator explicitly approved retaining it while Workbench adds no direct Cordis or donor integration.
- **Security limitation:** Development authentication and command guards remain unsuitable for hostile multi-user isolation.

## Representation decisions (proposed, evidence class: proposed)

0. **Remote Workspaces are modeled as framework-level journeys (`J-RW-*`) in this IDM.** The
   execution-world abstraction belongs to Cognate, not to the DeepSeek Harness product; it is
   recorded here because this reconstruction is where the workspace journeys live and because the
   reconstruction's `domain/` is the only place that loads this `.sea` source. SSH is one *kind* of
   `ExecutionWorld`, never a domain primitive — no `ssh_*` tool, entity, or capability appears in
   the model. Evidence class: proposed (derived from Cognate's architecture and the donor mechanism
   study, not from an observation of the reference product). What would overturn it: if Cognate
   grows its own canonical `.sea` IDM, these journeys should move there and this file should
   reference rather than own them.

1. **`J-CFG-model-provider` and `J-WS-select` are separate canonical journeys**, not steps folded
   silently into `J-A-first-use`.
   - Competing interpretations: (a) fold both into `J-A-first-use` since the spec's Journey A text
     lists them as sub-steps; (b) canonicalize them separately because the reference documents each
     with its own actor, precondition, and settlement, reachable outside the first-use flow (e.g.
     changing providers later, adding a second workspace).
   - Evidence for (b): `docs/user/guide/providers.md` and `docs/subsystems/workspace.md` describe
     both as standalone, independently-reachable flows; `J-A-first-use`'s own catalog entry
     explicitly "delegates to" them rather than repeating their steps.
   - Selected: (b). Evidence class: proposed (a defensible canonicalization choice, not a directly
     quoted requirement).
   - What would overturn it: if the reconstruction's test suite is required to name tests strictly
     A–H with no additional journey ids, these two would need to be re-merged into `J-A-first-use`
     as internal steps rather than dropped.

2. **Goals are not given a separate canonical journey.** Goals (`GoalPhase`, `get_goal`/
   `update_goal`) are documented as a P1 feature with their own subsystem doc, but the evidence
   does not show a materially different settlement loop from `J-E-plan`'s "multi-step task"
   framing at the level of detail available. Modeled only as `Entity "Goal"` for future extension.
   Evidence class: proposed. What would overturn it: if goal phases (`active/paused/blocked/
   complete`) are found to have their own approval/settlement semantics distinct from plan mode
   when the app is actually run.

3. **Flow `quantity 1` is a structural placeholder**, not a measured cardinality. DomainForge
   requires a `quantity` on every `Flow`; there is no real "how many times this journey occurs"
   count to report at the IDM level. Documented as a compromise in `interaction-model.sea`'s header
   comment. Evidence class: declared (this is a `.sea` grammar constraint, not a domain fact).

4. **Domain grouping (`in <domain>`) was omitted from every Entity/Resource** to keep all
   declarations in one default namespace and avoid `Instance`/namespace mismatches (per
   `write-in-sea.md`'s troubleshooting note: an instance can't reference an entity declared `in`
   a different domain than the file's `@namespace`). This is a simplification, not a claim that
   the underlying subsystems (workspace/session/models/tools/approval/plan/goal/subagent) aren't
   materially distinct — that distinction is preserved in the journey catalog's actor/capability
   fields instead. Evidence class: proposed.

## Unresolved semantic questions carried from product-characterization.md §13

All twelve items in product-characterization.md §13 remain genuinely unresolved (the observation
document itself flags them as needing a Playwright run against the live app, which was out of
scope for this tranche). They are not re-litigated here; see that file directly. The ones most
load-bearing for this IDM:

- #3 (approval pending-request persistence across reload) — affects whether `J-D-approval`'s
  `'unavailable'` fail-closed outcome is the *only* cross-reload behavior, or whether some form of
  re-askable state also exists.
- #5 (subagent terminal-result presentation) — affects whether `J-F-delegation`'s settlement
  criterion needs a UI-visible "child result rendered" check beyond the durable catalog record.
- #11 (session status vocabulary) — affects the exact state labels `J-B-basic-session` and
  `J-H-cancellation` should assert against in tests.
- #12 (approval decision set — Allow once only vs. a broader permission-presets control) — affects
  whether `J-D-approval` needs a third settlement branch beyond approve/deny.

## Contradictions

None found. The two evidence sources (product-characterization.md, runtime-and-provider.md) and
the spec's Phase 6 journeys are consistent with each other everywhere they overlap (e.g. both
describe the approval waterfall, tool observation policy, and mock-server error injection the same
way). No claim in one source was found to directly contradict a claim in another.

## Experts and Teams extension (proposed, 2026-10-13)

- The 12 `J-EXPERT-*` / `J-TEAM-*` journeys and their added entities/resources/roles are proposed
  semantics from the Workbench mission, not observed working behavior. Keep their evidence class
  `proposed` until runtime capabilities, UI paths and journey tests supply evidence.
- An active Team has exactly one active Orchestrator; a draft may have none. Mutation must enforce
  the invariant atomically. Replacement must be one compare-and-swap state transition.
- Proposed persistence uses Cognate shared thread state with CAS updates and run-completion
  continuations for Specialist returns. The event log remains durable truth; this model does not
  authorize a second event store, scheduler or agent runtime.
- Initial dispatch is proposed as serialized. Parallel execution remains unknown until concurrency
  and isolation are tested against the installed runtime.
- `expert.model.generate` expresses per-Expert route selection. Each run must capture immutable
  route/config so later edits cannot hot-swap an active run.
- `team.settle` presents a decision surface; it does not grant the Team or Orchestrator power to
  accept protected work. `team.review` can recommend, not settle.
- Memory provenance, epistemic classification, prompt-injection handling and cross-scope access
  checks are requirements whose enforcement remains unverified.

## Grammar/tooling limitations encountered (not IDM semantics)

- DomainForge 0.18.1's `fmt` command still rewrites `forall`-quantifier `Policy` bodies into an
  invalid `ForAll(...)` call form that the same binary's parser then rejects, and also drops this
  file's `//` comments outright when it reformats. Reproduced independently on the repository's
  own `packages/domainforge/test/fixtures/all-kinds.sea` fixture and on a minimal one-policy
  fixture (not specific to this file). This is an upstream DomainForge formatter defect that the
  `0.16.0` → `0.18.1` upgrade does not address — DomainForge's ADR-016 covers units/mapping
  round-trip fidelity in `fmt`, not quantifier round-trip or comment preservation. Worked around
  by not running `fmt --out` on this file (reproductions used throwaway copies under `.tmp/`);
  `forall`/`count` syntax as written validates and parses correctly. See
  `validation/limitations.md`.
- RESOLVED in 0.18.1: `parse --format human` on the previously installed CLI build (0.16.0) did
  not print the "Entity instances:"/"Resource instances:" split lines that `write-in-sea.md`
  describes; it printed `Instances: 0` and omitted a `Policies:`/`Metrics:` count line in the
  human-readable summary even though the JSON graph and validator both correctly reported 10
  `entity_instances`, 1 `policies`, and 1 `metrics`. After upgrading the CLI to 0.18.1, `parse
  --format human` now prints `Entity instances: 10` and `Policies: 1` directly, matching
  `parse --format json` and the live `@cognate/domainforge` adapter
  (`packages/domainforge/src/index.ts`, pinned to `@godspeedai/domainforge@0.18.1`). See
  `validation/domainforge-output.txt`.
