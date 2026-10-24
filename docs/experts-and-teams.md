# Experts and Teams

Experts are persistent Workbench identities. A Cognate run is one execution of an identity's current Assignment. Ending a run does not delete the Expert, its definition, conversations or permitted memory.

Open **Experts & Teams** in the existing sidebar. The ordinary coding-session experience remains available through **New Session**.

## Start with Cognate Team

Cognate Team starts with Product Manager as its sole Orchestrator, plus Builder, Critic, Verifier and Reviewer as Specialists. These are editable seed records. Restarting or reseeding preserves your changes. The Product Manager chooses the Specialists needed for the objective; it does not automatically call everyone.

1. Configure a provider in **Settings → Models** and choose a workspace.
2. Open **Experts & Teams → Cognate Team → Open Team conversation**.
3. Describe the objective, constraints and acceptance criteria. Mentions guide the Orchestrator; they do not bypass authorization or automatically start workers.
4. Inspect Assignments, handoffs, artifacts and run evidence. Resolve a requested tool approval only after checking its scope.
5. Review independent observable checks. Human settlement remains separate from a returned answer. The Orchestrator cannot accept its own work.

An individual Expert's **Solo conversation** is independent of Teams. A member's **Private conversation** within a Team has a separate conversation and contextual scope.

## Custom Experts and Teams

**New Expert** creates an identity with specialization, instructions, a model route, allowed tools, context budget in characters and a step limit. **Copy Expert** creates a distinct reusable identity without copying its private memories or conversations. Edit a definition to change future Assignments; already queued/running Assignments retain their model route and authority snapshot.

**New Team** creates a draft. Add members as Specialists, designate an Orchestrator, configure the tool ceiling and collaboration limits, then activate. An active Team always has exactly one Orchestrator. Replacing it changes both roles atomically. Removing its only Orchestrator is refused; replace it first, or deactivate the Team. Wait for or cancel unfinished work before transferring responsibility.

The invariant is checked during versioned mutations, including simultaneous updates. It does not depend on prompts or the editor.

## Team admission and batching policy

Each Team's admission policy lives in its authoritative Team metadata — edited in the Team editor
and persisted through `team.save`, never supplied by a run or a client. Two fields decide it:
**Maximum concurrent runs** (1–8, default 2) bounds how many of that Team's runs may execute at
once; **Admission batch** (1–8, default 1) bounds how many queued roots dispatch together as slots
free. A Team exceeding its limit is serialized and waits for a free slot even when host capacity is
free; the Team editor and the runtime inspection state the effective policy and the serialized
reason truthfully. Stale or unauthorized client-supplied policy fields (`maxConcurrentRuns`,
`admissionBatch`, `policy`, `limits`) are refused on `expert.converse`/`team.converse`; only
authoritative metadata decides. Solo conversations keep one-at-a-time root dispatch. These lanes
are process-local by SDK contract — cross-process Team fairness is not claimed.

## Models and tools

An Expert may inherit the current model route when an Assignment is created, select a saved provider route, or specify a provider ID, endpoint, protocol and model explicitly. Workbench retains safe provider configurations in `provider-routes`; the original `model-config/current` route continues serving ordinary coding sessions.

Credentials remain in the existing restrictive-permission SecretStore, keyed by `model-provider:<providerId>`. Configure credentials through Settings. Expert definitions and run inputs contain configuration only. `expert.model.generate` authorizes the registered Assignment and uses the published provider adapters without swapping the global provider.

An Assignment freezes the applicable Expert tools, Team ceiling, membership permissions and human-authorized access mode. Delegation cannot widen that authority. Specialists do not receive the general subagent tool or Team-delegation authority. Existing read-before-edit, approval, protected-evidence and risk checks remain in the coding engine.

## Delegation and durable returns

The Orchestrator's `team_delegate` tool creates an Assignment with purpose, context, acceptance criteria, depth, authority and return identity. `agent.expert` obtains that frozen specification through `expert.context` and reuses `agent.coding`. It suspends on a native continuation while a Specialist executes.

Published Cognate 0.6.1 stores run-completion conditions but does not automatically resolve them. Workbench's completion bridge follows committed events and scans persisted state on boot. It correlates terminal runs, records one logical Handoff, and resolves the native parent wait idempotently. Cognate's durable run outbox executes the work; there is no competing scheduler.

