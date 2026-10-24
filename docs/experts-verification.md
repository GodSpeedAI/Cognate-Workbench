# Experts and Teams implementation evidence

Branch: `feature/expert-teams`. Published Cognate packages remain pinned to 0.2.0; DomainForge CLI is 0.19.0 and Bun is 1.4.0. The only package declaration added is the already-installed native `@godspeedai/cognate-continuations@0.2.0`, used for commitment safety. No donor code was copied.

## Canonical journeys and evidence

| Journey | Implemented path | Executable evidence |
| --- | --- | --- |
| J-EXPERT-CREATE | Seed/create/edit/copy/configure stable identities | `test/J-EXPERT-management.test.ts`, `test/ui-experts.test.tsx` |
| J-EXPERT-SOLO | Separately scoped conversation and route/context | `test/J-EXPERT-memory.test.ts`, `test/expert-model-routing.test.ts`, browser journey |
| J-TEAM-CREATE | Draft Teams, member defaults and reusable copies | Management and browser journeys |
| J-TEAM-ACTIVATE | Zero Orchestrators rejected; sole-Orchestrator invariant enforced in CAS mutation | Management/security journeys |
| J-TEAM-REPLACE-ORCHESTRATOR | Atomic role transfer, simultaneous-update checks | Management/security journeys |
| J-TEAM-DELEGATE | Authorized typed Assignment, Specialist-only recipient, genuine child execution | Execution/evaluation journeys |
| J-TEAM-HANDOFF | Attributable result/artifact, native continuation, idempotent completion delivery | Execution/scheduling/governance tests |
| J-TEAM-CONVERSE | Visible contributions, addressed durable queue, bounded depth/rounds/unread work/steps | Bounds/execution tests and browser journey |
| J-TEAM-RECOVER | Process-kill restart, same run identity, one logical return; native commitment ambiguity and human resolution | Execution/effect tests |
| J-TEAM-REVIEW | Builder, Critic, Verifier and Reviewer handoffs; independent observable checks; retained disagreement | Evaluation journey |
| J-EXPERT-MEMORY | Scoped attributable knowledge, explicit promotion, context selection and public-view redaction | Memory journey and UI component tests |
| J-TEAM-SETTLEMENT | Human-only decision after independent evidence; unresolved contradictions reject acceptance | Evaluation/governance tests and successful tool-evidence settlement |

These scenarios demonstrate the contracts. They do not certify general Expert competence or arbitrary model behavior.

## Key implementation files

| Files | Responsibility |
| --- | --- |
| `.sea/interaction/interaction-model.sea`, `domain/index.ts` | Authoritative journeys, invariants and 24 explicit capability bindings |
| `src/experts/types.ts`, `state.ts`, `service.ts` | Stable identities, editable seeds, native CAS state, authority and scope mutation boundaries |
| `src/agents/agentExpert.ts`, `agentCoding.ts` | Genuine Cognate execution using the existing tool loop and native waits |
| `src/experts/bridge.ts`, `governance.ts` | Crash-recoverable correlated returns, cancellation repair and protected continuation resolution |
| `src/capabilities/expertModel.ts`, `expertEffect.ts` | Frozen per-Expert routes using existing adapters/secrets, native commitment replay protection |
| `src/projections/experts.ts`, `providerRoutes.ts`, `src/server.ts` | Durable read models and native application wiring |
| `src/ui/experts/`, `src/ui/App.tsx` | Integrated roster, configuration, scoped history/chat, assignments and evidence/approval surfaces |

The donor patterns reconstructed are stable identity and role composition, membership, scoped group
history, bounded addressed delivery, return routing, continuity, provenance-backed memory and
identity-specific permissions. Each uses Cognate state, capabilities, runs or continuations. The
[translation matrix](experts-donor-translation.md) records mechanisms reused, adapted, implemented
and deferred; schedules remain explicitly deferred because automation records have no durable
executor.

UX evidence includes the [default roster](../screenshots/experts/default-team-desktop.png),
[custom Team on desktop](../screenshots/experts/custom-team-active-desktop.png),
[360px mobile view](../screenshots/experts/custom-team-active-mobile.png), and
[real conversation with a handoff](../screenshots/experts/team-conversation-handoff-desktop.png).
Browser journeys also create/edit/copy an Expert, select its route, and reopen separately scoped
solo/private history after reload. Controls report actual capability errors and execution states.

