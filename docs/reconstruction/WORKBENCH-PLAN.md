# Workbench tranche plan — Unified Harness Experience Model v2

Source: `.agents/plans/unified_harness_experience_model_v2.md` (read-only input). Method:
`.agents/skills/building-with-cognate/SKILL.md`. Scope: this app only (`validation/reconstructions/deepseek-harness/cognate`).
Framework gaps are reported in `WORKBENCH-DEVIATIONS.md`, never worked around silently.

## Reuse (no donor becomes a dependency)

| Need | Reused from Cognate | Ported pattern (donor, re-implemented) |
|---|---|---|
| Capability → implementation → executor | `@cognate/capabilities` (`compatibilityRule`, `isCompatible`) for eligibility | — |
| Review/approval | durable continuations (`ctx.waitFor`) — human-only decisions | — |
| Evidence receipts | `@cognate/realitytrace` observation port already wired (`observation.record`) | — |
| Dependency scheduler | — | `needs` (must pass) / `after` (must settle) from donor `scripts/run-gates.ts` |
| Steering | Cognate shared state (`updateState` / `ctx.state`) | donor agent inbox `nextTurn` / `nextStep` |
| Automation lifecycle | — | donor schedule lifecycle (dispatched ≠ completed) |

Cognate has no workflow engine, scheduler or budget enforcement (confirmed by recon): those are app code here.

## Architecture

- `src/workbench/*.ts` — pure, deterministic domain modules (no I/O). Unit-tested.
- `src/workbench/reducer.ts` — folds `workbench.*` events into one state.
- `src/projections/workbench.ts` — public projection `workbench`.
- `src/capabilities/workbench.ts` — capabilities; each validates with the pure modules then starts an
  `agent.config` run (`kind: "workbench.recorded"`) that emits the event. Human-only decisions (`task.review.decide`) need the operator principal.
- Enforcement: protected evidence is enforced in `tool.edit` / `tool.bash` (structural, not prompt prose).
- UI: Cockpit surfaces inside the existing shell, extending `DESIGN.md` (no competing system).

## Tranches (vertical slices; each ends with a journey test named after its journey id)

| # | Tranche | Journeys / traces |
|---|---|---|
| WB-0 | IDM extension + bindings + plan | model validates; catalog entries |
| WB-1 | Task Contract, invariants, authority plane, protected evidence | J-WB-task-contract (V-001), J-WB-protected-evidence (V-003) |
| WB-2 | Workflow graph; Skill OS (contract/implementation/executor, substitution, lifecycle, conflicts) | J-WB-workflow (V-002), J-WB-capability-lifecycle (V-011) |
| WB-3 | Evidence ledger, review gate, worker return contract, done taxonomy, automation outcome | J-WB-review-gate (V-008, V-009), J-WB-automation (V-012) |
| WB-4 | Parallelism plan, economics, role routing | J-WB-parallelism (V-006, V-007), J-WB-economics (V-013) |
| WB-5 | Steering (queue/steer/stop), grounded feedback, context-preserving focus | J-WB-steering (V-004), J-WB-grounded-feedback (V-005, V-010) |
| WB-6 | Cockpit UX + browser E2E (Playwright) | E2E-workbench |

Honest gates: a trace is "met" only with an observed passing test. Anything not built is recorded in
`WORKBENCH-DEVIATIONS.md` as unmet.
