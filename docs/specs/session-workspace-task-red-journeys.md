# Proposed J-SESSION / J-WS / J-TASK / J-RUN interaction contracts — RED baseline

**Status:** proposed, not yet implemented or validated. This document accompanies
`test/*red.test.ts` and `test/E2E-workspace-session-ux.red.test.ts`. It is *not* a replacement
for `.sea/interaction/interaction-model.sea` or the canonical journey catalog.

This branch intentionally contains tests for missing behavior. Application source has **not**
been changed. The implementer must follow **building-with-cognate**,
**deriving-interaction-domain-models**, and **domainforge-sea**: update and validate the canonical
`.sea` model and its journey catalog first; bind real capabilities in `domain/index.ts`;
make these contracts pass with actual native Cognate execution, then report evidence.

## Intended mental model

| Concept | Who/what it describes | Semantics |
| --- | --- | --- |
| Workspace | Git project or other execution-world directory | Where work is allowed |
| Session | Persistent conversation | Holds messages and selects relevant context; exists before any prompt |
| Message | A human or agent communication | Stored as conversation content, not itself an execution |
| Run | A durable agent invocation | May involve one inference or multiple model/tool steps; a Run is not a tool call |
| Task | Accountable objective, contract and settlement ledger | Can outlive Sessions and span multiple Runs |
| Plan step | Intended work unit | May require zero, one or multiple execution attempts |
| Expert Assignment | Governed delegation | Links to originating Task when work serves a Task, and to causal parent Assignment/Run |
| Evidence | Observation/artifact associated with a criterion | A completed Run or commit does not automatically settle a Task |

A **workspace Task** is *visible and eligible for binding* from any Session in its workspace;
it is **not automatically active** in every Session. A **session Task** is initially visible only
within its owning Session. These are scopes of a single Task entity, not two separate ledgers.
Binding a Task to a Session is a durable, explicit choice. Runs freeze the effective taskId for
their own invocation; binding changes after a Run starts do not rewrite history.

Do not create a Task merely because the human asks a conversational question. A submitted turn
starts a Run (including answer-only inference), with no Task unless one was explicitly in scope.
A substantive objective may warrant offering Task creation, but default safety gates still apply.

## J-SESSION-draft

**User goal:** Open a workspace, press **+**, immediately get a fresh conversation ready to type.

- The click creates a durable draft Session in the intended workspace, with a stable ID.
- No inference or model credentials are required to *create* a draft.
- The sidebar clearly selects the new Session. The conversation/composer becomes visible even if
  Workbench, Experts & Teams, or Plugins was previously open.
- When a model is configured the composer is focused and usable. With no model, the interface
  explains the missing model and offers a configuration path, rather than silently doing nothing.
- Reload/restart preserves the draft; a future first message fills it rather than producing a
  duplicate row. Existing legacy sessions without `session.created` remain readable.
- A new draft has no active Task by default. No stale conversation, approval, focus selection,
  or workspace-specific Task may leak from a previous Session.
- Duplicate create requests with the same idempotency identity return the same Session.
- Failures are visible, with retry; clicks are disabled only while genuinely pending.
- A Session's workspace association is immutable unless an explicit, governed move is defined.
- Selecting a workspace uses its stable ID rather than relying on an asynchronously updated
  global `current` projection at the moment of the next submit.

**Settlement:** inspect a new draft in projection/event history before sending a prompt, click
it, reload, send a first message, and verify exactly one Session identity throughout.

## J-WS-directory-discovery

**User goal:** Browse project directories without typing an entire absolute path.

- An authorized, bounded `workspace.directory.suggest` or equivalent read capability
  queries the **selected execution world's** filesystem; do not use the browser machine's
  paths for SSH/WSL. It is read-only, does not create a workspace, and has no local fallback.
- As the user enters a partial path, matching **directories only** appear with accessible names.
- Support arrow-key navigation, Tab completion, Enter/selection, Escape to dismiss; pointer
  selection and pasting full paths must continue to work. Do not hijack Enter-to-submit when
  the suggestion list is open.
- Suggestions debounce user input, cap results, ignore stale/out-of-order responses, and do not
  block typing on slow SSH connections. Show loading/error/empty states succinctly.
- Display the execution-world label and the exact chosen destination before confirmation.
- Enforce pre-workspace browsing authority, execution-world boundaries, symlink and path
  normalization guards, and protected application-home restrictions at the server.
- Never include file contents, secret material, arbitrary error stack traces or host-protected
  directory inventory in a suggestion response.
- The local first-run chooser, Add workspace dialog, and SSH/WSL folder step should share
  an accessible path picker without duplicating filesystem code. Containment selection stays
  explicit and is *not* silently relaxed for convenience.

**Settlement:** type a short prefix, select a folder with keyboard only, open it, observe
exactly the chosen workspace; repeat for a connected world and for denied/unknown locations.

## J-TASK-scope and J-TASK-link

**User goal:** Know which work a chat is supporting without having to know Cognate's internal IDs.

- One Task entity has `scope = workspace | session`. Session scope requires an existing
  Session of the same workspace. Workspace scope is the default for tasks created in the
  Workbench without a Session context.
