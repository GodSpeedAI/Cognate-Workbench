# Current status — revision 2

Native Experts & Teams has a validated semantic model, persistent identities, governed Teams, per-Expert routing and real correlated delegation on `feature/expert-teams`. Native UX and effect-recovery hardening are in progress. The operator's mission and vital UX requirement govern the work.

Plan: [.agents/plans/20261013_native-experts-teams.plan.yaml](.agents/plans/20261013_native-experts-teams.plan.yaml).

Baseline `just typecheck` passed. Baseline `just verify` failed: 915 passed, 106 failed; observed blockers include pg0 startup writing to a read-only filesystem and aimock startup. No feature changes existed during baseline. The previously required status files were absent and are initialized here.

Recon confirms published Cognate 0.2.0, PostgreSQL/pg0 persistence, fire-and-forget existing subagents and a single global provider. Native shared thread state offers atomic optimistic writes. Durable continuations exist; automatic run-completion resolution is missing and needs an explicit tested bridge. Default development authentication remains a known limitation.

Donor: DeepSeek-Bot 0.1.5, commit `20ebc9213cbbde7249d71786765f86be00dc6663`, Apache-2.0. Temporary checkout is ignored. Translation matrix: `docs/experts-donor-translation.md`. No donor source copied.

Observed proof: 6 execution/security/memory integration tests passed against PostgreSQL (60 assertions); 6 model-routing tests passed; membership/concurrency/persisted-projection tests passed (4 tests, 37 assertions). Native UI typechecking and 3 component tests passed. Core returns are durable and attributable, but unfinished-process interruption and complete browser flows remain to verify.

Adversarial review exposed an SDK gap: replay can repeat an invocation after an effect whose result was not recorded. Expert side effects are being wrapped with native Cognate commitments, with ambiguous outcomes blocked for human reconciliation. Evidence-reference scoping and addressed-message context filtering are tightened. These are open verification gates, not claimed settlement.

Next: finish native commitment integration, interruption and genuine-tool journeys, browser UX checks, independent review, regression suite, donor cleanup, documentation and push. Milestones committed: `3b0781e`, `5dbce99`.
