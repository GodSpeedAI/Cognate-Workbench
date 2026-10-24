# Expert aggregate scale baseline

This document records reproducible pre/post-partition Expert registry characterizations.
It measures PostgreSQL-backed `RuntimeService` shared-state updates through the registered
`ExpertsService` capability path. It does not change production code or make a scaling guarantee.

## Run it

Use an isolated PostgreSQL database, or a dedicated local pg0 instance. The script generates a
temporary home and a unique Cognate schema, and drops that schema after the run. It never prints the
database URL. Keep the database URL in the environment, not in shell history or this report.

```bash
read -r -s -p 'Ephemeral benchmark PostgreSQL URL (blank uses pg0): ' COGNATE_POSTGRES_URL
printf '\n'
export COGNATE_POSTGRES_URL
bun scripts/benchmark-experts.ts
unset COGNATE_POSTGRES_URL
```

With the local `cognate-dev` pg0 instance, leave `COGNATE_POSTGRES_URL` unset. Select a different
instance with `COGNATE_PG0_NAME`. The default profile creates 100 active Experts, 20 Teams, 500
25-character memory records, and a 2,000-message conversation with 6-character messages. It runs
8 mutations at each writer concurrency of 1, 2, 4, and 8 by default (the CLI caps each level at 32
mutations). No model calls, external services, or downloaded vectors are involved.

The pre-partition single-snapshot path is capped at 900 KiB because Cognate rejects event payloads
above 1 MiB (1,048,576 bytes). A 5,200-character-memory and 2,500-character-message profile failed
with `Invalid event envelope: payload exceeds 1048576 bytes`, before the synthetic snapshot
committed. The `--partitioned` option exercises the native bounded partitions for that same profile.
Counts and text sizes may be reduced for a smaller profile, for example:

```bash
bun scripts/benchmark-experts.ts --experts=50 --teams=10 --memories=250 --messages=1000 --operations=12 --concurrency=1,4
```

The benchmark uses a single Bun process with concurrent in-process callers. Its concurrency results
measure contention on the shared Expert aggregate and PostgreSQL store; they do not measure
multi-process dispatch. The script checks exact lexical retrieval, pinned-note retention, a
cross-Expert personal-memory isolation case, and state recovery after a server restart.

## What is measured

- Per-mutation p50/p95 latency and completed mutations per second at each writer concurrency.
- Expert-thread shared-state read/update calls, CAS conflict errors observed at the
  `RuntimeService` seam, and read/update latency distributions.
- Full serialized aggregate bytes before and after writers, update snapshot payload byte
  distributions, and the public `experts` projection's serialized size.
- Process RSS at start, peak, and end; initial server startup and restart/recovery elapsed time.
- Memory quality/scope checks and synthetic state counts after restart.

The restart time includes server startup, store opening, and projection recovery. It is not an
isolated projection rebuild measurement. The aggregate's byte count is the JSON encoding of the
read `ExpertState`; it excludes PostgreSQL row, index, WAL, and TOAST overhead. CAS counts capture
failed-precondition/unavailable errors at the service wrapper, which observes conflicts retried by
`mutateExperts`. These numbers characterize one build, one database, and one machine.

## Environment and results

Characterizations were recorded on 2026-10-14 with Bun 1.4.0, PostgreSQL 18.1 via local pg0,
Linux 6.18.54.1-microsoft-standard-WSL2 x64, an Intel Core Ultra 5 226V (6 reported CPUs), and
8.33 GB reported RAM. The database connection value is omitted. Both profiles use 100 Experts, 20
Teams, 500 memories, and 2,000 messages. The pre-partition run was captured before the native
partition implementation; post-partition runs use the current implementation. The pre-partition
logical aggregate was 917,487 bytes before writers and 922,279 bytes after. Each successful update
rewrote roughly 0.92 MB.

The comparable post-partition command was
`bun scripts/benchmark-experts.ts --operations=4 --concurrency=1,2,4,8`. The larger profile used
the command shown below in the large-run paragraph. The original baseline command was
`bun scripts/benchmark-experts.ts --operations=4` before `--concurrency` and partition instrumentation
were added; it used the script's default 1, 2, 4, and 8 concurrency sweep.

| Profile and configured callers | p50 / p95 mutation latency | Throughput | Root CAS conflicts | Committed snapshot payload bytes per sweep |
| --- | ---: | ---: | ---: | ---: |
| Pre-partition, 1 | 231 / 453 ms | 3.62/s | 0 | about 3.68 MB |
| Pre-partition, 2 | 494 / 2,137 ms | 1.87/s | 2 | about 3.68 MB |
| Pre-partition, 4 | 2,858 / 4,958 ms | 0.81/s | 6 | about 3.68 MB |
| Pre-partition, 8 | 4,838 / 7,567 ms | 0.53/s | 6 | about 3.68 MB |
| Post-partition, 1 | 219 / 293 ms | 4.07/s | 0 | 172,772 B |
| Post-partition, 2 | 323 / 1,224 ms | 3.27/s | 3 | 25,031 B |
| Post-partition, 4 | 942 / 1,470 ms | 2.72/s | 6 | 43,974 B |
| Post-partition, 8 | 1,015 / 1,623 ms | 2.46/s | 6 | 56,534 B |

