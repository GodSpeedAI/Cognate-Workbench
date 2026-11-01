// `agent.harness`: one run per user turn, executed by an external agent-harness CLI the Session is
// bound to (`session.harness.bind`). Same input shape as `agent.coding` so a UI swaps only the agent
// id. Deterministic: every CLI interaction is the recorded capability `harness.turn.advance`
// (src/capabilities/harness.ts); on replay the recorded results are reused and no process starts.
//
// Output is mapped onto the domain events the native agent emits, so the transcript, tool timeline
// and approval bar render it unchanged:
//   text                -> run.invocation.progress {kind:"text"} (live, from the capability) and one
//                          final `message.completed`
//   tool started/done   -> tool.call.started / tool.call.completed / tool.call.failed
//   permission request  -> tool.approval.requested + a `tool-approval` human_approval continuation
//                          -> tool.approval.decided, then the decision is sent to the CLI
//   usage               -> workbench.usage.recorded (tokens; cost unknown)
//   CLI session id      -> harness.session.recorded (resume on the next turn)
//   error / limit / exit-> turn.failed {code, message} and a failed run
//
// NOT provided for an external CLI (stated, not hidden): per-tool `authority.check`, containment of
// the CLI's tool effects, protected-evidence blocking, and settlement as `agent.coding`.
import type { Json } from "@godspeedai/cognate-events";
import { InvocationFailedError, type AgentDefinition, type RunContext } from "@godspeedai/cognate-runtime-api";
import type { AdvanceResult } from "./harness/sessions.ts";
import type { HarnessEvent, ToolCategory } from "./harness/types.ts";
import type { HarnessResolved } from "../capabilities/harness.ts";

export const AGENT_HARNESS = "agent.harness";
const MAX_ADVANCES = 5000;

export interface AgentHarnessInput {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly message: string;
}

/** Native-looking args so the existing tool labels (`Reading files · path`) work. */
function nativeArgs(category: ToolCategory | undefined, args: Record<string, unknown>, harnessTool: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args, harnessTool };
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  if (category === "read" || category === "edit") {
    const path = s(args.file_path) || s(args.path) || s(args.notebook_path);
    if (path) out.file_path = path;
  }
  if (category === "bash" && !s(args.command)) out.command = s(args.cmd) || s(args.description) || harnessTool;
  return out;
}

function diffLines(diff: string): string[] {
  return diff.split("\n").filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("@@")).map((l) => (/^[+-]/.test(l) ? l : ` ${l}`));
}

function nativeResult(category: ToolCategory | undefined, args: Record<string, unknown>, ev: Extract<HarnessEvent, { kind: "tool.completed" }>): Json {
  const file = typeof args.file_path === "string" ? args.file_path : "";
  if (category === "edit") {
    const lines = ev.diff ? diffLines(ev.diff) : [];
    return { file_path: file, replacements: 1, diffLines: lines, additions: lines.filter((l) => l.startsWith("+")).length, deletions: lines.filter((l) => l.startsWith("-")).length, summary: ev.result } as unknown as Json;
  }
  if (category === "bash") return { command: String(args.command ?? ""), exitCode: 0, stdout: ev.result, stderr: "", timedOut: false } as unknown as Json;
  if (category === "read") return { file_path: file, content: ev.result } as unknown as Json;
  return { summary: ev.result } as unknown as Json;
}

