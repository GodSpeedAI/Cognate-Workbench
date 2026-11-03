// Stage the Tauri desktop shell's sidecar backend and resources for one target.
//
//   bun scripts/tauri-sidecar.ts [bun-target]     default: this host's target
//
// Writes (both gitignored, release-only):
//   src-tauri/binaries/cognate-workbench-<rust-triple>[.exe]  the compiled server (bundle.externalBin)
//   src-tauri/resources/cognate-workbench/...                 the resource tree (COGNATE_RESOURCE_DIR)
//
// The resource tree is the same staging the standalone package ships under
// share/cognate-workbench/ — including MANIFEST.json, which the packaged server requires to
// verify the bundled pg0 binary before it will start one.
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, stageShareTree, writeManifest } from "./package.ts";

const repo = fileURLToPath(new URL("..", import.meta.url));

// Bun compile target -> Rust target triple, which Tauri's externalBin convention appends to the sidecar name.
const TRIPLES: Record<string, string> = {
  "bun-linux-x64": "x86_64-unknown-linux-gnu",
  "bun-linux-arm64": "aarch64-unknown-linux-gnu",
  "bun-darwin-arm64": "aarch64-apple-darwin",
  "bun-darwin-x64": "x86_64-apple-darwin",
  "bun-windows-x64": "x86_64-pc-windows-msvc",
};

function hostBunTarget(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "linux") return `bun-linux-${arch}`;
  if (process.platform === "darwin") return `bun-darwin-${arch}`;
  if (process.platform === "win32") return "bun-windows-x64";
  throw new Error(`tauri-sidecar: unsupported host platform ${process.platform}`);
}

const [targetArg] = process.argv.slice(2);
const bunTarget = targetArg ?? hostBunTarget();
const rustTriple = TRIPLES[bunTarget];
if (!rustTriple) throw new Error(`tauri-sidecar: no Rust triple known for ${bunTarget}`);
const platform = PLATFORMS[bunTarget];
if (!platform) throw new Error(`tauri-sidecar: unsupported target ${bunTarget}`);
const exeSuffix = platform.exeSuffix;

// The DomainForge npm package ships only the linux-x64 binding; other targets need it built first
// (see .github/workflows/package.yml). Without it the exe compiles but crashes at startup.
const bindingFile = join(repo, "node_modules", "@godspeedai", "domainforge", `domainforge-core.${platform.binding}.node`);
if (!existsSync(bindingFile)) {
  throw new Error(`tauri-sidecar: missing DomainForge binding ${bindingFile}; build it for ${platform.binding} first (see .github/workflows/package.yml)`);
}

const binaries = join(repo, "src-tauri", "binaries");
const resources = join(repo, "src-tauri", "resources", "cognate-workbench");
await rm(binaries, { recursive: true, force: true });
await rm(join(repo, "src-tauri", "resources"), { recursive: true, force: true });
await mkdir(binaries, { recursive: true });

// 1. Resource tree (web bundles, stylesheets, .sea model, pinned pg0) — identical to share/cognate-workbench.
const pg0 = await stageShareTree(repo, resources, bunTarget);

// 2. Compiled server sidecar under Tauri's externalBin name.
const exe = join(binaries, `cognate-workbench-${rustTriple}${exeSuffix}`);
const compile = Bun.spawn(
  [process.execPath, "build", "--compile", "--target", bunTarget, join(repo, "src/cli.ts"), "--outfile", exe],
  { cwd: repo, stdout: "inherit", stderr: "inherit" },
);
if ((await compile.exited) !== 0) throw new Error(`tauri-sidecar: bun build --compile failed for ${bunTarget}`);
if (!existsSync(exe)) throw new Error("tauri-sidecar: executable missing after compile");

// 3. Manifest at the resource root: verifyPg0 refuses to start the bundled pg0 without it.
const commit = (await new Response(Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: repo, stdout: "pipe" }).stdout).text()).trim();
const pkg = JSON.parse(await Bun.file(join(repo, "package.json")).text()) as { version: string };
await writeManifest(resources, {
  version: pkg.version,
  tag: `tauri-${bunTarget.replace("bun-", "")}`,
  bunTarget,
  commit,
  pg0Asset: pg0.pg0Asset,
  pg0Digest: pg0.pg0Digest,
  binding: platform.binding,
});

console.log(`tauri-sidecar: staged ${exe.split("/").pop()} + resources (pg0 ${pg0.pg0Asset}, commit ${commit.slice(0, 12)})`);
