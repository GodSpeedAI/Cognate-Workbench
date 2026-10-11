// Shared vocabulary for the workbench layer (Unified Harness Experience Model v2). Pure types only:
// every domain module under `src/workbench/` imports from here; nothing here imports runtime code.
// Names follow the plan's sections (§ numbers in comments) and the IDM's Entities in
// `.sea/interaction/interaction-model.sea`.

// ---- Task Contract (§2.3) -----------------------------------------------------------------------
export type Grant = "yes" | "approval" | "no";

/** §11 Authority plane: inspectable capability scopes, not a single mode. */
export interface AuthorityScopes {
  readonly filesystem: { readonly read: Grant; readonly write: Grant; readonly outsideWorkspace: Grant };
  readonly shell: { readonly run: Grant; readonly destructive: Grant };
  readonly network: { readonly outbound: Grant };
  readonly packages: { readonly install: Grant };
  readonly extensions: { readonly install: Grant; readonly enable: Grant };
  /** Workspace-relative patterns (`dir/`, `file.csv`, `*.csv`, `tests/**`) that are immutable. */
  readonly protectedPaths: readonly string[];
}

export type InvariantKind = "domain" | "product" | "design" | "governance" | "workflow";
export interface Invariant {
  readonly id: string;
  readonly kind: InvariantKind;
  readonly statement: string;
}

export type AcceptanceKind = "test" | "independent-check" | "journey" | "audit" | "integrity" | "human";
export interface AcceptanceCriterion {
  readonly id: string;
  readonly kind: AcceptanceKind;
  readonly description: string;
  readonly required: boolean;
}

export type ExecutorRole = "primary" | "architect" | "worker" | "verifier";
export interface ExecutorBinding {
  readonly role: ExecutorRole;
  /** e.g. `model:deepseek-chat`, `tool:bun-test`. */
  readonly executor: string;
  readonly kind: "llm" | "deterministic";
  readonly billingRoute?: string;
}

export interface Budget {
  readonly maxMs?: number;
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  readonly maxConcurrency?: number;
}

export interface TaskContract {
  /** Context: the explicit workspace binding (workspace existence is not task scope). */
  readonly context: { readonly workspaceId?: string; readonly files: readonly string[]; readonly branch?: string };
  readonly goal: { readonly outcome: string; readonly deliverable?: string; readonly nonGoals: readonly string[] };
  /** Capability ids (Skill OS) the task requires. */
  readonly skills: readonly string[];
  readonly authority?: AuthorityScopes;
  readonly executors: readonly ExecutorBinding[];
  readonly budget?: Budget;
  readonly invariants: readonly Invariant[];
  readonly acceptance: readonly AcceptanceCriterion[];
}

export type ContractField = "context" | "goal" | "skills" | "authority" | "executors" | "budget" | "invariants" | "acceptance";
export const CONTRACT_FIELDS: readonly ContractField[] = ["context", "goal", "skills", "authority", "executors", "budget", "invariants", "acceptance"];

// ---- Task lifecycle and done taxonomy (§8, §24, §26) --------------------------------------------
/** §26 universal board states. */
export type TaskStatus = "BACKLOG" | "BRIEFING" | "READY" | "RUNNING" | "BLOCKED" | "READY_FOR_REVIEW" | "REWORK" | "ACCEPTED" | "OPERATIONALIZED";
/** §24 "Done is not a single event": the UI must not collapse these. */
export type DoneLevel = "not-started" | "finished" | "produced" | "tested" | "ready-for-review" | "accepted" | "operationalized";

// ---- Evidence ledger (§13) ----------------------------------------------------------------------
export type EvidenceKind = AcceptanceKind | "domain" | "implementation" | "quality" | "runtime";
export type EvidenceStatus = "pass" | "fail" | "pending";
export interface EvidenceEntry {
  readonly id: string;
  readonly taskId: string;
  /** Acceptance criterion this closes, if any. */
  readonly criterionId?: string;
  readonly kind: EvidenceKind;
  readonly status: EvidenceStatus;
  readonly summary: string;
  /** Pointer to the observable source (event id, artifact id, test file). */
  readonly source?: string;
}

