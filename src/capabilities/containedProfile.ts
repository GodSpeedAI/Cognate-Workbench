// The operator-approved execution profile for a configuration and spawn spec, computed without constructing a spawn port or
// launching anything (SEA-Forge #114/#116, review finding 8). `scripts/contained-profile.ts` uses it, so the digest an operator
// writes into SEA policy comes from the same code the running port uses, from a plain JSON configuration (no authorize hook).
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { buildLaunchPlan, measureLauncherVersionSync, type ContainedStdioPortConfig, type ExecutionProfile } from "./containedLaunch.ts";

export async function computeExecutionProfile(config: ContainedStdioPortConfig | Omit<ContainedStdioPortConfig, "authorize">, spec: StdioSpawnSpec): Promise<{ readonly profile: ExecutionProfile; readonly digest: string }> {
  const full = config as ContainedStdioPortConfig;
  const built = await buildLaunchPlan({ config: full, spec, ctx: { intentId: "profile", runId: "profile" }, envKey: new Uint8Array(32), launcherVersion: measureLauncherVersionSync(full) });
  return { profile: built.profile, digest: built.profileDigest };
}
