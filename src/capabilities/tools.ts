// Tool capabilities for `agent.coding`'s tool loop (T7): `tool.read`, `tool.edit`, `tool.bash`,
// `tool.run_code`.
//
// These are the model-facing tools and they have not changed shape: the model still calls
// `read`/`edit`/`bash`/`run_code`. What changed (Remote Workspaces, tranches T2–T4) is where they
// execute. This file no longer touches `node:fs` or `Bun.spawn`; it requires the framework-owned
// `filesystem.*` / `process.exec` capabilities from `@godspeedai/cognate-execution` and delegates every
// operation to the provider for the workspace's `executionWorldId`. A local workspace and an SSH
// workspace take the exact same code path here; only the provider differs.
//
// Output is not streamed through `HandlerContext.progress`: these calls are made from inside
// `agent.coding`'s `ctx.invoke`, which already records the call and its result as a
// `run.invocation` event — a second progress channel would just duplicate that.
export { PathEscapeError } from "@godspeedai/cognate-execution";
import type { ExecInput, ExecResult, ReadInput, ReadResult, ResolveInput, ResolveResult, WriteInput } from "@godspeedai/cognate-execution";
import type { CapabilityLease, Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";

const MAX_OUTPUT = 20_000;

function cap(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…(truncated)` : text;
}

/**
 * Invoke one framework execution capability through the lease this component resolved at
 * activation. A failure (including `PathEscapeError` from the containment boundary) is rethrown as
 * the original error so the outer `tool.<name>` invocation fails with it.
 */
async function delegate<I, O>(lease: CapabilityLease, input: I, ctx: HandlerContext): Promise<O> {
  const result = await lease.invoke(input, ctx);
  if (result.ok) return result.value as O;
  const failure = result.failure;
  if (failure.kind === "failed") throw failure.error;
  throw new Error(`execution capability ${lease.contract.id} failed: ${failure.kind}`);
}

// -- tool.read ---------------------------------------------------------------------------------
export interface ToolReadInput {
  readonly workspaceRoot: string;
  /** The execution world that owns `workspaceRoot` (`@godspeedai/cognate-execution`). Defaults to `local`. */
  readonly executionWorldId?: string;
  readonly file_path: string;
}
export interface ToolReadResult {
  readonly file_path: string;
  readonly content: string;
}

// -- tool.edit ---------------------------------------------------------------------------------
export interface ToolEditInput {
  readonly workspaceRoot: string;
  /** The execution world that owns `workspaceRoot` (`@godspeedai/cognate-execution`). Defaults to `local`. */
  readonly executionWorldId?: string;
  readonly file_path: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}
export interface ToolEditResult {
  readonly file_path: string;
  readonly replacements: number;
  /** Unified-diff-style lines (` ` unchanged, `-` removed, `+` added) for the UI's diff view
   *  (`10-file-change-collapsed`/`-expanded`). A simple common-prefix/suffix line diff — enough for
   *  this reconstruction's single/few-line replacements, not a general diff algorithm. */
  readonly diffLines: readonly string[];
  readonly additions: number;
  readonly deletions: number;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count++;
    index = found + needle.length;
  }
  return count;
}

/** Common-prefix/suffix line diff: everything before the first differing line and after the last
 *  differing line is shown as context (` `); the differing middle is shown as removed (`-`) old
 *  lines followed by added (`+`) new lines. */
function diffLines(oldText: string, newText: string): { readonly diffLines: readonly string[]; readonly additions: number; readonly deletions: number } {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let oldSuffix = oldLines.length;
  let newSuffix = newLines.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldLines[oldSuffix - 1] === newLines[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }
  const removed = oldLines.slice(prefix, oldSuffix);
  const added = newLines.slice(prefix, newSuffix);
  const lines: string[] = [
    ...oldLines.slice(0, prefix).map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...oldLines.slice(oldSuffix).map((l) => ` ${l}`),
  ];
  return { diffLines: lines, additions: added.length, deletions: removed.length };
}

// -- tool.bash ---------------------------------------------------------------------------------
export interface ToolBashInput {
  readonly workspaceRoot: string;
  /** The execution world that owns `workspaceRoot` (`@godspeedai/cognate-execution`). Defaults to `local`. */
  readonly executionWorldId?: string;
  readonly command: string;
  readonly description?: string;
  readonly timeoutMs?: number;
}
export interface ToolBashResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

// -- tool.run_code -----------------------------------------------------------------------------
// The reference's `run_code` (dsh-tools `packages/core/tools/src/ptc.ts`) executes a JS snippet in
// a sandbox that exposes a `tools` object (e.g. `tools.bash(...)`) and can request an elevated
// `sandbox_permissions` level, which is what triggers approval (see `approvalGate.ts`). This
// reconstruction gives `code` a small, original harness — not copied from the reference — that
// defines `tools.bash` in terms of this same `tool.bash` execution path, then runs the snippet as
// an `bun -e` subprocess with `cwd` = the workspace root.
export interface ToolRunCodeInput {
  readonly workspaceRoot: string;
  /** The execution world that owns `workspaceRoot` (`@godspeedai/cognate-execution`). Defaults to `local`. */
  readonly executionWorldId?: string;
  readonly code: string;
  readonly description?: string;
  readonly sandbox_permissions?: string;
  readonly justification?: string;
  readonly timeoutMs?: number;
}
export interface ToolRunCodeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const RUN_CODE_HARNESS = (code: string) => `
const tools = {
  bash: async ({ command }) => {
    const proc = Bun.spawn(["bash", "-lc", command], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  },
};
(async () => {
${code}
})().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exitCode = 1; });
`;

/** Every `tool.<name>` capability this app publishes, mounted as one component. */
export function toolCapabilitiesComponent(semanticRef?: SemanticRef): Component {
  const contract = (name: string) => ({ id: `tool.${name}`, version: "1.0.0", semanticRef });
  return {
    id: "tools:all",
    provides: [contract("read"), contract("edit"), contract("bash"), contract("run_code")],
    requires: {
      resolve: { capability: "filesystem.resolve" },
      read: { capability: "filesystem.readText" },
      write: { capability: "filesystem.writeText" },
      exec: { capability: "process.exec" },
    },
    activate(fiber) {
      const dep = fiber.dependencies;
      const world = (input: { readonly executionWorldId?: string }) => input.executionWorldId ?? "local";
      const resolvePath = async (input: ToolReadInput | ToolEditInput, ctx: HandlerContext): Promise<string> => {
        const out = await delegate<ResolveInput, ResolveResult>(dep.resolve!, { worldId: world(input), root: input.workspaceRoot, path: input.file_path }, ctx);
        return out.path;
      };

      fiber.provide(contract("read"), async (rawInput, ctx): Promise<ToolReadResult> => {
        const input = rawInput as ToolReadInput;
        const path = await resolvePath(input, ctx);
        const out = await delegate<ReadInput, ReadResult>(dep.read!, { worldId: world(input), path }, ctx);
        return { file_path: input.file_path, content: out.content };
      });

      fiber.provide(contract("edit"), async (rawInput, ctx): Promise<ToolEditResult> => {
        const input = rawInput as ToolEditInput;
        const path = await resolvePath(input, ctx);
        const worldId = world(input);
        const current = (await delegate<ReadInput, ReadResult>(dep.read!, { worldId, path }, ctx)).content;
        const occurrences = countOccurrences(current, input.old_string);
        if (occurrences === 0) throw new Error(`tool.edit: old_string not found in ${input.file_path}`);
        if (occurrences > 1 && !input.replace_all) {
          throw new Error(`tool.edit: old_string is not unique in ${input.file_path} (${occurrences} matches) — provide more context or set replace_all`);
        }
        const next = input.replace_all
          ? current.split(input.old_string).join(input.new_string)
          : current.replace(input.old_string, input.new_string);
        await delegate<WriteInput, unknown>(dep.write!, { worldId, path, content: next }, ctx);
        const diff = diffLines(current, next);
        return { file_path: input.file_path, replacements: input.replace_all ? occurrences : 1, ...diff };
      });

      fiber.provide(contract("bash"), async (rawInput, ctx): Promise<ToolBashResult> => {
        const input = rawInput as ToolBashInput;
        const r = await delegate<ExecInput, ExecResult>(
          dep.exec!,
          { worldId: world(input), argv: ["bash", "-lc", input.command], cwd: input.workspaceRoot, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) },
          ctx,
        );
        return { command: input.command, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut };
      });

      fiber.provide(contract("run_code"), async (rawInput, ctx): Promise<ToolRunCodeResult> => {
        const input = rawInput as ToolRunCodeInput;
        const r = await delegate<ExecInput, ExecResult>(
          dep.exec!,
          { worldId: world(input), argv: ["bun", "-e", RUN_CODE_HARNESS(input.code)], cwd: input.workspaceRoot, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) },
          ctx,
        );
        return { exitCode: r.exitCode, stdout: cap(r.stdout), stderr: cap(r.stderr), timedOut: r.timedOut };
      });
    },
  };
}
