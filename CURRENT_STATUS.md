# Current status — revision 60

SEA-Forge #114 (Workbench half): a contained bubblewrap `StdioSpawnPort` for recursive child runs.

**Behaviour.** `containedStdioPort.ts` implements Cognate's `StdioSpawnPort` from trusted host configuration, `ServerOptions.rlmContainedPort`; absent, Cognate's refusing port stays. `rlmGoverned.providerRefusal` admits a no-network contained provider and refuses open egress. `declareReach` binds each run to the operator-declared reach of its admitted provider; a spawn exceeding it is refused before any authority request.

**Plan and profile.** `containedLaunch.ts` resolves a spec into a canonical plan (`launchPlanDigest`, per launch) that embeds the operator-approved `executionProfileDigest`: pinned launcher and executable, restrictions, ceilings, flag template, fixed env, allowlisted env names with their value patterns, seccomp filter digest. Policy lists profile digests. The plan is recomputed before spawn; drift refuses. `bun scripts/contained-profile.ts` prints a profile.

**Containment.** `--unshare-all`, `--die-with-parent`, read-only workspace, tmpfs `/tmp`, caps dropped, `prlimit`, bounded output, group and namespace kill with a `/proc` survivor check. With no network a BPF filter (`containedSeccomp.ts`, `--seccomp 7`) denies `socket(AF_UNIX)` (EACCES) and `io_uring_setup` (EPERM), which closes host pathname sockets under the workspace bind.

**Authority (#116 host half).** `startServer` always composes `profileAuthorize`, from the external SEA-Forge or an injected `rlmProfileAuthority`; no bare hook, and the port requires one. The launch asks the target `workbench.rlm.contained-spawn` with `claims.execution_profile_digest`, before any bubblewrap starts, and proceeds only on a `boundary` allow with one `execution_profile` constraint, no other constraint, a ULID ledger entry, and a plan embedding the digest. A disposed port launches nothing.

**Verified.** Real bwrap batch (unit, guard, authority, seccomp unit, conformance, H4 pathname-socket test) 85/85 three times; server wiring plus child-run 20/20. Review rounds: delta-1 fixes H1-H4, M5, M7-M10, L11.

**Limits.** Egress profiles carry no seccomp filter (#115: pre-connected fd, then filter all); runtime-root binaries are bound by path, so a root-owned replacement between the last digest check and bwrap's resolve is a declared residual (host root is trusted); no disk quota; `subprocess:false` refused; RLIMIT_AS fails allocations. Cognate folds `decisionRef` as `ledger_entry ?? decision_id`: ULID shape is the interim proof (TODO cognate ledgerEntry).

**Next.** Review and merge; #115; live SEA-Forge check.

Plan: none. Spec: SEA-Forge #114. History: `.agents/CURRENT_STATUS.jsonl`.
