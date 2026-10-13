// Plugin catalog and lifecycle logic (T11, J-PLG-install). Pure: no React, no client, no I/O —
// unit-tested in test/workbench-plugins.test.ts.
//
// The honesty rule this module exists to enforce: a plugin is only toggleable when something real
// sits behind the switch. Three lifecycles keep that legible instead of papering over it:
//
//   core     — always-on infrastructure the application is built from (model provider, workspaces,
//              approvals, preferences, session history). Not installable, not uninstallable, and
//              never rendered as a switch that pretends otherwise.
//   tool     — a model-facing tool composed by agent presets. Always available; which presets
//              include it is the real configuration surface, so the row reports membership rather
//              than offering a per-plugin switch that would do nothing.
//   optional — genuinely installable. Registers durably, and its switch drives real runtime
//              behaviour once installed.
//
// An implementation kind of `none` marks an entry with no executable backing. Installing one
// succeeds and says so plainly; it is never presented as working.

import type { AgentPreset } from "./settings.ts";

export type PluginLifecycle = "core" | "tool" | "optional";

export type PluginImplementation =
  | { readonly kind: "tool"; readonly tool: string }
  | { readonly kind: "settings-toggle"; readonly key: string }
  | { readonly kind: "core" }
  | { readonly kind: "none"; readonly reason: string };

export interface PluginCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly lifecycle: PluginLifecycle;
  /** For `tool` plugins: which agent presets compose this tool. */
  readonly presets?: readonly AgentPreset[];
  readonly implementation: PluginImplementation;
}

/** A durable install record, folded from `plugin.installed` / `plugin.uninstalled`. */
export interface PluginRecord {
  readonly pluginId: string;
  readonly installedAt: string;
  /** The implementation kind recorded at install time, if the entry declared one. */
  readonly implementation?: string;
}

/**
 * The shipped catalog. Every entry here has a real implementation — the `none` branch exists so a
 * future catalog entry or additional `PluginSource` can declare itself inert and be reported
 * honestly, not so this list can fake one.
 */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  // -- core: always-on infrastructure --------------------------------------------------------
  { id: "model-provider", name: "Model provider", description: "OpenAI-compatible provider hot-swap backed by write-only secrets.", lifecycle: "core", implementation: { kind: "core" } },
  { id: "session-history", name: "Session history", description: "Folds prior runs' durable events into the model context each turn.", lifecycle: "core", implementation: { kind: "core" } },
  { id: "workspaces", name: "Workspaces", description: "Path-contained workspace scoping for every tool call.", lifecycle: "core", implementation: { kind: "core" } },
  { id: "approvals", name: "Approvals", description: "Policy gate plus durable continuations for privileged escalations.", lifecycle: "core", implementation: { kind: "core" } },
  { id: "preferences", name: "Preferences", description: "Durable Settings → General state, folded from events.", lifecycle: "core", implementation: { kind: "core" } },

  // -- tool: composed by agent presets --------------------------------------------------------
  { id: "tool-read", name: "File read", description: "Reads a file's contents from the session workspace.", lifecycle: "tool", presets: ["standard", "ptc"], implementation: { kind: "tool", tool: "read" } },
  { id: "tool-edit", name: "File edit", description: "Exact-string replacement with a read-before-edit guard.", lifecycle: "tool", presets: ["standard", "ptc"], implementation: { kind: "tool", tool: "edit" } },
  { id: "tool-bash", name: "Terminal", description: "Runs shell commands in the workspace as a subprocess.", lifecycle: "tool", presets: ["standard", "ptc", "minimal"], implementation: { kind: "tool", tool: "bash" } },
  { id: "tool-todo", name: "To-dos", description: "The to-do list behind the To-dos widget and plan mode.", lifecycle: "tool", presets: ["standard", "ptc"], implementation: { kind: "tool", tool: "todo_write" } },
  { id: "tool-exit-plan", name: "Plan review", description: "Presents a plan for approval and leaves plan mode on approval.", lifecycle: "tool", presets: ["standard", "ptc"], implementation: { kind: "tool", tool: "exit_plan_mode" } },
  { id: "tool-subagent", name: "Subagents", description: "Fire-and-forget delegation to durable child agent runs.", lifecycle: "tool", presets: ["standard", "ptc"], implementation: { kind: "tool", tool: "subagent" } },
  { id: "tool-run-code", name: "Run code", description: "Privileged code execution; sandbox escalations gate on human approval.", lifecycle: "tool", presets: ["ptc"], implementation: { kind: "tool", tool: "run_code" } },

  // -- optional: installable -----------------------------------------------------------------
  { id: "realitytrace", name: "RealityTrace observations", description: "Optional observation adapter delivering run events to an SXR evidence ledger.", lifecycle: "optional", implementation: { kind: "settings-toggle", key: "realitytrace" } },
];

