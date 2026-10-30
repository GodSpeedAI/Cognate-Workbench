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

### `ChatMessage.steps` doc comment points at a `known-gaps.md` entry that does not exist

- Date: 2026-10-26
- Location: src/ui/App.tsx:151-157 (doc comment on `ChatMessage.steps`).
- Debt: The comment states the per-step snapshot is not persisted across reload/session-switch and cites `docs/known-gaps.md` for it, but `docs/known-gaps.md` contains no entry about per-step detail, `message.steps`, or the Verbose fallback. A reader chasing the behavior finds nothing, and the limitation is therefore undocumented in the file that is supposed to hold known limitations. The underlying behavior is real: `src/capabilities/sessionHistory.ts:53` returns only `stepCount`, so a reloaded turn always folds even under Workbench "Verbose".
- Evidence: `grep -n 'reload\|session.history\|Verbose\|per-step\|folded' docs/known-gaps.md` returns only an unrelated projection-amplification row at :195; `grep -n 'stepCount' src/capabilities/sessionHistory.ts` returns :40 and :53 (message built with `stepCount: toolCallCount + 1`, no per-step array).
- Confidence: medium
- Closure: Either add the missing `docs/known-gaps.md` row (per-step tool detail is not persisted; Verbose folds after reload) or drop the citation from the comment; files likely touched: docs/known-gaps.md, src/ui/App.tsx; size S.

### `steer.enqueue({mode:"queue-next"})` writes a channel nothing drains

- Date: 2026-10-26
- Location: src/workbench/steering.ts:47-52,71 (`enqueue` nextTurn branch, `drainTurn`); src/capabilities/workbench.ts:528-540; src/workbench/reducer.ts:178-188.
- Debt: The durable next-turn queue is write-only. `steer.enqueue` with `mode:"queue-next"` appends to `inbox.nextTurn`, the reducer folds `workbench.steer.enqueued` into the `inbox/` projection, and `steer.pending` returns it as `queued` — but no production code reads `nextTurn` for delivery. The agent's boundary hook reads only `pending.steer` (`inbox.nextStep`, src/agents/agentCoding.ts:480), and `drainTurn`, the function that would hand a queued message to the run, is called from nowhere outside `test/workbench-steering.test.ts`. Consequence: a caller that queues this way persists a message that is acked, displayed as queued, and never delivered, and the unit tests pass because they test the function rather than the wiring. This blocks the "durable composer queue" affordance: repointing the UI at it uncritically would regress against today's in-memory ref, which does send once the run goes idle (src/ui/App.tsx:5160-5167).
- Evidence: `grep -rn 'drainTurn' src/` returns only its definition at src/workbench/steering.ts:71; `grep -rn 'drainStep' src/` likewise returns only src/workbench/steering.ts:57 (both are referenced solely by test/workbench-steering.test.ts). `grep -rn 'nextTurn' src/` outside src/workbench/steering.ts returns only src/workbench/reducer.ts:188 (prune-by-consumed-id), src/capabilities/workbench.ts:539 (`steer.pending` return value) and src/capabilities/workbench.ts:538 (the read). The agent's only injection site is src/agents/agentCoding.ts:480, which reads `pending.steer` only. The gap is also asserted as intended by test/J-WB-steering.test.ts:55 ("Queue-next was not consumed; it still waits for the next turn").
- Confidence: high
- Closure: Give `nextTurn` the same consumption path `nextStep` already has — read it from `steer.pending().queued` and, when injected as the next user turn, emit `workbench.steer.consumed` for its id (the reducer already prunes both queues by consumed id, src/workbench/reducer.ts:188) — then repoint the composer queue at the capability and derive the rendered queue from the `inbox/` projection. Do not adopt `drainTurn`/`drainStep` for this; they have no production callers and would fork a second consumption mechanism. This changes agent execution behaviour (an extra turn can appear mid-session), so it needs its own replay/idempotency analysis. Files likely touched: src/agents/agentCoding.ts, src/ui/App.tsx (plus a decision on the now-dead drain helpers); size M.

### `E2E-remote-workspaces` waits for only two of the WSL form's three states

