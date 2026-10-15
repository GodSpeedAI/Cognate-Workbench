# Workbench model-only concurrency measurement

Observed2026-10-15 with published Cognate0.5.0, Bun1.4.0, PostgreSQL18.1/pg0 and Linux
6.18.54.1-microsoft-standard-WSL2; six logical processors visible. Run:

```sh
bun test --timeout 120000 test/experts-app-capacity.test.ts
```

The test creates eight independent solo conversations and frozen intrinsic-return Assignments per
capacity. A deterministic model provider holds each batch until the configured number enters, then
performs80ms of controlled work. All eight must return successful handoffs with distinct Assignment,
conversation and run identities and no crossed task purpose. This tests native admission and state
contention, not model competence, external provider speed or workspace-effect parallelism.

| Startup capacity | Observed maximum active models | Completed assignments | Elapsed ms | Assignments/sec | Bun process RSS bytes |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 8 | 6049.6 | 1.32 | 322125824 |
| 2 | 2 | 8 | 4994.0 | 1.60 | 357126144 |
| 4 | 4 | 8 | 4688.3 | 1.71 | 360566784 |
| 8 | 8 | 8 | 5317.6 | 1.50 | 385019904 |

One trial per capacity; no confidence interval or portable throughput guarantee. Elapsed time spans
command creation through all handoffs and excludes initial app seeding/profile setup. RSS is the
whole Bun process at the sample, accumulated across cases, not per-app usage or a measured peak.
All cases share a bounded deadline and release held providers during cleanup.

The test passes **one test/372 assertions in25.68 seconds**. Capacity4 had the highest throughput
in this fixture; capacity8 was slower despite achieving eight active model calls. The data do not
isolate the cause. Registry CAS, full context materialization and indexed-retrieval limitations
remain recorded under A4; higher capacity alone does not settle them. Default capacity remains1.

Additional actual journeys in `test/J-EXPERT-model-parallel.test.ts` pass8tests/48assertions:
distinct frozen routes, two-model overlap, serial tool-bearing work, configuration ordering,
profile edits, forged-tool denial and same-run cooperative restart. Browser evidence is in
`screenshots/concurrency/`. General workspace concurrency and Team-specific capacity remain open.
