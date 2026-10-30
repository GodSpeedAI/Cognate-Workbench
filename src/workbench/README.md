# Workbench Domain Core (src/workbench)

## Overview

Pure domain layer of the Cognate Workbench app (Unified Harness Experience Model v2): shared vocabulary, the event-sourced projection fold, task-contract validation, the authority/protection decision plane, the evidence ledger and readiness gates, done taxonomy, workflow graph scheduling, capability (Skill OS) lifecycle, automation lifecycle with timezone-aware schedules, steering inboxes, shared attention/focus, usage economics, work-unit parallelism analysis, and the pure primitives (glob matching, shell-command analysis) that back the authority plane. Modules here are pure or near-pure: the durable truth is the `workbench.*` event log folded by `reducer.ts`; projection rows are derived and rebuildable. The authoritative IDM lives in `.sea/interaction/interaction-model.sea` and is loaded in place elsewhere; nothing here re-states it. The two impure touchpoints are `gitOps.ts` (Git via an execution-world provider) and `automation.ts` (timezone data via `Intl`); the app entry point (`src/server.ts`) and persistence (`src/store.ts`) live outside this package.

## Interface

### Vocabulary and projection shapes
- `src/workbench/types.ts:Grant`, `types.ts:AuthorityScopes`, `types.ts:Invariant`, `types.ts:AcceptanceCriterion`, `types.ts:ExecutorBinding`, `types.ts:Budget`, `types.ts:TaskContract`, `types.ts:CONTRACT_FIELDS` — task-contract vocabulary; authority is inspectable scopes (`filesystem`/`shell`/`network`/`packages`/`extensions` + `protectedPaths`), not a single mode.
- `types.ts:TaskStatus`, `types.ts:DoneLevel` — the nine board states and the seven-level done taxonomy ("done is not a single event"; the UI must not collapse these levels).
- `types.ts:EvidenceEntry`, `types.ts:EvidenceKind`, `types.ts:EvidenceStatus`, `types.ts:WorkerReturn` — evidence ledger rows and the §9 worker return contract (`changed` → `tested` → `evidence` → `remaining`, plus `risks` and `readyForReview`).
- `types.ts:WorkflowNode`, `types.ts:WorkflowEdge` (edge `mode: "needs" | "after"`), `types.ts:WorkflowDefinition`, `types.ts:NodeStatus`, `types.ts:AuthorityLevel` — workflow graph vocabulary.
- `types.ts:CapabilityContractDef`, `types.ts:ImplementationBinding`, `types.ts:CAPABILITY_LIFECYCLE`, `types.ts:CapabilityState`, `types.ts:AUTOMATION_STATES`, `types.ts:AutomationState`, `types.ts:ExecutionSubstrate`, `types.ts:SteerMode`, `types.ts:InboxMessage` — Skill OS, automation, and steering vocabulary.
- `types.ts:WORKBENCH_EVENTS` — the closed list of 28 `workbench.*` event types the fold understands, including the governed-settlement trio (`workbench.proof.declared`, `workbench.settlement.evidence`, `workbench.settlement.recorded`) and the J-CHECKOUT pair (`workbench.checkout.bound`, `workbench.checkout.removed`).
- `src/workbench/state.ts:TaskRecord`, `state.ts:TaskScope`, `state.ts:ScopedTaskRecord`, `state.ts:WorkflowInstanceRecord`, `state.ts:CapabilityRecord`, `state.ts:BindingRecord`, `state.ts:AutomationRecord`, `state.ts:UsageRow`, `state.ts:FeedbackRecord`, `state.ts:ElevationRecord`, `state.ts:BlockedRecord` — shapes of the public `workbench` projection rows.

### Event fold and projection
- `src/workbench/reducer.ts:Write`, `reducer.ts:reduceWorkbench(eventType, payload, recordedAt, eventId, get)` — pure fold of one `workbench.*` event into `Write[]` keyed `task/<id>`, `evidence/<taskId>/<id>`, `workflow/<id>`, `instance/<id>`, `capability/<id>`, `binding/<capabilityId>/<implementationId>`, `automation/<id>`, `usage/<scope>`, `inbox/<sessionId>`, `feedback/<id>`, `elevation/<workspaceId>`, `blocked/<eventId>`; unknown event types return `[]`.
- `reducer.ts:usageScope(taskId, sessionId)` — usage key falls back to `session:<sessionId>` when no task id.

