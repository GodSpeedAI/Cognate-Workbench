# Current status — revision 31

The remaining-debt tranche plan is fully settled (**T0 through T9**). T9 closed the adversarial
reconciliation, final verification, evidence and publication.

**T9 (adversarial review, full verification, evidence and publication) is settled.** Reconciliation
checked every disposition in the debt matrix against recorded proof and corrected two stale claims:
the authoritative model still described Team-specific limits, capacity and admission/batching as
established elsewhere while the T2 Team admission/batching is live, so a new `J-TEAM-ADMISSION`
canonical journey (`evidence_class: observed`) was added and the J-EXPERT-PARALLEL /
J-EXPERT-MODEL-PARALLEL variant text rewritten to point Team capacities at J-TEAM-ADMISSION and
leave only disjoint-workspace effect parallelism with J-EXPERT-PARALLEL (re-validated: 0 violations,
`fmt --check` clean, 233 semantic objects); and `docs/experts-debt-closure.md`, `.agents/DEBT.md`
and `docs/known-gaps.md` carried statements T4–T8 had overtaken, reconciled to the observed evidence
while genuinely-open items stayed open.

One genuine product-journey race was found and fixed: `test/E2E-experts.test.ts` waited on a heading
that already existed after "Save Expert" and reopened the editor before the `experts` projection
folded the new instructions (the editor snapshots its initial value at mount); it now waits for the
projection row to carry the saved instructions.

Gates: the full suite is green serialized — `bun test --max-concurrency 1 --timeout 60000 test`
passed **1,179 pass / 9 skip / 0 fail** across 1,188 tests (117 files); the E2E-experts race fix was
also verified 3/3 under a synthetic CPU load. The default parallel `just verify` intermittently
fails one or more E2E/browser or shared-store journeys at their deadlines on this co-tenanted host
(rotating identity; every one passes standalone and in the serialized run) — a test-infrastructure
property recorded in `.agents/DEBT.md`. `domainforge validate` 0 violations, `fmt --check` clean,
`bun run typecheck` clean, `git diff --check` clean.

Remaining open (unchanged, none claimed closed): live aggregate memory accounting; multi-tenant
application seeding (per-tenant Experts/schedules); distributed schedule-evaluator ownership;
generalized SDK inbox / standalone live steering; and the security review's residual boundaries.
This remains a single-operator Workbench — the development authenticator survives only as an
explicit, loud test/dev opt-in, not a production-hardened multi-user deployment.

Next: no tranche remains in this plan. Optionally cap suite/E2E concurrency for constrained hosts to
make `just verify` deterministic there (see `.agents/DEBT.md`).
