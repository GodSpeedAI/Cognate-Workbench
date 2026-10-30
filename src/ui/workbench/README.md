# Workbench Cockpit UI Panels

## Overview

Bun/TSX React components for the Workbench cockpit: tasks (contract, done ladder, evidence
ledger, worker return, review gate, authority, economics), workflow graph and node inspector,
capability lifecycle list, and automations. `Workbench.tsx` is the assembler — data comes from
the public `workbench` projection (read via `./data.ts` hooks), every decision goes through a
named capability (validated server side), and each surface is a pure component. Developer UX
rules for every component here are in `./UX.md` (preserve this document; it extends
`DESIGN.md` and `PRODUCT.md` at the repo root). Styling lives in the sibling `.css` files
(`base.css`, `cockpit.css`, `contract.css`, `review.css`, `automation.css`, `skills.css`,
`tasks.css`, `workflow.css`), excluded from this contract. Pure domain helpers and types live
outside this directory in `src/workbench/*.ts` (`authority`, `contract`, `economics`, `ledger`,
`workflow`, `skillOs`, `automation`, `checkoutUi`, `gitOps`, `focus`, `types`, `state`).

## Interface

- `./Workbench.tsx:WorkbenchView` — cockpit shell with tabs (tasks/workflows/capabilities/
  automations); key type `./Workbench.tsx:WorkbenchViewProps`. Also exports
  `./Workbench.tsx:useBindableTasks` — the chat composer's bindable-task hook. Internal (not
  exported): `TasksTab`, `TaskDetail`, `NewTaskForm`, `WorkflowsTab`, `CapabilitiesTab`,
  `AutomationsTab`, `MoveTaskControl`, `useEvidenceByTask`, `useSessionsBoundToTask`.
- `./data.ts` — data access layer: `./data.ts:useWbRows`, `./data.ts:useWbRow`,
  `./data.ts:useWorkbenchActions`, `./data.ts:errorText`, `./data.ts:WbRow`,
  `./data.ts:Notice`.
- `./ComposerBar.tsx:ComposerBar` — task binding, focus referent and runtime strip above the
  composer; key type `./ComposerBar.tsx:ComposerBarProps`.
- `./CheckoutChip.tsx:CheckoutChip` — Task-checkout (git worktree) control; key type
  `./CheckoutChip.tsx:CheckoutChipProps`.
- `./ContractBar.tsx:ContractBar` and `./ContractEditor.tsx:ContractEditor` — contract chips and
  per-field editor; key types `./ContractBar.tsx:ContractBarProps`,
  `./ContractEditor.tsx:ContractEditorProps`.
- `./TaskList.tsx:TaskList` (`./TaskList.tsx:TaskListProps`),
  `./DoneLadder.tsx:DoneLadder` (`./DoneLadder.tsx:DoneLadderProps`),
  `./RuntimeStrip.tsx:RuntimeStrip` (`./RuntimeStrip.tsx:RuntimeStripProps`),
  `./LedgerPanel.tsx:LedgerPanel`, `./ReviewCard.tsx:ReviewCard`,
  `./WorkerReturnForm.tsx:WorkerReturnForm`, `./AuthorityPlane.tsx:AuthorityPlane`
  (`./AuthorityPlane.tsx:AuthorityPlaneProps`),
  `./CapabilityList.tsx:CapabilityList` (`./CapabilityList.tsx:CapabilityListProps`,
  `./CapabilityList.tsx:CapabilityRecord`),
  `./WorkflowGraph.tsx:WorkflowGraph`, `./NodeInspector.tsx:NodeInspector`.
- `./AutomationPanel.tsx:AutomationPanel` — default export; operationalized accepted workflows
  with schedule, runner and outcome gate.
- `./UX.md` — the UX contract every component in this directory must follow (presentational
  only, token-only colours, one primary button per surface, honest `n/a`, accessibility rules).

## Invariants

- Presentational layering: per `./UX.md` rule 1 and `./data.ts`'s header comment, components
  below `Workbench.tsx`/`./data.ts` stay pure — no projection hooks, no client calls, no
  `fetch`, no `Date.now()` for facts.
- Seed-once starter catalog: `./Workbench.tsx:WorkbenchView` invokes `workbench.seed` only the
  first time the cockpit opens with no `capability/` rows (guarded by `seeded` ref), so Skills is
  never a dead end; the capability waits server side and is idempotent.
- J-TASK-scope visibility: `./Workbench.tsx:useBindableTasks` returns every workspace task plus
  session-scoped tasks only inside their owning `sessionId`; `./ComposerBar.tsx:ComposerBar`
  always keeps the bound task selectable (`taskId && !bound` option) so the value never visibly
  falls back to "No task".
- Locked-while-running: `./Workbench.tsx:TaskDetail` computes `locked` from
  `task.status === "RUNNING"` and `terminal` from `ACCEPTED`/`OPERATIONALIZED`; the contract
  editor and move control are disabled in both states, and `./ContractEditor.tsx:ContractEditor`
  renders a locked notice and disables every field.