- Scope is apparent when creating the Task: **This workspace** / **This session**.
  Default and explanation should follow entry context; do not ask for unnecessary fields.
- The currently bound Task appears next to the composer, clearly labeled, with an accessible
  **change/detach** action. **No task** is a valid and obvious state.
- Session-specific Task never appears as a bindable Task in another Session unless promoted.
- A workspace Task is visible to all Sessions in that workspace, but none inherits it as its
  active Task without explicit selection.
- The binding is durable and retained on reload. A new Session has no inherited binding.
- On changing workspace or moving a Task, stale bindings are invalidated and authority is
  rechecked. No silent cross-workspace execution under the old Task.
- Show related conversations and Runs from the Task view; navigating to them must preserve
  their owning workspace.

**Settlement:** creating a session Task makes its scope visible, binds it to that session only,
and leaves a second fresh Session unbound; a workspace Task appears as an available option
in either Session without being auto-selected.

## J-TASK-move

**User goal:** Promote, detach, or move work without destroying its history.

- Distinguish **unbinding** a Task from a Session (removes active association) from
  **moving** Task ownership/scope (changes where it is available).
- Promote session Task → workspace Task and move Task → another Session or Workspace
  through one governed, explicit mutation.
- Preserve Task ID, evidence records, original run lineage, and original source-workspace
  provenance. Do not reparent historical Runs.
- Show a consequence preview if moving changes available tools, paths, executors, budget,
  protected paths, or acceptance applicability. Revalidate the Task contract, require updated
  approval where needed, and prevent unsafe movement of in-flight work.
- Cross-workspace moves are not mere renames: resource and authority scope must be recalculated.
- Reject nonexistent destinations and unauthorized cross-scope bindings.

**Settlement:** move a task between two workspaces, see it only in its new workspace's task
inventory, preserve its original evidence and historical origin, and do not silently accept it.

## J-RUN-task-attribution and J-TASK-expert-provenance

**User goal:** Understand what inference/actions happened and which objective they served.

- One user turn invokes a Cognate Run, whether or not read/write/bash tools are called.
- A Run can invoke several inference steps and tools and can spawn delegated Expert Assignments.
- Each Run's initial authorization/task association is frozen as evidence; later UI changes
  cannot rewrite an already started Run's provenance.
- An optional `taskId` is validated against the Session/Workspace/authority context.
  If absent, the Run remains a valid unbound conversation execution.
- When an Orchestrator delegates work for a Task, parent and Specialist Assignments retain
  that Task's identity and their causal parent IDs; their individual Run attempts are distinct.
- An Assignment may have multiple attempts; a Run is **not** inherently a plan checklist item.
- A Task's acceptance is still separate from successful Runs, model answers, Expert handoffs,
  and Git commits; retain explicit human and criterion gates.

**Settlement:** a plain question creates a completed Run with no Task; a subsequent Task-bound
turn and delegated Specialist have correlated, independently inspectable identities and evidence.

## Mandatory UX acceptance checklist

- [ ] **+ visibly works** from empty workspace, normal chat, Workbench, Experts & Teams, and Plugins.
- [ ] Active Session is obvious; empty draft is reachable and persists.
- [ ] Composer is focused and ready when prerequisites are satisfied.
- [ ] Errors are visible in context, actionable, and not console-only.
- [ ] Workspace chooser completes real directories on keyboard and pointer.
- [ ] Typing remains responsive even with slow/unavailable remote directory listing.
- [ ] Execution-world and containment mode are unmistakable when selecting a path.
- [ ] Task visibility is understandable without internal architecture knowledge.
- [ ] An unattached chat does not silently inherit another chat's Task.
- [ ] Detaching or moving a Task never deletes its evidence or changes past Run associations.
- [ ] No Task, Run, Plan, and Expert Assignment vocabulary overload in normal chat UI.
- [ ] Browser keyboard, screen-reader semantics, mobile layout, reload, and failure paths tested.

## Contract-test index

- `test/J-SESSION-draft-contract.red.test.ts`
- `test/J-WS-directory-discovery.red.test.ts`
- `test/J-TASK-session-scope.red.test.ts`
- `test/J-TASK-expert-provenance.red.test.ts`
- `test/E2E-workspace-session-ux.red.test.ts`

### RED discipline

These tests intentionally describe **missing capabilities** and must **fail on this baseline**.
Do not weaken assertions or replace them with `test.todo` / `test.skip` / shallow source-string
checks. The exact new API names are proposed contracts, not immutable semantics: the implementer
may revise the test API after following the validated model, provided the *behavioral invariants
and end-to-end UX obligations remain as strong*.

Tests should be made green in vertical slices, then the entire original suite should pass.
Typechecking errors in red-test files are not an acceptable red phase: tests should compile and
fail because the product lacks the required behavior. Validate locally before implementing.

This authoring environment had GitHub repository access but **no Bun executable and no direct
repository clone/network access**; actual test-run evidence is not yet available. Do not mistake
commit success for executed red-test evidence.
