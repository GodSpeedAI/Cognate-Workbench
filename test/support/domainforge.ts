// The DomainForge CLI the live SEA-Forge tests use to compute the world ref. The ref digest includes the
// producer version, so the CLI must be the same domainforge-core version the server is built on, or the
// server answers `cep_world_refused: unknown world`. The lockstep version matches verify.yml and
// docs/sea-forge-authority.md; `just setup-domainforge` installs it into .tmp/domainforge.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DOMAINFORGE_LOCKSTEP = "0.21.2";

const PINNED = join(import.meta.dir, "../../.tmp/domainforge/bin/domainforge");

/** WB_DOMAINFORGE_BIN, else the pinned checkout copy, else `domainforge` on PATH. */
export const DOMAINFORGE_BIN = process.env.WB_DOMAINFORGE_BIN ?? (existsSync(PINNED) ? PINNED : "domainforge");

/** Fails fast with the fix spelled out when the CLI is not at the lockstep version. */
export function assertDomainforgeLockstep(bin: string = DOMAINFORGE_BIN): void {
  let version: string;
  try {
    const out = Bun.spawnSync([bin, "--version"]);
    version = out.exitCode === 0 ? out.stdout.toString().trim() : `unavailable (exit ${out.exitCode})`;
  } catch (error) {
    version = `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
  if (version !== `domainforge ${DOMAINFORGE_LOCKSTEP}`) {
    throw new Error(
      `DomainForge CLI ${bin} reports "${version}", but the live SEA-Forge tests need domainforge ${DOMAINFORGE_LOCKSTEP} ` +
      `(the world ref includes the producer version, so any other version makes the server refuse with "unknown world"). ` +
      `Run \`just setup-domainforge\` or set WB_DOMAINFORGE_BIN to a ${DOMAINFORGE_LOCKSTEP} CLI.`,
    );
  }
}
