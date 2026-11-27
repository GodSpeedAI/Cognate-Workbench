# Current status — revision 55

SEA-Forge #114 (Workbench half): a contained bubblewrap `StdioSpawnPort` for recursive child runs.

**Behaviour.** `src/capabilities/containedStdioPort.ts` implements Cognate's `StdioSpawnPort` and is built only from trusted host configuration, `ServerOptions.rlmContainedPort`. Absent (default) means Cognate's `unavailableSpawnPort()`, so ordinary execution and every current refusal are unchanged. With it, `rlmGoverned.providerRefusal` admits a no-network contained provider and still refuses open egress.

**Launch plan and digest.** `src/capabilities/containedLaunch.ts` resolves each spec into a canonical record: pinned executable and launcher (path, sha256), the full sandbox argv, read-only workspace, network `none` or one host unix socket, ceilings (wall, CPU, address space, nofile, nproc, output bytes), env allowlist. `launchPlanDigest(plan)` = `sha256:<hex of canonical JSON>`; ticket #116 binds an authority decision to it through the optional `authorize` hook. The plan is recomputed and compared just before spawn; drift refuses.

**Spawn and teardown.** `--unshare-all` (net, pid, user), `--die-with-parent`, `--new-session`, cleared env, read-only workspace and runtime roots, tmpfs `/tmp`, minimal `/dev`, caps dropped, `prlimit` ceilings, line streaming with bounded output, line length and stderr. `kill`, wall-clock, and ceilings kill the process group and pid namespace, then check the host `/proc` for survivors; teardown is idempotent and records the exit.

**Refusals before spawn** (typed Cognate codes, never a fallback): missing or digest-mismatched launcher, unpatched launcher, user namespaces unavailable, unpinned or digest-mismatched executable, executable or launcher in a writable root, outbound network other than the host socket, unenforceable filesystem, subprocess or cap requests.

**Review pass 1 fixes (rev 53).** Host objects are bound by inherited fd after dev/inode verification; binaries must be trusted, not just pinned; env values stay out of argv and the plan; unknown restriction keys refuse; /tmp is size-capped with RLIMIT_FSIZE; the digest binds run and intent; `nsKnown:false` is never a clean teardown; only a child admitted by the governed `rlm.invoke` reaches the port.

**Delta-check fixes (rev 54).** The admission guard binds the exact derived child input and consumes each admission on first use (replays refused, record bounded); the executable and launcher are hashed and used through the same descriptor; env digests are keyed per port; malformed specs get typed refusals; the launcher's path checks run before it is ever executed.

**Verified.** `test/containedLaunch.test.ts` 31/31, guard 4/4, wiring plus child-run 10/10, real bwrap run 36/36 with the unit files, three times. `test/J-RLM-contained-port.test.ts` (COGNATE_BWRAP_TESTS=1) observes each control from outside with positive controls; evidence JSON under `.tmp/evidence/114/`. Typecheck clean.

**Limits.** No seccomp or disk quota; `subprocess:false` is refused; RLIMIT_AS fails allocations rather than terminating; the output cap is checked per chunk; bwrap path-exec after a hash check has a narrowed, not eliminated, swap window; `prlimit` comes from the read-only runtime roots. The metering proxy is #115, authority binding is #116. Cognate does not export its bwrap argv builder.

**Next.** Review and merge; #115 and #116.

Plan: none. Spec: SEA-Forge #114. Full history is in `.agents/CURRENT_STATUS.jsonl`.
