# DeepSeek Harness — Interaction Domain Model (tranche T3)

Canonical location for the DeepSeek Harness Web UI Interaction Domain Model, produced per
`.agents/skills/deriving-interaction-domain-models/SKILL.md` and validated per
`.agents/skills/domainforge-sea/SKILL.md`.

## Files

- `interaction-model.sea` — the canonical `.sea` Interaction Domain Model.
- `source-translation-map.md` — traces every material source statement to a modeled concept.
- `canonical-journey-catalog.md` — canonical journey definitions. Existing Cognate journeys are
  preserved, with 12 proposed native Experts & Teams journeys appended.
- `assumptions-and-unknowns.md` — declared/observed/inferred/proposed/unknown classification of
  material conclusions, and unresolved questions.
- `handoff.md` — how a downstream agent should project this model into real Cognate constructs
  (`packages/domainforge`, `packages/kernel-api`, `packages/runtime-api`, `packages/continuations`)
  without repeating domain discovery.
- `validation/` — DomainForge CLI and Cognate-adapter validation records.

## Journey IDs (stable — name tests/capabilities after these)

`J-A-first-use`, `J-CFG-model-provider`, `J-WS-select`, `J-B-basic-session`,
`J-C-tool-execution`, `J-D-approval`, `J-E-plan`, `J-F-delegation`, `J-G-persistence`,
`J-H-cancellation`.

Remote Workspaces (execution worlds) add: `J-RW-select-world`, `J-RW-add-workspace`,
`J-RW-read-remote`, `J-RW-edit-remote`, `J-RW-exec-remote`, `J-RW-cancel-timeout`,
`J-RW-conn-failure`, `J-RW-reconnect`, `J-RW-coexist`, `J-RW-switch`.

`J-CFG-model-provider` and `J-WS-select` are evidence-driven additions beyond the spec's literal
A–H list: the reference documents each as a full, independently-reachable journey (own actor,
precondition, and settlement) rather than a step folded silently into `J-A-first-use`, so they are
canonicalized as their own journeys and `J-A-first-use` composes them (see
`canonical-journey-catalog.md`).

Experts & Teams add the proposed IDs `J-EXPERT-CREATE`, `J-EXPERT-SOLO`, `J-TEAM-CREATE`,
`J-TEAM-ACTIVATE`, `J-TEAM-REPLACE-ORCHESTRATOR`, `J-TEAM-DELEGATE`, `J-TEAM-HANDOFF`,
`J-TEAM-CONVERSE`, `J-TEAM-RECOVER`, `J-TEAM-REVIEW`, `J-EXPERT-MEMORY`, and
`J-TEAM-SETTLEMENT`. These are not implemented claims. The proposed bindings live in
`domain/index.ts`; implementation and journey evidence must be added before changing their status.

## Representation compromise

DomainForge `.sea` has no native "Journey"/"Affordance"/"Actor" primitive. Canonical journeys are
represented as `Instance ... of "CanonicalJourney"` records (string fields carry the narrative);
actors and system/domain objects are represented as `Entity`; one `Role`/`Relation` pair
illustrates the approval-authorization interaction. Flows carry `quantity 1`, meaning "one
occurrence of this canonical transformation" — not a measured count. This is documented, not
silent (see `interaction-model.sea` header comment and `assumptions-and-unknowns.md`).

## Final canonicality conclusion

> The existing Workbench interaction model remains the canonical semantic source. The Experts
> and Teams extension is modeled with explicit proposed journeys and bindings, but is not yet
> canonical as implemented behavior until its capabilities, tests, and evidence are complete.
