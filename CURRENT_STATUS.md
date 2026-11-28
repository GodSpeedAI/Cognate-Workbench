# Current status — revision 63

SEA-Forge #114 (Workbench half): a contained bubblewrap `StdioSpawnPort` for recursive child runs.

**Behaviour.** `containedStdioPort.ts` implements Cognate's `StdioSpawnPort` from trusted host configuration, `ServerOptions.rlmContainedPort`; absent, Cognate's refusing port stays. `rlmGoverned.providerRefusal` admits a no-network contained provider and refuses open egress. The server runs each admitted child inside a host-owned lease (`runInContainedLease`: run id, operator-declared reach, revoked in `finally`; module-private store). The port snapshots it into an immutable binding at spawn entry and checks it before authorization and launch, so a provider cannot name another run, a late timer cannot spawn, and a spawn beyond the declared reach is refused before any authority request.

**Plan and profile.** `containedLaunch.ts` resolves a spec into a canonical plan (`launchPlanDigest`, per launch) that embeds the operator-approved `executionProfileDigest`: pinned launcher and executable, restrictions, ceilings, flag template, fixed env, allowlisted env names with their value patterns (restricted grammar, linear-time matcher), seccomp filter digest. The launcher pin and its `--version` are snapshotted once at port construction. `computeExecutionProfile` runs no process; `scripts/contained-profile.ts` validates the spec, measures once, then computes. Policy lists profile digests. The plan is recomputed before spawn; drift refuses. `bun scripts/contained-profile.ts` prints a profile.

**Containment.** `--unshare-all`, `--die-with-parent`, read-only workspace, tmpfs `/tmp`, caps dropped, `prlimit`, bounded output, group and namespace kill with a `/proc` survivor check. With no network a BPF filter (`containedSeccomp.ts`, `--seccomp 7`) allow-lists socket creation: AF_INET, AF_INET6, NETLINK_ROUTE and AF_UNIX stream or seqpacket socketpairs; the rest is EACCES, `io_uring_setup` is EPERM, x32 and the legacy 512-547 range are killed. That closes host pathname sockets (stream and datagram) under the workspace bind, and vsock.

**Authority (#116 host half).** `startServer` always composes `profileAuthorize`, from the external SEA-Forge or an injected `rlmProfileAuthority` (refused beside configured governance); one canonical client decides admission and launch; no bare hook, and the port requires one. The launch asks the target `workbench.rlm.contained-spawn` with `claims.execution_profile_digest`, before any bubblewrap starts, and proceeds only on a `boundary` allow with one `execution_profile` constraint, no other constraint, a ULID ledger entry, and a plan embedding the digest. Lifetime is two constructs: one synchronous launch gate (`launchGate.ts`) is the only place a process is started and dispose() closes it first, and one scope per spawn (`spawnScope.ts`) owns every descriptor, handle and waiter and is cancelled by dispose; a disposed port launches nothing.

**Verified.** Real bwrap batch (unit, guard, authority, seccomp, env pattern, profile CLI, conformance, pathname-socket) 111/111 three times; server wiring plus child-run 24/24. Delta-1, delta-2 and delta-3 findings fixed.

**Limits.** Egress profiles carry no seccomp filter (#115: pre-connected fd, then filter all); runtime-root binaries are bound by path, so a root-owned replacement between the last digest check and bwrap's resolve is a declared residual (host root is trusted); no disk quota; `subprocess:false` refused; RLIMIT_AS fails allocations. Cognate folds `decisionRef` as `ledger_entry ?? decision_id`: ULID shape is the interim proof (TODO cognate ledgerEntry).

**Next.** Review and merge; #115; live SEA-Forge check.

Plan: none. Spec: SEA-Forge #114. History: `.agents/CURRENT_STATUS.jsonl`.