## Observed settlement facts

- The default seed contains five ordinary editable Experts; only Product Manager is Orchestrator. Customization and routes survive reseeding/restart.
- Concurrent Orchestrator replacements retain exactly one coordinating member. Removing the sole active Orchestrator fails atomically.
- PM and Builder execute distinct model routes in the same Workbench instance. Specialists receive no nested coordinating authority.
- A real Builder run reads and edits `proof.txt` from `old` to `new` through a native commitment. A separately routed Verifier reads `new` and records a native tool receipt. Human review and settlement complete the objective.
- A five-Expert scenario preserves Critic uncertainty, supplies implementation/critique/verification to Reviewer, and rejects human acceptance while that contradiction remains.
- A Workbench subprocess is killed while the parent waits and Builder runs. Restart on the same PostgreSQL schema reuses the child run ID, delivers one return and automatically resumes the parent without a browser turn.
- A provider fails six bounded attempts; failure remains visible and an authorized retry produces a new run and successful return.
- Cancellation signals active work and discards late results as authority. Forged Expert messages, nested delegation, system approval and fabricated internal continuation returns are rejected.
- Native commitment tests simulate a lost outcome and missed registry update. Known success is returned once; ambiguous effects never redispatch. PostgreSQL JSONB key reordering preserves idempotency.
- Public projections survive restart while excluding private memory, private-Team transcripts and embedded context. Personal, Team-shared and Team-private knowledge remain distinct.
- Supplied identities cannot overwrite existing Assignments, Experts, Teams or addressed messages. Memory updates cannot change ownership/scope or let an Expert replace human-accepted knowledge; rejected attempts preserve the original records across restart.

## Commands and results

| Command | Observed result |
| --- | --- |
| Baseline `just typecheck` | Passed before implementation |
| Baseline sandbox `just verify` | 915 pass, 106 fail. pg0's state directory and local model servers required execution outside the sandbox |
| Earlier integrated `just verify` outside sandbox | Passed: 1,059 tests, zero failures, 6,479 assertions across 84 files (347.87 s) |
| Final exact-tree `just verify` at `a697e36` | Passed: **1,064 tests, zero failures, 6,536 assertions across 85 files (439.73 s)**; includes typecheck, all Expert/Team journeys and existing regression coverage |
| Final repair regression: `bun test --timeout 15000 test/J-TEAM-security.test.ts test/expert-governance.test.ts test/J-E-plan.test.ts test/ui-experts.test.tsx` | Passed in a fresh process: 16 tests, zero failures, 99 assertions across four files |
| `bun test test/J-TEAM-execution.test.ts test/J-TEAM-security.test.ts test/J-EXPERT-memory.test.ts test/J-EXPERT-management.test.ts test/experts-runtime-scheduling.test.ts` | Passed: 12 tests, 107 assertions, including actual interruption and file effects |
| `bun test test/J-TEAM-evaluation.test.ts` | Passed: five routed Expert executions and 27 assertions |
| `bun test test/J-TEAM-bounds.test.ts` | Passed: budget failures, one Specialist, finite run, and rejected extra round; 11 assertions |
| `bun test test/expert-effect.test.ts test/expert-governance.test.ts test/expert-model-routing.test.ts` | Passed: 17 tests; ambiguity, authorization, route isolation, typed returns and immutable workspace routing |
| `bun test test/ui-experts.test.tsx` | Passed: accessible editors, honest settlement/effect states and scoped memory controls |
| `bun test test/E2E-experts.test.ts` and final suite | Both browser journeys pass: default roster, custom activation, real Team response, routed Expert creation/edit/copy, solo/private history and reload; desktop/360px screenshots |
| `domainforge validate --format human .sea/interaction/interaction-model.sea` | Passed: zero violations |
| `domainforge parse .sea/interaction/interaction-model.sea --format human` | 43 entities, 40 resources, 40 flows, 8 roles, 6 relations, 49 entity instances |
| Cognate adapter `loadDomain` + `bindExpertCapabilities` | 188 semantic objects; all 24 explicit contracts resolve |
| `domainforge fmt --check ...` | Reports a formatting difference. Known 0.19 formatter issue with quantified policies/comments; source was preserved and validation passes |
| `git diff --check` | Passed |

