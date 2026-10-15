# Current status — revision 17

Workbench's published SDK 0.4.0 integration passes 1,104 tests. Separate PR44 repairs native admission capacity and shutdown recovery, with PostgreSQL regressions and exact-head CI/packaging passing; merge/release authorization remains reserved and the wider mission is incomplete.

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

A separate [async admission PR #44](https://github.com/GodSpeedAI/Cognate/pull/44) at `d0e4911` passed
exact-head CI and clean-room packaging. The cancelled-callback capacity finding is repaired; native
shutdown now aborts cooperative execution and recovers acknowledged RESUMED waits. Each regression
failed before its repair. PostgreSQL targeted tests pass 19/19 with 121 assertions; full SDK gates
pass 81/81. Luna source review found no remaining scoped blocker. CodeRabbit is rate-limited and
did not freshly review this head; its prior actionable finding is verified fixed.

The linked-release audit passes for all 45 packages with trusted publishing enabled and no pending
release. PR44 is unmerged/unpublished and awaits reserved operator authorization; Workbench has no
unsupported dependency. Signal-ignoring handlers can still delay shutdown, and interrupted remote
effects may need reconciliation. Distributed run-write ownership, production authentication/containment,
indexed retrieval, exact tokenization and global budgets remain open. Outbox fencing and Linux
child containment do not establish those guarantees. Original sibling changes remain untouched.
