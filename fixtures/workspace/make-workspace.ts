#!/usr/bin/env bun
// Creates a fresh copy of ./template at a given directory, git-inits it with
// a fixed local user/email and fixed author/committer dates, so the initial
// commit SHA is deterministic across runs and machines. Prints the path.

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(HERE, "template");
const FIXED_DATE = "2026-01-01T00:00:00Z";
const AUTHOR_NAME = "Fixture Bot";
const AUTHOR_EMAIL = "fixture-bot@example.invalid";

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`command failed (${code}): ${cmd.join(" ")}\n${stderr}`);
  }
}

async function makeWorkspace(targetDir: string): Promise<string> {
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(targetDir, { recursive: true });
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await run(["git", "init", "--initial-branch=main"], targetDir);
  await run(["git", "config", "user.name", AUTHOR_NAME], targetDir);
  await run(["git", "config", "user.email", AUTHOR_EMAIL], targetDir);
  await run(["git", "add", "-A"], targetDir);

  const commitEnv = {
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_DATE: FIXED_DATE,
  };
  await run(["git", "commit", "-m", "Initial fixture workspace", "--no-gpg-sign"], targetDir, commitEnv);

  return targetDir;
}

if (import.meta.main) {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error("usage: bun make-workspace.ts <target-dir>");
    process.exit(1);
  }
  const path = await makeWorkspace(targetDir);
  console.log(path);
}

export { makeWorkspace };
