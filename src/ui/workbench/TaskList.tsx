/**
 * TaskList: groups tasks by status, shows count and state per task.
 * Allows selecting a task and creating new tasks.
 */

import type { DoneLevel, TaskStatus } from "../../workbench/types";

export interface TaskListProps {
  readonly tasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: TaskStatus;
    readonly missing: number;
    readonly doneLevel: DoneLevel;
  }[];
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
}

const STATUS_ORDER: readonly TaskStatus[] = [
  "BACKLOG",
  "BRIEFING",
  "READY",
  "RUNNING",
  "BLOCKED",
  "READY_FOR_REVIEW",
  "REWORK",
  "ACCEPTED",
  "OPERATIONALIZED",
];

const STATUS_DISPLAY_NAMES: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  BRIEFING: "Briefing",
  READY: "Ready",
  RUNNING: "Running",
  BLOCKED: "Blocked",
  READY_FOR_REVIEW: "Ready for review",
  REWORK: "Rework",
  ACCEPTED: "Accepted",
  OPERATIONALIZED: "Operationalized",
};

function getStatusChipClass(status: TaskStatus): string {
  switch (status) {
    case "RUNNING":
      return "live";
    case "BLOCKED":
    case "READY_FOR_REVIEW":
      return "warn";
    case "REWORK":
      return "bad";
    case "ACCEPTED":
    case "OPERATIONALIZED":
      return "ok";
    default:
      return "";
  }
}

export function TaskList({
  tasks,
  selectedId,
  onSelect,
  onNew,
}: TaskListProps) {
  // Group tasks by status
  const groupedByStatus = new Map<TaskStatus, typeof tasks>();

  for (const status of STATUS_ORDER) {
    const filtered = tasks.filter((t) => t.status === status);
    if (filtered.length > 0) {
      groupedByStatus.set(status, filtered);
    }
  }

  const hasAnyTasks = tasks.length > 0;

  return (
    <section className="wb-section wb-taskList">
      <div className="wb-section-head">
        <h3>
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </h3>
        {hasAnyTasks && (
          <button
            type="button"
            className="wb-btn primary"
            onClick={onNew}
          >
            New task
          </button>
        )}
      </div>

      {!hasAnyTasks ? (
        <div className="wb-empty">
          <p>
            A task is the unit of governed work: a goal, a contract, and
            evidence that it is done. Create one to begin.
          </p>
          <button
            type="button"
            className="wb-btn primary"
            onClick={onNew}
          >
            New task
          </button>
        </div>
      ) : (
        <div className="wb-taskList-groups">
          {Array.from(groupedByStatus.entries()).map(([status, statusTasks]) => (
            <div key={status} className="wb-taskList-group">
              <h4 className="wb-taskList-groupHead">
                {STATUS_DISPLAY_NAMES[status]!}
              </h4>
              <ul className="wb-list wb-taskList-taskList">
                {statusTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="wb-taskList-taskButton"
                      onClick={() => onSelect(task.id)}
                      aria-pressed={selectedId === task.id}
                    >
                      <span className="wb-taskList-taskTitle">
                        {task.title}
                      </span>
                      <span
                        className={`wb-chip ${getStatusChipClass(task.status)}`}
                      >
                        {STATUS_DISPLAY_NAMES[task.status]!}
                      </span>
                      {task.missing > 0 && (
                        <span className="wb-taskList-missing">
                          {task.missing} contract{" "}
                          {task.missing === 1 ? "field" : "fields"} missing
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
