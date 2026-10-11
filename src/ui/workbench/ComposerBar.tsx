// The bar above the composer: which task this conversation serves (Context | Goal | Authority ...
// live in the Workbench) and the run's real runtime state. Binding a task scopes the agent's
// authority and attributes its usage. Serves J-WB-task-contract and J-WB-economics.
import { useMemo } from "react";
import { budgetState, provenanceLine, rollupUsage } from "../../workbench/economics.ts";
import type { UsageRow } from "../../workbench/state.ts";
import { describeFocusRef, type AttentionLevel, type FocusRef } from "../../workbench/focus.ts";
import { RuntimeStrip } from "./RuntimeStrip.tsx";
import { useBindableTasks } from "./Workbench.tsx";
import { useWbRow } from "./data.ts";

export interface ComposerBarProps {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly onTaskChange: (taskId: string | undefined) => void;
  readonly onOpenWorkbench: () => void;
  readonly state: "idle" | "running" | "waiting";
  readonly steps: number;
  readonly elapsedSeconds: number;
  readonly approvalsPending: number;
  /** What "this" means right now, and why (fixed precedence; see `workbench/focus.ts`). */
  readonly referent?: { readonly ref: FocusRef; readonly level: AttentionLevel };
  readonly onClearFocus: () => void;
}

const LEVEL_WORDS: Readonly<Record<AttentionLevel, string>> = {
  "explicit-selection": "selected in the Workbench",
  "keyboard-focus": "keyboard focus",
  "active-run": "the task this conversation is bound to",
  "pinned-focus": "pinned",
  "workspace-fallback": "workspace",
};

export function ComposerBar({ workspaceId, sessionId, taskId, onTaskChange, onOpenWorkbench, state, steps, elapsedSeconds, approvalsPending, referent, onClearFocus }: ComposerBarProps) {
  const tasks = useBindableTasks(workspaceId);
  const bound = tasks.find((t) => t.id === taskId);
  const usage = useWbRow<UsageRow>(`usage/${taskId ?? `session:${sessionId ?? "none"}`}`);
  const econ = useMemo(() => rollupUsage(taskId ?? "", usage?.records ?? []), [taskId, usage]);
  const hasUsage = (usage?.records.length ?? 0) > 0;
  const budget = bound ? budgetState(bound.contract.budget, econ) : undefined;
  return (
    <div className="wb-root wb-composerbar" aria-label="Task and runtime">
      <div className="wb-composerbar-task">
        <label htmlFor="wb-bind-task" className="wb-muted">
          Task
        </label>
        <select id="wb-bind-task" value={taskId ?? ""} disabled={state !== "idle"} onChange={(e) => onTaskChange(e.currentTarget.value || undefined)}>
          <option value="">No task (no contract applies)</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button type="button" className="wb-btn" onClick={onOpenWorkbench}>
          Open Workbench
        </button>
        {state !== "idle" && <span className="wb-muted">Locked while the run is active.</span>}
        {state === "idle" && tasks.length === 0 && <span className="wb-muted">No task is ready. Create and ready one in the Workbench to give this conversation a contract.</span>}
      </div>
      <div className="wb-composerbar-focus" role="status" aria-label="Focus">
        {referent ? (
          <>
            <span className="wb-muted">Saying &quot;this&quot; means</span> <strong>{describeFocusRef(referent.ref)}</strong>
            <span className="wb-muted"> ({LEVEL_WORDS[referent.level]})</span>
            {referent.level === "explicit-selection" && (
              <button type="button" className="wb-btn" onClick={onClearFocus}>
                Clear focus
              </button>
            )}
          </>
        ) : (
          <span className="wb-muted">Nothing is in focus. Select a task or workflow stage in the Workbench to give &quot;this&quot; a meaning.</span>
        )}
      </div>
      <RuntimeStrip
        state={state}
        {...(bound ? { taskTitle: bound.title } : {})}
        {...(state !== "idle" ? { elapsedSeconds, steps } : {})}
        {...(hasUsage ? { tokens: econ.totalTokens, ...(econ.costUsd !== undefined ? { costUsd: econ.costUsd } : {}), provenance: provenanceLine(econ), concurrency: econ.peakConcurrency } : {})}
        {...(budget && hasUsage ? { budget: budget.level } : {})}
        {...(approvalsPending > 0 ? { approvalsPending } : {})}
      />
    </div>
  );
}
