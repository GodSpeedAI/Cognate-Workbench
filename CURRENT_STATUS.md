# Current status — revision 28

The remaining-debt tranche plan has settled **T0 through T5**; T6 (upstream run-write ownership)
is in progress with its store-level slice settled. T1 delivered conflict-aware per-resource
workspace admission; T2 authoritative Team admission/batching policy; T3 the capacity-8 accepted
limit. T4 settled indexed retrieval and the fingerprinted global root CAS (trie-directed scoped
reads, verified carry-forward, large-profile mutation p50 1,589 → 782 ms back-to-back). T5 settled
model-specific tokenization, durable billing reservations with crash-reconciliation generations
and fail-closed session/global spending ceilings (real native runs, restart reconciliation, real
Chromium spending inspection). Dev bearer authentication remains a known single-operator
limitation.

T6 started in the isolated upstream worktree `~/projects/cognate-run-ownership` (branch
`feature/run-write-ownership`, based on the authorized PR44 head 033029d, commit ae80c1c): the
run-write ownership design contract plus the store-level slice — one authoritative ownership row
per enrolled run, store-maintained generations advanced by every reclaim and release, exclusive
claims, exact-identity renewal, and commit-phase fencing that refuses stale, uncredited or
smuggled run writes while keeping unenrolled runs exactly legacy. RED/GREEN two-process
PostgreSQL journeys prove a reclaimed owner fences a killed owner's late write with nothing
appended. Upstream gates: `packages/store-postgres` 42 pass, `packages/events` pass,
`packages/runtime-bun` 155 pass, full upstream `just verify` **81/81** on the branch head.

Remaining for T6: the executor-side slice (ownership lifecycle in the dispatcher/executor,
halt-without-retry on stale ownership, ambiguous-effect marking for prior generations'
in-flight steps, two-process runtime journeys), then the operator-gated PR44-style publication
gates — exact-head CI/packaging, operator-authorized merge, linked release, registry audit,
fresh-consumer proof. Upstream policy holds "no merge/publication" until exact-head checks; the
agent cannot merge or publish. T7+ stay blocked on a complete, legitimate release.

Journeys: `test/J-MEMORY-scoped-loads.test.ts`, `test/J-MEMORY-migration.test.ts`,
`test/J-MEMORY-pagination.test.ts`, `test/J-CONTEXT-BUDGET-billing.test.ts`,
`test/expert-economics.test.ts`, `test/E2E-experts-debt.test.ts`, and upstream
`packages/store-postgres/test/run-ownership.test.ts`. Workbench `just verify` passed 1,172
tests / 1,166 pass / 6 skip / 0 fail across 112 files. Evidence:
[expert-economics](docs/expert-economics.md), [experts-storage](docs/experts-storage.md),
[experts-scale-baseline](docs/experts-scale-baseline.md), and the upstream worktree's
`docs/contracts/run-write-ownership.md` + `docs/evidence/run-write-ownership.md`.

Next: complete the T6 executor-side slice in the worktree, then request the operator-gated
exact-head CI/packaging, merge, linked release, registry audit and fresh-consumer proof before
T7 Workbench multi-process integration.
