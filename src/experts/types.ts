// Native Expert identities outlive Cognate runs. Canonical state is a versioned Cognate thread,
// written through typed commands and reconstructed from state.changed events.
import type { ModelConfig } from "../components/providerRegistry.ts";
import type { ModelMessage } from "@godspeedai/cognate-capabilities";
import type { CaseContext } from "@godspeedai/cognate-runtime-api";
import type { ExpertModelBudget } from "./economics.ts";

export const EXPERTS_THREAD = "experts:registry";
export const EXPERT_AGENT = "agent.expert";
export const EXPERT_TOOLS = ["read", "edit", "bash", "run_code", "team_delegate", "team_message", "expert_memory_read", "expert_memory_write", "expert_return"] as const;
export type ExpertTool = typeof EXPERT_TOOLS[number];
export type AssignmentStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "reconciliation-required";
export interface ExpertDefinition {
  id: string;
  specialization: string;
  instructions: string;
  route: ModelConfig | null;
  tools: ExpertTool[];
  contextBudget: number;
  maxSteps: number;
  budget?: ExpertModelBudget;
}
export interface Expert { id: string; name: string; definition: ExpertDefinition; lifecycle: "active" | "archived" }
export interface TeamMembership { expertId: string; role: "orchestrator" | "specialist"; tools: ExpertTool[] }
export interface Team {
  id: string; name: string; lifecycle: "draft" | "active" | "inactive";
  members: TeamMembership[]; tools: ExpertTool[];
  limits: {
    maxDepth: number; maxAssignments: number; maxUnread: number; maxRounds: number;
    /** T2 admission policy: at most N of this Team's runs may be admitted concurrently. */
    maxConcurrentRuns: number;
    /** T2 batching policy: at most N queued runs of this Team are dispatched per dispatch pass. */
    admissionBatch: number;
  };
}
export interface Conversation {
  id: string; scope: "solo" | "team" | "private-team"; expertId: string | null; teamId: string | null;
  workspaceId: string; title: string; messageIds: string[]; assignmentIds: string[];
  createdAt?: string; updatedAt?: string;
}
export interface ExpertMessage {
  id: string; conversationId: string; assignmentId: string | null;
  sender: { kind: "human" | "expert"; id: string }; recipientId: string;
  text: string; correlationId: string; causationId: string | null;
  delivery: "queued" | "delivered" | "cancelled"; replyTo: string | null;
  /** Monotonic within the conversation; older snapshots may omit inbox metadata. */
  sequence?: number; targetAssignmentId?: string | null; targetRunId?: string | null;
  inboxStatus?: "queued" | "pending" | "incorporated" | "late" | "cancelled" | "superseded";
  incorporatedAtBoundary?: string | null; terminalAtBoundary?: string | null; supersedesId?: string | null;
  visibility?: "team" | "addressed";
}
export interface Handoff {
  assignmentId: string; expertId: string; runId: string;
  disposition: "result" | "abstained" | "declined" | "failed";
  output: string; artifacts: string[]; evidence: string[]; uncertainties: string[];
  failures: string[]; followUp: string[];
  observedFailures?: string[];
  /** J-RLM-CHILD-RUN: the recursive child runs this Assignment's run waited on, as observed on its run
   * stream by the completion bridge; absent for work that delegated none. */
  rlmChildren?: RlmChildOutcome[];
}
/** The terminal outcome of one recursive child run, as the parent observed it. */
export interface RlmChildOutcome {
  invocationId: string; runId: string; providerId: string;
  /** `unknown` is never success: an outcome the host cannot establish stays ambiguous in the handoff. */
  status: "completed" | "failed" | "timedOut" | "cancelled" | "unknown";
  /** True when an operator recorded the outcome after the provider's own view was unknown. */
  reconciled?: boolean;
  resultRef?: string; evidence?: string[];
}
export interface ExpertExecution {
  expertId: string; assignmentId: string; conversationId: string; teamId?: string;
  /** Only shared Team conversations opt into live messages; private Expert-in-Team remains isolated. */
  liveInbox?: boolean; liveInboxClosed?: boolean;
  instructions: string; route: ModelConfig; tools: string[]; maxSteps: number; context: ModelMessage[];
  budget?: ExpertModelBudget;
  /** J-TASK-expert-provenance: the Task this Assignment explicitly serves (stamped by the
   * validated `team.converse`/`expert.converse` command, inherited by delegated children). The
   * run freezes it into its evidence and attributes activity/usage — it grants no acceptance. */
  taskId?: string | null;
  /** J-HANDOFF-case-context: the validated CEP context this Assignment's run addresses, frozen at
   * assignment so it is stable for the run's life and forwarded into `startRun`. Absent keeps the
   * run case-free, exactly as before. */
  caseContext?: CaseContext;
  /** J-HANDOFF-case-context: the caller's attribution claim, recorded verbatim in the run's
   * evidence. It is never a refusal — the session actor remains the real attribution. */
  assertedBy?: string;
  /** J-HANDOFF-case-context: `verified` only when a real world-registry check ran; otherwise the
   * caller's context is `asserted`. Workbench runs no registry check, so it records `asserted`. */
  worldCorroboration?: "verified" | "asserted";
  /** J-RLM-CHILD-RUN: the recursive-execution provider the operator selected, frozen with the rest of the
   * snapshot (delegated children inherit it from their parent's snapshot, never from a model). Absent in
   * snapshots written before this field, which behave as no recursive execution. */
  rlm?: { providerId: string };
}
export interface Assignment {
  id: string; expertId: string; conversationId: string; teamId: string | null; parentId: string | null;
  parentAttempt?: number | null;
  purpose: string; acceptance: string[]; depth: number; attempt: number; status: AssignmentStatus;
  workspaceId: string; mode: string; authorityTools: ExpertTool[];
  /** J-TASK-expert-provenance: the Task this Assignment serves, when the operator named one —
   * inherited by delegated children; distinct from the Assignment's own run lineage. */
  taskId: string | null;
  /** Stage 6: the id of the Assignment this one reviews; null for ordinary work (and for data saved before this field). */
  reviews: string | null;
  execution: ExpertExecution; runId: string | null; handoff: Handoff | null;
  reconciled: boolean; review: { verdict: "revision" | "accept" | "escalate"; rationale: string; evidence: string[]; by: string } | null;
  effects?: Record<string,{commitmentId:string;state:string;tool:string;resolvedBy?:string}>;
  settlement: { decision: "accepted" | "revision"; by: string; rationale: string } | null;
}
export interface ExpertMemory {
  id: string; expertId: string; teamId: string | null; scope: "personal" | "team" | "private-team";
  kind: "observation" | "assertion" | "inference" | "accepted";
  text: string; sources: string[]; pinned: boolean; by: string;
}
export interface ExpertState {
  schema: 1; experts: Record<string, Expert>; teams: Record<string, Team>;
  conversations: Record<string, Conversation>; assignments: Record<string, Assignment>;
  messages: Record<string, ExpertMessage>; memory: Record<string, ExpertMemory>;
  inboxReceipts?: Record<string, { assignmentId: string; runId: string; boundary: string; messageIds: string[]; lateMessageIds?: string[] }>;
  audit?: {id:string;capability:string;by:string;actorKind:string;runId:string|null;causationId:string|null}[];
  receipts: Record<string, { fingerprint: string; result: unknown }>;
}
export const emptyExpertState = (): ExpertState => ({schema:1,experts:{},teams:{},conversations:{},assignments:{},messages:{},memory:{},receipts:{}});
export const isUnfinished = (a: Assignment) => ["queued", "running", "waiting"].includes(a.status);
