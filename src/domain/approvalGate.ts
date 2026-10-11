// `approvalGate`: a pure app function named after `.sea/interaction/interaction-model.sea`'s
// `Entity "ApprovalGate"` — the semantic anchor for journey `j_d_approval`
// ("A tool call requests an operation outside its default sandbox/authority"). It decides, from
// (tool name, tool args, permission mode), whether a call needs human approval before it runs.
//
// Evidence for the trigger rule (`reference-behavior-matrix.md` + fixtures/mock-model/server.ts
// comment above the `approval` scenario, `.tmp` reference not copied — only the shape observed):
// sandbox escalation lives on `run_code`, not `bash` — the reference's `bash` tool schema has no
// `sandbox_permissions`/`justification` fields, only `run_code` (dsh-tools `ptc.ts`) does, and it is
// what triggers the approval "ask" waterfall. So: approval is required exactly when the tool is
// `run_code` and it carries a `sandbox_permissions` string (a request to escalate beyond the
// session's default sandbox) — `read`/`edit`/`bash` never require approval in this tranche.
export interface ApprovalDecisionRequest {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** The session's current access mode, e.g. "read-only" / "workspace-write" / "full-access" (any
   *  case/spacing — normalized below). Defaults to `"read-only"`, the conservative default that
   *  matches the reference's observed approval-scenario mode
   *  (`reference/observations/aria/12-approval-resolved-allow`: `button "Access mode, current: Read
   *  Only"`) — the app's composer access-mode dropdown is inert/display-only this tranche
   *  (`DEVIATIONS.md`), so this default is not wired to it yet. */
  readonly mode?: string;
}

export interface ApprovalGateDecision {
  readonly required: boolean;
  /** The escalated permission being requested, e.g. "workspace-write". Present iff `required`. */
  readonly permission?: string;
  /** The tool's own stated reason for the escalation. Present iff `required`. */
  readonly justification?: string;
}

/** Ordered from least to most privileged. An unrecognized permission or mode ranks above every
 *  known one — fail-closed (journey `j_d_approval`: "fail-closed by default"). */
const PERMISSION_RANK: Record<string, number> = { "read-only": 0, "workspace-write": 1, "full-access": 2 };

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function rank(value: string): number {
  return PERMISSION_RANK[normalize(value)] ?? Number.POSITIVE_INFINITY;
}

/**
 * Required exactly when `tool` is `run_code` and it carries a `sandbox_permissions` string ranked
 * *above* the session's current access `mode` — i.e. an actual escalation request, not merely the
 * presence of the field. `bash`/`read`/`edit` never carry `sandbox_permissions` in the reference's
 * tool schemas (fixtures/mock-model/server.ts comment above the `approval` scenario) and so never
 * reach this gate.
 */
export function approvalGate(request: ApprovalDecisionRequest): ApprovalGateDecision {
  if (request.tool !== "run_code") return { required: false };
  const permission = request.args.sandbox_permissions;
  if (typeof permission !== "string" || permission.length === 0) return { required: false };
  const mode = request.mode ?? "read-only";
  if (rank(permission) <= rank(mode)) return { required: false };
  const justification = typeof request.args.justification === "string" ? request.args.justification : "";
  return { required: true, permission, justification };
}

/** The exact denial text the reference feeds back to the model as the tool result on Reject
 *  (`reference/observations/aria/12-approval-resolved-deny.desktop.txt`: `paragraph: "Tool result:
 *  Error: the user rejected escalating this program to \"workspace-write\"; it stays denied, so
 *  stop and explain instead of working around it"`). */
export function approvalDeniedToolResult(permission: string): string {
  return `Error: the user rejected escalating this program to "${permission}"; it stays denied, so stop and explain instead of working around it`;
}
