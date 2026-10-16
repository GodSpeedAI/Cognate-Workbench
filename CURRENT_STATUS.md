# Current status — revision 27

The remaining-debt tranche plan has settled **T0 through T5**; the active task is T6 (upstream
run-write ownership in the Cognate repo). T1 delivered conflict-aware per-resource workspace
admission; T2 delivered authoritative Team admission/batching policy; T3 settled the capacity-8
question as an accepted measured limit. T4 settled indexed retrieval and the fingerprinted global
root CAS: Workbench read paths locate records through the manifest's SHA-256 nibble trie instead of
materializing the aggregate, the root manifest is a fingerprinted partition directory v2 that
verifies every restored section and carries unchanged sections forward by verified content
address, and counted-read journeys prove page-bounded reads, two-leaf mutations and the
erased/aliased fail-closed contract (large-profile mutation p50 1,589 → 782 ms back-to-back).
Dev bearer authentication remains a known single-operator limitation.

T5 (exact tokenization, durable reservations and budget ceilings) is settled: context accounting
tokenizes the complete visible request with the route's model-specific tokenizer (published
encodings per model family; labeled approximation otherwise) behind an explicit envelope margin.
Every Expert and ordinary-session dispatch holds a durable reservation on the governed
`experts:billing:v1` ledger before the provider is called and settles from provider-reported usage
or its full conservative amount. Crash recovery collides with the interrupted reservation: it is
booked conservatively as reconciled-unknown (never zero) and the recovery re-dispatch proceeds
under a separately booked generation — no dropped, double-counted or blindly repeated usage; boot
reconciliation settles open reservations from committed invocation evidence. Operator spending
ceilings (`settings.changeSpending`: ordinary-session and global USD) fail closed — over-ceiling and
unpriced dispatch is refused before any provider call — and unknown prices surface as unknown in
the ledger, the usage disclosure and the new Experts-panel spending inspection.

Journeys: `test/J-CONTEXT-BUDGET-billing.test.ts` (3, actual PostgreSQL, real native runs),
`test/expert-economics.test.ts` (6, tokenizer coverage), `test/E2E-experts-debt.test.ts` (4,
including real Chromium spending inspection), plus the model journey J-CONTEXT-BUDGET extended and
re-validated in `.sea`. `just verify` passed 1,172 tests / 1,166 pass / 6 skip / 0 fail across 112
files. Evidence: [expert-economics](docs/expert-economics.md),
[experts-storage](docs/experts-storage.md), [experts-scale-baseline](docs/experts-scale-baseline.md).
Known boundaries: tokenization is a labeled estimate of the visible request, not a provider
receipt; provider-side billing of aborted dispatches cannot be undone; the reservation generation
mechanism trusts the durable executor's at-most-once step semantics pending T6 fencing; ledger
garbage collection is not claimed.

Remaining open: upstream run-write ownership (T6) and Workbench multi-process integration (T7);
production identity/tenant isolation, aggregate containment and independent security review (T8);
the final adversarial reconciliation (T9); generalized SDK inbox/standalone live steering; and the
explicit product debts in the disposition matrix.

Next: execute T6 — in the Cognate repo, through an isolated worktree with PR44-style gates,
design and land run-write fencing, authoritative store-time ownership, worker compatibility,
two-process fault injection and ambiguous-effect recovery.
