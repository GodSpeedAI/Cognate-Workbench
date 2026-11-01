// Codex adapter: `codex app-server`, JSON-RPC over stdio.
//
// Flow: initialize(1) -> initialized -> thread/start|thread/resume(2) -> turn/start(3), then item
// notifications until `turn/completed`. Permission requests are server->client requests
// (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
// `item/permissions/requestApproval`) answered with `{decision:"accept"|"decline"}` (or a
// `{permissions, scope}` grant). Stop = `turn/interrupt`. Resume = `thread/resume` with the stored
// thread id. The sandbox/approval policy is applied on every thread start/resume AND every turn, so
// an earlier wider setting cannot persist.
import { BaseDriver, rec, str } from "./base.ts";
import { boundedArgs, clip, TOOL_OUTPUT_LIMIT, type HarnessDriver } from "../types.ts";
import type { HarnessPermissionMode } from "../catalog.ts";

const APPROVAL_METHODS = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]);

function policy(mode: HarnessPermissionMode): { sandbox: string; approvalPolicy: string; reviewer: string } {
  if (mode === "auto") return { sandbox: "workspace-write", approvalPolicy: "on-request", reviewer: "auto_review" };
  if (mode === "plan") return { sandbox: "read-only", approvalPolicy: "never", reviewer: "user" };
  if (mode === "full") return { sandbox: "danger-full-access", approvalPolicy: "never", reviewer: "user" };
  return { sandbox: "workspace-write", approvalPolicy: "on-request", reviewer: "user" };
}

export class CodexDriver extends BaseDriver implements HarnessDriver {
  private threadId = this.config.resumeId ?? "";
  private turnId = "";
  private readonly deltaSeen = new Set<string>();
  private readonly tools = new Map<string, string>();
  private readonly pending = new Map<string, Record<string, unknown>>();

