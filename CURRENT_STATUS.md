# Current status

**Status revision:** 66

**Stage:** CognitiveOS #108 integration: ticket/114-contained-port (launch gate, spawn scope, lifecycle property test) merged

**Summary:** Merged origin/ticket/114-contained-port at eed0b69 into the integration after the origin/main merge (revision 64). The ticket adds LaunchGate (the only Bun.spawn site), SpawnScope (per-spawn descriptors, handles and cancellation, cancelled by dispose), the M7 sweep measured at launch begin, and test/containedLifecycle.test.ts (fast-check, seed 114, 500 runs). Only the status files conflicted. The ticket's own revision 63 collides with the integration's revision 63 (the #112/#114 merge), so the ticket's record is kept verbatim but renumbered 65; the integration's 63 and 64 keep their numbers. This revision (66) carries forward the open limits and next items of both lines. No dependency changes: fast-check 4.10.2 was already in package.json; frozen install clean.

**Verified:**

- bun install --frozen-lockfile: no changes
- bun run typecheck clean; there is no `check` script in package.json
- bun test (COGNATE_BWRAP_TESTS=1, pg0 instance cwbmerge) containedLifecycle, containedLaunch, containedProfileAuthority, containedSeccomp, envPattern, containedProfileCli, criterion-authority, store-schema-names, store-refuses-newer-schema: 114 pass 0 fail
- bun test J-RLM-contained-port, -seccomp, -server, J-RLM-child-run, J-CASE-ASSIGNMENT-handoff, assignment-operator-controls, J-AIM-aimock, J-EXPERTS-restore, -blocked, -safe-mode, workbench-contract, domainforge-lockstep: 66 pass 0 fail
- test/E2E-case-assignment-handoff.test.ts: 6 of 7 local runs passed (12-18 s each); the first cold run failed (turn failed with HTTP 404 after 5/5 retries, test timed out at 180 s) and was not reproduced in six further runs; cause not established

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
- test/E2E-case-assignment-handoff.test.ts failed once in seven local runs on the merged tree (HTTP 404 on the slow scenario's model retries); not reproduced; hosted CI on the merged head is the gate

**Next:**

- Hosted verify on the merged integration head, watching test/E2E-case-assignment-handoff.test.ts for the 404-on-retry failure seen once locally.
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
- src/capabilities/launchGate.ts
- src/capabilities/spawnScope.ts
- test/containedLifecycle.test.ts

**Spec:** SEA-Forge #114

**Plan:** None
