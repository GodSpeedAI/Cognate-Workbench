// `workspace.files.list` / `workspace.file.read` (J-WS-files-browse): read-only browsing of a
// selected workspace's files for the inspector's Files tab. Everything goes through the workspace's
// own execution world (local, contained, SSH, WSL) - never the browser machine, never another world.
//
// Guards, enforced server-side:
// - Operator only: a direct human operator may browse; an agent run (ctx.runId) or the system actor
//   may not (agents have their own scoped `tool.read`).
// - Root containment: `path` is relative to the workspace root. Absolute paths, NUL bytes and any
//   `..` that leaves the root after normalisation are refused. On the local world a symlink whose
//   real target is outside the real root is refused (listed as a `symlink` entry, never followed).
// - Protected application home: a workspace root inside the Workbench home is not browseable.
// - Read-only: no write capability exists here. `.git` is hidden from listings and refused on read.
// - Bounded: 500 entries per listing, 512 KiB of text per read (truncate + flag).
import { lstat, realpath } from "node:fs/promises";
import * as nodePath from "node:path";
import type { ExecutionWorldProvider, ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";

export const MAX_LIST_ENTRIES = 500;
export const MAX_READ_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
/** Files larger than this are not loaded at all (the world port reads whole files). */
const MAX_LOAD_BYTES = 16 * 1024 * 1024;

export interface WorkspaceFilesListInput {
  readonly workspaceId: string;
  /** Relative to the workspace root; default "" (the root). */
  readonly path?: string;
}
export interface WorkspaceFileEntry {
  readonly name: string;
  /** Relative to the workspace root, "/"-separated. */
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size?: number;
}
export interface WorkspaceFilesListResult {
  readonly workspaceId: string;
  readonly root: string;
  readonly path: string;
  readonly entries: readonly WorkspaceFileEntry[];
  readonly truncated: boolean;
}
export interface WorkspaceFileReadInput {
  readonly workspaceId: string;
  readonly path: string;
}
export interface WorkspaceFileReadResult {
  readonly workspaceId: string;
  readonly path: string;
  readonly size: number;
  readonly text?: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly language?: string;
}

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "json", md: "markdown", markdown: "markdown", py: "python", rs: "rust", go: "go", css: "css", scss: "scss",
  html: "html", htm: "html", xml: "xml", svg: "xml", yaml: "yaml", yml: "yaml", toml: "toml", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", txt: "text", java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby", php: "php",
  swift: "swift", lua: "lua", ini: "ini", env: "dotenv", sea: "sea", log: "text",
};

export function languageFor(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "justfile") return "just";
  if (lower === "makefile") return "makefile";
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return undefined;
  return LANGUAGES[lower.slice(dot + 1)];
}

const operatorOnly = (ctx: HandlerContext, capability: string): void => {
  if (ctx.actor.kind !== "user" || ctx.runId) throw new Error(`${capability}: only a direct human operator may browse workspace files`);
};

