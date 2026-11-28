#!/usr/bin/env bun
// Compute the execution profile digest for a contained StdioSpawnPort configuration (SEA-Forge #114/#116) without
// launching anything, so an operator can put the digest into SEA policy.
//
//   bun scripts/contained-profile.ts --config port-config.json --spec spawn-spec.json [--json]
//
// port-config.json is a ContainedStdioPortConfig (launcher and executables with sha256 pins, workspaceRoot,
// writableRoots, optional hostSocket/ceilings/runtimeRoots, and envAllowlist with its envValuePatterns); spawn-spec.json is the StdioSpawnSpec the
// provider will use (argv, cwd inside the workspace, env, restrictions). The digest is identical across runs,
// workspaces, port instances and host restarts for the same configuration. It reads and hashes the pinned files, so run
// it on the host that will launch (the launcher is executed once, with --version, after its path checks).
import { readFileSync } from "node:fs";
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import type { ContainedStdioPortConfig } from "../src/capabilities/containedLaunch.ts";
import { LaunchGate } from "../src/capabilities/launchGate.ts";
import { computeExecutionProfile } from "../src/capabilities/containedProfile.ts";
import { checkSpecShape, measureLauncherVersionSync } from "../src/capabilities/containedLaunch.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const configPath = opt("--config");
const specPath = opt("--spec");
if (!configPath || !specPath) {
  console.error("usage: bun scripts/contained-profile.ts --config port-config.json --spec spawn-spec.json [--json]");
  process.exit(2);
}

try {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ContainedStdioPortConfig;
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as StdioSpawnSpec;
  const { profile, digest } = await (async () => {
    checkSpecShape(spec);                                  // an invalid spec is refused before any launcher runs
    return computeExecutionProfile(config, spec, { launcherVersion: measureLauncherVersionSync(config, new LaunchGate()) });
  })();
  if (args.includes("--json")) console.log(JSON.stringify({ executionProfileDigest: digest, profile }, null, 2));
  else console.log(digest);
} catch (error) {
  console.error(`contained-profile: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
