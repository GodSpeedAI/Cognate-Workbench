// The containment a task's proof runs under when RealityTrace verifies it. The proof runs the code the
// agent wrote, so it gets the same bubblewrap boundary as agent tools, with two differences:
// - the workspace is mounted READ-ONLY, at its own host path, so verification cannot change what it
//   judges (RealityTrace records the tree digest before it runs) and RealityTrace's host cwd exists
//   inside the namespace;
// - nothing else is mounted: no RealityTrace data, no SEA-Forge socket, no home, no network.
// It mirrors `@godspeedai/cognate-execution`'s bubblewrap world (which does not export its argv); keep
// the two in step.
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { ContainmentConfig } from "../capabilities/containedWorkspace.ts";

const PUBLIC_ROOTS = new Set(["/usr/bin", "/usr/lib", "/usr/lib64", "/bin", "/lib", "/lib64"]);
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export async function containedVerifierLauncher(config: ContainmentConfig, workspaceRoot: string): Promise<string[]> {
  const executable = await realpath(config.executablePath);
  const digest = createHash("sha256").update(await readFile(executable)).digest("hex");
  if (digest !== config.provenance.binarySha256) throw new Error("bubblewrap executable changed since operator verification");
  const workspace = await realpath(workspaceRoot);
  if (workspace === "/" || !(await stat(workspace)).isDirectory()) throw new Error("a dedicated workspace directory is required");
  if (inside(workspace, executable)) throw new Error("bubblewrap launcher must be outside the workspace");
  const mounts: string[] = [];
  for (const root of new Set(config.runtimeRoots)) {
    if (!PUBLIC_ROOTS.has(root)) throw new Error(`invalid runtime root ${root}`);
    let source: string;
    try { source = await realpath(root); } catch { continue; }
    if (inside(source, workspace) || inside(workspace, source)) throw new Error("runtime root and workspace must not overlap");
    mounts.push("--ro-bind", source, root);
  }
  if (mounts.length === 0) throw new Error("no usable runtime roots");
  const bun = config.bunExecutable ? await realpath(config.bunExecutable) : undefined;
  if (bun && inside(workspace, bun)) throw new Error("Bun executable must be outside the workspace");
  return [
    executable, "--unshare-all", "--unshare-user", "--disable-userns", "--assert-userns-disabled", "--new-session", "--die-with-parent",
    "--cap-drop", "ALL", "--clearenv", ...mounts,
    "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--dir", "/opt/cognate/bin",
    ...(bun ? ["--ro-bind", bun, "/opt/cognate/bin/bun"] : []),
    "--ro-bind", workspace, workspace,
    "--setenv", "PATH", "/opt/cognate/bin:/usr/bin:/bin", "--setenv", "HOME", "/nonexistent",
    "--",
  ];
}
