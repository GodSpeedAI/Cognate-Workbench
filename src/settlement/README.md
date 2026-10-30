# settlement (Governed Proof Settlement)

## Overview

Governed settlement of an `agent.coding` run's consequential operations
(readiness P03/P05; journeys J-SW01-SETTLEMENT, J-SW02-PROOF-CONTRACT). After a
governed run ends, its edits, commands, and code run under a SEA-Forge allow are
settled by SEA-Forge on evidence RealityTrace produced: the proof the operator
declared for the workspace BEFORE the run started is the expectation; RealityTrace
runs it contained and read-only and derives evidence from the exit code; that
evidence is packaged per operation and submitted to SEA-Forge, which settles each
operation `settled`, `rejected`, or `unsettled`. Workbench never decides the
outcome. Every step is recorded, and a restart resumes from the record.
[launcher.ts] builds the bubblewrap containment the proof runs under;
[realitytrace.ts] is the CLI bridge to the RealityTrace binary; [sweSeed.ts]
imports the declared proof from a SWE_SEED contract; [orchestrator.ts] ties them
together.

## Interface

- [orchestrator.ts:CONSEQUENTIAL_CAPABILITIES] — capabilities whose effects settlement must account for (`tool.edit`, `tool.bash`, `tool.run_code`).
- [orchestrator.ts:PROOF_DECLARED] — event type `workbench.proof.declared`; [orchestrator.ts:SETTLEMENT_EVIDENCE] — `workbench.settlement.evidence`; [orchestrator.ts:SETTLEMENT_RECORDED] — `workbench.settlement.recorded`.
- [orchestrator.ts:SettlementOptions] — wiring: `authority`, `realitytrace`, `containment`, `getService`, `systemCaller`, `record`, optional `proofSource`.
- [orchestrator.ts:SettlementStatus] — `"settled" | "rejected" | "unsettled" | "refused" | "not-attempted"`.
- [orchestrator.ts:workspaceRoot] — resolves where a recorded workspace lives on the host from the `workspaces` projection.
- [orchestrator.ts:createSettlementOrchestrator] — returns `{ settleRun (serialized enqueue), onCommitted, sweep, idle }`.
- [launcher.ts:containedVerifierLauncher] — `(config, workspaceRoot) => Promise<string[]>` bubblewrap argv for the read-only verifier containment.
- [realitytrace.ts:RealityTraceSettings] — `{ bin, dataHome, stateHome }` (SEA-Forge must read the same homes to corroborate evidence); [realitytrace.ts:realityTraceFromEnv] — all three env vars (`COGNATE_REALITYTRACE_BIN/DATA_HOME/STATE_HOME`) or none; partial configuration is an error.
- [realitytrace.ts:PROOF_QUESTION] — the question every Workbench task proof answers (`workbench-task-proof`); [realitytrace.ts:DeclaredProof] — `{ argv, cwd, timeoutS }`; [realitytrace.ts:VerifiedProof] — evidence bundle returned by verification.
- [realitytrace.ts:RealityTraceCli] — CLI bridge: `run`, `ledger`, `ensureRepo` (idempotent enrollment + question/threshold declaration), `verify`.
- [sweSeed.ts:ENV_SWE_SEED_BIN] / [sweSeed.ts:ENV_PROOF_SOURCE] — env vars `COGNATE_SWE_SEED_BIN` / `COGNATE_PROOF_SOURCE`; [sweSeed.ts:ProofSourceMode] — `"any" | "swe_seed"`; [sweSeed.ts:SweSeedSettings]; [sweSeed.ts:SweSeedProofSource] — provenance recorded on declarations and settlement records; [sweSeed.ts:ExportedProof].
- [sweSeed.ts:sweSeedFromEnv] — env parsing (`any` default; `swe_seed` mode requires the binary; absolute paths only).
- [sweSeed.ts:normaliseSha256] — pins to `sha256:<lowercase 64-hex>`.
- [sweSeed.ts:SweSeedProofError] — error class with a refusal `code` (`unreadable_answer`, `failed`, `unexpected_answer`).
- [sweSeed.ts:exportSweSeedProof] — asks the pinned `swe-seed` binary for the proof a `checkId` declares; the answer is accepted only if it names the pinned digest and requested check (schema `swe_seed.eval_proof.v1`).

## Invariants

