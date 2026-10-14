# Expert state storage

The Expert service keeps its logical state at schema 1. The `experts:registry` shared-state thread is the
compare-and-swap root. New writes publish a schema-2 storage manifest in that thread; the manifest
lists hash-addressed partitions for the schema-1 sections. Reads materialize the manifest back into
the same logical state shape before applying existing service rules.

Each partition is an immutable shared-state thread named with the
`experts:partition:v1:` prefix. Entries are assigned to a deterministic SHA-256 nibble trie by
their record ID. A leaf is written only when its serialized payload fits within 768 KiB, leaving
headroom below Cognate's 1,048,576-byte event-envelope limit. Its native Cognate fingerprint is
part of the thread ID and manifest reference. The writer prepares and verifies every changed leaf
before it compare-and-swaps the root manifest. Unchanged leaves are reused by address. A losing root
CAS may leave unreferenced immutable leaves; readers accept only leaves named by the current root.

The root manifest retains the global Team membership data and the full section directory, so the
existing Team invariant checks and global compare-and-swap behavior remain in force. Schema-1 roots
are read without alteration, partitioned, then migrated with a root CAS. A crash before that CAS
leaves the schema-1 root authoritative. The append-only event history remains intact. Unknown
logical top-level fields and unsupported manifest versions fail closed until an explicit versioned
migration handles them.

The in-memory materialization path does not cache private partition payloads. Each read verifies
the live partition content against the root's hash reference. This costs reads during state
materialization but ensures a native event erasure cannot be hidden by stale process memory. The
public Experts projection stores only sanitized partition material: memory, receipts, audit, private
conversations, private messages, and assignment execution context are omitted. It tracks source
event IDs so `erasure.recorded` removes affected partition rows and invalidates `current` when the
erased source participates in the accepted manifest. Internal projection metadata is not part of the
Workbench's public row surface.

Concurrent preparation of an identical leaf shares one pending promise per trusted service/caller
and content address. The promise is removed on completion; no private payload or accepted state is
cached. Native writes and root CAS remain authoritative after crashes. This avoids duplicate
preparation traffic and a discovered same-key pool-starvation defect in published Cognate 0.2.0.
The root defect is separately fixed upstream by transaction-local receipt reads, with a regression
that fails before the fix. Workbench does not substitute unpublished SDK source for its dependency.

The migration and erasure contract is exercised against local PostgreSQL by
`bun test test/J-MEMORY-migration.test.ts`. It covers a schema-1 history above 5 MiB, failure before
root publication, migration, concurrent global Team updates, restart recovery, event-history
retention, public redaction, missing-partition failure, and source-event erasure.

## Paginated reads and remaining limits

`expert.context` accepts `limit` and `cursor` for conversation history and messages;
`expert.memory.read` accepts them for scoped search. Limits are integers from 1 through 100.
Cursors bind query, scope, ordering boundary and accepted root version. A mutation makes a cursor
stale and returns an explicit refresh error. The UI loads recent messages and offers older pages;
legacy calls without pagination retain their response shape. `test/J-MEMORY-pagination.test.ts`
proves ordering, changed scope/query/version rejection and private-memory exclusions with 205 items.

This bounds responses, not database reads: the service still materializes all accepted partitions
and performs lexical filtering. Root CAS remains a global contention point, and unreferenced
prepared leaves are retained in native event history. No SQL full-text index, garbage collection,
vector index or independent private-payload cache is claimed. Benchmarks and measured write reduction
are in [experts-scale-baseline.md](experts-scale-baseline.md).
