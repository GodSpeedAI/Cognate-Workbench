# Current status — revision 57

SEA-Forge #114 (Workbench half): a contained bubblewrap `StdioSpawnPort` for recursive child runs.

**Behaviour.** `src/capabilities/containedStdioPort.ts` implements Cognate's `StdioSpawnPort` and is built only from trusted host configuration, `ServerOptions.rlmContainedPort`. Absent (default) means Cognate's `unavailableSpawnPort()`, so ordinary execution and every current refusal are unchanged. With it, `rlmGoverned.providerRefusal` admits a no-network contained provider and still refuses open egress.

**Launch plan and digest.** `src/capabilities/containedLaunch.ts` resolves each spec into a canonical record: pinned executable and launcher (path, sha256), the full sandbox argv, read-only workspace, network `none` or one host unix socket, ceilings (wall, CPU, address space, nofile, nproc, output bytes), env allowlist. `launchPlanDigest(plan)` = `sha256:<hex of canonical JSON>`; ticket #116 binds an authority decision to it through the optional `authorize` hook. The plan is recomputed and compared just before spawn; drift refuses.

**Spawn and teardown.** `--unshare-all` (net, pid, user), `--die-with-parent`, `--new-session`, cleared env, read-only workspace and runtime roots, tmpfs `/tmp`, minimal `/dev`, caps dropped, `prlimit` ceilings, line streaming with bounded output, line length and stderr. `kill`, wall-clock, and ceilings kill the process group and pid namespace, then check the host `/proc` for survivors; teardown is idempotent and records the exit.

**Refusals before spawn** (typed Cognate codes, never a fallback): missing or digest-mismatched launcher, unpatched launcher, user namespaces unavailable, unpinned or digest-mismatched executable, executable or launcher in a writable root, outbound network other than the host socket, unenforceable filesystem, subprocess or cap requests.

**Execution profile (rev 55).** Policy needs a digest that is stable per approved configuration, so the identity is split. `executionProfileDigest` (pinned launcher and executable, restrictions, ceilings, mount roles, flag template, fixed env, allowlisted env names, args) is identical across runs, workspaces, port instances and restarts and is what an operator lists; `launchPlanDigest` stays per launch and embeds it. `authorize` receives both; the pre-spawn recompute confirms both. `bun scripts/contained-profile.ts --config <port.json> --spec <spec.json>` prints it without launching.

**Delta-2 fixes (rev 56).** A repeat `rlm.invoke` keeps a spent admission spent; a failed dispatch disarms; an unclaimed admission expires; the claim needs the parent run and the parent's agent principal (the child run id is unknowable at admission). The profile now includes the egress socket's resolved path (the workspace stays out: SEA authorizes it as the case resource, the plan digest pins it by dev/inode). Loader and interpreter env names are refused at construction.

**Verified.** `test/containedLaunch.test.ts` 39/39, guard 8/8, real bwrap run 48/48 with the unit files, three times; wiring plus child-run 10/10. Example profile digest from the real run: `sha256:f3019826...03e8d8`. `test/J-RLM-contained-port.test.ts` (COGNATE_BWRAP_TESTS=1) observes each control from outside with positive controls; evidence JSON under `.tmp/evidence/114/`.

**Limits.** No seccomp or disk quota; `subprocess:false` is refused; RLIMIT_AS fails allocations rather than terminating; the output cap is checked per chunk; bwrap path-exec after a hash check has a narrowed, not eliminated, swap window; `prlimit` comes from the read-only runtime roots. The metering proxy is #115, authority binding is #116. Cognate does not export its bwrap argv builder.

**Next.** Review and merge; #115 and #116.

Plan: none. Spec: SEA-Forge #114. Full history is in `.agents/CURRENT_STATUS.jsonl`.
