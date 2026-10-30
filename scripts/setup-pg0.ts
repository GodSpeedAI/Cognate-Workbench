// Install the pinned pg0 binary (checksum-verified) into .tmp/pg0 for local PostgreSQL development.
// pg0 releases publish bare binaries without signatures, so the commit pins the exact sha256 — same
// trust pattern as the repo's RealityTrace pin (pinned version + recorded digest, verified every run).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PG0_VERSION = "0.15.2";

// tag -> { platform-arch-abi: sha256 of the released binary }
const DIGESTS: Record<string, string> = {
  "linux-x86_64-gnu": "06c4678ff7b461dba8ed1f95c5e202ead3b57b70f549a22c17a94985121c0bf5",
  // Verified against the upstream v0.15.2 asset: ELF aarch64, max GLIBC_2.34 (Jetson Ubuntu 22.04 has 2.35).
  "linux-aarch64-gnu": "08bf6f5e04bc456fac2f8e76bfec5705c55f0b079f11b56efa5b1f6869e20f76",
};

function target(): string {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") return "linux-x86_64-gnu";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64-gnu";
  throw new Error(`setup-pg0: no pinned pg0 binary for ${platform}-${arch}; install pg0 manually or set COGNATE_PG0_BIN`);
}

const key = target();
const digest = DIGESTS[key];
if (!digest) throw new Error(`setup-pg0: no recorded sha256 for ${key} — verify the release binary and add its digest`);

const binDir = ".tmp/pg0";
const binPath = join(binDir, "pg0");
mkdirSync(binDir, { recursive: true });

if (existsSync(binPath)) {
  const actual = createHash("sha256").update(readFileSync(binPath)).digest("hex");
  if (actual === digest) {
    console.log(`setup-pg0: pg0 ${PG0_VERSION} already installed at ${binPath} (sha256 verified)`);
    process.exit(0);
  }
  console.log(`setup-pg0: existing binary does not match the pinned digest; re-downloading`);
  unlinkSync(binPath);
}

const url = `https://github.com/vectorize-io/pg0/releases/download/v${PG0_VERSION}/pg0-${key}`;
console.log(`setup-pg0: downloading ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`setup-pg0: download failed: ${response.status} ${response.statusText}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== digest) {
  throw new Error(`setup-pg0: sha256 mismatch for pg0 ${PG0_VERSION} (${key}): got ${actual}, want ${digest}`);
}
writeFileSync(binPath, bytes);
chmodSync(binPath, 0o755);
console.log(`setup-pg0: pg0 ${PG0_VERSION} installed at ${binPath} (sha256 verified)`);
