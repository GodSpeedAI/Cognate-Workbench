# Evidence-backed deferred work

Native Experts & Teams release, 2026-10-13. These limits are explicit; none is represented as a
working feature. See `docs/known-gaps.md` and `docs/experts-verification.md`.

| Debt | Evidence and current behavior | Condition for closing |
| --- | --- | --- |
| Autonomous scheduled work | `src/workbench/automation.ts` records intent; no durable background executor fires it. No schedule UI was added. | Native durable due-work execution with restart, cancellation and idempotency journeys |
| Parallel Expert dispatch | `test/experts-runtime-scheduling.test.ts` observes maximum one active run in the installed SDK. Teams serialize. | Supported isolated runtime concurrency, tested before exposing parallel workers |
| Live inter-Expert steering | `ExpertsService` durably queues addressed messages for the next authorized Assignment. | A supported Cognate live-inbox contract with durable recovery and authority checks |
| Memory scaling and token accounting | Scoped lexical retrieval and character budgets work; the registry remains one CAS aggregate. | Evidence-backed partitioning/pagination, token-aware selection or embeddings when needed |
| Multiple Workbench processes | Native effect dispatch fails closed without the owning live run context; one Bun process is supported. | A supported durable distributed effect lease/dispatch contract with crash tests |
| Production trust boundary | Existing development authenticator and best-effort shell guards remain; Expert capability gates are not OS isolation. | Separate authenticated multi-user and sandbox hardening work |
| DomainForge formatter — Closed — verified | The installed 0.19.0 already contains upstream fix `5feeb93`; the recorded difference was canonical formatting, not semantic corruption. `test/sea-format.test.ts` proves AST/comment retention, validation and idempotence; formatting check passes. | Regression gate and upstream four-test evidence: `.sea/interaction/validation/formatter-fidelity.md` |

The next tranche's exhaustive dispositions and shared architectural dependencies are tracked in
`docs/experts-debt-closure.md`. The six other primary rows remain open; upstream source changes
are not Workbench integration until a supported release is consumed and its journeys pass.
