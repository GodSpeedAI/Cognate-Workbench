// The plugin registry (T11, J-PLG-install): resolves the plugin catalog across one or more
// sources and performs the *activation* an install implies.
//
// Extensibility is the point. The registry holds a list of `PluginSource`s; the shipped catalog is
// one source. Adding a marketplace, a workspace-local plugin directory, or a vendored bundle later
// means registering another source, not replacing the registry or the catalog module.
//
// Activation is verification, not theatre. A `tool` entry is only activated if the tool it names
// really exists in `TOOL_DEFS` — a catalog entry that lies about a tool installs inert and says so,
// rather than reporting success for something that would fail at the next model call. A
// `settings-toggle` entry's runtime behaviour is the settings projection plus whatever gate reads
// that key, both of which already exist; activation confirms the key is recognised.
//
// No downloaded code is ever evaluated. A source supplies *descriptions*; only implementations this
// application already contains can be activated, which is the trust boundary.

import { TOOL_DEFS } from "../agents/agentCoding.ts";
import { TOGGLEABLE_PLUGINS } from "../settings.ts";
import { PLUGIN_CATALOG, type PluginCatalogEntry, type PluginImplementation } from "../plugins.ts";

/** A source of plugin descriptions. Implement this to add a catalog without touching the registry. */
export interface PluginSource {
  readonly id: string;
  list(): readonly PluginCatalogEntry[];
}

/** The shipped catalog. */
export class BuiltinPluginSource implements PluginSource {
  readonly id = "builtin";
  list(): readonly PluginCatalogEntry[] {
    return PLUGIN_CATALOG;
  }
}

export type ActivationOutcome =
  | { readonly activated: true; readonly via: string }
  | { readonly activated: false; readonly reason: string };

/** What an install actually did. The UI shows `reason` verbatim when `activated` is false. */
export interface InstallOutcome {
  readonly pluginId: string;
  readonly activated: boolean;
  readonly reason: string;
}

export class PluginRegistry {
  #sources: PluginSource[];

  constructor(sources: readonly PluginSource[] = [new BuiltinPluginSource()]) {
    this.#sources = [...sources];
  }

  /** Registers an additional catalog source. Later sources never override an earlier id. */
  addSource(source: PluginSource): void {
    if (this.#sources.some((s) => s.id === source.id)) {
      throw new Error(`plugin registry: source ${source.id} is already registered`);
    }
    this.#sources.push(source);
  }

  get sourceIds(): readonly string[] {
    return this.#sources.map((s) => s.id);
  }

  /** The merged catalog, first-source-wins on duplicate ids. */
  catalog(): readonly PluginCatalogEntry[] {
    const seen = new Map<string, PluginCatalogEntry>();
    for (const source of this.#sources) {
      for (const entry of source.list()) {
        if (!seen.has(entry.id)) seen.set(entry.id, entry);
      }
    }
    return [...seen.values()];
  }

  entry(id: string): PluginCatalogEntry | undefined {
    return this.catalog().find((e) => e.id === id);
  }

  /**
   * Performs the activation an install implies, by verifying the declared implementation really
   * exists in this build. Deliberately does not execute anything: it proves the claim, and returns
   * the specific reason when the claim cannot be proven.
   */
  activate(entry: PluginCatalogEntry): ActivationOutcome {
    const outcome = verifyImplementation(entry.implementation);
    if (!outcome.activated) return outcome;
    // Nothing to mount: `tool` implementations are already in TOOL_DEFS and composed by presets;
    // `settings-toggle` behaviour is the settings projection plus the gate that reads the key
    // (`wireObservations`' drain gate for realitytrace). Confirming the claim is the activation.
    return { activated: true, via: outcome.via };
  }

  /** Resolves what an install of `pluginId` should record. Pure with respect to durable state. */
  planInstall(pluginId: string, installedIds: readonly string[]): InstallOutcome | { readonly refused: string } {
    const entry = this.entry(pluginId);
    if (!entry) return { refused: `${pluginId} is not in this deployment's catalog.` };
    if (entry.lifecycle === "core") {
      return { refused: `${entry.name} is part of the application and cannot be installed or removed.` };
    }
    if (installedIds.includes(entry.id)) return { refused: `${entry.name} is already installed.` };
    const activation = this.activate(entry);
    return {
      pluginId: entry.id,
      activated: activation.activated,
      reason: activation.activated ? `Installed and active. ${activation.via}` : activation.reason,
    };
  }
}

/** Proves a declared implementation exists in this build. */
export function verifyImplementation(implementation: PluginImplementation): ActivationOutcome {
  switch (implementation.kind) {
    case "core":
      return { activated: true, via: "Always-on application infrastructure." };
    case "settings-toggle":
      if (!TOGGLEABLE_PLUGINS.includes(implementation.key)) {
        return { activated: false, reason: `This build does not recognise the "${implementation.key}" plugin key, so installing it would do nothing.` };
      }
      return { activated: true, via: `Its enable switch writes the durable "${implementation.key}" plugin state.` };
    case "tool": {
      const tool = TOOL_DEFS.find((t) => t.name === implementation.tool);
      if (!tool) {
        return { activated: false, reason: `This build has no "${implementation.tool}" tool, so installing it would do nothing.` };
      }
      return { activated: true, via: `The "${implementation.tool}" tool is composed into agent presets.` };
    }
    case "none":
      return { activated: false, reason: implementation.reason };
    default: {
      const exhaustive: never = implementation;
      return { activated: false, reason: `Unknown plugin implementation: ${JSON.stringify(exhaustive)}` };
    }
  }
}
