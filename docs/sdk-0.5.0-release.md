# Cognate SDK0.5.0 release and consumption evidence

The operator approved PR44 and its linked release. PR44 final head
`696362090fb5bae0627dad0a37d7b508eaa63f8a` merged as
`e90f511731cbe01cf204f7ec7675e1b03532c5c7` at2026-10-15 13:14:33UTC.
[Verify](https://github.com/GodSpeedAI/Cognate/actions/runs/38740565172) and
[clean-room packaging](https://github.com/GodSpeedAI/Cognate/actions/runs/38740565394) passed on
that exact head. All actionable scoped review findings have RED/GREEN tests and requested Luna
review. CodeRabbit's quota prevented a fresh full review of the last head; its success context
does not imply that review occurred. Final local runtime/PostgreSQL/Linux tests passed38/189 and
the full upstream recipe passed81/81 gates.

Release Please PR45 updates all45 linked manifests and changelogs to0.5.0. Its bot-triggered checks
ran zero jobs; manual [verification](https://github.com/GodSpeedAI/Cognate/actions/runs/38741872423)
and [packaging](https://github.com/GodSpeedAI/Cognate/actions/runs/38741898166) passed at
`4c45d8474c098e96a8614572418c90c6e719b999`. The approved release merged as
`dd13c8422220ecbac61a92bdd90829218844bc2e` at13:24:52UTC.

## Registry visibility discrepancy and recovery

[Release workflow38742485841](https://github.com/GodSpeedAI/Cognate/actions/runs/38742485841)
reported45 successful package jobs. Primary-registry checks initially found only43 versions, then44;
runtime-bun became visible, while the Anthropic-compatible0.5.0 packument still returned404 and its
latest tag remained0.4.0. Workbench stayed on0.4.0 during that discrepancy. The cause of delayed
visibility was not established; job success alone was not accepted as publication proof.

Only the existing Anthropic publish job was requested for retry at the same release SHA. By its
retry,0.5.0 had become visible, so its idempotency guard skipped publishing. No duplicate version
was published by that retry. [Retry job116462257989](https://github.com/GodSpeedAI/Cognate/actions/runs/38742485841/job/116462257989)
and workflow attempt2 completed successfully at13:56:51UTC. A new uncached primary-registry audit
then matched **all45 package versions and gitHeads**. The subsequent tested verifier's complete
[machine-readable receipt](sdk-0.5.0-publication-receipt.json) preserves each result.

Automatic approval review rejected downloading complete job logs because they might contain
sensitive data. No log-download workaround was used; evidence comes from job/step metadata and
unauthenticated public registry records. Publication remains non-atomic; no exactly-once physical
execution guarantee is inferred.

## Fresh consumer and Workbench integration

A fresh isolated npm consumer installed all45 exact0.5.0 dependencies with scripts disabled. It
imports published packages only and executes actual PostgreSQL-backed native runs with asynchronous
resource admission. Observed result: two lookups, maximum two active runs, two completed runs with
distinct alpha/beta identities. This proves registry packaging and the native contract, not Expert
competence or distributed execution.

Workbench then upgraded23 direct/35 resolved SDK pins to0.5.0. It introduces no local SDK links,
vendored tarballs or non-SDK dependency. `just typecheck` passes. The first application admission
journey suite passed6tests/33assertions, then added ordering and cooperative-restart proofs for
**8tests/48assertions**. A real Chromium journey passed1test/10assertions with distinct visible
Expert results and native handoffs at capacity2. The containment suite passes5tests/111assertions
against the published launcher guard. The final full gate passed on the exact integrated tree:
`just verify` with the attested containment suite ran 1,153 tests across 105 files with 0 failures
and 7,543 assertions (640.51s), after `just typecheck`, DomainForge validation/format checks and
`git diff --check`. An earlier full run had one unhandled between-tests error (React reconciler
stack, no test failure); the corrected tree re-ran clean twice.

Native async eligibility does not supply general workspace conflict isolation or distributed
run-write ownership. Workbench permits only frozen intrinsic-return model work to overlap; other
work shares conservative exclusion. Linux child worlds do not establish production authentication,
host application isolation or aggregate resource quotas. The broader debt mission remains open.
