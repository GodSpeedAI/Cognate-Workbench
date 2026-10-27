// Collapsed tool activity (ported from PandaCode 0.3.56, `src/tool-activity.ts:88-98` and
// `src/tool-trace.ts:218-253`).
//
// Pure, React-free so it can be unit-tested without a DOM and imported by both the transcript
// (`MessageBubble`) and the live running-tool row. The donor does this with innerHTML strings; this
// app renders React elements, so only the *mechanism* is ported — grouping, the run cap, clause
// assembly and the label table — not the markup or CSS.
//
// Everything here is OBSERVED behaviour from the donor unless noted INFERRED.

/** One tool call as the UI tracks it. Structurally a subset of `ToolEntry` in `src/ui/App.tsx`, so a
 *  `readonly ToolEntry[]` is assignable to `readonly ToolStepLike[]` without a cast. */
export interface ToolStepLike {
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "success" | "failed";
  readonly error?: string;
}

/** A run of consecutive tool calls, or a single non-tool (narration) boundary row. */
export type ToolRun<T> =
  | { readonly kind: "tools"; readonly key: string; readonly items: readonly T[] }
  | { readonly kind: "message"; readonly item: T };

/** Hard cap on how many calls one collapsed group may absorb before a new group starts. The donor
 *  picks 5 (`tool-activity.ts:96`); it bounds both the header summary and the expanded list. */
export const DEFAULT_TOOL_RUN_CAP = 5;

/** How many distinct summary clauses are named before falling back to `and N more steps`.
 *  The donor's `SUMMARY_CLAUSES` (`tool-trace.ts:225`). */
const SUMMARY_CLAUSES = 2;

/**
 * Group consecutive tool calls into runs.
 *
 * - A run keeps the **first** call's key, so its React key stays stable while entries stream in
 *   (the donor does the same at `tool-activity.ts:97` — `key` is captured when the run opens).
 * - A run absorbs at most `cap` calls; the next call opens a new run, whose key is therefore the
 *   (cap+1)-th call's id. This is what makes the cap actually bind rather than being cosmetic.
 * - A non-tool entry (narration) is a boundary *and* is emitted as its own row, so it can never be
 *   swallowed into a group's children.
 */
export function groupToolRuns<T>(
  entries: readonly T[],
  toolKey: (entry: T) => string | undefined,
  cap: number = DEFAULT_TOOL_RUN_CAP,
): readonly ToolRun<T>[] {
  // A cap below 1 would mean no run can ever accept an entry, so every call would open a fresh
  // single-item run. Clamp rather than loop forever on a caller's bad argument.
  const limit = Math.max(1, Math.floor(cap));
  const runs: ToolRun<T>[] = [];
  for (const entry of entries) {
    const key = toolKey(entry);
    if (key === undefined) {
      runs.push({ kind: "message", item: entry });
      continue;
    }
    const previous = runs[runs.length - 1];
    if (previous !== undefined && previous.kind === "tools" && previous.items.length < limit) {
      // Immutable rebuild rather than push: `readonly items` is part of the public shape, and the
      // caller may hold an earlier result.
      runs[runs.length - 1] = { kind: "tools", key: previous.key, items: [...previous.items, entry] };
    } else {
      runs.push({ kind: "tools", key, items: [entry] });
    }
  }
  return runs;
}

/** The key extractor for `ToolStepLike`; `undefined` means "not a tool call, treat as a boundary". */
export function toolStepKey(entry: ToolStepLike): string {
  return entry.toolCallId;
}


export interface ToolSummary {
  /** One line, e.g. `Ran 3 commands and read 2 files`. Capitalised; `…` while still running. */
  readonly text: string;
  /** Number of failed calls across every supplied step (0 when none). */
  readonly failedCount: number;
  /** True when any supplied step is still `running`. */
  readonly running: boolean;
}

/**
 * Describe a run of tool calls in prose, the way the donor's folded header does
 * (`tool-trace.ts:231-253`).
 *
 * Only calls that share both a verb and a noun are counted together; at most `SUMMARY_CLAUSES`
 * distinct clauses are named, and the remainder is reported as `and N more steps`. Past-tense verbs
 * are used unless something is still running, which also appends `…`.
 *
 * Failures are appended after ` · ` so the summary can never read as unqualified success.
 */
