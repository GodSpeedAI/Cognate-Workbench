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
| Automation records | Stored. No background scheduler fires them. |
| Budget information | Informational. Not enforced as a runtime limit. |
| Composer stats footer | Always renders `0 turns 0 steps · 0 tok/s` / `0% of context used`. No turn, step, token or context accounting exists. |
| Trajectory / developer tools | Present as a read view over the trace. |

The honest convention from `src/ui/workbench/UX.md` rule 9 is that an unreported number renders as
`unknown` or `n/a`. The stats footer violates it because no number exists to report. The fix is a
backend change, not a UI change, so it is recorded here rather than done silently.

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

- Expert dispatch is serialized, matching the installed Cognate runtime. Parallelism plans still do
  not create parallel workers.
- Autonomous schedules and live inter-Expert steering are deferred. Messages queue for the next
  authorized Assignment. Mentions guide the Orchestrator rather than automatically starting work.
- Memory retrieval uses bounded lexical search and recent scoped context, without embeddings or
  automatic model-generated trusted summaries. Context budgets measure characters, not exact tokens.
- Expert registry writes use one versioned aggregate. Partitioning and paginated historical reads
  are future scaling work; no high-volume throughput claim is made.
- Multi-process effect dispatch fails closed without the owning live run context. The supported
  Workbench deployment remains one Bun process.
- A provider call can delay graceful runtime shutdown. Abrupt-process recovery is tested separately.
- Human reconciliation of an ambiguous effect does not prove an objective complete. A confirmed
  successful effect requires a new follow-up objective rather than blind retry of that objective.
- Native commitment guards cover Expert `edit`, `bash` and `run_code`; legacy coding-session tools
  retain their existing recovery semantics.
- Development bearer-token authentication and best-effort command guards remain unchanged security
  limitations. Expert capability checks are not OS-level or multi-user isolation.

## The cognitive layer is a local proof

Explicitly labelled as such in the code.

- **Capabilities unbound to the semantic model.** `case.*`, `criterion.*`, `world.*`,
  `verification.run`, `risk.assess`, `experiment.*`, `method.*` and `ui.*` are executable but not
  bound. The recorded reason is that the `.sea` model carries another tranche's uncommitted edits.
  A gap, not a decision.
- **The fork provider is a directory copy**, not a hardened sandbox. It is isolation from accident.
- **No core promotion.** Three candidates were identified — world identity and lineage,
  around-mediation with a trusted subchain, and the closed Surface grammar — each recorded with the
  deficit it would fill and the evidence justifying promotion. None was promoted.
- **RiskPreflight classifies the `rm -r` family plus SQL and device-redirect fallbacks.** Other
  commands are unclassified. Unclassified is treated conservatively by the surrounding gate, which is
  a policy decision, not a guarantee.

## Conflicts

### Inert controls against the product's own rule

`PRODUCT.md` principle 3 says *"No control renders that does something"*, and
`src/ui/workbench/UX.md` rule 7 says a disabled control must explain itself **in visible text next to
the control**, never in a tooltip alone.

`src/ui/App.tsx` defines `const NOT_IMPLEMENTED = "Not implemented in this tranche — see
APP/DEVIATIONS.md"` and uses it as the `title` on **21 disabled controls**. That is the count today
and it is a live, unresolved disagreement with both documents.

Where they are, in summary: the review panel's toolbar (Split, Fullscreen, Collapse right sidebar,
Code view) and its Add-tab control; a shortcuts edit button and a shortcuts footer control; an
"open config file" button; a plugins-panel action and a per-plugin row action; a view-options group
label pair; a Refresh button and a second primary button; and the display-only "Standard mode" badge
in the no-workspace fallback chooser.

Two further problems compound it: the string points at `APP/DEVIATIONS.md`, which does not exist, and
the cockpit components under `src/ui/workbench/` are held to a stricter contract than the shell is.

**This is a finding, not a fix.** Resolving it means wiring, removing, or giving each control a real
visible reason — a product-surface decision, not a documentation one.

### Unbound capabilities against the binding model

The cognitive family is executable but not bound, while every other family is. See above.

### A no-workspace fallback badge

When the app cannot create a default workspace, its fallback chooser renders a disabled "Standard
mode" badge carrying the same `NOT_IMPLEMENTED` tooltip. It is display-only there, and is covered by
the count in the inert-control finding above. This is **not** the composer's access-mode dropdown,
which is functional.

## Security and trust boundaries, stated plainly

| Boundary | Reality |
|---|---|
| Authentication | `devTokenAuthenticator`, single operator, single tenant. **Not production authentication.** |
| Network exposure | The server binds `127.0.0.1` and has no other listener. Do not proxy it to untrusted clients. |
| Tool guards | Workspace-relative path containment and best-effort shell command classification. **Not a sandbox.** |
| `run_code` | Its `sandbox_permissions` field is a model tool-schema name. The mechanism is an approval gate plus path containment. |
| Secrets | In `<home>/secrets.json` with restrictive permissions. Not in the event log. |
| Remote worlds | SSH host keys are probed and must be explicitly trusted by a human, compared against a known source. |

The application binds to loopback and refuses nothing about its callers. Do not point it at untrusted
code or data expecting containment.

## Stale references in source comments

Source comments cite paths that no longer exist. They are recorded here rather than edited, because
changing implementation comments was outside the scope of the documentation work.

| Location | Points at |
|---|---|
| `src/server.ts:2` | `APP/README.md` — removed |
| `cognate.config.ts:2` | a README section, "Why `createRuntime`, not `createHarness`", that the current README does not have. The answer is canonical now at [Why one Bun process](explanation/why-single-bun-process.md). |
| `src/components/modelProvider.ts:3` | `docs/reference/capability-and-architecture-contracts.md` — an SDK-internal path, not in this repository |

## A stale persistence claim

Comments in a few source files and in legacy documents describe "SQLite-backed continuations". The
store is PostgreSQL: `src/store.ts` returns `{ postgres: … }` or `{ postgresPg0: … }`, and CI
provisions a `postgres:18` service. Where a comment says SQLite, it is stale.

## A command that does not exist

`just remote-workspaces-live` is named in a removed legacy note as a live gate against a real
`sshd` and a real WSL distribution. **There is no such recipe.** The SSH and WSL journeys run in CI
against the normal suite. The real recipe list is in [CLI reference](reference/cli.md).

## Migration status

Recovered from the migration verification note: the original reconstruction in the Cognate monorepo
was **not** removed, no merge to Workbench `main` had occurred at that point, and independent
execution validation was pending CI — with an explicit instruction not to call it a successful
cutover until the workflow was green.

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

## Source trail

- `src/ui/App.tsx:172` — `NOT_IMPLEMENTED`; 21 disabled controls using it
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
