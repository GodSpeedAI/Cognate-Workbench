// The bundled PostgreSQL instance: pg0 is driven directly so that every start passes the same data directory
// and password. pg0 remembers neither: a bare `pg0 start --name X` after a restart initialises a new default
// instance (postgres/postgres in an empty directory) instead of reconnecting to the store. The SDK's pg0 driver
// does exactly that, so bundled installs never use it; they connect through the URL resolved here.
//
// Ownership: `<home>/database/bundled.json` records the instance this data home created. A clean shutdown stops
// only that instance; an external `COGNATE_POSTGRES_URL` never reaches this module.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, openSync, closeSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Pg0Info {
  readonly name: string;
  readonly running: boolean;
  readonly pid?: number;
  readonly port: number;
  readonly version: string;
  readonly username: string;
  readonly database: string;
  readonly data_dir: string;
  readonly uri?: string;
}

/** The record this data home keeps for its bundled instance. `initialized` flips once the first start succeeds. */
export interface BundledRecord {
  readonly name: string;
  readonly dataDir: string;
  readonly version: string;
  readonly password: string;
  readonly createdAt: string;
  initialized: boolean;
}

export const BUNDLED_RECORD_FILE = "bundled.json";

/** A stable, per-home pg0 instance name. Two data homes never share an instance. */
export function bundledInstanceName(home: string): string {
  return `cognate-workbench-${createHash("sha256").update(home).digest("hex").slice(0, 12)}`;
}

function run(bin: string, args: readonly string[], stdio: "pipe" | "ignore"): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "ignore", windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** `pg0 info`: `undefined` when the instance does not exist. Any other failure is an error, never "missing". */
export async function pg0Info(bin: string, name: string): Promise<Pg0Info | undefined> {
  const result = await run(bin, ["info", "--name", name, "-o", "json"], "pipe");
  // A missing instance exits 0 and reports only {"name","running":false}; the text form says "does not exist".
  if (/does not exist/i.test(result.stdout + result.stderr)) return undefined;
  if (result.code !== 0) throw new Error(`pg0 info --name ${name} failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  const info = JSON.parse(result.stdout) as Partial<Pg0Info>;
  return info.data_dir === undefined ? undefined : (info as Pg0Info);
}

/** Start the instance with the record's data directory and password, logging to a file (never a pipe: postgres
 * inherits its stdio, and a pipe that stays open is what hangs `pg0 start` on Windows). */
export async function startWithRecord(bin: string, record: BundledRecord, logPath: string): Promise<void> {
  await mkdir(join(logPath, ".."), { recursive: true });
  const log = openSync(logPath, "a");
  try {
    // `--password=` in one argument: a generated password may begin with "-" (base64url), which pg0 would otherwise read as an option.
    const child = spawn(bin, ["start", "--name", record.name, "--data-dir", record.dataDir, `--password=${record.password}`], {
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exit) => resolve(exit ?? 1));
    });
    if (code !== 0) throw new Error(`pg0 start --name ${record.name} exited with ${code}; see ${logPath}`);
  } finally {
    closeSync(log);
  }
}

/** pg0 writes the password into the instance's `instance.json` world-readable (0644). Tighten it after each start. */
export async function restrictInstanceMetadata(name: string): Promise<void> {
  const file = join(homedir(), ".pg0", "instances", name, "instance.json");
  if (existsSync(file)) await chmod(file, 0o600).catch(() => undefined);
}

export async function readRecord(home: string): Promise<BundledRecord | undefined> {
  const file = join(home, "database", BUNDLED_RECORD_FILE);
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as BundledRecord;
}

async function writeRecord(home: string, record: BundledRecord): Promise<void> {
  await writeFile(join(home, "database", BUNDLED_RECORD_FILE), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await chmod(join(home, "database", BUNDLED_RECORD_FILE), 0o600).catch(() => undefined);
}

export interface BundledDatabase {
  readonly url: string;
  readonly info: Pg0Info;
  readonly record: BundledRecord;
}

/**
 * Ensure the data home's bundled instance is running and return its connection URL.
 *
 * - first launch: records a new instance (fresh password, data under `<home>/database/data`), starts it, records success;
 * - normal restart or recovery after a crash: the recorded instance is started or reused, with the same data directory;
 * - fail closed: a recorded instance that has disappeared, moved, changed version, or a pg0 instance that exists
 *   without a record is refused. Nothing is created silently and nothing is adopted.
 */
export async function prepareBundledDatabase(options: { bin: string; home: string; name: string; expectedVersion: string }): Promise<BundledDatabase> {
  const { bin, home, name, expectedVersion } = options;
  const dbDir = join(home, "database");
  await mkdir(dbDir, { recursive: true, mode: 0o700 });
  await chmod(dbDir, 0o700).catch(() => undefined);
  const logPath = join(home, "logs", "pg0.log");

  let record = await readRecord(home);
  if (record && record.name !== name) {
    throw new Error(`this data home's database is "${record.name}" but this run selects "${name}"; COGNATE_PG0_NAME must not change for an existing home`);
  }
  let current = await pg0Info(bin, name);
  if (!record) {
    if (current) throw new Error(`pg0 instance "${name}" already exists but ${join(dbDir, BUNDLED_RECORD_FILE)} is missing; refusing to adopt an instance this data home did not create`);
    record = { name, dataDir: join(dbDir, "data"), version: expectedVersion, password: randomBytes(24).toString("base64url"), createdAt: new Date().toISOString(), initialized: false };
    await writeRecord(home, record);
  } else if (record.initialized && !current) {
    throw new Error(`the bundled database "${name}" is recorded as initialised but pg0 has no such instance; refusing to create an empty store. Restore the pg0 instance (its data is in ${record.dataDir}) or move ${dbDir} aside to start fresh`);
  } else if (record.initialized && !existsSync(record.dataDir)) {
    throw new Error(`the bundled database data directory ${record.dataDir} is missing; refusing to create an empty store`);
  }
  if (current && current.data_dir !== record.dataDir) {
    throw new Error(`pg0 instance "${name}" uses ${current.data_dir}, not this data home's ${record.dataDir}; refusing to attach to it`);
  }
  if (current && current.version !== record.version) {
    throw new Error(`pg0 instance "${name}" is PostgreSQL ${current.version}; this build expects ${record.version}`);
  }

  if (!current?.running) {
    await startWithRecord(bin, record, logPath);
    await restrictInstanceMetadata(name);
    current = await pg0Info(bin, name);
    if (!current?.running || !current.uri) throw new Error(`pg0 started instance "${name}" but it is not reported running; see ${logPath}`);
  }
  if (!record.initialized) {
    record.initialized = true;
    await writeRecord(home, record);
  }
  return { url: current.uri!, info: current, record };
}

/** Stop the instance this data home owns. Returns false when the record says this home never started one. */
export async function stopBundledDatabase(bin: string, home: string): Promise<boolean> {
  const record = await readRecord(home);
  if (!record?.initialized) return false;
  const result = await run(bin, ["stop", "--name", record.name], "ignore");
  if (result.code !== 0) throw new Error(`pg0 stop --name ${record.name} exited with ${result.code}`);
  return true;
}

/** SHA-256 of the pg0 executable, checked against the release manifest before anything runs it. */
export async function pg0Sha256(bin: string): Promise<string> {
  return createHash("sha256").update(await readFile(bin)).digest("hex");
}
