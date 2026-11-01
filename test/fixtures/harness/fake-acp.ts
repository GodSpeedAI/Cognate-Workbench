import { hang, lines, logArgv, out, version } from "./common.ts";
if (version("acp-cli")) process.exit(0);
logArgv();
let prompt = "";
let promptId: number | undefined;
let pending: ((optionKind: string) => void) | undefined;
const SESSION = "fake-acp-session-1";
const update = (u: Record<string, unknown>) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: SESSION, update: u } });

async function turn(): Promise<void> {
  if (/crash/.test(prompt)) { console.error("acp exploded"); process.exit(3); }
  if (/authfail/.test(prompt)) { out({ jsonrpc: "2.0", id: promptId, error: { code: -32000, message: "auth required" } }); return; }
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Looking " } });
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "at it. " } });
  if (/hang/.test(prompt)) { hang(); return; }
  if (/ask|edit/.test(prompt)) {
    update({ sessionUpdate: "tool_call", toolCallId: "tc1", title: "Editing hello.txt", kind: "edit", status: "pending", rawInput: { path: "hello.txt" } });
    let ok = true;
    if (/ask/.test(prompt)) {
      out({ jsonrpc: "2.0", id: "perm-1", method: "session/request_permission", params: { sessionId: SESSION, toolCall: { toolCallId: "tc1", title: "Editing hello.txt", kind: "edit", rawInput: { path: "hello.txt" } }, options: [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } });
      ok = (await new Promise<string>((r) => { pending = r; })) === "allow_once";
    }
    update({ sessionUpdate: "tool_call_update", toolCallId: "tc1", status: ok ? "completed" : "failed", content: ok ? [{ type: "diff", path: "hello.txt", oldText: "hello", newText: "world" }] : [{ type: "content", content: { type: "text", text: "rejected" } }] });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: ok ? "Done." : "Understood, not editing." } });
  }
  out({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
}

lines((f) => {
  if (f.method === "initialize") out({ jsonrpc: "2.0", id: f.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  else if (f.method === "session/new" || f.method === "session/load") out({ jsonrpc: "2.0", id: f.id, result: { sessionId: SESSION } });
  else if (f.method === "session/set_model") out({ jsonrpc: "2.0", id: f.id, result: {} });
  else if (f.method === "session/prompt") { prompt = String(f.params?.prompt?.[0]?.text ?? ""); promptId = f.id; void turn(); }
  else if (f.method === "session/cancel") {
    if (/stubborn/.test(prompt)) return;
    out({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } });
    process.exit(0);
  } else if (f.id === "perm-1" && f.result) {
    const picked = f.result.outcome?.optionId;
    pending?.(picked === "yes" ? "allow_once" : "reject_once");
  }
});
