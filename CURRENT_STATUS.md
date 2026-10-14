# Current status — revision 5

Native Experts & Teams and responsive management/conversation UX pass final exact-tree verification on `feature/expert-teams`. Documentation publication and the authorized branch push remain.

Plan: [.agents/plans/20261013_native-experts-teams.plan.yaml](.agents/plans/20261013_native-experts-teams.plan.yaml).

Final `just verify` at `a697e36` passed: **1,064 tests, zero failures, 6,536 assertions across 85 files (439.73 seconds)**, including typecheck. DomainForge 0.19.0 validates with zero violations; 188 semantic objects and all 24 Expert bindings resolve.

Published Cognate 0.2.0 remains the execution substrate and PostgreSQL/pg0 the only store. Native state, continuations, commitments and projections support stable identities, frozen per-Expert routes, bounded collaboration, isolated memory and correlated returns. The default Cognate Team has five editable Experts and exactly one Orchestrator.

Evidence demonstrates concurrent membership consistency, real child execution, one logical handoff after process-kill recovery, actual Builder edits, independent verification and human settlement. Five-Expert disagreement is preserved. Cancellation, provider recovery, protected approvals and identity/message/memory overwrite attempts are tested.

Both desktop/mobile browser journeys pass, including custom Team activation, Expert creation/edit/copy, route selection and solo/private history after reload. UX evidence is retained in `screenshots/experts/`.

The task-acquired donor checkout is absent, with no donor files tracked. Provenance and translations remain in `docs/experts-donor-translation.md`. The operator approved retaining Cognate's pre-existing SDK-internal Cordis dependency; no direct integration was added. The added-line secret-pattern audit found no matches. Unrelated regenerated Workbench screenshots were restored.

Autonomous schedules, live inter-Expert steering, parallel workers, vector memory and multi-process effect dispatch remain deferred. Development authentication and best-effort shell guards remain limitations. DomainForge's formatter issue remains; semantics validate. Deferred work is recorded in `.agents/DEBT.md`.

Next: commit release documentation/status, push the branch and record publication. Full evidence: [docs/experts-verification.md](docs/experts-verification.md).
