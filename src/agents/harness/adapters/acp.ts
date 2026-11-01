// ACP (Agent Client Protocol v1) adapter: JSON-RPC over stdio, used by OpenCode, Kimi, Copilot CLI,
// Grok, Cline, Kilo, Devin, Command Code and (probe-gated) Gemini / Qwen.
//
// Flow: initialize(1) -> session/new | session/resume | session/load (2) -> [session/set_model (5)]
// -> session/prompt (3). `session/update` notifications carry text chunks and tool calls;
// `session/request_permission` is a request from the agent answered with the id of one of the
// offered options (`allow_once` / `reject_once` kinds). Stop = a `session/cancel` notification.
// ACP has no portable approval *mode*, so plan mode is enforced here by declining state-changing
// requests (read/search/fetch/think are allowed); any harness that never asks for permission is
// governed only by its own configuration, which the posture label states.
import { BaseDriver, rec, str } from "./base.ts";
import { boundedArgs, categoryOf, clip, contentText, simpleDiff, TOOL_OUTPUT_LIMIT, type HarnessDriver } from "../types.ts";

const READ_ONLY_KINDS = new Set(["read", "search", "fetch", "think"]);

function permissionFor(kind: string): string {
  if (kind === "edit" || kind === "delete" || kind === "move") return "workspace-write";
  if (kind === "execute") return "shell";
  return "tool";
}

function acpArgs(update: Record<string, unknown>): Record<string, unknown> {
  const raw = rec(update.rawInput);
  const location = Array.isArray(update.locations) ? str(rec(update.locations[0]).path) : "";
  return boundedArgs({ ...raw, ...(location && !raw.path && !raw.file_path ? { file_path: location } : {}), ...(str(update.kind) ? { kind: str(update.kind) } : {}) });
}

export class AcpDriver extends BaseDriver implements HarnessDriver {
  private sessionId = "";
  private live = false;
  private readonly tools = new Map<string, { name: string; started: boolean; done: boolean }>();
  private readonly pending = new Map<string, Record<string, unknown>>();