### Task contract
- `src/workbench/contract.ts:contractMissing(c)` — per-field completeness rules (context needs `workspaceId`; goal needs `outcome`; `skills`/`executors`/`invariants` need >= 1; `acceptance` needs at least one criterion with `required: true`).
- `contract.ts:isContractComplete(c)`, `contract.ts:defaultAuthority()` (read-only, deny-everything-else default), `contract.ts:contractChips(c)` / `contract.ts:ContractChip` — UI chips rendering each of the eight `CONTRACT_FIELDS` as `set`/`missing`.

### Authority and protection plane
- `src/workbench/authority.ts:Decision`, `authority.ts:normalizeRelative(relPath)`, `authority.ts:matchesProtected(patterns, relPath)` — outcome is `allow`/`approval`/`deny`; protected patterns are `dir/`, bare name/glob (matched against basename and full path), or path globs via `glob.ts:globMatch`.
- `authority.ts:decideWrite(scopes, relPath, opts?)`, `authority.ts:decideShell(scopes, cmd, opts?)` — the structural gate; `decideShell` checks `mutationTargets` against protected paths first, then combines `shell.run`, `shell.destructive` (`shellSafety.ts:isDestructiveCommand`), `network.outbound` (`shellSafety.ts:usesNetwork`), and `packages.install` (`shellSafety.ts:installsPackages`) with the strictest outcome winning (`authority.ts:STRICTNESS`, `authority.ts:strictest`).
- `authority.ts:describeAuthority(scopes)` / `authority.ts:AuthorityRow` — inspectable rows, one per grant plus an `immutable` row per protected pattern.
- `authority.ts:isDestructiveCommand` — re-exported from `shellSafety.ts`.

### Shell analysis primitives
- `src/workbench/shellSafety.ts:tokenize(cmd)`, `shellSafety.ts:splitCommands(cmd)` — quote/backslash-aware tokenizer; splits on `&&`, `||`, `;`, `|`, `&`, newline and recursively unwraps `sudo`, `env`, `nohup`, `time`, `command`, `xargs`, `bash|sh|zsh -c`, `$(...)` and backticks (`shellSafety.ts:unwrapCommand`).
- `shellSafety.ts:isDestructiveCommand(cmd)` — `rm -r/-f`, `git reset --hard`, `git clean -f`, `git push --force`, `git restore`, `git branch -D`, `mkfs*`, `dd of=`, `chmod/chown -R`, `shred`, `truncate`, `find -delete/-exec rm`, SQL `DROP TABLE/DATABASE`, device redirects, fork bombs, `curl | bash`, plus whole-string regex fallbacks.
- `shellSafety.ts:mutationTargets(cmd)` / `shellSafety.ts:MutationTarget` — paths a command may write/delete (`rm`, `mv`, `cp`, `touch`, `tee`, `shred`, `dd of=`, `sed/perl/ruby -i`, `git checkout --`/`restore`, `install`, `ln`, redirections `>`/`>>`/`1>`/`2>`/`&>`; `/dev/null` and `NUL` excluded).
- `shellSafety.ts:commandKey(tokens)` — arity-table command key (`ARITY` covers `git`, `npm`, `bun`, `docker`, `cargo`, `kubectl`, `pnpm` prefixes).
- `shellSafety.ts:usesNetwork(cmd)`, `shellSafety.ts:installsPackages(cmd)` — network tools and remote-syntax `rsync`/`git clone|fetch|pull|push`; package-manager install/add detection.

### Glob matching
- `src/workbench/glob.ts:globToRegExp(pattern)` — anchored POSIX-path regex; `*`, `**` (incl. `**/` and trailing `/**`), `?`, `[abc]`/`[!abc]`, `{a,b}` brace alternation, backslash escapes, regex-metachar escaping.
- `glob.ts:globMatch(pattern, path)`, `glob.ts:isGlob(pattern)`.

