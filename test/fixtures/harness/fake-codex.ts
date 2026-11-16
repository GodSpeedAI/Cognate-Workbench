import { hang, lines, logArgv, out, version } from "./common.ts";
if (version("codex")) process.exit(0);
logArgv();
let prompt = "";
let pending: ((accepted: boolean) => void) | undefined;
const THREAD = "fake-codex-thread-1";

async function turn(): Promise<void> {
  out({ method: "turn/started", params: { threadId: THREAD, turn: { id: "turn-1" } } });
  if (/crash/.test(prompt)) { console.error("codex exploded"); process.exit(3); }
  if (/authfail/.test(prompt)) { out({ method: "error", params: { threadId: THREAD, willRetry: false, error: { message: "Not logged in. Run codex login" } } }); return; }
  if (/limit/.test(prompt)) { out({ method: "error", params: { threadId: THREAD, willRetry: false, error: { message: "You've hit your usage limit" } } }); return; }
  out({ method: "item/agentMessage/delta", params: { threadId: THREAD, itemId: "msg1", delta: "Looking " } });
  out({ method: "item/agentMessage/delta", params: { threadId: THREAD, itemId: "msg1", delta: "at it. " } });
  if (/hang/.test(prompt)) { hang(); return; }
  if (/ask|edit/.test(prompt)) {
    out({ method: "item/started", params: { threadId: THREAD, item: { type: "fileChange", id: "fc1", status: "inProgress", changes: [{ path: "hello.txt", kind: { type: "update" }, diff: "" }] } } });
    let ok = true;
    if (/ask/.test(prompt)) {
      out({ id: 77, method: "item/fileChange/requestApproval", params: { threadId: THREAD, itemId: "fc1", reason: "edit hello.txt" } });
      ok = await new Promise<boolean>((r) => { pending = r; });
    }
    out({ method: "item/completed", params: { threadId: THREAD, item: { type: "fileChange", id: "fc1", status: ok ? "completed" : "declined", changes: [{ path: "hello.txt", kind: { type: "update" }, diff: "- hello\n+ world" }] } } });
    out({ method: "item/agentMessage/delta", params: { threadId: THREAD, itemId: "msg2", delta: ok ? "Done." : "Understood, not editing." } });
  }
  out({ method: "thread/tokenUsage/updated", params: { threadId: THREAD, tokenUsage: { last: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } } } });
  out({ method: "turn/completed", params: { threadId: THREAD, turn: { id: "turn-1", status: "completed" } } });
}

lines((f) => {
  if (f.method === "initialize") out({ id: f.id, result: {} });
  else if (f.method === "thread/start" || f.method === "thread/resume") out({ id: f.id, result: { thread: { id: f.params?.threadId ?? THREAD } } });
  else if (f.method === "turn/start") {
    prompt = String(f.params?.input?.[0]?.text ?? "");
    out({ id: f.id, result: { turn: { id: "turn-1" } } });
    void turn();
  } else if (f.method === "turn/interrupt") {
    if (/stubborn/.test(prompt)) return;
    out({ method: "turn/completed", params: { threadId: THREAD, turn: { id: "turn-1", status: "interrupted" } } });
    process.exit(0);
  } else if (f.id === 77 && f.result) pending?.(f.result.decision === "accept");
});
