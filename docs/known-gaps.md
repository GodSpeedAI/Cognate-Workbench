# Known gaps

What is deliberately incomplete, what is recorded intent with no execution behind it, and which
documented promises the code does not yet keep. The rule here is the project's own: an incomplete
feature is recorded, not quietly shipped.

## How to read this

Entries are one of three kinds:

- **Gap** — something the model or plan describes that is not built.
- **Intent** — machinery that records or renders, with nothing acting on it.
- **Conflict** — a live disagreement between a stated rule and the implementation.

Anything marked *recovered* comes from legacy documents removed from version control. See
[Evolution and provenance](explanation/evolution-and-provenance.md) for what that means for
confidence.

## Recorded intent, not execution

These render or record faithfully and do nothing else.

| Feature | Actual behaviour |
|---|---|
| Capability substitution | Recorded. Does not rebind a running tool. |
| Parallelism plans | Recorded. Do not start workers. |
| Legacy automation records | Stored accepted-workflow intent still needs explicit migration. Native Expert/Team schedules now execute due work; see [schedules](schedules.md). |
| Legacy budget information | Workbench planning economics remain informational. Expert Assignment attempts enforce configured model limits before invocation, and session/global spending ceilings now fail closed with unknown prices rendered as unknown (T5). |
| Composer / child usage | Main composer counts actual turns/steps; unknown child usage is explicitly unavailable. Expert assignments expose provider usage and labeled estimates. No measured token-per-second rate is claimed. |
| Trajectory / developer tools | Present as a read view over the trace. |

The honest convention from `src/ui/workbench/UX.md` rule 9 is that an unreported number renders as
`unknown` or `n/a`. The historical fabricated-zero finding is closed by the actual current renderer
and `test/ui-observability.test.tsx`; unknown prices and usage remain unknown.

## Plan sections not built

From the workbench design source:

- The artifact model and preview fidelity.
- Variant experimentation and worktree isolation.
- The global Board, and Evidence/Reviews navigation.
- Settings pages for executors and economics. Experts and Teams now have native management surfaces.
- The original generic `subagent.start` remains fire-and-forget. Native Teams use separate governed
  Assignments, genuine Cognate runs and correlated continuation returns; see [Experts and Teams](experts-and-teams.md).
- Role-aware routing applied to executor choice — `routeExecutor` exists and is tested; nothing calls
  it.
- `BACKLOG` and `BLOCKED` board states are defined in the model, but no UI action sets them.

## Experts and Teams limits

- Published Cognate0.6.1 provides bounded native concurrency and awaitable admission. Workbench
  defaults to capacity1; host opt-in1/2/4/8 enables overlapping execution. Model-only solo Experts
  and Specialists overlap freely; tool-bearing Experts and coding sessions are admitted per
  canonical workspace (disjoint workspaces overlap, shared workspaces serialize, forged identities
  fail closed to serialized exclusion). Team admission and batching now resolve from authoritative
  Team limits (T2): a Team exceeding its `maxConcurrentRuns` waits even when process capacity is
  free, queued roots dispatch in the Team's `admissionBatch`, and client-supplied policy is refused.
  Admission is process-local by SDK contract; multi-process operation exists behind the verified
  `runOwnership` configuration (T7). A key-waiting run occupies one bounded dispatch slot.
  Parallelism plans remain advisory. See [measured capacity evidence](experts-concurrency-benchmark.md).
- Native one-time/daily/weekly Expert and Team schedules execute independently of the browser,
  recover after process termination, and retain occurrence receipts. Legacy automation workflows
  are not automatically converted. Schedule state remains one CAS aggregate; high-volume history
  partitioning and distributed evaluator ownership remain open.
- Shared Team live messages are durably accepted, then incorporated at a recorded safe decision
  boundary. Pending, incorporated, cancelled, superseded and late states are distinct. No arbitrary
  interruption of an active provider call is claimed. Idle recipients retain next-assignment queueing;
  a generalized SDK inbox and standalone live steering remain open. Mentions guide coordination.
