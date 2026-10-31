// Read-only application resources and the per-user data home.
// Development reads resources from the checkout. A packaged build (a `bun build --compile` executable)
// reads them from the install's share directory beside the executable: `<prefix>/bin/cognate-workbench`
// and `<prefix>/share/cognate-workbench/`. `COGNATE_RESOURCE_DIR` overrides both. The resource tree mirrors
// the checkout's paths, so callers pass the same relative path in either mode.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Compiled module URLs live in Bun's virtual filesystem: `$bunfs` on POSIX, `B:/~BUN/` on Windows.
export const packaged = import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN");

const checkoutRoot = fileURLToPath(new URL("..", import.meta.url));

export function resourcePath(...parts: string[]): string {
  const root = process.env.COGNATE_RESOURCE_DIR
    ?? (packaged ? join(dirname(process.execPath), "..", "share", "cognate-workbench") : checkoutRoot);
  return join(root, ...parts);
}

// Packaged installs keep mutable state out of the install prefix, per platform convention.
// Development keeps its historical `.data` directory in the checkout.
export function defaultHome(): string {
  if (!packaged) return join(checkoutRoot, ".data");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "CognateWorkbench");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "CognateWorkbench");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "cognate-workbench");
}
