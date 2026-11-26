# Current status

**Status revision:** 50

**Stage:** CognitiveOS #108 integration: WP-23 hand-off integrated; #109/#110 qualified on hosted CI

**Summary:** Integration branch carries the test-client lifecycle cleanup, the DomainForge platform-package binding resolver, the validated SSH host key helper, #110 (blocked default Team restore prerequisite) and now the WP-23 operator hand-off (PR #40, merged to main d02efd60). Hosted verify at 142f7d9 passed all four shards, tauri-linux and the aggregate; clean-install x64 and arm64 passed. Cognate pins stay at the published 0.11.0.

**Verified:**

- Red then green: test/J-EXPERTS-restore-blocked.test.ts, 5 tests (state, capability, safe mode, agent and in-Run refusal) failed before the fix and passed after.
- just typecheck clean.
- Expert and Team suites on isolated pg0: 9/9, 24/24 and 53/53 pass, 0 fail.
- Active and custom definitions and stable IDs unchanged; existing restore report shape unchanged when nothing is blocked.
- Hosted verify 45827926682 on 142f7d9: smoke 73; shard1 41 pass 1 skip; shard2 325; shard3 141 pass 9 skip; shard4 1376 pass 3 skip; 0 fail; tauri-linux and aggregate success
- Hosted clean-install 45829573944 on 142f7d9: x64 and arm64 success
- WP-23 merge: frozen install unchanged, 35 Cognate packages at 0.11.0, just typecheck clean

**Limits:**

- Report gains an optional blocked array: [{teamId, reason: required-expert-archived, requires: {reactivate: [ids]}, message}], present only when non-empty.
- The interaction model has no restore journey, so no model change or domainforge run was needed.
- Full just verify remains pending (hosted CI).
- The 13 skips are opt-in suites (real bwrap contained workspace; live SEA plus RealityTrace settlement); not exercised on the hosted runner
- WP-23 operator controls can be refused while the bound run streams until the Cognate control-stream fix (Cognate PR #93) is released and bumped

**Next:**

- Run the full integrated gate on hosted CI.
- Review and merge the checkpoint branch.

**Evidence:**

- test/J-EXPERTS-restore-blocked.test.ts
- test/J-EXPERTS-restore.test.ts
- test/J-EXPERTS-restore-safe-mode.test.ts
- src/experts/state.ts

**Spec:** SEA-Forge #108 and #110

**Plan:** 