- Memory retrieval uses bounded lexical search and recent scoped context, without embeddings or
  automatic model-generated trusted summaries. Context selection retains its character budget;
  optional model budgets additionally check the complete visible request plus reserved output using
  model-specific tokenization (T5). Hidden provider framing remains unmeasured. Provider-reported
  input/output usage is recorded separately. A crash after inference dispatch but before its native
  outcome persists is reconciled by durable pre-dispatch billing reservations that never book an
  unknown price as zero and never blindly repeat the call (T5); configured prices/ceilings are still
  not a physical billing guarantee.
- Expert state now uses bounded immutable native partitions and an atomic manifest. Scoped history
  and memory responses are paginated; stale cursors explicitly reject. Reads use indexed SQL
  retrieval and the global root CAS is fingerprinted rather than a full-scan contention point (T4).
  No broad scaling guarantee is claimed; see [storage](experts-storage.md) and the
  [measured benchmark](experts-scale-baseline.md).
- Multi-process effect dispatch is available behind the verified `runOwnership` configuration (T7):
  one PostgreSQL store serves several Workbench processes with authoritative per-run ownership, a
  killed owner's effect requires reconciliation, and its stale write is fenced. The default remains
  a single Bun process and exactly-once physical effects are not claimed.
- A provider call can delay graceful runtime shutdown in the consumed SDK line at the time this
  finding was recorded (0.4.0; Workbench now pins 0.6.1). Upstream PR #44 fixes cooperative abort
  and acknowledged-continuation recovery with PostgreSQL regressions; its status is tracked
  separately and is not asserted here. Signal-ignoring handlers can still delay shutdown.
  Abrupt-process recovery is tested separately.
- Interrupted agent capability calls wait for operator reconciliation in every run-ownership mode
  and capacity (`ambiguousSteps: "wait"`). When a process stops during a call, the recovering
  process does not repeat the call: it records `run.invocation.ambiguous` and opens an
  `ambiguous-invocation` continuation, and the run stays waiting. The chat view shows "Interrupted
  step needs reconciliation" with the capability name and an observed-outcome form; the sidebar
  shows "Needs reconciliation". The operator resolves it with `run.invocation.reconcile`
  (`succeeded` with a required observation, or `failed`). Agents and run-scoped calls are refused.
  A `succeeded` record stores only `{reconciled, outcome, reason, reconciledBy}`, not the step's
  original output. For that reason an interrupted **model call** (`model.generate`,
  `expert.model.generate`) cannot be confirmed as succeeded — its response cannot be reconstructed
  and it has no external effect to confirm — so the card offers only "Retry the model call"
  (`failed`), and the agent retries it. Other capabilities' consumers receive the observation record
  in place of their native output.
  Exactly-once delivery of the external effect is still not claimed.
- Human reconciliation of an ambiguous effect does not prove an objective complete. A confirmed
  successful effect requires a new follow-up objective rather than blind retry of that objective.
- Native commitment guards cover Expert `edit`, `bash` and `run_code`; legacy coding-session tools
  retain their existing recovery semantics.
- Development bearer-token authentication is replaced as the default posture (T8): requests resolve
  against durable server-issued sessions (revocable, hashed, boot-superseded), the client-claimed
  dev format is an explicit opt-in test/dev seam, and the capability policy grants user-kind
  authority to the one durable operator identity only. Best-effort local command guards remain;
  capability checks are still not OS-level or multi-user isolation. Aggregate containment now
  covers contained (Linux bubblewrap) executions across processes. Local workspaces are
  uncontained worlds: under the default `contained` execution posture agents cannot launch
  processes or write files in them; `COGNATE_EXECUTION_POSTURE=uncontained-local` opts back in. This is still not a production-hardened multi-user deployment — the independent
  review's residual boundaries are recorded in
  [security-review-2026-10-17-t8.md](security-review-2026-10-17-t8.md).

## The cognitive layer is a local proof

Explicitly labelled as such in the code.

- **Semantic binding gap closed.** The validated model now represents the implemented cognitive
  journeys and explicitly binds all 20 `case.*`, `criterion.*`, `world.*`, `verification.run`,
  `risk.assess`, `experiment.*`, `method.*` and `ui.*` contracts. Tests inspect the semantic reference
  on an actual native invocation. A semantic binding does not automatically execute a SEA policy.
- **The fork provider is a directory copy**, not a hardened sandbox. It is isolation from accident.
- **No core promotion.** Three candidates were identified — world identity and lineage,
  around-mediation with a trusted subchain, and the closed Surface grammar — each recorded with the
  deficit it would fill and the evidence justifying promotion. None was promoted.
