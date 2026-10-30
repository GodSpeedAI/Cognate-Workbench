// Build one native Cognate Workbench distribution for a Bun compile target.
//
//   bun scripts/package.ts <bun-target> <tag>      e.g. bun-linux-arm64 linux-arm64
//
// Output (under dist-package/): a folder `cognate-workbench-<version>-<tag>/` laid out as
//   bin/cognate-workbench            the compiled server (Bun runtime included)
//   share/cognate-workbench/...      read-only resources, mirroring the checkout's paths
//   share/cognate-workbench/bin/pg0  the pinned, checksum-verified PostgreSQL manager
//   share/cognate-workbench/MANIFEST.json  sha256 of every shipped file plus provenance
// and an archive (.tar.gz, or .zip on Windows) with a SHA256SUMS file beside it.
// The sha256 pins are checked before anything is staged; a mismatch fails the build.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PG0_DIGESTS, PG0_VERSION, pg0Url } from "./pg0-pins.ts";
import { BOOT_TOKEN_PLACEHOLDER, BROWSER_ENTRY_TEMPLATE, LOCAL_OPERATOR } from "../src/server.ts";
import { stylesheetPaths } from "@godspeedai/cognate-ui-astryx/styles";

const repo = fileURLToPath(new URL("..", import.meta.url));
const [bunTarget, tag] = process.argv.slice(2);
if (!bunTarget || !tag) throw new Error("usage: bun scripts/package.ts <bun-target> <tag>");

// Bun compile target -> pg0 asset key and the napi binding the npm package ships for that platform.
const PLATFORMS: Record<string, { pg0: string; binding: string; exeSuffix: string }> = {
  "bun-linux-x64": { pg0: "linux-x86_64-gnu", binding: "linux-x64-gnu", exeSuffix: "" },
  "bun-linux-arm64": { pg0: "linux-aarch64-gnu", binding: "linux-arm64-gnu", exeSuffix: "" },
  "bun-darwin-arm64": { pg0: "darwin-aarch64", binding: "darwin-arm64", exeSuffix: "" },
  "bun-darwin-x64": { pg0: "darwin-x86_64", binding: "darwin-x64", exeSuffix: "" },
  "bun-windows-x64": { pg0: "windows-x86_64.exe", binding: "win32-x64-msvc", exeSuffix: ".exe" },
};
const platform = PLATFORMS[bunTarget];
if (!platform) throw new Error(`package: unsupported target ${bunTarget}`);
const win = bunTarget.includes("windows");
const pg0Name = win ? "pg0.exe" : "pg0";

const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8")) as { version: string };
const folder = `cognate-workbench-${pkg.version}-${tag}`;
const out = join(repo, "dist-package");
const prefix = join(out, folder);
const share = join(prefix, "share", "cognate-workbench");
await rm(prefix, { recursive: true, force: true });
await mkdir(join(prefix, "bin"), { recursive: true });
await mkdir(join(share, "bin"), { recursive: true });

async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function bundle(entry: string): Promise<string> {
  const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true });
  if (!build.success) throw new Error(`package: bundling ${entry} failed: ${build.logs.map(String).join("; ")}`);
  return build.outputs[0]!.text();
}

// 1. Web bundles. The desktop bundle keeps the boot-token placeholder; the server substitutes it at boot.
const generated = join(repo, ".generated");
await mkdir(generated, { recursive: true });
const entryPath = join(generated, "entry.tsx");
await writeFile(entryPath, BROWSER_ENTRY_TEMPLATE({ tenant: LOCAL_OPERATOR.tenant, actorId: LOCAL_OPERATOR.actor.id }, BOOT_TOKEN_PLACEHOLDER));
const web = join(share, "dist", "web");
await mkdir(web, { recursive: true });
await writeFile(join(web, "app.js"), await bundle(entryPath));
await writeFile(join(web, "phone.js"), await bundle(join(repo, "src/ui/mobile/entry.tsx")));

// 2. Stylesheets: Astryx comes from its SDK package, the rest from the checkout.
const [astryx, theme] = stylesheetPaths();
await copyInto(astryx!, join(web, "astryx.css"));
await copyInto(theme!, join(web, "theme.css"));
const cssFiles = [
  "src/ui/app.css", "src/ui/mobile/mobile.css", "src/ui/experts/experts.css",
  ...["base", "contract", "tasks", "review", "skills", "workflow", "automation", "cockpit"].map((n) => `src/ui/workbench/${n}.css`),
];
for (const f of cssFiles) await copyInto(join(repo, f), join(share, f));

// 3. Semantic model (read at boot; its digest is the canonical identity the server reports).
await copyInto(join(repo, ".sea/interaction/interaction-model.sea"), join(share, ".sea/interaction/interaction-model.sea"));

// 4. Compiled executable.
const exe = join(prefix, "bin", `cognate-workbench${platform.exeSuffix}`);
const compile = Bun.spawn([process.execPath, "build", "--compile", "--target", bunTarget, join(repo, "src/server.ts"), "--outfile", exe], { cwd: repo, stdout: "inherit", stderr: "inherit" });
if ((await compile.exited) !== 0) throw new Error(`package: bun build --compile failed for ${bunTarget}`);

// 5. pg0, fetched from the pinned release and verified before it is staged.
const pg0Digest = PG0_DIGESTS[platform.pg0];
if (!pg0Digest) throw new Error(`package: no pinned pg0 digest for ${platform.pg0}`);
const pg0Response = await fetch(pg0Url(platform.pg0));
if (!pg0Response.ok) throw new Error(`package: pg0 download failed: ${pg0Response.status}`);
const pg0Bytes = Buffer.from(await pg0Response.arrayBuffer());
const pg0Actual = createHash("sha256").update(pg0Bytes).digest("hex");
if (pg0Actual !== pg0Digest) throw new Error(`package: pg0 sha256 mismatch for ${platform.pg0}: got ${pg0Actual}`);
await writeFile(join(share, "bin", pg0Name), pg0Bytes);
await chmod(join(share, "bin", pg0Name), 0o755);

// 6. Manifest: every shipped file with its sha256, plus the provenance needed to audit the package.
const files: Array<{ path: string; sha256: string; bytes: number }> = [];
async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (!full.endsWith("MANIFEST.json")) {
      const bytes = await readFile(full);
      files.push({ path: relative(prefix, full), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: (await stat(full)).size });
    }
  }
}
await walk(prefix);
const commit = (await new Response(Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" }).stdout).text()).trim();
const manifest = {
  product: "cognate-workbench",
  version: pkg.version,
  tag,
  bunTarget,
  commit,
  pg0: { version: PG0_VERSION, asset: `pg0-${platform.pg0}`, sha256: pg0Digest },
  domainforgeBinding: platform.binding,
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
};
await writeFile(join(share, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

// 7. Archive and checksums.
const archive = win ? `${folder}.zip` : `${folder}.tar.gz`;
const tarArgs = win ? ["tar", "-a", "-c", "-f", join(out, archive), "-C", out, folder] : ["tar", "-czf", join(out, archive), "-C", out, folder];
if ((await Bun.spawn(tarArgs, { stdout: "inherit", stderr: "inherit" }).exited) !== 0) throw new Error(`package: archive failed`);
const archiveBytes = await readFile(join(out, archive));
const archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
await writeFile(join(out, `${archive}.sha256`), `${archiveDigest}  ${archive}\n`);
console.log(`package: ${archive} sha256=${archiveDigest} (${files.length} files, pg0 ${PG0_VERSION}, commit ${commit.slice(0, 12)})`);
if (!existsSync(exe)) throw new Error("package: executable missing after compile");
