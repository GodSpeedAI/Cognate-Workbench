// J-PKG-durable-restart: the bundled database must start with the password the record holds, even when that
// password begins with "-" (it is base64url). pg0 reads a separate "-..." argument as an option and exits 2, so the
// password is passed in one `--password=` argument.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startWithRecord, type BundledRecord } from "../src/pg0Launch.ts";

const posix = process.platform !== "win32";

async function fakePg0(dir: string): Promise<string> {
  const bin = join(dir, "pg0");
  // Records its arguments one per line, then exits with the status in PG0_EXIT (default 0).
  await writeFile(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_FILE"\nexit "${PG0_EXIT:-0}"\n');
  await chmod(bin, 0o755);
  return bin;
}

function recordWith(password: string): BundledRecord {
  return {
    name: "cognate-workbench-test",
    dataDir: "/tmp/cognate-workbench-test/data",
    version: "18.1.0",
    password,
    createdAt: new Date(0).toISOString(),
    initialized: false,
  } as BundledRecord;
}

describe.skipIf(!posix)("J-PKG-durable-restart: pg0 start arguments", () => {
  test("a password that begins with a dash is passed as one --password= argument", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg0-args-"));
    try {
      const bin = await fakePg0(dir);
      const argsFile = join(dir, "args.txt");
      process.env.ARGS_FILE = argsFile;
      await startWithRecord(bin, recordWith("-Abc_dEf-123"), join(dir, "pg0.log"));
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args).toContain("--password=-Abc_dEf-123");
      expect(args).not.toContain("--password");
      expect(args).toContain("--name");
    } finally {
      delete process.env.ARGS_FILE;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a non-zero pg0 exit fails the start and names the log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg0-args-"));
    try {
      const bin = await fakePg0(dir);
      process.env.ARGS_FILE = join(dir, "args.txt");
      process.env.PG0_EXIT = "2";
      await expect(startWithRecord(bin, recordWith("plain"), join(dir, "pg0.log"))).rejects.toThrow(/exited with 2/);
    } finally {
      delete process.env.ARGS_FILE;
      delete process.env.PG0_EXIT;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