- **RiskPreflight classifies the `rm -r` family plus SQL and device-redirect fallbacks.** Other
  commands are unclassified. Unclassified is treated conservatively by the surrounding gate, which is
  a policy decision, not a guarantee.

## Conflicts

### Inert controls against the product's own rule

`PRODUCT.md` principle 3 says *"Every control has a real purpose"*, and
`src/ui/workbench/UX.md` rule 7 says a disabled control must explain itself **in visible text next to
the control**, never in a tooltip alone.

The historical finding counted **21 disabled controls** guarded by `NOT_IMPLEMENTED`, including
review layout, shortcuts, configuration, plugins, view options and the fallback preset chooser.
That count is no longer current: the marker is absent and T11 implemented those surfaces.

Where they are, in summary: the review panel's toolbar (Split, Fullscreen, Collapse right sidebar,
Code view) and its Add-tab control; a shortcuts edit button and a shortcuts footer control; an
"open config file" button; a plugins-panel action and a per-plugin row action; a view-options group
label pair; a Refresh button and a second primary button; and the display-only "Standard mode" badge
in the no-workspace fallback chooser.

The removed marker also pointed at absent `APP/DEVIATIONS.md`. Current source comments now point
at this document. Existing functional evidence includes `test/ui-review.test.tsx`,
`test/J-PREFS-shortcuts.test.ts`, `test/J-CFG-config-path.test.ts`, `test/workbench-plugins.test.ts`,
`test/workbench-sidebar-view.test.ts` and `test/E2E-workbench.test.ts`.

**Superseded — replaced by documented working T11 controls.** This preserves the original finding;
it does not imply every planned product feature exists. Remaining planned surfaces are listed above.

### Unbound capabilities against the binding model

Closed by validated model concepts, explicit adapter bindings and native invocation evidence. See above.

### A no-workspace fallback badge

The historical fallback badge is superseded by a working preset selector using
`settings.changePreset`. The composer's separate access-mode dropdown remains functional.

## Security and trust boundaries, stated plainly

| Boundary | Reality |
|---|---|
| Authentication | Durable server-issued sessions (T8): revocable, hash-stored, restart-superseded; the dev bearer format exists only behind the explicit `devAuth` opt-in. Single operator, tenant-partitioned. Still not a multi-user production deployment. |
| Network exposure | The server binds `127.0.0.1` and has no other listener. Do not proxy it to untrusted clients. |
| Tool guards | Local default uses best-effort path/shell guards. Explicit host-configured Linux child worlds add native filesystem/process/network containment; aggregate CPU/process ceilings across processes now fail closed (T8), with kernel per-execution CPU/address-space caps. Host application isolation remains open; aggregate memory is bounded per-execution × the concurrency ceiling, not measured as a live sum. |
| `run_code` | Its `sandbox_permissions` field names an approval gate. Actual execution uses the selected world: local workspaces refuse it under the default `contained` posture (opt-in `uncontained-local` runs it uncontained); Linux children use namespaces. Permission approval alone provides no OS isolation. |
| Secrets | In `<home>/secrets.json` with restrictive permissions. Not in the event log. |
| Remote worlds | SSH host keys are probed and must be explicitly trusted by a human, compared against a known source. |

Development authentication does not establish a production listener or hostile-user boundary.
See [Linux contained workspaces](linux-contained-workspaces.md) for the explicit child-world
configuration, refusal behavior and remaining limits.

## Session / Workspace / Task RED journeys — recorded limits

The five formerly red suites (`test/*red.test.ts`, `test/E2E-workspace-session-ux.red.test.ts`)
are green against the real runtime. Limits observed while making them green:

