// Capability-bundles tranche T1 (§4.4): the version-directory bundle store. Payloads materialize
// ONCE per registration into `<store>/<capabilityId>/<versionHash>/` under the application data
// home — the app home is refused to contained executables, so the store is unreachable from
// payloads (§2.2). The source location is never read again for loading or integrity: loading
// verifies the directory against its recorded hash; the only path that re-reads an authoring
// source is a fresh governed registration (§4.4's source rule). Pruning fires at registration:
// retention = active + 3 versions (§4.2.3), and a version is prunable only when no activation,
// in-flight reference, or running spawn-ledger process names it — reference checks are the
// caller's contract (the prune call receives the live-referenced set).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readdir, readFile, cp, rm } from "node:fs/promises";

/** Pinned ceilings (design Verification Plan / CR-B1): enforced at registration. */
export const BUNDLE_LIMITS = {
  maxFileBytes: 512 * 1024,
  maxBundleBytes: 5 * 1024 * 1024,
  maxFiles: 200,
  retentionBeyondActive: 3,
} as const;

export interface MaterializedVersion {
  readonly capabilityId: string;
  readonly versionHash: string;
  readonly dir: string;
  readonly files: number;
  readonly totalBytes: number;
  /** Sorted `relativePath:sha256` digest lines — the integrity basis for every later load. */
  readonly manifest: readonly string[];
}

export class BundleLimitError extends Error {}

export function versionHashFor(manifest: readonly string[]): string {
  return createHash("sha256").update(manifest.join("\n")).digest("hex").slice(0, 16);
}

/** Walks `sourceDir` (bounded), enforces the ceilings, returns the sorted manifest lines. */
export async function scanBundle(sourceDir: string): Promise<{ manifest: readonly string[]; totalBytes: number; files: number }> {
  const entries: { rel: string; bytes: number }[] = [];
  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    const names = await readdir(dir, { withFileTypes: true });
    for (const name of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relPrefix ? `${relPrefix}/${name.name}` : name.name;
      if (name.isDirectory()) {
        await walk(join(dir, name.name), rel);
      } else if (name.isFile()) {
        const stat = await readFile(join(dir, name.name)).then((b) => b.byteLength);
        entries.push({ rel, bytes: stat });
      } else {
        throw new BundleLimitError(`${rel}: only regular files are ingested (symlinks and special files are refused)`);
      }
      if (entries.length > BUNDLE_LIMITS.maxFiles) throw new BundleLimitError(`bundle exceeds ${BUNDLE_LIMITS.maxFiles} files`);
    }
  };
  await walk(sourceDir, "");
  if (entries.length === 0) throw new BundleLimitError("bundle is empty");
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (totalBytes > BUNDLE_LIMITS.maxBundleBytes) throw new BundleLimitError(`bundle exceeds ${BUNDLE_LIMITS.maxBundleBytes} bytes total`);
  const manifest: string[] = [];
  for (const entry of entries) {
    const bytes = await readFile(join(sourceDir, entry.rel));
    if (bytes.byteLength > BUNDLE_LIMITS.maxFileBytes) throw new BundleLimitError(`${entry.rel} exceeds ${BUNDLE_LIMITS.maxFileBytes} bytes`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    manifest.push(`${entry.rel}:${digest}`);
  }
  return { manifest, totalBytes, files: entries.length };
}

export function bundleStoreDir(home: string): string {
  return join(home, "bundles");
}

export function versionDir(home: string, capabilityId: string, versionHash: string): string {
  return join(bundleStoreDir(home), capabilityId, versionHash);
}

/** Materializes the payload: copies the source tree into the immutable version directory and
 *  returns its identity. Registration is the only writer (§4.2.3). */
export async function materializeVersion(home: string, capabilityId: string, sourceDir: string): Promise<MaterializedVersion> {
  const scanned = await scanBundle(sourceDir);
  const versionHash = versionHashFor(scanned.manifest);
  const dir = versionDir(home, capabilityId, versionHash);
  await mkdir(dir, { recursive: true });
  // force:false + no errorOnExist: re-materializing identical bytes (crash-retry) is a no-op;
  // a DIFFERENT payload yields a different versionHash and a different directory.
  await cp(sourceDir, dir, { recursive: true, force: false, errorOnExist: false });
  return { capabilityId, versionHash, dir, files: scanned.files, totalBytes: scanned.totalBytes, manifest: scanned.manifest };
}

/** §4.4 load-time integrity: the directory must match its recorded manifest exactly. */
export async function verifyVersion(dir: string, manifest: readonly string[]): Promise<boolean> {
  for (const line of manifest) {
    const [rel, digest] = line.split(":") as [string, string];
    try {
      const bytes = await readFile(join(dir, rel));
      if (createHash("sha256").update(bytes).digest("hex") !== digest) return false;
    } catch {
      return false;
    }
  }
  const names = (await readdir(dir, { withFileTypes: true })).map((e) => e.name).sort();
  return names.length === new Set(manifest.map((l) => l.split(":")[0])).size;
}

/** Prunes beyond retention. `referenced` = versions the caller must preserve (active version +
 *  any version an activation row, in-flight counter, or running spawn-ledger process names) —
 *  the GC reference rule (owner condition 4). Never touches the active version. */
export async function pruneVersions(home: string, capabilityId: string, activeVersion: string, referenced: ReadonlySet<string>, retentionBeyondActive = BUNDLE_LIMITS.retentionBeyondActive): Promise<readonly string[]> {
  const dir = join(bundleStoreDir(home), capabilityId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const sorted = names.sort();
  const keep = new Set([activeVersion, ...referenced]);
  const candidates = sorted.filter((v) => !keep.has(v));
  const prunable = candidates.slice(0, Math.max(0, candidates.length - retentionBeyondActive));
  for (const version of prunable) {
    await rm(join(dir, version), { recursive: true, force: true });
  }
  return prunable;
}
