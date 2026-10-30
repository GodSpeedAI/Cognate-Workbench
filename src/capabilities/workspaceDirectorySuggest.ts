// `workspace.directory.suggest` (J-WS-directory-discovery): read-only, bounded directory
// completion against the **selected execution world's** filesystem — the operator types a
// partial path and gets the folders that match, instead of having to know or paste a full
// absolute path. Browsing never creates a workspace (that is the separate, governed
// `workspace.select`), and it never falls back to another world: an unknown or disconnected
// world fails closed with `WorldUnavailableError`.
//
// Guards enforced here, server-side:
// - Execution-world boundary: the provider named by `worldId` owns the listing — SSH/WSL paths
//   are listed by that world, never by the browser machine's filesystem.
// - Path normalization: the typed path must be absolute and is split lexically into a parent
//   directory and a prefix (trailing separator = empty prefix = list everything).
// - Directory-only, deterministic, bounded results: files, "other" entries (including symlinked
//   directories, which `readdir` reports as neither file nor directory) never appear; matches
//   are sorted by name and capped at `limit`.
// - Protected application home: the local world never suggests paths inside the Workbench's own
//   home (the store, secrets and ledgers live there) — that inventory is not browseable.
// - No content: a suggestion is `{ name, path, kind }` only — never file contents, secret
//   material or raw stack traces (provider errors are re-written as readable reasons).
import type { ExecutionWorldRegistry, WorldUnavailableError } from "@godspeedai/cognate-execution";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";

export interface DirectorySuggestInput {
  /** The execution world whose filesystem is browsed. No fallback to any other world. */
  readonly worldId: string;
  /** The partial absolute path typed so far; its last segment is the match prefix. */
  readonly typedPath: string;
  /** Maximum number of suggestions (1..100, default 20). */
  readonly limit?: number;
}

export interface DirectorySuggestion {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory";
}

export interface DirectorySuggestResult {
  readonly suggestions: readonly DirectorySuggestion[];
  readonly worldId: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Split a typed POSIX path into (parent, prefix). "/a/b" -> ("/a", "b"); "/a/b/" -> ("/a/b", ""). */
export function splitTypedPath(typedPath: string): { readonly parent: string; readonly prefix: string } {
  const normalized = typedPath.replace(/\/+$/, "") || "/";
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return { parent: "/", prefix: normalized.slice(1) };
  return { parent: normalized.slice(0, slash), prefix: normalized.slice(slash + 1) };
}

function isUnder(parent: string, root: string): boolean {
  if (root === "") return false;
  const base = root.replace(/\/+$/, "") || "/";
  return parent === base || parent.startsWith(`${base}/`);
}

export function workspaceDirectorySuggestComponent(options: {
  readonly registry: ExecutionWorldRegistry;
  /** The Workbench's own application home on the local machine — never suggested from. */
  readonly protectedHome?: string;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "workspace:directory-suggest",
    provides: [{ id: "workspace.directory.suggest", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "workspace.directory.suggest", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput): Promise<DirectorySuggestResult> => {
        const input = rawInput as DirectorySuggestInput;
        const typedPath = (input.typedPath ?? "").trim();
        if (!typedPath) throw new Error("workspace.directory.suggest: type the start of a folder path, for example /home/");
        if (!typedPath.startsWith("/")) throw new Error("workspace.directory.suggest: the path must be absolute — start from /");
        // Unknown or disconnected world -> WorldUnavailableError. There is no local fallback.
        const provider = options.registry.get(input.worldId);
        const { parent, prefix } = splitTypedPath(typedPath);
        if (provider.kind === "local" && options.protectedHome && isUnder(parent, options.protectedHome)) {
          throw new Error("workspace.directory.suggest: the Workbench's own application folder is protected and not browseable — choose a project folder elsewhere");
        }
        const limitRaw = Number(input.limit ?? DEFAULT_LIMIT);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT) : DEFAULT_LIMIT;
        let entries;
        try {
          entries = await provider.fileSystem.list(parent);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          if (code === "ENOENT" || code === "ENOTDIR") {
            throw new Error(`workspace.directory.suggest: ${parent} does not exist as a folder in world ${input.worldId}`);
          }
          if (code === "EACCES" || code === "EPERM") {
            throw new Error(`workspace.directory.suggest: ${parent} is not listable in world ${input.worldId} — the operator account lacks permission`);
          }
          throw new Error(`workspace.directory.suggest: world ${input.worldId} could not list ${parent} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        }
        const suggestions = entries
          .filter((entry) => entry.kind === "directory" && entry.name.startsWith(prefix))
          .map((entry) => ({ name: entry.name, path: parent === "/" ? `/${entry.name}` : `${parent}/${entry.name}`, kind: "directory" as const }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, limit);
        return { suggestions, worldId: input.worldId };
      });
    },
  };
}

export type { WorldUnavailableError };