| Limit | Reality |
|---|---|
| Projection re-read amplification | The published client re-reads every mounted projection for every replayed event (a page reload replays the tenant's whole event log). Every always-mounted store multiplies that storm; `useSessionTaskBinding` therefore subscribes only while a session is open. Long event logs + many mounted stores can still exhaust Chromium's pending-request pool (`net::ERR_INSUFFICIENT_RESOURCES`) until the framework batches or deltas projection sync — a framework change to propose upstream, not something app code should paper over. |
| Directory suggestions | Read-only completion from the selected execution world's provider. Symlinked directories surface as neither file nor directory and are therefore never suggested (conservative, by design). Browsing the Workbench's own application home is refused. There is no fuzzy or case-insensitive matching yet — suggestions are prefix matches. |
| Session drafts | Draft identity is deterministic from (workspaceId, requestId); the runtime's idempotency key guarantees one `session.created` event per request identity. Sessions created implicitly before this tranche (turn-only rows without `session.created`) remain readable but never show draft state retroactively — a migration was deliberately not invented. |
| Task movement | `task.move` refuses RUNNING tasks and nonexistent destinations, preserves identity/evidence/provenance and invalidates stale bindings. The UI's consequence preview is descriptive text about what changes (paths/tools/executors/budget/protection are revalidated); it does not yet diff the destination workspace's actual tool/budget configuration against the source. |
| Session-scoped task bindings | One task may be bound per session at a time (the binding row names at most one `taskId`); a session task created in its owning session auto-binds that session — the explicit scope choice — while workspace tasks are never auto-bound anywhere. |

## Stale references in source comments

The previously recorded missing-path comments have been repaired in this tranche. Their historical
locations are retained below; current comments use existing documentation.

| Location | Points at |
|---|---|
| `src/server.ts:2` | `APP/README.md` — removed |
| `cognate.config.ts:2` | a README section, "Why `createRuntime`, not `createHarness`", that the current README does not have. The answer is canonical now at [Why one Bun process](explanation/why-single-bun-process.md). |
| `src/components/modelProvider.ts:3` | `docs/reference/capability-and-architecture-contracts.md` — an SDK-internal path, not in this repository |

## A stale persistence claim

Comments in a few source files and in legacy documents describe "SQLite-backed continuations". The
store is PostgreSQL: `src/store.ts` returns `{ postgres: … }` or `{ postgresPg0: … }`, and CI
provisions a `postgres:18` service. Active source comments were repaired; historical documents remain
provenance, not current persistence instructions.

## A command that does not exist

`just remote-workspaces-live` is named in a removed legacy note as a live gate against a real
`sshd` and a real WSL distribution. **There is no such recipe.** The SSH and WSL journeys run in CI
against the normal suite. The real recipe list is in [CLI reference](reference/cli.md).

## Migration status

Recovered from the migration verification note: the original reconstruction in the Cognate monorepo
was **not** removed, no merge to Workbench `main` had occurred at that point, and independent
execution validation was pending CI — with an explicit instruction not to call it a successful
cutover until the workflow was green.

That pending-validation statement is historical. Current standalone verification passes against
published SDK packages (see the debt verification report). The original reconstruction is retained,
and this task does not merge its Workbench feature branch into `main` or perform migration cleanup.

`AGENTS.md` still records that the original must not be removed until standalone verification passes,
and that the development authenticator is a known security limitation that must not be described as
production hardening.

## Provenance artifacts not in this repository

These are cited by legacy documents but are not present, so nothing in `docs/` treats them as
verified evidence:

an evidence file recording the redesign decision · a debt register · the critic review rounds · a
product-characterisation document · reference screenshots and comparison images · the architecture
guard tests (`no-reference-imports`, `no-copied-source`) and the screenshot capture script.

Where a debt or critic finding appears in recovered prose, it is cited as second-hand.
The current native `.agents/DEBT.md`, Experts verification/translation reports, tests and screenshots
do exist. They are new evidence and do not reconstruct the missing legacy artifacts listed above.

## Source trail

- `src/ui/App.tsx` — T11 controls, actual composer counts and explicit unavailable child usage
- `src/ui/workbench/UX.md` — rule 7, the honest-rendering rule
- `PRODUCT.md` — principle 3 and the accessibility section
- `src/capabilities/cognitive.ts` — the human-only guards and the fork provider
- `src/workbench/automation.ts`, `economics.ts`, `parallelism.ts`, `skillOs.ts` — the recorded-intent
  modules
- `src/store.ts` — the actual persistence mechanism
- `src/domain/approvalGate.ts` — the `read-only` default
- `src/server.ts` — loopback binding, the dev authenticator
- `justfile` — the real recipe list
- `AGENTS.md`, `MIGRATION.md` — the standing constraints
- `.agents/plans/unified_harness_experience_model_v2.md` — the plan sections that were not built
