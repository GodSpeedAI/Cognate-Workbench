# Experts debt tranche — verification and publication report

Recorded 2026-10-14. **The full mission is incomplete.** This report settles the verified slices below;
it does not close all seven mandatory debts or advertise production/multiprocess operation.

## Architecture and dependency outcome

Cognate-Workbench remains the same application on `feature/expert-teams`, using published Cognate
**0.2.0**, PostgreSQL/pg0, native events, shared-state CAS, continuations, commitments and projections.
No local SDK link, vendored runtime, broker, second event store or new Workbench dependency was added.
The default five Experts and sole Product Manager Orchestrator remain ordinary editable seed records.

Schedules define due intent; the existing native Assignment bridge and Cognate run outbox execute
it. Live inbox incorporation is a recorded capability at a deterministic decision boundary. Both
reuse frozen assignment identity/authority, cancellation and handoff evidence. Immutable bounded
partitions prepare before the registry manifest CAS; public projections are sanitized and internal
cache/metadata rows are not exposed. Budget checks run before the isolated per-Expert provider call.

The dependency graph and exhaustive historical inventory are in
[experts-debt-closure.md](experts-debt-closure.md). Single-process schedule/inbox slices could use
the already-supported SDK contracts without waiting for distributed ownership. Parallel and
distributed integration remain separately gated; the plan records that narrower dependency.

## Every primary debt

| Debt | Disposition | Observed change and exact remaining limitation |
| --- | --- | --- |
| A1 Autonomous schedules | **Partially closed — specific remaining limitation** | Native Expert/Team one-time/daily/weekly schedules execute after restart, with IANA/DST rules, stable occurrence/Assignment IDs, bounded skip/coalesce, cancellation, failure and approval receipts, and real UI. Legacy accepted-workflow automation records are not automatically migrated. One process only; schedule history remains an aggregate. |
| A2 Parallel Experts | **Partially closed — specific remaining limitation** | Upstream native capacities 1/2/4/8, resource eligibility, cancellation, continuation and PostgreSQL tests pass. Workbench still uses serial 0.2.0; reviewed supported SDK publication and application eligibility/UI integration remain required. |
| A3 Live steering | **Partially closed — specific remaining limitation** | Shared Team messages are durably accepted and incorporated at safe model-decision boundaries, with sequence, ownership, supersession/cancellation, bounds and SIGKILL replay. Idle delivery retains the existing queue. Generalized SDK inbox and standalone live steering remain open. No arbitrary inference interruption. |
| A4 Memory and economics | **Partially closed — specific remaining limitation** | Bounded immutable partitions, interrupted migration, erasure invalidation, scoped cursor pages, measured write reduction and frozen Expert attempt budgets work. Global root CAS, complete materialization, indexed SQL retrieval, model tokenization, pre-dispatch crash/billing reservations and ordinary-session/global budget ceilings remain open. |
| A5 Multiple processes | **Still open — not implemented** | Fenced native outbox claims are an upstream prerequisite only. Run-write fencing, authoritative store-time ownership, worker compatibility, two-process fault injection and ambiguous-effect recovery are not implemented. No multiprocess mode is exposed. |
| A6 Production trust | **Still open — not implemented** | Upstream opt-in Linux child-process namespace ports pass real adversarial tests. They are not consumed by Workbench. Production identity/session/tenant integration, aggregate resource containment, supported deployment and independent security review remain open. Development bearer authentication is unchanged. |
| A7 Formatter fidelity | **Closed — verified** | Installed DomainForge 0.19.0 already contains the upstream fix. Canonical formatting preserves normalized AST and comments, validates, is idempotent, and passes `fmt --check`. No duplicate upstream patch or CLI version change was needed. |

All adjacent findings remain in the exhaustive disposition matrix. Closed items include explicit
cognitive semantic bindings and fabricated child-usage zeros. Historical `NOT_IMPLEMENTED` findings
are reconciled against already-working T11 controls and their tests. Generic subagent returns,
executor routing, capability substitution, ordinary tool recovery, global Board/evidence navigation,
artifact fidelity and other unimplemented product journeys remain explicit; hiding a control did
not close them.

## Canonical journeys and key files

- J-SCHEDULE-CREATE/FIRE/RECOVER: `src/schedules/{types,service,evaluator}.ts`, native server lifecycle
  and four explicit bindings; schedule create/manage/history/inspection UI.