States are `queued`, `running`, `waiting`, `reconciliation-required`, `failed`, `cancelled` and human-settled `completed`. Creating a child run does not complete its Assignment. Typed returns can report a result, abstention or decline. A returned result remains an assertion until its evidence is checked.

The installed runtime dispatches runs serially. Teams make no parallel-worker claim. Addressed messages to idle recipients queue for the next authorized Assignment. Active shared Team conversations additionally support a durable live inbox: messages are accepted immediately, then incorporated at a recorded safe decision boundary. Pending, incorporated, superseded, cancelled and late delivery are visible. An ongoing inference call is not interrupted. Handoff depth, assignments, unread work, rounds and per-run steps are bounded.

## Effects, cancellation and recovery

Expert edits, shell commands and code execution use Cognate's native CommitmentService on the same PostgreSQL store. A deterministic Assignment/attempt/tool-position identity deduplicates delivery. Known successful effects return their recorded result. A lost effect outcome becomes ambiguous and is not blindly repeated.

Use the human reconciliation control to record the observed outcome and a reason. A confirmed successful ambiguous effect must be carried into a new objective rather than replaying the old objective. The decision is recorded in the native commitment and conversation. Resolving an effect does not prove the entire objective complete.

Cancellation marks the root and descendants durably, signals their Cognate runs before acknowledging the request, and suppresses unauthorized late returns. The bridge repairs interrupted cancellation on restart. Effects already performed cannot be undone by cancellation.

Queued work, pending communication, native continuations, model routes and handoffs survive restart. The process-kill test demonstrates automatic recovery with the same child run and one return. No browser needs to remain open. A graceful shutdown may wait for an active provider: the installed runtime does not abort every running provider during `close()`.

## Context, memory and evidence

Personal memory belongs to one Expert outside Teams. Private Team memory belongs to that Expert in one Team. Explicit Team memory is shared within that Team. Reusing an identity across Teams does not grant access to another Team's private knowledge.

Memory entries retain source Assignment/run/message references, authorship, scope and classification: observation, assertion, inference or human-accepted knowledge. Models cannot promote their statements to accepted knowledge. Retrieved text is marked untrusted data and grants no authority. Search starts with bounded lexical retrieval; there is no donor SQLite index.

An existing memory ID cannot be reassigned to another owner or scope. Only the human may replace accepted knowledge. Replayed commands return their original receipt; a different command cannot overwrite an existing work or message identity.

Context selection includes recent scoped messages, permitted memory and unfinished commitments. Pinned knowledge and unresolved commitments cannot be silently dropped to fit the budget: exceeding it requires reducing open work or increasing the budget. Older retained material remains searchable without including the full log in each prompt.

The event log is truth. Registry views, context snapshots and projections can be reconstructed from it. Public roster projections omit all memory, private Team transcripts and embedded execution context. The single human operator can deliberately read a private conversation through an authorized capability; Experts can retrieve only their own context.

Handoffs preserve artifacts, run/event evidence, uncertainty, failures and follow-up needs. Human acceptance requires an affirmative review citing an independent Expert's observable checks, plus no unresolved descendant failures or uncertainties. Model-only self-evidence cannot satisfy that gate.

## Boundaries

This remains a single-operator development application with best-effort path/command guards, not production authentication or OS isolation. The Expert gate does not harden the legacy coding engine into a sandbox. Do not expose the development bearer-token service to untrusted callers.

Native Expert/Team schedules now execute one-time or timezone-aware daily/weekly objectives independently of the browser. Open **Experts and Teams → Schedules**, then inspect an occurrence's native conversation, run and evidence. These schedules are read-only and preserve human approval for workspace effects; see [schedule behavior](schedules.md).

Optional [model budgets](expert-economics.md) freeze per-attempt limits and enforce reservations before provider calls. The usage disclosure distinguishes provider-reported tokens, conservative visible-input estimates and unknown cost. State now uses [bounded native partitions and paginated reads](experts-storage.md); global root contention and materialized lexical retrieval remain limitations.

Parallel Workbench workers, vector search, distributed run ownership and production authentication/containment remain open. Tested upstream SDK improvements are not consumed until a supported release is available. In ambiguous multi-process delivery, effects fail closed rather than executing without their owning live context. The complete [debt disposition](experts-debt-closure.md) distinguishes verified changes from remaining work.

For provenance and reconstructed donor behavior, see [donor translation](experts-donor-translation.md). For exact commands and observed evidence, see [verification](experts-verification.md).
