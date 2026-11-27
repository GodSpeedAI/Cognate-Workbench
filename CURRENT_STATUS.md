# Current status — revision 59

SEA-Forge #114 (Workbench half): a contained bubblewrap `StdioSpawnPort` for recursive child runs.

**Behaviour.** `src/capabilities/containedStdioPort.ts` implements Cognate's `StdioSpawnPort` and is built only from trusted host configuration, `ServerOptions.rlmContainedPort`. Absent (default) means Cognate's `unavailableSpawnPort()`, so ordinary execution and every current refusal are unchanged. With it, `rlmGoverned.providerRefusal` admits a no-network contained provider and still refuses open egress.

**Launch plan and digest.** `src/capabilities/containedLaunch.ts` resolves each spec into a canonical record: pinned executable and launcher (path, sha256), the full sandbox argv, read-only workspace, network `none` or one host unix socket, ceilings (wall, CPU, address space, nofile, nproc, output bytes), env allowlist. `launchPlanDigest(plan)` = `sha256:<hex of canonical JSON>`; ticket #116 binds an authority decision to it through the optional `authorize` hook. The plan is recomputed and compared just before spawn; drift refuses.

**Spawn and teardown.** `--unshare-all` (net, pid, user), `--die-with-parent`, `--new-session`, cleared env, read-only workspace and runtime roots, tmpfs `/tmp`, minimal `/dev`, caps dropped, `prlimit` ceilings, line streaming with bounded output, line length and stderr. `kill`, wall-clock, and ceilings kill the process group and pid namespace, then check the host `/proc` for survivors; teardown is idempotent and records the exit.

**Refusals before spawn** (typed Cognate codes, never a fallback): missing or digest-mismatched launcher, unpatched launcher, user namespaces unavailable, unpinned or digest-mismatched executable, executable or launcher in a writable root, outbound network other than the host socket, unenforceable filesystem, subprocess or cap requests.

**Execution profile (rev 55).** Policy needs a digest that is stable per approved configuration, so the identity is split. `executionProfileDigest` (pinned launcher and executable, restrictions, ceilings, mount roles, flag template, fixed env, allowlisted env names, args) is identical across runs, workspaces, port instances and restarts and is what an operator lists; `launchPlanDigest` stays per launch and embeds it. `authorize` receives both; the pre-spawn recompute confirms both. `bun scripts/contained-profile.ts --config <port.json> --spec <spec.json>` prints it without launching.

**SEA-Forge authority (rev 58, #116 host half).** The port's `authorize` hook asks SEA-Forge through the existing `SeaForgeAuthority.decide` route, claiming `execution_profile_digest` on the `rlm.invoke` capability, and launches only on a `boundary` allow with exactly one `execution_profile` constraint equal to the digest and a plan that embeds it. Deny, escalate, plain allow, wrong, missing or duplicate digest, unreachable, silent or malformed SEA-Forge: refused before spawn (`rlm-profile-unauthorized`). `startServer` composes it from the external authority, else refuses. Rev 59: port requires `authorize` (construction throws); a decision with no ledger entry is refused. Evidence: digests and decision id only.

**Verified.** Real bwrap run 67/67 (unit, guard, authority), three times; authority 18/18 against a stand-in SEA-Forge socket; wiring plus child-run 19/19.

**Limits.** No seccomp or disk quota; `subprocess:false` is refused; RLIMIT_AS fails allocations rather than terminating; the output cap is checked per chunk; bwrap path-exec after a hash check has a narrowed, not eliminated, swap window; `prlimit` comes from the read-only runtime roots. The metering proxy is #115, authority binding is #116. Cognate does not export its bwrap argv builder.

**Next.** Review and merge; #115; a live SEA-Forge check.

Plan: none. Spec: SEA-Forge #114. Full history is in `.agents/CURRENT_STATUS.jsonl`.
