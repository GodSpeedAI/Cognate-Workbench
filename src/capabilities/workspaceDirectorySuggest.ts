// `workspace.directory.suggest` (J-WS-directory-discovery): read-only, bounded directory
// completion against the **selected execution world's** filesystem — the operator types a
// partial path (absolute, `~/…`, or just a fragment of a folder name) and gets the folders that
// match, instead of having to know or paste a full absolute path. Browsing never creates a
// workspace (that is the separate, governed `workspace.select`), and it never falls back to
// another world: an unknown or disconnected world fails closed with `WorldUnavailableError`.
//
// Guards and behaviour enforced here, server-side (the client just sends what was typed):
// - Execution-world boundary: the provider named by `worldId` owns the listing — SSH/WSL paths
//   are listed by that world, never by the browser machine's filesystem.
// - Input normalisation: `~` / `~/x` expand to the world's user home (local: $HOME or os.homedir();
//   remote worlds must declare `metadata.home`, otherwise `~` is refused with a clear reason).
//   A relative input — a bare fragment such as `proj` or `work/co` — resolves against that home.
//   Duplicate separators collapse and `.`/`..` resolve; the local world uses the host platform's
//   path semantics (drive letters and backslashes on win32), remote worlds use POSIX.
// - Matching on the entries of one parent directory, in tiers: case-insensitive prefix, then
//   word-boundary match (after - _ . space or camelCase), then case-insensitive substring, then
//   fuzzy subsequence (`cgw` -> `cognate-workbench`). Dot-directories stay hidden unless the
//   fragment starts with `.`. Within a tier results are ordered by name. Results are bounded by
//   `limit`; `truncated` says when more matched.
// - Directory-only: files never appear. Symlinks that resolve to directories do (the entry is
//   stat-followed, at most MAX_STATS per request); broken links and links to files are ignored.
// - Protected application home: the local world never lists inside the Workbench's own home (the
//   store, secrets and ledgers live there) — that yields an empty result with a `notice`.
// - No content: a suggestion is `{ name, path, kind, display }` only — never file contents, secret
//   material or raw stack traces (provider errors are re-written as readable reasons).
import { homedir } from "node:os";
import * as nodePath from "node:path";
import type { ExecutionWorldRegistry, WorldUnavailableError } from "@godspeedai/cognate-execution";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";

export interface DirectorySuggestInput {
  /** The execution world whose filesystem is browsed. No fallback to any other world. */
  readonly worldId: string;
  /** What the operator typed: absolute path, `~/…`, or a fragment resolved against the user home. */
  readonly typedPath: string;
  /** Maximum number of suggestions (1..100, default 20). */
  readonly limit?: number;
}

export interface DirectorySuggestion {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory";
  /** Home-relative (`~/projects/x`) when the path is under the user home, otherwise the path. */
  readonly display: string;
  /** Character indices of `name` that matched the fragment (for highlighting). */
  readonly matchIndices: readonly number[];
}