### Evidence ledger, readiness, done taxonomy
- `src/workbench/ledger.ts:LedgerRow`, `ledger.ts:ledgerRows(acceptance, entries)` — one row per criterion with state `closed`/`failed`/`open` (a later `fail` reopens a previously closed criterion).
- `ledger.ts:openRequired(rows)` — required rows not closed.
- `ledger.ts:LedgerGroup`, `ledger.ts:groupLedger(entries)` — fixed group order Domain/Implementation/Tests/Runtime/Quality/Review with marks ✓/✗/○.
- `ledger.ts:reviewReadiness(input)` / `ledger.ts:Readiness` — V-008+V-009 gate with stable blocker wording (missing worker return, unreported changed/tests/evidence, undeclared remaining, not-declared ready, dangling evidence ids, open required non-`human` criteria, "independent check required but tests alone passed").
- `ledger.ts:acceptanceReady(input)` — ACCEPTED gate; the `human` criterion closes via `humanApproved` or a passing `human` entry.
- `ledger.ts:doneLevel(input)` — highest contiguous satisfied `DoneLevel` (non-contiguous states cap the level, e.g. accepted without readiness caps at `tested`).
- `ledger.ts:artifactVerification(evidenceIds, entries)`, `ledger.ts:evidenceClosureForTask(entries)`.

### Workflow scheduling
- `src/workbench/workflow.ts:validateWorkflow(def)` — duplicate ids, unknown edge/onFailure targets, self-edges, `after` edges with `evidenceRequired`, review nodes without incoming edges, cycles (`workflow.ts:detectCycles`).
- `workflow.ts:nodeDone(def, nodeId, status, closed)` — done for scheduling only when status is `done` AND every kind in `node.acceptance` is in `closed[nodeId]`.
- `workflow.ts:readyNodes(def, status, closed)` — `needs` edges require `nodeDone(source)` plus `evidenceRequired` closed; an optional source with status `skipped` also satisfies a needs-edge; `after` edges require the source to settle (`done|failed|skipped`).
- `workflow.ts:parallelLayers(def)` — Kahn's-algorithm layers; throws `Error("workflow has a cycle")`.
- `workflow.ts:nextTransitions(def, nodeId)` / `workflow.ts:Transition`, `workflow.ts:failureRoute(def, nodeId)`, `workflow.ts:retryable(def, nodeId, status)`, `workflow.ts:workflowView(def, status, closed)` / `workflow.ts:WorkflowView` — cockpit classification (`currentStage`/`active`/`blocked`/`reviewGates`/`completed`/`failed`/`retryable`/`optional`/`unlocked`).
- `workflow.ts:frontendProductActualization()` — seed workflow `wf.frontend-product-actualization` (16 nodes, guard branches on "direction accepted"/"direction not accepted", `review -> accept` edge with `auto: false`).
- `workflow.ts:documentWorkflow()` — seed workflow `wf.weekly-sales-report`.

### Skill OS (capabilities)
- `src/workbench/skillOs.ts:nextLifecycle(state)`, `skillOs.ts:advanceLifecycle(from, to)` / `skillOs.ts:LifecycleResult`, `skillOs.ts:canInvoke(state)`, `skillOs.ts:isTrusted(state)` — lifecycle helpers over `CAPABILITY_LIFECYCLE`.
- `skillOs.ts:seedCatalog()` — 17 `CapabilityContractDef` seeds (`capability.product-briefing` … `capability.automation-scheduling`), each with `consumes`/`produces`/`authority`/`acceptance`/`owns`.
- `skillOs.ts:seedBindings()` — six `ImplementationBinding` seeds (e.g. `impl.playwright`, `impl.impeccable-polish`).
- `skillOs.ts:checkSubstitution(contract, oldBinding, newBinding)` / `skillOs.ts:Substitution` — V-002 substitution validation.
- `skillOs.ts:bindingsFor(bindings, capabilityId)`, `skillOs.ts:detectConflicts(catalog, active)` / `skillOs.ts:Conflict` (ownership via `owns` plus explicit `conflicts`), `skillOs.ts:packageProvides(provider, bindings)`, `skillOs.ts:creationSteps()` — the 13 create-capability steps.

