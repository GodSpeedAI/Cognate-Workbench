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

Since the indexed-retrieval tranche the manifest is a partition directory version 2: besides the
partition references it carries one content fingerprint per present logical section. Publication
computes each section's fingerprint from the state it restored from the accepted root. A section whose
content is unchanged is carried forward by its verified content address — its leaves are neither
re-serialized, re-read nor re-written — and only changed sections re-partition, writing only the
leaves whose (path, hash) changed. The global root CAS over the memory, history and remaining
logical sections therefore remains the single publication point while per-command leaf traffic
tracks the actual write set. Every restored section is also verified against its manifest
fingerprint, so a section directory that no longer matches its accepted fingerprint fails closed
before any row is served.

The root manifest retains the global Team membership data and the full section directory, so the
existing Team invariant checks and global compare-and-swap behavior remain in force. Schema-1 roots
are read without alteration, partitioned, then migrated with a root CAS; partition-directory-v1
roots (published before this tranche) restore unchanged for reads and are upgraded to v2 on their
next mutation. A crash before that CAS leaves the schema-1 root authoritative. The append-only
event history remains intact. Unknown logical top-level fields and unsupported manifest versions
fail closed until an explicit versioned migration handles them.

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
retention, public redaction, missing-partition failure, fingerprint-inconsistent manifest rejection,
and source-event erasure.

## Scoped indexed retrieval

Workbench read paths no longer materialize the aggregate. `expert.context` conversation reads,
`expert.memory.read`, conversation listing, assignment authorization and the review/cancel
pre-checks read only the logical sections they touch, and conversation pages locate records
through the manifest's nibble trie: a page of N messages costs the root read, one conversation
leaf, at most N message-leaf reads and the trailing assignment leaf — independent of other
conversations, other experts' memory, or the aggregate's total history. `test/J-MEMORY-scoped-loads.test.ts`
proves with counted `readSharedState`/`updateSharedState` calls that a 50-message page of a
240-message conversation never touches memory, expert, team, receipt or audit partitions, that a
one-record memory mutation writes exactly the changed memory leaf and the command's receipt leaf,
that the accepted root is a fingerprinted v2 directory, and that restart, section-directory aliasing
and source-event erasure preserve the fail-closed contract.

Conversation pages follow the conversation's append order (newest appended first). Sequenced
messages append in sequence order, so pages agree with the previous sequence-descending order for
sequenced conversations; cursors remain bound to the same kind, scope, ordering boundary and
accepted root version, and a mutation makes them stale with an explicit refresh error. Page limits
remain integers from 1 through 100, and `test/J-MEMORY-pagination.test.ts` still proves ordering,
changed scope/query/version rejection and private-memory exclusions with 205 items. Legacy and
empty roots fall back to the full read, so responses are unchanged for pre-partition state.

## Remaining limits

Unreferenced prepared leaves are retained in native event history. Mutation commands still restore
every accepted partition to evaluate global invariants and to fingerprint unchanged sections, so
the write path remains a full-read / changed-write cycle and the root CAS remains a global
contention point; the eliminated per-command existence re-reads and unchanged-section re-serialization
are measured in [experts-scale-baseline.md](experts-scale-baseline.md). Memory search remains
lexical filtering over the restored memory section. No SQL full-text index, garbage collection,
vector index or independent private-payload cache is claimed.
