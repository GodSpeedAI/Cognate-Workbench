// Claude Code adapter: a bidirectional `stream-json` session over stdin/stdout.
//
// Wire shape (argv from catalog.ts): prompts and control messages are JSON lines on stdin; stdout is
// stream-json. Permission prompts arrive as `control_request` / `can_use_tool` (because of
// `--permission-prompt-tool stdio`) and are answered with a `control_response` carrying
// `{behavior:"allow", updatedInput}` or `{behavior:"deny", message}`. Stop = a `control_request`
// with subtype `interrupt`. Resume = `--resume=<session_id>` on the next turn's process.
import { BaseDriver, rec, str } from "./base.ts";
import { boundedArgs, categoryOf, contentText, clip, preview, simpleDiff, TOOL_OUTPUT_LIMIT, type HarnessDriver } from "../types.ts";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PLAN_READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "TodoWrite"]);

function permissionFor(tool: string): string {
  if (EDIT_TOOLS.has(tool)) return "workspace-write";
  if (tool === "Bash") return "shell";
  return "tool";
}

export class ClaudeDriver extends BaseDriver implements HarnessDriver {
  private sent = false;
  private sessionId = "";
  private streamedThisMessage = false;
  private readonly tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  private readonly pending = new Map<string, Record<string, unknown>>();

  begin(): void {
    this.io.write({ type: "control_request", request_id: "wb-init", request: { subtype: "initialize", hooks: null } });
  }

  private sendPrompt(): void {
    if (this.sent) return;
    this.sent = true;
    this.io.write({ type: "user", message: { role: "user", content: this.config.message }, parent_tool_use_id: null, session_id: this.sessionId });
  }

  interrupt(): void {
    this.io.write({ type: "control_request", request_id: "wb-stop", request: { subtype: "interrupt" } });
  }

  respond(requestId: string, approved: boolean): void {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    const input = rec(rec(request.request).input);
    this.io.write({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: approved ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Declined by the user" },
      },
    });
  }

  onFrame(frame: Record<string, unknown>): void {
    switch (frame.type) {
      case "control_response": {
        const response = rec(frame.response);
        if (response.request_id === "wb-init") {
          if (response.subtype === "error") this.io.fail(`Claude Code rejected initialization: ${str(response.error) || "unknown error"}`);
          else this.sendPrompt();
        }
        return;
      }
      case "system":
        if (frame.subtype === "init" && str(frame.session_id) && str(frame.session_id) !== this.sessionId) {
          this.sessionId = str(frame.session_id);
          this.io.push({ kind: "session", id: this.sessionId });
        }
        // The CLI may only announce itself once the prompt is in; do not wait forever for control_response.
        this.sendPrompt();
        return;
      case "stream_event": {
        const event = rec(frame.event);
        if (event.type === "message_start") this.streamedThisMessage = false;
        const delta = rec(event.delta);
        if (event.type === "content_block_delta" && delta.type === "text_delta" && !str(frame.parent_tool_use_id)) {
          this.streamedThisMessage = true;
          this.text(str(delta.text));
        }
        return;
      }
      case "assistant": {
        const message = rec(frame.message);
        const content = Array.isArray(message.content) ? message.content : [];
        const sub = Boolean(str(frame.parent_tool_use_id));
        for (const raw of content) {
          const block = rec(raw);
          if (block.type === "text" && !this.streamedThisMessage && !sub) this.text(str(block.text));
          if (block.type === "tool_use") {
            const id = str(block.id);
            if (!id || this.tools.has(id)) continue;
            const name = str(block.name) || "tool";
            const input = rec(block.input);
            this.tools.set(id, { name, input });
            this.markBoundary();
            this.io.push({ kind: "tool.started", id, name, args: boundedArgs(input), ...(categoryOf(name) ? { category: categoryOf(name)! } : {}) });
          }
        }
        this.streamedThisMessage = false;
        return;
      }
      case "user": {
        const message = rec(frame.message);
        const content = Array.isArray(message.content) ? message.content : [];
        for (const raw of content) {
          const block = rec(raw);
          if (block.type !== "tool_result") continue;
          const id = str(block.tool_use_id);
          const known = this.tools.get(id);
          const name = known?.name ?? "tool";
          const text = clip(contentText(block.content), TOOL_OUTPUT_LIMIT);
          if (block.is_error === true) this.io.push({ kind: "tool.failed", id, name, error: text || "tool failed" });
          else {
            const input = known?.input ?? {};
            const diff = EDIT_TOOLS.has(name) ? this.diffFor(name, input) : undefined;
            this.io.push({ kind: "tool.completed", id, name, result: text, ...(diff ? { diff } : {}) });
          }
        }
        return;
      }
      case "control_request": {
        const request = rec(frame.request);
        const id = str(frame.request_id);
        if (request.subtype !== "can_use_tool") {
          this.io.write({ type: "control_response", response: { subtype: "error", request_id: id, error: "Control request unsupported" } });
          return;
        }
        const tool = str(request.tool_name) || "tool";
        const input = rec(request.input);
        if (tool === "AskUserQuestion") {
          this.io.write({ type: "control_response", response: { subtype: "success", request_id: id, response: { behavior: "deny", message: "Ask the user in your response; this UI supports free-text replies." } } });
          return;
        }
        if (this.config.mode === "plan" && PLAN_READ_ONLY.has(tool)) {
          this.io.write({ type: "control_response", response: { subtype: "success", request_id: id, response: { behavior: "allow", updatedInput: input } } });
          return;
        }
        this.pending.set(id, frame);
        const toolCallId = str(request.tool_use_id) || id;
        this.io.push({
          kind: "approval",
          requestId: id,
          toolCallId,
          tool,
          args: boundedArgs(input),
          permission: permissionFor(tool),
          justification: str(request.description) || str(request.decision_reason) || "",
          ...(categoryOf(tool) ? { category: categoryOf(tool)! } : {}),
        });
        return;
      }
      case "control_cancel_request": {
        const id = str(frame.request_id);
        if (this.pending.delete(id)) this.io.push({ kind: "status", text: "A permission request was withdrawn by the CLI." });
        return;
      }
      case "result": {
        const usage = rec(frame.usage);
        const input = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
        const output = Number(usage.output_tokens ?? 0);
        if (input > 0 || output > 0) this.io.push({ kind: "usage", inputTokens: input, outputTokens: output });
        if (str(frame.session_id) && str(frame.session_id) !== this.sessionId) {
          this.sessionId = str(frame.session_id);
          this.io.push({ kind: "session", id: this.sessionId });
        }
        if (frame.is_error === true || str(frame.subtype).startsWith("error")) {
          this.io.fail(str(frame.result) || preview(frame.errors) || "Claude Code reported an error");
        } else {
          // The result text is a complete snapshot; use it only if nothing streamed.
          if (str(frame.result) && !this.anyText) this.text(str(frame.result));
          this.io.finish("end_turn");
        }
        return;
      }
      default:
    }
  }

  private diffFor(name: string, input: Record<string, unknown>): string | undefined {
    const path = str(input.file_path) || str(input.notebook_path);
    if (!path) return undefined;
    if (name === "Write") return simpleDiff(path, "", str(input.content));
    if (name === "Edit") return simpleDiff(path, str(input.old_string), str(input.new_string));
    if (name === "MultiEdit" && Array.isArray(input.edits)) {
      return clip(input.edits.map((e) => simpleDiff(path, str(rec(e).old_string), str(rec(e).new_string))).join("\n"), TOOL_OUTPUT_LIMIT);
    }
    return undefined;
  }
}
