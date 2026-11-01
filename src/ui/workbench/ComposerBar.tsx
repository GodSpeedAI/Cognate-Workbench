// The context bar: ONE compact row of chips at the top edge of the composer card — workspace folder,
// execution posture, which task this conversation serves (Context | Goal | Authority ... live in
// the Workbench), what "this" means when something is in focus, and the run's real runtime state. Binding a task scopes the agent's
// authority and attributes its usage. Serves J-WB-task-contract, J-WB-economics and
// J-TASK-scope: the control shows this session's durable binding, "No task" is an obvious,
// valid state, and changing the value writes the binding through `session.task.bind` — never a
// silent global switch.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, FolderIcon, ListViewIcon, ShieldIcon } from "../icons.tsx";
import { budgetState, provenanceLine, rollupUsage } from "../../workbench/economics.ts";
import type { TaskRecord, UsageRow } from "../../workbench/state.ts";
import { describeFocusRef, type AttentionLevel, type FocusRef } from "../../workbench/focus.ts";
import { CheckoutChip } from "./CheckoutChip.tsx";
import { RuntimeStrip } from "./RuntimeStrip.tsx";
import { useBindableTasks } from "./Workbench.tsx";
import { useWbRow } from "./data.ts";

export interface ComposerBarProps {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly onTaskChange: (taskId: string | undefined) => void;
  /** A readable refusal from the binding capability, shown where the person can act on it. */
  readonly bindError?: string;
  readonly onOpenWorkbench: () => void;
  readonly state: "idle" | "running" | "waiting";
  readonly steps: number;
  readonly elapsedSeconds: number;
  readonly approvalsPending: number;
  /** What "this" means right now, and why (fixed precedence; see `workbench/focus.ts`). */
  readonly referent?: { readonly ref: FocusRef; readonly level: AttentionLevel };
  readonly onClearFocus: () => void;
  /** The workspace folder this conversation runs in, and where it executes. */
  readonly workspaceTitle?: string;
  readonly workspaceRoot?: string;
  readonly posture?: { readonly short: string; readonly detail: string };
}

const LEVEL_WORDS: Readonly<Record<AttentionLevel, string>> = {
  "explicit-selection": "selected in the Workbench",
  "keyboard-focus": "keyboard focus",
  "active-run": "the task this conversation is bound to",
  "pinned-focus": "pinned",
  "workspace-fallback": "workspace",
};

function TaskChip({
  tasks,
  taskId,
  locked,
  onTaskChange,
  onOpenWorkbench,
}: {
  readonly tasks: readonly (TaskRecord & { readonly scope?: string })[];
  readonly taskId: string | undefined;
  readonly locked: boolean;
  readonly onTaskChange: (taskId: string | undefined) => void;
  readonly onOpenWorkbench: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const bound = tasks.find((t) => t.id === taskId);
  const label = bound ? bound.title : taskId ? "Selected task" : "No task";
  const sessionScoped = bound?.scope === "session";
  const pick = (id: string | undefined) => {
    setOpen(false);
    onTaskChange(id);
    btnRef.current?.focus();
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  };
  return (
    <span className="ctx-menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        id="wb-bind-task"
        className={`ctx-chip ctx-chip-button${bound || taskId ? " is-set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Task: ${label}${sessionScoped ? " (this session)" : ""}`}
        disabled={locked}
        title={locked ? "Locked while the run is active." : bound ? "Task bound to this conversation — changing or clearing it never rewrites past runs." : "No contract applies. Bind a task to scope authority and attribute usage."}
        onClick={() => setOpen((v) => !v)}
      >
        <ListViewIcon aria-hidden="true" />
        <span className="ctx-chip-text">{label}</span>
        {sessionScoped && <span className="ctx-chip-note">this session</span>}
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Task" className="ctx-menu" onKeyDown={onMenuKey}>
          <button type="button" role="menuitemradio" aria-checked={!taskId} onClick={() => pick(undefined)}>
            <span className="ctx-menu-check">{!taskId && <CheckIcon />}</span>
            <span>No task <span className="ctx-menu-sub">no contract applies</span></span>
          </button>
          {tasks.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === taskId} onClick={() => pick(t.id)}>
              <span className="ctx-menu-check">{t.id === taskId && <CheckIcon />}</span>
              <span>
                {t.title}
                {t.scope === "session" && <span className="ctx-menu-sub"> this session</span>}
              </span>
            </button>
          ))}
          {taskId && !bound && (
            <button type="button" role="menuitemradio" aria-checked="true" onClick={() => pick(taskId)}>
              <span className="ctx-menu-check"><CheckIcon /></span>
              <span>Selected task</span>
            </button>
          )}
          {tasks.length === 0 && !taskId && <p className="ctx-menu-empty">No tasks in this workspace yet.</p>}
          <div className="ctx-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenWorkbench();
            }}
          >
            <span className="ctx-menu-check" />
            <span>Open Workbench</span>
          </button>
        </div>
      )}
    </span>
  );
}

