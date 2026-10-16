# Current status — revision 26

The remaining-debt tranche plan has settled **T0 through T4**; the active task is T5 (exact
tokenization, durable billing reservations and budget ceilings). T1 delivered conflict-aware
per-resource workspace admission (canonical keys from authoritative state; forged identities fail
closed; PostgreSQL + Chromium journeys). T2 delivered authoritative Team admission/batching policy
(lanes + dispatch batches + truthful UI + client-policy refusal). T3 settled the capacity-8
question as an accepted measured limit with isolated cause attribution. Dev bearer authentication
remains a known single-operator limitation.

T4 (indexed retrieval and the global root CAS) is settled: the Experts root manifest is now a
fingerprinted partition directory v2 — one content fingerprint per present logical section; every
restored section is verified against it; unchanged sections are carried forward by verified content
address without re-reading, re-serializing or re-writing their leaves; only changed sections
re-partition, writing only leaves whose path+hash changed. Workbench read paths no longer
materialize the aggregate: conversation pages locate records through the manifest's SHA-256 nibble
trie (root + one conversation leaf + at most N message-leaf reads + the trailing assignment leaf,
independent of aggregate size), memory reads and the listing/review/cancel/invocation pre-checks
touch only the sections they use, and legacy/empty roots fall back to the full read. Counted
shared-state calls prove a 50-message page of a 240-message conversation never touches memory,
expert, team, receipt or audit partitions, and that a one-record memory mutation writes exactly the
changed memory leaf plus the command's receipt leaf. Source-erased or aliased partitions fail
verification and invalidate the public projection. `just verify` passed 1,167 tests / 1,161 pass /
6 skip / 0 fail across 111 files; back-to-back storage benchmarks show large-profile p50 mutation
1,589 → 782 ms and 632 → 444 partition reads per sweep (eliminated per-command existence
re-reads), small-profile parity.

Journeys: `test/J-MEMORY-scoped-loads.test.ts` (new), `test/J-MEMORY-migration.test.ts` (extended
to fingerprint-inconsistent manifests), `test/J-MEMORY-pagination.test.ts` (unchanged semantics).
Evidence: [experts-storage](docs/experts-storage.md), [experts-scale-baseline](docs/experts-scale-baseline.md).
Known boundary: mutations still restore every accepted partition to evaluate global invariants, so
the root CAS remains a global contention point; no SQL full-text index, garbage collection or
vector index is claimed.

Remaining open: exact tokenization, durable billing reservations and budget ceilings (T5); upstream
run-write ownership (T6) and Workbench multi-process integration (T7); production identity/tenant
isolation, aggregate containment and independent security review (T8); the final adversarial
reconciliation (T9); generalized SDK inbox/standalone live steering; and the explicit product debts
in the disposition matrix.

Next: execute T5 — model-specific tokenization for context accounting, durable pre-dispatch billing
reservations with crash reconciliation, and ordinary-session/global spending ceilings that fail
closed on exhaustion.