## Review corrections

Luna reconnaissance and adversarial reviews identified and drove repairs for duplicate bind CAS fingerprints, JSONB key ordering, unstable tool-request identity, tool input overriding trusted workspace/world, unrelated/forged evidence, addressed-message context spill, asynchronous cancellation acknowledgement, unsafe human resolution of live dispatch, inappropriate child retry controls and missing conversation-history UX. A fresh release review caught the missing plan-review human gate; the guard now recognizes approval conditions independently of wait type, with plan/custom-gate regression coverage. Failed observations were retained rather than claimed as successes.

An intermediate final run reached several pre-existing five-second fixture deadlines while
starting PostgreSQL/SXR/model fixtures. Existing checks already allow ten seconds internally;
the suite's default outer deadline now allows fifteen seconds. Assertions, provider retry
counts, tool limits and explicit cancellation/time budgets remain unchanged. Legacy provider
restoration also precedes Expert seeding so recovery does not spend its retry budget waiting for
unrelated initialization. The suite is rerun on the stable tree after these corrections.

The SDK completion-condition gap is handled by an explicit compatible event bridge. The effect-after-crash gap is handled with native commitments, not assignment-only deduplication. The installed runtime's serialized dispatch is tested; no parallel-worker claim is made.

The final audit also repaired identity collisions at creation boundaries and private-memory overwrite
attempts. A regression exercises real model tool calls attempting to replace accepted knowledge and
an existing human message. An existing plan-review test read its run snapshot before waiting for
`waiting`; it now reads after the wait, preserving the assertion while removing the stale-read race.
The interruption stopped one final test process, so it is not counted as a completed verification.
An audit-time rerun finished with 1,062 passes and two failures: the stale plan snapshot and an
addressed-message overwrite assertion running against an already-loaded earlier service module.
Both pass in the fresh-process repair regression. The final release gate starts after the source
commit and uses a fresh process throughout.
An additional Luna review hit its provider usage limit; the earlier independent release review
completed, and these later boundary corrections are covered by executable regression tests.

## Cleanup and release

The donor `Fei2411/DeepSeek-Bot` at `20ebc9213cbbde7249d71786765f86be00dc6663`, version 0.1.5, Apache-2.0, was examined and removed from `.tmp/donor/deepseek-bot`. It was ignored throughout. Runtime/build source has no donor-checkout references, DeepSeek Harness imports or donor plugins. Provenance and behavior translations remain in [the matrix](experts-donor-translation.md).

| Commit | Milestone |
| --- | --- |
| `3b0781e` | Donor examination, contracts, baseline and implementation plan |
| `5dbce99` | Authoritative semantics, persistent identities and Team invariants |
| `bad9335` | Native execution, per-Expert routes, durable returns and effect recovery |
| `663c339` | Scoped recovery, bounded collaboration and independent settlement evidence |
| `5c07743` | Native responsive management, scoped history and evidence UX |
| `a697e36` | Identity overwrite protection, human gates, startup ordering and final test corrections |
| `e3433e5` | User/runtime documentation, semantic validation, donor parity, debt ledger and release evidence |

Published successfully to `origin/feature/expert-teams` on `GodSpeedAI/Cognate-Workbench`,
initially through `e3433e5`. The final status/plan closure is a documentation-only follow-up on the
same branch. No force-push, unrelated history replacement or donor source publication occurred.

The operator explicitly approved retaining the pre-existing SDK-internal Cordis dependency after
the audit demonstrated its relationship to Cognate 0.2.0. This task adds no direct Cordis
dependency or integration.

Remaining limits: autonomous schedules, live inter-Expert steering, parallel workers, vector
retrieval and multi-process effect dispatch are deferred. Memory budgets count characters;
history pagination and aggregate partitioning remain scaling work. A provider can delay graceful
shutdown; abrupt recovery is tested. Development authentication and best-effort command guards
are not production isolation. DomainForge's formatter discrepancy remains, while semantic
validation passes. See [Experts and Teams](experts-and-teams.md), [known gaps](known-gaps.md)
and [the debt ledger](../.agents/DEBT.md) for precise boundaries.