export function summarizeToolRuns(steps: readonly ToolStepLike[]): ToolSummary {
  const running = steps.some((step) => step.status === "running");
  const failedCount = steps.filter((step) => step.status === "failed").length;

  // `verb:noun`, e.g. `Ran:command` — the clause identity. Two `read`s merge, `read`+`bash` do not.
  const clauses = new Map<string, { verb: string; count: number; nouns: readonly [string, string] }>();
  for (const step of steps) {
    const part = summaryPart(step.tool);
    const verb = running ? part.verb[0] : part.verb[1];
    const id = `${verb}:${part.key}`;
    const existing = clauses.get(id);
    clauses.set(id, { verb, count: (existing?.count ?? 0) + 1, nouns: part.nouns });
  }

  const shown = [...clauses.values()].slice(0, SUMMARY_CLAUSES);
  const namedCount = shown.reduce((sum, clause) => sum + clause.count, 0);
  const rest = steps.length - namedCount;

  // A verb with several nouns reads `read 2 files and 1 source`; a verb with one noun keeps its
  // count inline (`ran 1 command`).
  const byVerb = new Map<string, string[]>();
  for (const { verb, count, nouns } of shown) {
    const one = nouns[0];
    const many = nouns[1];
    // "the plan" is invariant — `updated the plan`, never `updated 2 the plan`.
    const phrase = one === INVARIANT_NOUN ? one : `${count} ${count === 1 ? one : many}`;
    byVerb.set(verb, [...(byVerb.get(verb) ?? []), phrase]);
  }

  const phrases = [...byVerb].map(([verb, nouns]) => `${verb.toLowerCase()} ${joinPhrases(nouns)}`);
  const sentence = rest > 0
    ? `${phrases.join(", ")} and ${rest} more ${rest === 1 ? "step" : "steps"}`
    : joinPhrases(phrases);

  const text = `${capitalize(sentence)}${running ? "…" : ""}${failedCount > 0 ? ` · ${failedCount} failed` : ""}`;
  return { text, failedCount, running };
}

/** `a`, `a and b` — the donor's `joinPhrases` (`tool-trace.ts:217-219`); no Oxford comma. */
function joinPhrases(parts: readonly string[]): string {
  const last = parts[parts.length - 1];
  if (parts.length < 2 || last === undefined) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${last}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** A noun that must not be pluralised or counted. */
const INVARIANT_NOUN = "the plan";

interface SummaryPart {
  /** `[present, past]` — present tense is used while the run is live, matching the donor. */
  readonly verb: readonly [string, string];
  /** Clause identity; also selects the noun pair. */
  readonly key: string;
  readonly nouns: readonly [string, string];
}

/** Summary wording per tool. Unknown tools degrade to a generic `used N tools` rather than
 *  inventing a noun for a tool this app does not know. */
function summaryPart(tool: string): SummaryPart {
  switch (tool) {
    case "read":
      return { verb: ["Reading", "Read"], key: "file", nouns: ["file", "files"] };
    case "edit":
      return { verb: ["Editing", "Edited"], key: "edit", nouns: ["file", "files"] };
    case "bash":
      return { verb: ["Running", "Ran"], key: "command", nouns: ["command", "commands"] };
    case "run_code":
      return { verb: ["Running", "Ran"], key: "code", nouns: ["snippet", "snippets"] };
    case "todo_write":
      return { verb: ["Updating", "Updated"], key: "plan", nouns: [INVARIANT_NOUN, INVARIANT_NOUN] };
    case "exit_plan_mode":
      return { verb: ["Calling", "Called"], key: "plan-review", nouns: ["plan review", "plan reviews"] };
    case "subagent":
      return { verb: ["Coordinating", "Coordinated"], key: "subagent", nouns: ["subagent", "subagents"] };
    default:
      return { verb: ["Using", "Used"], key: `tool:${tool}`, nouns: ["tool", "tools"] };
  }
}

/** The noun/verb wording shared by both label functions, in one place.
 *
 *  Before this module the same seven tool names were spelled out twice — `toolActionLabel` and
 *  `verboseStepLabel` in `src/ui/App.tsx` — with different grammar (verb phrase vs. short noun) but
 *  the same knowledge of which tools exist. Adding an eighth tool meant remembering both, and the
 *  two lists had already drifted in wording. The entries below are that shared knowledge; the two
 *  renderers now differ only in which field they read. */
export interface ToolKind {
  /** Short noun for the settled per-step line, e.g. `Read · <path>`. */
  readonly noun: string;
  /** Verb phrase for the live running-tool row, e.g. `Reading files`. */
  readonly action: string;
  /** The `args` field carrying the `· <detail>` suffix, if this tool has one. */
  readonly detailArg?: string;
  /** Fallback `args` field used when `detailArg` is missing or empty (`bash`: `description`, then
   *  `command`). */
  readonly detailFallbackArg?: string;
  /** True when the tool name itself is the detail, so work-details mode must not alter the label. */
  readonly nameIsDetail?: boolean;
}

/** The single tool-kind table. Unknown tools fall through to the callers' generic labels. */
export const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  read: { noun: "Read", action: "Reading files", detailArg: "file_path" },
  edit: { noun: "Edit", action: "Editing files", detailArg: "file_path" },
  bash: {
    noun: "Bash",
    action: "Running commands",
    detailArg: "description",
    detailFallbackArg: "command",
  },
  run_code: { noun: "Run code", action: "Running code", detailArg: "description" },
  todo_write: { noun: "To-dos", action: "Updating the plan", nameIsDetail: true },
  exit_plan_mode: { noun: "Plan review", action: "Calling tools", nameIsDetail: true },
  subagent: { noun: "Subagent", action: "Coordinating subagents", detailArg: "description" },
};

