// Capability-bundles tranche T2 (§4.4/§9.3, CUJ 8): the directory source over provider-backed
// semantics. A bundle directory on ANY execution world (local, SSH, WSL) is read through that
// world's `FileSystemPort` — never a host filesystem read or watch of the remote location — into
// a local staging directory, and from there the SAME hashing, ceiling checks and version-directory
// materialization run as for a local install. Ingestion therefore behaves identically across
// worlds by construction: the staged tree is byte-for-byte the source tree, so the content hash
// (and so the version identity) matches a local-world install of the same bytes.
//
// The source rule (§4.4): this module is only ever invoked by a fresh governed registration. The
// staging directory is deleted when registration finishes; nothing re-reads the source afterwards.
//
// Bounds mirror the registration ceilings (<= 200 files, <= 512 KiB/file, <= 5 MiB/bundle) and are
// enforced here BEFORE reading content over the provider (stat sizes first), so a hostile remote
// directory cannot make the host transfer unbounded bytes. Only regular files are ingested; a
// symlink or special entry refuses, as in the local scan. Bundle payloads are text documents and
// data (skill markdown, schemas): content moves as UTF-8 through `readText`.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecutionWorldProvider } from "@godspeedai/cognate-execution";
import { BUNDLE_LIMITS, BundleLimitError } from "../capabilities/bundleStore.ts";
import type { PluginSource } from "../components/pluginRegistry.ts";
import type { PluginCatalogEntry } from "../plugins.ts";

type WorldFs = Pick<ExecutionWorldProvider, "fileSystem" | "worldId" | "kind">;

export interface IngestedSource {
  /** Local staging directory holding the source tree (hand to `materializeVersion`). */
  readonly dir: string;
  readonly files: number;
  readonly totalBytes: number;
  readonly worldId: string;
  readonly worldKind: string;
  /** Deletes the staging directory; idempotent. Registration calls this in `finally`. */
  readonly cleanup: () => Promise<void>;
}

const safeRelative = (rel: string): boolean => rel.length > 0 && !rel.startsWith("/") && !rel.split("/").some((part) => part === ".." || part === "." || part === "" || part.includes("\0"));

/** Reads `root` on `world` through its filesystem port and stages it under `stagingParent`. */
export async function ingestDirectorySource(world: WorldFs, root: string, stagingParent: string): Promise<IngestedSource> {
  const fsPort = world.fileSystem;
  const rootStat = await fsPort.stat(root);
  if (!rootStat || rootStat.kind !== "directory") throw new BundleLimitError(`source ${root} on world ${world.worldId} is not a directory`);

  const found: { rel: string; abs: string; size: number }[] = [];
  const walk = async (absDir: string, relPrefix: string): Promise<void> => {
    const entries = [...(await fsPort.list(absDir))].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (!safeRelative(rel)) throw new BundleLimitError(`${rel}: unsafe path in source directory`);
      const abs = fsPort.resolve(root, rel);
      if (entry.kind === "directory") {
        await walk(abs, rel);
      } else if (entry.kind === "file") {
        const stat = await fsPort.stat(abs);
        if (!stat || stat.kind !== "file") throw new BundleLimitError(`${rel}: only regular files are ingested (symlinks and special files are refused)`);
        found.push({ rel, abs, size: stat.size });
      } else {
        throw new BundleLimitError(`${rel}: only regular files are ingested (symlinks and special files are refused)`);
      }
      if (found.length > BUNDLE_LIMITS.maxFiles) throw new BundleLimitError(`bundle exceeds ${BUNDLE_LIMITS.maxFiles} files`);
    }
  };
  await walk(root, "");
  if (found.length === 0) throw new BundleLimitError("bundle is empty");
  let total = 0;
  for (const file of found) {
    if (file.size > BUNDLE_LIMITS.maxFileBytes) throw new BundleLimitError(`${file.rel} exceeds ${BUNDLE_LIMITS.maxFileBytes} bytes`);
    total += file.size;
  }
  if (total > BUNDLE_LIMITS.maxBundleBytes) throw new BundleLimitError(`bundle exceeds ${BUNDLE_LIMITS.maxBundleBytes} bytes total`);

  await mkdir(stagingParent, { recursive: true });
  const dir = await mkdtemp(join(stagingParent, `ingest-${randomUUID().slice(0, 8)}-`));
  const cleanup = async (): Promise<void> => { await rm(dir, { recursive: true, force: true }); };
  try {
    for (const file of found) {
      const text = await fsPort.readText(file.abs);
      const target = join(dir, file.rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text, "utf8");
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { dir, files: found.length, totalBytes: total, worldId: world.worldId, worldKind: world.kind, cleanup };
}

/** `PluginSource` bridge (§9.3): registered bundles surface through the legacy plugin-registry
 *  contract as inert catalog rows — honest `none` implementations naming the capability-bundle
 *  system, so the legacy surface can LIST them but never pretends to toggle them. */
export class BundleBackedPluginSource implements PluginSource {
  readonly id = "capability-bundles";
  constructor(private readonly rows: () => readonly { readonly capabilityId: string; readonly name?: string; readonly purpose?: string; readonly uninstalled?: boolean }[]) {}
  list(): readonly PluginCatalogEntry[] {
    return this.rows().filter((row) => !row.uninstalled).map((row) => ({
      id: row.capabilityId,
      name: row.name ?? row.capabilityId,
      description: row.purpose ?? "Capability bundle",
      lifecycle: "optional" as const,
      implementation: { kind: "none" as const, reason: "managed by the capability-bundle runtime (capability.bundle.*), not the legacy plugin toggle" },
    }));
  }
}