### Automation
- `src/workbench/automation.ts:Schedule`, `automation.ts:nextFire(schedule, after)` — next strictly-after instant for a daily/weekly wall-clock schedule in an IANA timezone (DST gap and overlap handled by `automation.ts:buildUtcForLocalTime`; invalid timezone throws).
- `automation.ts:describeSchedule(s)`, `automation.ts:AutomationRun`, `automation.ts:newAutomation(input)`.
- `automation.ts:advance(run, to, facts?)` / `automation.ts:AutomationResult` — V-012 lifecycle validation with gates (see Invariants).
- `automation.ts:deliveryReceipt(run)` — a receipt only means SCHEDULED → DISPATCHED.
- `automation.ts:substrateNote(substrate)` — label + `survivesQuit` per `ExecutionSubstrate`; `automation.ts:isTerminal(state)`.

### Steering inbox
- `src/workbench/steering.ts:Inbox`, `steering.ts:emptyInbox()`, `steering.ts:enqueue(inbox, msg)` — routes by `mode` into `nextStep` (`steer-now`) or `nextTurn` (`queue-next`).
- `steering.ts:drainStep(inbox)` (drain all steer-now, FIFO), `steering.ts:drainTurn(inbox)` (first queued turn message), `steering.ts:foldInbox(events)` (rebuild from enqueued/consumed events), `steering.ts:pendingCount(inbox)`, `steering.ts:steeringReflection(msgs)` — `[user steering]` injection text.

### Focus and attention
- `src/workbench/focus.ts:FocusRef`, `focus.ts:FocusKind`, `focus.ts:ATTENTION_PRECEDENCE`, `focus.ts:HumanAttention`, `focus.ts:ResolvedAttention`, `focus.ts:resolveAttention(a)` — precedence resolution; `focus.ts:refKey(r)` dedup key `<workspaceId>:<kind>:<id>`.
- `focus.ts:AttentionSnapshot`, `focus.ts:captureSnapshot(id, a, capturedAt)` — frozen snapshot; `focus.ts:REFERENCE_WORDS`, `focus.ts:resolveReferent(query, snapshot)` (whole-word reference detection, ambiguity flag), `focus.ts:referentLine(snapshot)`, `focus.ts:withReferent(message, snapshot)`, `focus.ts:describeFocusRef(r)`.
- `focus.ts:SharedFocus`, `focus.ts:emptySharedFocus()`, `focus.ts:FocusCandidate`, `focus.ts:proposeCandidate(input)`, `focus.ts:canPropose(candidate, existing)`, `focus.ts:acceptCandidate(focus, c, actorKind, resolvedBy)`, `focus.ts:rejectCandidate(c, actorKind, resolvedBy)`, `focus.ts:pinFocus(focus, ref, actorKind)`, `focus.ts:unpinFocus(focus, ref, actorKind)`, `focus.ts:clearFocus(focus, actorKind)`, `focus.ts:FocusAuthorityError` — human-gated shared focus mutations.

### Usage economics and routing
- `src/workbench/economics.ts:UsageRecord`, `economics.ts:TaskEconomics`, `economics.ts:rollupUsage(taskId, records)` — per-executor rollup in first-seen order; token/cost sums; call counts by `kind`; `peakConcurrency`.
- `economics.ts:BudgetLevel`, `economics.ts:BudgetState`, `economics.ts:budgetState(budget, econ, elapsedMs?)` — ok/warn(>=80%)/exceeded lines for tokens, cost, concurrency, time.
- `economics.ts:ExecutorProfile`, `economics.ts:routeExecutor(task, profiles)` — tier routing (deterministic for `test`/`build`/`lint`/`file-hash`/`browser-journey`, strong for architecture-ish tasks, cheap for bounded work with fallback to strong), sorted by cost then id.
- `economics.ts:costToVerifiedAcceptance(econ, extra)`, `economics.ts:provenanceLine(econ)`.

