// The Workbench cockpit: tasks (contract, done ladder, evidence, return contract, review gate,
// authority, economics), workflows, capabilities and automations for one workspace. This file only
// assembles: data comes from the public `workbench` projection, every decision goes through a
// capability (which validates server side), and each surface is a pure component in this folder.
// Serves J-WB-task-contract, -review-gate, -protected-evidence, -workflow, -capability-lifecycle,
// -automation, -economics. See UX.md for the rules every surface follows.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjection } from "@godspeedai/cognate-react";
import { describeAuthority } from "../../workbench/authority.ts";
import { contractMissing, defaultAuthority } from "../../workbench/contract.ts";
import { budgetState, provenanceLine, rollupUsage } from "../../workbench/economics.ts";
import { doneLevel, groupLedger, ledgerRows, openRequired, reviewReadiness } from "../../workbench/ledger.ts";
import { detectConflicts } from "../../workbench/skillOs.ts";
import type { AutomationRecord, BindingRecord, BlockedRecord, CapabilityRecord as CapRow, ElevationRecord, TaskRecord, UsageRow, WorkflowInstanceRecord } from "../../workbench/state.ts";
import type { CapabilityState, ContractField, EvidenceEntry, EvidenceKind, NodeStatus, WorkerReturn, WorkflowDefinition } from "../../workbench/types.ts";
import AutomationPanel from "./AutomationPanel.tsx";
import { AuthorityPlane } from "./AuthorityPlane.tsx";
import { CapabilityList, type CapabilityRecord as CapListRow } from "./CapabilityList.tsx";
import { ContractBar } from "./ContractBar.tsx";
import { ContractEditor } from "./ContractEditor.tsx";
import { DoneLadder } from "./DoneLadder.tsx";
import { LedgerPanel } from "./LedgerPanel.tsx";
import { NodeInspector } from "./NodeInspector.tsx";
import { ReviewCard } from "./ReviewCard.tsx";
import { TaskList } from "./TaskList.tsx";
import { WorkerReturnForm } from "./WorkerReturnForm.tsx";
import { WorkflowGraph } from "./WorkflowGraph.tsx";
import type { FocusRef } from "../../workbench/focus.ts";
import { useWbRow, useWbRows, useWorkbenchActions, type Notice } from "./data.ts";

type Tab = "tasks" | "workflows" | "capabilities" | "automations";
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "workflows", label: "Workflows" },
  { id: "capabilities", label: "Capabilities" },
  { id: "automations", label: "Automations" },
];
const TEST_COMMAND = /\b(test|vitest|jest|pytest|spec|check)\b/i;
const ACTIVE_STATES: ReadonlySet<CapabilityState> = new Set(["ENABLED", "EXERCISED", "VERIFIED", "AVAILABLE"]);

export interface WorkbenchViewProps {
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  /** J-TASK-scope: the conversation this cockpit was opened from, when one is open — the
   *  "This session" visibility choice and the move-to-session destination. */
  readonly sessionId?: string;
  /** The task the chat composer is bound to, if any. */
  readonly activeTaskId?: string;
  /** Bind the chat composer to a task and return to the conversation. */
  readonly onWorkOnTask: (taskId: string) => void;
  /** J-TASK-scope: a session-scoped task was created in `sessionId` — bind it there (durable
   *  `session.task.bind`; the optimistic overlay keeps the composer bar truthful immediately). */
  readonly onTaskCreatedInSession?: (taskId: string) => void;
  /** The person's current selection, published so "this" resolves deterministically in the conversation. */
  readonly onFocus: (ref: FocusRef | undefined) => void;
  readonly onClose: () => void;
}

