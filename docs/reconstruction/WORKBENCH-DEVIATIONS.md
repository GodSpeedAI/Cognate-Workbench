# Workbench: status, deviations and framework gaps

Applies `.agents/plans/unified_harness_experience_model_v2.md` to this app. A trace is **met** only when a
test that passed in this checkout observes it. Everything else is listed as partial or unmet, with why.
Method and tranche plan: `WORKBENCH-PLAN.md`. Donors: `../primitive-provenance.md` §4 and `../donor-manifest.json`.

## Validation traces (plan §30)

| Trace | Status | Evidence | What is not covered |
|---|---|---|---|
| V-001 Task contract completeness | **met** | `test/J-WB-task-contract.test.ts`; `E2E-workbench` fills Goal, Skills and Authority through the editors | Executors and Budget are declared and shown; neither selects a model nor stops a run |
| V-002 Capability substitution | **met** | `J-WB-workflow.test.ts` (Playwright to Jev keeps contract and acceptance; a deterministic verifier may not become an LLM) | Substitution is recorded; no tool is actually re-pointed at run time |
| V-003 Protected evidence | **met, with limits** | `J-WB-protected-evidence.test.ts` (real agent loop: file byte-identical, block recorded as integrity evidence, person-only exact-path elevation); `workbench-authority-bypass.test.ts`; `E2E-workbench` shows the blocked-write notice | Enforced for `edit` and `bash` only. `run_code`, `read` and the network are not path-analysed. Shell analysis is best effort parsing, not a sandbox: a program that builds a path at run time can still write |
| V-004 Mid-run steering | **met** | `J-WB-steering.test.ts` (a later recorded model request carries the steering text, consumed once); `E2E-workbench` (Steer now writes to the live run's state; the run is not restarted) | Queue next is still the app's client-side queue. A run inside one long tool call sees the steer at its next step boundary, not instantly |
| V-005 Grounded UI repair | **partial** | `J-WB-grounded-feedback.test.ts` (contract validation, rendering, repair-scope check) | No element picker, screenshot capture or automatic verification rerun. The capability exists; the cockpit has no surface to create one |
| V-006 Safe parallelization | **met (planner)** | `J-WB-parallelism.test.ts` | Nothing consumes the plan: no delegation is started from it |
| V-007 Unsafe parallelization | **met (planner)** | `J-WB-parallelism.test.ts` | as above |
| V-008 Worker review gate | **met** | `J-WB-review-gate.test.ts` | `worker.return` is filled by a person from prefilled tool activity; subagent results do not produce one automatically |
| V-009 Business-semantic verification | **met** | `J-WB-review-gate.test.ts` (tests pass, independent check open: blocked) | The independent check itself is recorded evidence, not run by the harness |
| V-010 Context-preserving focus | **partial** | `workbench-focus.test.ts`, `J-WB-grounded-feedback.test.ts` (`describeFocus`), `E2E-workbench` (the referent is named, frozen into the run input, and resettable) | The sales-report style scoped-metric UI is not built; `describeFocus` is tested but not surfaced |
| V-011 Capability lifecycle | **met** | `J-WB-workflow.test.ts` (second describe) | The lifecycle is recorded and shown, but no tool invocation is gated by it |
| V-012 Automation outcome | **met** | `J-WB-automation.test.ts` | No scheduler runs in the background; outcomes are what a person or runner reports. Next fire is computed, never fired |
| V-013 Cost provenance | **partial** | `J-WB-economics.test.ts` (executor, provider, route, tokens, concurrency, budget state; unknown cost is shown as unknown) | The agent records executor, provider and tokens only when the model response reports usage. Billing route and quota are never reported by the provider, so they show as absent |

## Plan sections not built

Artifact model and preview fidelity (§14); Variant experimentation and worktree isolation (§15 of the
recommendations); the global Board and Evidence/Reviews navigation (§27: the Workbench is one view with four
tabs and the board is a grouped list, not columns); settings pages for executors, teams and economics (§28);
team supervision and subagent return contracts wired to real subagents (§9); role-aware routing applied to
executor choice (`routeExecutor` exists and is tested, nothing calls it); the `BACKLOG` and `BLOCKED` board
states exist in the model but no UI action sets them.

## Design decisions worth knowing

- **Capabilities record through `agent.config`.** Every workbench capability validates against the derived
  projection and then starts an `agent.config` run that emits the event. Reads right after a write can lag the
  projection by a moment; the UI shows the capability's own refusal text, and tests wait on durable rows.
- **Steering uses the run's shared state.** The runtime executes runs serially (DEBT-015), so an event recorded
  through a new run during an active run waits behind it. A live steer is therefore a caller write to the active
  run's shared state (`updateState`), which never waits on the executor; the agent reads it as a recorded step
  at each boundary. Messages enqueued before a run starts use the durable `workbench` inbox. The browser E2E
  found this; the API-level journey test alone did not.
- **Human-only decisions** (`task.review.decide`, `authority.elevate`, the grant steps of `skill.lifecycle.advance`)
  check `actor.kind === "user"`. Agent runs invoke as a non-user principal.
- **Starter catalog.** The first time the Workbench opens on an empty workbench it loads the starter catalog and
  two reference workflows once (`workbench.seed`, idempotent), so Skills is never a dead end.
- **Focus** is ported from the operator's gs-term (`src/workbench/focus.ts`). It is not unified with the
  cognitive proof's focus store (`src/cognitive/focus.ts`), whose reference kinds are case, world and candidate.
  `SharedFocus` pin, propose and accept are ported and tested but not surfaced in the UI.
- **The chat shows refused calls.** An `AuthorityNotice` renders for any turn with a call the task's authority
  refused, whatever the Work details verbosity, because the agent's own summary can say otherwise (the mock
  model does exactly that in the E2E).

## Review findings that changed the code

Worker output was verified, not trusted. Independent checks found and fixed: the first "type-check clean"
report was vacuous (`bunx` is not installed); workers' strict-mode errors (`noUncheckedIndexedAccess`); a
protected-path bypass through `src/../source.csv` and through absolute spellings (regression tests in
`workbench-authority-bypass.test.ts`); `undefined` fields rejected by the event envelope and by the protobuf
wire (fixed once at each boundary); an editor-close race (a finished save closed the editor the person had
moved on to); workflow graph nodes rendering black on black; and a review card buried below the evidence it
depends on.

## Full-suite result

`bun test test` in this directory: 862 pass, 1 fail, 863 tests across 59 files. The one failure is
`J-B-basic-session` (pre-existing, below). `bun run typecheck` is clean.

## Pre-existing issues seen (not caused by this work)

- `test/J-B-basic-session.test.ts` fails at HEAD (streamed progress events are not seen by the live subscriber
  in this environment); verified by running it on pristine tracked files.
- `tests/architecture/event-history-authoritative.test.ts` fails to load: it imports `bootMockModel`, which
  `cognate/test/helpers.ts` no longer exports (it exports `bootAimock`). Verified against HEAD.

## Framework gaps to propose separately (per the building-with-cognate skill)

1. A way to record application events from a capability without starting a run. Using `agent.config` as the
   write path puts every write behind the serial executor and forced the shared-state design for steering.
2. A workflow or scheduler primitive. Cognate has none (confirmed by survey of `packages/`); the workflow
   graph, automation state machine and budget accounting here are app code.
3. Budget enforcement. Usage and cost types exist on model responses; nothing enforces a budget.