### Parallelism planning
- `src/workbench/parallelism.ts:WorkUnit`, `parallelism.ts:Verdict`, `parallelism.ts:PairAssessment`, `parallelism.ts:assessPair(a, b)` — `shared-dependency` on file overlap, write/read overlap, shared design tokens, shared business rules, or dependency ordering.
- `parallelism.ts:ParallelPlan`, `parallelism.ts:planParallelism(units, opts?)` — greedy grouping under `maxConcurrency`, `architectOwned` shared resources, `sequential` ids, `mergeSurface` count, recommendation string.

### Task checkouts (Git worktrees)
- `src/workbench/gitOps.ts:WORKTREE_CAPABLE_WORLD_KINDS` — `local`, `wsl`, `ssh`; other world kinds must be refused by the caller (fail closed).
- `gitOps.ts:runGit(provider, cwd, args, options?)` / `gitOps.ts:GitOutput` — the single process spawner (`provider.process.exec` with explicit argv, 256 KiB default output clip, 30 s default timeout; timeout throws). `gitOps.ts:mustGit(output, what)` — fail on required success.
- `gitOps.ts:isRepository`, `gitOps.ts:currentBranch`, `gitOps.ts:listBranches` / `gitOps.ts:BranchList` (most recent first, max 200, default branch from origin HEAD or main/master), `gitOps.ts:refExists`.
- `gitOps.ts:checkoutBranchName(branch)` (validates and namespaces `workbench/…`), `gitOps.ts:validStartPoint(base)`, `gitOps.ts:worktreeDestination(root, branch)` (`<repo>-worktrees/` sibling layout).
- `gitOps.ts:parseWorktreeList(text)` / `gitOps.ts:WorktreeEntry`, `gitOps.ts:worktreeList`, `gitOps.ts:createWorktree` / `gitOps.ts:CreateWorktree` (refuse colliding branch unless `existing`, refuse existing+base, refuse existing destination folder).
- `gitOps.ts:worktreeExists`, `gitOps.ts:worktreeStatus` / `gitOps.ts:WorktreeStatus` (read-only observation: changes, upstream, ahead, pending, merged), `gitOps.ts:hasTrackedChanges`.
- `gitOps.ts:mergeWorktree` / `gitOps.ts:WorktreeMerge`, `gitOps.ts:MergeConflictError` — abort-and-report on conflict; `gitOps.ts:removeWorktree` / `gitOps.ts:WorktreeRemoval` (no force, `-d` only), `gitOps.ts:recreateWorktree`.

### Grounded feedback and scoped focus view
- `src/workbench/grounded.ts:GroundedFeedback`, `grounded.ts:validateGroundedFeedback(fb)` — selector, positive-integer viewport, non-empty `preserve` (a repair must be bounded) and `verify` are required.
- `grounded.ts:renderChangeContract(fb)`, `grounded.ts:bindsRepairScope(fb, touchedFiles)` — bounded iff every touched file is `target.file`, matches `target.component`, or is the sibling `.css`/`.module.css` of `target.file`'s basename.
- `grounded.ts:ScopedMetric`, `grounded.ts:FocusView`, `grounded.ts:describeFocus(reference, focus?)` — a focus must narrow to a different scope (throws otherwise).

### Checkout presentation logic
- `src/workbench/checkoutUi.ts:BranchListLike`, `checkoutUi.ts:suggestBranchName(title, taskId)` (title slug, task id fallback), `checkoutUi.ts:checkoutStatusText(status)`, `checkoutUi.ts:canMerge(status)`, `checkoutUi.ts:mergeOutcomeText(result)`.

## Invariants