  begin(): void {
    this.io.write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "cognate-workbench", version: "1" } } });
  }

  interrupt(): void {
    if (this.sessionId) this.io.write({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
  }

  respond(requestId: string, approved: boolean): void {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    const options = Array.isArray(rec(request.params).options) ? (rec(request.params).options as unknown[]).map(rec) : [];
    const wanted = approved ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const picked = wanted.map((kind) => options.find((o) => o.kind === kind)).find(Boolean);
    this.io.write({ jsonrpc: "2.0", id: request.id, result: { outcome: picked ? { outcome: "selected", optionId: picked.optionId } : { outcome: "cancelled" } } });
  }

  private prompt(): void {
    this.live = true;
    this.io.write({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: this.sessionId, prompt: [{ type: "text", text: this.config.message }] } });
  }

  onFrame(frame: Record<string, unknown>): void {
    const method = str(frame.method);
    if (!method && frame.error) {
      const error = rec(frame.error);
      const detail = str(error.message) || "request failed";
      if (error.code === -32000) this.io.fail(`${this.config.entry.label} requires authentication (${detail})`);
      else this.io.fail(`${this.config.entry.label}: ACP ${({ 1: "initialize", 2: "session setup", 3: "prompt", 5: "model selection" } as Record<number, string>)[Number(frame.id)] ?? "request"} failed: ${detail}`);
      return;
    }
    if (!method && frame.id !== undefined && frame.result !== undefined) {
      this.onResult(Number(frame.id), rec(frame.result));
      return;
    }
    if (!method) return;
    if (method === "session/request_permission" && frame.id !== undefined) {
      this.permission(frame);
      return;
    }
    if (method === "session/update") {
      const params = rec(frame.params);
      if (str(params.sessionId) && this.sessionId && str(params.sessionId) !== this.sessionId) return;
      if (this.live) this.update(rec(params.update));
      return;
    }
    if (frame.id !== undefined) this.io.write({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "Client capability not supported" } });
  }

  private onResult(id: number, result: Record<string, unknown>): void {
    if (id === 1) {
      if (result.protocolVersion !== 1) { this.io.fail(`${this.config.entry.label} does not support ACP protocol v1.`); return; }
      const caps = rec(result.agentCapabilities);
      const params: Record<string, unknown> = { cwd: this.config.cwd, mcpServers: [] };
      let method = "session/new";
      if (this.config.resumeId) {
        params.sessionId = this.config.resumeId;
        if (rec(caps.sessionCapabilities).resume !== undefined) method = "session/resume";
        else if (caps.loadSession === true) method = "session/load";
        else { this.io.fail(`${this.config.entry.label} cannot resume saved sessions. Start a new session.`); return; }
        this.sessionId = this.config.resumeId;
      }
      this.io.write({ jsonrpc: "2.0", id: 2, method, params });
    } else if (id === 2) {
      const returned = str(result.sessionId);
      if (returned && returned.length <= 256) this.sessionId = returned;
      if (!this.sessionId) { this.io.fail("ACP did not return a session id"); return; }
      this.io.push({ kind: "session", id: this.sessionId });
      const model = this.config.model;
      if (model && model !== "default" && this.config.entry.modelMechanism === "protocol") {
        this.io.write({ jsonrpc: "2.0", id: 5, method: "session/set_model", params: { sessionId: this.sessionId, modelId: model } });
      } else this.prompt();
    } else if (id === 5) {
      this.prompt();
    } else if (id === 3) {
      const stop = str(result.stopReason) || "end_turn";
      this.io.finish(stop === "cancelled" ? "cancelled" : stop);
    }
  }

  private permission(frame: Record<string, unknown>): void {
    const params = rec(frame.params);
    const reply = (kind: string): void => {
      const options = Array.isArray(params.options) ? (params.options as unknown[]).map(rec) : [];
      const picked = options.find((o) => o.kind === kind);
      this.io.write({ jsonrpc: "2.0", id: frame.id, result: { outcome: picked ? { outcome: "selected", optionId: picked.optionId } : { outcome: "cancelled" } } });
    };
    if (str(params.sessionId) && str(params.sessionId) !== this.sessionId) {
      this.io.write({ jsonrpc: "2.0", id: frame.id, result: { outcome: { outcome: "cancelled" } } });
      return;
    }
    const options = Array.isArray(params.options) ? (params.options as unknown[]).map(rec) : [];
    const isQuestion = options.filter((o) => o.kind === "allow_once").length > 1 || options.some((o) => /^q\d+_opt_/.test(str(o.optionId)));
    if (isQuestion) {
      this.io.push({ kind: "status", text: "The agent asked a structured question. Answer in chat when the turn finishes." });
      this.io.write({ jsonrpc: "2.0", id: frame.id, result: { outcome: { outcome: "cancelled" } } });
      return;
    }
    const call = rec(params.toolCall);
    const kind = str(call.kind);
    const title = str(call.title) || kind || "tool";
    if (this.config.mode === "plan") {
      if (READ_ONLY_KINDS.has(kind)) { reply("allow_once"); return; }
      this.io.push({ kind: "status", text: `Plan mode declined: ${title}` });
      reply("reject_once");
      return;
    }
    const requestId = String(frame.id);
    this.pending.set(requestId, frame);
    this.io.push({
      kind: "approval",
      requestId,
      toolCallId: str(call.toolCallId) || requestId,
      tool: title,
      args: boundedArgs(call.rawInput ?? {}),
      permission: permissionFor(kind),
      justification: "",
      ...(categoryOf(title, kind) ? { category: categoryOf(title, kind)! } : {}),
    });
  }

  private update(update: Record<string, unknown>): void {
    const type = str(update.sessionUpdate);
    if (type === "agent_message_chunk") {
      const content = rec(update.content);
      if (content.type === "text" || content.type === undefined) this.text(str(content.text));
      return;
    }
    if (type !== "tool_call" && type !== "tool_call_update") return;
    const id = str(update.toolCallId);
    if (!id) return;
    const known = this.tools.get(id) ?? { name: str(update.title) || str(update.kind) || "tool", started: false, done: false };
    if (str(update.title) && !known.started) known.name = str(update.title);
    this.tools.set(id, known);
    if (!known.started) {
      known.started = true;
      this.markBoundary();
      this.io.push({ kind: "tool.started", id, name: known.name, args: acpArgs(update), ...(categoryOf(known.name, str(update.kind)) ? { category: categoryOf(known.name, str(update.kind))! } : {}) });
    }
    const status = str(update.status);
    if (known.done || (status !== "completed" && status !== "failed")) return;
    known.done = true;
    const items = Array.isArray(update.content) ? (update.content as unknown[]).map(rec) : [];
    const diffs = items.filter((c) => c.type === "diff").map((c) => simpleDiff(str(c.path), str(c.oldText), str(c.newText)));
    const text = clip(items.filter((c) => c.type !== "diff").map((c) => contentText(c.content ?? c)).filter(Boolean).join("\n") || (diffs.length ? `${diffs.length} file change${diffs.length === 1 ? "" : "s"}` : ""), TOOL_OUTPUT_LIMIT);
    if (status === "failed") this.io.push({ kind: "tool.failed", id, name: known.name, error: text || "tool failed" });
    else this.io.push({ kind: "tool.completed", id, name: known.name, result: text, ...(diffs.length ? { diff: clip(diffs.join("\n"), TOOL_OUTPUT_LIMIT) } : {}) });
  }
}
