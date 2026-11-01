import { hang, lines, logArgv, out, version } from "./common.ts";
if (version("claude")) process.exit(0);
logArgv();
const SESSION = "fake-claude-session-1";
let prompt = "";
let pending: ((allowed: boolean) => void) | undefined;

function text(t: string): void {
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } });
}

async function turn(): Promise<void> {
  out({ type: "system", subtype: "init", session_id: SESSION });
  if (/crash/.test(prompt)) { console.error("boom: segfault"); process.exit(3); }
  if (/authfail/.test(prompt)) { out({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", session_id: SESSION }); return; }
  if (/limit/.test(prompt)) { out({ type: "result", subtype: "error", is_error: true, result: "Claude usage limit reached", session_id: SESSION }); return; }
  out({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } });
  text("Looking ");
  text("at it. ");
  if (/hang/.test(prompt)) { hang(); return; }
  if (/ask|edit/.test(prompt)) {
    const input = { file_path: "hello.txt", old_string: "hello", new_string: "world" };
    out({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Looking at it. " }, { type: "tool_use", id: "tu1", name: "Edit", input }] } });
    let allowed = true;
    if (/ask/.test(prompt)) {
      out({ type: "control_request", request_id: "perm-1", request: { subtype: "can_use_tool", tool_name: "Edit", input, tool_use_id: "tu1" } });
      allowed = await new Promise<boolean>((r) => { pending = r; });
    }
    if (allowed) out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "File updated" }] } });
    else out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "Declined by the user" }] } });
    out({ type: "stream_event", event: { type: "message_start", message: { id: "m2" } } });
    text(allowed ? "Done." : "Understood, not editing.");
  }
  out({ type: "result", subtype: "success", is_error: false, result: "", session_id: SESSION, usage: { input_tokens: 11, output_tokens: 7 } });
}

lines((f) => {
  if (f.type === "control_request" && f.request?.subtype === "initialize") {
    out({ type: "control_response", response: { subtype: "success", request_id: f.request_id, response: {} } });
  } else if (f.type === "control_request" && f.request?.subtype === "interrupt") {
    if (/stubborn/.test(prompt)) return;
    out({ type: "result", subtype: "error_during_execution", is_error: false, result: "", session_id: SESSION });
    process.exit(0);
  } else if (f.type === "user") {
    prompt = String(f.message?.content ?? "");
    void turn();
  } else if (f.type === "control_response") {
    pending?.(f.response?.response?.behavior === "allow");
  }
});
