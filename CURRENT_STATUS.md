# Current status — revision 24

The remaining-debt tranche plan has settled **T0, T1 and T2**; the active task is T3 (capacity
settlement). T0 recorded the baseline (1,153 tests), the workspace-effect conflict inventory and
the refreshed capacity benchmark whose earlier capacity-8 regression did not reproduce.

T1 (conflict-aware workspace-effect admission) replaces the single global workspace-effects
exclusion key with canonical per-resource keys derived from authoritative state:
tool-bearing Expert work keys by its Assignment's workspace, coding sessions and subagents by their
validated workspace record, configuration runs key configuration plus the exact records they name,
world mutators enumerate the workspaces they affect, and unknown/forged identities fail closed to
the unchanged global key. Actual PostgreSQL journeys prove disjoint-workspace overlap at capacity
two, alias collision on one key, forged-identity denial and restart survival; a real Chromium
journey shows two visible tool-bearing Expert results bound to two different workspaces.

T2 (Team admission/batching policy) resolves from authoritative Team metadata only:
`maxConcurrentRuns` (1–8) and `admissionBatch` (1–8) bound each Team's concurrent runs and
dispatch batches. A Team exceeding its policy waits even when host capacity is free (proved at
capacity four with three free slots), the Team editor and runtime inspection state the effective
policy and serialized reasons, and client-supplied policy fields are refused on converse.

Journeys: `test/J-EXPERT-workspace-admission.test.ts` (4), `test/J-TEAM-admission.test.ts` (2),
`test/E2E-expert-workspace-admission.test.ts` (1), `test/E2E-team-admission.test.ts` (1), unit
coverage in `test/expert-admission.test.ts` (11). Evidence is recorded in
[experts-debt-verification](docs/experts-debt-verification.md) and the
[verification log](docs/experts-debt-closure.md). Known boundaries: admission stays process-local
by SDK contract; a key-waiting run occupies one bounded dispatch slot; local bash/run_code are not
OS-contained; cross-process Team fairness is not claimed. Dev bearer authentication remains a known
single-operator limitation.

Remaining open: capacity-8 throughput settlement (T3); indexed retrieval and the global root CAS
(T4); exact tokenization, durable billing reservations and budget ceilings (T5); upstream run-write
ownership (T6) and Workbench multi-process integration (T7); production identity/tenant isolation,
aggregate containment and independent security review (T8); the final adversarial reconciliation
(T9); generalized SDK inbox/standalone live steering; and the explicit product debts in the
disposition matrix.

Next: execute T3 — re-run the capacity benchmark across 1/2/4/8 with the T1/T2 policies and record
the cause attribution as either repaired or an accepted measured limit.
