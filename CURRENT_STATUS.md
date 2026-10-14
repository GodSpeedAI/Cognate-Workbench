# Current status — revision 10

Verified native debt slices committed; final Workbench gate passes1100tests. Upstream SDK PR42 is pushed and tested but unpublished. Full debt-closure mission remains incomplete.

The [mission plan](.agents/plans/20261014_experts-debt-closure.plan.yaml) remains **in progress**.
The complete [verification report](docs/experts-debt-verification.md) records every primary debt,
canonical journeys, measurements, failure evidence, source commits and remaining conditions.

Final `just verify`: **1,100 pass, zero fail, 6,856 assertions across 96 files, 629.97 seconds**,
including typecheck. DomainForge 0.19.0 validates with zero violations and clean formatting;
222 semantic objects and all 27 Expert/four schedule/twenty cognitive bindings resolve.

Workbench remains on published Cognate **0.2.0** and PostgreSQL/pg0. Backend `a4d6201` and UI
`8169975` implement single-process native Expert/Team schedules, shared Team live inbox,
bounded immutable state partitions, scoped cursor history/memory, frozen Expert attempt budgets,
accurate observed usage and inspectable receipts. Schedule and inbox SIGKILL recovery, failure,
cancellation, human approval, migration/erasure, private context and browser journeys pass.
The default Cognate Team and one-Orchestrator invariant remain intact.

A real PostgreSQL pool deadlock was reproduced and fixed upstream. Workbench coalesces identical
immutable preparation requests without caching private state; the original concurrent membership
journey passes five repetitions with unchanged assertions/timeouts. Comparative 917 KB writes fall
from about 3.68 MB to 173 KB; the 8.49 MB fixture retains scope/identity and recovers.

Upstream `ab4dd2a`, `920c4c9`, `06a520b` and `48ad057` are pushed in
[Cognate PR #42](https://github.com/GodSpeedAI/Cognate/pull/42). Native fencing/concurrency and Linux
child-process ports pass scoped gates and 81 verification gates. CI/clean-room packaging passed
`06a520b`. Source success is not a published dependency release or production trust.

Distributed run-write ownership, production identity/session/tenant integration, supported contained
deployment, aggregate resource quotas and independent security review remain open. So do indexed
retrieval, exact tokenization/global budgets and enumerated historical workflow gaps. One Bun process
is supported; no new parallel/distributed UI promise is made.

Luna workers reported their service usage limit; unperformed recon is not claimed. Sibling user
changes are preserved. Final documentation push and removal of the task-owned temporary SDK
worktree are next; source is preserved by pushed commits and PR. No force-push or unsupported
development dependency is authorized or used.