- The `workbench.*` event log is the durable truth; every projection row is derived and rebuildable — `reducer.ts` performs no persistence and only returns `Write[]` keyed without tenant prefix; the projection wrapper adds the tenant prefix (`reducer.ts:reduceWorkbench` header contract).
- `reducer.ts:USAGE_CAP` (`200`) caps each `usage/<scope>` row's `records` to the last 200; `workbench.task.activity` dedupes `changed` and caps `commands` to the last 30.
- J-TASK-move: `workbench.task.moved` rewrites where a task is available, never its identity, evidence rows, or run lineage; `ScopedTaskRecord.originWorkspaceId` is set once and carried forward; a cross-workspace move of a session-scoped task promotes it to workspace scope (`reducer.ts:reduceWorkbench` case `workbench.task.moved`).
- `workbench.review.decided` with `decision === "accept"` sets status ACCEPTED and `humanApproved: true`; otherwise REWORK (`reducer.ts:reduceWorkbench` case `workbench.review.decided`). `workbench.worker.returned` sets `finished: true` and `produced` only when `changed` is non-empty.
- `workbench.protection.blocked` writes a `BlockedRecord` keyed by `eventId` and, when the blocked path has a `taskId`, derives an `integrity`/`pass` evidence entry `blk-<eventId>` — the block itself is observable evidence (`reducer.ts:reduceWorkbench` case `workbench.protection.blocked`).
- Protected evidence is enforced structurally before any grant: `decideWrite` checks `matchesProtected` before the `fs.write` grant, and `decideShell` checks `mutationTargets` first; paths that escape the workspace are never covered by workspace-relative protection and fall to the `outsideWorkspace` grant (`authority.ts:decideWrite`, `authority.ts:decideShell`).
- In shell decisions the strictest outcome wins across all applicable concerns (`allow` < `approval` < `deny`), reported with the most specific rule that produced it (`authority.ts:STRICTNESS`, `authority.ts:strictest`).
- Shell analysis biases to escalation: the whole-string destructive fallbacks (SQL `DROP`, device redirects) may produce false positives, never false negatives (`shellSafety.ts:isDestructiveCommand`).
- Dotfiles are matchable by `*` in `glob.ts:globToRegExp` on purpose, so protected-path patterns cannot be bypassed with a leading dot.
- Capability lifecycle is linear: `advanceLifecycle` allows only the immediate next state of `CAPABILITY_LIFECYCLE`; `canInvoke` is true only for ENABLED/EXERCISED/VERIFIED/AVAILABLE; `isTrusted` only for VERIFIED/AVAILABLE (`skillOs.ts:advanceLifecycle`, `skillOs.ts:canInvoke`, `skillOs.ts:isTrusted`).
- V-002: a binding substitution is incompatible if it targets a different capability, reuses the same `implementationId`, or swaps a verifier (contract has `verify` authority) from `deterministic` to `llm` (`skillOs.ts:checkSubstitution`).
- Automation lifecycle (V-012): only the immediate next state of `AUTOMATION_STATES` or FAILED from any non-terminal; COMPLETE and FAILED are terminal; PRODUCED requires non-empty outputs; VERIFIED requires every id in `run.acceptance` present in the merged `closedAcceptance`; COMPLETE requires current state VERIFIED; FAILED requires `facts.failure` (`automation.ts:advance`).
- Ledger criterion state: a later `fail` reopens (`ledger.ts:ledgerRows`). `reviewReadiness` never blocks on a required `human` criterion (that is the review itself) and enforces V-009 ("independent check required but tests alone passed") (`ledger.ts:reviewReadiness`).
- `doneLevel` is contiguous: each level requires the previous, and an out-of-order state caps the level (`ledger.ts:doneLevel`). An artifact is `verified` only with non-empty evidence ids all present and passing (`ledger.ts:artifactVerification`).
- Workflow scheduling: a node is done only with its acceptance evidence closed (`workflow.ts:nodeDone`); failed sources never satisfy needs-edges except an optional source with status `skipped`; a failed node is retryable only when all needs-sources are done (`workflow.ts:readyNodes`, `workflow.ts:retryable`); `parallelLayers` throws on cycles.
- Steering: `enqueue` rejects blank text and is idempotent on duplicate ids across both queues; queues are frozen arrays (`steering.ts:enqueue`, `steering.ts:emptyInbox`).
- Focus never leaks across workspaces: `resolveAttention` filters every candidate by `workspaceId`; snapshots are frozen at capture (`focus.ts:resolveAttention`, `focus.ts:captureSnapshot`).
- Human-only focus authority: `acceptCandidate`, `rejectCandidate`, `pinFocus`, `unpinFocus`, and `clearFocus` throw `FocusAuthorityError` unless `actorKind === "user"`; `canPropose` blocks re-proposing an identically rejected candidate with the same `evidenceToken` (`focus.ts:acceptCandidate`, `focus.ts:canPropose`).
- Git worktrees: nothing forces — removal relies on Git's own dirty refusal plus a pre-check, branch deletion uses `-d` only (an unmerged branch is kept and reported in `note`), a conflicted merge is aborted (`git merge --abort`) and thrown as `MergeConflictError` leaving both checkouts unchanged, and the project's own checkout cannot be removed (`gitOps.ts:removeWorktree`, `gitOps.ts:mergeWorktree`).
- All Git invocations go through `gitOps.ts:runGit` (the single spawner) with explicit argv via the execution-world provider — never a host shell, never string interpolation; a non-worktree-capable world kind must be refused by the caller (`gitOps.ts:WORKTREE_CAPABLE_WORLD_KINDS`).
- Grounded repair must be bounded: `validateGroundedFeedback` requires non-empty `preserve`, and `bindsRepairScope` reports any touched file outside the target file/component/sibling-stylesheet scope (`grounded.ts:validateGroundedFeedback`, `grounded.ts:bindsRepairScope`).
- Usage economics: unknown cost is not zero — `rollupUsage` yields `costUsd: undefined` when no record carries a cost, and `budgetState` treats unknown cost as `ok` (`economics.ts:rollupUsage`, `economics.ts:budgetState`).
- A focus metric must narrow to a different scope than its reference, or `describeFocus` throws (`grounded.ts:describeFocus`).