export const agentHarnessAgent: AgentDefinition = {
  id: AGENT_HARNESS,
  version: "1.0.0",
  async run(input, ctx: RunContext) {
    const { sessionId, workspaceId, message } = input as unknown as AgentHarnessInput;
    const binding = (await ctx.invoke("session.harness.resolve", { sessionId } as unknown as Json)) as unknown as HarnessResolved;
    const fail = async (code: string, text: string): Promise<never> => {
      await ctx.emit("turn.failed", { code, message: text } as unknown as Json);
      throw new Error(text);
    };
    if (!binding.harnessId) return fail("HARNESS_NOT_BOUND", "This session is not bound to an external harness. Choose one, or send the message to the native agent.");

    await ctx.emit("session.turn.started", {
      sessionId, workspaceId, message,
      harness: { id: binding.harnessId, label: binding.label ?? binding.harnessId, permissionMode: binding.permissionMode ?? "ask", posture: binding.posture ?? "harness-bridged-approvals" },
    } as unknown as Json);

    const started = new Map<string, { category: ToolCategory | undefined; args: Record<string, unknown>; name: string }>();
    let text = "";
    const call = async (payload: Record<string, unknown>): Promise<AdvanceResult> => {
      try {
        return (await ctx.invoke("harness.turn.advance", payload as unknown as Json)) as unknown as AdvanceResult;
      } catch (error) {
        if (error instanceof InvocationFailedError) {
          const failure = (error as unknown as { failure?: { message?: string } }).failure;
          return fail("HARNESS_UNAVAILABLE", failure?.message ?? error.message);
        }
        throw error;
      }
    };

    let result = await call({ op: "start", sessionId, workspaceId, message });
    for (let n = 0; n < MAX_ADVANCES; n++) {
      const approvals: Extract<HarnessEvent, { kind: "approval" }>[] = [];
      for (const ev of result.events) {
        switch (ev.kind) {
          case "session":
            await ctx.emit("harness.session.recorded", { sessionId, harnessId: binding.harnessId, remoteSessionId: ev.id } as unknown as Json);
            break;
          case "text":
            text += ev.text;
            break;
          case "tool.started": {
            started.set(ev.id, { category: ev.category, args: nativeArgs(ev.category, ev.args, ev.name), name: ev.name });
            await ctx.emit("tool.call.started", { sessionId, toolCallId: ev.id, tool: ev.category ?? ev.name, args: started.get(ev.id)!.args } as unknown as Json);
            break;
          }
          case "tool.completed": {
            const info = started.get(ev.id);
            await ctx.emit("tool.call.completed", { sessionId, toolCallId: ev.id, tool: info?.category ?? ev.name, result: nativeResult(info?.category, info?.args ?? {}, ev) } as unknown as Json);
            break;
          }
          case "tool.failed": {
            const info = started.get(ev.id);
            await ctx.emit("tool.call.failed", { sessionId, toolCallId: ev.id, tool: info?.category ?? ev.name, error: ev.error } as unknown as Json);
            break;
          }
          case "usage":
            await ctx.emit("workbench.usage.recorded", { sessionId, record: { taskId: "", kind: "model", executor: `harness:${binding.harnessId}`, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens } } as unknown as Json);
            break;
          case "approval":
            approvals.push(ev);
            break;
          case "status":
            break;
        }
      }

      if (result.stop === "permission") {
        const responses: { requestId: string; approved: boolean }[] = [];
        for (const a of approvals) {
          if (!started.has(a.toolCallId)) {
            started.set(a.toolCallId, { category: a.category, args: nativeArgs(a.category, a.args, a.tool), name: a.tool });
            await ctx.emit("tool.call.started", { sessionId, toolCallId: a.toolCallId, tool: a.category ?? a.tool, args: started.get(a.toolCallId)!.args } as unknown as Json);
          }
          await ctx.emit("tool.approval.requested", { sessionId, toolCallId: a.toolCallId, tool: a.category ?? a.tool, permission: a.permission, justification: a.justification } as unknown as Json);
          const decision = (await ctx.waitFor(`approve:${a.requestId}`, {
            type: "tool-approval",
            condition: { kind: "human_approval" },
            payload: { tool: a.category ?? a.tool, args: started.get(a.toolCallId)!.args, permission: a.permission, justification: a.justification } as unknown as Json,
          })) as unknown as { readonly approved: boolean };
          await ctx.emit("tool.approval.decided", { sessionId, toolCallId: a.toolCallId, approved: decision.approved } as unknown as Json);
          responses.push({ requestId: a.requestId, approved: decision.approved });
        }
        result = await call({ op: "respond", sessionId, workspaceId, responses });
        continue;
      }
      if (result.stop === "yield") {
        result = await call({ op: "continue", sessionId, workspaceId });
        continue;
      }
      if (result.stop === "failed") {
        return fail(result.error?.code ?? "FAILED", result.error?.message ?? "The external CLI failed.");
      }
      // completed or cancelled: the run ends with what was streamed.
      break;
    }
    await ctx.emit("message.completed", { sessionId, workspaceId, text } as unknown as Json);
    return { text };
  },
};
