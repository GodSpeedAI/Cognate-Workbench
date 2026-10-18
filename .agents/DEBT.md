# Evidence-backed deferred work

Native Experts & Teams release, 2026-10-13. These limits are explicit; none is represented as a
working feature. See `docs/known-gaps.md` and `docs/experts-verification.md`.

| Debt | Evidence and current behavior | Condition for closing |
| --- | --- | --- |
| Autonomous scheduled work — Partially closed — specific remaining limitation | Native Expert/Team schedule evaluator and UI execute real runs; PostgreSQL SIGKILL/restart, recurrence, failure, cancellation and read-only approval tests pass. Legacy workflow intent remains separate; distributed evaluator ownership is still open. | Supported distributed schedule-evaluator ownership and deliberate legacy workflow migration |
| Parallel Expert dispatch — Partially closed — specific remaining limitation | Published SDK0.6.1 is consumed after all45 registry receipts/fresh-consumer proof. Conflict-aware per-resource workspace/world keys (T1) overlap disjoint workspaces and serialize shared ones; authoritative model-only admission reaches actual app peaks1/2/4/8 with unique handoffs; Team admission/batching resolves from authoritative Team limits (T2); default capacity1. | Profiling of the measured capacity8 throughput regression; see docs/experts-concurrency-benchmark.md |
| Live inter-Expert steering — Partially closed — specific remaining limitation | Shared Team inbox now incorporates authorized messages at native recorded decision boundaries, with ordered receipts, ownership, limits and SIGKILL replay evidence. | Generalized SDK inbox and standalone live steering; no arbitrary inference interruption claim |
| Memory scaling and token accounting — Closed — verified | Bounded immutable partitions, tested migration/erasure, scoped cursor pages, measured write reduction, indexed SQL retrieval and fingerprinted global root CAS (T4), model-specific tokenization, durable crash-reconciled billing reservations and fail-closed session/global ceilings (T5) all pass. | Live aggregate memory accounting and multi-tenant application seeding |
| Multiple Workbench processes — Closed — verified | Supported durable distributed run ownership is published (T6) and consumed (T7) behind the verified runOwnership: multi-process configuration; the two-process crash/stale-writer journey passes against actual PostgreSQL. Default is single-process; exactly-once physical effects are not claimed (commitments plus reconciliation remain the contract). | — |
| Production trust boundary — Partially closed — specific remaining limitation | Durable revocable sessions are the default posture (T8) with tenant isolation, aggregate containment across processes, hardened headers/CSP and an independent adversarial security review with all MUST-fix findings remediated. | Production-hardened multi-user deployment, multi-tenant application seeding, live aggregate memory accounting and the review's residual boundaries |
| DomainForge formatter — Closed — verified | The installed 0.19.0 already contains upstream fix `5feeb93`; the recorded difference was canonical formatting, not semantic corruption. `test/sea-format.test.ts` proves AST/comment retention, validation and idempotence; formatting check passes. | Regression gate and upstream four-test evidence: `.sea/interaction/validation/formatter-fidelity.md` |

The exhaustive dispositions and shared dependencies are tracked in `docs/experts-debt-closure.md`.
This mission remains incomplete. Upstream source changes are not Workbench integration until a
supported release is consumed and its journeys pass. Multi-process operation is verified behind
explicit configuration (T7); no production-hardened multi-user closure is claimed.

### E2E screenshots wait on remote web fonts and flake offline

- Date: 2026-10-15
- Location: test/E2E-experts-debt.test.ts (page.screenshot calls); src/server.ts indexHtml preloads fonts.googleapis.com
- Debt: Playwright screenshots internally wait for `document.fonts.ready`; when the remote Google Fonts request hangs on a restricted network, the screenshot times out and an otherwise healthy suite run fails. The app already unblocks startup from remote fonts, but the test-side screenshot wait remains network-sensitive, so `just verify` is intermittently red for reasons unrelated to product behavior.
- Evidence: full `just verify` on 2026-10-15 reported `(fail) a human live update is pending during inference and incorporated into the next Team decision [15490.08ms]` with `TimeoutError: screenshot: Timeout 10000ms exceeded - waiting for fonts to load...`; the same file passes standalone immediately afterward (3 pass / 0 fail).
- Confidence: high
- Closure: Route-block fonts.googleapis.com/gstatic.com in the E2E browser contexts (deterministic fast failure) or otherwise make screenshot capture font-independent; files likely touched: test/E2E-*.test.ts helpers; size S.

### Full-suite E2E/journey flakes under host concurrency

- Date: 2026-10-18
- Location: test/E2E-*.test.ts and several test/J-*.test.ts under the default parallel `bun test`.
- Debt: On a co-tenanted host the default parallel suite intermittently fails 1–8 tests per run with a rotating identity (E2E Experts and Teams, E2E remote-workspaces SSH, E2E cognitive console, J-CFG-model-provider, J-CFG-model-catalog, J-PREFS-shortcuts, J-E-plan, J-H-provider-error), each timing out at or near its deadline; every one passes in isolation. The cause is host resource starvation (shared PostgreSQL store plus CPU), not product behavior.
- Evidence: full runs on 2026-10-18 — plain `just verify` reported 1,177–1,178 pass / 9 skip / 1–8 fail with the failing set differing run to run; the same suite at `--max-concurrency 4` dropped to 0–1 fail; each named failing file passed 2–3× standalone. A pre-fix full run at `--max-concurrency 4` showed only the one genuine race below.
- Confidence: high
- Closure: Cap suite/E2E concurrency for constrained hosts (e.g. set `--max-concurrency` in the test script) or run the gate on an idle host; size S.

### E2E-experts save→reopen editor race (fixed 2026-10-18)

- Date: 2026-10-18
- Location: test/E2E-experts.test.ts (save → reopen Edit).
- Debt (resolved): after "Save Expert" the test waited on a heading that already existed, then reopened the editor before the `experts` projection folded the new instructions. `ExpertEditor` snapshots `initial` in a `useState` initializer at mount and never re-syncs, so a stale projection left `#expert-instructions` showing the old text and the wait timed out. Under load the save→projection gap widened, surfacing the race.
- Fix: wait until the `experts` projection row contains the saved instructions (`waitUntil` + `app.runtime.service.readProjection`) before reopening the editor.
- Evidence: 3/3 passes under a synthetic 3-hog CPU load (previously failed repeatedly at the reopen step); absent from two subsequent full runs.
- Confidence: high