export function ComposerBar({ workspaceId, sessionId, taskId, onTaskChange, bindError, onOpenWorkbench, state, steps, elapsedSeconds, approvalsPending, referent, onClearFocus, workspaceTitle, workspaceRoot, posture }: ComposerBarProps) {
  const tasks = useBindableTasks(workspaceId, sessionId);
  const bound = tasks.find((t) => t.id === taskId);
  const usage = useWbRow<UsageRow>(`usage/${taskId ?? `session:${sessionId ?? "none"}`}`);
  const econ = useMemo(() => rollupUsage(taskId ?? "", usage?.records ?? []), [taskId, usage]);
  const hasUsage = (usage?.records.length ?? 0) > 0;
  const budget = bound ? budgetState(bound.contract.budget, econ) : undefined;
  return (
    <div className="wb-root wb-composerbar" aria-label="Task and runtime">
      <div className="ctx-row">
        {workspaceTitle !== undefined && (
          <span className="ctx-chip" title={workspaceRoot ?? workspaceTitle}>
            <FolderIcon aria-hidden="true" />
            <span className="ctx-chip-text">{workspaceTitle || "Workspace"}</span>
          </span>
        )}
        {posture && (
          <span className="ctx-chip ctx-chip-posture" title={posture.detail} tabIndex={0} aria-label={`Execution: ${posture.detail}`}>
            <ShieldIcon aria-hidden="true" />
            <span className="ctx-chip-text">{posture.short}</span>
          </span>
        )}
        <TaskChip tasks={tasks} taskId={taskId} locked={state !== "idle"} onTaskChange={onTaskChange} onOpenWorkbench={onOpenWorkbench} />
        {referent && (
          <span className="ctx-chip ctx-chip-focus" role="status" aria-label="Focus" title={`"this" means ${describeFocusRef(referent.ref)} (${LEVEL_WORDS[referent.level]})`}>
            <span className="ctx-chip-key">Focus</span>
            <strong className="ctx-chip-text">{describeFocusRef(referent.ref)}</strong>
            <span className="ctx-chip-note">{LEVEL_WORDS[referent.level]}</span>
            {referent.level === "explicit-selection" && (
              <button type="button" className="ctx-chip-clear" onClick={onClearFocus} aria-label="Clear focus" title="Clear focus">
                ×
              </button>
            )}
          </span>
        )}
        <span className="ctx-row-spacer" />
        <RuntimeStrip
          compact
          state={state}
          {...(bound ? { taskTitle: bound.title } : {})}
          {...(state !== "idle" ? { elapsedSeconds, steps } : {})}
          {...(hasUsage ? { tokens: econ.totalTokens, ...(econ.costUsd !== undefined ? { costUsd: econ.costUsd } : {}), provenance: provenanceLine(econ), concurrency: econ.peakConcurrency } : {})}
          {...(budget && hasUsage ? { budget: budget.level } : {})}
          {...(approvalsPending > 0 ? { approvalsPending } : {})}
        />
      </div>
      {bindError && (
        <span className="wb-error" role="alert">
          {bindError}
        </span>
      )}
      {taskId && (
        <div className="ctx-row ctx-row-checkout">
          <CheckoutChip workspaceId={workspaceId} taskId={taskId} taskTitle={bound?.title ?? "task"} locked={state !== "idle"} />
        </div>
      )}
    </div>
  );
}