export function workspaceFilesComponent(options: {
  readonly registry: ExecutionWorldRegistry;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** The Workbench's own application home - never browseable. */
  readonly protectedHome?: string;
  readonly listSemanticRef?: SemanticRef;
  readonly readSemanticRef?: SemanticRef;
}): Component {
  const listContract = { id: "workspace.files.list", version: "1.0.0", semanticRef: options.listSemanticRef };
  const readContract = { id: "workspace.file.read", version: "1.0.0", semanticRef: options.readSemanticRef };

  interface Scope {
    readonly provider: ExecutionWorldProvider;
    readonly root: string;
    readonly api: typeof nodePath.posix;
    readonly local: boolean;
  }

  async function scopeFor(capability: string, workspaceId: unknown): Promise<Scope> {
    if (typeof workspaceId !== "string" || workspaceId === "") throw new Error(`${capability}: workspaceId is required`);
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "workspaces" })).rows;
    const record = rows.find((r) => r.key === `record/${workspaceId}` || r.key.endsWith(`/record/${workspaceId}`))?.value as
      | { readonly root: string; readonly executionWorldId: string }
      | undefined;
    if (!record) throw new Error(`${capability}: unknown workspace ${workspaceId} - select the workspace first`);
    if (!options.registry.has(record.executionWorldId)) throw new Error(`${capability}: the workspace's execution world (${record.executionWorldId}) is not connected`);
    const provider = options.registry.get(record.executionWorldId);
    const local = provider.kind === "local";
    const api: typeof nodePath.posix = local ? nodePath : nodePath.posix;
    if (local && options.protectedHome && underOrEqual(nodePath, record.root, options.protectedHome)) {
      throw new Error(`${capability}: the Workbench's own application folder is protected and cannot be browsed`);
    }
    return { provider, root: record.root, api, local };
  }

  /** Validate a relative path and return its normalised "/"-separated form ("" = root). */
  function cleanRelative(capability: string, raw: unknown, allowEmpty: boolean): string {
    const value = raw === undefined || raw === null ? "" : raw;
    if (typeof value !== "string") throw new Error(`${capability}: path must be a string relative to the workspace root`);
    if (value.includes("\0")) throw new Error(`${capability}: the path is not valid`);
    if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value) || value.startsWith("~")) {
      throw new Error(`${capability}: absolute paths are not allowed - give a path relative to the workspace root`);
    }
    const parts: string[] = [];
    for (const part of value.split(/[\\/]+/)) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (parts.length === 0) throw new Error(`${capability}: the path leaves the workspace root and is refused`);
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    if (parts[0] === ".git") throw new Error(`${capability}: the .git folder is not browseable`);
    if (parts.length === 0 && !allowEmpty) throw new Error(`${capability}: a file path is required`);
    return parts.join("/");
  }

  const absolute = (scope: Scope, rel: string): string => (rel === "" ? scope.root : scope.api.join(scope.root, ...rel.split("/")));

  /** Local worlds only: refuse a path whose real location is outside the real root. */
  async function assertRealContained(capability: string, scope: Scope, abs: string): Promise<void> {
    if (!scope.local) return;
    let realRoot: string;
    let real: string;
    try {
      realRoot = await realpath(scope.root);
      real = await realpath(abs);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") throw new Error(`${capability}: no such file or folder in the workspace`);
      throw readable(capability, error);
    }
    if (!underOrEqual(nodePath, real, realRoot)) throw new Error(`${capability}: the path resolves outside the workspace root (symbolic link) and is refused`);
    if (options.protectedHome && underOrEqual(nodePath, real, options.protectedHome)) {
      throw new Error(`${capability}: the Workbench's own application folder is protected and cannot be browsed`);
    }
  }

  function readable(capability: string, error: unknown): Error {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return new Error(`${capability}: no such file or folder in the workspace`);
    if (code === "EACCES" || code === "EPERM") return new Error(`${capability}: the operator account lacks permission to read that path`);
    return new Error(`${capability}: could not read the path - ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }

  return {
    id: "workspace:files",
    provides: [listContract, readContract],
    activate(fiber) {
      fiber.provide(listContract, async (rawInput, ctx): Promise<WorkspaceFilesListResult> => {
        const capability = "workspace.files.list";
        operatorOnly(ctx, capability);
        const input = (rawInput ?? {}) as WorkspaceFilesListInput;
        const scope = await scopeFor(capability, input.workspaceId);
        const rel = cleanRelative(capability, input.path, true);
        const abs = absolute(scope, rel);
        await assertRealContained(capability, scope, abs);
        let raw;
        try {
          const stat = await scope.provider.fileSystem.stat(abs);
          if (!stat) throw Object.assign(new Error("missing"), { code: "ENOENT" });
          if (stat.kind !== "directory") throw new Error(`${capability}: ${rel || "."} is not a folder`);
          raw = await scope.provider.fileSystem.list(abs);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith(capability)) throw error;
          throw readable(capability, error);
        }
        const visible = raw.filter((e) => !(rel === "" && e.name === ".git"));
        const entries = await Promise.all(visible.map(async (e): Promise<WorkspaceFileEntry> => {
          const entryRel = rel === "" ? e.name : `${rel}/${e.name}`;
          const entryAbs = scope.api.join(abs, e.name);
          let symlink = false;
          if (scope.local) symlink = await lstat(entryAbs).then((s) => s.isSymbolicLink(), () => false);
          else symlink = e.kind === "other";
          if (symlink) return { name: e.name, path: entryRel, kind: "symlink" };
          if (e.kind === "directory") return { name: e.name, path: entryRel, kind: "directory" };
          const stat = await scope.provider.fileSystem.stat(entryAbs).catch(() => undefined);
          return stat?.size === undefined ? { name: e.name, path: entryRel, kind: "file" } : { name: e.name, path: entryRel, kind: "file", size: stat.size };
        }));
        entries.sort((a, b) => {
          const ad = a.kind === "directory" ? 0 : 1;
          const bd = b.kind === "directory" ? 0 : 1;
          if (ad !== bd) return ad - bd;
          const al = a.name.toLowerCase();
          const bl = b.name.toLowerCase();
          return al < bl ? -1 : al > bl ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return {
          workspaceId: input.workspaceId,
          root: scope.root,
          path: rel,
          entries: entries.slice(0, MAX_LIST_ENTRIES),
          truncated: entries.length > MAX_LIST_ENTRIES,
        };
      });

      fiber.provide(readContract, async (rawInput, ctx): Promise<WorkspaceFileReadResult> => {
        const capability = "workspace.file.read";
        operatorOnly(ctx, capability);
        const input = (rawInput ?? {}) as WorkspaceFileReadInput;
        const scope = await scopeFor(capability, input.workspaceId);
        const rel = cleanRelative(capability, input.path, false);
        const abs = absolute(scope, rel);
        await assertRealContained(capability, scope, abs);
        const language = languageFor(rel.slice(rel.lastIndexOf("/") + 1));
        let size: number;
        let content: string;
        try {
          const stat = await scope.provider.fileSystem.stat(abs);
          if (!stat) throw Object.assign(new Error("missing"), { code: "ENOENT" });
          if (stat.kind !== "file") throw new Error(`${capability}: ${rel} is not a file`);
          size = stat.size ?? 0;
          if (size > MAX_LOAD_BYTES) {
            return { workspaceId: input.workspaceId, path: rel, size, binary: false, truncated: true, ...(language ? { language } : {}) };
          }
          content = await scope.provider.fileSystem.readText(abs);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith(capability)) throw error;
          throw readable(capability, error);
        }
        const bytes = Buffer.from(content, "utf8");
        if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
          return { workspaceId: input.workspaceId, path: rel, size, binary: true, truncated: false, ...(language ? { language } : {}) };
        }
        const truncated = bytes.length > MAX_READ_BYTES;
        // Cut on a UTF-8 boundary: decoding a chopped tail yields a replacement char we drop.
        let text = truncated ? new TextDecoder("utf-8").decode(bytes.subarray(0, MAX_READ_BYTES)).replace(/�$/, "") : content;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        return { workspaceId: input.workspaceId, path: rel, size, text, binary: false, truncated, ...(language ? { language } : {}) };
      });
    },
  };
}

function underOrEqual(api: typeof nodePath.posix, path: string, parent: string): boolean {
  const rel = api.relative(api.resolve(parent), api.resolve(path));
  return rel === "" || (!rel.startsWith("..") && !api.isAbsolute(rel));
}