- Workbench never decides the settlement outcome: RealityTrace records the evidence, SEA-Forge settles (`settled`/`rejected`/`unsettled`/`refused`); every step is recorded and a restart resumes from the record (file header of [orchestrator.ts:createSettlementOrchestrator]).
- Only runs of the module-private [orchestrator.ts:SETTLED_AGENT] (`"agent.coding"`) with a `run.started` and a terminal event (`run.completed`/`run.failed`/`run.cancelled`) are settled; only successful (`meta.ok === true`) `run.invocation` events in [orchestrator.ts:CONSEQUENTIAL_CAPABILITIES] with a SEA-Forge `operationId` become operations.
- The expectation is the proof declared BEFORE the run started: a proof declared later cannot reach back ([orchestrator.ts:createSettlementOrchestrator] filters `PROOF_DECLARED` events by `position < started.position`); with no prior proof the run records `not-attempted` final.
- Under `COGNATE_PROOF_SOURCE=swe_seed`, a proof not sourced from a SWE_SEED contract records `not-attempted` ([orchestrator.ts:createSettlementOrchestrator]).
- Every settlement record names what judged the work: a `swe_seed_eval_spec` source or `operator_argv` ([orchestrator.ts:createSettlementOrchestrator]).
- The verifier containment mounts the workspace READ-ONLY at its own host path and nothing else — no RealityTrace data, no SEA-Forge socket, no home, no network — so verification cannot change what it judges ([launcher.ts:containedVerifierLauncher] file header; argv includes `--unshare-all`, `--cap-drop ALL`, `--clearenv`, `HOME=/nonexistent`).
- [launcher.ts:containedVerifierLauncher] refuses: a bubblewrap binary whose SHA-256 no longer matches the operator-verified digest, a workspace at `/` or not a directory, a launcher inside the workspace, runtime roots outside [launcher.ts:PUBLIC_ROOTS], any runtime-root/workspace overlap, zero usable runtime roots, or a Bun executable inside the workspace.
- RealityTrace settings are all-or-nothing: a partial env configuration throws, never silently disables ([realitytrace.ts:realityTraceFromEnv]); all three paths must be absolute.
- [realitytrace.ts:RealityTraceCli.verify] throws if RealityTrace ran a verifier other than the declared `command`, or if the evidence row is not found at the ledger position RealityTrace reported.
- [realitytrace.ts:RealityTraceCli.ensureRepo] enrolls a repo at most once and declares the question/threshold only when the ledger does not already contain them (idempotent enrollment).
- [sweSeed.ts:exportSweSeedProof] accepts a SWE_SEED answer only when its schema is `swe_seed.eval_proof.v1`, its `spec_sha256` matches the pin, and it names the requested `check_id`; the pin must be 64 hex digits, optionally `sha256:`-prefixed ([sweSeed.ts:normaliseSha256]).
- Runs are settled one at a time, in order ([orchestrator.ts:createSettlementOrchestrator] `enqueue` promise chain); already-settled operations are skipped by scanning prior `SETTLEMENT_RECORDED` records with `final === true`.
- Settlement errors are caught and logged (`console.warn`), never crash the orchestrator; a non-ok RealityTrace verification records a non-final `not-attempted` with the reason.

## Side Effects

- Reads the durable event log via `service.events` (run events, all later events, all events for proof lookup) and `service.listRuns` for boot sweeps; reads the `workspaces` projection ([orchestrator.ts:workspaceRoot]).
- Durably records `workbench.proof.declared`-derived evidence: emits `workbench.settlement.evidence` and `workbench.settlement.recorded` events via `options.record` (correlationId `settlement:<runId>`).
- Network/IPC to SEA-Forge: `SeaForgeAuthority.submitEvidence` and `SeaForgeAuthority.settle` over the configured socket path.
- Spawns external processes: the `realitytrace` binary ([realitytrace.ts:RealityTraceCli.run] via `Bun.spawn`, JSON mode, scoped `XDG_DATA_HOME`/`XDG_STATE_HOME` env) and the pinned `swe-seed` binary ([sweSeed.ts:exportSweSeedProof] via `Bun.spawn`, killed after `timeoutMs`, default 30 000 ms).
- Filesystem: [realitytrace.ts:RealityTraceCli.ensureRepo] creates and removes a temp dir (`mkdtemp` under `os.tmpdir()`) for question/threshold declaration files; [launcher.ts:containedVerifierLauncher] reads the bubblewrap binary for hashing and `realpath`/`stat` checks.
- In-process serialization: the `enqueue` promise chain and `idle()` in [orchestrator.ts:createSettlementOrchestrator]; `console.warn` on settlement failure.

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-RT-realitytrace.test.ts`, `test/J-SW01-SETTLEMENT.test.ts`, `test/J-SW02-PROOF-CONTRACT.test.ts`, and `test/settlement-config.test.ts` (all verified present under `test/`).
