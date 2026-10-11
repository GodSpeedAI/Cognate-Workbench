// WebMCP projection of shared attention. The page exposes a *small, focus-dependent* set of
// semantic tools to a browsing agent (via `navigator.modelContext` when the browser provides it).
// Every tool is a thin call into the same server capabilities the human's clicks use
// (`ui.context`, `ui.request`, `ui.focus.publish`); none reads the DOM, and none can mutate truth:
// a mutating action is surfaced to the human as an `ask` and only the human's click executes it.
import { actionsFor, parseRef, type FocusContext, type RefKind } from "../cognitive/focus.ts";

export interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
}
export interface WebMcpHost {
  tools(): readonly WebMcpTool[];
  /** Whether the browser actually exposes a native WebMCP registry. */
  readonly native: boolean;
}
export interface AttentionBackend {
  context(): Promise<unknown>;
  request(op: { op: "inspect" | "timeline" | "compare" | "focus"; ref?: string; left?: string; right?: string }): Promise<unknown>;
  /** Mutating actions go to the human for confirmation; this never executes them. */
  proposeMutation(actionId: string, focus: FocusContext): Promise<unknown>;
}

const REF = { type: "string", description: "semantic ref such as evidence:28, candidate:<hash>, world:<hash>, case:C17" };

/** The tool set for the currently focused kind (dynamic exposure — not a permanent catalog). */
export function toolsForFocus(focus: FocusContext | undefined, backend: AttentionBackend): readonly WebMcpTool[] {
  const base: WebMcpTool[] = [
    { name: "ui_context", description: "What the human is focused on right now: the focused semantic ref, its case, what it means, related refs and available actions.", inputSchema: { type: "object", properties: {} }, execute: () => backend.context() },
    { name: "ui_focus", description: "Move the console focus to a semantic ref.", inputSchema: { type: "object", properties: { ref: REF }, required: ["ref"] }, execute: (i) => { if (!parseRef(String(i.ref))) throw new Error("not a semantic ref"); return backend.request({ op: "focus", ref: String(i.ref) }); } },
  ];
  if (!focus) return base;
  const kind = parseRef(focus.ref)?.kind as RefKind | undefined;
  if (!kind) return base;
  const dynamic = actionsFor(kind).map<WebMcpTool>((a) => ({
    name: a.id,
    description: `${a.label} (${a.mutates ? "asks the human to confirm; never executes by itself" : "read-only view"}) for ${focus.ref}`,
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      if (a.mutates) return backend.proposeMutation(a.id, focus);
      if (a.id === "compare_to_parent" || a.id === "compare_to_previous" || a.id === "compare_to_best") return backend.request({ op: "compare", left: undefined, right: focus.ref });
      if (a.id === "show_timeline" || a.id === "show_lineage") return backend.request({ op: "timeline", ref: focus.ref });
      return backend.request({ op: "inspect", ref: focus.ref });
    },
  }));
  return [...base, ...dynamic];
}

/** Registers the current tool set with the browser's WebMCP registry if one exists; returns whether it did. */
export function publishToWebMcp(tools: readonly WebMcpTool[]): boolean {
  const mc = (globalThis.navigator as unknown as { modelContext?: { provideContext?: (c: { tools: unknown[] }) => void } } | undefined)?.modelContext;
  if (!mc?.provideContext) return false;
  mc.provideContext({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: async (input: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify(await t.execute(input ?? {})) }] }) })) });
  return true;
}