## Side Effects

- Process execution: `gitOps.ts:runGit` spawns `git` through the workspace's execution-world provider (`provider.process.exec` with explicit `argv`, `cwd`, `timeoutMs`); it is the only function in `gitOps.ts` that starts a process.
- Filesystem observation via the provider: `gitOps.ts:createWorktree` and `gitOps.ts:worktreeExists` call `provider.fileSystem.stat` (destination collision check; `.git` file probe); `gitOps.ts:recreateWorktree` stats the destination path.
- Derived state writes: `reducer.ts:reduceWorkbench` returns `Write[]` rows that the projection wrapper applies to the PostgreSQL-backed store (`src/store.ts`, outside this package); the reducer itself is pure.
- Environment/locale reads: `automation.ts:nextFire` (through `automation.ts:buildUtcForLocalTime` and `automation.ts:getWeekdayInTimezone`) reads `Intl.DateTimeFormat` timezone data and throws on an invalid IANA timezone.
- Pure modules with no side effects (state mutation, network, disk, locks): `types.ts`, `state.ts`, `contract.ts`, `authority.ts`, `shellSafety.ts`, `glob.ts`, `ledger.ts`, `workflow.ts`, `skillOs.ts`, `economics.ts`, `parallelism.ts`, `steering.ts`, `focus.ts` (beyond `Object.freeze` calls in `steering.ts:emptyInbox`/`steering.ts:enqueue` and `focus.ts:captureSnapshot`), `grounded.ts`, `checkoutUi.ts`.

## Verification

- Run (from repo root): `bun run test` (= `bun test --timeout 15000 test`)
- Direct unit coverage of this directory: `bun test test/workbench-authority.test.ts test/workbench-authority-bypass.test.ts test/workbench-automation.test.ts test/workbench-contract.test.ts test/workbench-economics.test.ts test/workbench-focus.test.ts test/workbench-glob.test.ts test/workbench-grounded.test.ts test/workbench-ledger.test.ts test/workbench-parallelism.test.ts test/workbench-shellsafety.test.ts test/workbench-skillos.test.ts test/workbench-steering.test.ts test/workbench-workflow.test.ts test/git-ops.test.ts`
- Journey suites exercising this layer: `bun test test/J-WB-task-contract.test.ts test/J-WB-review-gate.test.ts test/J-WB-steering.test.ts test/J-WB-economics.test.ts test/J-WB-workflow.test.ts test/J-WB-parallelism.test.ts test/J-WB-grounded-feedback.test.ts test/J-CHECKOUT-lifecycle.test.ts test/J-SEA-FORGE-AUTHORITY.test.ts`
- Type checking: `just typecheck`
