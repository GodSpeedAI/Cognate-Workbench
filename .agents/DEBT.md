# Evidence-backed deferred work

Native Experts & Teams release, 2026-10-13. These limits are explicit; none is represented as a
working feature. See `docs/known-gaps.md` and `docs/experts-verification.md`.

| Debt | Evidence and current behavior | Condition for closing |
| --- | --- | --- |
| Autonomous scheduled work — Partially closed — specific remaining limitation | Native Expert/Team schedule evaluator and UI now execute real runs; PostgreSQL SIGKILL/restart, recurrence, failure, cancellation and read-only approval tests pass. Legacy workflow intent remains separate; one process only. | Supported distributed ownership and deliberate legacy workflow migration |
| Parallel Expert dispatch — Partially closed — specific remaining limitation | Workbench installed SDK still serializes. Isolated upstream tests demonstrate bounded capacities 1/2/4/8, resource contention, cancellation, continuations and PostgreSQL. | Publish supported SDK contracts and verify Workbench eligibility/UI integration |
| Live inter-Expert steering — Partially closed — specific remaining limitation | Shared Team inbox now incorporates authorized messages at native recorded decision boundaries, with ordered receipts, ownership, limits and SIGKILL replay evidence. | Generalized SDK inbox and standalone live steering; no arbitrary inference interruption claim |
| Memory scaling and token accounting — Partially closed — specific remaining limitation | Bounded immutable partitions, tested migration/erasure, scoped cursor pages, measured write reduction and frozen Expert invocation budgets work. | Global root CAS, indexed retrieval, exact tokenization, pre-dispatch crash/billing reservations and ordinary-session/global budgets remain |
| Multiple Workbench processes | Native effect dispatch fails closed without the owning live run context; one Bun process is supported. | A supported durable distributed effect lease/dispatch contract with crash tests |
| Production trust boundary | Existing development authenticator and best-effort shell guards remain; Expert capability gates are not OS isolation. | Separate authenticated multi-user and sandbox hardening work |
| DomainForge formatter — Closed — verified | The installed 0.19.0 already contains upstream fix `5feeb93`; the recorded difference was canonical formatting, not semantic corruption. `test/sea-format.test.ts` proves AST/comment retention, validation and idempotence; formatting check passes. | Regression gate and upstream four-test evidence: `.sea/interaction/validation/formatter-fidelity.md` |

The exhaustive dispositions and shared dependencies are tracked in `docs/experts-debt-closure.md`.
This mission remains incomplete. Upstream source changes are not Workbench integration until a
supported release is consumed and its journeys pass. No production or multi-process closure is claimed.
