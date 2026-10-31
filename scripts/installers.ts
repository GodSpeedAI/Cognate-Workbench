// Platform installers built from one staged package folder (see scripts/package.ts).
//
//   Linux    cognate-workbench_<version>_<arch>.deb   system install: /usr/lib/cognate-workbench, /usr/bin link
//   macOS    cognate-workbench-<version>-<arch>.pkg   system install: /usr/local/lib, /usr/local/bin link
//            cognate-workbench-<version>-<arch>.dmg   disk image holding that .pkg and a README
//   Windows  cognate-workbench-<version>-windows-x64-setup.exe   per-user install (no administrator rights)
//
// Installers are not signed. macOS Gatekeeper and Windows SmartScreen will warn on first run; the README
// states this. Mutable state is never installed: the data home is created at first run, per user, and no
// uninstaller removes it.
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InstallerInput {
  readonly tag: string;          // linux-x64 | linux-arm64 | darwin-arm64 | darwin-x64 | windows-x64
  readonly version: string;
  readonly commit: string;
  readonly prefix: string;       // the staged folder: bin/ and share/
  readonly out: string;          // dist-package/
  readonly repo: string;
}

function run(command: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command[0]} exited with ${code}`))));
  });
}

async function writeNotice(dir: string, input: InstallerInput): Promise<void> {
  await copyFile(join(input.repo, "LICENSE"), join(dir, "LICENSE.txt"));
  await writeFile(join(dir, "NOTICE.txt"), [
    "Cognate Workbench bundles the pg0 PostgreSQL manager (https://github.com/vectorize-io/pg0), pinned and",
    "checksum-verified for this package, and the PostgreSQL server that pg0 installs on first start.",
    "Both are redistributed subject to their upstream licences; see those projects for their terms.",
    `Source commit: ${input.commit}`,
    "",
  ].join("\n"));
}

/** Linux `.deb`. The payload mirrors the tar.gz archive; a symlink in /usr/bin points at the real executable. */
export async function buildDeb(input: InstallerInput, arch: "amd64" | "arm64"): Promise<string> {
  const root = join(input.out, `deb-root-${input.tag}`);
  await rm(root, { recursive: true, force: true });
  const lib = join(root, "usr", "lib", "cognate-workbench");
  await mkdir(lib, { recursive: true });
  await cp(join(input.prefix, "bin"), join(lib, "bin"), { recursive: true });
  await cp(join(input.prefix, "share"), join(lib, "share"), { recursive: true });
  await mkdir(join(root, "usr", "bin"), { recursive: true });
  await symlink("../lib/cognate-workbench/bin/cognate-workbench", join(root, "usr", "bin", "cognate-workbench"));
  const doc = join(root, "usr", "share", "doc", "cognate-workbench");
  await mkdir(doc, { recursive: true });
  await writeNotice(doc, input);
  await mkdir(join(root, "DEBIAN"), { recursive: true });
  await writeFile(join(root, "DEBIAN", "control"), [
    "Package: cognate-workbench",
    `Version: ${input.version}`,
    "Section: devel",
    "Priority: optional",
    `Architecture: ${arch}`,
    "Maintainer: GodSpeedAI <noreply@godspeed.ai>",
    "Depends: libc6 (>= 2.34)",
    "Description: Cognate Workbench, a local capability-native agent workbench",
    " A self-contained local application: the server, its browser interface and the pinned",
    " pg0 PostgreSQL manager. Data lives in the per-user data home, never in /usr.",
    "",
  ].join("\n"));
  const file = join(input.out, `cognate-workbench_${input.version}_${arch}.deb`);
  await run(["dpkg-deb", "-Zgzip", "--build", "--root-owner-group", root, file]);
  await rm(root, { recursive: true, force: true });
  return file;
}

/** macOS `.pkg` (unsigned) and a `.dmg` that carries it. Installs to /usr/local, which needs administrator rights. */
export async function buildMacInstaller(input: InstallerInput, arch: "arm64" | "x64"): Promise<string[]> {
  const payload = join(input.out, `pkg-root-${input.tag}`);
  await rm(payload, { recursive: true, force: true });
  const lib = join(payload, "usr", "local", "lib", "cognate-workbench");
  await mkdir(lib, { recursive: true });
  await cp(join(input.prefix, "bin"), join(lib, "bin"), { recursive: true });
  await cp(join(input.prefix, "share"), join(lib, "share"), { recursive: true });
  await mkdir(join(payload, "usr", "local", "bin"), { recursive: true });
  await symlink("../lib/cognate-workbench/bin/cognate-workbench", join(payload, "usr", "local", "bin", "cognate-workbench"));
  await writeNotice(lib, input);

  const base = `cognate-workbench-${input.version}-darwin-${arch}`;
  const pkg = join(input.out, `${base}.pkg`);
  await run(["pkgbuild", "--root", payload, "--identifier", "com.godspeedai.cognate-workbench", "--version", input.version, "--install-location", "/", pkg]);
  await rm(payload, { recursive: true, force: true });

  const staging = join(input.out, `dmg-stage-${input.tag}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await copyFile(pkg, join(staging, `${base}.pkg`));
  await writeFile(join(staging, "README.txt"), [
    "Cognate Workbench",
    "",
    "Open the .pkg to install into /usr/local (administrator password required).",
    "Then run: cognate-workbench doctor, and cognate-workbench start, and open http://127.0.0.1:3180.",
    "",
    "This installer is not signed or notarised. macOS will ask you to confirm it in",
    "System Settings > Privacy & Security before it opens.",
    "",
  ].join("\n"));
  const dmg = join(input.out, `${base}.dmg`);
  // hdiutil reports "Resource busy" when the runner's disk is still held by a previous step; a short retry clears it.
  for (let attempt = 1; ; attempt++) {
    try {
      await run(["hdiutil", "create", "-volname", `Cognate Workbench ${input.version}`, "-srcfolder", staging, "-ov", "-format", "UDZO", dmg]);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
  await rm(staging, { recursive: true, force: true });
  return [pkg, dmg];
}

/** Windows per-user installer (NSIS). Installs under %LOCALAPPDATA%\Programs; uses HKCU only. */
export async function buildWindowsInstaller(input: InstallerInput): Promise<string> {
  const base = `cognate-workbench-${input.version}-windows-x64-setup.exe`;
  const script = join(input.out, `installer-${input.tag}.nsi`);
  const out = join(input.out, base);
  const prefix = input.prefix;
  const nsi = [
    "Unicode true",
    'Name "Cognate Workbench"',
    `OutFile "${out}"`,
    'InstallDir "$LOCALAPPDATA\\Programs\\CognateWorkbench"',
    "RequestExecutionLevel user",
    "SetCompressor /SOLID lzma",
    "",
    'Section "Cognate Workbench" SecMain',
    "  SetOutPath \"$INSTDIR\"",
    `  File /r "${join(prefix, "bin")}"`,
    `  File /r "${join(prefix, "share")}"`,
    `  File "${join(input.repo, "LICENSE")}"`,
    '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
    '  CreateDirectory "$SMPROGRAMS\\Cognate Workbench"',
    '  CreateShortCut "$SMPROGRAMS\\Cognate Workbench\\Start Cognate Workbench.lnk" "$INSTDIR\\bin\\cognate-workbench.exe" "start" "$INSTDIR\\bin\\cognate-workbench.exe" 0',
    '  CreateShortCut "$SMPROGRAMS\\Cognate Workbench\\Diagnose Cognate Workbench.lnk" "$INSTDIR\\bin\\cognate-workbench.exe" "doctor" "$INSTDIR\\bin\\cognate-workbench.exe" 0',
    '  CreateShortCut "$SMPROGRAMS\\Cognate Workbench\\Uninstall.lnk" "$INSTDIR\\uninstall.exe"',
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "DisplayName" "Cognate Workbench"',
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "DisplayVersion" "${input.version}"`,
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "Publisher" "GodSpeedAI"',
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "InstallLocation" "$INSTDIR"',
    '  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "UninstallString" "$INSTDIR\\uninstall.exe"',
    '  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench" "NoModify" 1',
    "SectionEnd",
    "",
    'Section "Uninstall"',
    '  Delete "$INSTDIR\\uninstall.exe"',
    '  RMDir /r "$INSTDIR"',
    '  RMDir /r "$SMPROGRAMS\\Cognate Workbench"',
    '  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CognateWorkbench"',
    "  ; The data home ($LOCALAPPDATA\\CognateWorkbench) is deliberately kept: it holds durable state.",
    "SectionEnd",
    "",
  ].join("\r\n");
  await writeFile(script, nsi);
  await run(["makensis", "-V2", script]);
  await rm(script, { force: true });
  return out;
}
