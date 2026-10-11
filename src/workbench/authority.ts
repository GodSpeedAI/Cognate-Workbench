// Authority scopes: filesystem, shell and network decisions, with protected evidence enforced
// structurally. Pattern matching is `glob.ts` (ported from picomatch) and command analysis is
// `shellSafety.ts` (ported from openai/codex and opencode); see DONORS in primitive-provenance.md.
import { posix } from "node:path";
import { globMatch } from "./glob.ts";
import { installsPackages, isDestructiveCommand, mutationTargets, usesNetwork } from "./shellSafety.ts";
import type { AuthorityScopes, Grant } from "./types.ts";

export { isDestructiveCommand };

export interface Decision {
  readonly outcome: "allow" | "approval" | "deny";
  readonly rule: string;
  readonly reason: string;
  /** The protected pattern that matched, when `rule` is `protected-evidence`. */
  readonly pattern?: string;
  /** The (normalised) path that matched. */
  readonly path?: string;
}

type Outcome = Decision["outcome"];
const STRICTNESS: Record<Outcome, number> = { allow: 0, approval: 1, deny: 2 };
const fromGrant = (g: Grant): Outcome => (g === "yes" ? "allow" : g === "approval" ? "approval" : "deny");
const strictest = (...o: Outcome[]): Outcome => o.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "allow" as Outcome);