- J-EXPERT-STEER/INBOX-RECOVER: `src/experts/service.ts`, `src/agents/agentCoding.ts`, ordered inbox
  receipts and native safe boundaries; pending/incorporated/cancelled/superseded/late UX.
- J-MEMORY-MIGRATE/PAGINATE: `src/experts/{persistence,pagination,state}.ts`,
  `src/projections/experts.ts`, governed public read filtering, bounded history/memory controls.
- J-CONTEXT-BUDGET: `src/experts/economics.ts`, `src/capabilities/expertModel.ts`, frozen assignment
  limits, Expert editor and `AssignmentUsage.tsx`.
- Existing J-COG journeys: validated model concepts, twenty bindings in `domain/index.ts`, native
  invocation SemanticRef evidence and existing human-only cognitive gates.

The authoritative model, canonical catalog, source translation and handoff are updated in
`.sea/interaction/`. The adapter loads **222 semantic objects**; all **27 Expert**, **four schedule**
and **twenty cognitive** contracts resolve. Existing semantic IDs and the inherited namespace remain.

## Measurements

Environment: Bun 1.4.0, PostgreSQL 18.1/pg0, WSL2 Linux 6.18.54.1 x64, Intel Core Ultra 5 226V,
six reported CPUs and 8.33 GB reported RAM. These are small local measurements, not capacity promises.

| Workload | Before | After |
| --- | --- | --- |
| 917,487-byte logical registry; four single-writer operations | 3.62/s; p50/p95 231/453 ms; about 3.68 MB persisted payload | 4.07/s; 219/293 ms; 172,772 bytes |
| Same registry, configured writer concurrency four | 0.81/s; 2,858/4,958 ms; six CAS conflicts | 2.72/s; 942/1,470 ms; six conflicts; 43,974 committed payload bytes |
| 8.49 MB partitioned registry; four single-writer operations | Exceeds the former 1 MiB event envelope | 2.08/s; 490/593 ms; 200,392 payload bytes; peak RSS about 606 MB; restart/rebuild 906 ms |
| Upstream eight independent 40 ms native steps, capacity 1/2/4/8 | Default serial | Observed maxima 1/2/4/8; about 331/166/86/45 ms |

Datasets, commands, writer-count caveats and scope/quality checks are in
[experts-scale-baseline.md](experts-scale-baseline.md). Four mutations cannot establish a universal
latency distribution. Root contention and full materialization remain measured limitations.

## Failure, recovery and security evidence

- A real scheduled read-only Bash write initially succeeded unexpectedly. The tool loop now opens
  Cognate's protected approval continuation before edit/Bash/run_code; the regression verifies the
  waiting event and absence of the file. This permission fix is not OS containment.
- Schedule tests terminate a server subprocess before due, start a fresh process after due, and
  observe one logical occurrence, Assignment, run and correlated result. Recurrence, duplicate
  ticks, revision/cancellation races, restart cancellation, provider failure and bounded retries
  are tested. Current revision/status is checked at acknowledgment; late native acceptance is
  cancelled rather than resurrecting cancelled intent.
- Inbox recovery kills the process after its registry receipt commits but before the invocation
  outcome is persisted. Restart incorporates that ordered batch once logically. Second-user
  supersession/cancellation attempts are rejected. Final-boundary arrivals remain late evidence.
- Migration prepares a >5 MiB schema-1 fixture, injects failure before root publication, then
  migrates/restarts and verifies identities, scope, history and Team invariants. Missing/hash-invalid
  source fails closed. Native erasure invalidates accepted public state after projection catch-up;
  there is no private-payload cache that hides erasure.
- Six concurrent membership updates exposed a real SDK PostgreSQL pool deadlock. The owner held
  the position-counter transaction lock while trying to obtain an extra pooled connection for a
  duplicate receipt. Upstream now reads that receipt through its transaction executor. A saturated
  two-connection/twenty-same-key test fails before the fix and passes afterward. Workbench also
  coalesces identical immutable preparation traffic without replacing native durability. Its
  original membership test passes five repetitions with unchanged assertions and timeout.
- Upstream fenced claim tests reject stale generations and mixed legacy-API settlement. Old
  binaries issuing older SQL are not magically fenced; supported worker-version admission is
  still required. Fencing does not revoke an external request already delivered.
- Real Linux tests prove workspace filesystem access, symlink/host-secret refusal, denial of an
  otherwise reachable host TCP listener, nested user-namespace refusal, nested Bun containment,
  timeout/abort descendant cleanup, output limits and changed-binary refusal. The patched distro
  build and its SHA are verified. No aggregate CPU/memory/process/disk quota is claimed. Binding
  sensitive data as a workspace grants that data; host application code remains trusted.