export interface DirectorySuggestResult {
  readonly suggestions: readonly DirectorySuggestion[];
  readonly worldId: string;
  /** The directory that was actually listed (absolute, normalised). */
  readonly resolvedParent: string;
  readonly resolvedParentDisplay: string;
  /** True when more folders matched than `limit` allowed. */
  readonly truncated: boolean;
  /** A non-fatal explanation when nothing could be listed (protected, missing, unreadable). */
  readonly notice?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_STATS = 200;

type PathApi = typeof nodePath.posix;

/** Split a typed POSIX path into (parent, prefix). "/a/b" -> ("/a", "b"); "/a/b/" -> ("/a/b", ""). */
export function splitTypedPath(typedPath: string): { readonly parent: string; readonly prefix: string } {
  const normalized = typedPath.replace(/\/+$/, "") || "/";
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return { parent: "/", prefix: normalized.slice(1) };
  return { parent: normalized.slice(0, slash), prefix: normalized.slice(slash + 1) };
}

function isUnder(api: PathApi, parent: string, root: string): boolean {
  if (root === "") return false;
  const rel = api.relative(api.resolve(root), api.resolve(parent));
  return rel === "" || (!rel.startsWith("..") && !api.isAbsolute(rel));
}

function homeDisplay(api: PathApi, path: string, home: string | undefined): string {
  if (!home) return path;
  const rel = api.relative(home, path);
  if (rel === "") return "~";
  if (rel.startsWith("..") || api.isAbsolute(rel)) return path;
  return `~/${rel.split(api.sep).join("/")}`;
}

/** Tier 0 prefix, 1 word boundary, 2 substring, 3 fuzzy; undefined = no match. */
export function matchFragment(name: string, fragment: string): { readonly tier: number; readonly indices: readonly number[] } | undefined {
  if (fragment === "") return { tier: 0, indices: [] };
  const lowerName = name.toLowerCase();
  const frag = fragment.toLowerCase();
  const range = (start: number) => Array.from({ length: frag.length }, (_, i) => start + i);
  if (lowerName.startsWith(frag)) return { tier: 0, indices: range(0) };
  const isBoundary = (i: number) => {
    if (i === 0) return true;
    const prev = name[i - 1]!;
    if (/[-_.\s]/.test(prev)) return true;
    return name[i] !== name[i]!.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase();
  };
  for (let at = lowerName.indexOf(frag); at !== -1; at = lowerName.indexOf(frag, at + 1)) {
    if (isBoundary(at)) return { tier: 1, indices: range(at) };
  }
  const sub = lowerName.indexOf(frag);
  if (sub !== -1) return { tier: 2, indices: range(sub) };
  const indices: number[] = [];
  let from = 0;
  for (const ch of frag) {
    const hit = lowerName.indexOf(ch, from);
    if (hit === -1) return undefined;
    indices.push(hit);
    from = hit + 1;
  }
  return { tier: 3, indices };
}

/** HOME / USERPROFILE as the OS reports them, read per call (os.homedir() can be cached by the runtime). */
const defaultHome = (): string => process.env.HOME || process.env.USERPROFILE || homedir();

export function workspaceDirectorySuggestComponent(options: {
  readonly registry: ExecutionWorldRegistry;
  /** The Workbench's own application home on the local machine — never suggested from. */
  readonly protectedHome?: string;
  /** The local user's home (default `$HOME`/`os.homedir()`); injectable for tests. */
  readonly homeDir?: () => string;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "workspace:directory-suggest",
    provides: [{ id: "workspace.directory.suggest", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "workspace.directory.suggest", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput): Promise<DirectorySuggestResult> => {
        const input = rawInput as DirectorySuggestInput;
        // Unknown or disconnected world -> WorldUnavailableError. There is no local fallback.
        const provider = options.registry.get(input.worldId);
        const isLocal = provider.kind === "local";
        const api: PathApi = isLocal ? nodePath : nodePath.posix;
        const home = isLocal ? (options.homeDir ?? defaultHome)() : provider.metadata.home;
        const limitRaw = Number(input.limit ?? DEFAULT_LIMIT);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT) : DEFAULT_LIMIT;
        const empty = (resolvedParent: string, notice: string): DirectorySuggestResult => ({
          suggestions: [],
          worldId: input.worldId,
          resolvedParent,
          resolvedParentDisplay: homeDisplay(api, resolvedParent, home),
          truncated: false,
          notice,
        });

        let typed = (input.typedPath ?? "").trim();
        if (typed === "") typed = "~/";
        const sepClass = isLocal && api.sep === "\\" ? /[\\/]/ : /\//;
        const wantsHome = typed === "~" || (typed.startsWith("~") && sepClass.test(typed[1] ?? ""));
        if (!home && (wantsHome || !api.isAbsolute(typed))) {
          throw new Error(`workspace.directory.suggest: the home folder of world ${input.worldId} is not known — type an absolute path instead`);
        }
        let expanded = typed;
        // Plain concatenation (not path.join) so a trailing `.` fragment survives until it is split off below.
        if (wantsHome) expanded = home!.replace(/[\\/]+$/, "") + typed.slice(1);
        else if (!api.isAbsolute(typed)) expanded = `${home!.replace(/[\\/]+$/, "")}${api.sep}${typed}`;
        // A trailing separator or a trailing `..` means "list this folder"; a lone trailing `.`
        // is a fragment (it reveals dot-directories), so it is split off before normalising.
        const lastSegment = expanded.split(sepClass).pop() ?? "";
        const listsFolder = typed === "~" || sepClass.test(expanded.slice(-1)) || lastSegment === "..";
        const dotFragment = !listsFolder && lastSegment === ".";
        const normalized = api.normalize(dotFragment ? expanded.slice(0, -1) || expanded : expanded);
        const stripped = api.parse(normalized).root === normalized ? normalized : normalized.replace(isLocal && api.sep === "\\" ? /[\\/]+$/ : /\/+$/, "");
        const parent = listsFolder || dotFragment ? stripped : api.dirname(stripped);
        const fragment = dotFragment ? "." : listsFolder ? "" : api.basename(stripped);

        if (isLocal && options.protectedHome && isUnder(api, parent, options.protectedHome)) {
          return empty(parent, "The Workbench's own application folder is protected and not browseable — choose a project folder elsewhere.");
        }
        let entries;
        try {
          entries = await provider.fileSystem.list(parent);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          if (code === "ENOENT" || code === "ENOTDIR") return empty(parent, `${homeDisplay(api, parent, home)} does not exist as a folder in world ${input.worldId}.`);
          if (code === "EACCES" || code === "EPERM") return empty(parent, `${homeDisplay(api, parent, home)} is not listable in world ${input.worldId} — the operator account lacks permission.`);
          throw new Error(`workspace.directory.suggest: world ${input.worldId} could not list ${parent} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        }

        const showHidden = fragment.startsWith(".");
        const candidates = entries
          .filter((entry) => entry.kind !== "file" && (showHidden || !entry.name.startsWith(".")))
          .flatMap((entry) => {
            const m = matchFragment(entry.name, fragment);
            return m ? [{ entry, m }] : [];
          });
        // Symlinks (and other non-plain entries) are stat-followed; only those resolving to a directory count.
        const others = candidates.filter((c) => c.entry.kind === "other").slice(0, MAX_STATS);
        const resolvedDirs = new Set<string>();
        await Promise.all(
          others.map(async (c) => {
            try {
              const stat = await provider.fileSystem.stat(api.join(parent, c.entry.name));
              if (stat?.kind === "directory") resolvedDirs.add(c.entry.name);
            } catch {
              // broken or unreadable link: ignore
            }
          }),
        );
        const matches = candidates
          .filter((c) => c.entry.kind === "directory" || resolvedDirs.has(c.entry.name))
          .sort((a, b) => a.m.tier - b.m.tier || a.entry.name.localeCompare(b.entry.name) || (a.entry.name < b.entry.name ? -1 : 1));
        const suggestions = matches.slice(0, limit).map(({ entry, m }): DirectorySuggestion => {
          const path = api.join(parent, entry.name);
          return { name: entry.name, path, kind: "directory", display: homeDisplay(api, path, home), matchIndices: m.indices };
        });
        return {
          suggestions,
          worldId: input.worldId,
          resolvedParent: parent,
          resolvedParentDisplay: homeDisplay(api, parent, home),
          truncated: matches.length > limit,
        };
      });
    },
  };
}

export type { WorldUnavailableError };