- Mark-ready gate: `./Workbench.tsx:TaskDetail` disables "Mark ready" while
  `contractMissing(task.contract)` is non-empty, naming the missing fields.
- Editor validation: `./ContractEditor.tsx:ContractEditor` refuses save when the goal outcome is
  blank, any invariant statement is blank (or there are none), or any acceptance description is
  blank (or there are none); budget input `maxMinutes` converts to `maxMs` (× 60000); context
  `workspaceId` is read-only.
- Worker-return prefill honesty: `./Workbench.tsx:TaskDetail` filters `task.activity?.commands`
  through the `TEST_COMMAND` regex and derives `remaining` from `openRequired(rows)`;
  `./Workbench.tsx:TaskDetail` economics text shows "Cost is unknown, not zero." when no usage
  is recorded.
- Capability-lifecycle gating: `./CapabilityList.tsx:CapabilityList` disables advancing to
  `REVIEWED`, `INSTALLED` or `AUTHORITY_GRANTED` when `canGrant` is false ("Only a person can
  grant this step").
- Workflow evidence gate: `./NodeInspector.tsx:NodeInspector` enables "Mark done" only when
  every `node.acceptance` evidence kind is closed (or attested via its checkboxes, which then
  advance with `closedEvidence`); `./WorkflowGraph.tsx:WorkflowGraph` flags
  `doneWithoutEvidence` nodes in their aria-label and tag text.
- Automation honesty gate: `./AutomationPanel.tsx:AutomationPanel` states "This app records
  outcomes that you or a runner report. It does not run a scheduler in the background."; creation
  requires at least one acceptance item and a source task with status `ACCEPTED`
  (`canCreateAutomation`), and "Confirm verified" stays disabled until every open acceptance
  item is checked.
- Review gate: `./ReviewCard.tsx:ReviewCard` disables Accept/Rework unless `canDecide`
  ("Only a person can accept work"), and disables "Submit for review" while `blockers` exist.
- Checkout safety: `./CheckoutChip.tsx:CheckoutChip` is `locked` while a run is active; moving a
  task retires the old checkout first via `git.checkout.remove` (which refuses on uncommitted
  work), and same-branch repair uses `git.checkout.recreate` rather than stacking a second
  worktree.
- Strict JSON on the wire: `./data.ts:useWorkbenchActions` round-trips input through
  `JSON.parse(JSON.stringify(input ?? null))` because editors may leave `undefined` fields that
  the protobuf `Value` wire format rejects; `./data.ts:errorText` surfaces the capability's own
  refusal text.

## Side Effects

- Capability invocations via `./data.ts:useWorkbenchActions` in `./Workbench.tsx:WorkbenchView`
  and its tabs: `workbench.seed`, `task.create`, `task.contract.update`, `task.status.change`,
  `task.review.request`, `task.review.decide`, `task.move`, `worker.return`, `evidence.record`,
  `authority.elevate`, `workflow.instantiate`, `workflow.node.advance`,
  `skill.lifecycle.advance`, `automation.create`, `automation.advance`.
- Checkout capabilities in `./CheckoutChip.tsx:CheckoutChip`: `git.checkout.status`,
  `git.checkout.attach`, `git.checkout.remove`, `git.checkout.recreate`, `git.checkout.merge`,
  `git.branch.list`.
- Projection reads: `useProjection("workbench")` (all `./data.ts` hooks and
  `./Workbench.tsx:useBindableTasks`), `useProjection("task-checkout-bindings")` in
  `./CheckoutChip.tsx:CheckoutChip`, `useProjection("session-task-bindings")` and
  `useProjection("workspaces")` in `./Workbench.tsx:MoveTaskControl`.
- Focus publication: `./Workbench.tsx:TasksTab` and `WorkflowsTab` call the `onFocus` prop with a
  `FocusRef` (`task` / `workflow-node`) so "this" resolves deterministically in the conversation.
- DOM: `./Workbench.tsx:WorkbenchView` moves keyboard focus between tabs via
  `document.getElementById(...).focus()`.

## Verification

- `test/ui-tasks.test.tsx` — verified by grep to render `TaskList`, `DoneLadder`, `RuntimeStrip`.
- `test/ui-contract.test.tsx` — verified to render `ContractBar`, `ContractEditor`.
- `test/ui-review.test.tsx` — verified to render `LedgerPanel`, `ReviewCard`, `WorkerReturnForm`.
- `test/ui-skills.test.tsx` — verified to render `AuthorityPlane`, `CapabilityList`.
- `test/ui-workflow.test.tsx` — verified to render `NodeInspector`, `WorkflowGraph`.
- `test/ui-automation.test.tsx` — verified to render `AutomationPanel`.
- `CheckoutChip`, `ComposerBar`, `WorkbenchView` and `./data.ts` have no direct component test
  (they are covered indirectly through journey tests); for those, run the full suite:
  Run (from repo root): `bun test test`