- Date: 2026-10-26
- Location: test/E2E-remote-workspaces.test.ts:135 vs. src/ui/RemoteWorkspaceForm.tsx:250-262.
- Debt: The WSL step of the Add-workspace dialog has three terminal states, but the E2E test waits for only two. `RemoteWorkspaceForm` renders: "Looking for WSL distributions…" while the probe is pending; "WSL did not respond…" plus a Try again button when `reason === "not-responding"`; "WSL isn't available on this machine…" otherwise; and a `<select aria-label="WSL distribution">` when distros exist. The test's locator is `select[aria-label="WSL distribution"], :text("isn't available")`, which matches the last two but not the "did not respond" state. On a host where the WSL probe returns no usable list the test burns its full 15s and fails. This is a test-fidelity gap rather than a product bug — the UI does explain the not-responding case — but it makes the suite red for environmental reasons and can mask real regressions.
- Evidence: `cd /tmp/baseline-wb && bun test test/E2E-remote-workspaces.test.ts` on unmodified `6fc51ab` fails with `TimeoutError: waitFor: Timeout 15000ms exceeded` on exactly that locator, so the failure predates this branch. The host does expose WSL (`/mnt/c/WINDOWS/system32/wsl.exe` is present and `wsl.exe -l -q` exits 0, listing Ubuntu-26.04 and Ubuntu-24.04), which is why the not-responding state is reachable here at all.
- Confidence: high
- Closure: Include the not-responding wording in the locator (or wait on a stable container and assert one of the three messages) so the test distinguishes "WSL absent" from "WSL did not answer". Files likely touched: test/E2E-remote-workspaces.test.ts, possibly src/ui/RemoteWorkspaceForm.tsx if a stable test id is preferred; size S.

### Several J-* integration tests boot three servers inside Bun's default 5s limit
- Date: 2026-10-26
- Location: test/J-I-work-details.test.ts (restart test); test/J-C-tool-execution.test.ts; test/J-WS-select.test.ts; test/J-EXPERT-MODEL-PARALLEL.test.ts (3 tests); test/J-CFG-model-catalog.test.ts; test/J-H-provider-error.test.ts; also the proof-source test emitting `workspace.proof.current`.
- Debt: These tests boot and stop two or three app servers in sequence (some against a shared SQLite file) inside bun's 5000ms default per-test timeout. On a loaded host they time out at 5000–5017ms even when run as a single file with no other `bun test` process running. They fail purely as a function of machine load, so a red suite does not distinguish a real regression from contention — and because the failures cluster in unrelated files, they invite the reader to suspect whichever change happens to be in flight.
- Evidence: On unmodified `6fc51ab` in a clean worktree, `bun test test/J-I-work-details.test.ts test/J-C-tool-execution.test.ts` fails with `(fail) J-I-work-details > Work details preference survives a runtime restart against the same store [5000.11ms]  ^ this test timed out after 5000ms.` Host load average was ~4.4 with an unrelated `du -s` at 44% CPU. The same file's sibling test passed at 4874ms in the same run, i.e. the whole file sits at the limit. The same tests pass inside a larger batch when the machine is quieter.
- Confidence: high
- Closure: Raise the timeout for these tests explicitly (a per-test timeout argument, or a shared `bootApp`-based helper with a documented budget) so the limit reflects the actual work — three server boots — rather than the default. Files likely touched: the listed test files, possibly test/helpers.ts; size S.


### E2E-experts second test is load-sensitive and fails on an unmodified tree
- Date: 2026-10-26
- Location: test/E2E-experts.test.ts:98 (`creates, edits and copies a routed Expert, then reopens solo and private history`).
- Debt: This test takes ~33–55s wall-clock (two Playwright journeys in one test) and fails under load in two different ways, which makes a red suite ambiguous: it looks like a UI regression and lands at a different line each time. Its failure signature is not stable, so grep-for-the-known-error triage does not identify it.
- Evidence: On the working tree it failed at line 111 (`getByRole("button", { name: "Experts and Teams" }).click()`) with `TimeoutError: click: Timeout 30000ms exceeded` and `<div class="modal-backdrop">…</div> intercepts pointer events`; run alone on the same tree it passes both tests (`EXIT:0`, 37s + 32s). On unmodified `6fc51ab` in a clean worktree, run alone, it failed at line 131 with `TimeoutError: waitForFunction: Timeout 30000ms exceeded` after 44s. Same test, three different outcomes, two of them on unmodified code.
- Confidence: high
- Closure: Split the two journeys into separate tests and reduce fixed 20s/30s waits so the duration reflects real readiness rather than a timeout budget; the modal-backdrop interception suggests the first journey leaves a dialog open when the second starts. Files likely touched: test/E2E-experts.test.ts; size M.

