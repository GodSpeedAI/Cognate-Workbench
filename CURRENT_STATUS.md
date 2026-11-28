# Current status

**Status revision:** 64

**Stage:** CognitiveOS #108 integration: origin/main merged (WP-23 squash #40, follow-ups #42/#43, criterion authority and schema names #45, vocabulary #44)

**Summary:** Merged origin/main into the integration. The integration had carried the WP-23 hand-off from its original commits; main landed it as squash #40 (d02efd6) with determinism fixes #42/#43, criterion authority and schema names #45, and the vocabulary consolidation #44. Resolution: the WP-23 add/add files (test/handoff-fixture.ts, J-CASE-ASSIGNMENT-handoff and E2E-case-assignment-handoff tests, docs/reference/terminology-implementation.md) take main's versions, which equal the integration's plus main's fixes; fixtures/aimock/fixtures.json takes main's gated slow scenario (first call about ten minutes, sequenceIndex 0/1) with all integration fixtures kept; src/server.ts keeps the RLM and ServiceError imports and the integration's domain import and adopts main's storeConfigForHome; the interaction model keeps ChildRunDelegation; DEBT.md takes main's contention-evidence text and keeps both the Cognate 0.11.0 re-entry and the worldHash sections; package.json and bun.lock keep Cognate 0.11.0 (higher than main's 0.10.0; main's only dependency change was 0.9.2 to 0.10.0). Status history: main's revisions 44-46 are kept exactly as on main; the integration's own revision 44 (the earlier snapshot of the same vocabulary consolidation, superseded by main's 46) is dropped because its number collides with main's 44 and it records the same change; integration revisions 47-63 keep their numbers. .agents/CURRENT_STATUS.md stays main's pointer file.

**Verified:**

- bun install --frozen-lockfile: no changes (35 Cognate packages at 0.11.0)
- bun run typecheck (tsc -p tsconfig.json) clean
- bun test (COGNATE_BWRAP_TESTS=1, pg0 instance cwbmerge): containedLaunch, containedProfileAuthority, containedSeccomp, envPattern, containedProfileCli, criterion-authority, store-schema-names, store-refuses-newer-schema: 109 pass 0 fail
- bun test: J-RLM-contained-port, J-RLM-contained-port-seccomp, J-RLM-contained-port-server, J-CASE-ASSIGNMENT-handoff, assignment-operator-controls: 18 pass 0 fail

**Limits:**