- Existing frozen authority, private/cross-Team memory, independent verification, human-only
  acceptance, durable handoff and ambiguous Expert effect regressions pass in the full suite.

There is no exactly-once physical external-effect claim. Ambiguity requires native receipts,
idempotent reconciliation or a human decision. No production-ready or authenticated multi-tenant
deployment has been established.

## Commands and results

| Command | Observed result |
| --- | --- |
| Initial `just verify` | 1,064 pass, zero fail, 6,536 assertions/85 files; 407.91 s |
| Final integrated `just verify` | **1,101 pass, zero fail, 6,860 assertions/96 files; 381.67 s**, including typecheck |
| `just typecheck` | Pass |
| Focused native debt suite (eleven files) | 41 pass, zero fail, 303 assertions |
| Inbox ownership/schedule race suites | 18 pass, zero fail, 96 assertions |
| `bun test --rerun-each 5 test/J-EXPERT-management.test.ts` | 15 pass, zero fail, 75 assertions |
| Economics/SEA/binding/schedule render narrow gate | 11 pass, zero fail, 87 assertions |
| UI narrow gate | 13 pass, zero fail, 69 assertions |
| New Chromium schedule/usage and live-inbox journeys | Pass on real native capabilities; desktop/mobile screenshots retained |
| `domainforge fmt --check .sea/interaction/interaction-model.sea` | Already formatted |
| `domainforge validate --format human .sea/interaction/interaction-model.sea` | Zero violations |
| DomainForge upstream formatter fidelity tests | Four pass |
| Upstream Cognate `just verify` | Final isolated run 81/81 gates pass, exit zero, about 49 seconds |
| Upstream events/memory/SQLite; PostgreSQL conformance | 73 pass; 29 pass |
| Upstream complete PostgreSQL adapter suite | 42 pass, zero fail, 193 assertions |
| Upstream saturated-pool regression, three repetitions | Three pass, zero fail, twelve assertions |
| Upstream runtime/service/continuations | 96 pass, zero fail, 373 assertions after final startup compatibility guard |
| Upstream events/continuations/runtime after CodeRabbit fixes | 225 pass, zero fail, 772 assertions; seventeen optional external CEP tests skipped |
| Mixed run/resume claims at capacities one/two | Before: two/four outstanding claims; after: bounded at one/two with all deliveries settled once |
| AG-UI shared-state stress regression | Before: two failures in 100 repetitions; after awaiting settled SSE streams: 100 tests / 160 assertions pass |
| `COGNATE_BWRAP_TESTS=1 bun test --timeout 15000 packages/execution/test/bubblewrap.test.ts` | Ten pass, zero fail, 29 assertions; actual OS namespaces |
| Upstream documentation gate | Five pass, zero fail, 26 assertions |
| `git diff --check` | Pass |

The earlier full-suite failure was retained and diagnosed, not hidden by a larger timeout.
Initial browser locator failures and a font-load wait were corrected; reruns and the final full
suite pass. Unprivileged fixture failures were sandbox access denials; authorized real-store/OS
tests supplied the observed evidence. Optional skipped OS tests are not counted as containment proof.

Final scope review also bound cached transcript/history/memory pages to their selected conversation,
Expert and Team/query, so late reads cannot display previous-scope content under a new selection.
The new native browser sentinel test verifies Expert and Team memory switching. A deliberately held
Google Fonts response reproduces the former bootstrap timeout; nonblocking optional stylesheet
preloading makes that same test pass in about four seconds without extending timeouts. All 1,101
tests pass after these fixes. The shorter full-suite time is one local run, not a general latency claim.

## Commits, branches and release boundary

Workbench implementation commits:

- `42f4819` — formatter fidelity and canonical formatting.
- `07df49e` — dependency/debt disposition plan.
- `a4d6201` — native schedules, live inbox, partition migration/pagination, budgets and journey tests.
- `8169975` — native UX, observed usage, responsive evidence and browser journeys.
- `e88bdf4` — debt evidence, benchmarks and documentation reconciliation.
- `7ecc4a0` — scoped cached-view guards and nonblocking optional font bootstrap.

The authorized Workbench branch is `feature/expert-teams`; final documentation/status publication
is recorded in its Git history. Upstream branch `feature/durable-dispatch-debt` is pushed with:

