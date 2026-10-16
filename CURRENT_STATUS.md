# Current status — revision 23

The remaining-debt tranche plan is executing: **T0 (baseline, workspace-effect conflict inventory
and benchmark refresh) is settled.** A fresh `just verify` on the clean fdc709b tree passed 1,153
tests (1,147 pass, 6 skip, 0 fail, 7,408 assertions) across 105 files in 583.82 s.

The active mission plan is [20261015_remaining-debt-tranches](.agents/plans/20261015_remaining-debt-tranches.plan.yaml)
(A2 workspace concurrency → A4 retrieval/economics → A5 upstream run ownership → A6 production
trust); its predecessor [20261014_experts-debt-closure](.agents/plans/20261014_experts-debt-closure.plan.yaml)
is settled. All debts remain reconciled in [verification](docs/experts-debt-verification.md).

T0 evidence ([concurrency benchmark](docs/experts-concurrency-benchmark.md)): the conflict inventory
names all 11 mutating workspace-effect surfaces with the canonical resource identity each requires
(workspace, execution world, configuration) and the authoritative record that identity derives from;
identities are looked up in authoritative state, so forged or aliased identities fail closed to the
global exclusion key. The capacity 1/2/4/8 characterization was refreshed with four fresh sweeps
(median elapsed 5643.9 / 4985.1 / 5064.5 / 5151.9 ms) — the previously recorded capacity-8
regression did not reproduce (capacity 4 and 8 ranges overlap; 1.7 % median gap). A new instrumented
attribution test rules out full context materialization (0.03 % of elapsed) and attributes 62–64 %
of elapsed to Experts-registry shared-state reads and aggregate CAS commits, with nearly all CAS
conflicts (48/49 at capacity 8, 44/45 at capacity 4) concentrated in concurrent assignment
submission. That structural cost is capacity-independent and is what the A4 retrieval/CAS tranche
targets.

Unchanged from revision 22: published Cognate 0.5.0 is fully consumed (45 packages, complete registry
audit, no local links), native model-only admission reaches actual peaks 1/2/4/8, and the
contained-workspace slice passes its real OS/browser journeys. Dev bearer authentication remains a
known single-operator limitation.

Remaining open (next tranches): conflict-aware per-resource workspace admission (T1, in progress)
and Team admission/batching (T2); capacity settlement (T3); indexed retrieval and the global root
CAS (T4); tokenization, durable billing reservations and budget ceilings (T5); distributed
run-write ownership (T6/T7, one process only today); production identity/session/tenant isolation,
aggregate resource quotas and independent security review (T8); generalized SDK inbox/standalone
live steering; and the explicit product debts in the disposition matrix.

Next: execute T1 — replace the single global workspace-effects exclusion key with canonical
per-resource keys derived from authoritative state, with actual PostgreSQL overlap/exclusion/denial
and restart journeys plus browser evidence.