export function WorkbenchView({ workspaceId, workspaceLabel, sessionId, activeTaskId, onWorkOnTask, onTaskCreatedInSession, onFocus, onClose }: WorkbenchViewProps) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [notice, setNotice] = useState<Notice>(undefined);
  const act = useWorkbenchActions(setNotice);
  // The starter catalog is part of the product, not an optional extra: seed it once (idempotent on
  // the server) the first time the cockpit opens on an empty workbench, so Skills is never a dead end.
  const rows = useProjection("workbench");
  const seeded = useRef(false);
  useEffect(() => {
    if (!rows || seeded.current || rows.some((r) => r.key.startsWith("capability/"))) return;
    seeded.current = true;
    void act.call("workbench.seed", {});
  }, [rows, act]);
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const next = e.key === "ArrowRight" ? index + 1 : e.key === "ArrowLeft" ? index - 1 : undefined;
    if (next === undefined) return;
    const target = TABS[(next + TABS.length) % TABS.length];
    if (target) {
      setTab(target.id);
      (document.getElementById(`wb-tab-${target.id}`) as HTMLElement | null)?.focus();
    }
  };
  return (
    <section className="wb-root wb-cockpit" aria-label="Workbench">
      <header className="wb-cockpit-head">
        <div>
          <h2>Workbench</h2>
          <p className="wb-muted">
            Governed work in <strong>{workspaceLabel}</strong>. Nothing here is accepted until the evidence says so.
          </p>
        </div>
        <button type="button" className="wb-btn" onClick={onClose}>
          Back to conversation
        </button>
      </header>
      <div role="tablist" aria-label="Workbench sections" className="wb-cockpit-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            id={`wb-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`wb-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "wb-cockpit-tab active" : "wb-cockpit-tab"}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wb-cockpit-notice" role="status" aria-live="polite">
        {notice && <span className={notice.kind === "error" ? "wb-error" : "wb-muted"}>{notice.text}</span>}
      </div>
      <div role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`} className="wb-cockpit-body">
        {tab === "tasks" && <TasksTab workspaceId={workspaceId} workspaceLabel={workspaceLabel} sessionId={sessionId} activeTaskId={activeTaskId} act={act} onWorkOnTask={onWorkOnTask} onTaskCreatedInSession={onTaskCreatedInSession} onFocus={onFocus} />}
        {tab === "workflows" && <WorkflowsTab workspaceId={workspaceId} act={act} onFocus={onFocus} />}
        {tab === "capabilities" && <CapabilitiesTab act={act} />}
        {tab === "automations" && <AutomationsTab workspaceId={workspaceId} act={act} />}
      </div>
    </section>
  );
}

type Act = ReturnType<typeof useWorkbenchActions>;

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------
function useEvidenceByTask(): ReadonlyMap<string, readonly EvidenceEntry[]> {
  const rows = useWbRows<EvidenceEntry>("evidence/");
  return useMemo(() => {
    const map = new Map<string, EvidenceEntry[]>();
    for (const r of rows) (map.get(r.value.taskId) ?? map.set(r.value.taskId, []).get(r.value.taskId)!).push(r.value);
    return map;
  }, [rows]);
}

function taskDoneLevel(task: TaskRecord, entries: readonly EvidenceEntry[]) {
  const acceptance = task.contract.acceptance ?? [];
  const rows = ledgerRows(acceptance, entries);
  const testedClosed = rows.length > 0 && rows.filter((r) => r.required && r.kind !== "human").every((r) => r.state === "closed");
  const readiness = reviewReadiness({ acceptance, entries, ...(task.workerReturn ? { workerReturn: task.workerReturn } : {}) });
  return doneLevel({
    finished: task.finished,
    produced: task.produced,
    readiness,
    testedClosed,
    accepted: task.status === "ACCEPTED" || task.status === "OPERATIONALIZED",
    operationalized: task.status === "OPERATIONALIZED",
  });
}

function TasksTab({ workspaceId, workspaceLabel, sessionId, activeTaskId, act, onWorkOnTask, onTaskCreatedInSession, onFocus }: { workspaceId: string; workspaceLabel: string; sessionId: string | undefined; activeTaskId: string | undefined; act: Act; onWorkOnTask: (id: string) => void; onTaskCreatedInSession: ((taskId: string) => void) | undefined; onFocus: (ref: FocusRef | undefined) => void }) {
  const allTasks = useWbRows<TaskRecord & { readonly scope?: string; readonly sessionId?: string }>("task/");
  const evidence = useEvidenceByTask();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const tasks = useMemo(() => allTasks.map((r) => r.value).filter((t) => t.workspaceId === workspaceId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [allTasks, workspaceId]);
  const selected = tasks.find((t) => t.id === selectedId);
  return (
    <div className="wb-tasks">
      <aside className="wb-tasks-list" aria-label="Tasks">
        <TaskList
          tasks={tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, missing: contractMissing(t.contract).length, doneLevel: taskDoneLevel(t, evidence.get(t.id) ?? []) }))}
          {...(selectedId ? { selectedId } : {})}
          onSelect={(id) => {
            setCreating(false);
            setSelectedId(id);
            const t = tasks.find((x) => x.id === id);
            onFocus(t ? { kind: "task", id: t.id, workspaceId, label: t.title } : undefined);
          }}
          onNew={() => {
            setCreating(true);
            setSelectedId(undefined);
          }}
        />
      </aside>
      <div className="wb-tasks-detail">
        {creating && (
          <NewTaskForm
            sessionId={sessionId}
            onCancel={() => setCreating(false)}
            onCreate={async (title, scope) => {
              const out = await act.call<{ taskId: string; scope: string }>("task.create", { title, workspaceId, scope, ...(scope === "session" && sessionId ? { sessionId } : {}) }, "Task created. Fill in its contract.");
              if (out) {
                setCreating(false);
                setSelectedId(out.taskId);
                onFocus({ kind: "task", id: out.taskId, workspaceId, label: title });
                // J-TASK-scope: creating a task *in this session* is the binding decision itself —
                // bind it (durable server-side, optimistic in the composer bar) so returning to the
                // conversation shows it next to the composer immediately.
                if (scope === "session" && sessionId) onTaskCreatedInSession?.(out.taskId);
              }
            }}
          />
        )}
        {!creating && selected && <TaskDetail key={selected.id} workspaceLabel={workspaceLabel} sessionId={sessionId} task={selected} entries={evidence.get(selected.id) ?? []} activeTaskId={activeTaskId} act={act} onWorkOnTask={onWorkOnTask} />}
        {!creating && !selected && tasks.length > 0 && <p className="wb-empty">Select a task to see its contract, evidence and review state.</p>}
      </div>
    </div>
  );
}

function NewTaskForm({ sessionId, onCreate, onCancel }: { sessionId: string | undefined; onCreate: (title: string, scope: "workspace" | "session") => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  // J-TASK-scope: the default follows the entry context — a task begun from an open conversation
  // starts as that conversation's own work; from a session-less cockpit it starts workspace-wide.
  const [scope, setScope] = useState<"workspace" | "session">(sessionId ? "session" : "workspace");
  // The create is durable (the capability waits for its recording runs), so the button shows the
  // real pending state instead of letting a second click race the first.
  const [pending, setPending] = useState(false);
  const canCreate = title.trim() !== "" && (scope === "workspace" || Boolean(sessionId)) && !pending;
  return (
    <form
      className="wb-section"
      aria-label="New task"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canCreate) return;
        setPending(true);
        void onCreate(title.trim(), scope).finally(() => setPending(false));
      }}
    >
      <h3>New task</h3>
      <p className="wb-muted wb-prose">A task starts with no authority. You will set its goal, skills, authority, executors, budget, invariants and acceptance criteria next.</p>
      <div className="wb-field">
        <label htmlFor="wb-new-title">What is the task called</label>
        <input id="wb-new-title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
      </div>
      <fieldset role="radiogroup" aria-label="Task visibility" className="wb-field wb-task-scope">
        <legend>Task visibility</legend>
        <label>
          <input type="radio" name="wb-task-scope" value="workspace" checked={scope === "workspace"} onChange={() => setScope("workspace")} />
          This workspace
        </label>
        <label>
          <input type="radio" name="wb-task-scope" value="session" checked={scope === "session"} disabled={!sessionId} onChange={() => setScope("session")} />
          This session
        </label>
        <p className="wb-muted wb-scope-hint">
          {scope === "session"
            ? "Only this conversation sees the task until it is promoted or moved; creating it here makes it the conversation's task."
            : "Every conversation in this workspace can pick the task; none gets it automatically."}
          {!sessionId && " Open a conversation to make a session task."}
        </p>
      </fieldset>
      <div className="wb-btn-row">
        <button type="submit" className="wb-btn primary" disabled={!canCreate} aria-busy={pending}>
          {pending ? "Creating…" : "Create task"}
        </button>
        <button type="button" className="wb-btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        {!canCreate && !pending && <span className="wb-muted">Enter a name to continue.</span>}
      </div>
    </form>
  );
}

function TaskDetail({ task, workspaceLabel, sessionId, entries, activeTaskId, act, onWorkOnTask }: { task: TaskRecord & { readonly scope?: string; readonly sessionId?: string }; workspaceLabel: string; sessionId: string | undefined; entries: readonly EvidenceEntry[]; activeTaskId: string | undefined; act: Act; onWorkOnTask: (id: string) => void }) {
  const [field, setField] = useState<ContractField | undefined>(undefined);
  const capRows = useWbRows<CapRow>("capability/");
  const blockedRows = useWbRows<BlockedRecord>("blocked/");
  const usage = useWbRow<UsageRow>(`usage/${task.id}`);
  const elevation = useWbRow<ElevationRecord>(`elevation/${task.workspaceId}`);
  const missing = contractMissing(task.contract);
  const acceptance = task.contract.acceptance ?? [];
  const rows = useMemo(() => ledgerRows(acceptance, entries), [acceptance, entries]);
  const groups = useMemo(() => groupLedger(entries), [entries]);
  const readiness = reviewReadiness({ acceptance, entries, ...(task.workerReturn ? { workerReturn: task.workerReturn } : {}) });
  const level = taskDoneLevel(task, entries);
  const locked = task.status === "RUNNING";
  const terminal = task.status === "ACCEPTED" || task.status === "OPERATIONALIZED";
  const econ = useMemo(() => rollupUsage(task.id, usage?.records ?? []), [task.id, usage]);
  const budget = budgetState(task.contract.budget, econ);
  const economics = (usage?.records.length ?? 0) > 0 ? provenanceLine(econ) : "No usage recorded for this task yet. Cost is unknown, not zero.";
  const blocked = blockedRows.map((r) => r.value).filter((b) => b.workspaceId === task.workspaceId && (!b.taskId || b.taskId === task.id));
  const closedCount = rows.filter((r) => r.state === "closed").length;
  const evidenceSummary = { closed: closedCount, total: rows.length, failed: rows.filter((r) => r.state === "failed").length };
  const prefill: WorkerReturn = task.workerReturn ?? {
    changed: task.activity?.changed ?? [],
    tested: (task.activity?.commands ?? []).filter((c) => TEST_COMMAND.test(c)),
    evidence: entries.filter((e) => e.status === "pass").map((e) => e.id),
    remaining: openRequired(rows).filter((r) => r.kind !== "human").map((r) => r.description),
    risks: [],
    readyForReview: false,
  };
  const reviewCard = (
    <ReviewCard
        status={task.status}
        intent={task.contract.goal?.outcome ?? "No goal set."}
        invariants={task.contract.invariants ?? []}
        changed={task.workerReturn?.changed ?? []}
        evidence={evidenceSummary}
        economics={economics}
        remaining={task.workerReturn?.remaining ?? []}
        blockers={readiness.blockers}
        canDecide
        onRequestReview={() => void act.call("task.review.request", { taskId: task.id }, "Submitted for review.")}
        onAccept={(note) => void act.call("task.review.decide", { taskId: task.id, decision: "accept", note }, "Accepted.")}
        onRework={(note) => void act.call("task.review.decide", { taskId: task.id, decision: "rework", note }, "Sent back for rework.")}
      />
  );
  // When the decision is the next action it leads; otherwise it sits after the evidence it depends on.
  const reviewFirst = task.status === "READY_FOR_REVIEW";
  return (
    <article className="wb-task" aria-label={`Task ${task.title}`}>
      <header className="wb-section wb-task-head">
        <div>
          <h3>{task.title}</h3>
          <p className="wb-muted wb-mono">{task.id}</p>
        </div>
        <div className="wb-btn-row">
          <span className={`wb-chip ${task.status === "RUNNING" ? "live" : task.status === "REWORK" ? "bad" : task.status === "ACCEPTED" || task.status === "OPERATIONALIZED" ? "ok" : ""}`}>{task.status.replace(/_/g, " ").toLowerCase()}</span>
          {task.id === activeTaskId && <span className="wb-chip live">bound to chat</span>}
        </div>
      </header>

      {reviewFirst && reviewCard}

      <section className="wb-section" aria-label="Task contract">
        <div className="wb-section-head">
          <h3>Contract</h3>
          <span className="wb-hint">Context, goal, skills, authority, executors, budget, invariants, acceptance</span>
        </div>
        <ContractBar contract={task.contract} workspaceLabel={workspaceLabel} {...(field ? { active: field } : {})} onSelect={setField} />
        {field && (
          <ContractEditor
            field={field}
            contract={task.contract}
            capabilities={capRows.map((r) => ({ id: r.value.def.id, purpose: r.value.def.purpose, category: r.value.def.category }))}
            locked={locked || terminal}
            onSave={async (patch) => {
              const saving = field;
              const out = await act.call("task.contract.update", { taskId: task.id, contract: patch }, "Contract saved.");
              // Close only the editor that was saved: the person may already be editing another field.
              if (out) setField((current) => (current === saving ? undefined : current));
            }}
            onClose={() => setField(undefined)}
          />
        )}
        <div className="wb-btn-row wb-task-actions">
          {task.status === "BRIEFING" && (
            <>
              <button type="button" className="wb-btn" disabled={missing.length > 0} onClick={() => void act.call("task.status.change", { taskId: task.id, to: "READY" }, "Task is ready.")}>
                Mark ready
              </button>
              {missing.length > 0 && <span className="wb-muted">Missing: {missing.join(", ")}.</span>}
            </>
          )}
          {(task.status === "READY" || task.status === "REWORK") && (
            <button
              type="button"
              className="wb-btn"
              onClick={async () => {
                const out = await act.call("task.status.change", { taskId: task.id, to: "RUNNING" });
                if (out) onWorkOnTask(task.id);
              }}
            >
              Work on this task in the conversation
            </button>
          )}
          {task.status === "RUNNING" && (
            <button type="button" className="wb-btn" onClick={() => onWorkOnTask(task.id)}>
              Go to the conversation
            </button>
          )}
          {!locked && !terminal && <MoveTaskControl task={task} sessionId={sessionId} act={act} />}
          {locked && <span className="wb-muted">Moving is blocked while the task runs — stop it first.</span>}
        </div>
      </section>

      <section className="wb-section" aria-label="Progress">
        <div className="wb-section-head">
          <h3>How done is it</h3>
        </div>
        <DoneLadder level={level} />
      </section>

      <LedgerPanel
        rows={rows}
        groups={groups}
        locked={terminal}
        onRecord={(e) => void act.call("evidence.record", { taskId: task.id, ...e }, "Evidence recorded.")}
      />

      {!terminal && (
        <WorkerReturnForm
          key={`${task.activity?.changed.length ?? 0}-${task.activity?.commands.length ?? 0}-${task.workerReturn ? "r" : "n"}`}
          initial={prefill}
          onSubmit={(r) => void act.call("worker.return", { taskId: task.id, workerReturn: r }, "Return contract saved.")}
        />
      )}

      {!reviewFirst && reviewCard}

      <section className="wb-section" aria-label="Economics">
        <div className="wb-section-head">
          <h3>Economics</h3>
          <span className="wb-hint">The unit is the task, not the prompt</span>
        </div>
        <p className="wb-mono">{economics}</p>
        {budget.lines.length > 0 && (
          <ul className="wb-list">
            {budget.lines.map((l) => (
              <li key={l.metric}>
                <span className="wb-muted">{l.metric}</span> {l.used === undefined ? "unknown" : l.used} of {l.limit}{" "}
                <span className={`wb-chip ${l.level === "exceeded" ? "bad" : l.level === "warn" ? "warn" : "ok"}`}>{l.level === "warn" ? "near limit" : l.level}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wb-section" aria-label="Authority">
        <AuthorityPlane
          rows={describeAuthority(task.contract.authority ?? defaultAuthority())}
          blocked={blocked}
          elevated={elevation?.paths ?? []}
          canElevate
          onElevate={(path) => void act.call("authority.elevate", { workspaceId: task.workspaceId, path }, `Elevated ${path}. Writes to it still need approval.`)}
        />
      </section>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------
function WorkflowsTab({ workspaceId, act, onFocus }: { workspaceId: string; act: Act; onFocus: (ref: FocusRef | undefined) => void }) {
  const defs = useWbRows<WorkflowDefinition>("workflow/");
  const instances = useWbRows<WorkflowInstanceRecord>("instance/");
  const bindings = useWbRows<BindingRecord>("binding/");
  const caps = useWbRows<CapRow>("capability/");
  const [defId, setDefId] = useState<string | undefined>(undefined);
  const [instId, setInstId] = useState<string | undefined>(undefined);
  const [nodeId, setNodeId] = useState<string | undefined>(undefined);
  const def = defs.find((d) => d.id === (defId ?? defs[0]?.id))?.value;
  const mine = instances.map((r) => r.value).filter((i) => i.workspaceId === workspaceId && i.workflowId === def?.id);
  const inst = mine.find((i) => i.id === instId) ?? mine[0];
  if (defs.length === 0) {
    return (
      <div className="wb-empty">
        <p>
          <strong>A workflow is the dependency and acceptance structure of purposeful work.</strong> It stays the same when the tools or models that execute it change.
        </p>
        <button type="button" className="wb-btn primary" onClick={() => void act.call("workbench.seed", {}, "Starter catalog and workflows loaded.")}>
          Load the starter workflows
        </button>
      </div>
    );
  }
  const node = def?.nodes.find((n) => n.id === nodeId);
  const capRow = node ? caps.find((c) => c.value.def.id === node.capability)?.value : undefined;
  const binding = capRow?.activeImplementation ? bindings.find((b) => b.id === `${capRow.def.id}/${capRow.activeImplementation}`)?.value.binding : undefined;
  return (
    <div className="wb-workflows">
      <div className="wb-btn-row">
        <div className="wb-field">
          <label htmlFor="wb-wf-pick">Workflow</label>
          <select
            id="wb-wf-pick"
            value={def?.id ?? ""}
            onChange={(e) => {
              setDefId(e.currentTarget.value);
              setInstId(undefined);
              setNodeId(undefined);
            }}
          >
            {defs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.value.name} (v{d.value.version})
              </option>
            ))}
          </select>
        </div>
        {mine.length > 0 && (
          <div className="wb-field">
            <label htmlFor="wb-wf-inst">Instance</label>
            <select id="wb-wf-inst" value={inst?.id ?? ""} onChange={(e) => setInstId(e.currentTarget.value)}>
              {mine.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="button" className={inst ? "wb-btn" : "wb-btn primary"} onClick={() => def && void act.call("workflow.instantiate", { workflowId: def.id, workspaceId }, "Workflow instance started.")}>
          Start an instance for this workspace
        </button>
      </div>
      {def && <p className="wb-muted wb-prose">{def.outcome}</p>}
      {def && !inst && <p className="wb-muted">Start an instance to see which stages are unlocked. The graph below is the definition.</p>}
      {def && (
        <WorkflowGraph def={def} status={inst?.status ?? {}} closed={inst?.closed ?? {}} {...(nodeId ? { selected: nodeId } : {})} onSelect={(id) => { setNodeId(id); onFocus({ kind: "workflow-node", id, workspaceId, label: id }); }} />
      )}
      {def && node && inst && (
        <NodeInspector
          def={def}
          nodeId={node.id}
          status={inst.status}
          closed={inst.closed}
          {...(binding ? { binding } : {})}
          invariants={[]}
          onAdvance={(to: NodeStatus, closedEvidence?: readonly EvidenceKind[]) => void act.call("workflow.node.advance", { instanceId: inst.id, nodeId: node.id, to, ...(closedEvidence ? { closedEvidence } : {}) })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------------------------
function CapabilitiesTab({ act }: { act: Act }) {
  const caps = useWbRows<CapRow>("capability/");
  const bindings = useWbRows<BindingRecord>("binding/");
  const rows: CapListRow[] = useMemo(
    () =>
      caps.map((c) => ({
        def: c.value.def,
        implementations: bindings.filter((b) => b.value.binding.capabilityId === c.id).map((b) => ({ binding: b.value.binding, state: b.value.state })),
        ...(c.value.activeImplementation ? { active: c.value.activeImplementation } : {}),
      })),
    [caps, bindings],
  );
  const conflicts = useMemo(
    () => detectConflicts(caps.map((c) => c.value.def), [...new Set(bindings.filter((b) => ACTIVE_STATES.has(b.value.state)).map((b) => b.value.binding.capabilityId))]),
    [caps, bindings],
  );
  return (
    <CapabilityList
      capabilities={rows}
      conflicts={conflicts}
      canGrant
      onAdvance={(capabilityId, implementationId, to) => void act.call("skill.lifecycle.advance", { capabilityId, implementationId, to }, `Advanced to ${to.toLowerCase().replace(/_/g, " ")}.`)}
      onSeed={() => void act.call("workbench.seed", {}, "Starter catalog and workflows loaded.")}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------------------------
function AutomationsTab({ workspaceId, act }: { workspaceId: string; act: Act }) {
  const autos = useWbRows<AutomationRecord>("automation/");
  const tasks = useWbRows<TaskRecord>("task/");
  const accepted = tasks.map((t) => t.value).filter((t) => t.workspaceId === workspaceId && t.status === "ACCEPTED");
  const onCreate = useCallback(
    (input: { name: string; schedule: AutomationRecord["schedule"]; substrate: AutomationRecord["run"]["substrate"]; acceptance: string[]; sourceTaskId?: string }) => {
      void act.call("automation.create", input, "Automation created.");
    },
    [act],
  );
  return (
    <AutomationPanel
      runs={autos.map((a) => ({ id: a.id, record: a.value }))}
      acceptedTasks={accepted.map((t) => ({ id: t.id, title: t.title }))}
      onCreate={onCreate}
      onAdvance={(id, to, facts) => void act.call("automation.advance", { id, to, ...(facts ?? {}) })}
    />
  );
}

/** Convenience for the app shell: tasks the chat composer can bind to from this session.
 *  J-TASK-scope: every task of the workspace is *available* here (scope is visibility, not
 *  eligibility-by-status — a fresh task can be bound and its contract governs from turn one);
 *  a session-scoped task appears only inside its owning session. */
export function useBindableTasks(workspaceId: string | undefined, sessionId?: string): readonly TaskRecord[] {
  const rows = useWbRows<TaskRecord & { readonly scope?: string; readonly sessionId?: string }>("task/");
  return useMemo(
    () =>
      rows
        .map((r) => r.value)
        .filter((t) => t.workspaceId === workspaceId && ((t.scope ?? "workspace") !== "session" || (sessionId !== undefined && t.sessionId === sessionId))),
    [rows, workspaceId, sessionId],
  );
}


// ---------------------------------------------------------------------------------------------
// J-TASK-move: the governed move/promote/detach affordance
// ---------------------------------------------------------------------------------------------

/** Sessions currently bound to a task (the public `session-task-bindings` projection). */
function useSessionsBoundToTask(taskId: string): readonly { readonly sessionId: string; readonly workspaceId: string }[] {
  const rows = useProjection("session-task-bindings");
  return useMemo(
    () => (rows ?? []).map((r) => r.value as { readonly sessionId: string; readonly workspaceId: string; readonly taskId: string | null }).filter((b) => b.taskId === taskId),
    [rows, taskId],
  );
}

/**
 * One explicit, discoverable mutation for promoting a session task to its workspace, moving a task
 * to another workspace, or moving it into this session — with the consequences stated before the
 * person commits. The capability preserves the task's identity, evidence and provenance and
 * invalidates stale bindings; this control explains what that means in product words.
 */
function MoveTaskControl({ task, sessionId, act }: { task: TaskRecord & { readonly scope?: string; readonly sessionId?: string }; sessionId: string | undefined; act: Act }) {
  const workspaceRows = useProjection("workspaces");
  const boundConversations = useSessionsBoundToTask(task.id);
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<string>("");
  const workspaces = useMemo(
    () => (workspaceRows ?? []).filter((r) => r.key.startsWith("record/")).map((r) => r.value as { readonly id: string; readonly title: string }),
    [workspaceRows],
  );
  const others = workspaces.filter((w) => w.id !== task.workspaceId);
  const currentScope = (task.scope ?? "workspace") === "session" ? "this session" : "this workspace";
  const target = destination === "workspace" ? { workspaceId: task.workspaceId, label: `This workspace (${workspaces.find((w) => w.id === task.workspaceId)?.title ?? task.workspaceId})` } : destination === "session" ? { sessionId: sessionId ?? "", label: "This session" } : others.find((w) => w.id === destination) ? { workspaceId: destination, label: `Workspace ${others.find((w) => w.id === destination)!.title}` } : undefined;

  if (!open) {
    return (
      <button type="button" className="wb-btn" onClick={() => setOpen(true)}>
        Move or promote…
      </button>
    );
  }
  return (
    <div className="wb-move-control" role="group" aria-label="Move or promote this task">
      <span className="wb-muted">Currently visible in: <strong>{currentScope}</strong>{boundConversations.length > 0 ? ` · bound in ${boundConversations.length} conversation${boundConversations.length === 1 ? "" : "s"}` : " · no conversation has it active"}</span>
      <label className="wb-field">
        <span className="wb-muted">Destination</span>
        <select aria-label="Move destination" value={destination} onChange={(e) => setDestination(e.currentTarget.value)}>
          <option value="">Choose a destination…</option>
          {(task.scope ?? "workspace") === "session" && <option value="workspace">This workspace — promote it</option>}
          {(task.scope ?? "workspace") !== "session" && sessionId && <option value="session">This session</option>}
          {others.map((w) => (
            <option key={w.id} value={w.id}>
              Workspace: {w.title}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <p className="wb-muted wb-scope-hint" role="status">
          {destination === "workspace"
            ? "Promoting makes the task available in every conversation of this workspace; none gets it automatically. Its evidence, history and origin stay unchanged."
            : destination === "session"
              ? "Only this conversation will see the task. Its evidence and history stay unchanged."
              : `Moving to ${target.label} recalculates which paths, tools, executors, budget and protected folders apply — the contract's workspace context is revalidated. Evidence and past runs are preserved and never reparented; conversations bound here fall back to no task.`}
        </p>
      )}
      <div className="wb-btn-row">
        <button
          type="button"
          className="wb-btn"
          disabled={!target}
          onClick={async () => {
            if (!target) return;
            const out =
              destination === "session"
                ? await act.call("task.move", { taskId: task.id, to: { sessionId: target.sessionId } }, "Task moved into this session.")
                : await act.call("task.move", { taskId: task.id, to: { workspaceId: (target as { workspaceId: string }).workspaceId } }, "Task moved.");
            if (out) setOpen(false);
          }}
        >
          Move task
        </button>
        <button type="button" className="wb-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