/** §9 worker return contract: changed → tested → evidence → remaining. */
export interface WorkerReturn {
  readonly changed: readonly string[];
  readonly tested: readonly string[];
  readonly evidence: readonly string[];
  readonly remaining: readonly string[];
  readonly risks: readonly string[];
  readonly readyForReview: boolean;
}

// ---- Workflow graph (§2.4, §6.1) ----------------------------------------------------------------
export type AuthorityLevel = "inspect" | "advise" | "modify" | "execute" | "install" | "verify" | "approve";
export interface WorkflowNode {
  readonly id: string;
  /** Capability contract id this stage requires (never an implementation). */
  readonly capability: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly authority: AuthorityLevel;
  readonly executorRole: ExecutorRole;
  /** Evidence kinds that must be closed for this node to count as done. */
  readonly acceptance: readonly EvidenceKind[];
  readonly optional?: boolean;
  /** A human review gate sits on this node. */
  readonly review?: boolean;
}
export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  /** `needs`: source must be done with its evidence closed. `after`: source must merely settle (done|failed|skipped). */
  readonly mode: "needs" | "after";
  readonly guard?: string;
  readonly evidenceRequired: readonly EvidenceKind[];
  /** Node to route to when `from` fails. */
  readonly onFailure?: string;
  readonly auto: boolean;
}
export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly outcome: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
}
export type NodeStatus = "pending" | "ready" | "running" | "blocked" | "review" | "done" | "failed" | "skipped";

// ---- Skill OS (§3, §4, §17) ---------------------------------------------------------------------
export interface CapabilityContractDef {
  readonly id: string;
  readonly category: string;
  readonly purpose: string;
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
  readonly authority: readonly AuthorityLevel[];
  readonly conflicts: readonly string[];
  readonly complements: readonly string[];
  readonly acceptance: readonly EvidenceKind[];
  /** Decision surface this capability owns as primary (conflict detection, §29.13). */
  readonly owns: readonly string[];
}
export interface ImplementationBinding {
  readonly capabilityId: string;
  readonly implementationId: string;
  readonly provider: string;
  readonly executorKind: "llm" | "deterministic";
  /** Implementation-specific setup only; must never carry journey/acceptance semantics. */
  readonly setup: Readonly<Record<string, string>>;
}
export const CAPABILITY_LIFECYCLE = ["SPECIFIED", "IMPLEMENTATION_AVAILABLE", "REVIEWED", "INSTALLED", "AUTHORITY_GRANTED", "ENABLED", "EXERCISED", "VERIFIED", "AVAILABLE"] as const;
export type CapabilityState = (typeof CAPABILITY_LIFECYCLE)[number];

// ---- Automation (§19) ---------------------------------------------------------------------------
export const AUTOMATION_STATES = ["SCHEDULED", "DISPATCHED", "RUNNING", "PRODUCED", "VERIFIED", "COMPLETE"] as const;
export type AutomationState = (typeof AUTOMATION_STATES)[number] | "FAILED";
export type ExecutionSubstrate = "local-desktop" | "local-service" | "remote-runner" | "cloud";

// ---- Steering (§15, V-004) ----------------------------------------------------------------------
export type SteerMode = "queue-next" | "steer-now";
export interface InboxMessage {
  readonly id: string;
  readonly mode: SteerMode;
  readonly text: string;
}

// ---- Events (the durable truth) -----------------------------------------------------------------
/** Event types emitted by the workbench capabilities; folded by `reducer.ts`. */
export const WORKBENCH_EVENTS = [
  "workbench.task.created",
  "workbench.task.contract.updated",
  "workbench.task.status.changed",
  "workbench.authority.elevated",
  "workbench.workflow.defined",
  "workbench.workflow.instantiated",
  "workbench.workflow.node.changed",
  "workbench.capability.registered",
  "workbench.capability.bound",
  "workbench.capability.lifecycle.advanced",
  "workbench.evidence.recorded",
  "workbench.worker.returned",
  "workbench.review.requested",
  "workbench.review.decided",
  "workbench.automation.created",
  "workbench.automation.advanced",
  "workbench.usage.recorded",
  "workbench.steer.enqueued",
  "workbench.steer.consumed",
  "workbench.protection.blocked",
  "workbench.task.activity",
  "workbench.feedback.recorded",
] as const;
export type WorkbenchEventType = (typeof WORKBENCH_EVENTS)[number];
