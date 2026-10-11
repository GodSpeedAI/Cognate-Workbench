// Public projection `session-trace` (usage pass U5, reference-behavior-matrix.md §13): the
// developer-tools execution trace, folded from a session's own durable run events — the trace is
// Cognate's (SQLite event log is authoritative), never a second recording path. One row per
// session (`trace/<sessionId>`): a list of turns, each with its user message, its ASSISTANT
// request rows (one per recorded `model.generate` invocation — the kernel records the full
// invocation input/result on `run.invocation`), and its TOOL rows (`tool.call.*`, with durations
// from the events' own timestamps). The UI subscribes with the same `useProjection` hook the rest
// of the app uses, so the tab is live during a run and correct after a reload with no refetch
// protocol. Subagent runs (`subagent:` correlation) are excluded — they are the child sessions'
// own traces.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export interface TraceRequest {
  readonly requestNumber: number;
  /** The `run.invocation` event's own id — the join key for the RealityTrace receipt layer (U6). */
  readonly eventId: string;
  readonly status: "completed" | "failed";
  /** The invocation's model messages (verbatim from the recorded `run.invocation` input). */
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  /** The invocation's tool catalog as sent to the provider (preset-scoped, usage pass U4). */
  readonly toolNames: readonly string[];
  readonly responseText?: string;
  readonly responseToolCalls?: readonly { readonly id: string; readonly name: string; readonly args: string }[];
  readonly failure?: string;
  readonly startedAt: string;
}

export interface TraceTool {
  readonly toolCallId: string;
  /** The `tool.call.started` event's id (U6's receipt join key; the completion event's status is a
   *  separate observation — the inspector queries both ids). */
  readonly eventId: string;
  readonly tool: string;
  readonly args: string;
  readonly status: "running" | "success" | "failed";
  readonly result?: string;
  readonly error?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface TraceTurn {
  readonly index: number;
  readonly userText: string;
  readonly startedAt: string;
  readonly requests: readonly TraceRequest[];
  readonly tools: readonly TraceTool[];
}

export interface TraceRow {
  readonly sessionId: string;
  readonly updatedAt: string;
  readonly turns: readonly TraceTurn[];
}

function sessionIdFromCorrelation(correlationId: string | null): string | undefined {
  if (!correlationId?.startsWith("session:")) return undefined;
  return correlationId.slice("session:".length);
}

function messagesOf(input: unknown): TraceRequest["messages"] {
  const messages = (input as { readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[] } | undefined)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    role: String(m.role ?? "unknown"),
    content:
      typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content)?.slice(0, 2000) ?? "",
  }));
}

function textOfContent(content: unknown): string {
  return typeof content === "string" ? content : String(content ?? "");
}

export const sessionTraceProjection: Projection = {
  name: "session-trace",
  version: "1.0.0",
  apply(event, state) {
    const sessionId = sessionIdFromCorrelation(event.correlationId);
    if (!sessionId) return [];
    const key = `${event.tenant}/trace/${sessionId}`;
    const existing = (state.get(key) as TraceRow | undefined) ?? { sessionId, updatedAt: event.recordedAt, turns: [] };

    // A new turn appends; everything else folds into the LAST turn. (Runs in one session are
    // sequential — the tool loop is single-flight — so "last turn" is the folding point.)
    const last = existing.turns[existing.turns.length - 1];
    const turns = [...existing.turns];

    if (event.eventType === "session.turn.started") {
      const payload = event.payload as { readonly message: string };
      turns.push({ index: turns.length + 1, userText: textOfContent(payload.message), startedAt: event.recordedAt, requests: [], tools: [] });
      return [{ key, value: { sessionId, updatedAt: event.recordedAt, turns } as unknown as Json }];
    }
    if (!last) return [];

    if (event.eventType === "run.invocation") {
      // The recorded `model.generate` invocations only: each is one ASSISTANT "Request #N" row.
      const payload = event.payload as { readonly input?: Json; readonly result?: Json; readonly failure?: Json };
      const input = payload.input as { readonly messages?: unknown; readonly tools?: readonly { readonly name?: string }[] } | undefined;
      if (!input || !Array.isArray(input.messages)) return [];
      const requestNumber = last.requests.length + 1;
      // The recorded ModelResponse: { message: { role, content }, toolCalls: [...], finishReason,
      // model } — toolCalls is a SIBLING of message, not nested inside it.
      const result = payload.result as { readonly message?: { readonly content?: unknown }; readonly toolCalls?: readonly { readonly id?: string; readonly name?: string; readonly arguments?: string }[]; readonly model?: string } | undefined;
      const failure = payload.failure as { readonly message?: string } | undefined;
      const request: TraceRequest = {
        requestNumber,
        eventId: event.eventId,
        status: failure ? "failed" : "completed",
        messages: messagesOf(input),
        toolNames: (input.tools ?? []).map((t) => String(t.name ?? "")).filter(Boolean),
        ...(result?.message?.content !== undefined && result.message.content !== null && result.message.content !== "" ? { responseText: textOfContent(result.message.content) } : {}),
        ...(Array.isArray(result?.toolCalls) && result!.toolCalls!.length > 0
          ? {
              responseToolCalls: result!.toolCalls!.map((c) => ({
                id: String(c.id ?? ""),
                name: String(c.name ?? ""),
                args: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}),
              })),
            }
          : {}),
        ...(failure?.message !== undefined ? { failure: failure.message } : {}),
        startedAt: event.recordedAt,
      };
      turns[turns.length - 1] = { ...last, requests: [...last.requests, request] };
      return [{ key, value: { sessionId, updatedAt: event.recordedAt, turns } as unknown as Json }];
    }

    if (event.eventType === "tool.call.started") {
      const payload = event.payload as { readonly toolCallId: string; readonly tool: string; readonly args?: Json };
      const tool: TraceTool = {
        toolCallId: payload.toolCallId,
        eventId: event.eventId,
        tool: payload.tool,
        args: JSON.stringify(payload.args ?? {}),
        status: "running",
        startedAt: event.recordedAt,
      };
      turns[turns.length - 1] = { ...last, tools: [...last.tools, tool] };
      return [{ key, value: { sessionId, updatedAt: event.recordedAt, turns } as unknown as Json }];
    }

    if (event.eventType === "tool.call.completed" || event.eventType === "tool.call.failed") {
      const payload = event.payload as { readonly toolCallId: string; readonly result?: Json; readonly error?: string };
      const tools = last.tools.map((t) =>
        t.toolCallId === payload.toolCallId
          ? {
              ...t,
              status: (event.eventType === "tool.call.completed" ? "success" : "failed") as TraceTool["status"],
              ...(event.eventType === "tool.call.completed"
                ? { result: typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result ?? {}) }
                : { error: payload.error ?? "unknown error" }),
              completedAt: event.recordedAt,
            }
          : t,
      );
      turns[turns.length - 1] = { ...last, tools };
      return [{ key, value: { sessionId, updatedAt: event.recordedAt, turns } as unknown as Json }];
    }

    return [];
  },
};
