// Execution posture: where agent effects may run on this host.
//
// `contained` (the default) refuses every effect (process launch, file write) in a world of kind
// `local` — the operator's own account with no OS isolation. Effects run in contained (Linux
// bubblewrap) workspaces, or in remote worlds the operator connected explicitly. Reading and
// listing stay available so the operator can still browse local directories.
//
// `uncontained-local` is the explicit operator opt-in to run agent commands and writes directly on
// this host as this user. Path checks are not a sandbox (README "Known limits"): in that posture an
// agent can do anything the operator's account can do, including writing evidence about its own work.
//
// The guard lives at the registry's `get`, so it covers every provider of kind `local`: the base
// world, cognitive directory-copy forks, and anything registered later. No caller can route around it.
import type { ExecutionWorldProvider, ExecutionWorldRegistry } from "@godspeedai/cognate-execution";

export type ExecutionPosture = "contained" | "uncontained-local";

export const EXECUTION_POSTURE_ENV = "COGNATE_EXECUTION_POSTURE";

/** Unset means `contained`. Anything else but the two names is a startup error, never a guess. */
export function parseExecutionPosture(raw: string | undefined): ExecutionPosture {
  if (raw === undefined || raw === "") return "contained";
  if (raw === "contained" || raw === "uncontained-local") return raw;
  throw new Error(`${EXECUTION_POSTURE_ENV} must be 'contained' (default) or 'uncontained-local'`);
}

export class UncontainedEffectRefusedError extends Error {
  override readonly name = "UncontainedEffectRefusedError";
  constructor(readonly worldId: string, readonly operation: "process.exec" | "filesystem.writeText") {
    super(
      `Refused ${operation} in uncontained world "${worldId}": this Workbench runs agent effects only in contained workspaces. ` +
        `Select a Linux-contained workspace (configure ${"COGNATE_LINUX_CONTAINMENT_CONFIG"}; see docs/linux-contained-workspaces.md, ` +
        `or draft one with \`bun scripts/containment-config.ts\`), or restart with ${EXECUTION_POSTURE_ENV}=uncontained-local ` +
        `to let agents run commands and write files directly on this host as you.`,
    );
  }
}

const UNCONTAINED_KINDS = new Set(["local"]);

export function isUncontained(provider: Pick<ExecutionWorldProvider, "kind">): boolean {
  return UNCONTAINED_KINDS.has(provider.kind);
}

function refuseEffects(provider: ExecutionWorldProvider): ExecutionWorldProvider {
  return {
    worldId: provider.worldId,
    kind: provider.kind,
    metadata: { ...provider.metadata, executionPosture: "contained", effects: "refused" },
    fileSystem: {
      resolve: (root, path) => provider.fileSystem.resolve(root, path),
      stat: (path) => provider.fileSystem.stat(path),
      exists: (path) => provider.fileSystem.exists(path),
      readText: (path) => provider.fileSystem.readText(path),
      list: (path) => provider.fileSystem.list(path),
      version: (path) => provider.fileSystem.version(path),
      writeText: async () => { throw new UncontainedEffectRefusedError(provider.worldId, "filesystem.writeText"); },
    },
    process: {
      exec: async () => { throw new UncontainedEffectRefusedError(provider.worldId, "process.exec"); },
    },
    dispose: () => provider.dispose(),
  };
}

/** Wrap a registry so `get` returns effect-refusing views of uncontained worlds under `contained`. */
export function postureRegistry(registry: ExecutionWorldRegistry, posture: ExecutionPosture): ExecutionWorldRegistry {
  if (posture === "uncontained-local") return registry;
  return {
    register: (provider) => registry.register(provider),
    unregister: (worldId) => registry.unregister(worldId),
    has: (worldId) => registry.has(worldId),
    get(worldId) {
      const provider = registry.get(worldId);
      return isUncontained(provider) ? refuseEffects(provider) : provider;
    },
    list: () => registry.list(),
    dispose: () => registry.dispose(),
  };
}
