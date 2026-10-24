#!/usr/bin/env bun
// Draft a Linux containment config (COGNATE_LINUX_CONTAINMENT_CONFIG) for this host.
//
//   bun scripts/containment-config.ts [--bwrap /path/to/bwrap] [--source "<provenance>"] [--out containment.json] [--attest]
//
// It measures what a script can measure: the binary's path, SHA-256, reported version and package
// origin, and whether it carries the fix for CVE-2026-87766 (bubblewrap >= 0.12.0, or a distro
// build whose changelog applies the fix and has not dropped it). It never asserts trust on its own:
// `operatorVerified` is written only with --attest, which records that you reviewed this binary.
// A binary known to be unpatched is refused outright.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { validateContainmentConfig, type ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const attest = args.includes("--attest");
const out = opt("--out");

function sh(argv: string[]): string | undefined {
  const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : undefined;
}

const candidate = opt("--bwrap") ?? Bun.which("bwrap");
if (!candidate || !existsSync(candidate)) {
  console.error("containment-config: no bwrap found. Install bubblewrap >= 0.12.0 or pass --bwrap <path>.");
  process.exit(2);
}
const executablePath = realpathSync(candidate);
// Recorded exactly as the binary reports itself (e.g. "bubblewrap 0.12.0").
const version = sh([executablePath, "--version"]) ?? "";
const numericVersion = version.replace(/^bubblewrap\s+/, "");
const binarySha256 = createHash("sha256").update(readFileSync(executablePath)).digest("hex");
const pkg = sh(["dpkg-query", "-S", executablePath])?.split(":")[0];
const pkgVersion = pkg ? sh(["dpkg-query", "-W", "-f=${Version}", pkg]) : undefined;
// --source records where the binary came from (e.g. the upstream tag and commit it was built from);
// only the operator knows that, so it is never inferred for a non-package binary.
const source = opt("--source") ?? (pkg ? `distro package ${pkg} ${pkgVersion}` : `operator-supplied bubblewrap v${numericVersion} at ${executablePath}`);

function atLeast(v: string, min: [number, number, number]): boolean {
  const p = v.split(/[.-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) { const a = p[i] ?? 0; if (Number.isNaN(a)) return false; if (a !== min[i]) return a > min[i]!; }
  return true;
}

/** The newest changelog line naming the CVE decides: an applied patch counts, a "Drop" does not. */
function distroPatchState(): "patched" | "dropped" | "absent" {
  if (!pkg) return "absent";
  const log = sh(["sh", "-c", `zcat /usr/share/doc/${pkg}/changelog.Debian.gz 2>/dev/null`]) ?? "";
  const line = log.split("\n").find((l) => l.includes("CVE-2026-87766"));
  if (!line) return "absent";
  return /\bdrop/i.test(line) ? "dropped" : "patched";
}

const upstreamFixed = atLeast(numericVersion, [0, 12, 0]);
const distro = distroPatchState();
const patched = upstreamFixed || distro === "patched";
console.log(`bwrap:   ${executablePath}`);
console.log(`version: ${version}  sha256: ${binarySha256}`);
console.log(`source:  ${source}`);
console.log(`CVE-2026-87766: ${upstreamFixed ? "fixed upstream (>= 0.12.0)" : distro === "patched" ? "patched by the distro package" : distro === "dropped" ? "UNPATCHED — the distro dropped its fix" : "UNPATCHED — version < 0.12.0 and no distro patch"}`);
if (!patched) {
  console.error("\ncontainment-config: refusing to draft a config for a binary without the CVE-2026-87766 fix.");
  console.error("Build or install bubblewrap >= 0.12.0 (see docs/bubblewrap-fixture-provenance.md) and pass --bwrap <path>.");
  process.exit(2);
}

// The documented minimal set (docs/linux-contained-workspaces.md): expose no more of the host than
// a typical merged-/usr Linux needs. Add /usr/lib64 or /bin by hand only if a toolchain needs them.
const MINIMAL = ["/usr/bin", "/usr/lib", "/lib", "/lib64"] as const;
const runtimeRoots = MINIMAL.filter((r) => existsSync(r) && statSync(r).isDirectory());
const draft = {
  executablePath,
  provenance: { operatorVerified: attest, binarySha256, version, source, patchedCve202687766: true },
  runtimeRoots,
  bunExecutable: realpathSync(process.execPath),
  timeoutMs: 30_000,
  maxOutputBytes: 1_048_576,
};

if (!attest) {
  console.log("\nDraft (not written — review the binary above, then rerun with --attest --out <file>):");
  console.log(JSON.stringify(draft, null, 2));
  process.exit(0);
}
const config: ContainmentConfig = validateContainmentConfig(draft as unknown as ContainmentConfig);
const text = JSON.stringify(config, null, 2) + "\n";
if (out) {
  writeFileSync(out, text);
  console.log(`\nwrote ${out}\nstart with: COGNATE_LINUX_CONTAINMENT_CONFIG=${realpathSync(out)} just dev`);
} else {
  console.log(text);
}
