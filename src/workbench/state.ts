// Shapes of the rows the public `workbench` projection holds (and the UI reads). Pure types; the
// durable truth is the `workbench.*` event log, these rows are derived and rebuildable.
import type { Inbox } from "./steering.ts";
import type { AutomationRun, Schedule } from "./automation.ts";
import type { UsageRecord } from "./economics.ts";
import type { GroundedFeedback } from "./grounded.ts";
import type { Substitution } from "./skillOs.ts";
import type {
  CapabilityContractDef,
  CapabilityState,
  EvidenceEntry,
  EvidenceKind,
  ImplementationBinding,
  NodeStatus,
  TaskContract,
  TaskStatus,
  WorkerReturn,
  WorkflowDefinition,
} from "./types.ts";

export interface TaskRecord {
  readonly id: string;
  readonly title: string;
  readonly workspaceId: string;
  readonly status: TaskStatus;
  readonly contract: Partial<TaskContract>;
  readonly workerReturn?: WorkerReturn;
  /** §24 "done" components, kept separate on purpose. */
  readonly finished: boolean;
  readonly produced: boolean;
  readonly humanApproved: boolean;
  readonly operationalized: boolean;
  readonly reviewNote?: string;
  readonly reviewRequestedAt?: string;
  /** What the agent actually did for this task (from tool events), used to prefill the return contract. */
  readonly activity?: { readonly changed: readonly string[]; readonly commands: readonly string[] };
  readonly createdAt: string;
}

/**
 * J-TASK-scope: a Task's visibility. One Task entity — `scope` is where the task is *available
 * for binding*, never an automatic active association. A workspace task is available from every
 * session of its workspace; a session task (the `sessionId` of its owning session) is available
 * only there until promoted or moved. `originWorkspaceId` preserves the source-workspace
 * provenance a move must never erase (J-TASK-move).
 */
export type TaskScope = "workspace" | "session";
export interface ScopedTaskRecord extends TaskRecord {
  readonly scope: TaskScope;
  readonly sessionId?: string;
  readonly originWorkspaceId?: string;
}

export interface WorkflowInstanceRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly workspaceId: string;
  readonly status: Readonly<Record<string, NodeStatus>>;
  readonly closed: Readonly<Record<string, readonly EvidenceKind[]>>;
}

export interface CapabilityRecord {
  readonly def: CapabilityContractDef;
  /** The implementation currently selected for this capability (substitution swaps it). */
  readonly activeImplementation?: string;
}

export interface BindingRecord {
  readonly binding: ImplementationBinding;
  readonly state: CapabilityState;
  readonly substitution?: Substitution;
}

export interface AutomationRecord {
  readonly run: AutomationRun;
  readonly schedule: Schedule;
  readonly nextFire?: string;
  readonly workflowId?: string;
}

export interface UsageRow {
  readonly records: readonly UsageRecord[];
}

export interface FeedbackRecord {
  readonly id: string;
  readonly taskId?: string;
  readonly feedback: GroundedFeedback;
}

export interface ElevationRecord {
  readonly paths: readonly string[];
}

export interface BlockedRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskId?: string;
  readonly tool: string;
  readonly path: string;
  readonly pattern: string;
  readonly reason: string;
}

export type { EvidenceEntry, Inbox, WorkflowDefinition };