export function catalogEntry(id: string): PluginCatalogEntry | undefined {
  return PLUGIN_CATALOG.find((p) => p.id === id);
}

/** Ids the shipped catalog declares, for the "installable" pick list. */
export function installablePluginIds(): readonly string[] {
  return PLUGIN_CATALOG.filter((p) => p.lifecycle === "optional").map((p) => p.id);
}

export type PluginStatus =
  /** Core infrastructure: always present, nothing to install. */
  | "always-on"
  /** A tool plugin: available because a preset composes it. */
  | "composes-tools"
  /** An optional plugin the operator has installed. */
  | "installed"
  /** An optional plugin not yet installed. */
  | "available"
  /** Installed, but the catalog declares no executable implementation. */
  | "inert";

export interface PluginView extends PluginCatalogEntry {
  readonly status: PluginStatus;
  /** True only when a switch would actually drive something. */
  readonly toggleable: boolean;
  /** Why the row is not toggleable, or why an installed entry is inert. Shown verbatim. */
  readonly reason?: string;
}

/** Merges the catalog with durable install records into what the panel should show. `catalog`
 *  defaults to the shipped list; the server passes the registry's merged catalog so additional
 *  `PluginSource`s appear without this module knowing about them. */
export function pluginViews(records: readonly PluginRecord[], catalog: readonly PluginCatalogEntry[] = PLUGIN_CATALOG): readonly PluginView[] {
  const installed = new Map(records.map((r) => [r.pluginId, r]));
  return catalog.map((entry) => {
    const record = installed.get(entry.id);
    if (entry.lifecycle === "core") {
      return { ...entry, status: "always-on" as const, toggleable: false, reason: "Always on. This is part of the application, not an optional add-on." };
    }
    if (entry.lifecycle === "tool") {
      const presets = entry.presets ?? [];
      return {
        ...entry,
        status: "composes-tools" as const,
        toggleable: false,
        reason: `Available in the ${presets.join(", ")} preset${presets.length === 1 ? "" : "s"}. Presets decide which tools an agent may call.`,
      };
    }
    if (entry.implementation.kind === "none") {
      return { ...entry, status: "inert" as const, toggleable: false, reason: entry.implementation.reason };
    }
    if (!record) {
      return { ...entry, status: "available" as const, toggleable: false, reason: "Not installed. Install it to use it." };
    }
    return { ...entry, status: "installed" as const, toggleable: true };
  });
}

/** The switch's live state for an optional plugin, driven by the durable settings row. */
export function optionalPluginEnabled(enabledKeys: ReadonlySet<string>, entry: PluginCatalogEntry): boolean {
  if (entry.implementation.kind !== "settings-toggle") return false;
  return enabledKeys.has(entry.implementation.key);
}

/** True when an install request should be refused, with the reason the UI shows. */
export function installRefusal(entry: PluginCatalogEntry | undefined, records: readonly PluginRecord[]): { readonly ok: false; readonly reason: string } | { readonly ok: true } {
  if (!entry) return { ok: false, reason: "That plugin is not in this deployment's catalog." };
  if (entry.lifecycle === "core") return { ok: false, reason: `${entry.name} is part of the application and cannot be installed or removed.` };
  if (records.some((r) => r.pluginId === entry.id)) return { ok: false, reason: `${entry.name} is already installed.` };
  return { ok: true };
}