- Runtime roots (root-owned public directories) and an executable inside them are still bound by path; /usr/bin/prlimit is not pinned.
- The launcher exec through /proc/<pid>/fd is verified working with bwrap 0.13.1 on this host; hash and exec use one descriptor, but a replaced file's already-open descriptor keeps the old bytes only as long as it stays open.
- The admission guard is in memory and bounded (256): after a restart an in-flight child is refused rather than re-spawned.
- Unchanged: no disk quota beyond the tmpfs cap; subprocess:false refused; RLIMIT_AS fails allocations rather than terminating; output cap checked per chunk; per-run egress credentials are #115; the real-bwrap test is opt-in.
- The execution profile includes the child args after argv[0] and the flag template, which embeds the host realpaths of the public runtime roots and an in-root executable: it is stable on one host but not across hosts with different layouts. The host socket's own path is a per-deployment host path and is represented by role only.
- The per-port env HMAC key means the PLAN digest (not the profile digest) is not stable across a host restart when allowlisted env values are present; policy should list profile digests.
- A failed dispatch disarming and a repeat invoke not re-arming are proven at the guard (unit); through startServer the replay, widened-authority, bigger-budget, forged-start and wrong-principal cases are covered, but a dispatch that fails after governed admission cannot be provoked there because the governed checks run first.
- An actor that can start runs as the parent's own agent principal is inside the same trust domain as the admission.
- The real test's CPU-ceiling wall-time bound is 60 s: the ceiling counts CPU seconds, and a loaded host stretched one run to 8.8 s; the recorded reason (cpu-ceiling or signal) is still asserted.
- SEA-Forge binds the digest the host claims and cannot verify it; the host's pre-spawn recompute and the plan-embeds-profile check are the verification (ADR-017). A decision read-back verb is future work.
- Escalation is refused, not awaited: a contained spawn does not park a run for approval.
- The server composes the hook from the external authority (COGNATE_GOVERNANCE=sea-forge); that composition is covered by the hook's unit and stand-in-socket tests and the explicit-hook server tests, not by a live SEA-Forge process.
- Effectful tools remain refused to children (#112) while governed admission for effects stays closed.
- Cognate maps decisionRef from ledger_entry, falling back to decision_id; SEA always returns ledger_entry, so a decision with neither is refused.
- Egress profiles carry no seccomp filter: the host-socket slot needs AF_UNIX. #115 must hand the child a pre-connected fd, then the filter applies to every profile.
- M6 residual: runtime-root binaries (/usr/bin) are bound by path; only host root can replace them, which is outside the threat model, and the final pre-spawn recompute narrows the window.
- TODO(cognate ledgerEntry): Cognate folds decisionRef as ledger_entry ?? decision_id; the ULID shape check is the interim proof until the typed decision exposes ledgerEntry.
- The reach declaration is keyed by the run id the provider passes to spawn (the child run id); a provider that passes another run id is treated as declared none.
- The reach and run identity depend on AsyncLocalStorage propagating through Cognate's provider call path; the server test with a spoofing provider proves it holds for the current Cognate.
- Report gains an optional blocked array: [{teamId, reason: required-expert-archived, requires: {reactivate: [ids]}, message}], present only when non-empty.
- The interaction model has no restore journey, so no model change or domainforge run was needed.
- Full just verify remains pending (hosted CI).
- The 13 skips are opt-in suites (real bwrap contained workspace; live SEA plus RealityTrace settlement); not exercised on the hosted runner
- WP-23 operator controls can be refused while the bound run streams until the Cognate control-stream fix (Cognate PR #93) is released and bumped
- Operator controls can be refused with too much contention while the bound run streams: structural Cognate defect (control events appended to the run stream the executor owns); Cognate #91 backoff merged; structural fix on Cognate fix/assignment-controls-off-run-stream needs a release and bump
- No production hand-off source until Horizon wiring exists; absent source fails closed
- The in-process trusted path is used; the SEA Connect admission provider needs a Cognate release that includes it
- Reconciliation card says restart for an operator interrupt; Interrupt records a fixed reason
- Local WSL host network churn can fail strict console assertions; hosted runner is the qualifying environment
- worldHash does not cover the real model, policy and environment (DEBT.md)

**Next:**

- Merge origin/ticket/114-contained-port (launch gate, spawn scope, lifecycle property test) and re-run the gates on the final head.
- Hosted verify on the merged integration head.
- Review and merge; #115 pre-connected fd then filter all profiles; Cognate ledgerEntry; live SEA-Forge check.
- Release Cognate with the structural control fix (owner authorization for publication), bump, drop the contention retries.
- Horizon production hand-off source.

**Evidence:**

- src/capabilities/containedLaunch.ts
- src/capabilities/containedStdioPort.ts
- src/capabilities/rlmAdmissionGuard.ts
- test/containedLaunch.test.ts
- test/J-RLM-contained-port.test.ts
- test/J-RLM-contained-port-server.test.ts
- .tmp/evidence/114/ (gitignored)
- src/capabilities/containedProfileAuthority.ts
- test/containedProfileAuthority.test.ts
- src/capabilities/containedSeccomp.ts
- test/containedSeccomp.test.ts
- test/J-RLM-contained-port-seccomp.test.ts
- src/capabilities/envPattern.ts
- src/capabilities/containedRunContext.ts
- src/capabilities/containedProfile.ts
- test/envPattern.test.ts
- test/containedProfileCli.test.ts
- test/J-EXPERTS-restore-blocked.test.ts
- test/J-EXPERTS-restore.test.ts
- test/J-EXPERTS-restore-safe-mode.test.ts
- src/experts/state.ts
- docs/reference/terminology-implementation.md
- test/criterion-authority.test.ts
- test/store-schema-names.test.ts
- test/handoff-fixture.ts
- test/E2E-case-assignment-handoff.test.ts
- test/J-CASE-ASSIGNMENT-handoff.test.ts
- test/assignment-operator-controls.test.ts

**Spec:** SEA-Forge #114

**Plan:** None