The post-partition comparable profile serialized to 917,487 bytes before writers and 922,279 bytes
after, matching the baseline logical-state size. Initial population wrote a 1,779-byte root manifest
and 917,732 bytes across six immutable partition payloads. The public current row serialized to
4,255 bytes. In each four-operation sweep, committed root payloads totaled 8,044 bytes; committed
partition payloads totaled 164,728 / 16,987 / 35,930 / 48,490 bytes for configured concurrency
1 / 2 / 4 / 8. This includes leaf metadata and receipts. It reduces the comparable write payload
from about 3.68 MB to about 0.17 MB for the single-writer sweep. Exact lexical search returned the
single target, pinned notes were retained, scope checks found no leak, and restart recovered all
records in 628 ms. Partition materialization made 119 / 184 / 232 / 240 child reads across each
four-operation sweep; the current implementation deliberately does not retain private partition
payloads in process memory.

The four-sample p95 is the sample maximum, and the configured concurrency-8 stage had at most four
active callers. These are coarse characterization numbers, not stable tail estimates. The comparable
post-partition peak process RSS was 336,334,848 bytes.

A larger post-partition run used the reproducible command
`bun scripts/benchmark-experts.ts --partitioned --memory-chars=5200 --message-chars=2500 --operations=4 --concurrency=1`.
Its 100-Expert / 20-Team / 500-memory / 2,000-message logical aggregate serialized to 8,492,988
bytes. Initial population wrote 8,683 root-manifest bytes and 8,495,080 partition-payload bytes
across 36 immutable partitions. Four single-writer mutations committed 35,660 root bytes and
164,732 partition bytes (200,392 bytes total), with p50/p95 latency of 490 / 593 ms, 2.08 updates
per second, and no CAS conflicts. Restart and projection recovery took 906 ms; peak process RSS was
606,183,424 bytes. The current public projection row serialized to 5,772,854 bytes because public
conversation messages remain visible; private memory and private-scope content are excluded. Memory
retention, exact-search, and scope checks passed.

## Interpretation limits

The post-partition results show a useful storage-write reduction for these synthetic profiles, while
state materialization reads every referenced leaf and the global root still serializes all writers.
The large profile shows that a logical state above the event ceiling can be stored, but does not
establish a production capacity limit, real-user workload distribution, database storage growth, or
vector-retrieval behavior. Four operations per setting give coarse p95 estimates. Repeat with more
samples on a documented database and machine before making capacity claims. Preserve each profile
and its raw JSON output so later runs remain comparable.

## Indexed-retrieval tranche re-measurement (2026-10-16)

The indexed-retrieval tranche added per-section content fingerprints to the root manifest
(partition directory v2): unchanged sections are carried forward by verified content address
without re-reading, re-serializing or re-writing their leaves, and every restored section is
verified against its manifest fingerprint. To isolate the write-path change from machine drift,
the pre- and post-tranche trees were measured back-to-back on the same machine (Bun 1.4.0,
PostgreSQL 18.1 via local pg0, WSL2), each command creating its own fresh schema. These are
single-run observations with the same run-to-run variance warned about above, not stable medians.

Large profile (`--partitioned --memory-chars=5200 --message-chars=2500 --operations=4 --concurrency=1`,
8,492,988-byte logical state, 36 partitions):

| Tree | Sweep wall | p50 / p95 mutation | Partition reads per sweep | Partition writes |
| --- | ---: | ---: | ---: | ---: |
| Pre-tranche | 6,024 / 7,283 ms (two runs) | 1,589 / 2,383 ms | 632 | 12 |
| Post-tranche | 4,495 ms | 782 / 1,755 ms | 444 | 12 |

The eliminated reads are the per-command existence re-reads of unchanged leaves during manifest
preparation (~47 per mutation); partition writes are unchanged because only the changed
experts/receipts/audit leaves commit. The comparable small profile (917,487-byte state, 6
partitions, `--operations=4 --concurrency=1`) showed rough parity back-to-back (pre 3,453 ms
cold / 1,209 ms warm; post 1,461 / 1,247 / 1,104 ms) — with only six leaves the eliminated
existence reads are a few milliseconds each, so the write-path gain appears mainly at larger
partition counts. Read-path boundedness is not a writer-sweep quantity; it is proven by counted
shared-state calls in `test/J-MEMORY-scoped-loads.test.ts`, where a 50-message page of a
240-message conversation never touches memory, expert, team, receipt or audit partitions.
