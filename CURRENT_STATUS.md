# Current status — revision 30

The remaining-debt tranche plan has settled **T0 through T8**; the active task is T9 (final
adversarial review, full verification, evidence and publication). T4–T7 settled indexed
retrieval, economics, the upstream fenced run-write ownership releases (0.6.0/0.6.1) and the
Workbench multi-process integration.

**T8 (production identity, tenant isolation and aggregate containment) is settled.** The model
grew first: three new validated journeys (J-AUTH-SESSION, J-AUTH-TENANT-ISOLATION,
J-RW-AGGREGATE-CONTAINMENT) anchored on new `DurableIdentity`, `DurableSession` and
`ContainmentQuota` concepts. Durable server-issued sessions are now the default authentication
posture — 256-bit tokens stored only as SHA-256 hashes, revocation and expiry, boot-supersession
of the previous boot's browser token, immediate in-process revocation (epoch-invalidated cache;
a documented ≤2 s cross-process read lag), and the client-claimed dev bearer format reduced to an
explicit loud opt-in. The capability policy grants user-kind authority to exactly the one durable
operator identity; both new ledgers are system-only threads. Tenant isolation is observed end to
end on one shared PostgreSQL store with two server-issued sessions. Aggregate containment wraps
every contained provider's process port: durable admission slots, operator quotas
(`settings.changeContainment`), kernel per-execution CPU/address-space caps via `prlimit` (fail
closed when unavailable), a 300 s hard clamp whose lease provably covers the child, conservative
CPU booking, and lease-lapse reaping — proven across two Workbench processes on one store.
Deployment hardening: security headers on every response (successful Connect replies included), a
strict CSP on the console document (it caught and fixed a pre-existing inline font handler), a
64 MiB body ceiling, and an untracked generated entry so no boot token enters version control.

An **independent fresh-context adversarial security review**
([security-review-2026-10-17-t8.md](docs/security-review-2026-10-17-t8.md)) found one HIGH (the
two new ledgers initially outside the system-only thread guard) and four MEDIUM findings; every
MUST-fix was remediated with journeys and re-gated, and the accepted residual boundaries are
recorded in the artifact's remediation record.

Gates: full `bun run verify` passed **1,188 tests / 1,179 pass / 9 skip / 0 fail**; the gated
real-bwrap OS journeys passed **9/9** (kernel SIGXCPU cap + window exhaustion, cross-process
ceiling, cancellation/reap; the pre-existing escape/egress/cancellation journeys stay green); the
auth and containment journeys passed **12/12** against actual PostgreSQL; `domainforge validate`
0 violations.

Remaining open: T9's final reconciliation and publication; multi-tenant application seeding;
live aggregate memory accounting; generalized SDK inbox/standalone live steering; and the
explicit product debts in the disposition matrix. This remains a single-operator application —
not a production-hardened multi-user deployment.

Next: execute T9 — reconcile all debt statuses against observed proof, run the final full gates,
update DEBT/verification/status records, commit and push without force.
