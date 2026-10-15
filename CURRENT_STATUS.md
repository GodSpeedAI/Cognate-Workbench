# Current status — revision 16

Published Cognate 0.4.0 remains integrated; the expanded Workbench suite passes 1,104 tests. Native runtime capacities 1/2/4 are verified, while application parallel admission and the wider debt mission remain incomplete.

The [mission plan](.agents/plans/20261014_experts-debt-closure.plan.yaml) remains **in progress**.
[Release evidence](docs/sdk-0.4.0-release.md) and the [debt report](docs/experts-debt-verification.md)
record exact source commits, workflow receipts, package audits and remaining conditions.

PR #42 merged at `c6e3207` and linked release PR #43 at `467a5f` under operator authorization.
All 45 npm packages published at 0.4.0 with the expected source commit. A new consumer installed
all 45 with no graph drift and demonstrated native peak concurrency 2 with distinct outputs.

Workbench pins published Cognate **0.4.0**: 23 direct/35 resolved SDK packages, no source links
and no non-SDK lockfile changes. The expanded `just verify` passes **1,104 tests, zero failures,
6,884 assertions across 96 files in 408.21 seconds**, including actual browser and PostgreSQL
recovery journeys. Four focused tests prove native capacity 1/2/4 and correlated handoff/redelivery;
these substrate fixtures do not establish Workbench Team parallelism. Generated screenshots are
restored after verification.

Native schedules, shared Team live inbox, partition migration/pagination and frozen Expert budgets
retain their verified behavior. The default Cognate Team and one-Orchestrator invariant remain intact.
DomainForge 0.19.0 validates and formats 224 semantic objects; 27 Expert/four schedule/twenty cognitive
bindings resolve. J-EXPERT-PARALLEL and its inspection binding are declared; app execution still
defaults to one. Authority-safe metadata lookup and UI are not yet settled.

A separate [async admission PR #44](https://github.com/GodSpeedAI/Cognate/pull/44) passed exact-head
CI and clean-room packaging at `bf5031c`. Its actionable review finding concerns a cancelled callback
releasing capacity before it physically settles. A regression and source repair are in progress;
the extension is unpublished and unconsumed. Distributed run-write ownership, production authentication/containment,
indexed retrieval, exact tokenization and global budgets remain open. Outbox fencing and Linux
child containment do not establish those guarantees. Original sibling changes remain untouched.