/** Normalise to a workspace-relative POSIX path; `escapes` is true when it leaves the workspace. */
export function normalizeRelative(relPath: string): { readonly path: string; readonly escapes: boolean } {
  const unified = relPath.replace(/\\/g, "/");
  if (unified.startsWith("/")) return { path: unified, escapes: true };
  const path = posix.normalize(unified.replace(/^\.\//, ""));
  return { path, escapes: path === ".." || path.startsWith("../") };
}

/** Returns the first protected pattern that covers `relPath`, or undefined. Patterns: `dir/`
 *  (everything beneath), a bare name or glob without `/` (matched against the basename and the
 *  full path), or a path glob. */
export function matchesProtected(patterns: readonly string[], relPath: string): string | undefined {
  const { path } = normalizeRelative(relPath);
  if (!path || path === "." || path === "..") return undefined;
  const base = path.split("/").pop() ?? "";
  for (const pattern of patterns) {
    if (pattern.endsWith("/")) {
      const dir = pattern.slice(0, -1);
      if (path === dir || path.startsWith(`${dir}/`)) return pattern;
    } else if (pattern.includes("/")) {
      if (globMatch(pattern, path)) return pattern;
    } else if (globMatch(pattern, base) || globMatch(pattern, path)) {
      return pattern;
    }
  }
  return undefined;
}

function protectedDecision(pattern: string, path: string, elevated: boolean, what: string): Decision {
  return elevated
    ? { outcome: "approval", rule: "protected-evidence", pattern, path, reason: `${what} touches elevated protected path '${path}' (pattern '${pattern}'): approval required` }
    : { outcome: "deny", rule: "protected-evidence", pattern, path, reason: `${what} is blocked: '${path}' is protected evidence (pattern '${pattern}'); it is immutable unless a reviewer explicitly elevates this exact path` };
}

export function decideWrite(scopes: AuthorityScopes, relPath: string, opts?: { readonly elevatedPaths?: readonly string[] }): Decision {
  const { path, escapes } = normalizeRelative(relPath);
  if (escapes) {
    const outcome = fromGrant(scopes.filesystem.outsideWorkspace);
    if (outcome !== "allow") return { outcome, rule: "fs.outside", reason: `Path escapes the workspace${outcome === "approval" ? " (requires approval)" : ""}` };
    // Outside paths are never covered by workspace-relative protection; fall through to the write grant.
  } else {
    const pattern = matchesProtected(scopes.protectedPaths, path);
    if (pattern) return protectedDecision(pattern, path, matchesProtected(opts?.elevatedPaths ?? [], path) !== undefined, "Write");
  }
  const outcome = fromGrant(scopes.filesystem.write);
  return { outcome, rule: "fs.write", reason: outcome === "allow" ? "Filesystem write permitted" : outcome === "approval" ? "Filesystem write requires approval" : "Filesystem write denied" };
}

export function decideShell(scopes: AuthorityScopes, cmd: string, opts?: { readonly elevatedPaths?: readonly string[] }): Decision {
  // 1. Protected evidence first: any path the command may write or delete.
  for (const target of mutationTargets(cmd)) {
    const { path, escapes } = normalizeRelative(target.target);
    if (escapes) continue;
    const pattern = matchesProtected(scopes.protectedPaths, path);
    if (pattern) return protectedDecision(pattern, path, matchesProtected(opts?.elevatedPaths ?? [], path) !== undefined, `Shell command (${target.verb})`);
  }
  // 2. Every other concern contributes an outcome; the strictest wins.
  const parts: { outcome: Outcome; rule: string; reason: string }[] = [];
  const run = fromGrant(scopes.shell.run);
  parts.push({ outcome: run, rule: "shell.run", reason: run === "allow" ? "Shell command permitted" : run === "approval" ? "Shell command requires approval" : "Shell command denied" });
  if (isDestructiveCommand(cmd)) {
    const o = fromGrant(scopes.shell.destructive);
    parts.push({ outcome: o, rule: "shell.destructive", reason: o === "allow" ? "Destructive shell command permitted" : o === "approval" ? "Destructive shell command requires approval" : "Destructive shell command denied" });
  }
  if (usesNetwork(cmd)) {
    const o = fromGrant(scopes.network.outbound);
    parts.push({ outcome: o, rule: "network.outbound", reason: o === "allow" ? "Network command permitted" : o === "approval" ? "Network command requires approval" : "Network command denied" });
  }
  if (installsPackages(cmd)) {
    const o = fromGrant(scopes.packages.install);
    parts.push({ outcome: o, rule: "packages.install", reason: o === "allow" ? "Package install permitted" : o === "approval" ? "Package install requires approval" : "Package install denied" });
  }
  const worst = strictest(...parts.map((p) => p.outcome));
  // Report the most specific rule that produced the winning outcome (last = most specific).
  const winner = [...parts].reverse().find((p) => p.outcome === worst) ?? parts[0]!;
  return { outcome: worst, rule: winner.rule, reason: winner.reason };
}

export interface AuthorityRow {
  readonly group: string;
  readonly label: string;
  readonly grant: Grant | "immutable";
}

export function describeAuthority(scopes: AuthorityScopes): AuthorityRow[] {
  const rows: AuthorityRow[] = [];

  // Filesystem/workspace read
  rows.push({
    group: "Filesystem",
    label: "workspace read",
    grant: scopes.filesystem.read,
  });

  // Filesystem/workspace write
  rows.push({
    group: "Filesystem",
    label: "workspace write",
    grant: scopes.filesystem.write,
  });

  // Filesystem/outside workspace
  rows.push({
    group: "Filesystem",
    label: "outside workspace",
    grant: scopes.filesystem.outsideWorkspace,
  });

  // Shell/run commands
  rows.push({
    group: "Shell",
    label: "run commands",
    grant: scopes.shell.run,
  });

  // Shell/destructive commands
  rows.push({
    group: "Shell",
    label: "destructive commands",
    grant: scopes.shell.destructive,
  });

  // Network/outbound requests
  rows.push({
    group: "Network",
    label: "outbound requests",
    grant: scopes.network.outbound,
  });

  // Packages/install
  rows.push({
    group: "Packages",
    label: "install",
    grant: scopes.packages.install,
  });

  // Extensions/install plugin
  rows.push({
    group: "Extensions",
    label: "install plugin",
    grant: scopes.extensions.install,
  });

  // Extensions/enable plugin
  rows.push({
    group: "Extensions",
    label: "enable plugin",
    grant: scopes.extensions.enable,
  });

  // Protected paths
  for (const pattern of scopes.protectedPaths) {
    rows.push({
      group: "Protected evidence",
      label: pattern,
      grant: "immutable",
    });
  }

  return rows;
}
