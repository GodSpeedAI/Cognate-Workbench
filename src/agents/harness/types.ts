// Shared shapes for harness adapters. A driver speaks one CLI protocol and reduces it to the
// normalized `HarnessEvent`s below; `agentHarness.ts` maps those onto the SAME domain events the
// native coding agent emits (tool.call.*, message.completed, workbench.usage.recorded, ...).
import type { HarnessCatalogEntry, HarnessPermissionMode } from "./catalog.ts";

/** The native tool families the transcript already knows how to label and render. */
export type ToolCategory = "read" | "edit" | "bash";

export function categoryOf(name: string, kind?: string): ToolCategory | undefined {
  if (kind === "read") return "read";
  if (kind === "edit" || kind === "delete" || kind === "move") return "edit";
  if (kind === "execute") return "bash";
  const n = name.toLowerCase();
  if (n === "read") return "read";
  if (["edit", "write", "multiedit", "notebookedit", "update files"].includes(n)) return "edit";
  if (n === "bash" || n === "command") return "bash";
  return undefined;
}

export type HarnessEvent =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool.started"; readonly id: string; readonly name: string; readonly args: Record<string, unknown>; readonly category?: ToolCategory }
  | { readonly kind: "tool.completed"; readonly id: string; readonly name: string; readonly result: string; readonly diff?: string }
  | { readonly kind: "tool.failed"; readonly id: string; readonly name: string; readonly error: string }
  | { readonly kind: "approval"; readonly requestId: string; readonly toolCallId: string; readonly tool: string; readonly args: Record<string, unknown>; readonly permission: string; readonly justification: string; readonly category?: ToolCategory }
  | { readonly kind: "usage"; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly kind: "status"; readonly text: string };

export interface TurnConfig {
  readonly entry: HarnessCatalogEntry;
  readonly cwd: string;
  readonly message: string;
  readonly mode: HarnessPermissionMode;
  readonly model?: string;
  readonly resumeId?: string;
  readonly instructions?: string;
}

/** What a driver may do to the outside world. */
export interface DriverIo {
  write(frame: unknown): void;
  push(event: HarnessEvent): void;
  /** The turn ended normally. */
  finish(stopReason: string): void;
  /** The turn failed; `message` is operator-readable. */
  fail(message: string): void;
}

export interface HarnessDriver {
  /** Send the opening frames. */
  begin(): void;
  onFrame(frame: Record<string, unknown>): void;
  /** Answer a pending permission request (`requestId` is the id from the `approval` event). */
  respond(requestId: string, approved: boolean): void;
  /** Ask the CLI to stop its current turn through its protocol. */
  interrupt(): void;
}

export const TOOL_INPUT_LIMIT = 4096;
export const TOOL_OUTPUT_LIMIT = 8192;

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

export function preview(value: unknown, limit = TOOL_INPUT_LIMIT): string {
  if (typeof value === "string") return clip(value, limit);
  try { return clip(JSON.stringify(value) ?? "", limit); } catch { return ""; }
}

/** Reduces tool arguments to JSON-safe, size-bounded values for events. */
export function boundedArgs(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input === undefined ? {} : { value: preview(input) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? clip(v, 2000) : typeof v === "number" || typeof v === "boolean" || v === null ? v : preview(v, 1000);
  }
  return out;
}

/** A readable unified-style diff for an old/new string pair (single hunk, bounded). */
export function simpleDiff(path: string, oldText: string, newText: string): string {
  const minus = oldText ? oldText.split("\n").map((l) => `-${l}`) : [];
  const plus = newText ? newText.split("\n").map((l) => `+${l}`) : [];
  return clip([`--- ${path}`, `+++ ${path}`, "@@", ...minus, ...plus].join("\n"), TOOL_OUTPUT_LIMIT);
}

/** Stringifies assorted CLI content shapes (string | [{type:text,text}] | {content}) for a tool result. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (p.content !== undefined) return contentText(p.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (c.content !== undefined) return contentText(c.content);
  }
  return "";
}
