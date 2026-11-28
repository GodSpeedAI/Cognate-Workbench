// #114/#116 finding 8: the documented profile CLI must print the digest an operator writes into SEA policy, from a plain JSON
// configuration (no authorize hook, which JSON cannot carry), identical to the profile the running port computes.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { computeExecutionProfile } from "../src/capabilities/containedProfile.ts";
import { scopedPort } from "./support/scopedPort.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
let root: string; let configPath: string; let specPath: string; let config: Record<string, unknown>; let spec: Record<string, unknown>;
const LAUNCHER = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\nexit 0\n`;
const EXE = "#!/bin/sh\necho child\n";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "profile-cli-"));
  await mkdir(join(root, "bin")); await mkdir(join(root, "ws"));
  await writeFile(join(root, "bin", "bwrap"), LAUNCHER); await chmod(join(root, "bin", "bwrap"), 0o755);
  await writeFile(join(root, "bin", "child"), EXE); await chmod(join(root, "bin", "child"), 0o755);
  config = { launcher: { path: join(root, "bin", "bwrap"), sha256: sha(LAUNCHER) }, executables: [{ path: join(root, "bin", "child"), sha256: sha(EXE) }], workspaceRoot: join(root, "ws"), writableRoots: [], envAllowlist: ["MODE"], envValuePatterns: { MODE: "[a-z]{1,8}" } };
  spec = { argv: [join(root, "bin", "child"), "--serve"], cwd: join(root, "ws"), env: {}, restrictions: {} };
  configPath = join(root, "port.json"); specPath = join(root, "spec.json");
  await writeFile(configPath, JSON.stringify(config)); await writeFile(specPath, JSON.stringify(spec));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const cli = (...extra: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "..", "scripts", "contained-profile.ts"), "--config", configPath, "--spec", specPath, ...extra], { stdout: "pipe", stderr: "pipe" });

test("the CLI prints the profile digest for a JSON configuration, equal to the digest the live port computes", async () => {
  const printed = cli();
  expect(printed.stderr.toString()).toBe("");
  expect(printed.exitCode).toBe(0);
  const digest = printed.stdout.toString().trim();
  expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  const live = await scopedPort({ ...config, authorize: async () => {} } as never).executionProfile(spec as never);
  expect(digest).toBe(live.digest);
  expect((await computeExecutionProfile(config as never, spec as never)).digest).toBe(digest);
});

test("--json prints the profile itself, including the env value patterns and the seccomp filter id the operator approves", () => {
  const out = cli("--json");
  expect(out.exitCode).toBe(0);
  const parsed = JSON.parse(out.stdout.toString());
  expect(parsed.executionProfileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(parsed.profile.envPatterns).toEqual({ MODE: "[a-z]{1,8}" });
  expect(parsed.profile.seccomp).toMatchObject({ id: "socket-allowlist-v2" });
});

test("a configuration the port would refuse is a clear error and a non-zero exit, not a digest", async () => {
  await writeFile(configPath, JSON.stringify({ ...config, envValuePatterns: {} }));
  const bad = cli();
  expect(bad.exitCode).toBe(1);
  expect(bad.stderr.toString()).toMatch(/pattern/);
  expect(bad.stdout.toString()).toBe("");
  await writeFile(configPath, JSON.stringify(config));
});
