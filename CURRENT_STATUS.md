# Current status — revision 29

The remaining-debt tranche plan has settled **T0 through T7**; the active task is T8 (production
identity, authorization and aggregate containment). T4 settled indexed retrieval and the
fingerprinted global root CAS; T5 settled model-specific tokenization, durable billing
reservations with crash-reconciliation generations and fail-closed spending ceilings.

**T6 (upstream run-write ownership) is settled**: PR #48 (store fencing + executor ownership
lifecycle + ambiguous-effect reconciliation) and PR #55 (held-lease recovery re-arm) merged into
Cognate main with green exact-head CI; the linked SDK releases **0.6.0** (interrupted publication
legitimately recovered: exact git-state restoration, the PR #54 dispatch-recovery input, receipts
gate 45/45, independent registry audit, fresh clean-room consumer) and **0.6.1** (normal release
train, 45/45 publish + receipts in one green run) are published. Provenance:
[sdk-0.6.0-release.md](docs/sdk-0.6.0-release.md).

**T7 (Workbench multi-process integration) is settled** against published 0.6.1: all SDK
dependencies pinned to 0.6.1; multi-process operation exposed behind the verified
`runOwnership: "multi-process"` configuration (`ambiguousSteps: "wait"`), with the default
single-process mode preserving historical restart semantics. The extended J-EXPERT-PARALLEL model
journey re-validates, and `test/J-EXPERT-OWNERSHIP-MULTI.test.ts` passes the two-process
crash/stale-writer journey against actual PostgreSQL: a killed process's in-flight effect is
never blindly repeated (one `run.invocation.ambiguous`, zero recorded model invocations,
provider called once), the interrupted attempt stays booked in the billing ledger, a zombie
writer's superseded-credential append is fenced with nothing appended, and the assignment
settles only from the operator's explicit reconciliation. The SIGKILL and restart journeys that
regressed against 0.6.0 pass unchanged against 0.6.1. Full gate: `just verify` passed
**1,173 tests / 1,167 pass / 6 skip / 0 fail** across 113 files (one intermediate run's single
E2E-workbench Chromium `ERR_NETWORK_CHANGED` console flake passes in isolation and in the final
clean run).

Remaining open: production identity/tenant isolation, aggregate containment and independent
security review (T8); the final adversarial reconciliation (T9); generalized SDK
inbox/standalone live steering; and the explicit product debts in the disposition matrix. Dev
bearer authentication remains a known single-operator limitation; external effects remain
at-least-once (commitments plus reconciliation is the contract).

Next: execute T8 — durable identities and sessions with revocation, tenant isolation, aggregate
resource containment across processes, deployment hardening, and an independent security review;
replace the single-operator development authenticator only after isolation gates pass.
