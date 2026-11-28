// The operator-approved execution profile for a configuration and spawn spec, computed without constructing a spawn port and
// without running any process (SEA-Forge #114/#116, review finding 8 and delta-3 #10). The caller measures the launcher's version
// first (`measureLauncherVersionSync`, the one place a launcher runs) and passes it in as a fact; this function only reads and hashes
// the pinned files. `scripts/contained-profile.ts` is that caller, so the digest an operator writes into SEA policy comes from the
// same code the running port uses, from a plain JSON configuration (no authorize hook).
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { buildLaunchPlan, type ContainedStdioPortConfig, type ExecutionProfile } from "./containedLaunch.ts";

export interface ProfileFacts {
  /** The pinned launcher's self-reported bubblewrap version, measured by the caller. */
  readonly launcherVersion: string;
}

export async function computeExecutionProfile(config: ContainedStdioPortConfig | Omit<ContainedStdioPortConfig, "authorize">, spec: StdioSpawnSpec, facts: ProfileFacts): Promise<{ readonly profile: ExecutionProfile; readonly digest: string }> {
  const built = await buildLaunchPlan({ config: config as ContainedStdioPortConfig, spec, ctx: { intentId: "profile", runId: "profile" }, envKey: new Uint8Array(32), launcherVersion: facts.launcherVersion });
  return { profile: built.profile, digest: built.profileDigest };
}
