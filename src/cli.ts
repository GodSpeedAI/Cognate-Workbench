// The `cognate-workbench` command: `start` (the default), `doctor`, `--version`, `--help`.
// `start` is the only subcommand that opens the database for writing or runs the server. `doctor` reads
// everything and changes nothing: it never starts the bundled instance and never prints a credential.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PG0_VERSION, POSTGRES_VERSION } from "../scripts/pg0-pins.ts";
import { defaultHome, packaged, resourcePath } from "./resources.ts";
import { pg0Info, pg0Sha256, prepareBundledDatabase, readRecord, bundledInstanceName, stopBundledDatabase } from "./pg0Launch.ts";
import { setBundledDatabaseUrl } from "./store.ts";
import { parseDevAuth, startServer } from "./server.ts";
import { EXECUTION_POSTURE_ENV } from "./executionPosture.ts";
import { findAppBrowser, launchAppWindow, openDefaultBrowser } from "./desktopWindow.ts";

const LOCK_FILE = "server.lock";

interface Manifest {
  readonly version: string;
  readonly commit: string;
  readonly tag: string;
  readonly bunTarget: string;
  readonly pg0: { readonly version: string; readonly asset: string; readonly sha256: string };
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** The release manifest, present only in packaged installs. Development has no manifest. */
async function manifest(): Promise<Manifest | undefined> {
  return readJson<Manifest>(resourcePath("MANIFEST.json"));
}

async function appVersion(): Promise<string> {
  const pkg = await readJson<{ version: string }>(resourcePath("package.json"));
  return (await manifest())?.version ?? pkg?.version ?? "unknown";
}

function pg0Path(): string {
  return process.env.COGNATE_PG0_BIN ?? resourcePath("bin", process.platform === "win32" ? "pg0.exe" : "pg0");
}

/** Packaged installs run only the pg0 executable whose digest the release manifest records. */
async function verifyPg0(bin: string, release: Manifest | undefined): Promise<void> {
  if (!existsSync(bin)) throw new Error(`bundled pg0 is missing at ${bin}; reinstall the package`);
  if (!release) throw new Error("this package has no MANIFEST.json; its pg0 cannot be verified, refusing to run it");
  const actual = await pg0Sha256(bin);
  if (actual !== release.pg0.sha256) {
    throw new Error(`bundled pg0 failed integrity verification: sha256 ${actual} does not match the release manifest ${release.pg0.sha256}; reinstall the package`);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One live owner per data home. A lock whose owner has died is taken over (interrupted-shutdown recovery). */
async function acquireHomeLock(home: string, port: number): Promise<() => Promise<void>> {
  const file = join(home, LOCK_FILE);
  const prior = await readJson<{ pid: number; port: number }>(file);
  if (prior && prior.pid !== process.pid && alive(prior.pid)) {
    throw new Error(`another Cognate Workbench (pid ${prior.pid}, port ${prior.port}) is using data home ${home}; stop it first`);
  }
  if (prior) console.log(`[cognate-workbench] recovering from an interrupted owner (pid ${prior.pid}); its database is reused, not reinitialised`);
  await writeFile(file, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return async () => {
    const current = await readJson<{ pid: number }>(file);
    if (current?.pid === process.pid) await rm(file, { force: true });
  };
}

/** Refuse an occupied port before any database is touched, so a losing second owner leaves nothing running. */
async function assertPortFree(port: number): Promise<void> {
  try {
    Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") }).stop(true);
  } catch {
    throw new Error(`port ${port} is already in use (EADDRINUSE); another service or Workbench holds it`);
  }
}

interface Running { readonly url: string; readonly shutdown: (signal: string) => Promise<void> }

async function start(): Promise<Running> {
  // The packaged pg0 binary is used unless the operator names another one.
  if (packaged) process.env.COGNATE_PG0_BIN ??= pg0Path();
  const port = Number(process.env.PORT ?? 3180);
  const home = process.env.COGNATE_WORKBENCH_HOME ?? process.env.COGNATE_HARNESS_HOME ?? defaultHome();
  const release = await manifest();
  console.log(`[cognate-workbench] data home: ${home} (packaged: ${packaged}, resources: ${resourcePath()})`);
  await mkdir(home, { recursive: true, mode: 0o700 });

  // An explicit external PostgreSQL URL means pg0 is never started or stopped. Otherwise a packaged install
  // uses its own bundled instance, recorded under this data home.
  const bundled = packaged && !process.env.COGNATE_POSTGRES_URL;
  const pg0Name = process.env.COGNATE_PG0_NAME ?? bundledInstanceName(home);
  const releaseLock = await acquireHomeLock(home, port);
  let app: Awaited<ReturnType<typeof startServer>>;
  try {
    await assertPortFree(port);
    if (bundled) {
      const bin = process.env.COGNATE_PG0_BIN!;
      await verifyPg0(bin, release);
      const db = await prepareBundledDatabase({ bin, home, name: pg0Name, expectedVersion: POSTGRES_VERSION });
      setBundledDatabaseUrl(db.url);
      console.log(`[cognate-workbench] database: bundled pg0 "${db.info.name}" (PostgreSQL ${db.info.version}, port ${db.info.port}), data ${db.info.data_dir}`);
    } else {
      console.log(`[cognate-workbench] database: ${process.env.COGNATE_POSTGRES_URL ? "external PostgreSQL (COGNATE_POSTGRES_URL)" : "development pg0 (not packaged)"}`);
    }
    app = await startServer({ port, home });
  } catch (error) {
    await releaseLock();
    throw error;
  }

  // A clean shutdown closes the application first, then stops the bundled database this home owns.
  let closing: Promise<void> | undefined;
  const shutdown = (signal: string): Promise<void> => closing ??= (async () => {
    console.log(`[cognate-workbench] ${signal}: closing the application`);
    await app.stop();
    if (bundled && (await stopBundledDatabase(process.env.COGNATE_PG0_BIN!, home))) {
      console.log(`[cognate-workbench] bundled database "${pg0Name}" stopped (owned by this data home)`);
    }
    await releaseLock();
    process.exit(0);
  })();
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  console.log(`[cognate-workbench] listening on ${app.url} (home: ${home})`);
  console.log(`[cognate-workbench] auth: durable session posture (browser entry holds this boot's revocable session); dev auth is ${parseDevAuth(process.env.COGNATE_DEV_AUTH) ? "ARMED (test/dev only)" : "off"}`);
  if (app.executionPosture === "contained") {
    console.log(`[cognate-workbench] execution: contained — agent commands and writes run only in Linux-contained or explicitly connected remote workspaces; local workspaces are read-only to agents (${EXECUTION_POSTURE_ENV}=uncontained-local to opt out)`);
  } else {
    console.warn(`[cognate-workbench] execution: UNCONTAINED LOCAL — agents run commands and write files on this host as this user; path checks are not a sandbox (${EXECUTION_POSTURE_ENV}=uncontained-local)`);
  }
  return { url: app.url, shutdown };
}

// ---- launch / stop ----

const homeOf = (): string => process.env.COGNATE_WORKBENCH_HOME ?? process.env.COGNATE_HARNESS_HOME ?? defaultHome();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** A window that exits this fast handed itself to an already-running browser instance on the same profile. */
const HANDOFF_MS = 1500;

/** The live Workbench that holds this data home, if its /health answers on the recorded port. */
async function runningInstance(home: string): Promise<string | undefined> {
  const prior = await readJson<{ pid: number; port: number }>(join(home, LOCK_FILE)).catch(() => undefined);
  if (!prior || prior.pid === process.pid || !alive(prior.pid)) return undefined;
  const url = `http://127.0.0.1:${prior.port}`;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The desktop entry: one server per home, shown in its own application window; closing the window quits the server. */
async function launch(): Promise<number> {
  const home = homeOf();
  const noWindow = process.env.COGNATE_NO_WINDOW === "1";
  const browser = noWindow ? undefined : findAppBrowser(process.platform, process.env);

  const existing = noWindow ? undefined : await runningInstance(home);
  if (existing) {
    console.log(`[cognate-workbench] already running at ${existing}; opening a window`);
    if (browser) {
      const window = launchAppWindow(browser, existing, home);
      await Promise.race([window.exited, sleep(3000)]);
      window.unref();
    } else openDefaultBrowser(existing);
    return 0;
  }

  const running = await start();
  if (noWindow) return 0;
  if (!browser) {
    console.log(`[cognate-workbench] no Chromium-family browser found for an app window; opened the default browser. Run "cognate-workbench stop" to quit.`);
    openDefaultBrowser(running.url);
    return 0;
  }
  const opened = Date.now();
  const code = await launchAppWindow(browser, running.url, home).exited;
  if (Date.now() - opened < HANDOFF_MS) {
    console.log(`[cognate-workbench] the window process exited after ${Date.now() - opened}ms (exit ${code}); it likely handed off to a running browser, so the server keeps running. Run "cognate-workbench stop" to quit.`);
    return 0;
  }
  await running.shutdown("app window closed");
  return 0;
}

/** Ask the Workbench holding this data home to stop. SIGTERM runs its clean shutdown on POSIX; on Windows
 *  process.kill is forceful (no cleanup; the next start recovers the interrupted owner and reuses the database). */
async function stop(): Promise<number> {
  const prior = await readJson<{ pid: number; port: number }>(join(homeOf(), LOCK_FILE));
  if (!prior || !alive(prior.pid)) {
    console.log("cognate-workbench: not running");
    return 0;
  }
  process.kill(prior.pid);
  console.log(`cognate-workbench: asked pid ${prior.pid} (port ${prior.port}) to stop`);
  return 0;
}

// ---- doctor ----

interface Check { readonly label: string; readonly value: string; readonly ok: boolean }

async function probeDatabase(url: string): Promise<string> {
  const sql = new Bun.SQL(url, { max: 1, connectionTimeout: 5 });
  try {
    const [row] = await sql`select version() as version`;
    return `ok (${String((row as { version: string }).version).split(" on ")[0]})`;
  } finally {
    await sql.close();
  }
}

function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
}

async function doctor(): Promise<number> {
  const checks: Check[] = [];
  const add = (label: string, value: string, ok = true) => checks.push({ label, value, ok });
  const release = await manifest();
  const home = process.env.COGNATE_WORKBENCH_HOME ?? process.env.COGNATE_HARNESS_HOME ?? defaultHome();

  add("version", `${await appVersion()}${release ? ` (commit ${release.commit.slice(0, 12)}, tag ${release.tag})` : " (development checkout)"}`);
  add("runtime", `bun ${Bun.version} (${packaged ? "compiled executable, no separate Bun needed" : "source"})`);
  add("install", packaged ? `packaged, resources ${resourcePath()}` : `checkout, resources ${resourcePath()}`);
  add("data home", `${home} (${existsSync(home) ? "present" : "not created yet"})`);

  // Executable identity.
  const bin = pg0Path();
  if (!packaged && !process.env.COGNATE_PG0_BIN) add("pg0 executable", "development: resolved by the SDK pg0 driver (.tmp/pg0 or PATH) when needed");
  else if (!existsSync(bin)) add("pg0 executable", `missing at ${bin}`, false);
  else {
    const digest = await pg0Sha256(bin);
    const expected = release?.pg0.sha256;
    const version = (await run(bin, ["--version"])).trim();
    add("pg0 executable", `${bin} (${version}, sha256 ${digest.slice(0, 16)}…, pinned ${PG0_VERSION})`, !expected || expected === digest);
    if (expected && expected !== digest) add("pg0 integrity", "MISMATCH with the release manifest; the bundled database will not start", false);
  }

  // Database mode and health.
  const externalUrl = process.env.COGNATE_POSTGRES_URL;
  if (externalUrl) {
    add("database mode", `external PostgreSQL (${redact(externalUrl)})`);
    try {
      add("database health", await probeDatabase(externalUrl));
    } catch (error) {
      add("database health", `unreachable: ${(error as Error).message}`, false);
    }
  } else if (packaged) {
    const name = process.env.COGNATE_PG0_NAME ?? bundledInstanceName(home);
    add("database mode", `bundled pg0 (instance "${name}")`);
    const record = await readRecord(home);
    const info = await pg0Info(bin, name).catch((error: Error) => {
      add("database instance", error.message, false);
      return undefined;
    });
    if (!record) add("database record", "none yet (created by the first start)");
    else if (!info) add("database instance", record.initialized ? "MISSING: recorded as initialised but pg0 has no such instance; start will refuse" : "not started yet", !record.initialized);
    else {
      add("database instance", `${info.running ? "running" : "stopped"}, PostgreSQL ${info.version}, port ${info.port}, data ${info.data_dir}`, info.data_dir === record.dataDir && info.version === record.version);
      if (info.running && info.uri) {
        try {
          add("database health", await probeDatabase(info.uri));
        } catch (error) {
          add("database health", `unreachable: ${(error as Error).message}`, false);
        }
      } else add("database health", "not running (a start will reconnect to it)");
    }
  } else {
    add("database mode", "development pg0 (not packaged; uses `just db-up` or the SDK pg0 driver)");
  }

  // Semantic model.
  const model = resourcePath(".sea", "interaction", "interaction-model.sea");
  if (!existsSync(model)) add("semantic model", `missing at ${model}`, false);
  else {
    const expected = release?.files.find((file) => file.path.endsWith(".sea/interaction/interaction-model.sea"))?.sha256;
    const digest = createHash("sha256").update(await readFile(model)).digest("hex");
    add("semantic model", `present, sha256 ${digest.slice(0, 16)}…`, !expected || expected === digest);
  }

  // Posture and integrations.
  add("authentication", `durable operator session; dev auth ${parseDevAuth(process.env.COGNATE_DEV_AUTH) ? "ARMED (test/dev only)" : "off"}`);
  const posture = process.env[EXECUTION_POSTURE_ENV] ?? "contained";
  add("execution posture", posture === "uncontained-local" ? "UNCONTAINED LOCAL (opt-in)" : "contained (default)", posture !== "uncontained-local");
  const bwrap = Bun.which("bwrap");
  add("containment", bwrap ? `bubblewrap available at ${bwrap}` : "bubblewrap not found: contained agent execution is refused on this host (reported, not a failed install)");
  add("RealityTrace (sxr)", process.env.SXR_BIN ?? (Bun.which("sxr") ?? "not installed (observations stay queued)"), true);
  add("SEA-Forge governance", process.env.COGNATE_GOVERNANCE ?? "off", true);

  const width = Math.max(...checks.map((c) => c.label.length));
  for (const check of checks) console.log(`${check.ok ? "  ok " : "  FAIL"} ${check.label.padEnd(width)}  ${check.value}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? "\ncognate-workbench doctor: healthy" : `\ncognate-workbench doctor: ${failed} problem(s) found`);
  return failed === 0 ? 0 : 1;
}

async function run(bin: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return code === 0 ? out : "unknown";
}

const USAGE = `cognate-workbench — Cognate Workbench local application

Usage:
  cognate-workbench [start]     start the Workbench server (default)
  cognate-workbench launch      start (or reuse) the Workbench in its own app window; closing the window quits
                                (COGNATE_NO_WINDOW=1: like start; COGNATE_APP_BROWSER=<path>: choose the browser)
  cognate-workbench stop        ask the running Workbench for this data home to stop (forceful on Windows)
  cognate-workbench doctor      report installation, database, posture and integration status
  cognate-workbench --version   print the version and build identity
  cognate-workbench --help      show this help

Environment (see docs/reference/configuration.md):
  PORT                      loopback port (default 3180)
  COGNATE_WORKBENCH_HOME    per-user data home (default: XDG / Application Support / LocalAppData)
  COGNATE_POSTGRES_URL      use an external PostgreSQL instead of the bundled one
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    const release = await manifest();
    console.log(`cognate-workbench ${await appVersion()}${release ? ` (commit ${release.commit}, ${release.bunTarget}, pg0 ${release.pg0.version})` : " (development)"}`);
    return 0;
  }
  if (command === undefined || command === "start") {
    if (rest.length > 0) throw new Error(`start takes no arguments (got ${rest.join(" ")})`);
    await start();
    return 0;
  }
  if (command === "launch" || command === "stop") {
    if (rest.length > 0) throw new Error(`${command} takes no arguments (got ${rest.join(" ")})`);
    return command === "launch" ? launch() : stop();
  }
  if (command === "doctor") {
    if (rest.length > 0) throw new Error(`doctor takes no arguments (got ${rest.join(" ")})`);
    return doctor();
  }
  console.error(`cognate-workbench: unknown command "${command}"\n`);
  console.error(USAGE);
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (error: Error) => {
      console.error(`[cognate-workbench] ${error.message}`);
      process.exit(1);
    },
  );
}
