# SDK 0.6.0 / 0.6.1 release receipt (run-write ownership)

Workbench consumes only complete, published, linked Cognate releases. This document records the
release provenance of the run-write ownership work (T6) and the Workbench multi-process
integration that consumes it (T7), including the interrupted first publication and its
legitimate recovery.

## What was released

- **PR #48** (`feature/run-write-ownership`, merged 2026-10-17T14:23:58Z): the run-write
  ownership contract at both seams — authoritative store-time ownership rows with
  store-maintained generations, exclusive claims that refuse a live holder, commit-phase fencing
  of run-scoped appends, the executor ownership lifecycle (claim before execution, credential on
  every run-scoped append including thread-state updates, lease renewal before each capability
  invocation, halt-without-retry on `StaleRunOwnerError`, release on pass end), and
  ambiguous-effect reconciliation (`run.invocation.ambiguous` + `ambiguous-invocation`
  continuation under `execution.runOwnership.ambiguousSteps: "wait"`; `reexecute` default
  preserves historical restart semantics). Exact-head CI passed: `verify (ubuntu)`,
  `pack + clean-room install`, CodeRabbit.
- **PR #54** (`fix/release-publish-recovery`, merged 2026-10-17T16:34:10Z): a narrow
  `workflow_dispatch` input that re-runs tag-components, the publish matrix and the receipts gate
  for the manifest version at HEAD without changing any version; the publish guard skips
  already-published versions and the receipts gate remains mandatory.
- **PR #55** (merged 2026-10-17T19:08:12Z): the recovery re-arm fix — a lease-held back-off
  re-arms the run for later recovery instead of stranding it (two downstream consumer recovery
  journeys regressed against 0.6.0 for exactly this reason and pass against 0.6.1).

## Release 0.6.0 — interrupted publication and recovery

The release-merge push created the umbrella release and the `cognate-v0.6.0` tag inside the
release-please job and then failed updating its own branch ref before the job outputs registered,
so tag-components, the publish matrix and the receipts gate never ran. Recovery restored the
exact git state first (umbrella release and tag re-created at the release commit, the missing
45 component/unified tags minted by the workflow's own `plan-sdk-release.mjs` at the same SHA),
then used the new PR #54 dispatch input once to run the publish matrix and the receipts gate for
the already-released version. The receipts gate verified **45/45 packages at 0.6.0** with a
receipt artifact; an independent registry audit confirmed every linked package's latest dist-tag
was `0.6.0` with the version present; a fresh clean-room consumer installed the published
packages and exercised the fenced ownership API (held-lease refusal, reclaim generation advance,
stale-owner write fenced with nothing appended) plus a runtime boot.

## Release 0.6.1 — the re-arm repair

The Workbench's full suite against published 0.6.0 found that hard-kill recovery stranded runs
whose owner's lease was still live: the held back-off consumed the only recovery trigger
(`J-EXPERT-INBOX-RECOVER` and `J-TEAM-RECOVER` both regressed). PR #55 added the re-arm
(RED/GREEN: the seeded two-process journey hangs before the change and completes after it), ran
the full upstream `just verify` 81/81, merged with green exact-head CI, and release-please cut
**0.6.1** through the normal train (release-please → tag-components → 45/45 publish matrix →
receipts gate, all green in one run, 2026-10-17). The independent registry audit confirmed all 45
linked packages at `0.6.1`.

## Workbench consumption (T7)

- `package.json` pins all 23 direct `@godspeedai/*` dependencies to **0.6.1**; `bun install`
  resolves 36 SDK packages at 0.6.1.
- Multi-process operation is exposed behind the verified configuration
  `runOwnership: "multi-process"` (or `COGNATE_RUN_OWNERSHIP=multi-process`): it enables
  `execution.runOwnership.ambiguousSteps: "wait"` on the published 0.6.x runtime. The default
  single-process mode keeps the historical restart semantics (the upgrade alone changed no
  observable behavior: the full pre-T7 suite passed on 0.6.1 before any Workbench wiring).
- `test/J-EXPERT-OWNERSHIP-MULTI.test.ts` passes the two-process journey against actual
  PostgreSQL: two Workbench AppServers on one shared store; the first process is stopped
  mid-model-effect; a zombie writer's late run-scoped append under a superseded credential is
  fenced with nothing appended; the recovering process records `run.invocation.ambiguous`
  (exactly one), never re-performs the effect (provider calls stay at one), the interrupted
  attempt stays booked in the durable billing ledger, and the assignment reaches its terminal
  state only from the operator's explicit reconciliation with no model-generation invocation ever
  recorded.
- The previously regressed recovery journeys (`J-EXPERT-INBOX-RECOVER` SIGKILL mid-CAS,
  `J-TEAM-RECOVER` process restart) pass unchanged against published 0.6.1.
- Full gate: `just verify` passed **1,173 tests / 1,167 pass / 6 skip / 0 fail** across 113 files.
  One intermediate full run showed a single `E2E-workbench` failure from Chromium
  `net::ERR_NETWORK_CHANGED` console noise under load; the journey passes in isolation and in the
  final clean run.

## Boundaries

Multi-process operation still does not make external effects exactly once (the contract is
commitments plus reconciliation); production identities, tenant isolation and aggregate
containment remain open (T8). The 0.6.0 version string exists publicly on npm (published by the
recovered matrix) with a receipt; 0.6.1 supersedes it and is the version Workbench consumes.