- `ab4dd2a` — fenced native dispatch, bounded run admission and PostgreSQL replay fix.
- `920c4c9` — opt-in Linux execution world and regression gates.
- `06a520b` — fail-fast secret and actually reachable network-denial evidence.
- `48ad057` — precise old-writer and workspace-content compatibility limits.
- `a0b462a` — complete upstream verification/publication checkpoint.
- `a59a7da` — reject unfenced injected stores before opening a parallel runtime; 96 tests/373 assertions.
- `7221260` — release only uncommitted duplicate position reservations; following fact retains position two.
- `7d9b80f` — PostgreSQL replay and release checkpoint.
- `52a8eaf` — shared run/resume admission, worker settlement/error regression and actual file-existence check.
- `ff505ae` — remove independent GitHub reviewer gate per operator instruction; repair evidence documentation map.
- `033029d` — await settled AG-UI streams, retain failed gate diagnostics; all 81 local gates and exact-head CI/packaging pass.

[Cognate PR #42](https://github.com/GodSpeedAI/Cognate/pull/42) is ready for final operator
authorization at exact head `033029d2be29fc3982dc4ac9de963a93ab266f90`:

- [CI verification](https://github.com/GodSpeedAI/Cognate/actions/runs/38636836131/job/116102034362)
  succeeded at 2026-10-14 21:02:27 UTC.
- [Pack and clean-room installation](https://github.com/GodSpeedAI/Cognate/actions/runs/38636835958/job/116102033155)
  succeeded at 21:01:21 UTC.
- CodeRabbit status succeeded; the known actionable findings are corrected and regression-tested.
  No new review was submitted on this exact head; a successful bot status is not a fresh review.
- Read-only registry checks find all 45 linked names at latest 0.3.0. Release run `38300385888`
  reports successful publication for every name and readiness variable is true. The historical
  nine-package gap is resolved; no current missing publication was found.

Future linked npm publication remains non-atomic. Revalidate the approved release version and all
package publications, and use documented exact-version recovery for any failure. No atomic external
publication or exactly-once physical effect guarantee is claimed. Outbox fencing remains distinct
from distributed run-write fencing; Linux child containment remains distinct from production trust.
No new SDK release is claimed. Workbench still pins published 0.2.0; the observed upstream 0.3.0
release does not contain these new contracts. No DomainForge source change or release was required.

The original sibling Cognate status modifications remain untouched. Temporary source is never a
production dependency; provenance survives in upstream commits/PR and this report. Cleanup and
push receipts are recorded in the latest development status.

Workbench through documentation commit `e88bdf4` was pushed successfully without force. The clean
SDK task worktree was removed at checkpoint `a0b462a`, then reopened for the admission guard,
PostgreSQL ordering regression and CodeRabbit corrections. It currently remains at the pushed
upstream branch for review and CI follow-up. The prior DeepSeek donor is absent and no donor files
are indexed. Other donor directories and sibling working changes were preserved. Unsupported
legacy/custom stores now fail at parallel startup rather than leaving accepted work queued.

The operator explicitly removed the independent GitHub reviewer requirement. Remaining release
gates are verified actionable CodeRabbit fixes, green latest-head CI and clean-room packaging,
linked-package release readiness, documented limits and final operator authorization before merge
or publication. No reviewer-access change is needed. These gates do not imply the still
unimplemented ownership, authentication or retrieval work is already done.

## Remaining prerequisites and smallest next actions

1. Obtain final operator merge/release authorization now that exact-head SDK checks pass.
   Requested Luna workers resumed and completed the
   CodeRabbit and release audit after an earlier service usage limit; unperformed security work
   remains unclaimed.
2. Review the concrete upstream PR and follow Cognate's linked-version Release Please/npm workflow.
   Then install the genuinely published version and rerun Workbench eligibility, concurrency,
   compatibility and containment journeys. Do not substitute a local SDK checkout.
3. Implement native run ownership and transactional fencing using authoritative store time,
   worker-version admission and commitment ambiguity handling; pass actual two-process crash tests
   before exposing multiprocess operation.
4. Implement authenticated durable identities, session revocation and end-to-end tenant/workspace
   authorization; complete enforceable resource containment and independent security review.
5. Close indexed retrieval/model-tokenization/global-budget and remaining workflow/product gaps
   against the exhaustive matrix, with the same model/binding/journey/evidence discipline.

These are unfulfilled acceptance conditions, not a successful mission declaration. The plan remains
in progress and the debt entries remain present.