### Task checkouts are refused on local workspaces under the default contained posture, with an agent-effects message
- Date: 2026-10-27
- Location: src/capabilities/taskCheckout.ts (all Git capabilities via `providerFor` → `runGit`); src/ui/workbench/CheckoutChip.tsx openForm error surface.
- Debt: The checkout capabilities are operator actions, but they spawn `git` through the same execution-world provider path as agent effects. Under the default contained execution posture, a workspace whose world is `local` (uncontained) refuses `process.exec`, so `git.branch.list`, `git.checkout.attach` and the rest fail with the generic posture message ("Refused process.exec in uncontained world "local": … restart with COGNATE_EXECUTION_POSTURE=uncontained-local"). The refusal is honest and the journey tests (which run `uncontained-local`) never see it, but an operator on a default-posture boot who opens the isolate form gets an error aimed at agent effects, with no mention that task checkouts specifically require `uncontained-local` or a Linux-containment config that includes the repository and its sibling `-worktrees` directory (the worktree path must be writable inside the sandbox too).
- Evidence: Live walkthrough on commit `78926ed`, default posture: booting `bun src/server.ts` on a scratch home, selecting a local Git repository as workspace (world kind `local`), creating a task, binding it, and opening "Isolate in a worktree…" left the start-point select empty and rendered the posture message verbatim in the chip's notice area. Restarting the same home with `COGNATE_EXECUTION_POSTURE=uncontained-local` made the identical flow succeed end-to-end (screenshot set `screenshots/workbench/checkout-live-01..07.png`).
- Confidence: high
- Closure: Either give the Git capabilities a deliberate operator-exec path (a design decision: these are operator-invoked, operator-only capabilities, so the agent-effect posture argument does not obviously apply), or keep the refusal but make it checkout-specific ("task checkouts need an uncontained-local posture or a containment config that includes <repo> and <repo>-worktrees; see docs/linux-contained-workspaces.md") and cover the refusal in a journey test. Files likely touched: src/capabilities/taskCheckout.ts, possibly src/workbench/gitOps.ts (message), test/J-CHECKOUT-lifecycle.test.ts; size M.

### The checkout chip's facts go stale after commits made outside the app
- Date: 2026-10-27
- Location: src/ui/workbench/CheckoutChip.tsx:55-69 (refresh only on mount/binding change) and the finally-blocks at :115/:132/:161.
- Debt: The chip observes `git.checkout.status` only when it mounts, when the binding changes, and after its own attach/merge/recreate actions. An operator who commits in the worktree with their editor (the normal way to finish work there) sees "clean" and a disabled "Merge into main" indefinitely, because nothing re-observes the status. The capability layer re-checks on every action, so no unsafe merge or removal can happen — but the offered affordances misrepresent the facts until a reload.
- Evidence: In the live walkthrough, after creating the checkout the chip read "clean · Merge into main (disabled)"; committing `tidy: warmer greeting` in the worktree from the shell left the chip text unchanged; a page reload (fresh mount → refresh) changed the chip to "workbench/tidy-the-greeting · 1 commit to merge" and enabled the button, and the merge then succeeded. DOM text captured before/after reload is quoted in `.agents/plans/pandacode-affordance-delta/verification.md` § live walkthrough.
- Confidence: high
- Closure: Re-observe on window focus (or before opening the Change/Remove controls, or a modest poll while a binding exists) — the donor re-queried `worktree_status` each time its worktree dialog opened, which is the same trigger this needs. Files likely touched: src/ui/workbench/CheckoutChip.tsx; size S.
