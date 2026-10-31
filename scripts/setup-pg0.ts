// Install the pinned pg0 binary (checksum-verified) into .tmp/pg0 for local PostgreSQL development.
// Pins live in scripts/pg0-pins.ts, shared with the native packager.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PG0_DIGESTS, PG0_VERSION, pg0Url } from "./pg0-pins.ts";

function target(): string {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") return "linux-x86_64-gnu";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64-gnu";
  throw new Error(`setup-pg0: no pinned pg0 binary for ${platform}-${arch}; install pg0 manually or set COGNATE_PG0_BIN`);
}

const key = target();
const digest = PG0_DIGESTS[key];
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

const url = pg0Url(key);
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
