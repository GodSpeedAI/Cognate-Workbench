# Current status — revision 1

Native Experts & Teams implementation is in reconnaissance and semantic modeling on `feature/expert-teams`. The operator's mission and vital UX requirement govern the work.

Plan: [.agents/plans/20261013_native-experts-teams.plan.yaml](.agents/plans/20261013_native-experts-teams.plan.yaml).

Baseline `just typecheck` passed. Baseline `just verify` failed: 915 passed, 106 failed; observed blockers include pg0 startup writing to a read-only filesystem and aimock startup. No feature changes existed during baseline. The previously required status files were absent and are initialized here.

Recon confirms published Cognate 0.2.0, PostgreSQL/pg0 persistence, fire-and-forget existing subagents and a single global provider. Native shared thread state offers atomic optimistic writes. Durable continuations exist; automatic run-completion resolution is missing and needs an explicit tested bridge. Default development authentication remains a known limitation.

Donor: DeepSeek-Bot 0.1.5, commit `20ebc9213cbbde7249d71786765f86be00dc6663`, Apache-2.0. Temporary checkout is ignored. Translation matrix: `docs/experts-donor-translation.md`. No donor source copied.

Next: validate Experts/Teams semantics, repair the test environment, prove persistent per-Expert routing and restart-safe handoffs, then implement management, memory and native UX. No new journey is yet claimed complete.