/** Resolve the `· <detail>` suffix for a tool, or `""` when it has none or the arg is empty. */
export function toolDetail(tool: string, args: Readonly<Record<string, unknown>>): string {
  const kind = TOOL_KINDS[tool];
  if (kind === undefined) return "";
  const fromArg = (name: string | undefined): string =>
    name === undefined ? "" : String(args[name] ?? "").trim();
  // `detailFallbackArg` only applies when the primary arg produced nothing, so `bash` prefers its
  // human `description` and otherwise falls back to the raw `command`.
  return fromArg(kind.detailArg) || fromArg(kind.detailFallbackArg);
}

/** The `· <detail>` suffix for a label, or `""` when this tool shows no suffix at all.
 *
 *  Two tools (`todo_write`, `exit_plan_mode`) use their own name as the detail — that is what the
 *  pre-existing labels did, and the work-details mode deliberately does not change them, because the
 *  tool name *is* the only detail they have. */
function labelSuffix(tool: string, args: Readonly<Record<string, unknown>>): string {
  const kind = TOOL_KINDS[tool];
  if (kind === undefined) return "";
  return kind.nameIsDetail ? tool : toolDetail(tool, args);
}

/** Live running-tool label, e.g. `Reading files · src/greet.ts`.
 *
 *  `showDetail` is `showsLiveProcessDetail(mode)` (`src/workDetails.ts`): true for
 *  `standard`/`detailed`, false for `compact`/`verbose`. Name-is-detail tools ignore it, matching the
 *  original `toolActionLabel` comment at `src/ui/App.tsx:2356-2358`.
 *
 *  Unknown tools fall through to `Running <tool>`, the original's default branch.
 */
export function toolActionLabelFor(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  showDetail: boolean,
): string {
  const kind = TOOL_KINDS[tool];
  if (kind === undefined) return `Running ${tool}`;
  if (kind.nameIsDetail) return `${kind.action} · ${tool}`;
  return showDetail ? `${kind.action} · ${labelSuffix(tool, args)}` : kind.action;
}

/** Settled per-step label, e.g. `Read · src/greet.ts`. Always carries its suffix (the settled list
 *  is the detailed view); unknown tools fall through to the bare tool name, as the original did. */
export function toolStepLabelFor(tool: string, args: Readonly<Record<string, unknown>>): string {
  const kind = TOOL_KINDS[tool];
  if (kind === undefined) return tool;
  return `${kind.noun} · ${labelSuffix(tool, args)}`;
}