  begin(): void {
    this.io.write({ id: 1, method: "initialize", params: { clientInfo: { name: "cognate-workbench", title: "Cognate Workbench", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
  }

  interrupt(): void {
    if (this.threadId && this.turnId) this.io.write({ id: 900, method: "turn/interrupt", params: { threadId: this.threadId, turnId: this.turnId } });
  }

  respond(requestId: string, approved: boolean): void {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    const params = rec(request.params);
    const result = request.method === "item/permissions/requestApproval"
      ? { permissions: approved ? params.permissions : {}, scope: "turn" }
      : { decision: approved ? "accept" : "decline" };
    this.io.write({ id: request.id, result });
  }

  private startThread(): void {
    const p = policy(this.config.mode);
    const params: Record<string, unknown> = { approvalPolicy: p.approvalPolicy, approvalsReviewer: p.reviewer, sandbox: p.sandbox, cwd: this.config.cwd };
    if (this.config.model && this.config.model !== "default") params.model = this.config.model;
    if (this.threadId) {
      params.threadId = this.threadId;
      params.excludeTurns = true;
      this.io.write({ id: 2, method: "thread/resume", params });
    } else {
      this.io.write({ id: 2, method: "thread/start", params });
    }
  }

  private startTurn(): void {
    const p = policy(this.config.mode);
    const sandboxPolicy = p.sandbox === "danger-full-access" ? { type: "dangerFullAccess" }
      : p.sandbox === "read-only" ? { type: "readOnly", networkAccess: false }
      : { type: "workspaceWrite", writableRoots: [this.config.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    this.io.write({
      id: 3,
      method: "turn/start",
      params: { threadId: this.threadId, input: [{ type: "text", text: this.config.message }], approvalPolicy: p.approvalPolicy, approvalsReviewer: p.reviewer, sandboxPolicy },
    });
  }

  onFrame(frame: Record<string, unknown>): void {
    const method = str(frame.method);
    const params = rec(frame.params);
    if (!method && frame.error) {
      this.io.fail(str(rec(frame.error).message) || "Codex request failed");
      return;
    }
    if (!method && frame.id !== undefined && frame.result !== undefined) {
      const result = rec(frame.result);
      if (frame.id === 1) {
        this.io.write({ method: "initialized", params: {} });
        this.startThread();
      } else if (frame.id === 2) {
        const id = str(rec(result.thread).id);
        if (!id) { this.io.fail("Codex did not return a thread id"); return; }
        this.threadId = id;
        this.io.push({ kind: "session", id });
        this.startTurn();
      } else if (frame.id === 3) {
        const turn = str(rec(result.turn).id);
        if (turn) this.turnId = turn;
      }
      return;
    }
    if (!method) return;
    // Approval requests: honoured from any thread so a child thread cannot hang the connection.
    if (frame.id !== undefined && APPROVAL_METHODS.has(method)) {
      const requestId = String(frame.id);
      this.pending.set(requestId, frame);
      const command = str(params.command);
      const isEdit = method === "item/fileChange/requestApproval";
      this.io.push({
        kind: "approval",
        requestId,
        toolCallId: str(params.itemId) || requestId,
        tool: isEdit ? "Update files" : method === "item/permissions/requestApproval" ? "Permissions" : "Command",
        args: boundedArgs({ ...(command ? { command } : {}), ...(str(params.cwd) ? { cwd: str(params.cwd) } : {}), ...(str(params.reason) ? { reason: str(params.reason) } : {}) }),
        permission: isEdit ? "workspace-write" : method === "item/permissions/requestApproval" ? "permissions" : "shell",
        justification: str(params.reason),
        ...(method === "item/permissions/requestApproval" ? {} : { category: isEdit ? "edit" as const : "bash" as const }),
      });
      return;
    }
    if (frame.id !== undefined) {
      this.io.write({ id: frame.id, error: { code: -32601, message: "This client does not support this interactive request" } });
      return;
    }
    const thread = str(params.threadId);
    if (thread && this.threadId && thread !== this.threadId) return;
    switch (method) {
      case "turn/started": {
        const id = str(rec(params.turn).id);
        if (id) this.turnId = id;
        return;
      }
      case "item/agentMessage/delta":
        this.deltaSeen.add(str(params.itemId));
        this.text(str(params.delta));
        return;
      case "item/started":
      case "item/completed":
        this.item(rec(params.item), method === "item/completed");
        return;
      case "thread/tokenUsage/updated": {
        const last = rec(rec(params.tokenUsage).last);
        const input = Number(last.inputTokens ?? last.totalTokens ?? 0);
        const output = Number(last.outputTokens ?? 0);
        if (input > 0 || output > 0) this.io.push({ kind: "usage", inputTokens: input, outputTokens: output });
        return;
      }
      case "error":
        if (params.willRetry === true) this.io.push({ kind: "status", text: "Codex is retrying" });
        else this.io.fail(str(rec(params.error).message) || "Codex reported an error");
        return;
      case "turn/completed": {
        const turn = rec(params.turn);
        if (turn.status === "failed") this.io.fail(str(rec(turn.error).message) || "Codex turn failed");
        else this.io.finish(turn.status === "interrupted" ? "cancelled" : "end_turn");
        return;
      }
      default:
    }
  }

  private item(item: Record<string, unknown>, completed: boolean): void {
    const id = str(item.id);
    const type = str(item.type);
    if (type === "agentMessage") {
      if (completed && !this.deltaSeen.has(id)) this.text(str(item.text));
      return;
    }
    if (type === "reasoning" || type === "userMessage" || !id) return;
    const failed = item.status === "failed" || item.status === "declined" || (typeof item.exitCode === "number" && item.exitCode !== 0) || item.success === false || rec(item.error).message !== undefined;
    if (type === "commandExecution") {
      const name = "Command";
      if (!this.tools.has(id)) { this.tools.set(id, name); this.markBoundary(); this.io.push({ kind: "tool.started", id, name, args: boundedArgs({ command: str(item.command), cwd: str(item.cwd) }), category: "bash" }); }
      if (completed) {
        const out = clip(`${typeof item.exitCode === "number" ? `Exit code: ${item.exitCode}\n` : ""}${str(item.aggregatedOutput)}`, TOOL_OUTPUT_LIMIT);
        this.io.push(failed ? { kind: "tool.failed", id, name, error: out || "command failed" } : { kind: "tool.completed", id, name, result: out });
      }
      return;
    }
    if (type === "fileChange") {
      const name = "Update files";
      const changes = Array.isArray(item.changes) ? item.changes.map(rec) : [];
      if (!this.tools.has(id)) {
        this.tools.set(id, name);
        this.markBoundary();
        this.io.push({ kind: "tool.started", id, name, args: { file_path: str(changes[0]?.path), files: changes.slice(0, 50).map((c) => `${str(rec(c.kind).type)} ${str(c.path)}`.trim()) }, category: "edit" });
      }
      if (completed) {
        const diff = clip(changes.map((c) => `${str(c.path)}\n${str(c.diff)}`).join("\n\n"), TOOL_OUTPUT_LIMIT);
        const summary = `${changes.length} file${changes.length === 1 ? "" : "s"} changed`;
        this.io.push(failed ? { kind: "tool.failed", id, name, error: "file change failed or was declined" } : { kind: "tool.completed", id, name, result: summary, ...(diff.trim() ? { diff } : {}) });
      }
      return;
    }
    // Any other item (MCP tool call, web search, compaction, ...) is surfaced as a generic tool.
    const name = type || "tool";
    if (!this.tools.has(id)) { this.tools.set(id, name); this.markBoundary(); this.io.push({ kind: "tool.started", id, name, args: boundedArgs(item.arguments ?? item.query ?? {}) }); }
    if (completed) this.io.push(failed ? { kind: "tool.failed", id, name, error: "failed" } : { kind: "tool.completed", id, name, result: clip(JSON.stringify(item.result ?? item.output ?? "") ?? "", TOOL_OUTPUT_LIMIT) });
  }
}
